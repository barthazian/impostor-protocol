/**
 * Screen contract: the props `index.tsx` passes to every React screen in
 * `ui.tsx`. Both files compile against this, so neither can drift.
 */
import type {
  ActorId, CrewColorId, EjectionResult, MatchState, MatchSummary, Role, Tier, VoteTarget,
} from "./types";

export type RosterEntry = Readonly<{
  id: ActorId; name: string; color: CrewColorId; tag: string; isPlayer: boolean;
}>;

export type LobbyProps = Readonly<{
  friendId: string; stationName: string;
  tier: Tier; onTier: (tier: Tier) => void;
  roomCode: string; onRoomCode: (value: string) => void; onRandomRoom: () => void;
  roleChoice: Role | "random"; onRoleChoice: (role: Role | "random") => void;
  roster: readonly RosterEntry[];
  passes: bigint; rfBalance: bigint; freeStake: bigint; maxPrize: bigint; price: bigint;
  simulated: boolean; busy: boolean; error: string; note: string;
  onStart: () => void; onLocker: () => void; onSettings: () => void;
  salvage: number;
}>;

export type HudProps = Readonly<{
  state: MatchState; muted: boolean; onToggleMute: () => void; onMenu: () => void;
  onTaskList: () => void; onAbility: () => void; onVent: () => void; visionLabel: string;
}>;

export type BriefingProps = Readonly<{
  state: MatchState; roster: readonly RosterEntry[]; impostorCount: number;
  onBegin: () => void; reducedMotion: boolean; onReducedMotion: (value: boolean) => void;
}>;

export type MeetingProps = Readonly<{
  state: MatchState; roster: readonly RosterEntry[]; remaining: number;
  localVotes: Readonly<Record<ActorId, VoteTarget>>;
  onVote: (target: VoteTarget) => void;
}>;

export type EjectionProps = Readonly<{
  ejection: EjectionResult; onContinue: () => void; remaining: number;
}>;

export type CacheOffer = Readonly<{
  playId: bigint; opened: boolean; outcomeId: number | null;
  name: string; reward: bigint; chanceBps: number;
}>;

export type InventoryRow = Readonly<{
  outcomeId: number; name: string; reward: bigint; chanceBps: number; count: bigint;
}>;

export type DebriefProps = Readonly<{
  summary: MatchSummary; state: MatchState;
  caches: readonly CacheOffer[]; onOpenCache: (playId: bigint) => void;
  inventory: readonly InventoryRow[]; onRedeem: (outcomeId: number) => void;
  busy: boolean; error: string; message: string; finishNote: string;
  onPlayAgain: () => void; onLobby: () => void; simulated: boolean;
}>;

export type CosmeticRow = Readonly<{
  id: string; name: string; cost: number; owned: boolean; equipped: boolean; color: string;
}>;

export type LockerProps = Readonly<{
  inventory: readonly InventoryRow[]; salvage: number; rank: string; bestStars: number;
  cosmetics: readonly CosmeticRow[]; onBuyCosmetic: (id: string) => void;
  pending: readonly CacheOffer[]; onOpenCache: (playId: bigint) => void;
  onRedeem: (outcomeId: number) => void;
  onClose: () => void; simulated: boolean; busy: boolean; error: string; message: string;
}>;

export type SettingsProps = Readonly<{
  muted: boolean; onMute: (muted: boolean) => void;
  reducedMotion: boolean; onReducedMotion: (value: boolean) => void;
  onClose: () => void; mode: "preview" | "chain";
}>;

export type TaskListProps = Readonly<{
  state: MatchState; onClose: () => void; visible: boolean;
}>;
