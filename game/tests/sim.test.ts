/**
 * IMPOSTOR PROTOCOL — simulation tests.
 *
 * Run with:
 *   ../../node_modules/.bin/esbuild tests/sim.test.ts --bundle --format=esm \
 *     --platform=node --outfile=/tmp/sim.test.mjs && node --test /tmp/sim.test.mjs
 *
 * Everything here is deterministic: the engine reads no wall clock, no
 * Math.random and no DOM, so a scripted run is reproducible frame for frame.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { CONSOLES, HUBS, STATION, ZONE_LINKS, isWalkable } from "../src/station";
import { createMatch, createRoster, playerColorFor, sabotageLabel, visionRadius } from "../src/sim";
import type { Actor, Match, MatchConfig, MatchSummary, Meeting, PlayerInput, Vec } from "../src/types";

const IDLE: PlayerInput = { up: false, down: false, left: false, right: false, destination: null };
const RADIUS = 15;

/* ------------------------------------------------------------------ *
 *  helpers                                                           *
 * ------------------------------------------------------------------ */

function step(match: Match, seconds: number, input: PlayerInput = IDLE): void {
  const frames = Math.max(1, Math.ceil(seconds * 60));
  for (let index = 0; index < frames; index++) match.update(1 / 60, input);
}

function playerActor(match: Match): Actor {
  const player = match.state.actors.find(actor => actor.isPlayer);
  if (!player) throw new Error("every match has a player actor");
  return player;
}

function bots(match: Match): Actor[] {
  return match.state.actors.filter(actor => !actor.isPlayer);
}

function teleport(actor: Actor, x: number, y: number): void {
  const pos = actor.pos as { x: number; y: number };
  pos.x = x;
  pos.y = y;
}

function meetingOf(match: Match): Meeting {
  const meeting = match.state.meeting;
  if (!meeting) throw new Error("expected an open meeting");
  return meeting;
}

function summaryOf(match: Match): MatchSummary {
  const summary = match.state.summary;
  if (!summary) throw new Error("expected a match summary");
  return summary;
}

/** Walk a straight segment and require the disc to fit the whole way. */
function laneClear(from: Vec, to: Vec, radius: number): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 4));
  for (let index = 0; index <= steps; index++) {
    const t = index / steps;
    if (!isWalkable(STATION, { x: from.x + dx * t, y: from.y + dy * t }, radius)) return false;
  }
  return true;
}

function config(overrides: Partial<MatchConfig> = {}): MatchConfig {
  return {
    seed: 20260923,
    tier: "standard",
    playerRole: "crew",
    botCount: 5,
    playerName: "Ferra",
    friendId: "42",
    ...overrides,
  };
}

/* ------------------------------------------------------------------ *
 *  station                                                           *
 * ------------------------------------------------------------------ */

test("station: rooms never overlap, sit inside the world, and the props are there", () => {
  const rooms = STATION.zones.filter(zone => zone.kind === "room");
  assert.equal(rooms.length, 9, "nine rooms");
  for (let left = 0; left < rooms.length; left++) {
    for (let right = left + 1; right < rooms.length; right++) {
      const a = rooms[left];
      const b = rooms[right];
      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      assert.ok(overlapX <= 0 || overlapY <= 0, `${a.id} and ${b.id} must not overlap`);
    }
  }
  for (const zone of STATION.zones) {
    assert.ok(zone.x >= 0 && zone.y >= 0, `${zone.id} starts inside the world`);
    assert.ok(zone.x + zone.w <= STATION.width && zone.y + zone.h <= STATION.height, `${zone.id} ends inside the world`);
  }
  assert.equal(STATION.stations.length, 6, "six crew task stations");
  assert.equal(STATION.stations.filter(station => station.long).length, 3, "three long tasks");
  assert.equal(STATION.vents.length, 2, "two vents");
  assert.equal(CONSOLES.length, 4, "one console per sabotage kind");
  assert.ok(STATION.botSpawns.length >= 9, "enough bot spawn points");
});

test("station: every hub, station, vent, console, spawn and the emergency button is walkable at radius 15", () => {
  for (const zone of STATION.zones) {
    const hub = HUBS[zone.id];
    assert.ok(hub, `hub missing for ${zone.id}`);
    assert.ok(isWalkable(STATION, hub, RADIUS), `hub ${zone.id} must be walkable`);
  }
  for (const station of STATION.stations) {
    assert.ok(isWalkable(STATION, station, RADIUS), `task station ${station.id} must be walkable`);
  }
  for (const console of CONSOLES) {
    assert.ok(isWalkable(STATION, console, RADIUS), `console ${console.id} must be walkable`);
  }
  for (const vent of STATION.vents) {
    assert.ok(isWalkable(STATION, vent, RADIUS), `vent ${vent.id} must be walkable`);
  }
  assert.ok(isWalkable(STATION, STATION.emergency, RADIUS), "emergency button must be walkable");
  assert.ok(isWalkable(STATION, STATION.playerSpawn, RADIUS), "player spawn must be walkable");
  for (const spawn of STATION.botSpawns) {
    assert.ok(isWalkable(STATION, spawn, RADIUS), "bot spawn must be walkable");
  }
  // ...and the void between two rooms still blocks, so the union is not a blob.
  assert.equal(isWalkable(STATION, { x: 712, y: 100 }, RADIUS), false, "the gap above the Reactor/Cafeteria corridor is void");
  assert.equal(isWalkable(STATION, { x: 900, y: 470 }, RADIUS), false, "the gap beside the cafeteria door is void");
});

test("station: every ZONE_LINKS lane is a straight walkable run at radius 15 and the graph spans the station", () => {
  for (const [from, to] of ZONE_LINKS) {
    assert.ok(HUBS[from] && HUBS[to], `${from} -> ${to} must reference real zones`);
    assert.ok(laneClear(HUBS[from], HUBS[to], RADIUS), `lane ${from} -> ${to} must be clear both ends`);
    assert.ok(laneClear(HUBS[to], HUBS[from], RADIUS), `lane ${to} -> ${from} must be clear both ends`);
  }
  const seen = new Set<string>([STATION.zones[0].id]);
  const queue: string[] = [STATION.zones[0].id];
  for (let head = 0; head < queue.length; head++) {
    for (const [a, b] of ZONE_LINKS) {
      if (a === queue[head] && !seen.has(b)) { seen.add(b); queue.push(b); }
      if (b === queue[head] && !seen.has(a)) { seen.add(a); queue.push(a); }
    }
  }
  assert.equal(seen.size, STATION.zones.length, "every zone is reachable through ZONE_LINKS");
  assert.ok(ZONE_LINKS.length >= STATION.zones.length - 1, "the link graph is at least a spanning tree");
});

/* ------------------------------------------------------------------ *
 *  roster + match setup                                              *
 * ------------------------------------------------------------------ */

test("roster: deterministic from the seed, player first, bots distinct", () => {
  const first = createRoster({ seed: 4242, botCount: 6, playerName: "Ferra", playerColor: playerColorFor(4242) });
  const second = createRoster({ seed: 4242, botCount: 6, playerName: "Ferra", playerColor: playerColorFor(4242) });
  assert.deepEqual(second, first, "same seed rebuilds the same roster");

  assert.equal(first.length, 7);
  assert.equal(first[0].isPlayer, true);
  assert.equal(first[0].id, "player");
  assert.equal(first[0].name, "Ferra");
  assert.equal(first[0].tag, "you");
  assert.equal(new Set(first.slice(1).map(entry => entry.name)).size, 6, "bot names are distinct");
  assert.equal(new Set(first.slice(1).map(entry => entry.color)).size, 6, "bot colours are distinct");
  assert.ok(first.slice(1).every(entry => entry.tag.length > 0), "every bot carries a trait tag");
  assert.ok(first.slice(1).every(entry => entry.color !== first[0].color), "bots avoid the player colour");
  assert.deepEqual(first.map(entry => entry.id), ["player", "bot-0", "bot-1", "bot-2", "bot-3", "bot-4", "bot-5"]);
});

test("createMatch: actor, role, task and impostor counts follow the config", () => {
  const six = createMatch(config({ botCount: 5, playerRole: "crew" }));
  assert.equal(six.state.actors.length, 6, "botCount + 1 actors");
  assert.equal(six.state.actors.filter(actor => actor.role === "impostor").length, 1, "one impostor below seven players");
  assert.equal(six.state.actors.filter(actor => actor.role === "crew").length, 5);
  assert.equal(six.state.actors[0].isPlayer, true, "the player is actor zero");
  assert.ok(six.state.actors.filter(actor => !actor.isPlayer && actor.role === "impostor").length >= 1, "a crew player faces bot impostors only");
  assert.equal(six.state.playerId, "player");
  assert.equal(six.state.phase, "briefing");
  assert.equal(six.state.tasksTotal, 6, "the player owns the six station tasks");
  assert.equal(six.state.crewProgress, 0);
  assert.equal(six.state.summary, null);
  assert.equal(six.state.sabotage, "none");
  assert.ok(six.state.actors.every(actor => actor.alive && actor.ventedUntil === 0));

  const seven = createMatch(config({ botCount: 6, playerRole: "impostor" }));
  assert.equal(seven.state.actors.length, 7);
  assert.equal(seven.state.actors.filter(actor => actor.role === "impostor").length, 2, "two impostors at seven players");
  assert.equal(seven.state.actors.filter(actor => actor.isPlayer && actor.role === "impostor").length, 1, "the player keeps the requested role");
  assert.equal(seven.state.actors.filter(actor => !actor.isPlayer && actor.role === "impostor").length, 1, "one fewer bot impostor");

  const crewTable = createMatch(config({ botCount: 6, playerRole: "crew" }));
  assert.equal(crewTable.state.actors.filter(actor => !actor.isPlayer && actor.role === "impostor").length, 2, "crew player: every impostor is a bot");
  assert.ok(crewTable.state.actors.filter(actor => actor.role === "crew").every(actor => actor.tasksTotal === (actor.isPlayer ? 6 : 5)), "crew carry 6 player / 5 bot tasks");

  const roster = createRoster({ seed: 20260923, botCount: 5, playerName: "Ferra", playerColor: playerColorFor(20260923) });
  assert.deepEqual(six.state.actors.map(actor => actor.id), roster.map(entry => entry.id), "match ids line up with the lobby roster");
  assert.deepEqual(six.state.actors.map(actor => actor.name), roster.map(entry => entry.name));
});

test("vision: 400 units normally, 90 while the lights are down", () => {
  // 210 -> WITNESS_RADIUS (400): the fog radius and the radius a kill is
  // witnessed from are one number in sim.ts, because the renderer paints the fog
  // at visionRadius(). At 220/210 a bot kill (never closer than
  // BOT_KILL_SAFE_RADIUS = 220 to any third actor) could never be witnessed, so
  // the kill event could never fire in a real round. BOT_KILL_SAFE_RADIUS is
  // unchanged: how lethal the bots are is not what moved.
  const match = createMatch(config());
  assert.equal(visionRadius(match.state), 400);
  match.state.sabotage = "lights";
  assert.equal(visionRadius(match.state), 90);
  match.state.sabotage = "reactor";
  assert.equal(visionRadius(match.state), 400);
  match.state.sabotage = "none";
  for (const kind of ["none", "lights", "comms", "o2", "reactor"] as const) {
    assert.ok(sabotageLabel(kind).length > 0);
  }
  assert.equal(sabotageLabel("reactor"), "Reactor meltdown");
  assert.equal(sabotageLabel("none"), "All systems nominal");
});

/* ------------------------------------------------------------------ *
 *  gameplay                                                          *
 * ------------------------------------------------------------------ */

test("crew win: every player task plus bot progress ends the match", () => {
  const match = createMatch(config({ seed: 99, playerRole: "crew", botCount: 5 }));
  const state = match.state;
  const player = playerActor(match);
  match.advance();
  assert.equal(state.phase, "play", "advance leaves the briefing");

  for (const station of STATION.stations) {
    teleport(player, station.x, station.y);
    step(match, 0.05);
    assert.equal(state.prompt?.kind, "task", `standing on ${station.id} offers its task`);
    match.interact();
    assert.equal(state.activeTask?.stationId, station.id);
    assert.equal(state.activeTask?.long, station.long);
    assert.ok(typeof state.activeTask?.seed === "number");
    match.finishTask(station.id, true, 8000);
    assert.equal(state.activeTask, null, "finishing clears the open task");
  }
  assert.equal(state.tasksDone, 6);
  assert.ok(state.crewProgress > 0 && state.crewProgress < 1, "the bots still owe work");

  match.finishTask("task-reactor", true, 8000);
  assert.equal(state.tasksDone, 6, "a stale station id is ignored");

  const events = match.drainEvents();
  assert.ok(events.some(event => event.kind === "task-done"), "task completion is reported");
  assert.equal(match.drainEvents().length, 0, "drainEvents clears the queue");

  for (const actor of state.actors) {
    if (actor.role === "crew" && !actor.isPlayer) actor.tasksDone = actor.tasksTotal;
  }
  step(match, 0.05);
  assert.equal(state.crewProgress, 1, "crew-wide task fraction reaches one");
  assert.equal(state.phase, "over");
  const summary = summaryOf(match);
  assert.equal(summary.outcome, "crew-win");
  assert.equal(summary.playerWon, true);
  assert.equal(summary.playerRole, "crew");
  assert.equal(summary.tasksDone, 6);
  assert.equal(summary.tasksTotal, 6);
  assert.equal(summary.correctVotes, 0);
  assert.equal(summary.wrongVotes, 0);
  assert.equal(summary.kills, 0);
  assert.equal(summary.stars, 2, "win plus full task list");
  assert.equal(summary.rank, "Specialist");
  assert.equal(summary.salvagePoints, 40 + 30 * 2 + 5 * 6);
  assert.equal(state.prompt, null, "no prompt once the match is over");
});

test("kill → report → meeting → vote → ejection", () => {
  const match = createMatch(config({ seed: 5150, playerRole: "impostor", botCount: 5 }));
  const state = match.state;
  match.advance();
  const player = playerActor(match);
  const crew = bots(match);
  const victim = crew[0];

  teleport(player, victim.pos.x + 24, victim.pos.y);
  step(match, 0.05);
  assert.equal(state.prompt?.kind, "kill", "an impostor in reach is offered the kill");

  match.ability();
  assert.equal(victim.alive, false, "the victim dies");
  assert.equal(victim.state, "down");
  assert.equal(state.summary, null, "one death is not a win");

  // Prejudice the room: everyone distrusts crew[1].
  const suspect = crew[1];
  assert.equal(suspect.alive, true);
  suspect.suspicion = 100;

  step(match, 0.05);
  assert.equal(state.prompt?.kind, "report", "standing on the body offers the report");
  match.interact();
  assert.equal(state.phase, "meeting");
  const meeting = meetingOf(match);
  assert.equal(meeting.reporterId, "player");
  assert.equal(meeting.victimId, victim.id);
  assert.equal(meeting.resolved, false);

  step(match, 8);
  assert.ok(meeting.lines.length >= 3, "bots testify during the first seven seconds");
  assert.ok(meeting.lines.every(line => line.at <= state.time + 1e-6), "lines are timestamped in order");
  assert.ok(meeting.lines.some(line => line.text.length > 8), "testimony reads like chat");

  match.vote(suspect.id);
  assert.equal(meeting.votes["player"], suspect.id, "the player's vote is recorded");

  step(match, 22);
  assert.equal(state.phase, "ejection");
  const ejection = state.ejection;
  assert.ok(ejection, "an ejection result is published");
  assert.equal(ejection?.actorId, suspect.id, "the most-voted actor is ejected");
  assert.equal(ejection?.role, "crew");
  assert.equal(suspect.alive, false);
  assert.equal(state.summary, null, "one impostor still walks the station");

  match.advance();
  assert.equal(state.phase, "play", "back to the station");
  assert.equal(state.sabotage, "none");
  assert.equal(state.meeting, null, "the meeting is torn down");

  for (const actor of state.actors) {
    if (actor.role === "crew") actor.tasksDone = actor.tasksTotal;
  }
  step(match, 0.05);
  assert.equal(state.phase, "over");
  const summary = summaryOf(match);
  assert.equal(summary.outcome, "crew-win");
  assert.equal(summary.playerWon, false, "the crew won while the player was the impostor");
  assert.equal(summary.kills, 1);
  assert.equal(summary.wrongVotes, 1, "the player voted for a crewmate");
  assert.equal(summary.correctVotes, 0);
  assert.equal(summary.reported, 1);
  assert.equal(summary.playerAlive, true);
  assert.equal(summary.stars, 1);
  assert.equal(summary.rank, "Recruit");
  assert.equal(summary.salvagePoints, 40 + 30 + 10);
});

test("sabotage: an expired reactor countdown hands the round to the impostors", () => {
  const match = createMatch(config({ seed: 31337, playerRole: "crew", botCount: 5 }));
  const state = match.state;
  match.advance();
  assert.equal(state.sabotage, "none");

  state.sabotage = "reactor";
  state.sabotageEndsAt = state.time + 2;
  let guard = 0;
  while (state.phase === "play" && guard++ < 600) match.update(1 / 60, IDLE);

  assert.equal(state.phase, "over", "the countdown runs the round out");
  const summary = summaryOf(match);
  assert.equal(summary.outcome, "impostor-win");
  assert.equal(summary.playerWon, false);
  assert.equal(summary.stars, 1);
  assert.equal(state.sabotage, "reactor", "the sabotage that ended it is still reported");
});

test("sabotage: lights persist until a crewmate fixes them at the matching console", () => {
  const match = createMatch(config({ seed: 606, playerRole: "crew", botCount: 5 }));
  const state = match.state;
  match.advance();
  const player = playerActor(match);

  state.sabotage = "lights";
  state.sabotageEndsAt = 0;
  const console = CONSOLES.find(entry => entry.sabotage === "lights");
  assert.ok(console, "there is a lights console");
  teleport(player, console!.x, console!.y);
  step(match, 0.05);
  assert.equal(state.prompt?.kind, "task", "the repair console is offered as a task prompt");
  assert.ok(state.prompt?.label.includes("lights"));
  match.interact();
  assert.equal(state.sabotage, "none", "repairing clears the sabotage");
  assert.equal(visionRadius(state), 400, "vision comes back");
  assert.ok(match.drainEvents().some(event => event.kind === "sabotage-fixed"));
});

test("vent: an impostor standing on a vent hides in the linked vent and cannot move or be killed", () => {
  const match = createMatch(config({ seed: 11, playerRole: "impostor", botCount: 5 }));
  const state = match.state;
  match.advance();
  const player = playerActor(match);
  const entry = STATION.vents[1];
  const linked = STATION.vents.find(vent => vent.id === entry.link);
  assert.ok(linked, "the vent links somewhere");

  teleport(player, entry.x + 10, entry.y + 5);
  step(match, 0.05);
  assert.equal(state.prompt?.kind, "vent", "standing on a vent offers the vent prompt");

  match.vent();
  assert.ok(state.time < player.ventedUntil, "the impostor is inside the vent");
  assert.ok(Math.hypot(player.pos.x - linked!.x, player.pos.y - linked!.y) < 1, "and travelled to the linked vent");

  const restingX = player.pos.x;
  const restingY = player.pos.y;
  step(match, 0.5, { up: true, down: false, left: false, right: false, destination: null });
  assert.equal(player.pos.x, restingX, "a vented actor does not move");
  assert.equal(player.pos.y, restingY);
  match.ability();
  assert.equal(state.actors.filter(actor => !actor.alive).length, 0, "a vented actor cannot be killed");

  match.vent();
  assert.equal(player.ventedUntil, 0, "venting again leaves the vent");
  assert.ok(Math.hypot(player.pos.x - linked!.x, player.pos.y - linked!.y) < 1, "and surfaces at the linked vent");
});

test("emergency: the button works once per match and a skip majority ejects nobody", () => {
  const match = createMatch(config({ seed: 5, playerRole: "crew", botCount: 5 }));
  const state = match.state;
  match.advance();
  const player = playerActor(match);

  teleport(player, STATION.emergency.x, STATION.emergency.y);
  step(match, 0.05);
  assert.equal(state.prompt?.kind, "emergency", "the cafeteria button is offered");
  match.interact();
  assert.equal(state.phase, "meeting");
  assert.equal(state.meeting?.victimId, null, "an emergency meeting has no body");
  assert.equal(state.meeting?.reporterId, "player");

  match.vote("skip");
  step(match, 28);
  assert.equal(state.phase, "ejection");
  assert.equal(state.ejection?.actorId, null, "a skip majority ejects nobody");
  assert.equal(state.ejection?.impostorCount, 1);

  match.advance();
  assert.equal(state.phase, "play");
  teleport(player, STATION.emergency.x, STATION.emergency.y);
  step(match, 0.05);
  assert.equal(state.prompt, null, "the emergency button is spent for the match");
  match.interact();
  assert.equal(state.phase, "play", "no second emergency meeting");
});

test("seed: identical seed and scripted inputs reproduce an identical match", () => {
  const run = (): { summary: MatchSummary | null; actors: string[]; lines: number; events: number } => {
    const match = createMatch(config({ seed: 777, playerRole: "impostor", botCount: 6 }));
    const state = match.state;
    match.advance();
    const player = playerActor(match);
    const victim = bots(match).find(actor => actor.role === "crew");
    if (!victim) throw new Error("the script needs a crew victim");
    teleport(player, victim.pos.x + 20, victim.pos.y + 10);
    step(match, 0.05);
    match.ability();
    step(match, 0.05);
    match.interact();
    step(match, 9);
    match.vote("skip");
    step(match, 22);
    const lines = meetingOf(match).lines.length;
    match.advance();
    for (const actor of state.actors) {
      if (actor.role === "crew") actor.tasksDone = actor.tasksTotal;
    }
    step(match, 0.05);
    return {
      summary: state.summary,
      actors: state.actors.map(actor => `${actor.id}|${actor.name}|${actor.color}|${actor.role}|${actor.alive}`),
      lines,
      events: match.drainEvents().length,
    };
  };

  const first = run();
  const second = run();
  assert.ok(first.summary, "the scripted run reaches a summary");
  assert.deepEqual(second, first, "same seed, same script, same match");
  assert.ok(first.lines >= 4, "the meeting produced testimony");
});
