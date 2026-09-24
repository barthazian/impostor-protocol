/**
 * IMPOSTOR PROTOCOL — frozen module contract.
 *
 * Every module in this game compiles against the types in this file. Do not
 * change an existing type or signature; add new ones in your own module and
 * re-export only what the UI needs. `index.tsx` is the only file that talks to
 * the FriendSDK action client.
 */

export type Vec = Readonly<{ x: number; y: number }>;
export type Facing = "down" | "up" | "left" | "right";

export const CREW_COLORS = {
  red: "#c51111", blue: "#132ed1", green: "#117f2d", pink: "#ed54ba",
  orange: "#ef7d0d", yellow: "#f5f557", black: "#3f474e", white: "#d6e0f0",
  purple: "#6b2fbb", brown: "#71491e", cyan: "#38fedc", lime: "#50ef39",
} as const;
export type CrewColorId = keyof typeof CREW_COLORS;

export type ActorId = string;
export type Role = "crew" | "impostor";
export type Tier = "practice" | "standard" | "elite";

/** RNG action sequences a crewmate performs at a task station. */
export type TaskKind = "wiring" | "keypad" | "dials" | "calibrate" | "sample" | "reboot";

export type MatchPhase = "briefing" | "play" | "meeting" | "ejection" | "over";
export type SabotageKind = "none" | "lights" | "comms" | "o2" | "reactor";

export type Zone = Readonly<{
  id: string; kind: "room" | "corridor"; name: string;
  x: number; y: number; w: number; h: number;
}>;

export type TaskStation = Readonly<{
  id: string; zoneId: string; name: string; kind: TaskKind;
  x: number; y: number; long: boolean;
}>;

export type Vent = Readonly<{ id: string; zoneId: string; x: number; y: number; link: string }>;

export type Station = Readonly<{
  id: string; name: string; width: number; height: number;
  zones: readonly Zone[]; stations: readonly TaskStation[]; vents: readonly Vent[];
  emergency: Vec; playerSpawn: Vec; botSpawns: readonly Vec[];
}>;

export type ActorState = "idle" | "walking" | "working" | "meeting" | "down";

/** Mutable actor record owned by the simulation. */
export type Actor = {
  id: ActorId; name: string; color: CrewColorId; role: Role; alive: boolean; isPlayer: boolean;
  pos: Vec; facing: Facing; walking: boolean; state: ActorState;
  tasksDone: number; tasksTotal: number;
  suspicion: number;
  /** Simulation time when this actor was last seen by the player. */
  lastSeen: number;
  /** Simulation time until which this actor is inside a vent (impostors only). */
  ventedUntil: number;
  /** True once the impostor bot has been witnessed acting suspicious near the player. */
  witnessed: boolean;
};

export type TaskAttempt = Readonly<{ stationId: string; name: string; kind: TaskKind; seed: number; long: boolean }>;

export type MeetingLine = Readonly<{
  id: number; actorId: ActorId; name: string; color: CrewColorId; text: string; at: number;
}>;

export type VoteTarget = ActorId | "skip";

export type Meeting = {
  reporterId: ActorId; victimId: ActorId | null; startedAt: number; endsAt: number;
  lines: MeetingLine[]; votes: Record<ActorId, VoteTarget>; resolved: boolean;
};

export type EjectionResult = Readonly<{
  actorId: ActorId | null; name: string; color: CrewColorId; role: Role | null; impostorCount: number;
}>;

export type MatchEventKind =
  | "info" | "task-done" | "task-failed" | "kill" | "report" | "meeting" | "vote" | "eject"
  | "sabotage" | "sabotage-fixed" | "prompt" | "camera" | "win" | "lose";

export type MatchEvent = Readonly<{
  id: number; kind: MatchEventKind; text: string; at: number; actorId?: ActorId; sabotage?: SabotageKind;
}>;

export type PlayerInput = Readonly<{
  up: boolean; down: boolean; left: boolean; right: boolean;
  /** World-space tap destination, already converted through the camera. */
  destination: Vec | null;
}>;

export type MatchConfig = Readonly<{
  seed: number; tier: Tier; playerRole: Role; botCount: number;
  /** Player display name; `friendId` keeps the numeric identity. */
  playerName: string; friendId: string;
}>;

export type MatchSummary = Readonly<{
  outcome: "crew-win" | "impostor-win" | "timeout";
  playerWon: boolean; playerRole: Role; playerAlive: boolean;
  tasksDone: number; tasksTotal: number;
  correctVotes: number; wrongVotes: number; reported: number; kills: number;
  stars: 1 | 2 | 3; rank: string; salvagePoints: number;
}>;

export type MatchState = {
  config: MatchConfig; station: Station;
  phase: MatchPhase; time: number;
  actors: Actor[]; playerId: ActorId;
  activeTask: TaskAttempt | null;
  meeting: Meeting | null; ejection: EjectionResult | null;
  sabotage: SabotageKind; sabotageEndsAt: number;
  /** Interaction prompt the HUD should show, or null. */
  prompt: Readonly<{ id: string; label: string; kind: "task" | "emergency" | "report" | "vent" | "kill" }> | null;
  tasksTotal: number; tasksDone: number;
  /** Crew-wide task fraction used by the crew win condition. */
  crewProgress: number;
  alarm: string; events: MatchEvent[];
  version: number;
  summary: MatchSummary | null;
};

/** Public engine surface used by the renderer, the task overlay and the UI. */
export type Match = {
  readonly state: MatchState;
  update(dtSeconds: number, input: PlayerInput): void;
  /** E / tap on the current prompt. */
  interact(): void;
  /** Kill (impostor, in reach) — Q / button. */
  ability(): void;
  /** Vent in / out (impostor) — R / button. */
  vent(): void;
  /** Called by the task overlay when a minigame finishes. */
  finishTask(stationId: string, success: boolean, roll: number): void;
  /** Cancel an open minigame. */
  cancelTask(): void;
  vote(target: VoteTarget): void;
  /** Advance past briefing / ejection / debrief screens. */
  advance(): void;
  drainEvents(): MatchEvent[];
};

export const TASK_LABELS: Readonly<Record<TaskKind, string>> = Object.freeze({
  wiring: "Repair wiring", keypad: "Enter access code", dials: "Align dials",
  calibrate: "Calibrate engine", sample: "Analyse sample", reboot: "Reboot terminal",
});

export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
