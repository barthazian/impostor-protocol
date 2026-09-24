/**
 * The four tamper tests. Each one breaks the log in a specific way and must be
 * caught by a specific check — a tamper that passes silently is a bug here, and
 * a check that rejects everything is worthless, so every test reports the
 * induced failure verbatim.
 */
import type { PlayerInput } from "../../../games/impostor-protocol/src/types";

import {
  DROP_TABLE, actionsDigest, buildTree, eventsOfKind, logProblems, roll, verifyProof,
  type RoomLog,
} from "./format";
import { replayLog } from "./rebuild";
import type { BuiltRoom } from "./room";

export type TamperResult = Readonly<{
  id: string; name: string; required: string; induced: readonly string[]; pass: boolean;
}>;

function clone(log: RoomLog): RoomLog {
  return JSON.parse(JSON.stringify(log)) as RoomLog;
}

/** Clear the lowest set direction bit — exactly one byte of one frame. */
function flipLowestBit(input: PlayerInput): PlayerInput {
  if (input.up) return { ...input, up: false };
  if (input.down) return { ...input, down: false };
  if (input.left) return { ...input, left: false };
  if (input.right) return { ...input, right: false };
  return input;
}

export function runTampers(roomA: BuiltRoom): TamperResult[] {
  const results: TamperResult[] = [];
  const published = roomA.log;
  const settle = eventsOfKind(published.streams.match, "settle")[0];
  const publishedHash = settle.stateHash;

  /* ---- T1: flip one input byte → the replayed state must diverge -------- */
  {
    const tampered = clone(published);
    const slot = 2;
    const sealed = tampered.sealed[String(slot)];
    const actions = sealed.actions as PlayerInput[];
    const codeOf = (input: PlayerInput) => (input.up ? 1 : 0) | (input.down ? 2 : 0) | (input.left ? 4 : 0) | (input.right ? 8 : 0);
    // A single-frame edit mid-round is often re-absorbed: these walks drive into
    // walls, and once an axis is pinned to the same wall the missing 2.58 units
    // stop mattering. The tamper therefore edits the TAIL of the run, where
    // nothing is left to absorb it. (The seal catches the edit at ANY frame —
    // that is the commitment line in the report.)
    const starts: number[] = [];
    for (let frame = 1; frame < actions.length; frame++) {
      if (codeOf(actions[frame]) !== 0 && codeOf(actions[frame]) !== codeOf(actions[frame - 1])) starts.push(frame);
    }
    const candidates = starts.slice(-24).reverse();
    const induced: string[] = [];
    let used = -1;
    for (const frame of candidates) {
      const pristine = actions[frame];
      actions[frame] = flipLowestBit(pristine);
      const replayed = replayLog(tampered, "forward");
      const diverged = replayed.stateHash !== publishedHash;
      if (diverged) {
        used = frame;
        const flipped = actions[frame];
        induced.push(`one byte of slot ${slot}: frame ${frame} of ${actions.length} 0x0${codeOf(pristine)} -> 0x0${codeOf(flipped)} (the last leg of the run is cut short)`);
        induced.push(`commitment: ${replayed.problems.find(problem => /commitment/.test(problem)) ?? "NOT REPORTED"}`);
        induced.push(`state:      published state hash = ${publishedHash}`);
        induced.push(`            replayed  state hash = ${replayed.stateHash}`);
        induced.push(`            verifier rejects the replayed hash: ${!replayed.stateHashAgrees}`);
        break;
      }
      actions[frame] = pristine;
    }
    const pass = used >= 0;
    if (used < 0) induced.push(`NO DIVERGENCE FOUND across ${candidates.length} candidate frames — the state hash did not move`);
    else induced.push(`frames tried = ${candidates.indexOf(used) + 1} of ${candidates.length}`);
    results.push({
      id: "T1", name: "flip one input byte → state hash mismatch",
      required: "state hash mismatch", induced, pass,
    });
  }

  /* ---- T2: flip one drip → merkle root must move ------------------------ */
  {
    const tampered = clone(published);
    const draw = eventsOfKind(tampered.streams.economy, "cache-draw").find(entry => entry.slot === 3 && entry.passIndex === 0);
    const replacement = DROP_TABLE.find(entry => entry.id === "genesis-artifact")!;
    draw.drip = replacement.id;
    draw.label = replacement.label;
    draw.rfCents = replacement.rfCents;

    const problems = logProblems(tampered);
    const joins = eventsOfKind(tampered.streams.match, "join");
    const draws = eventsOfKind(tampered.streams.economy, "cache-draw");
    const recomputedLeaves = joins.map(join => ({
      wallet: join.wallet,
      amountCents: draws.filter(entry => entry.slot === join.slot).reduce((sum, entry) => sum + entry.rfCents, 0),
    }));
    const tamperedRoot = buildTree(recomputedLeaves).root;
    const replayed = replayLog(tampered, "forward");
    const trueRoll = roll(settle.seedDrop, 3, 0);
    const claim = eventsOfKind(tampered.streams.match, "claim").find(entry => entry.slot === 3);
    const claimRejected = claim
      ? !verifyProof({ wallet: claim.wallet, amountCents: claim.amountCents }, claim.proof, tamperedRoot)
      : false;
    const induced: string[] = [];
    induced.push(`draw:      slot 3 pass 0 published as "${draw.drip}" (${draw.rfCents}c); roll(seedDrop, 3, 0) says "${trueRoll.id}" (${trueRoll.rfCents}c) → verifier agrees: ${replayed.drops.find(entry => entry.slot === 3)?.agrees}`);
    induced.push(`root:      published root = ${settle.dropRoot}`);
    induced.push(`           root over the tampered drip layer = ${tamperedRoot}`);
    induced.push(`           roots equal: ${tamperedRoot === settle.dropRoot}`);
    induced.push(`claim:     slot 3 proof against the tampered root verifies: ${!claimRejected}`);
    induced.push(`structure: ${problems.slice(0, 3).join(" | ")}`);
    const pass = tamperedRoot !== settle.dropRoot && claimRejected && problems.length > 0 && replayed.problems.length > 0;
    results.push({ id: "T2", name: "flip one drip → merkle root mismatch", required: "root mismatch + verifier rejects the draw", induced, pass });
  }

  /* ---- T3: drop one join event → the log must be rejected -------------- */
  {
    const tampered = clone(published);
    tampered.streams.match = tampered.streams.match.filter(event => !(event.kind === "join" && event.slot === 5)) as RoomLog["streams"]["match"];
    const problems = logProblems(tampered);
    const replayed = replayLog(tampered, "forward");
    const induced = [
      `structure: ${problems.slice(0, 4).join(" | ") || "NOTHING — the log was accepted"}`,
      `replay:    verifier accepts: ${replayed.problems.length === 0}`,
      `replay:    entitlement root over the surviving joins = ${replayed.root}`,
      `replay:    published root = ${settle.dropRoot}`,
    ];
    const pass = problems.some(problem => /join events, expected/.test(problem)) && replayed.problems.length > 0;
    results.push({ id: "T3", name: "drop one join event → rejection", required: "log rejected (missing join)", induced, pass });
  }

  /* ---- T4: reuse a passIndex → rejection ------------------------------- */
  {
    const tampered = clone(published);
    const draw = eventsOfKind(tampered.streams.economy, "cache-draw").find(entry => entry.slot === 1 && entry.passIndex === 0)!;
    tampered.streams.economy.push({ ...draw });
    const problems = logProblems(tampered);
    const replayed = replayLog(tampered, "forward");
    const induced = [
      `structure: ${problems.slice(0, 4).join(" | ") || "NOTHING — the log was accepted"}`,
      `replay:    verifier accepts: ${replayed.problems.length === 0}`,
      `replay:    drops checked = ${replayed.drops.length}, all agree = ${replayed.drops.every(entry => entry.agrees)}`,
    ];
    const pass = problems.some(problem => /reused \(slot 1, passIndex 0\)/.test(problem)) && replayed.problems.length > 0;
    results.push({ id: "T4", name: "reuse a passIndex → rejection", required: "duplicate (slot, passIndex) rejected", induced, pass });
  }

  return results;
}
