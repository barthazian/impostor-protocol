/**
 * IMPOSTOR PROTOCOL — pure match simulation.
 *
 * Nothing in this file touches the DOM, React or the SDK: it is a deterministic
 * state machine over `MatchState`. `index.tsx` owns the clock and feeds
 * `update(dt, input)`; the renderer and the UI only read.
 *
 * ── Determinism ────────────────────────────────────────────────────────
 * Every random decision comes from a mulberry32 stream seeded through
 * hashSeed() off `config.seed`, so the same room code reproduces the same
 * match for anyone who types it. The streams are:
 *
 *   `<seed>:player-color`  the colour createMatch gives the player avatar
 *   `<seed>:roster`        bot names, colours and trait tags (createRoster)
 *   `<seed>:roles`         which bots drew impostor
 *   `<seed>:bots`          bot navigation, work and kill decisions
 *   `<seed>:tasks`         layout seed handed to each task minigame
 *   `<seed>:sabotage`      sabotage kind + 45..70s schedule
 *   `<seed>:meeting`       testimony lines
 *   `<seed>:votes`         bot votes and when they land
 *
 * Draws happen in a fixed order (actor order, zone-path order), never off
 * `Math.random` nor off wall-clock time, so two runs given the same seed and
 * the same scripted inputs produce byte-identical summaries.
 *
 * ── Lifecycle ─────────────────────────────────────────────────────────
 * briefing → (advance) → play ⇄ meeting → ejection → (advance) → play | over
 */

import type {
  Actor, ActorId, CrewColorId, Match, MatchConfig, MatchEvent, MatchEventKind, MatchState,
  MatchSummary, Meeting, PlayerInput, Role, SabotageKind, Vec, VoteTarget,
} from "./types";
import { CREW_COLORS } from "./types";
import type { RosterEntry } from "./screens";
import { createRng, hashSeed, type Rng } from "./rng";
import { ACTOR_RADIUS, CONSOLES, HUBS, STATION, ZONE_LINKS, isWalkable } from "./station";
import type { Console } from "./station";

/* ------------------------------------------------------------------ *
 *  Tuning                                                            *
 * ------------------------------------------------------------------ */

const PLAYER_SPEED = 155;
const BOT_SPEED = 120;
/** Longest frame the simulation will integrate; keeps collisions honest. */
const MAX_DT = 0.5;
/** Largest movement per collision query, so nothing tunnels through a wall. */
const MOVE_SUBSTEP = 6;
const KILL_RANGE = 62;
const PLAYER_KILL_COOLDOWN = 25;
const BOT_KILL_COOLDOWN = 28;
/** A bot impostor refuses to kill while any third actor is this close. */
const BOT_KILL_SAFE_RADIUS = 220;
/**
 * How far an actor can SEE a kill happen — the sight radius the renderer draws
 * the fog with (`visionRadius()` below) and the radius a kill is registered
 * from.
 *
 * It used to be 220, the very same number as BOT_KILL_SAFE_RADIUS: a bot only
 * kills while every third actor is further than 220 away, so a kill inside the
 * player's witness radius was geometrically impossible and the "kill" event
 * never fired in a real round. In a real round the impostor kills wherever it
 * can and any bystander close enough SEES it — the sight radius is not a rule
 * the bots obey. 400 is far enough out that an ordinary bot kill lands inside
 * it. BOT_KILL_SAFE_RADIUS is untouched: how lethal the bots are is unchanged.
 */
const WITNESS_RADIUS = 400;
/** Actors loitering this close to a body when it is found look suspicious. */
const BODY_SUSPICION_RADIUS = 260;
const INTERACT_RANGE = 70;
const VENT_RANGE = 40;
const VENT_MAX_SECONDS = 15;
const SABOTAGE_MIN_GAP = 45;
const SABOTAGE_MAX_GAP = 70;
const SABOTAGE_COUNTDOWN = 40;
const MEETING_TESTIMONY_SECONDS = 7;
const MEETING_VOTE_SECONDS = 20;
const MATCH_LIMIT_SECONDS = 420;
const BOT_TASKS = 5;
const BOT_FIRST_KILL_DELAY = 22;
const BOT_WORK_MIN = 3.5;
const BOT_WORK_MAX = 7.5;
const BOT_IDLE_MIN = 0.8;
const BOT_IDLE_MAX = 2.6;
const ZONE_ARRIVE = 16;
const GOAL_ARRIVE = 12;
const EVENT_CAP = 512;
const TASK_SEED_BOUND = 0x7fffffff;
const PLAYER_ID: ActorId = "player";

/* ------------------------------------------------------------------ *
 *  Roster                                                            *
 * ------------------------------------------------------------------ */

/** Canonical Among Us-flavoured bot names, in draw order. */
export const BOT_NAMES: readonly string[] = [
  "Nova", "Pixel", "Bytes", "Rusty", "Circuit", "Glitch", "Cobalt", "Torque", "Widget", "Solder",
];

/** Short personality tags shown in the lobby roster. */
export const BOT_TAGS: readonly string[] = [
  "methodical", "twitchy", "quiet", "chatty", "paranoid",
  "steady", "sarcastic", "nervous", "bold", "careful",
];

const COLOR_IDS = Object.keys(CREW_COLORS) as CrewColorId[];

/** The colour createMatch will hand the player avatar for this seed. */
export function playerColorFor(seed: number): CrewColorId {
  const rng = createRng(hashSeed(`${seed}:player-color`));
  return COLOR_IDS[rng.int(COLOR_IDS.length)];
}

/**
 * Build the lobby roster: the player first, then `botCount` bots, all derived
 * from `seed` alone. The ids this returns are the ids the engine uses for the
 * same configuration, so lobby avatars and match actors line up.
 */
export function createRoster(input: {
  seed: number; botCount: number; playerName: string; playerColor: CrewColorId;
}): RosterEntry[] {
  const rng = createRng(hashSeed(`${input.seed}:roster`));
  const count = Math.max(0, Math.floor(input.botCount));
  const names = shuffle(rng, BOT_NAMES);
  const tags = shuffle(rng, BOT_TAGS);
  const palette = shuffle(rng, COLOR_IDS.filter(color => color !== input.playerColor));

  const roster: RosterEntry[] = [{
    id: PLAYER_ID,
    name: input.playerName.trim() || "You",
    color: input.playerColor,
    tag: "you",
    isPlayer: true,
  }];
  for (let index = 0; index < count; index++) {
    const base = names[index % names.length];
    const cycle = Math.floor(index / names.length);
    roster.push({
      id: `bot-${index}`,
      name: cycle === 0 ? base : `${base}-${cycle + 1}`,
      color: palette.length > 0 ? palette[index % palette.length] : input.playerColor,
      tag: tags[index % tags.length],
      isPlayer: false,
    });
  }
  return roster;
}

function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = items.slice();
  for (let index = out.length - 1; index > 0; index--) {
    const swap = rng.int(index + 1);
    const held = out[index];
    out[index] = out[swap];
    out[swap] = held;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  Read-only helpers the UI calls                                     *
 * ------------------------------------------------------------------ */

/**
 * Crewmates see WITNESS_RADIUS units — deliberately the SAME number a kill is
 * witnessed from, because the renderer paints the fog with this radius: one
 * number, so "the player saw it" and "the player could see it" cannot drift
 * apart. A lights sabotage cuts it to 90 (and therefore in a blackout a kill
 * beyond 90 is neither visible nor registered — see `performKill`).
 */
export function visionRadius(state: MatchState): number {
  return state.sabotage === "lights" ? 90 : WITNESS_RADIUS;
}

/** Human label for a sabotage kind, used by the HUD and by event text. */
export function sabotageLabel(kind: SabotageKind): string {
  switch (kind) {
    case "lights": return "Lights sabotaged";
    case "comms": return "Comms sabotaged";
    case "o2": return "O2 supply failing";
    case "reactor": return "Reactor meltdown";
    case "none": return "All systems nominal";
  }
}

/* ------------------------------------------------------------------ *
 *  Internal shapes                                                    *
 * ------------------------------------------------------------------ */

type MutableActor = Actor & { pos: { x: number; y: number } };
type MatchOutcome = "crew-win" | "impostor-win" | "timeout";

type PromptAction = "task" | "emergency" | "report" | "vent" | "kill" | "fix" | "trigger";

type PromptRecord = {
  key: string; id: string; label: string;
  kind: "task" | "emergency" | "report" | "vent" | "kill";
  action: PromptAction;
  targetId: ActorId | null;
  sabotage: SabotageKind;
};

type BotGoal = Readonly<{ kind: "task" | "repair"; x: number; y: number; stationId: string; sabotage: SabotageKind }>;

type Brain = {
  goal: BotGoal | null;
  path: Vec[];
  pathIndex: number;
  working: boolean;
  workingUntil: number;
  idleUntil: number;
  sabotageToken: number;
  repairing: boolean;
  killReadyAt: number;
  lastStation: string;
};

type PlannedLine = Readonly<{ at: number; actorId: ActorId; name: string; color: CrewColorId; text: string }>;
type PlannedVote = Readonly<{ at: number; actorId: ActorId; target: VoteTarget }>;
type MeetingPlan = { lines: PlannedLine[]; lineIndex: number; votes: PlannedVote[]; voteIndex: number };

/* Prompt priority codes: lower checks first, highest score wins. */
const CODE_REPORT = 1;
const CODE_KILL = 2;
const CODE_FIX = 3;
const CODE_EMERGENCY = 4;
const CODE_TASK = 5;
const CODE_TRIGGER = 6;
const CODE_VENT = 7;
const CODE_VENT_EXIT = 8;

const roomNames = STATION.zones.filter(zone => zone.kind === "room").map(zone => zone.name);
const NO_LINKS: readonly string[] = [];
const probe: { x: number; y: number } = { x: 0, y: 0 };

let adjacency: Map<string, string[]> | null = null;

function neighbours(): Map<string, string[]> {
  if (adjacency) return adjacency;
  const map = new Map<string, string[]>();
  for (const zone of STATION.zones) map.set(zone.id, []);
  for (const pair of ZONE_LINKS) {
    const left = map.get(pair[0]);
    const right = map.get(pair[1]);
    if (left) left.push(pair[1]);
    if (right) right.push(pair[0]);
  }
  adjacency = map;
  return map;
}

function zoneAt(point: Vec): string | null {
  for (const zone of STATION.zones) {
    if (point.x >= zone.x && point.x <= zone.x + zone.w && point.y >= zone.y && point.y <= zone.y + zone.h) {
      return zone.id;
    }
  }
  return null;
}

/** Breadth-first route over ZONE_LINKS; the station graph has cycles. */
function routeTo(fromZone: string, toZone: string): string[] | null {
  if (fromZone === toZone) return [fromZone];
  const graph = neighbours();
  const cameFrom = new Map<string, string>();
  const queue: string[] = [fromZone];
  cameFrom.set(fromZone, fromZone);
  for (let head = 0; head < queue.length; head++) {
    const zone = queue[head];
    const links = graph.get(zone) ?? NO_LINKS;
    for (const next of links) {
      if (cameFrom.has(next)) continue;
      cameFrom.set(next, zone);
      if (next === toZone) {
        const path = [next];
        let cursor = zone;
        while (cursor !== fromZone) {
          path.push(cursor);
          cursor = cameFrom.get(cursor) ?? fromZone;
        }
        path.push(fromZone);
        path.reverse();
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

function mutate(actor: Actor): MutableActor {
  return actor as MutableActor;
}

function within(a: Vec, b: Vec, radius: number): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy <= radius * radius;
}

function moveActor(actor: MutableActor, dx: number, dy: number): void {
  const distance = Math.hypot(dx, dy);
  if (distance <= 0) return;
  const steps = distance > MOVE_SUBSTEP ? Math.ceil(distance / MOVE_SUBSTEP) : 1;
  const stepX = dx / steps;
  const stepY = dy / steps;
  for (let index = 0; index < steps; index++) {
    const { pos } = actor;
    const nextX = pos.x + stepX;
    const nextY = pos.y + stepY;
    probe.x = nextX; probe.y = nextY;
    if (isWalkable(STATION, probe, ACTOR_RADIUS)) { pos.x = nextX; pos.y = nextY; continue; }
    probe.x = nextX; probe.y = pos.y;
    if (isWalkable(STATION, probe, ACTOR_RADIUS)) { pos.x = nextX; continue; }
    probe.x = pos.x; probe.y = nextY;
    if (isWalkable(STATION, probe, ACTOR_RADIUS)) { pos.y = nextY; }
  }
}

/* ------------------------------------------------------------------ *
 *  createMatch                                                        *
 * ------------------------------------------------------------------ */

export function createMatch(config: MatchConfig): Match {
  /* ---- streams ---------------------------------------------------- */
  const roleRng = createRng(hashSeed(`${config.seed}:roles`));
  const moveRng = createRng(hashSeed(`${config.seed}:bots`));
  const taskRng = createRng(hashSeed(`${config.seed}:tasks`));
  const sabotageRng = createRng(hashSeed(`${config.seed}:sabotage`));
  const meetingRng = createRng(hashSeed(`${config.seed}:meeting`));
  const voteRng = createRng(hashSeed(`${config.seed}:votes`));

  /* ---- actors ----------------------------------------------------- */
  const roster = createRoster({
    seed: config.seed,
    botCount: config.botCount,
    playerName: config.playerName,
    playerColor: playerColorFor(config.seed),
  });
  const total = roster.length;
  const impostorCount = total >= 7 ? 2 : 1;
  const botImpostorSlots = Math.max(0, impostorCount - (config.playerRole === "impostor" ? 1 : 0));
  const botEntries = roster.filter(entry => !entry.isPlayer);
  const impostorIds = new Set(shuffle(roleRng, botEntries).slice(0, botImpostorSlots).map(entry => entry.id));

  const actors: Actor[] = roster.map((entry, index) => {
    const role: Role = entry.isPlayer ? config.playerRole : impostorIds.has(entry.id) ? "impostor" : "crew";
    const spawn: Vec = entry.isPlayer
      ? STATION.playerSpawn
      : STATION.botSpawns[(index - 1) % STATION.botSpawns.length];
    return {
      id: entry.id,
      name: entry.name,
      color: entry.color,
      role,
      alive: true,
      isPlayer: entry.isPlayer,
      pos: { x: spawn.x, y: spawn.y },
      facing: "down",
      walking: false,
      state: "idle",
      tasksDone: 0,
      tasksTotal: entry.isPlayer ? STATION.stations.length : BOT_TASKS,
      suspicion: 0,
      lastSeen: 0,
      ventedUntil: 0,
      witnessed: false,
    };
  });

  const state: MatchState = {
    config,
    station: STATION,
    phase: "briefing",
    time: 0,
    actors,
    playerId: PLAYER_ID,
    activeTask: null,
    meeting: null,
    ejection: null,
    sabotage: "none",
    sabotageEndsAt: 0,
    prompt: null,
    tasksTotal: STATION.stations.length,
    tasksDone: 0,
    crewProgress: 0,
    alarm: "",
    events: [],
    version: 0,
    summary: null,
  };

  /* ---- runtime state owned by the engine -------------------------- */
  const bodies: { actorId: ActorId; x: number; y: number }[] = [];
  const brains = new Map<ActorId, Brain>();
  let eventId = 0;
  let lineId = 0;
  let deaths = 0;
  let playerKills = 0;
  let playerKillReadyAt = 0;
  let emergencyUsed = false;
  let reportCount = 0;
  let correctVotes = 0;
  let wrongVotes = 0;
  let sabotageToken = 0;
  let nextSabotageAt = sabotageRng.range(SABOTAGE_MIN_GAP, SABOTAGE_MAX_GAP);
  let plan: MeetingPlan | null = null;
  let promptKey = "";
  let promptRecord: PromptRecord | null = null;
  let alarmTick = -2;
  let alarmKind: SabotageKind = "none";

  /* ---- small reads ------------------------------------------------ */
  function bump(): void {
    state.version++;
  }

  function actorById(id: ActorId): Actor | null {
    for (const actor of state.actors) if (actor.id === id) return actor;
    return null;
  }

  function playerActor(): Actor {
    return actorById(state.playerId) ?? state.actors[0];
  }

  function countLiving(role: Role): number {
    let count = 0;
    for (const actor of state.actors) if (actor.alive && actor.role === role) count++;
    return count;
  }

  function nameOf(id: ActorId): string {
    return actorById(id)?.name ?? "Unknown";
  }

  function stationById(id: string | null): (typeof STATION.stations)[number] | null {
    if (!id) return null;
    for (const station of STATION.stations) if (station.id === id) return station;
    return null;
  }

  function consoleById(id: string | null): Console | null {
    if (!id) return null;
    for (const console of CONSOLES) if (console.id === id) return console;
    return null;
  }

  function consoleFor(kind: SabotageKind): Console | null {
    for (const console of CONSOLES) if (console.sabotage === kind) return console;
    return null;
  }

  function isLethalSabotage(): boolean {
    return state.sabotage === "reactor" || state.sabotage === "o2";
  }

  function recomputeProgress(): void {
    const player = playerActor();
    let done = 0;
    let total = 0;
    for (const actor of state.actors) {
      if (actor.role !== "crew") continue;
      done += actor.tasksDone;
      total += actor.tasksTotal;
    }
    state.crewProgress = total > 0 ? Math.min(1, done / total) : 0;
    state.tasksDone = player.tasksDone;
    state.tasksTotal = player.tasksTotal;
  }

  function pushEvent(kind: MatchEventKind, text: string, actorId?: ActorId, sabotage?: SabotageKind): void {
    const event: MatchEvent = {
      id: ++eventId,
      kind,
      text,
      at: state.time,
      ...(actorId !== undefined ? { actorId } : {}),
      ...(sabotage !== undefined ? { sabotage } : {}),
    };
    if (state.events.length >= EVENT_CAP) state.events.shift();
    state.events.push(event);
    bump();
  }

  function setFacing(actor: Actor, dx: number, dy: number): void {
    if (Math.abs(dx) > Math.abs(dy)) actor.facing = dx < 0 ? "left" : "right";
    else actor.facing = dy < 0 ? "up" : "down";
  }

  /* ---- sabotage ---------------------------------------------------- */
  function clearSabotageSilently(): void {
    if (state.sabotage === "none") return;
    state.sabotage = "none";
    state.sabotageEndsAt = 0;
    sabotageToken++;
  }

  function clearSabotage(console: Console, actor: Actor): void {
    const kind = state.sabotage;
    clearSabotageSilently();
    pushEvent("sabotage-fixed", `${actor.name} repaired ${sabotageLabel(kind).toLowerCase()} at the ${console.name}`, actor.id, kind);
    checkOutcome();
    bump();
  }

  function triggerSabotage(kind: SabotageKind, actor: Actor): void {
    if (kind === "none" || state.sabotage !== "none") return;
    state.sabotage = kind;
    state.sabotageEndsAt = kind === "reactor" || kind === "o2" ? state.time + SABOTAGE_COUNTDOWN : 0;
    sabotageToken++;
    pushEvent("sabotage", `${sabotageLabel(kind)} — report to ${consoleFor(kind)?.name ?? "the console"}`, actor.isPlayer ? actor.id : undefined, kind);
    bump();
  }

  /* ---- endings ----------------------------------------------------- */
  function evaluateOutcome(): MatchOutcome | null {
    const livingImpostors = countLiving("impostor");
    const livingCrew = countLiving("crew");
    if (state.crewProgress >= 1) return "crew-win";
    // Extension over the frozen rule list: once the last impostor is gone the
    // crew has won, exactly as it would in a live round.
    if (deaths > 0 && livingImpostors === 0) return "crew-win";
    // `deaths > 0` keeps a pathological 1-impostor/1-crew table from ending on
    // frame zero; after any death the standard parity rule applies.
    if (deaths > 0 && livingImpostors >= livingCrew) return "impostor-win";
    if (state.sabotage !== "none" && state.sabotageEndsAt > 0 && state.time >= state.sabotageEndsAt) return "impostor-win";
    if (state.time >= MATCH_LIMIT_SECONDS) return "timeout";
    return null;
  }

  function checkOutcome(): void {
    if (state.phase !== "play") return;
    const outcome = evaluateOutcome();
    if (outcome) endMatch(outcome);
  }

  function buildSummary(outcome: MatchOutcome): MatchSummary {
    const player = playerActor();
    const playerRole = player.role;
    const playerWon = (outcome === "crew-win") === (playerRole === "crew");
    const tasksDone = player.tasksDone;
    const kills = playerKills;
    const bonus = playerRole === "crew"
      ? tasksDone >= 5 && correctVotes > 0
      : kills >= 2;
    const stars = Math.min(3, 1 + (playerWon ? 1 : 0) + (bonus ? 1 : 0)) as 1 | 2 | 3;
    const rank = stars === 3 ? "Commander" : stars === 2 ? "Specialist" : "Recruit";
    return {
      outcome,
      playerWon,
      playerRole,
      playerAlive: player.alive,
      tasksDone,
      tasksTotal: player.tasksTotal,
      correctVotes,
      wrongVotes,
      reported: reportCount,
      kills,
      stars,
      rank,
      salvagePoints: 40 + 30 * stars + 5 * tasksDone + 10 * kills,
    };
  }

  function endMatch(outcome: MatchOutcome): void {
    if (state.phase === "over") return;
    state.phase = "over";
    state.activeTask = null;
    state.summary = buildSummary(outcome);
    promptKey = "";
    promptRecord = null;
    state.prompt = null;
    const summary = state.summary;
    pushEvent(
      summary.playerWon ? "win" : "lose",
      outcome === "timeout"
        ? "Extraction window closed — impostors got away with it"
        : outcome === "crew-win" ? "Station secured — crew wins" : "The impostors win",
    );
    bump();
  }

  function resetRound(): void {
    bodies.length = 0;
    clearSabotageSilently();
    state.meeting = null;
    state.ejection = null;
    state.activeTask = null;
    plan = null;
    let botIndex = 0;
    for (const actor of state.actors) {
      const spawn = actor.isPlayer
        ? STATION.playerSpawn
        : STATION.botSpawns[botIndex++ % STATION.botSpawns.length];
      const live = mutate(actor);
      live.pos.x = spawn.x;
      live.pos.y = spawn.y;
      actor.walking = false;
      actor.ventedUntil = 0;
      actor.facing = "down";
      actor.state = actor.alive ? "idle" : "down";
      const brain = brains.get(actor.id);
      if (brain) {
        brain.goal = null;
        brain.path = [];
        brain.pathIndex = 0;
        brain.working = false;
        brain.idleUntil = 0;
        brain.repairing = false;
      }
    }
    nextSabotageAt = state.time + sabotageRng.range(SABOTAGE_MIN_GAP, SABOTAGE_MAX_GAP);
    bump();
    refreshPrompt();
  }

  /* ---- meetings ---------------------------------------------------- */
  function applyBodySuspicion(victimId: ActorId, reporterId: ActorId): void {
    let spot: { x: number; y: number } | null = null;
    for (const body of bodies) if (body.actorId === victimId) spot = body;
    if (!spot) return;
    for (const actor of state.actors) {
      if (!actor.alive || actor.id === victimId || actor.id === reporterId) continue;
      if (within(actor.pos, spot, BODY_SUSPICION_RADIUS)) actor.suspicion += 2;
    }
  }

  function testimony(speaker: Actor, reporter: Actor | null, victim: Actor | null): string {
    const others = state.actors.filter(actor => actor.alive && actor.id !== speaker.id);
    const target = others.length > 0 ? meetingRng.pick(others) : speaker;
    const zone = meetingRng.pick(roomNames);
    if (speaker.role === "impostor") {
      return meetingRng.pick([
        `it's ${target.name}, I saw them near ${zone}`,
        `${target.name} was following me around ${zone}`,
        `I was doing tasks in ${zone} and ${target.name} came out of nowhere`,
        `vote ${target.name}, they are not doing tasks`,
        `${target.name} is faking tasks in ${zone}`,
      ]);
    }
    const pool = [
      `${zone}: where was everyone?`,
      `I was in ${zone} the whole time`,
      `I saw ${target.name} near the body`,
      `${target.name} is acting sus`,
      `where were you, ${target.name}?`,
      `I was with ${target.name} in ${zone}`,
      `skip, we have no proof`,
      `${reporter ? reporter.name : "someone"}, why did you call this?`,
      `I'm crew, I was in ${zone} doing tasks`,
      `${target.name} vented, I swear`,
      `nothing happened in ${zone}, I was watching`,
    ];
    if (victim) pool.push(`rest in peace ${victim.name}, I found nothing`);
    return meetingRng.pick(pool);
  }

  function botVote(voter: Actor, living: readonly Actor[]): VoteTarget {
    if (voter.role === "impostor") {
      // Frame the cream of the crop: whoever the crew already distrusts.
      let framed: Actor | null = null;
      for (const candidate of living) {
        if (candidate.id === voter.id || candidate.role !== "crew") continue;
        if (!framed || candidate.suspicion > framed.suspicion) framed = candidate;
      }
      if (framed && voteRng.chance(0.8)) return framed.id;
      return "skip";
    }
    let suspect: Actor | null = null;
    for (const candidate of living) {
      if (candidate.id === voter.id || candidate.suspicion <= 0) continue;
      if (!suspect || candidate.suspicion > suspect.suspicion) suspect = candidate;
    }
    if (suspect && voteRng.chance(0.85)) return suspect.id;
    return "skip";
  }

  function buildPlan(reporter: Actor | null, victim: Actor | null): MeetingPlan {
    const living = state.actors.filter(actor => actor.alive);
    const speakers = living.filter(actor => !actor.isPlayer);
    const lines: PlannedLine[] = [];
    for (const speaker of shuffle(meetingRng, speakers)) {
      const count = meetingRng.chance(0.35) ? 2 : 1;
      for (let index = 0; index < count; index++) {
        lines.push({
          at: 0.4 + meetingRng.next() * (MEETING_TESTIMONY_SECONDS - 1.1),
          actorId: speaker.id,
          name: speaker.name,
          color: speaker.color,
          text: testimony(speaker, reporter, victim),
        });
      }
    }
    lines.sort((left, right) => left.at - right.at);
    const votes: PlannedVote[] = [];
    for (const voter of speakers) {
      votes.push({
        at: MEETING_TESTIMONY_SECONDS + 0.4 + voteRng.next() * 15,
        actorId: voter.id,
        target: botVote(voter, living),
      });
    }
    votes.sort((left, right) => left.at - right.at);
    return { lines, lineIndex: 0, votes, voteIndex: 0 };
  }

  function startMeeting(reporterId: ActorId, victimId: ActorId | null): void {
    const reporter = actorById(reporterId);
    const victim = victimId ? actorById(victimId) : null;
    const meeting: Meeting = {
      reporterId,
      victimId,
      startedAt: state.time,
      endsAt: state.time + MEETING_TESTIMONY_SECONDS + MEETING_VOTE_SECONDS,
      lines: [],
      votes: {},
      resolved: false,
    };
    state.meeting = meeting;
    state.phase = "meeting";
    state.activeTask = null;
    // Calling a meeting stands the crew down: sabotages are cleared, bodies are
    // collected, everyone is pulled off the floor for the vote.
    clearSabotageSilently();
    for (const actor of state.actors) {
      actor.walking = false;
      actor.ventedUntil = 0;
      if (actor.alive) actor.state = "meeting";
    }
    if (victimId) applyBodySuspicion(victimId, reporterId);
    if (reporterId === state.playerId) reportCount++;
    plan = buildPlan(reporter, victim);
    pushEvent(
      "meeting",
      victim
        ? `${reporter?.name ?? "Someone"} reported ${victim.name}'s body`
        : `${reporter?.name ?? "Someone"} called an emergency meeting`,
      reporterId,
    );
    state.version++;
    refreshPrompt();
  }

  function tryResolveMeeting(): void {
    const meeting = state.meeting;
    if (!meeting || meeting.resolved) return;
    let expected = 0;
    let cast = 0;
    for (const actor of state.actors) {
      if (!actor.alive) continue;
      expected++;
      if (actor.id in meeting.votes) cast++;
    }
    if (cast < expected && state.time < meeting.endsAt) return;
    resolveMeeting(meeting);
  }

  function resolveMeeting(meeting: Meeting): void {
    meeting.resolved = true;
    const tally = new Map<VoteTarget, number>();
    let skipVotes = 0;
    for (const key in meeting.votes) {
      const target = meeting.votes[key];
      tally.set(target, (tally.get(target) ?? 0) + 1);
      if (target === "skip") skipVotes++;
    }
    let leader: VoteTarget | null = null;
    let leaderVotes = 0;
    let tied = false;
    tally.forEach((count, target) => {
      if (count > leaderVotes) { leader = target; leaderVotes = count; tied = false; }
      else if (count === leaderVotes) tied = true;
    });

    let ejected: Actor | null = null;
    if (!tied && leader !== null && leader !== "skip" && leaderVotes > 0 && skipVotes < leaderVotes) {
      ejected = actorById(leader);
    }
    if (ejected) {
      const fallen = mutate(ejected);
      fallen.alive = false;
      fallen.state = "down";
      fallen.walking = false;
      deaths++;
    }
    const playerVote: VoteTarget | null = state.playerId in meeting.votes ? meeting.votes[state.playerId] : null;
    if (ejected && playerVote === ejected.id) {
      if (ejected.role === "impostor") correctVotes++;
      else wrongVotes++;
    }

    const remaining = countLiving("impostor");
    state.ejection = {
      actorId: ejected ? ejected.id : null,
      name: ejected ? ejected.name : "No one",
      color: ejected ? ejected.color : "white",
      role: ejected ? ejected.role : null,
      impostorCount: remaining,
    };
    state.phase = "ejection";
    bodies.length = 0;
    plan = null;
    pushEvent(
      "eject",
      ejected
        ? `${ejected.name} was ejected — ${ejected.role === "impostor"
          ? `${remaining} impostor${remaining === 1 ? "" : "s"} left`
          : "they were not an impostor"}`
        : "No one was ejected (tie or skip)",
      ejected ? ejected.id : undefined,
    );
    state.version++;
    refreshPrompt();
  }

  function updateMeeting(): void {
    const meeting = state.meeting;
    if (!meeting || meeting.resolved || !plan) return;
    const elapsed = state.time - meeting.startedAt;
    while (plan.lineIndex < plan.lines.length && plan.lines[plan.lineIndex].at <= elapsed) {
      const planned = plan.lines[plan.lineIndex++];
      meeting.lines.push({
        id: ++lineId,
        actorId: planned.actorId,
        name: planned.name,
        color: planned.color,
        text: planned.text,
        at: state.time,
      });
      bump();
    }
    if (elapsed >= MEETING_TESTIMONY_SECONDS) {
      while (plan.voteIndex < plan.votes.length && plan.votes[plan.voteIndex].at <= elapsed) {
        const planned = plan.votes[plan.voteIndex++];
        if (!(planned.actorId in meeting.votes)) {
          meeting.votes[planned.actorId] = planned.target;
          bump();
        }
      }
    }
    tryResolveMeeting();
  }

  /* ---- combat ------------------------------------------------------ */
  function nearestKillTarget(killer: Actor, range: number): Actor | null {
    let best: Actor | null = null;
    let bestDistance = range * range;
    for (const actor of state.actors) {
      if (actor === killer || !actor.alive || actor.role === killer.role) continue;
      if (state.time < actor.ventedUntil) continue;
      const dx = actor.pos.x - killer.pos.x;
      const dy = actor.pos.y - killer.pos.y;
      const squared = dx * dx + dy * dy;
      if (squared <= bestDistance) { bestDistance = squared; best = actor; }
    }
    return best;
  }

  function performKill(killer: Actor, victim: Actor, byPlayer: boolean): void {
    victim.alive = false;
    victim.state = "down";
    victim.walking = false;
    victim.ventedUntil = 0;
    bodies.push({ actorId: victim.id, x: victim.pos.x, y: victim.pos.y });
    deaths++;
    if (byPlayer) {
      playerKills++;
      playerKillReadyAt = state.time + PLAYER_KILL_COOLDOWN;
    }
    for (const watcher of state.actors) {
      if (watcher === killer || watcher === victim || !watcher.alive || watcher.isPlayer) continue;
      if (state.time < watcher.ventedUntil) continue;
      if (within(watcher.pos, victim.pos, WITNESS_RADIUS) || within(watcher.pos, killer.pos, WITNESS_RADIUS)) {
        killer.suspicion += 4;
      }
    }
    const player = playerActor();
    // The player registers a kill from exactly as far as the player can SEE:
    // the fog radius in force, not the full sight radius. In a blackout the fog
    // is 90, so a kill the player could not have seen is not announced either —
    // the "kill" event drives the toast and the one frame a live round may show
    // the impostor's true form, so announcing an unseen kill would be a free
    // tell rather than a witness.
    if (player !== victim && player.alive && within(player.pos, killer.pos, visionRadius(state))) {
      killer.witnessed = true;
      pushEvent("kill", `${killer.name} eliminated ${victim.name}`, killer.id);
    }
    bump();
    checkOutcome();
  }

  function ability(): void {
    const player = playerActor();
    if (state.phase !== "play" || !player.alive || state.activeTask) return;
    if (player.role !== "impostor" || state.time < player.ventedUntil) return;
    if (state.time < playerKillReadyAt) return;
    const victim = nearestKillTarget(player, KILL_RANGE);
    if (!victim) return;
    performKill(player, victim, true);
  }

  function vent(): void {
    const player = playerActor();
    if (state.phase !== "play" || !player.alive || state.activeTask) return;
    if (player.role !== "impostor") return;
    if (state.time < player.ventedUntil) {
      player.ventedUntil = 0;
      for (const actor of state.actors) {
        if (actor.isPlayer || !actor.alive) continue;
        if (within(actor.pos, player.pos, BODY_SUSPICION_RADIUS)) {
          player.suspicion += 3;
          player.witnessed = true;
        }
      }
      bump();
      refreshPrompt();
      return;
    }
    let spot: { x: number; y: number } | null = null;
    let linked: string | null = null;
    for (const entry of STATION.vents) {
      if (within(player.pos, entry, VENT_RANGE)) { spot = entry; linked = entry.link; }
    }
    if (!spot || !linked) return;
    let exit: { x: number; y: number } | null = null;
    for (const entry of STATION.vents) if (entry.id === linked) exit = entry;
    if (!exit) return;
    const live = mutate(player);
    live.pos.x = exit.x;
    live.pos.y = exit.y;
    player.ventedUntil = state.time + VENT_MAX_SECONDS;
    player.walking = false;
    player.state = "idle";
    player.facing = "down";
    bump();
    refreshPrompt();
  }

  /* ---- prompts ----------------------------------------------------- */
  function assignPrompt(code: number, target: ActorId | null): void {
    const key = code === 0 ? "" : `${code}:${target ?? ""}`;
    if (key === promptKey) return;
    promptKey = key;
    if (code === 0) {
      promptRecord = null;
      state.prompt = null;
      bump();
      return;
    }
    switch (code) {
      case CODE_REPORT: {
        promptRecord = {
          key, id: `report:${target ?? ""}`, kind: "report", action: "report",
          label: `Report ${nameOf(target ?? "")}`, targetId: target, sabotage: "none",
        };
        break;
      }
      case CODE_KILL: {
        promptRecord = {
          key, id: `kill:${target ?? ""}`, kind: "kill", action: "kill",
          label: `Eliminate ${nameOf(target ?? "")}`, targetId: target, sabotage: "none",
        };
        break;
      }
      case CODE_FIX: {
        const console = consoleById(target);
        promptRecord = {
          key, id: `fix:${target ?? ""}`, kind: "task", action: "fix",
          label: `Repair ${console?.sabotage ?? "system"}`, targetId: target, sabotage: console?.sabotage ?? "none",
        };
        break;
      }
      case CODE_EMERGENCY: {
        promptRecord = {
          key, id: "emergency", kind: "emergency", action: "emergency",
          label: "Call emergency meeting", targetId: null, sabotage: "none",
        };
        break;
      }
      case CODE_TASK: {
        const station = stationById(target);
        promptRecord = {
          key, id: `task:${target ?? ""}`, kind: "task", action: "task",
          label: station?.name ?? "Task", targetId: target, sabotage: "none",
        };
        break;
      }
      case CODE_TRIGGER: {
        const console = consoleById(target);
        promptRecord = {
          key, id: `sabotage:${target ?? ""}`, kind: "kill", action: "trigger",
          label: `Sabotage ${console?.sabotage ?? "system"}`, targetId: target, sabotage: console?.sabotage ?? "none",
        };
        break;
      }
      case CODE_VENT: {
        promptRecord = {
          key, id: `vent:${target ?? ""}`, kind: "vent", action: "vent",
          label: "Enter vent", targetId: target, sabotage: "none",
        };
        break;
      }
      default: {
        promptRecord = {
          key, id: "vent:exit", kind: "vent", action: "vent",
          label: "Leave vent", targetId: null, sabotage: "none",
        };
        break;
      }
    }
    state.prompt = { id: promptRecord.id, label: promptRecord.label, kind: promptRecord.kind };
    bump();
  }

  /**
   * Recomputed every update. The scan only touches distances, and the prompt
   * object is rebuilt solely when the winning candidate changes, so the hot
   * path allocates nothing.
   */
  function refreshPrompt(): void {
    const player = playerActor();
    let code = 0;
    let target: ActorId | null = null;
    let score = -1;

    if (state.phase === "play" && player.alive && !state.activeTask) {
      if (state.time < player.ventedUntil) {
        code = CODE_VENT_EXIT;
      } else {
        for (const body of bodies) {
          if (within(player.pos, body, INTERACT_RANGE) && 100 > score) {
            code = CODE_REPORT; target = body.actorId; score = 100;
          }
        }
        if (player.role === "impostor" && state.time >= playerKillReadyAt) {
          const victim = nearestKillTarget(player, KILL_RANGE);
          if (victim && 90 > score) { code = CODE_KILL; target = victim.id; score = 90; }
        }
        if (state.sabotage !== "none") {
          const console = consoleFor(state.sabotage);
          if (console && within(player.pos, console, INTERACT_RANGE) && 80 > score) {
            code = CODE_FIX; target = console.id; score = 80;
          }
        }
        if (!emergencyUsed && within(player.pos, STATION.emergency, INTERACT_RANGE) && 70 > score) {
          code = CODE_EMERGENCY; target = null; score = 70;
        }
        if (player.role === "crew") {
          for (const station of STATION.stations) {
            if (within(player.pos, station, INTERACT_RANGE) && 60 > score) {
              code = CODE_TASK; target = station.id; score = 60;
            }
          }
        }
        if (player.role === "impostor" && state.sabotage === "none") {
          for (const console of CONSOLES) {
            if (console.kind !== "sabotage-trigger") continue;
            if (within(player.pos, console, INTERACT_RANGE) && 50 > score) {
              code = CODE_TRIGGER; target = console.id; score = 50;
            }
          }
        }
        if (player.role === "impostor") {
          for (const entry of STATION.vents) {
            if (within(player.pos, entry, VENT_RANGE) && 40 > score) {
              code = CODE_VENT; target = entry.id; score = 40;
            }
          }
        }
      }
    }
    assignPrompt(code, target);
  }

  /* ---- interactions ------------------------------------------------ */
  function interact(): void {
    if (state.phase !== "play" || state.activeTask) return;
    refreshPrompt();
    const record = promptRecord;
    if (!record) return;
    switch (record.action) {
      case "task": {
        const station = stationById(record.targetId);
        if (!station) return;
        state.activeTask = {
          stationId: station.id,
          name: station.name,
          kind: station.kind,
          seed: taskRng.int(TASK_SEED_BOUND),
          long: station.long,
        };
        bump();
        return;
      }
      case "report": {
        if (!record.targetId) return;
        startMeeting(state.playerId, record.targetId);
        return;
      }
      case "emergency": {
        if (emergencyUsed) return;
        emergencyUsed = true;
        startMeeting(state.playerId, null);
        return;
      }
      case "vent": {
        vent();
        return;
      }
      case "kill": {
        ability();
        return;
      }
      case "fix": {
        const console = consoleById(record.targetId);
        if (!console || state.sabotage !== console.sabotage) return;
        clearSabotage(console, playerActor());
        refreshPrompt();
        return;
      }
      case "trigger": {
        const console = consoleById(record.targetId);
        if (!console) return;
        triggerSabotage(console.sabotage, playerActor());
        refreshPrompt();
        return;
      }
    }
  }

  function finishTask(stationId: string, success: boolean, roll: number): void {
    const attempt = state.activeTask;
    // `roll` belongs to the minigame: the overlay folds it into `success`
    // before calling here, so the engine reports straight from the boolean.
    void roll;
    if (!attempt || attempt.stationId !== stationId) return;
    state.activeTask = null;
    if (success) {
      const player = playerActor();
      player.tasksDone++;
      recomputeProgress();
      pushEvent("task-done", `${attempt.name} complete`, state.playerId);
      checkOutcome();
    } else {
      pushEvent("task-failed", `${attempt.name} failed — try again`, state.playerId);
    }
    bump();
  }

  function cancelTask(): void {
    if (!state.activeTask) return;
    state.activeTask = null;
    bump();
  }

  function vote(target: VoteTarget): void {
    const meeting = state.meeting;
    if (!meeting || meeting.resolved || state.phase !== "meeting") return;
    const player = playerActor();
    if (!player.alive) return;
    if (state.time - meeting.startedAt < MEETING_TESTIMONY_SECONDS) return;
    if (target !== "skip" && !actorById(target)) return;
    meeting.votes[state.playerId] = target;
    pushEvent("vote", target === "skip" ? "You voted to skip" : `You voted for ${nameOf(target)}`, state.playerId);
    state.version++;
    tryResolveMeeting();
  }

  function advance(): void {
    if (state.phase === "briefing") {
      state.phase = "play";
      pushEvent("info", "Match started — check your task list");
      bump();
      refreshPrompt();
      return;
    }
    if (state.phase === "ejection") {
      const outcome = evaluateOutcome();
      resetRound();
      if (outcome) endMatch(outcome);
      else { state.phase = "play"; bump(); }
    }
  }

  function drainEvents(): MatchEvent[] {
    const drained = state.events;
    state.events = [];
    return drained;
  }

  /* ---- bots -------------------------------------------------------- */
  function pickStation(brain: Brain): (typeof STATION.stations)[number] {
    const stations = STATION.stations;
    let index = moveRng.int(stations.length);
    if (stations.length > 1 && stations[index].id === brain.lastStation) index = (index + 1) % stations.length;
    const station = stations[index];
    brain.lastStation = station.id;
    return station;
  }

  function buildPath(from: Vec, goalX: number, goalY: number): Vec[] {
    const startZone = zoneAt(from);
    probe.x = goalX; probe.y = goalY;
    const goalZone = zoneAt(probe);
    const points: Vec[] = [];
    if (startZone && goalZone && startZone !== goalZone) {
      const route = routeTo(startZone, goalZone);
      if (route) {
        for (let index = 1; index < route.length; index++) {
          const hub = HUBS[route[index]];
          if (hub) points.push(hub);
        }
      }
    }
    points.push({ x: goalX, y: goalY });
    return points;
  }

  function assignGoal(actor: Actor, brain: Brain): void {
    let goal: BotGoal | null = null;
    if (brain.repairing && state.sabotage !== "none") {
      const console = consoleFor(state.sabotage);
      if (console) {
        goal = { kind: "repair", x: console.x, y: console.y, stationId: console.id, sabotage: console.sabotage };
      }
    }
    if (!goal) {
      const station = pickStation(brain);
      goal = { kind: "task", x: station.x, y: station.y, stationId: station.id, sabotage: "none" };
    }
    brain.goal = goal;
    brain.path = buildPath(actor.pos, goal.x, goal.y);
    brain.pathIndex = 0;
  }

  function finishBotWork(actor: Actor, brain: Brain): void {
    const goal = brain.goal;
    brain.goal = null;
    brain.path = [];
    brain.pathIndex = 0;
    brain.idleUntil = state.time + moveRng.range(BOT_IDLE_MIN, BOT_IDLE_MAX);
    if (!goal) return;
    if (goal.kind === "repair") {
      brain.repairing = false;
      if (state.sabotage !== "none" && state.sabotage === goal.sabotage) {
        const console = consoleFor(state.sabotage);
        if (console) clearSabotage(console, actor);
      }
      return;
    }
    if (actor.role === "crew" && actor.tasksDone < actor.tasksTotal) {
      actor.tasksDone++;
      recomputeProgress();
      bump();
      checkOutcome();
    }
  }

  function tryBotKill(killer: Actor, brain: Brain): void {
    if (state.time < brain.killReadyAt) return;
    const victim = nearestKillTarget(killer, KILL_RANGE);
    if (!victim) return;
    for (const other of state.actors) {
      if (other === killer || other === victim || !other.alive) continue;
      if (state.time < other.ventedUntil) continue;
      if (within(other.pos, killer.pos, BOT_KILL_SAFE_RADIUS)) return;
      if (within(other.pos, victim.pos, BOT_KILL_SAFE_RADIUS)) return;
    }
    performKill(killer, victim, false);
    brain.killReadyAt = state.time + BOT_KILL_COOLDOWN + moveRng.range(-3, 4);
  }

  function updateBot(actor: Actor, brain: Brain, dt: number): void {
    if (state.phase !== "play") {
      actor.walking = false;
      return;
    }
    if (brain.working) {
      actor.walking = false;
      actor.state = "working";
      if (state.time < brain.workingUntil) return;
      brain.working = false;
      finishBotWork(actor, brain);
      return;
    }
    if (state.time < brain.idleUntil) {
      actor.walking = false;
      if (actor.state !== "working") actor.state = "idle";
      return;
    }
    if (brain.sabotageToken !== sabotageToken) {
      brain.sabotageToken = sabotageToken;
      // Crew drop what they are doing for a lethal countdown; lights and comms
      // only pull half of them, so the crew still spreads out.
      brain.repairing = actor.role === "crew" && (isLethalSabotage() || moveRng.chance(0.5));
      brain.goal = null;
      brain.pathIndex = 0;
    }
    if (brain.repairing && state.sabotage === "none") {
      brain.repairing = false;
      brain.goal = null;
    }
    if (!brain.goal) assignGoal(actor, brain);
    const goal = brain.goal;
    if (!goal) return;
    const onWaypoint = brain.pathIndex < brain.path.length;
    const waypoint = onWaypoint ? brain.path[brain.pathIndex] : goal;
    const dx = waypoint.x - actor.pos.x;
    const dy = waypoint.y - actor.pos.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= (onWaypoint ? ZONE_ARRIVE : GOAL_ARRIVE)) {
      if (onWaypoint) {
        brain.pathIndex++;
        return;
      }
      brain.working = true;
      brain.workingUntil = state.time + moveRng.range(BOT_WORK_MIN, BOT_WORK_MAX);
      actor.walking = false;
      actor.state = "working";
      return;
    }
    const step = Math.min(distance, BOT_SPEED * dt);
    moveActor(actor, (dx / distance) * step, (dy / distance) * step);
    actor.walking = true;
    if (actor.state !== "working") actor.state = "walking";
    setFacing(actor, dx, dy);
  }

  function updateBots(dt: number): void {
    for (const actor of state.actors) {
      if (actor.isPlayer || !actor.alive) continue;
      if (state.time < actor.ventedUntil) {
        actor.walking = false;
        actor.state = "idle";
        continue;
      }
      let brain = brains.get(actor.id);
      if (!brain) {
        brain = {
          goal: null, path: [], pathIndex: 0, working: false, workingUntil: 0, idleUntil: 0,
          sabotageToken: 0, repairing: false,
          killReadyAt: state.time + BOT_FIRST_KILL_DELAY + moveRng.range(0, 10),
          lastStation: "",
        };
        brains.set(actor.id, brain);
      }
      if (actor.role === "impostor") {
        tryBotKill(actor, brain);
        if (state.phase !== "play") {
          actor.walking = false;
          return;
        }
      }
      updateBot(actor, brain, dt);
    }
  }

  /* ---- player ------------------------------------------------------ */
  function updatePlayer(dt: number, input: PlayerInput): void {
    const player = playerActor();
    if (!player.alive || state.time < player.ventedUntil) {
      player.walking = false;
      if (player.state !== "down") player.state = "idle";
      return;
    }
    let dx = 0;
    let dy = 0;
    if (input.left) dx -= 1;
    if (input.right) dx += 1;
    if (input.up) dy -= 1;
    if (input.down) dy += 1;
    if (dx === 0 && dy === 0 && input.destination) {
      const toX = input.destination.x - player.pos.x;
      const toY = input.destination.y - player.pos.y;
      const distance = Math.hypot(toX, toY);
      if (distance > 6) { dx = toX / distance; dy = toY / distance; }
    }
    if (dx === 0 && dy === 0) {
      player.walking = false;
      if (player.state !== "down") player.state = "idle";
      return;
    }
    const length = Math.hypot(dx, dy) || 1;
    const step = PLAYER_SPEED * dt;
    moveActor(player, (dx / length) * step, (dy / length) * step);
    player.walking = true;
    if (player.state !== "down") player.state = "walking";
    setFacing(player, dx, dy);
  }

  /* ---- per-frame bookkeeping --------------------------------------- */
  function refreshLastSeen(): void {
    const player = playerActor();
    if (!player.alive) return;
    const radius = visionRadius(state);
    for (const actor of state.actors) {
      if (actor.isPlayer || !actor.alive) continue;
      if (state.time < actor.ventedUntil) continue;
      if (within(actor.pos, player.pos, radius)) actor.lastSeen = state.time;
    }
  }

  function refreshAlarm(): void {
    const seconds = state.sabotageEndsAt > 0 ? Math.max(0, Math.ceil(state.sabotageEndsAt - state.time)) : -1;
    if (seconds === alarmTick && alarmKind === state.sabotage) return;
    alarmTick = seconds;
    alarmKind = state.sabotage;
    const next = state.sabotage === "none"
      ? ""
      : state.sabotage === "lights"
        ? "LIGHTS OFFLINE — vision reduced"
        : state.sabotage === "comms"
          ? "COMMS DOWN — task list offline"
          : `${sabotageLabel(state.sabotage).toUpperCase()} — ${seconds}s TO IMPACT`;
    if (next !== state.alarm) {
      state.alarm = next;
      bump();
    }
  }

  function updateSabotageClock(): void {
    if (state.sabotage !== "none" && state.sabotageEndsAt > 0 && state.time >= state.sabotageEndsAt) {
      endMatch("impostor-win");
      return;
    }
    if (state.sabotage !== "none" || state.time < nextSabotageAt) return;
    let trigger: Actor | null = null;
    for (const actor of state.actors) {
      if (!actor.alive || actor.isPlayer || actor.role !== "impostor") continue;
      if (!trigger) trigger = actor;
    }
    if (trigger) triggerSabotage(sabotageRng.pick(["reactor", "o2", "lights", "comms"] as const), trigger);
    nextSabotageAt = state.time + sabotageRng.range(SABOTAGE_MIN_GAP, SABOTAGE_MAX_GAP);
  }

  function update(dtSeconds: number, input: PlayerInput): void {
    const dt = dtSeconds > MAX_DT ? MAX_DT : dtSeconds > 0 ? dtSeconds : 0;
    state.time += dt;

    if (state.phase === "play") {
      // Re-derive the crew fraction from the actors every frame: it is the one
      // number every win check reads, so it can never be allowed to drift.
      recomputeProgress();
      // A frozen frame is a frozen station: an open minigame, a meeting or a
      // finished match all stop every actor in place.
      if (!state.activeTask) {
        updatePlayer(dt, input);
        updateBots(dt);
        checkOutcome();
      }
      if (state.phase === "play") updateSabotageClock();
      refreshLastSeen();
    } else if (state.phase === "meeting") {
      updateMeeting();
    }

    refreshAlarm();
    refreshPrompt();
  }

  refreshPrompt();
  recomputeProgress();

  return { state, update, interact, ability, vent, finishTask, cancelTask, vote, advance, drainEvents };
}
