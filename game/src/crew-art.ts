/**
 * IMPOSTOR PROTOCOL — crew artwork.
 *
 * Every character on this station is a real Rare Friends token: the NPC
 * crewmates are canonical masks read from Robinhood mainnet (chain 4663)
 * through the SDK's own reader (`createFriendReader()` →
 * `createGenerationSpriteReader()` → `familyOf` / `seedOf` / `frames` on the
 * Generations registry 0x246E3E9730A7Eade94c79be0Fd78d210f89AEb8D), decoded by
 * the SDK's `decodeSpriteBitmap()` / `spriteFrame()`. Nothing here is drawn by
 * hand, no image file exists anywhere in the game, and no pixel leaves this
 * module that did not come out of a chain frame.
 *
 * PIXEL PROVENANCE, stated precisely so the claim can be checked:
 *   · mask geometry, halo footprint and the 16x16 pixel grid — the chain's;
 *   · the suit tint and the halo colour are paint applied to those pixels, which
 *     is also how the player's own canonical mask has always been drawn here;
 *   · the impostor is NOT a second drawing. Its treatment (hostile suit tint,
 *     broken halo) is a colour/alpha operation over one canonical frame, and it
 *     is REVEAL-ONLY: while a round is live the impostor is drawn from exactly
 *     the same canonical frames, with exactly the same tint, as the crew, because
 *     the game is deducing who they are. `revealImpostorIds()` decides when the
 *     treated frame may appear, and `crew-art-check.mjs` compares the emitted
 *     pixels of the live and revealed frames to prove both halves of that rule.
 *
 * FALLBACK, and why it is not cheating: if the chain read for a token fails at
 * runtime we do NOT invent a Friend and we do not draw a fake one. That actor is
 * drawn from the PLAYER's own canonical mask (`playerSprites`) tinted at a hue
 * derived from its actor id, and is flagged `player-mask-fallback` in the
 * diagnostics the renderer publishes. The station therefore shows fewer distinct
 * Friends, never an off-chain one.
 */
import { createFriendReader, decodeSpriteBitmap, spriteFrame, type GenerationSprites } from "@rarefriends/friendsdk/sprites";
import type { ActorId, Role } from "./types";
import { CREW_COLORS, type CrewColorId } from "./types";
import { createRng, hashSeed } from "./rng";

/**
 * The ids the crew may be drawn from. Every id in this pool was probed against
 * the live registry before it was taken (tests/id-probe.mjs re-runs that probe):
 * ids 1..16 each return a full 64-frame set with a decodable, non-empty 16x16
 * bitmap, all distinct. The pool is deliberately small — a fixed set we have
 * actually read beats a range we merely assume, and pinning it keeps the read
 * footprint of a round tiny and cacheable.
 */
export const CREW_TOKEN_POOL: readonly bigint[] = Object.freeze(
  Array.from({ length: 16 }, (_, index) => BigInt(index + 1)),
);

/** How many crew tokens a round asks for: one per NPC slot. */
export const CREW_TOKEN_COUNT = 6;

/**
 * THE IMPOSTOR TREATMENT IS REVEAL-ONLY. It is never painted while the round is
 * live: during play the impostor wears exactly the same canonical mask and the
 * same suit tint as every crewmate, in the station view, on the minimap and in
 * every roster, because the whole game is deducing who they are. These two
 * colours are applied by the renderer only when `revealImpostorIds()` says the
 * player has already been shown the answer: the kill the player caused or
 * watched, the ejection reveal, and the debrief where everyone is known.
 */
export const IMPOSTOR_TINT = "#7c1220";
export const IMPOSTOR_HALO = "#ff5f5f";

export type CrewArtSource = "chain" | "player-mask-fallback";

export type CrewArtEntry = Readonly<{
  actorId: ActorId;
  /** The token this actor's pixels came from (or the player's, on fallback). */
  tokenId: bigint;
  source: CrewArtSource;
  /** Canonical clips; on fallback these are the player's own clips. */
  sprites: GenerationSprites;
  /** FNV-1a of the 64 canonical bitmaps held for this actor. */
  framesDigest: string;
  /** FNV-1a of the 16 rows of frame 0 (idle, facing down). */
  checksum: string;
  /** Wall-clock milliseconds this actor's read cost (0 when it was cached). */
  readMs: number;
  /**
   * Repaints this actor's canonical pixels. Identical for crew and impostor: the
   * resolved roster palette hex (CREW_COLORS[actor.color]), so the suit matches
   * the same actor's roster swatch, minimap dot and HUD chip.
   */
  tint: string;
}>;

export type CrewArt = Readonly<{
  seed: number;
  entries: readonly CrewArtEntry[];
  byActor: Readonly<Record<string, CrewArtEntry>>;
  /**
   * Every NPC holding the impostor role, in actor order. A seven-actor table
   * deals TWO impostors, so a check that wants "the" NPC impostor has to be able
   * to see both — the renderer treats every id in `revealed`, not one id.
   */
  impostorIds: readonly ActorId[];
  /** The first NPC holding the impostor role, or null when the player holds it. */
  impostorId: ActorId | null;
  /** Wall-clock milliseconds the whole parallel round-start read took. */
  readMs: number;
  /** Tokens that failed and fell back. */
  failed: number;
  /** True when the whole read failed and every NPC is the player's mask. */
  degraded: boolean;
}>;

type CrewMember = Readonly<{ id: ActorId; role: Role; isPlayer: boolean; color: string }>;

let sharedReader: ReturnType<typeof createFriendReader> | null = null;

/** One reader per module: its token cache then serves every later round too. */
function reader(): ReturnType<typeof createFriendReader> {
  sharedReader ??= createFriendReader();
  return sharedReader;
}

/** FNV-1a over a string; stable across runs so a test can recompute it. */
export function digestText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Digest of every canonical bitmap an actor holds — the exact pixels on screen. */
export function framesDigest(frames: readonly bigint[]): string {
  let text = "";
  for (const frame of frames) text += frame.toString(16);
  return digestText(text);
}

/** Digest of one decoded frame's rows. */
export function rowsChecksum(rows: readonly string[]): string {
  return digestText(rows.join("/"));
}

/** The rows of a canonical frame, via the SDK's own decoder. */
export function canonicalRows(frame: bigint): readonly string[] {
  return decodeSpriteBitmap(frame).rows;
}

/**
 * The white one-pixel halo the canonical renderer draws around a mask — here as
 * an explicit pixel list so the impostor treatment can burn it in broken.
 *
 * `haloKept()` is the single definition of the damaged-halo rule; the renderer
 * calls it inline (no per-frame allocation) and `haloPixels()` uses it too, so
 * the drawn halo and the described halo can never drift apart.
 */
export function haloKept(px: number, py: number, intact: boolean): boolean {
  return intact || (px * 7 + py * 13) % 3 !== 0;
}

export function haloPixels(rows: readonly string[], intact = true): readonly (readonly [number, number])[] {
  const out: [number, number][] = [];
  for (let py = 0; py < 16; py++) {
    const row = rows[py];
    for (let px = 0; px < 16; px++) {
      if (row.charCodeAt(px) !== 35) continue;
      if (!haloKept(px, py, intact)) continue;
      out.push([px, py]);
    }
  }
  return out;
}

/** The solid mask pixels a frame paints; identical for crew and impostor. */
export function maskPixels(rows: readonly string[]): readonly (readonly [number, number])[] {
  const out: [number, number][] = [];
  for (let py = 0; py < 16; py++) {
    const row = rows[py];
    for (let px = 0; px < 16; px++) if (row.charCodeAt(px) === 35) out.push([px, py]);
  }
  return out;
}

/**
 * Deterministic crew tokens for a round: shuffle the verified pool with the
 * match seed and take `count` distinct ids, skipping the player's own token so
 * the station never shows the player twice.
 */
export function crewTokenIds(seed: number, count = CREW_TOKEN_COUNT, exclude?: bigint): bigint[] {
  const pool = CREW_TOKEN_POOL.filter(id => id !== exclude);
  const rng = createRng(hashSeed(`${seed}:crew-art`));
  const shuffled = pool.slice();
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swap = rng.int(index + 1);
    const held = shuffled[index];
    shuffled[index] = shuffled[swap];
    shuffled[swap] = held;
  }
  return shuffled.slice(0, Math.max(0, Math.min(count, shuffled.length)));
}

/** The suit tint a crewmate wears: the roster palette hex, never a bare colour word. */
function suitTint(color: string, actorId: ActorId): string {
  // The renderer paints `CrewArtEntry.tint` straight into the canvas, so it has
  // to be a resolved hex. Handing it the colour WORD ("blue") made the browser
  // resolve it as a CSS named colour — a different colour from the same actor's
  // roster swatch, minimap dot and HUD chip, and unreadable to any check that
  // decodes the drawn pixels.
  const palette = CREW_COLORS[color as CrewColorId] as string | undefined;
  if (palette) return palette;
  return color.startsWith("#") ? color : fallbackTint(actorId);
}

/** Hue for a fallback repaint: deterministic, and never the impostor's crimson. */
function fallbackTint(actorId: ActorId): string {
  const hue = hashSeed(`${actorId}:mask-hue`) % 360;
  const shifted = hue > 330 || hue < 20 ? (hue + 150) % 360 : hue;
  return hslHex(shifted, 0.62, 0.55);
}

function hslHex(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = lightness - chroma / 2;
  const sector = Math.floor(hue / 60) % 6;
  const rgb = [[chroma, second, 0], [second, chroma, 0], [0, chroma, second],
    [0, second, chroma], [second, 0, chroma], [chroma, 0, second]][sector] ?? [0, 0, 0];
  const channel = (value: number) => Math.round((value + match) * 255);
  return `#${((1 << 24) | (channel(rgb[0]) << 16) | (channel(rgb[1]) << 8) | channel(rgb[2])).toString(16).slice(1)}`;
}

/** An actor painted from the player's own mask because its own read failed. */
function fallbackEntry(actorId: ActorId, color: string, playerSprites: GenerationSprites): CrewArtEntry {
  return Object.freeze({
    actorId, tokenId: playerSprites.tokenId, source: "player-mask-fallback" as const,
    sprites: playerSprites, framesDigest: framesDigest(playerSprites.frames),
    checksum: rowsChecksum(canonicalRows(playerSprites.frames[0])),
    readMs: 0, tint: suitTint(color, actorId),
  });
}

/**
 * A crewmate painted from the player's own mask when no artwork resolved at all
 * (the first frame of a round, before the read lands). Same honest fallback as a
 * failed token: canonical pixels, a hue of its own, flagged in diagnostics.
 */
export function maskFallbackEntry(actorId: ActorId, color: string, playerSprites: GenerationSprites): CrewArtEntry {
  return fallbackEntry(actorId, color, playerSprites);
}

/** Rounds already resolved, so a replay of the same room code never re-reads. */
const ROUND_CACHE = new Map<string, CrewArt>();
const MAX_ROUNDS = 4;

function roundKey(seed: number, crew: readonly CrewMember[], playerTokenId?: bigint): string {
  return `${seed}|${playerTokenId ?? ""}|${crew.map(member => `${member.id}:${member.role}`).join(",")}`;
}

/**
 * Resolve this round's crew artwork. Reads every token in parallel through the
 * SDK reader, times the batch, and degrades per actor rather than failing the
 * round: a token that throws becomes the player's mask at a distinct hue.
 */
export async function loadCrewArt(input: {
  seed: number; actors: readonly CrewMember[]; playerSprites: GenerationSprites;
  playerTokenId?: bigint; reader?: ReturnType<typeof createFriendReader>;
}): Promise<CrewArt> {
  const crew = input.actors.filter(actor => !actor.isPlayer);
  const key = roundKey(input.seed, crew, input.playerTokenId);
  const cached = ROUND_CACHE.get(key);
  if (cached) return cached;

  const ids = crewTokenIds(input.seed, crew.length, input.playerTokenId);
  const client = input.reader ?? reader();
  const started = performance.now();
  const reads = crew.map((member, index) => {
    const tokenId = ids[index];
    if (tokenId === undefined) {
      // Fewer verified ids than actors: show fewer distinct Friends, never a fake one.
      return Promise.resolve({ member, entry: fallbackEntry(member.id, member.color, input.playerSprites) });
    }
    const readStarted = performance.now();
    return client.read(tokenId).then(sprites => ({
      member,
      entry: Object.freeze({
        actorId: member.id, tokenId, source: "chain" as const, sprites,
        framesDigest: framesDigest(sprites.frames),
        checksum: rowsChecksum(canonicalRows(sprites.frames[0])),
        readMs: Math.round(performance.now() - readStarted),
        tint: suitTint(member.color, member.id),
      }),
    })).catch(() => ({ member, entry: fallbackEntry(member.id, member.color, input.playerSprites) }));
  });

  const resolved = await Promise.all(reads);
  const readMs = Math.round(performance.now() - started);
  const entries: CrewArtEntry[] = [];
  const byActor: Record<string, CrewArtEntry> = {};
  const impostorIds: ActorId[] = [];
  for (const { member, entry } of resolved) {
    // No role is baked into the artwork: the impostor's entry is the same shape
    // and the same tint as a crewmate's. Only the renderer's `revealed` list can
    // put the treated frame on screen, and only once the answer is public.
    if (member.role === "impostor") impostorIds.push(member.id);
    entries.push(entry);
    byActor[member.id] = entry;
  }
  const art: CrewArt = Object.freeze({
    seed: input.seed, entries: Object.freeze(entries), byActor: Object.freeze(byActor),
    impostorIds: Object.freeze(impostorIds.slice()), impostorId: impostorIds[0] ?? null,
    readMs, failed: entries.filter(entry => entry.source === "player-mask-fallback").length,
    degraded: entries.every(entry => entry.source === "player-mask-fallback"),
  });
  ROUND_CACHE.set(key, art);
  if (ROUND_CACHE.size > MAX_ROUNDS) ROUND_CACHE.delete(ROUND_CACHE.keys().next().value!);
  return art;
}

/**
 * Who may wear the treated impostor frame this instant — and, in the ordinary
 * case, nobody. The rule is deliberately narrow so no live round can leak a tell:
 *
 *   · a kill the player caused or literally watched (`witnessed`, which the sim
 *     already announces in the event log) flashes the killer's true form;
 *   · the ejection reveal, once the count is in;
 *   · the debrief, where every role is public.
 *
 * Everything else — play, meetings, sabotage, the minimap, the roster — gets an
 * empty list, so the impostor is pixel-identical to the crew.
 */
export function revealImpostorIds(state: Readonly<{
  phase: string; actors: readonly Readonly<{ id: ActorId; role: Role }>[];
  ejection: Readonly<{ actorId: ActorId | null; role: Role | null }> | null;
}>, flash: Readonly<{ actorId: ActorId; until: number }> | null, time: number): readonly ActorId[] {
  const out: ActorId[] = [];
  if (state.phase === "over") for (const actor of state.actors) if (actor.role === "impostor") out.push(actor.id);
  if (state.phase === "ejection" && state.ejection?.role === "impostor" && state.ejection.actorId) out.push(state.ejection.actorId);
  if (flash && time < flash.until) out.push(flash.actorId);
  return out;
}

/** Plain, JSON-safe diagnostics for the canvas and the automated checks. */
export function crewArtDiagnostics(art: CrewArt | null, playerTokenId?: bigint) {
  if (!art) return null;
  return {
    seed: art.seed, readMs: art.readMs, failed: art.failed, degraded: art.degraded,
    impostorId: art.impostorId, impostorIds: art.impostorIds, playerTokenId: playerTokenId?.toString() ?? null,
    entries: art.entries.map(entry => ({
      actorId: entry.actorId, tokenId: entry.tokenId.toString(), source: entry.source,
      checksum: entry.checksum, framesDigest: entry.framesDigest, readMs: entry.readMs,
      tint: entry.tint,
    })),
  };
}
