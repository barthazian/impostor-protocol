/**
 * ROOM LOG — entry format, the two commitments, the cache table, the tree.
 *
 * TWO STREAMS, never merged:
 *   streams.match    genesis · join · run-sealed · close · settle · claim
 *   streams.economy  deposit · pass-purchase · cache-draw · merkle-root · claim
 * A payout record (cache-draw / merkle-root) lives ONLY in the economy stream;
 * `logProblems` rejects any log that mixes them.
 *
 * TWO COMMITMENTS, never merged:
 *   seedMatch — station, roles, bot brains. Hidden until CLOSE.
 *   seedDrop  — the cache draws. Revealed with SETTLEMENT.
 * The drip layer is a pure function of (seedDrop, slot, passIndex); the role
 * layer is a pure function of seedMatch. Neither can speak for the other, which
 * is why publishing the drops is safe while the roles are still sealed.
 */
import { createHash } from "node:crypto";

import { createRng, hashSeed } from "../../../games/impostor-protocol/src/rng";
import type { PlayerInput, Role, Tier } from "../../../games/impostor-protocol/src/types";

export const LOG_VERSION = 1;
export const SLOT_COUNT = 7;
export const PASS_PRICE_CENTS = 100;

/* ------------------------------------------------------------------ *
 *  The cache table — copied from the shipped game.json, never invented
 * ------------------------------------------------------------------ */

export type DripId =
  | "scrap-metal" | "spare-parts" | "circuit-board" | "power-cell"
  | "rare-alloy" | "quantum-core" | "genesis-artifact";

export type DropTableEntry = Readonly<{ id: DripId; label: string; bps: number; rfCents: number }>;

export const DROP_TABLE: readonly DropTableEntry[] = Object.freeze([
  { id: "scrap-metal", label: "Scrap Metal", bps: 2100, rfCents: 0 },
  { id: "spare-parts", label: "Spare Parts", bps: 3000, rfCents: 25 },
  { id: "circuit-board", label: "Circuit Board", bps: 1900, rfCents: 50 },
  { id: "power-cell", label: "Power Cell", bps: 1500, rfCents: 100 },
  { id: "rare-alloy", label: "Rare Alloy", bps: 900, rfCents: 200 },
  { id: "quantum-core", label: "Quantum Core", bps: 400, rfCents: 500 },
  { id: "genesis-artifact", label: "Genesis Artifact", bps: 200, rfCents: 1000 },
] as const);

export const DROP_BPS_TOTAL = DROP_TABLE.reduce((sum, entry) => sum + entry.bps, 0);
/** Expected value of one cache, in cents (RF x 100). Must be 90 = 0.90 RF. */
export const DROP_EV_CENTS = DROP_TABLE.reduce((sum, entry) => sum + entry.bps * entry.rfCents, 0) / DROP_BPS_TOTAL;

/**
 * The whole drip layer: one cache for one pass of one slot.
 *
 * Deterministic, seedDrop-only, and NOTHING else — no match state, no clock,
 * no outcome. Draw it at join, publish it at settle.
 */
export function roll(seedDrop: string, slot: number, passIndex: number): DropTableEntry {
  const rng = createRng(hashSeed(`${seedDrop}:drop:${slot}:${passIndex}`));
  let ticket = rng.int(DROP_BPS_TOTAL);
  for (const entry of DROP_TABLE) {
    if (ticket < entry.bps) return entry;
    ticket -= entry.bps;
  }
  return DROP_TABLE[DROP_TABLE.length - 1];
}

/* ------------------------------------------------------------------ *
 *  Hashing / canonical form
 * ------------------------------------------------------------------ */

export function sha256hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const DOMAIN_MATCH = "ip-room/v1/commit/match";
const DOMAIN_DROP = "ip-room/v1/commit/drop";

/** Genesis commitment to the role layer. Hash only — the preimage stays sealed. */
export function commitMatchSeed(seedMatch: string): string {
  return sha256hex(`${DOMAIN_MATCH}|${seedMatch}`);
}
/** Genesis commitment to the drip layer. Revealed (with its preimage) at settle. */
export function commitDropSeed(seedDrop: string): string {
  return sha256hex(`${DOMAIN_DROP}|${seedDrop}`);
}

/** Stable stringify: key order can never change a hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

/** One frame of one slot, packed: 4 direction bits, optional tap destination. */
export function frameCode(input: PlayerInput): string {
  const bits = (input.up ? 1 : 0) | (input.down ? 2 : 0) | (input.left ? 4 : 0) | (input.right ? 8 : 0);
  return input.destination
    ? `${bits}@${input.destination.x.toFixed(6)},${input.destination.y.toFixed(6)}`
    : `${bits}`;
}

/** What a slot sealed at join: a commitment over its whole action stream. */
export function actionsDigest(actions: readonly PlayerInput[]): string {
  return sha256hex(`ip-room/v1/actions|${actions.length}|${actions.map(frameCode).join(",")}`);
}

/** Deterministic stand-in for a player wallet under the room's steward secret. */
export function walletFor(roomId: string, slot: number): string {
  return `0x${sha256hex(`ip-room/v1/wallet|${roomId}|${slot}`).slice(0, 40)}`;
}

/* ------------------------------------------------------------------ *
 *  Entitlement tree — (wallet, amount owed)
 * ------------------------------------------------------------------ */

export type Leaf = Readonly<{ wallet: string; amountCents: number }>;
export type ProofStep = Readonly<{ side: "left" | "right"; hash: string }>;

export function leafHash(leaf: Leaf): string {
  return sha256hex(`ip-room/v1/leaf|${leaf.wallet}|${leaf.amountCents}`);
}
function nodeHash(left: string, right: string): string {
  return sha256hex(`ip-room/v1/node|${left}|${right}`);
}

/** Leaves are SORTED by wallet before hashing, so insertion order cannot matter. */
export function sortedLeaves(leaves: readonly Leaf[]): Leaf[] {
  return [...leaves].sort((a, b) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0));
}

export type MerkleTree = Readonly<{ root: string; layers: readonly string[][]; index: ReadonlyMap<string, number> }>;

/** BTCTREE-style tree: an odd tail node is paired with itself. */
export function buildTree(leaves: readonly Leaf[]): MerkleTree {
  const sorted = sortedLeaves(leaves);
  if (sorted.length === 0) return { root: sha256hex("ip-room/v1/empty"), layers: [[sha256hex("ip-room/v1/empty")]], index: new Map() };
  const layers: string[][] = [sorted.map(leafHash)];
  while (layers[layers.length - 1].length > 1) {
    const layer = layers[layers.length - 1];
    const next: string[] = [];
    for (let index = 0; index < layer.length; index += 2) {
      const right = index + 1 < layer.length ? layer[index + 1] : layer[index];
      next.push(nodeHash(layer[index], right));
    }
    layers.push(next);
  }
  const index = new Map(sorted.map((leaf, position) => [leaf.wallet, position]));
  return { root: layers[layers.length - 1][0], layers, index };
}

export function proofFor(leaves: readonly Leaf[], wallet: string): Readonly<{ leaf: Leaf; proof: ProofStep[]; root: string }> {
  const sorted = sortedLeaves(leaves);
  const position = sorted.findIndex(leaf => leaf.wallet === wallet);
  if (position < 0) throw new Error(`no entitlement leaf for ${wallet}`);
  const tree = buildTree(sorted);
  const proof: ProofStep[] = [];
  let cursor = position;
  for (let level = 0; level < tree.layers.length - 1; level++) {
    const layer = tree.layers[level];
    if (cursor % 2 === 0) {
      const right = cursor + 1 < layer.length ? cursor + 1 : cursor;
      proof.push({ side: "right", hash: layer[right] });
    } else {
      proof.push({ side: "left", hash: layer[cursor - 1] });
    }
    cursor = Math.floor(cursor / 2);
  }
  return { leaf: sorted[position], proof, root: tree.root };
}

export function verifyProof(leaf: Leaf, proof: readonly ProofStep[], root: string): boolean {
  let hash = leafHash(leaf);
  for (const step of proof) hash = step.side === "left" ? nodeHash(step.hash, hash) : nodeHash(hash, step.hash);
  return hash === root;
}

/* ------------------------------------------------------------------ *
 *  The log
 * ------------------------------------------------------------------ */

export type RosterEntryView = Readonly<{ slot: number; actorId: string; name: string; color: string }>;

export type GenesisEvent = Readonly<{
  stream: "match"; kind: "genesis"; at: number;
  roomId: string; tier: Tier; botCount: number; playerRole: Role; playerName: string; friendId: string;
  slotCount: number; roundSeconds: number; frameSeconds: number; frames: number;
  sponsor: string; supplyCents: number; passPriceCents: number;
  commitMatch: string; commitDrop: string; roster: readonly RosterEntryView[];
}>;

export type JoinEvent = Readonly<{
  stream: "match"; kind: "join"; at: number;
  slot: number; actorId: string; wallet: string; supplied: boolean;
  frames: number; actionsCommitment: string | null;
}>;

export type RunSealedEvent = Readonly<{
  stream: "match"; kind: "run-sealed"; at: number; slot: number; frames: number; actionsCommitment: string;
}>;

export type CloseEvent = Readonly<{
  stream: "match"; kind: "close"; at: number; revealSeedMatch: string;
  runs: readonly Readonly<{ slot: number; actionsHash: string; commitment: string; matches: boolean }>[];
}>;

export type SettleEvent = Readonly<{
  stream: "match"; kind: "settle"; at: number;
  seedDrop: string; stateHash: string; dropRoot: string; leaves: readonly Leaf[];
}>;

export type ClaimEvent = Readonly<{
  stream: "match"; kind: "claim"; at: number;
  slot: number; wallet: string; amountCents: number; root: string; proof: readonly ProofStep[]; verified: boolean;
}>;

export type DepositEvent = Readonly<{ stream: "economy"; kind: "deposit"; at: number; sponsor: string; amountCents: number }>;
export type PassPurchaseEvent = Readonly<{
  stream: "economy"; kind: "pass-purchase"; at: number; slot: number; wallet: string; priceCents: number;
}>;
export type CacheDrawEvent = Readonly<{
  stream: "economy"; kind: "cache-draw"; at: number; slot: number; wallet: string; passIndex: number;
  drip: DripId; label: string; rfCents: number; hiddenUntil: "settle";
}>;
export type MerkleRootEvent = Readonly<{
  stream: "economy"; kind: "merkle-root"; at: number; root: string; leaves: number; totalCents: number;
}>;
export type EconomyClaimEvent = Readonly<{
  stream: "economy"; kind: "claim"; at: number; slot: number; wallet: string; amountCents: number; root: string; verified: boolean;
}>;

export type MatchEventRecord = GenesisEvent | JoinEvent | RunSealedEvent | CloseEvent | SettleEvent | ClaimEvent;
export type EconomyEventRecord = DepositEvent | PassPurchaseEvent | CacheDrawEvent | MerkleRootEvent | EconomyClaimEvent;

export type SealedStream = {
  slot: number; frames: number; actionsCommitment: string;
  /** null until the close event reveals it */
  actions: PlayerInput[] | null;
  revealedAt: number | null;
};

export type RoomLog = {
  version: number; roomId: string; frameSeconds: number; frames: number;
  streams: { match: MatchEventRecord[]; economy: EconomyEventRecord[] };
  sealed: Record<string, SealedStream>;
};

/**
 * Stream discipline. `claim` is the ONE kind that legitimately appears in both
 * streams (the match stream records the event, the economy stream keeps the
 * ledger line); everything else belongs to exactly one stream.
 */
const MATCH_ONLY_KINDS = new Set(["genesis", "join", "run-sealed", "close", "settle"]);
const ECONOMY_ONLY_KINDS = new Set(["deposit", "pass-purchase", "cache-draw", "merkle-root"]);
const MATCH_KINDS = new Set([...MATCH_ONLY_KINDS, "claim"]);
const ECONOMY_KINDS = new Set([...ECONOMY_ONLY_KINDS, "claim"]);

export function matchEvents(log: RoomLog): MatchEventRecord[] { return log.streams.match; }
export function economyEvents(log: RoomLog): EconomyEventRecord[] { return log.streams.economy; }
export function eventsOfKind<K extends string>(events: readonly { kind: string }[], kind: K): readonly (any & { kind: K })[] {
  return events.filter(event => event.kind === kind) as readonly (any & { kind: K })[];
}
export function genesisOf(log: RoomLog): GenesisEvent {
  const found = eventsOfKind(log.streams.match, "genesis")[0];
  if (!found) throw new Error("log has no genesis event");
  return found;
}

/**
 * Structural verification of one log. Returns the list of problems; an empty
 * list means the log is well formed. This is what the tamper tests must trip.
 */
export function logProblems(log: RoomLog): string[] {
  const problems: string[] = [];
  if (log.version !== LOG_VERSION) problems.push(`version ${log.version} != ${LOG_VERSION}`);
  if (!(log.frameSeconds > 0)) problems.push("frameSeconds missing");
  if (!(log.frames > 0)) problems.push("frames missing");

  // Stream separation — a payout record must never ride in the gameplay stream.
  for (const event of log.streams.match) {
    if (!MATCH_KINDS.has(event.kind)) problems.push(`match stream carries a non-match event: ${event.kind}`);
    if (ECONOMY_ONLY_KINDS.has(event.kind)) problems.push(`match stream carries a payout-only event: ${event.kind}`);
  }
  for (const event of log.streams.economy) {
    if (!ECONOMY_KINDS.has(event.kind)) problems.push(`economy stream carries a non-economy event: ${event.kind}`);
    if (MATCH_ONLY_KINDS.has(event.kind)) problems.push(`economy stream carries a gameplay-only event: ${event.kind}`);
  }

  const genesis = eventsOfKind(log.streams.match, "genesis")[0];
  if (!genesis) { problems.push("no genesis event"); return problems; }
  if (genesis.slotCount !== SLOT_COUNT) problems.push(`slotCount ${genesis.slotCount} != ${SLOT_COUNT}`);
  if (!genesis.commitMatch || !genesis.commitDrop) problems.push("genesis is missing a commitment");
  if (genesis.roster.length !== SLOT_COUNT) problems.push(`roster has ${genesis.roster.length} entries, expected ${SLOT_COUNT}`);
  if (genesis.frames !== log.frames || genesis.frameSeconds !== log.frameSeconds) problems.push("genesis frames/frameSeconds disagree with the log");

  const joins = eventsOfKind(log.streams.match, "join");
  if (joins.length !== SLOT_COUNT) problems.push(`${joins.length} join events, expected ${SLOT_COUNT}`);
  const slots = new Set(joins.map(join => join.slot));
  if (slots.size !== joins.length) problems.push("two joins claim the same slot");
  const wallets = new Set(joins.map(join => join.wallet));
  if (wallets.size !== joins.length) problems.push("two joins claim the same wallet");
  for (const join of joins) {
    if (join.supplied && !join.actionsCommitment) problems.push(`slot ${join.slot} is supplied but sealed nothing`);
    if (!join.supplied && join.actionsCommitment) problems.push(`slot ${join.slot} is a no-show but sealed something`);
    if (join.supplied && join.frames !== genesis.frames) problems.push(`slot ${join.slot} sealed ${join.frames} frames, expected ${genesis.frames}`);
  }

  const sealedSlots = Object.keys(log.sealed);
  const supplied = joins.filter(join => join.supplied);
  if (sealedSlots.length !== supplied.length) problems.push(`${sealedSlots.length} sealed streams for ${supplied.length} supplied slots`);
  for (const join of supplied) {
    const sealed = log.sealed[String(join.slot)];
    if (!sealed) { problems.push(`no sealed stream for supplied slot ${join.slot}`); continue; }
    if (sealed.actionsCommitment !== join.actionsCommitment) problems.push(`sealed stream ${join.slot} does not match the join commitment`);
    if (sealed.actions && actionsDigest(sealed.actions) !== sealed.actionsCommitment) problems.push(`revealed stream ${join.slot} does not match its commitment`);
  }

  const closes = eventsOfKind(log.streams.match, "close");
  if (closes.length !== 1) problems.push(`${closes.length} close events, expected 1`);
  else if (commitMatchSeed(closes[0].revealSeedMatch) !== genesis.commitMatch) problems.push("close reveal does not open the genesis match commitment");

  const settles = eventsOfKind(log.streams.match, "settle");
  if (settles.length !== 1) problems.push(`${settles.length} settle events, expected 1`);
  else {
    const settle = settles[0];
    if (commitDropSeed(settle.seedDrop) !== genesis.commitDrop) problems.push("settle reveal does not open the genesis drop commitment");
    if (settle.leaves.length !== SLOT_COUNT) problems.push(`settle covers ${settle.leaves.length} leaves, expected ${SLOT_COUNT}`);
    if (buildTree(settle.leaves).root !== settle.dropRoot) problems.push("published dropRoot is not the tree over the published leaves");
  }

  // The drip layer, checked against the only thing allowed to produce it.
  const draws = eventsOfKind(log.streams.economy, "cache-draw");
  const seen = new Set<string>();
  for (const draw of draws) {
    const key = `${draw.slot}:${draw.passIndex}`;
    if (seen.has(key)) problems.push(`cache draw reused (slot ${draw.slot}, passIndex ${draw.passIndex})`);
    seen.add(key);
    const join = joins.find(entry => entry.slot === draw.slot);
    if (!join) problems.push(`cache draw for slot ${draw.slot} has no join`);
    else if (join.wallet !== draw.wallet) problems.push(`cache draw for slot ${draw.slot} names a different wallet`);
    if (draw.hiddenUntil !== "settle") problems.push(`cache draw ${key} is not marked hidden until settle`);
  }
  for (const join of joins) {
    const own = draws.filter(draw => draw.slot === join.slot);
    if (own.length === 0) problems.push(`joined slot ${join.slot} holds no cache`);
  }

  const roots = eventsOfKind(log.streams.economy, "merkle-root");
  if (roots.length !== 1) problems.push(`${roots.length} merkle-root events, expected 1`);
  else if (settles.length === 1 && roots[0].root !== settles[0].dropRoot) problems.push("economy root and settle root disagree");

  // The settle leaves are the drawn caches summed per wallet — nothing else.
  if (settles.length === 1) {
    for (const join of joins) {
      const owed = draws.filter(draw => draw.slot === join.slot).reduce((sum, draw) => sum + draw.rfCents, 0);
      const leaf = settles[0].leaves.find(entry => entry.wallet === join.wallet);
      if (!leaf) problems.push(`settle has no leaf for slot ${join.slot}`);
      else if (leaf.amountCents !== owed) problems.push(`settle leaf for slot ${join.slot} is ${leaf.amountCents}c, the drawn caches add to ${owed}c`);
    }
  }

  if (settles.length === 1) {
    for (const claim of eventsOfKind(log.streams.economy, "claim")) {
      const leaf = settles[0].leaves.find(entry => entry.wallet === claim.wallet);
      if (!leaf) { problems.push(`claim from ${claim.wallet} has no entitlement`); continue; }
      if (claim.amountCents !== leaf.amountCents) problems.push(`claim for ${claim.wallet} asks ${claim.amountCents}, owed ${leaf.amountCents}`);
      if (claim.root !== settles[0].dropRoot) problems.push(`claim for ${claim.wallet} targets a different root`);
    }
    for (const claim of eventsOfKind(log.streams.match, "claim")) {
      if (!verifyProof({ wallet: claim.wallet, amountCents: claim.amountCents }, claim.proof, claim.root)) {
        problems.push(`claim proof for ${claim.wallet} does not verify against its root`);
      }
    }
  }
  return problems;
}

/**
 * The view a reader has at settlement but NOT at close: the drip layer is
 * public (the cache draws and the seedDrop that produced them), the run streams
 * are hashes, and seedMatch is still sealed. The separation check attacks
 * exactly this object — the most an attacker can have before close.
 *
 * (The published state hash is part of the settlement too. It binds the roles,
 * but it is a hash of a fold over action streams that are still sealed, so it
 * cannot be recomputed — let alone inverted — before close.)
 */
export function publishedView(log: RoomLog): unknown {
  const genesis = eventsOfKind(log.streams.match, "genesis")[0] ?? null;
  const settle = eventsOfKind(log.streams.match, "settle")[0] ?? null;
  return {
    roomId: log.roomId,
    frameSeconds: log.frameSeconds,
    frames: log.frames,
    genesis,
    joins: eventsOfKind(log.streams.match, "join").map(join => ({ ...join, actions: "[sealed]" })),
    sealedCommitments: Object.values(log.sealed).map(sealed => ({ slot: sealed.slot, actionsCommitment: sealed.actionsCommitment })),
    close: "[sealed until close — seedMatch and the action streams live here]",
    settle,
    economy: log.streams.economy,
  };
}
