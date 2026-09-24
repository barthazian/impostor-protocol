/**
 * The replay verifier — the trust anchor.
 *
 * It is handed ONE public log and nothing else (no steward secrets, no truth
 * sidecar) and recomputes:
 *
 *   1. every sealed run against the commitment its slot made at join;
 *   2. the close reveal against the genesis match commitment;
 *   3. the whole match, frame by frame, from the revealed seed and the revealed
 *      action streams, ending in a state hash that must equal the settle-time
 *      `stateHash`;
 *   4. every cache from `roll(seedDrop, slot, passIndex)` alone;
 *   5. the entitlement tree and the published root, and every claim proof.
 *
 * `order` only changes the order in which independent work is done — the drip
 * layer before or after the match, slots ascending or descending, action
 * streams preloaded or read on demand. Everything that is order-independent
 * must come out byte-identical; the frame fold itself is order-dependent by
 * nature and both orders run the same one.
 */
import { createMatch } from "../../../games/impostor-protocol/src/sim";
import { hashSeed } from "../../../games/impostor-protocol/src/rng";
import type { MatchConfig, PlayerInput } from "../../../games/impostor-protocol/src/types";

import { stateDigest } from "./digest";
import {
  actionsDigest, buildTree, commitMatchSeed, eventsOfKind, genesisOf, logProblems, proofFor, roll, verifyProof,
  type CacheDrawEvent, type RoomLog, type SettleEvent,
} from "./format";

export type ReplayOrder = "forward" | "reverse";

export type DropCheck = Readonly<{
  slot: number; passIndex: number; recomputed: string; published: string;
  recomputedCents: number; publishedCents: number; agrees: boolean;
}>;

export type ReplayResult = Readonly<{
  replayOrder: ReplayOrder;
  roomId: string;
  problems: readonly string[];
  frames: number;
  commitmentsChecked: number;
  commitmentsOk: boolean;
  closeRevealOk: boolean;
  stateHash: string | null;
  publishedStateHash: string;
  stateHashAgrees: boolean;
  finalPhase: string | null;
  simTime: number | null;
  drops: readonly DropCheck[];
  root: string | null;
  publishedRoot: string | null;
  rootAgrees: boolean;
  claimsVerified: number;
  claimsExpected: number;
  backfilledSlots: readonly number[];
  actors: readonly { id: string; role: string; alive: boolean; tasksDone: number; x: number; y: number }[];
}>;

const IDLE: PlayerInput = { up: false, down: false, left: false, right: false, destination: null };

export function replayLog(log: RoomLog, order: ReplayOrder = "forward"): ReplayResult {
  const problems: string[] = logProblems(log);
  const genesis = genesisOf(log);
  const joins = [...eventsOfKind(log.streams.match, "join")].sort((a, b) => a.slot - b.slot);
  const supplied = joins.filter(join => join.supplied);
  const settles = eventsOfKind(log.streams.match, "settle") as readonly SettleEvent[];
  const settle = settles[0] ?? null;
  const closes = eventsOfKind(log.streams.match, "close");
  const draws = eventsOfKind(log.streams.economy, "cache-draw") as readonly CacheDrawEvent[];
  const slotOrder = order === "forward"
    ? joins.map(join => join.slot)
    : joins.map(join => join.slot).reverse();

  /* ---- 1. the drip layer: pure function of seedDrop -------------------- */
  const checkDrips = (): { drops: DropCheck[]; leaves: { wallet: string; amountCents: number }[]; root: string | null } => {
    const drops: DropCheck[] = [];
    const leaves: { wallet: string; amountCents: number }[] = [];
    for (const slot of slotOrder) {
      const join = joins.find(entry => entry.slot === slot);
      if (!join || !settle) continue;
      const own = draws.filter(draw => draw.slot === slot).sort((a, b) => a.passIndex - b.passIndex);
      let owed = 0;
      for (const draw of own) {
        const entry = roll(settle.seedDrop, draw.slot, draw.passIndex);
        owed += entry.rfCents;
        drops.push({
          slot: draw.slot, passIndex: draw.passIndex,
          recomputed: entry.id, published: draw.drip,
          recomputedCents: entry.rfCents, publishedCents: draw.rfCents,
          agrees: entry.id === draw.drip && entry.rfCents === draw.rfCents,
        });
      }
      leaves.push({ wallet: join.wallet, amountCents: owed });
    }
    return { drops, leaves, root: leaves.length > 0 ? buildTree(leaves).root : null };
  };

  /* ---- 2. the sealed runs and the close reveal -------------------------- */
  const checkCommitments = (): { checked: number; ok: boolean } => {
    let checked = 0;
    let ok = true;
    for (const slot of slotOrder) {
      const join = joins.find(entry => entry.slot === slot);
      if (!join || !join.supplied) continue;
      const sealed = log.sealed[String(slot)];
      if (!sealed || !sealed.actions) { ok = false; problems.push(`slot ${slot}: sealed stream missing`); continue; }
      checked++;
      if (actionsDigest(sealed.actions) !== join.actionsCommitment) {
        ok = false;
        problems.push(`slot ${slot}: revealed run does not match its join commitment`);
      }
    }
    let closeOk = true;
    if (closes.length === 1 && closes[0].revealSeedMatch) {
      closeOk = commitMatchSeed(closes[0].revealSeedMatch) === genesis.commitMatch;
      if (!closeOk) problems.push("close reveal does not open the genesis match commitment");
    } else {
      closeOk = false;
      problems.push("no close reveal to check");
    }
    return { checked, ok: ok && closeOk };
  };

  /* ---- 3. the match: one deterministic fold over the frames ------------- */
  const rebuildMatch = (): { stateHash: string; phase: string; time: number; actors: ReplayResult["actors"] } | null => {
    if (closes.length !== 1) return null;
    const config: MatchConfig = {
      seed: hashSeed(closes[0].revealSeedMatch),
      tier: genesis.tier, playerRole: genesis.playerRole, botCount: genesis.botCount,
      playerName: genesis.playerName, friendId: genesis.friendId,
    };
    const match = createMatch(config);
    match.advance();
    const actorIdBySlot = new Map(joins.map(join => [join.slot, join.actorId]));
    if (order === "reverse") {
      // Preload every stream, then walk the frames.
      const preloaded = slotOrder
        .map(slot => ({ actorId: actorIdBySlot.get(slot) ?? "", actions: log.sealed[String(slot)]?.actions ?? null }))
        .filter(entry => entry.actions !== null) as { actorId: string; actions: PlayerInput[] }[];
      for (let frame = 0; frame < log.frames; frame++) {
        const frameMap: Record<string, PlayerInput> = {};
        for (const entry of preloaded) frameMap[entry.actorId] = entry.actions[frame];
        if (Object.keys(frameMap).length > 0) match.update(log.frameSeconds, IDLE, frameMap);
        else match.update(log.frameSeconds, IDLE);
      }
    } else {
      for (let frame = 0; frame < log.frames; frame++) {
        const frameMap: Record<string, PlayerInput> = {};
        for (const slot of slotOrder) {
          const actorId = actorIdBySlot.get(slot) ?? "";
          const actions = log.sealed[String(slot)]?.actions;
          if (actions) frameMap[actorId] = actions[frame];
        }
        if (Object.keys(frameMap).length > 0) match.update(log.frameSeconds, IDLE, frameMap);
        else match.update(log.frameSeconds, IDLE);
      }
    }
    return {
      stateHash: stateDigest(match.state),
      phase: match.state.phase,
      time: match.state.time,
      actors: match.state.actors.map(actor => ({
        id: actor.id, role: actor.role, alive: actor.alive, tasksDone: actor.tasksDone,
        x: actor.pos.x, y: actor.pos.y,
      })),
    };
  };

  /* ---- 4. claims -------------------------------------------------------- */
  const checkClaims = (leaves: readonly { wallet: string; amountCents: number }[], root: string | null): number => {
    let verified = 0;
    for (const claim of eventsOfKind(log.streams.match, "claim")) {
      const leaf = leaves.find(entry => entry.wallet === claim.wallet);
      if (leaf && root && verifyProof(leaf, claim.proof, root)) verified++;
      else problems.push(`claim for ${claim.wallet} does not verify`);
    }
    for (const claim of eventsOfKind(log.streams.economy, "claim")) {
      const leaf = leaves.find(entry => entry.wallet === claim.wallet);
      if (!leaf || !root) { problems.push(`ledger claim for ${claim.wallet} has no leaf`); continue; }
      const proof = proofFor(leaves, claim.wallet);
      if (!verifyProof(leaf, proof.proof, root)) problems.push(`ledger claim for ${claim.wallet} does not verify`);
    }
    return verified;
  };

  let drip: { drops: DropCheck[]; leaves: { wallet: string; amountCents: number }[]; root: string | null };
  let commitments: { checked: number; ok: boolean };
  let rebuilt: ReturnType<typeof rebuildMatch>;
  let claimsVerified: number;
  if (order === "forward") {
    drip = checkDrips();
    commitments = checkCommitments();
    rebuilt = rebuildMatch();
    claimsVerified = checkClaims(drip.leaves, drip.root);
  } else {
    commitments = checkCommitments();
    rebuilt = rebuildMatch();
    drip = checkDrips();
    claimsVerified = checkClaims(drip.leaves, drip.root);
  }

  if (settle && drip.root !== settle.dropRoot) problems.push("recomputed entitlement root differs from the published root");
  if (rebuilt && settle && rebuilt.stateHash !== settle.stateHash) {
    problems.push("replayed state hash differs from the published state hash");
  }

  return {
    replayOrder: order,
    roomId: genesis.roomId,
    problems,
    frames: log.frames,
    commitmentsChecked: commitments.checked,
    commitmentsOk: commitments.ok,
    closeRevealOk: commitments.ok,
    stateHash: rebuilt ? rebuilt.stateHash : null,
    publishedStateHash: settle ? settle.stateHash : "",
    stateHashAgrees: Boolean(rebuilt && settle && rebuilt.stateHash === settle.stateHash),
    finalPhase: rebuilt ? rebuilt.phase : null,
    simTime: rebuilt ? rebuilt.time : null,
    drops: drip.drops,
    root: drip.root,
    publishedRoot: settle ? settle.dropRoot : null,
    rootAgrees: Boolean(settle && drip.root === settle.dropRoot),
    claimsVerified,
    claimsExpected: eventsOfKind(log.streams.match, "claim").length,
    backfilledSlots: supplied.length === joins.length ? [] : joins.filter(join => !join.supplied).map(join => join.slot),
    actors: rebuilt ? rebuilt.actors : [],
  };
}
