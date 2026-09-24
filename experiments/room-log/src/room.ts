/**
 * Building one room's log.
 *
 * The steward draws TWO independent secrets per room (seedMatch, seedDrop),
 * commits to both at genesis, and never publishes either preimage early: the
 * drops are computed AT JOIN (so the room's cost is known before play) but the
 * log marks them `hiddenUntil: "settle"`; seedMatch is only revealed by the
 * close event.
 *
 * The whole build is a deterministic function of (spec, STEWARD_SECRET): no
 * Math.random, no clock, no network.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { createMatch } from "../../../games/impostor-protocol/src/sim";
import { createRng, hashSeed } from "../../../games/impostor-protocol/src/rng";
import type { MatchConfig, PlayerInput, Role, Tier } from "../../../games/impostor-protocol/src/types";

import { stateDigest } from "./digest";
import {
  LOG_VERSION, PASS_PRICE_CENTS, SLOT_COUNT, actionsDigest, buildTree, commitDropSeed, commitMatchSeed,
  proofFor, roll, sha256hex, walletFor,
  type CacheDrawEvent, type ClaimEvent, type CloseEvent, type DepositEvent, type EconomyClaimEvent,
  type GenesisEvent, type JoinEvent, type MerkleRootEvent, type PassPurchaseEvent, type RoomLog,
  type RosterEntryView, type RunSealedEvent, type SealedStream, type SettleEvent,
} from "./format";

export const STEWARD_SECRET = "ip-room-spike/v1/steward";

/** The steward's two per-room secrets. Independent by domain separation. */
export function secretFor(roomId: string, purpose: "match" | "drop", steward: string = STEWARD_SECRET): string {
  return sha256hex(`${steward}|${roomId}|${purpose}`);
}

export type RoomSpec = Readonly<{
  roomId: string;
  seedMatch: string;
  seedDrop: string;
  /** Per slot: does the human in that seat supply its run before the deadline? */
  supplied: readonly boolean[];
  frames: number;
  roundSeconds: number;
  tier: Tier;
  playerRole: Role;
  botCount: number;
  playerName: string;
  friendId: string;
  sponsor: string;
  supplyCents: number;
}>;

export type DropRecord = Readonly<{ slot: number; passIndex: number; drip: string; label: string; rfCents: number }>;

export type TruthRecord = Readonly<{
  roomId: string; seedMatch: string; seedDrop: string; matchSeed: number;
  commitMatch: string; commitDrop: string;
  impostorIds: readonly string[];
  roster: readonly RosterEntryView[];
  stateHash: string; dropRoot: string;
  drops: readonly DropRecord[];
  amounts: readonly { slot: number; wallet: string; amountCents: number }[];
  backfilledSlots: readonly number[];
  roomCostCents: number;
  passesInCents: number;
}>;

export type BuiltRoom = Readonly<{ log: RoomLog; truth: TruthRecord }>;

const IDLE: PlayerInput = { up: false, down: false, left: false, right: false, destination: null };

/**
 * A slot's run, written down: a seeded walk generator. The generator is only
 * run at BUILD time — the log stores the frames verbatim, so a replay never
 * needs it, and no reader has to trust it.
 */
export function generateActions(tag: string, slot: number, frames: number): PlayerInput[] {
  const rng = createRng(hashSeed(`${tag}:actions:${slot}`));
  const actions: PlayerInput[] = [];
  let direction: readonly [boolean, boolean, boolean, boolean] | null = null;
  let remaining = 0;
  for (let frame = 0; frame < frames; frame++) {
    if (remaining <= 0) {
      if (rng.int(10) < 6) {
        const pick = rng.int(4);
        direction = [pick === 0, pick === 1, pick === 2, pick === 3];
        remaining = 20 + rng.int(40);
      } else {
        direction = null;
        remaining = 5 + rng.int(20);
      }
    }
    remaining--;
    actions.push({
      up: direction ? direction[0] : false,
      down: direction ? direction[1] : false,
      left: direction ? direction[2] : false,
      right: direction ? direction[3] : false,
      destination: null,
    });
  }
  return actions;
}

export function actorIdForSlot(slot: number): string {
  return slot === 0 ? "player" : `bot-${slot - 1}`;
}

export function buildRoomLog(spec: RoomSpec): BuiltRoom {
  if (spec.supplied.length !== SLOT_COUNT) throw new Error(`supplied[] must cover ${SLOT_COUNT} slots`);
  const dt = 1 / 60;
  const frames = spec.frames;
  const commitMatch = commitMatchSeed(spec.seedMatch);
  const commitDrop = commitDropSeed(spec.seedDrop);
  const config: MatchConfig = {
    seed: hashSeed(spec.seedMatch),
    tier: spec.tier,
    playerRole: spec.playerRole,
    botCount: spec.botCount,
    playerName: spec.playerName,
    friendId: spec.friendId,
  };
  const match = createMatch(config);

  // --- joins: wallets, sealed runs, and the cache drawn AT JOIN -----------
  const actionsBySlot = new Map<number, PlayerInput[]>();
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    if (spec.supplied[slot]) actionsBySlot.set(slot, generateActions(spec.roomId, slot, frames));
  }
  const wallets = Array.from({ length: SLOT_COUNT }, (_, slot) => walletFor(spec.roomId, slot));

  // Drawn here — before a single frame of play exists — and only revealed at
  // settle. Nothing that happens in the round can influence these values.
  const drops: DropRecord[] = [];
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const entry = roll(spec.seedDrop, slot, 0);
    drops.push({ slot, passIndex: 0, drip: entry.id, label: entry.label, rfCents: entry.rfCents });
  }
  const amounts = wallets.map((wallet, slot) => ({
    wallet, slot,
    amountCents: drops.filter(drop => drop.slot === slot).reduce((sum, drop) => sum + drop.rfCents, 0),
  }));
  const leaves = amounts.map(amount => ({ wallet: amount.wallet, amountCents: amount.amountCents }));
  const tree = buildTree(leaves);

  const joinAt = (slot: number) => 1 + slot * 0.25;
  const playFrom = 1 + SLOT_COUNT * 0.25;
  const playTo = playFrom + frames * dt;
  const settleAt = playTo + 0.5;

  const matchStream: RoomLog["streams"]["match"] = [];
  const economyStream: RoomLog["streams"]["economy"] = [];
  const sealed: Record<string, SealedStream> = {};

  const genesis: GenesisEvent = {
    stream: "match", kind: "genesis", at: 0,
    roomId: spec.roomId, tier: spec.tier, botCount: spec.botCount, playerRole: spec.playerRole,
    playerName: spec.playerName, friendId: spec.friendId,
    slotCount: SLOT_COUNT, roundSeconds: spec.roundSeconds, frameSeconds: dt, frames,
    sponsor: spec.sponsor, supplyCents: spec.supplyCents, passPriceCents: PASS_PRICE_CENTS,
    commitMatch, commitDrop,
    // The lobby snapshot is public — the seven Friends are literally visible in
    // the room. It carries NO role information.
    roster: match.state.actors.map((actor, slot) => ({ slot, actorId: actor.id, name: actor.name, color: actor.color })),
  };
  matchStream.push(genesis);
  const deposit: DepositEvent = { stream: "economy", kind: "deposit", at: 0, sponsor: spec.sponsor, amountCents: spec.supplyCents };
  economyStream.push(deposit);

  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const supplied = spec.supplied[slot];
    const actions = actionsBySlot.get(slot) ?? null;
    const commitment = actions ? actionsDigest(actions) : null;
    const join: JoinEvent = {
      stream: "match", kind: "join", at: joinAt(slot), slot,
      actorId: actorIdForSlot(slot), wallet: wallets[slot], supplied, frames: supplied ? frames : 0,
      actionsCommitment: commitment,
    };
    matchStream.push(join);
    if (actions && commitment) {
      const runSealed: RunSealedEvent = { stream: "match", kind: "run-sealed", at: joinAt(slot), slot, frames, actionsCommitment: commitment };
      matchStream.push(runSealed);
      sealed[String(slot)] = { slot, frames, actionsCommitment: commitment, actions, revealedAt: settleAt };
    }
    const pass: PassPurchaseEvent = { stream: "economy", kind: "pass-purchase", at: joinAt(slot), slot, wallet: wallets[slot], priceCents: PASS_PRICE_CENTS };
    economyStream.push(pass);
    const drop = drops[slot];
    const draw: CacheDrawEvent = {
      stream: "economy", kind: "cache-draw", at: joinAt(slot), slot, wallet: wallets[slot], passIndex: drop.passIndex,
      drip: drop.drip as CacheDrawEvent["drip"], label: drop.label, rfCents: drop.rfCents, hiddenUntil: "settle",
    };
    economyStream.push(draw);
  }

  // --- play: every seat driven from its own input map ---------------------
  match.advance();
  const actorIdBySlot = new Map(matchStream.filter(event => event.kind === "join").map(event => [event.slot, event.actorId]));
  for (let frame = 0; frame < frames; frame++) {
    const frameMap: Record<string, PlayerInput> = {};
    for (const [slot, actions] of actionsBySlot) frameMap[actorIdBySlot.get(slot) ?? actorIdForSlot(slot)] = actions[frame];
    if (Object.keys(frameMap).length > 0) match.update(dt, IDLE, frameMap);
    else match.update(dt, IDLE);
  }

  // --- close: the role layer's preimage becomes public --------------------
  const close: CloseEvent = {
    stream: "match", kind: "close", at: playTo, revealSeedMatch: spec.seedMatch,
    runs: Array.from(actionsBySlot.entries()).map(([slot, actions]) => {
      const commitment = sealed[String(slot)].actionsCommitment;
      const actionsHash = actionsDigest(actions);
      return { slot, actionsHash, commitment, matches: actionsHash === commitment };
    }),
  };
  matchStream.push(close);

  // --- settle: the drip layer's preimage, the state hash, the root --------
  const stateHash = stateDigest(match.state);
  const settle: SettleEvent = {
    stream: "match", kind: "settle", at: settleAt,
    seedDrop: spec.seedDrop, stateHash, dropRoot: tree.root, leaves,
  };
  matchStream.push(settle);
  const root: MerkleRootEvent = {
    stream: "economy", kind: "merkle-root", at: settleAt, root: tree.root,
    leaves: leaves.length, totalCents: leaves.reduce((sum, leaf) => sum + leaf.amountCents, 0),
  };
  economyStream.push(root);

  // --- claims: each holder proves their share whenever they like ----------
  let claimAt = settleAt + 1;
  for (const amount of amounts) {
    const { proof, root: proofRoot } = proofFor(leaves, amount.wallet);
    const verified = proofRoot === tree.root;
    const claim: ClaimEvent = {
      stream: "match", kind: "claim", at: claimAt, slot: amount.slot, wallet: amount.wallet,
      amountCents: amount.amountCents, root: tree.root, proof, verified,
    };
    matchStream.push(claim);
    const ledger: EconomyClaimEvent = {
      stream: "economy", kind: "claim", at: claimAt, slot: amount.slot, wallet: amount.wallet,
      amountCents: amount.amountCents, root: tree.root, verified,
    };
    economyStream.push(ledger);
    claimAt += 0.25;
  }

  const log: RoomLog = {
    version: LOG_VERSION,
    roomId: spec.roomId,
    frameSeconds: dt,
    frames,
    streams: { match: matchStream, economy: economyStream },
    sealed,
  };

  const truth: TruthRecord = {
    roomId: spec.roomId,
    seedMatch: spec.seedMatch,
    seedDrop: spec.seedDrop,
    matchSeed: config.seed,
    commitMatch, commitDrop,
    impostorIds: match.state.actors.filter(actor => actor.role === "impostor").map(actor => actor.id),
    roster: genesis.roster,
    stateHash,
    dropRoot: tree.root,
    drops,
    amounts,
    backfilledSlots: spec.supplied.map((supplied, slot) => (supplied ? -1 : slot)).filter(slot => slot >= 0),
    roomCostCents: leaves.reduce((sum, leaf) => sum + leaf.amountCents, 0),
    passesInCents: SLOT_COUNT * PASS_PRICE_CENTS,
  };

  return { log, truth };
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** The public room-a shape: seven seats, every seat supplied, 3-minute round. */
export function specFor(roomId: string, options: Partial<RoomSpec> = {}): RoomSpec {
  return {
    roomId,
    seedMatch: secretFor(roomId, "match"),
    seedDrop: secretFor(roomId, "drop"),
    supplied: Array.from({ length: SLOT_COUNT }, () => true),
    frames: 180 * 60,
    roundSeconds: 180,
    tier: "standard",
    playerRole: "crew",
    botCount: 6,
    playerName: "Slot0",
    friendId: "0",
    sponsor: "0x5pons0r0000000000000000000000000000000000",
    supplyCents: 100_000_00,
    ...options,
  };
}
