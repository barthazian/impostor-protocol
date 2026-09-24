"use client";

/**
 * Rare Friends: Impostor Protocol — the injected game component.
 *
 * The SDK runtime owns wallet connection, Friend selection, the fresh
 * ownership gate, the sandbox frame and every confirmation. This component
 * owns only the game: one social-deduction round against AI crewmates, and the
 * simulated tournament economy built on the SDK's fixed action client.
 *
 * Economy: a Tournament Pass (see game.json) is the consumable. `play` spends a
 * pass and creates one pending play; `settle` opens that Reward Cache with the
 * platform's weighted roll; `redeem` sells held salvage back for its exact RF
 * value. Practice runs use no economy action at all.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { GameComponentProps } from "@rarefriends/friendsdk/runtime";
import { createFriendReader, type GenerationSprites } from "@rarefriends/friendsdk/sprites";
import { createFriendSoundKit, type FriendSoundCue, type FriendSoundKit } from "@rarefriends/friendsdk/sounds";
import { RF, type GamePlay, type GameSnapshot } from "@rarefriends/friendsdk/game";
import {
  CREW_COLORS, type ActorId, type CrewColorId, type Match, type MatchConfig, type MatchEvent,
  type PlayerInput, type Role, type Tier,
} from "./src/types";
import { createMatch, createRoster, playerColorFor, sabotageLabel, visionRadius } from "./src/sim";
import { VIEW_HEIGHT, VIEW_WIDTH, createRenderer, type Renderer } from "./src/render";
import { crewArtDiagnostics, haloKept, loadCrewArt, revealImpostorIds, type CrewArt } from "./src/crew-art";
import TaskOverlay, { type TaskCue } from "./src/tasks";
import { Briefing, Debrief, Ejection, Hud, Lobby, Locker, Meeting, Settings, TaskList } from "./src/ui";
import type { CacheOffer, CosmeticRow, InventoryRow, RosterEntry } from "./src/screens";
import { createRoomCode, createRng, hashSeed, normalizeRoomCode } from "./src/rng";
import "./style.css";

const BOTS = 6;
/**
 * How long the killer's true form stays on screen after a kill the player caused
 * or literally watched. It is the one mid-round reveal, and it is a beat, not a
 * status: long enough to be seen, short enough that it is over before the next
 * decision.
 */
const KILL_FLASH_MS = 4000;
const EMPTY_INPUT: PlayerInput = Object.freeze({ up: false, down: false, left: false, right: false, destination: null });
const TIER_PASSES: Readonly<Record<Tier, bigint>> = Object.freeze({ practice: 0n, standard: 1n, elite: 3n });

/** Session-only suit catalogue. Bought with Salvage Points, which are earned by playing. */
const SUITS: readonly { id: string; name: string; hex: string; cost: number }[] = Object.freeze([
  { id: "signal", name: "Signal Suit", hex: "#ccff00", cost: 0 },
  { id: "cyan", name: "Cryo Suit", hex: CREW_COLORS.cyan, cost: 60 },
  { id: "pink", name: "Coral Suit", hex: CREW_COLORS.pink, cost: 90 },
  { id: "purple", name: "Nebula Suit", hex: CREW_COLORS.purple, cost: 120 },
  { id: "gold", name: "Sunflare Suit", hex: "#ffd166", cost: 200 },
]);

type Overlay = "none" | "task" | "tasklist" | "locker" | "settings";
type Screen = "lobby" | "match";

const reason = (cause: unknown, fallback: string) => cause instanceof Error && cause.message ? cause.message : fallback;

export default function ImpostorProtocol({ friendId, client, paused }: GameComponentProps): JSX.Element {
  const definition = client.definition;
  const simulated = client.mode === "preview";

  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [sprites, setSprites] = useState<GenerationSprites | null>(null);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);

  const [screen, setScreen] = useState<Screen>("lobby");
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [match, setMatch] = useState<Match | null>(null);
  const [crewArt, setCrewArt] = useState<CrewArt | null>(null);
  const [tier, setTier] = useState<Tier>("practice");
  const [roomCode, setRoomCode] = useState(() => createRoomCode());
  const [roleChoice, setRoleChoice] = useState<Role | "random">("random");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [toast, setToast] = useState("");
  const [muted, setMuted] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);

  const [salvage, setSalvage] = useState(0);
  const [ownedSuits, setOwnedSuits] = useState<readonly string[]>(["signal"]);
  const [equipped, setEquipped] = useState("signal");
  const [bestStars, setBestStars] = useState(0);
  const [rank, setRank] = useState("Recruit");
  const [hudTick, setHudTick] = useState(0);

  const canvas = useRef<HTMLCanvasElement>(null);
  const matchRef = useRef<Match | null>(null);
  const renderer = useRef<Renderer | null>(null);
  const sound = useRef<FriendSoundKit | null>(null);
  const input = useRef<PlayerInput>({ ...EMPTY_INPUT });
  const awarded = useRef<Set<unknown>>(new Set());
  const suitHex = (SUITS.find(suit => suit.id === equipped) ?? SUITS[0]).hex;
  const color = useRef(suitHex);
  color.current = suitHex;
  const live = useRef({ paused, overlay, reducedMotion });
  live.current = { paused, overlay, reducedMotion };
  // The round's crew artwork, mirrored into a ref so the render loop can read the
  // newest value without being torn down and rebuilt when it lands (which would
  // reset the camera mid-round).
  const crewArtRef = useRef<CrewArt | null>(null);
  crewArtRef.current = crewArt;
  // A kill the player caused or literally watched is the only moment a live round
  // may show the impostor's true form; the sim announces it only when the killer
  // stood inside the player's witness radius.
  const killFlash = useRef<{ actorId: ActorId; until: number } | null>(null);
  // What the last painted frame was allowed to treat — empty in every live state.
  const revealedRef = useRef<readonly ActorId[]>([]);
  // What the round-start artwork read cost, for the diagnostics hook.
  const roundStartMs = useRef(0);

  /* ---------------------------------------------------------------- loading */

  useEffect(() => {
    let alive = true;
    setLoadError("");
    sound.current = createFriendSoundKit({ muted: true });
    void Promise.all([createFriendReader().read(friendId), client.read()])
      .then(([artwork, value]) => {
        if (!alive) return;
        if (value.friendId !== friendId) throw new Error("This session does not match the selected Friend.");
        setSprites(artwork);
        setSnapshot(value);
      })
      .catch(cause => { if (alive) setLoadError(reason(cause, "The station or your Friend's artwork could not load.")); });
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => {
      alive = false;
      preference.removeEventListener("change", update);
      sound.current?.dispose();
      sound.current = null;
    };
  }, [client, friendId, attempt]);

  const refresh = useCallback(async () => {
    const value = await client.read();
    setSnapshot(value);
    return value;
  }, [client]);

  const playCue = useCallback((cue: FriendSoundCue) => {
    void sound.current?.unlock();
    sound.current?.play(cue);
  }, []);

  /* ---------------------------------------------------------------- economy */

  const inventory: InventoryRow[] = useMemo(
    () => definition.outcomes.map((outcome, index) => ({
      outcomeId: index + 1, name: outcome.name, reward: outcome.reward,
      chanceBps: outcome.chanceBps, count: snapshot?.inventory[index] ?? 0n,
    })),
    [definition, snapshot],
  );

  const caches: CacheOffer[] = useMemo(() => (snapshot?.plays ?? []).map(play => {
    const outcome = play.outcomeId === null ? null : definition.outcomes[play.outcomeId - 1];
    return { playId: play.id, opened: play.outcomeId !== null, outcomeId: play.outcomeId,
      name: outcome?.name ?? "Unopened cache", reward: outcome?.reward ?? 0n, chanceBps: outcome?.chanceBps ?? 0 };
  }), [definition, snapshot]);

  const cosmetics: CosmeticRow[] = useMemo(
    () => SUITS.map(suit => ({ id: suit.id, name: suit.name, cost: suit.cost,
      owned: ownedSuits.includes(suit.id), equipped: equipped === suit.id, color: suit.hex })),
    [ownedSuits, equipped],
  );

  async function act(work: () => Promise<void>, fallback: string) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await work(); }
    catch (cause) { setError(reason(cause, fallback)); }
    finally { setBusy(false); }
  }

  const openCache = (playId: bigint) => act(async () => {
    const play: GamePlay = await client.settle(playId);
    const outcome = play.outcomeId === null ? null : definition.outcomes[play.outcomeId - 1];
    if (outcome) {
      playCue(outcome.reward >= 5n * RF ? "reveal-legendary" : outcome.reward >= RF ? "reveal-rare" : "reveal-common");
      setMessage(`Reward Cache opened: ${outcome.name} · ${outcome.chanceBps / 100}% chance.`);
    }
    await refresh();
  }, "The cache could not be opened.");

  const redeem = (outcomeId: number) => act(async () => {
    await client.redeem(outcomeId, 1n);
    playCue("reward");
    setMessage("Salvage sold back to the station ledger at its fixed RF value.");
    await refresh();
  }, "That salvage could not be redeemed.");

  /* ------------------------------------------------------------------ match */

  const start = () => act(async () => {
    const resolved: Role | "random" = tier === "practice" ? roleChoice : "random";
    const seed = hashSeed(roomCode);
    const role: Role = resolved === "random"
      ? (createRng(seed ^ 0x5f3a71).next() < 0.35 ? "impostor" : "crew")
      : resolved;
    const passes = TIER_PASSES[tier];
    if (passes > 0n) {
      const current = snapshot ?? await refresh();
      if (current.consumables < passes) await client.buy(passes - current.consumables);
      await client.play(passes);
      playCue("purchase");
    } else {
      playCue("select");
    }
    const config: MatchConfig = { seed, tier, playerRole: role, botCount: BOTS,
      playerName: "You", friendId: friendId.toString() };
    const created = createMatch(config);
    // The NPC crewmates are real Friends, so their own tokens are read from the
    // chain before the first painted frame — the station never opens on a stand-in.
    // `loadCrewArt` never rejects: a token that fails is drawn from the PLAYER's own
    // canonical mask at a hue of its own and flagged in the diagnostics, so the
    // station shows fewer distinct Friends rather than an invented one. If the whole
    // call throws anyway, we still board instead of refusing to start a round.
    const readingStarted = performance.now();
    let art: CrewArt | null = null;
    if (sprites) {
      try {
        art = await loadCrewArt({ seed, actors: created.state.actors, playerSprites: sprites, playerTokenId: friendId });
      } catch { art = null; }
    }
    roundStartMs.current = Math.round(performance.now() - readingStarted);
    setCrewArt(art);
    awarded.current.clear();
    matchRef.current = created;
    setMatch(created);
    setScreen("match");
    setOverlay("none");
    setToast("");
    await refresh();
  }, "The match could not start.");

  const leaveMatch = () => {
    matchRef.current = null;
    killFlash.current = null;
    revealedRef.current = [];
    setCrewArt(null);
    setMatch(null);
    setScreen("lobby");
    setOverlay("none");
  };

  // The Airlock roster must use the same seed and player colour the match will,
  // so the crew you meet in the lobby is the crew you board with.
  const roster = useMemo<RosterEntry[]>(() => {
    const seed = match ? match.state.config.seed : hashSeed(roomCode);
    return createRoster({ seed, botCount: BOTS, playerName: "You", playerColor: playerColorFor(seed) });
  }, [match, roomCode]);

  // Salvage Points and rank are awarded once per finished match. The engine
  // builds the summary object exactly once, so its identity is the guard.
  const summary = match?.state.summary ?? null;
  useEffect(() => {
    if (!summary || awarded.current.has(summary)) return;
    awarded.current.add(summary);
    setSalvage(value => value + summary.salvagePoints);
    setBestStars(value => Math.max(value, summary.stars));
    setRank(summary.rank);
    playCue(summary.playerWon ? "reveal-legendary" : "reveal-common");
  }, [summary, playCue]);

  /* ----------------------------------------------------------- render loop */

  useEffect(() => {
    if (!match || !sprites) return;
    const node = canvas.current;
    if (!node) return;
    const painter = createRenderer(node);
    renderer.current = painter;
    let frame = 0, previous = 0;

    const loop = (now: number) => {
      const dt = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
      previous = now;
      const state = match.state;
      const blocked = live.current.paused || live.current.overlay !== "none";
      if (!live.current.paused) match.update(dt, blocked ? EMPTY_INPUT : input.current);
      if (blocked) input.current = { ...EMPTY_INPUT };
      const events = match.drainEvents();
      if (events.length) {
        const last = events[events.length - 1];
        setToast(last.text);
        const cue = cueFor(last);
        if (cue) sound.current?.play(cue);
        // A kill the player caused or watched. The sim only announces one when the
        // killer stood inside the player's witness radius, so flashing on this event
        // is exactly "the player already knows", and never a free tell.
        for (const event of events) {
          if (event.kind === "kill" && event.actorId) {
            killFlash.current = { actorId: event.actorId, until: now + KILL_FLASH_MS };
          }
        }
      }
      // Who may wear the treated impostor frame this instant. In play, in meetings
      // and on the minimap this is empty, so the impostor is drawn from the same
      // canonical frames, at the same tint, as every crewmate — the game is deducing
      // who they are. It fills only once the answer is public.
      const revealed = revealImpostorIds(state, killFlash.current, now);
      revealedRef.current = revealed;
      painter.paint(state, {
        playerSprites: sprites, playerColor: color.current, crewArt: crewArtRef.current, revealed,
        visionRadius: visionRadius(state), reducedMotion: live.current.reducedMotion,
        time: now, showMinimap: true,
      });
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    const clear = () => { input.current = { ...EMPTY_INPUT }; };
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
      renderer.current = null;
    };
  }, [match, sprites]);

  /**
   * Read-only introspection for the automated checks: which token each actor's
   * pixels came from, who the last frame was allowed to treat, and — the point of
   * it — the actor's own blit read back out of the framebuffer, so a check can
   * compare what is on screen with the chain's recorded frames instead of taking
   * this game's word for it. No player action and no drawing code reads any of it.
   */
  useEffect(() => {
    const host = window as unknown as { __ipImpostorProtocol?: unknown };
    host.__ipImpostorProtocol = {
      crewArt: () => { const art = crewArtRef.current; return art ? crewArtDiagnostics(art, friendId) : null; },
      roundStartMs: () => roundStartMs.current,
      revealed: () => revealedRef.current,
      phase: () => matchRef.current?.state.phase ?? null,
      actors: () => (matchRef.current?.state.actors ?? []).map(actor => ({
        id: actor.id, name: actor.name, role: actor.role, color: actor.color, alive: actor.alive,
        isPlayer: actor.isPlayer, x: Math.round(actor.pos.x), y: Math.round(actor.pos.y),
      })),
      blits: () => renderer.current?.diagnostics() ?? [],
      /**
       * One actor's last blit, measured off the canvas itself: the tint of every
       * cell that holds a mask pixel, and how much of the drawn halo actually
       * carries the halo colour. The silhouette comes from the framebuffer, not
       * from the blit record's arithmetic.
       */
      pixels: (actorId: string) => {
        const node = canvas.current;
        const entry = renderer.current?.diagnostics().find(blit => blit.id === actorId);
        if (!node || !entry) return null;
        const context = node.getContext("2d");
        if (!context) return null;
        const cssWidth = node.getBoundingClientRect().width;
        const scale = cssWidth > 0 ? node.width / cssWidth : 1;
        const left = Math.round(entry.left * scale), top = Math.round(entry.top * scale);
        const width = Math.round(80 * scale), height = Math.round(80 * scale);
        const data = context.getImageData(left, top, width, height).data;
        const sample = (x: number, y: number) => {
          const px = Math.min(width - 1, Math.max(0, Math.round((x + 0.5) * scale)));
          const py = Math.min(height - 1, Math.max(0, Math.round((y + 0.5) * scale)));
          const index = (py * width + px) * 4;
          return [data[index], data[index + 1], data[index + 2], data[index + 3]];
        };
        const rgb = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
        const tint = rgb(entry.tint), halo = rgb(entry.haloColor);
        const is = (pixel: readonly number[], colour: readonly number[]) => pixel[3] > 240
          && Math.abs(pixel[0] - colour[0]) + Math.abs(pixel[1] - colour[1]) + Math.abs(pixel[2] - colour[2]) <= 24;
        const rows = entry.rows.split("\n");
        const solid = (px: number, py: number) => px >= 0 && px < 16 && py >= 0 && py < 16 && rows[py]?.[px] === "#";
        let cells = "", solidCells = 0, tintCells = 0, orphanCells = 0, orphanHits = 0;
        for (let py = 0; py < 16; py++) {
          for (let px = 0; px < 16; px++) {
            if (solid(px, py)) {
              solidCells++;
              const hit = is(sample(px * 5 + 2, py * 5 + 2), tint);
              if (hit) tintCells++;
              cells += hit ? "T" : "?";
              continue;
            }
            // A ring cell with exactly one solid neighbour is covered by that
            // neighbour's halo box and nothing else, so it is the one place a kept
            // or dropped halo box can be told apart from the canvas.
            let neighbours = 0;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && solid(px + dx, py + dy)) neighbours++;
            }
            if (neighbours === 1) { orphanCells++; if (is(sample(px * 5 + 2, py * 5 + 2), halo)) orphanHits++; }
            cells += sample(px * 5 + 2, py * 5 + 2)[3] > 8 ? "·" : " ";
          }
        }
        return { id: entry.id, role: entry.role, isPlayer: entry.isPlayer, reversedRole: entry.reversedRole,
          tokenId: entry.tokenId, source: entry.source, tint: entry.tint, haloColor: entry.haloColor,
          rows: entry.rows, cells, solidCells, tintCells, orphanCells, orphanHits,
          maskPixels: entry.maskPixels, haloPixels: entry.haloPixels, haloIntact: entry.haloIntact,
          left: entry.left, top: entry.top, scale };
      },
    };
    return () => { delete host.__ipImpostorProtocol; };
  }, [friendId]);

  // The HUD re-renders a few times a second; the canvas is driven by the loop.
  useEffect(() => {
    if (!match) return;
    const timer = window.setInterval(() => setHudTick(value => value + 1), 125);
    return () => window.clearInterval(timer);
  }, [match]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // The ejection reveal is a real beat: the countdown is measured and the
  // simulation advances itself when it expires.
  const matchPhase = match?.state.phase ?? null;
  const [ejectionLeft, setEjectionLeft] = useState(4);
  useEffect(() => {
    if (!match || matchPhase !== "ejection") return;
    const started = performance.now();
    setEjectionLeft(4);
    const timer = window.setInterval(() => {
      const left = Math.max(0, 4 - (performance.now() - started) / 1000);
      setEjectionLeft(left);
      if (left <= 0) { window.clearInterval(timer); match.advance(); }
    }, 200);
    return () => window.clearInterval(timer);
  }, [match, matchPhase]);

  /* ------------------------------------------------------------------ input */

  const interact = useCallback(() => {
    const active = matchRef.current;
    if (!active || live.current.paused) return;
    const state = active.state;
    if (state.phase !== "play" || state.activeTask) return;
    if (!state.prompt) { setToast("Nothing within reach."); return; }
    active.interact();
    if (active.state.activeTask) setOverlay("task");
  }, []);

  useEffect(() => {
    function down(event: KeyboardEvent) {
      const active = matchRef.current;
      if (!active) return;
      const node = event.target as HTMLElement | null;
      const typing = node && (node.tagName === "INPUT" || node.tagName === "TEXTAREA");
      if (typing) return;
      const key = event.key.toLowerCase();
      if (key === "escape" && live.current.overlay !== "none") { setOverlay("none"); active.cancelTask(); return; }
      if (!live.current.paused && live.current.overlay === "none" && active.state.phase === "play") {
        if (key === "w" || key === "arrowup") { input.current = { ...input.current, up: true, destination: null }; event.preventDefault(); return; }
        if (key === "s" || key === "arrowdown") { input.current = { ...input.current, down: true, destination: null }; event.preventDefault(); return; }
        if (key === "a" || key === "arrowleft") { input.current = { ...input.current, left: true, destination: null }; event.preventDefault(); return; }
        if (key === "d" || key === "arrowright") { input.current = { ...input.current, right: true, destination: null }; event.preventDefault(); return; }
        if (key === "e") { interact(); event.preventDefault(); return; }
        if (key === "q") { active.ability(); return; }
        if (key === "r") { active.vent(); return; }
        if (key === "t") { setOverlay("tasklist"); return; }
      }
      if (key === "m") {
        setMuted(value => {
          const next = !value;
          sound.current?.setMuted(next);
          if (!next) void sound.current?.unlock();
          return next;
        });
      }
    }
    function up(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      if (key === "w" || key === "arrowup") input.current = { ...input.current, up: false };
      if (key === "s" || key === "arrowdown") input.current = { ...input.current, down: false };
      if (key === "a" || key === "arrowleft") input.current = { ...input.current, left: false };
      if (key === "d" || key === "arrowright") input.current = { ...input.current, right: false };
    }
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [interact]);

  /* ----------------------------------------------------------------- render */

  if (loadError) return <div className="ip-boot" role="alert"><h2>Impostor Protocol</h2><p>{loadError}</p>
    <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry station load</button></div>;
  if (!snapshot || !sprites) return <div className="ip-boot" role="status"><h2>Impostor Protocol</h2><p>Loading the station and your Friend…</p></div>;

  const state = match?.state ?? null;
  const impostorCount = state ? state.actors.filter(actor => actor.role === "impostor").length : 0;
  const meetingRemaining = state?.meeting ? Math.max(0, state.meeting.endsAt - state.time) : 0;

  if (screen === "lobby" || !state || !match) return (
    <section className="ip-root" aria-label={definition.name}>
      <Lobby
        friendId={friendId.toString()} stationName={state?.station.name ?? "RV-7 Salvage Ring"}
        tier={tier} onTier={next => { setTier(next); if (next !== "practice") setRoleChoice("random"); }}
        roomCode={roomCode} onRoomCode={value => setRoomCode(normalizeRoomCode(value))}
        onRandomRoom={() => setRoomCode(createRoomCode())}
        roleChoice={roleChoice} onRoleChoice={setRoleChoice}
        roster={roster} passes={snapshot.consumables} rfBalance={snapshot.rfBalance}
        freeStake={snapshot.freeStake} maxPrize={definition.outcomes.reduce((max, o) => o.reward > max ? o.reward : max, 0n)}
        price={definition.price} simulated={simulated} busy={busy} error={error} note={message}
        onStart={start} onLocker={() => setOverlay("locker")} onSettings={() => setOverlay("settings")}
        salvage={salvage} />
      {overlay === "locker" && <Locker
        inventory={inventory} salvage={salvage} rank={rank} bestStars={bestStars} cosmetics={cosmetics}
        onBuyCosmetic={id => {
          const suit = SUITS.find(value => value.id === id);
          if (!suit || ownedSuits.includes(id) || salvage < suit.cost) return;
          setSalvage(value => value - suit.cost);
          setOwnedSuits(value => [...value, id]);
          setEquipped(id);
          playCue("purchase");
        }}
        pending={caches.filter(cache => !cache.opened)} onOpenCache={openCache} onRedeem={redeem}
        onClose={() => setOverlay("none")} simulated={simulated} busy={busy} error={error} message={message} />}
      {overlay === "settings" && <Settings
        muted={muted} onMute={value => { setMuted(value); sound.current?.setMuted(value); if (!value) void sound.current?.unlock(); }}
        reducedMotion={reducedMotion} onReducedMotion={setReducedMotion}
        onClose={() => setOverlay("none")} mode={client.mode} />}
    </section>
  );

  return (
    <section className="ip-root" aria-label={definition.name} aria-busy={busy || undefined} data-hud={hudTick}>
      <div className="ip-stage">
        <canvas
          ref={canvas} width={VIEW_WIDTH} height={VIEW_HEIGHT}
          className="ip-canvas"
          aria-label="Station view. Move with WASD or arrow keys, or tap a destination. Press E at a console."
          onPointerDown={event => {
            if (paused || overlay !== "none" || state.phase !== "play") return;
            const node = event.currentTarget;
            const rect = node.getBoundingClientRect();
            const painter = renderer.current;
            if (!painter) return;
            input.current = { ...EMPTY_INPUT,
              destination: painter.screenToWorld(event.clientX, event.clientY,
                { left: rect.left, top: rect.top, width: rect.width, height: rect.height }) };
          }} />

        {(state.phase === "play" || state.phase === "meeting" || state.phase === "ejection") && (
          <Hud
            state={state} muted={muted}
            onToggleMute={() => { const next = !muted; setMuted(next); sound.current?.setMuted(next); if (!next) void sound.current?.unlock(); }}
            onMenu={() => setOverlay("settings")} onTaskList={() => setOverlay("tasklist")}
            onAbility={() => match.ability()} onVent={() => match.vent()}
            visionLabel={state.sabotage === "lights" ? "Lights out · short vision" : "Vision nominal"} />
        )}

        {state.phase === "play" && state.prompt && overlay === "none" && (
          <button type="button" className="ip-prompt" disabled={paused} onClick={interact}>
            <strong>{state.prompt.label}</strong><small>E / tap</small>
          </button>
        )}

        {state.alarm && state.phase === "play" && <p className="ip-alarm" role="alert">{state.alarm}</p>}
        {toast && overlay === "none" && state.phase === "play" && <p className="ip-toast" role="status">{toast}</p>}
        {busy && <p className="ip-busy" role="status">Waiting for the runtime confirmation…</p>}

        {state.phase === "briefing" && <Briefing
          state={state} roster={roster} impostorCount={impostorCount}
          onBegin={() => match.advance()} reducedMotion={reducedMotion} onReducedMotion={setReducedMotion} />}

        {state.phase === "meeting" && state.meeting && <Meeting
          state={state} roster={roster} remaining={meetingRemaining}
          localVotes={state.meeting.votes}
          onVote={target => { match.vote(target); playCue("select"); }} />}

        {state.phase === "ejection" && state.ejection && <Ejection
          ejection={state.ejection} remaining={Math.ceil(ejectionLeft)} onContinue={() => match.advance()} />}

        {state.phase === "over" && state.summary && <Debrief
          summary={state.summary} state={state}
          crewArt={crewArt} playerSprites={sprites} playerColor={color.current}
          caches={caches} onOpenCache={openCache}
          inventory={inventory} onRedeem={redeem}
          busy={busy} error={error} message={message}
          finishNote={simulated
            ? "Simulated preview: the cache rolls, balances and salvage are simulated. Live play would use the platform's contracts and a real RNG request."
            : "Live mode: cache opening requests the platform RNG and settles on chain."}
          onPlayAgain={leaveMatch} onLobby={leaveMatch} simulated={simulated} />}

        {overlay === "task" && state.activeTask && <TaskOverlay
          attempt={state.activeTask} reducedMotion={reducedMotion} soundEnabled={!muted}
          onResolve={(success, roll) => {
            const attemptId = state.activeTask?.stationId;
            setOverlay("none");
            if (attemptId) match.finishTask(attemptId, success, roll);
            setToast(success ? "Task complete." : "Task failed — try it again.");
          }}
          onCancel={() => { setOverlay("none"); match.cancelTask(); }}
          onCue={(cue: TaskCue) => playCue(cue === "ok" ? "action-ready" : cue === "fail" ? "impact" : "action-start")} />}

        {overlay === "tasklist" && <TaskList state={state} visible onClose={() => setOverlay("none")} />}
        {overlay === "settings" && <Settings
          muted={muted} onMute={value => { setMuted(value); sound.current?.setMuted(value); if (!value) void sound.current?.unlock(); }}
          reducedMotion={reducedMotion} onReducedMotion={setReducedMotion}
          onClose={() => setOverlay("none")} mode={client.mode} />}

        {overlay === "none" && state.phase === "play" && <button type="button" className="ip-leave" onClick={leaveMatch}>Leave station</button>}
      </div>
      <p className="ip-footer">
        {simulated ? "Simulated economy · " : "Live economy · "}
        {snapshot.consumables.toString()} Tournament Pass{snapshot.consumables === 1n ? "" : "es"} ·{" "}
        {sabotageLabel(state.sabotage)} · {tier} run · Room {roomCode}
      </p>
    </section>
  );
}

function cueFor(event: MatchEvent): FriendSoundCue | null {
  switch (event.kind) {
    case "kill": return "impact";
    case "report":
    case "meeting": return "anticipation";
    case "eject": return "impact";
    case "sabotage": return "action-start";
    case "sabotage-fixed": return "action-ready";
    case "task-done": return "action-ready";
    case "task-failed": return "reveal-common";
    case "vote": return "select";
    case "win": return "reveal-legendary";
    case "lose": return "reveal-common";
    default: return null;
  }
}
