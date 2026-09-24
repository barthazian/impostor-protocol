/**
 * One canonical digest of a whole `MatchState`.
 *
 * Used by the before/after backward-compatibility proof (same digest function on
 * both sides of the change) and by the replay verifier (the settle-time state
 * hash). It is deliberately exhaustive: everything the renderer or the UI can
 * observe is folded in, in a fixed order, so two runs that differ anywhere
 * observable produce different digests.
 */
import { createHash } from "node:crypto";

function hash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function stateDigest(state: unknown): string {
  const value = state as any;
  const actor = (entry: any) => [
    entry.id, entry.name, entry.color, entry.role, entry.alive ? 1 : 0, entry.isPlayer ? 1 : 0,
    entry.pos.x, entry.pos.y, entry.facing, entry.walking ? 1 : 0, entry.state,
    entry.tasksDone, entry.tasksTotal, entry.suspicion, entry.lastSeen, entry.ventedUntil, entry.witnessed ? 1 : 0,
  ];
  const event = (entry: any) => [entry.id, entry.kind, entry.text, entry.at, entry.actorId ?? null, entry.sabotage ?? null];
  const meeting = value.meeting
    ? {
      reporterId: value.meeting.reporterId,
      victimId: value.meeting.victimId,
      startedAt: value.meeting.startedAt,
      endsAt: value.meeting.endsAt,
      resolved: value.meeting.resolved,
      lines: value.meeting.lines.map((line: any) => [line.id, line.actorId, line.text, line.at]),
      votes: Object.keys(value.meeting.votes).sort().map(key => [key, value.meeting.votes[key]]),
    }
    : null;
  const payload = {
    seed: value.config.seed,
    phase: value.phase,
    time: value.time,
    playerId: value.playerId,
    version: value.version,
    actors: value.actors.map(actor),
    activeTask: value.activeTask ? [value.activeTask.stationId, value.activeTask.kind, value.activeTask.seed] : null,
    meeting,
    ejection: value.ejection,
    sabotage: value.sabotage,
    sabotageEndsAt: value.sabotageEndsAt,
    prompt: value.prompt ? [value.prompt.id, value.prompt.label, value.prompt.kind] : null,
    tasksTotal: value.tasksTotal,
    tasksDone: value.tasksDone,
    crewProgress: value.crewProgress,
    alarm: value.alarm,
    events: value.events.map(event),
    summary: value.summary,
  };
  return hash(JSON.stringify(payload));
}

export function digestOf(value: unknown): string {
  return hash(JSON.stringify(value));
}
