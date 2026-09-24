/**
 * WITNESSED KILL PROBE — can a bot kill be seen by the player at all?
 *
 * sim.ts only pushes its `kill` event when the player stood inside the sight
 * radius of the killer at the instant of the kill (the same event index.tsx
 * turns into the toast and the one frame a live round may show the impostor's
 * true form). While WITNESS_RADIUS and BOT_KILL_SAFE_RADIUS were both 220 that
 * event was unreachable: a bot only kills when every third actor is further than
 * 220 away, so the player could never be inside 220 of the killer, and the
 * recorded kill event could never fire in a real round.
 *
 * This probe drives whole rounds of the real simulation (seeded, headless, no
 * DOM, no browser) with a scripted MOBILE player — a crewmate who walks the
 * station's own rooms, because a player who never moves is not a round — and
 * reports every kill the sim announces as witnessed, with the geometry that made
 * it witnessed:
 *
 *   · the distance from the player to the killer and to the victim when the event
 *     fired, against `visionRadius(state)` — the fog the renderer paints, so
 *     "witnessed" can never mean more than "could be seen";
 *   · the smallest distance from any OTHER live actor to the killer and to the
 *     victim, which must stay outside BOT_KILL_SAFE_RADIUS = 220: the proof the
 *     kill was a real bot kill obeying the same lethality rule as before, and not
 *     a probe that moved the bots.
 *
 * Every death is reported, witnessed or not, with the player's distance from the
 * killer at that instant — so the run shows what the player was usually doing
 * when a kill landed, not only the round that succeeded.
 *
 * Assertions: at least one witnessed kill inside the rounds driven; the killer is
 * a bot and not the player; the player was alive and inside the sight radius;
 * every third actor was outside the safe radius of both killer and victim.
 *
 *   ./node_modules/.bin/esbuild games/impostor-protocol/tests/witness-kill-probe.ts \
 *     --bundle --format=esm --platform=node --outfile=/tmp/witness-kill-probe.mjs \
 *     && node /tmp/witness-kill-probe.mjs
 */
import assert from "node:assert/strict";

import { createMatch, visionRadius } from "../src/sim";
import { HUBS } from "../src/station";
import type { Actor, Match, MatchEvent, PlayerInput, Vec } from "../src/types";

const IDLE: PlayerInput = { up: false, down: false, left: false, right: false, destination: null };
/** sim.ts MATCH_LIMIT_SECONDS: a round cannot outlive this, in simulation time. */
const MATCH_LIMIT = 420;
const STEP = 1 / 60;
const MAX_FRAMES = Math.ceil((MATCH_LIMIT + 5) / STEP);
/** The number this probe exists to pin: sim.ts BOT_KILL_SAFE_RADIUS, unchanged. */
const BOT_KILL_SAFE_RADIUS = 220;
/** sim.ts KILL_RANGE — the reach a killer must have on its victim. */
const KILL_RANGE = 62;
/** How many seeds to drive at most; the run stops at the first witnessed kill. */
const ROUNDS = 40;
/** Room hubs, in the station's own order — the rooms a player walks between. */
const ROOMS: Vec[] = Object.entries(HUBS).filter(([id]) => !id.startsWith("corridor")).map(([, pos]) => pos);
/** Plain, fixed room codes — the seeds a player would type. */
const SEEDS = Array.from({ length: ROUNDS }, (_, index) => 1000 + index * 37);

const distance = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
const round = (value: number): number => Math.round(value * 10) / 10;

type Kill = Readonly<{
  seed: number; round: number; seconds: number; text: string;
  killer: string; victim: string; killerIsBot: boolean; victimIsPlayer: boolean;
  playerAlive: boolean; playerToKiller: number | null; playerToVictim: number;
  sight: number; thirdToKiller: number | null; thirdToVictim: number | null; thirdActor: string;
  sabotage: string; witnessed: boolean;
}>;

/** The third actor closest to either end of the kill, or null if there is none. */
function nearestThird(state: { actors: Actor[] }, killer: Actor | null, victim: Actor) {
  let best: { actor: Actor; toKiller: number | null; toVictim: number } | null = null;
  for (const actor of state.actors) {
    if (actor === killer || actor === victim || !actor.alive) continue;
    const toKiller = killer ? distance(actor.pos, killer.pos) : null;
    const toVictim = distance(actor.pos, victim.pos);
    if (!best || Math.max(toKiller ?? 0, toVictim) < Math.max(best.toKiller ?? 0, best.toVictim)) {
      best = { actor, toKiller, toVictim };
    }
  }
  return best;
}

/**
 * The scripted player: walks the room hubs in a fixed order, re-targeting on
 * arrival, on a stalled walk, or after the room budget. Deterministic from the
 * seed, so a seed reproduces the same round for anyone who runs it.
 */
function walking(seed: number) {
  const order = ROOMS.map((_, index) => ROOMS[(index + seed) % ROOMS.length]);
  let index = 0, target = order[0], since = 0, idleFor = 0, last = { x: 0, y: 0 };
  return (state: { actors: Actor[] }, dt: number): PlayerInput => {
    const me = state.actors.find(actor => actor.isPlayer);
    if (!me) return IDLE;
    since += dt;
    idleFor = distance(me.pos, last) < 0.5 ? idleFor + dt : 0;
    last = { x: me.pos.x, y: me.pos.y };
    if (distance(me.pos, target) < 40 || since > 14 || idleFor > 2.5) {
      index = (index + 1) % order.length;
      target = order[index];
      since = 0;
      idleFor = 0;
    }
    return { ...IDLE, destination: target };
  };
}

/** One round of the real sim, driven with the scripted player, watching for kills. */
function drive(seed: number, index: number) {
  const match: Match = createMatch({
    seed, tier: "standard", playerRole: "crew", botCount: 6, playerName: "Ferra", friendId: "42",
  });
  const state = match.state;
  match.advance();
  const input = walking(seed);
  const kills: Kill[] = [];

  for (let frame = 0; frame < MAX_FRAMES; frame++) {
    const aliveBefore = state.actors.filter(actor => actor.alive).map(actor => actor.id);
    const wasPlay = state.phase === "play";
    match.update(STEP, input(state, STEP));
    const events: MatchEvent[] = match.drainEvents();
    const kill = events.find(event => event.kind === "kill");
    // Whoever stops being alive during a play frame was killed.
    const dead = wasPlay ? state.actors.find(actor => !actor.alive && aliveBefore.includes(actor.id)) : undefined;

    if (dead) {
      // The killer is the impostor standing inside KILL_RANGE of the victim: the
      // sim's own reach, so an unwitnessed death is measured the same way.
      const killer = state.actors.find(actor => actor.alive && actor.role === "impostor"
        && distance(actor.pos, dead.pos) <= KILL_RANGE) ?? null;
      const player = state.actors.find(actor => actor.isPlayer);
      assert(player, `seed ${seed}: the round has no player actor`);
      const third = nearestThird(state, killer, dead);
      kills.push({
        seed, round: index + 1, seconds: state.time,
        text: `${killer ? killer.name : "unknown"} eliminated ${dead.name}`,
        killer: killer ? killer.name : "unknown", victim: dead.name,
        killerIsBot: !!killer && !killer.isPlayer, victimIsPlayer: dead.isPlayer,
        playerAlive: player.alive || dead.isPlayer,
        playerToKiller: killer ? round(distance(player.pos, killer.pos)) : null,
        playerToVictim: round(distance(player.pos, dead.pos)),
        sight: visionRadius(state),
        thirdToKiller: third && third.toKiller !== null ? round(third.toKiller) : null,
        thirdToVictim: third ? round(third.toVictim) : null,
        thirdActor: third ? third.actor.name : "none",
        sabotage: state.sabotage,
        witnessed: !!kill,
      });
      // The kill event is the whole point of the probe.
      if (kill) return { kills, seconds: state.time, phase: state.phase, witnessed: true };
    } else if (kill) {
      // An announced kill with nobody dying would be a phantom witness.
      assert.fail(`seed ${seed}: the sim announced "${kill.text}" with nobody dying`);
    }
    // The ejection screen waits for a tap; two of them end the match.
    if (state.phase === "ejection") match.advance();
    if (state.phase === "over" || state.summary) break;
  }
  return { kills, seconds: state.time, phase: state.phase, witnessed: false };
}

const nominal = createMatch({ seed: 1, tier: "standard", playerRole: "crew", botCount: 6, playerName: "Ferra", friendId: "42" });
const sightNominal = visionRadius(nominal.state);
nominal.state.sabotage = "lights";
const sightDark = visionRadius(nominal.state);
console.log(`\nwitnessed-kill probe — up to ${SEEDS.length} seeded rounds, scripted crew player, 6 bots, ${ROOMS.length} rooms`);
console.log(`  sight radius: ${sightNominal}u normally, ${sightDark}u with the lights down\n`);

const witnessed: Kill[] = [];
const allKills: Kill[] = [];
let totalSeconds = 0;
let driven = 0;

for (let index = 0; index < SEEDS.length; index++) {
  const seed = SEEDS[index];
  const result = drive(seed, index);
  totalSeconds += result.seconds;
  driven++;
  allKills.push(...result.kills);
  witnessed.push(...result.kills.filter(kill => kill.witnessed));
  const detail = result.kills.map(kill => `${kill.killer}→${kill.victim}@${kill.seconds.toFixed(0)}s`
    + `(player ${kill.playerToKiller}u${kill.witnessed ? ", WITNESSED" : ""})`).join(" ");
  console.log(`  round ${index + 1} · seed ${seed}: t=${result.seconds.toFixed(1)}s, ended ${result.phase},`
    + ` ${result.kills.length} kill(s)${detail ? ": " + detail : ""}`);
  if (witnessed.length > 0) break;
}

console.log(`\n  rounds driven: ${driven} · ${totalSeconds.toFixed(1)}s of simulation (${(totalSeconds / 60).toFixed(1)} min)`
  + ` · ${allKills.length} bot kill(s) recorded, ${witnessed.length} witnessed`);
if (witnessed.length === 0) {
  throw new Error("witnessed-kill probe FAILED — no bot kill was witnessed in any round driven");
}

const first = witnessed[0];
console.log(`  first witnessed kill: seed ${first.seed}, round ${first.round}, at t=${first.seconds.toFixed(1)}s of play`);
console.log(`  "${first.text}" — killer ${first.killer} (${first.killerIsBot ? "bot" : "player"}), victim ${first.victim},`
  + ` player ${first.playerAlive ? "alive" : "down"}, sabotage ${first.sabotage}`);
console.log("  distances at the moment the event fired:");
console.log(`    player → killer ${first.playerToKiller}u   (sight radius ${first.sight}u)`);
console.log(`    player → victim ${first.playerToVictim}u`);
console.log(`    nearest third actor (${first.thirdActor}) → killer ${first.thirdToKiller}u · → victim ${first.thirdToVictim}u`
  + `   (bot safe radius ${BOT_KILL_SAFE_RADIUS}u)`);

for (const row of witnessed) {
  assert(row.killerIsBot, `seed ${row.seed}: the kill was not a bot kill`);
  assert(row.playerAlive, `seed ${row.seed}: the player was already down, so nothing was witnessed`);
  assert(row.playerToKiller !== null && row.playerToKiller <= row.sight,
    `seed ${row.seed}: the killer stood ${row.playerToKiller}u away, outside the ${row.sight}u the player can see`);
  assert(row.playerToKiller > BOT_KILL_SAFE_RADIUS,
    `seed ${row.seed}: a witnessed kill inside the safe radius would mean the bots changed`);
  assert((row.thirdToKiller ?? Infinity) >= BOT_KILL_SAFE_RADIUS && (row.thirdToVictim ?? Infinity) >= BOT_KILL_SAFE_RADIUS,
    `seed ${row.seed}: a third actor stood inside BOT_KILL_SAFE_RADIUS — the kill should not have happened`);
}

console.log(`\n  ${witnessed.length} witnessed kill(s) in ${driven} round(s): every witness inside the ${first.sight}u sight radius,`
  + ` every third actor outside the ${BOT_KILL_SAFE_RADIUS}u bot kill safe radius.`);
console.log("witnessed-kill probe passed\n");
