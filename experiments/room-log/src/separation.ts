/**
 * Seed separation — the load-bearing property.
 *
 * seedMatch decides the station, the roles and the bots and stays sealed until
 * close. seedDrop decides the caches and is published with the settlement. If
 * publishing the drops leaked seedMatch, the no-tell rule would collapse: the
 * drip layer would tell you who the impostors are.
 *
 * Three things are done here, in order:
 *
 *   1. INDEPENDENCE — fixture rooms driven from the same two secrets in a
 *      crossed pattern: same seedDrop + different seedMatch (identical drip
 *      layer, different roles) and same seedMatch + different seedDrop
 *      (identical roles, different drip layer). One published drip layer
 *      therefore corresponds to more than one role assignment.
 *   2. THE ATTEMPT — every candidate a reader can build from the published view
 *      (and the game's entire 4-character room-code space) is run through the
 *      shipped role derivation and tested against the room's public lobby
 *      fingerprint + the true impostor set. Reported, hits and all.
 *   3. THE CONTROL — with the seedMatch that close reveals, the same derivation
 *      reproduces the room exactly. The attempt fails because the secret is
 *      sealed, not because the method cannot work.
 */
import { createRng, hashSeed } from "../../../games/impostor-protocol/src/rng";
import { createMatch, createRoster, playerColorFor } from "../../../games/impostor-protocol/src/sim";
import { ROOM_CODE_ALPHABET } from "../../../games/impostor-protocol/src/types";

import { DROP_TABLE, publishedView, roll, sha256hex, type RosterEntryView, type RoomLog } from "./format";
import { buildRoomLog, specFor, type BuiltRoom } from "./room";

export type SeparationReport = Readonly<{ pass: boolean; lines: readonly string[]; detail: Readonly<Record<string, unknown>> }>;

function fingerprint(roster: readonly RosterEntryView[]): string {
  return roster.map(entry => `${entry.actorId}:${entry.name}:${entry.color}`).join("|");
}

/** The lobby fingerprint of an arbitrary seed — the shipped roster function. */
function fingerprintForSeed(seed: number): string {
  const roster = createRoster({ seed, botCount: 6, playerName: "Slot0", playerColor: playerColorFor(seed) });
  return roster.map(entry => `${entry.id}:${entry.name}:${entry.color}`).join("|");
}

/**
 * The engine's role draw, mirrored: `shuffle(createRng(hashSeed(seed:roles)),
 * botEntries).slice(0, 2)`. The bot ids are `bot-0..bot-5` in actor order and do
 * not depend on the seed, so this is the impostor set as a function of the seed
 * alone. Validated against the shipped `createMatch` below.
 */
function impostorSetForSeed(seed: number): string[] {
  const rng = createRng(hashSeed(`${seed}:roles`));
  const ids = ["bot-0", "bot-1", "bot-2", "bot-3", "bot-4", "bot-5"];
  for (let index = ids.length - 1; index > 0; index--) {
    const swap = rng.int(index + 1);
    const held = ids[index];
    ids[index] = ids[swap];
    ids[swap] = held;
  }
  return ids.slice(0, 2).sort();
}

function truthRoles(seed: number, playerName: string, friendId: string): string[] {
  const match = createMatch({ seed, tier: "standard", playerRole: "crew", botCount: 6, playerName, friendId });
  return match.state.actors.filter(actor => actor.role === "impostor").map(actor => actor.id).sort();
}

export function runSeparation(roomA: BuiltRoom, frames: number, sweep: boolean): SeparationReport {
  const lines: string[] = [];
  const detail: Record<string, unknown> = {};
  const truth = roomA.truth;
  const log: RoomLog = roomA.log;
  const target = fingerprint(truth.roster);
  const trueSet = [...truth.impostorIds].sort().join(",");

  /* ---- 1. independence ------------------------------------------------ */
  const M1 = sha256hex("sep-fixture-match-1");
  const M2 = sha256hex("sep-fixture-match-2");
  const D1 = sha256hex("sep-fixture-drop-1");
  const D2 = sha256hex("sep-fixture-drop-2");
  const fixture = (roomId: string, seedMatch: string, seedDrop: string): BuiltRoom =>
    buildRoomLog(specFor(roomId, { frames, seedMatch, seedDrop }));

  let sepA = fixture("SEP-1", M1, D1);
  let sepB = fixture("SEP-2", M2, D1);
  let sepC = fixture("SEP-3", M1, D2);
  const dropLine = (room: BuiltRoom) => room.truth.drops.map(drop => `${drop.slot}:${drop.drip}/${drop.rfCents}`).join(" ");
  for (let attempt = 2; attempt <= 32 && fingerprint(sepB.truth.roster) === fingerprint(sepA.truth.roster); attempt++) {
    sepB = fixture("SEP-2", sha256hex(`sep-fixture-match-2#${attempt}`), D1);
  }
  for (let attempt = 2; attempt <= 32 && dropLine(sepC) === dropLine(sepA); attempt++) {
    sepC = fixture("SEP-3", M1, sha256hex(`sep-fixture-drop-2#${attempt}`));
  }
  const sameDropSame = dropLine(sepA) === dropLine(sepB);
  const rolesDiffer = sepA.truth.impostorIds.slice().sort().join(",") !== sepB.truth.impostorIds.slice().sort().join(",");
  const sameMatchSame = sepA.truth.impostorIds.slice().sort().join(",") === sepC.truth.impostorIds.slice().sort().join(",");
  const dropDiffers = dropLine(sepA) !== dropLine(sepC);
  const rosterSameAcrossM = fingerprint(sepA.truth.roster) === fingerprint(sepC.truth.roster);
  lines.push("1. INDEPENDENCE (crossed fixture rooms, same code path as ROOM-A)");
  lines.push(`   same seedDrop, different seedMatch : drip layer identical = ${sameDropSame ? "YES" : "NO"} | roles differ = ${rolesDiffer ? "YES" : "NO"}`);
  lines.push(`     drips  = ${dropLine(sepA)}`);
  lines.push(`     roles  = [${sepA.truth.impostorIds.join(", ")}] vs [${sepB.truth.impostorIds.join(", ")}]`);
  lines.push(`   same seedMatch, different seedDrop : roles identical = ${sameMatchSame ? "YES" : "NO"} | roster identical = ${rosterSameAcrossM ? "YES" : "NO"} | drips differ = ${dropDiffers ? "YES" : "NO"}`);
  lines.push(`     drips  = ${dropLine(sepA)}`);
  lines.push(`     drips  = ${dropLine(sepC)}`);
  Object.assign(detail, { fixtureDripsA: dropLine(sepA), fixtureDripsB: dropLine(sepB), fixtureDripsC: dropLine(sepC), fixtureRolesA: sepA.truth.impostorIds, fixtureRolesB: sepB.truth.impostorIds, fixtureRolesC: sepC.truth.impostorIds });
  const independenceOk = sameDropSame && rolesDiffer && sameMatchSame && dropDiffers;

  /* ---- 2a. the published view, and what is in it ----------------------- */
  const view = publishedView(log) as Record<string, any>;
  const viewText = JSON.stringify(view);
  const viewHasSeedMatch = viewText.includes(truth.seedMatch);
  const viewHasSeedDrop = viewText.includes(truth.seedDrop);
  const viewHasActions = JSON.stringify(view).includes("actions") && Array.isArray(view.joins) && view.joins.some((join: any) => Array.isArray(join.actions));
  const viewDraws = Array.isArray(view.economy) ? view.economy.filter((event: any) => event.kind === "cache-draw") : [];
  lines.push("\n2. THE PUBLISHED VIEW (everything a reader has after settlement, before close)");
  lines.push(`   cache draws with outcomes and amounts : ${viewDraws.length} (${viewDraws.map((draw: any) => `s${draw.slot}:${draw.drip}/${draw.rfCents}c`).join(" ")})`);
  lines.push(`   contains the seedDrop preimage         : ${viewHasSeedDrop ? "YES (revealed with the settlement)" : "NO"}`);
  lines.push(`   contains seedMatch                     : ${viewHasSeedMatch ? "YES (LEAK)" : "NO — still sealed"}`);
  lines.push(`   contains any revealed action stream    : ${viewHasActions ? "YES (LEAK)" : "NO — sealed to a hash"}`);

  /* ---- 2b. derivation attempt A: every candidate the view can build ---- */
  const strings: string[] = [];
  const push = (value: unknown) => { if (typeof value === "string" && value.length > 0) strings.push(value); };
  push(view.roomId); push(view.genesis?.commitMatch); push(view.genesis?.commitDrop); push(view.genesis?.sponsor);
  push(view.genesis?.playerName); push(view.genesis?.friendId);
  push(view.settle?.seedDrop); push(view.settle?.stateHash); push(view.settle?.dropRoot);
  for (const join of view.joins ?? []) { push(join.wallet); push(join.actionsCommitment); }
  for (const event of view.economy ?? []) {
    push(event.root); push(event.drip); push(event.label); push(event.wallet); push(String(event.rfCents)); push(String(event.amountCents));
  }
  push(view.frames === undefined ? "" : String(view.frames));
  const candidates = new Map<string, number>();
  const add = (label: string, seed: number) => { if (!candidates.has(label)) candidates.set(label, seed); };
  for (const text of strings) {
    add(`hashSeed(${text})`, hashSeed(text));
    add(`hashSeed(${text}:roles)`, hashSeed(`${text}:roles`));
    add(`hashSeed(commit|${text})`, hashSeed(`ip-room/v1/commit/match|${text}`));
  }
  const head = strings.slice(0, 12);
  for (let i = 0; i < head.length; i++) {
    for (let j = 0; j < head.length; j++) if (i !== j) add(`hashSeed(${head[i]}+${head[j]})`, hashSeed(head[i] + head[j]));
  }

  let attemptAFingerprint = 0;
  let attemptALeak = 0;
  const attemptAHits: string[] = [];
  for (const [label, seed] of candidates) {
    const fingerprintHit = fingerprintForSeed(seed) === target;
    const roleHit = impostorSetForSeed(seed).join(",") === trueSet;
    if (fingerprintHit) attemptAFingerprint++;
    if (fingerprintHit && roleHit) { attemptALeak++; if (attemptAHits.length < 5) attemptAHits.push(label); }
  }
  lines.push("\n3. THE ATTEMPT");
  lines.push(`   A. candidates built from published fields (real engine, ${candidates.size} candidates):`);
  lines.push(`      reproduce the room's lobby fingerprint : ${attemptAFingerprint}`);
  lines.push(`      reproduce fingerprint AND impostor ids : ${attemptALeak}${attemptAHits.length ? ` (${attemptAHits.join(", ")})` : ""}`);

  /* ---- 2c. derivation attempt B: the whole room-code space ------------- */
  let codes = 0;
  let classHits = 0;
  let fingerprintHits = 0;
  let leakHits = 0;
  const leakCodes: string[] = [];
  const startedAt = Date.now();
  if (sweep) {
    const alphabet = ROOM_CODE_ALPHABET;
    for (const a of alphabet) for (const b of alphabet) for (const c of alphabet) for (const d of alphabet) {
      const code = `${a}${b}${c}${d}`;
      const seed = hashSeed(code);
      codes++;
      const roleHit = impostorSetForSeed(seed).join(",") === trueSet;
      if (roleHit) classHits++;
      if (fingerprintForSeed(seed) === target) {
        fingerprintHits++;
        if (roleHit) { leakHits++; if (leakCodes.length < 5) leakCodes.push(code); }
      }
    }
  }
  const sweepMs = Date.now() - startedAt;
  lines.push(`   B. exhaustive sweep of the game's own 4-character room-code space (${alphabetSize()}^4 = ${alphabetSize() ** 4} codes, ${sweep ? `${codes} swept in ${sweepMs} ms` : "SKIPPED"}):`);
  lines.push(`      codes whose impostor set equals the room's : ${classHits}  (the class is 1-in-15 — matching it identifies nothing)`);
  lines.push(`      codes whose lobby fingerprint matches      : ${fingerprintHits}`);
  lines.push(`      codes matching fingerprint AND roles      : ${leakHits}${leakCodes.length ? ` (${leakCodes.join(", ")})` : ""}`);
  lines.push(`      the room's own seed hashSeed(seedMatch) is in this space : NO (seedMatch is a ${truth.seedMatch.length}-char secret, not a 4-char code)`);

  /* ---- 3. control ------------------------------------------------------ */
  const controlSeed = hashSeed(truth.seedMatch);
  const controlFingerprint = fingerprintForSeed(controlSeed) === target;
  const controlRoles = truthRoles(controlSeed, truth.roster[0].name, roomA.log.streams.match.length ? "0" : "0").join(",") === trueSet;
  const mirroredRolesAgree = impostorSetForSeed(controlSeed).join(",") === trueSet;
  const engineAgrees = truthRoles(controlSeed, "Slot0", "0").join(",") === impostorSetForSeed(controlSeed).join(",");
  lines.push("\n4. THE CONTROL (the same derivation, given the seedMatch that close reveals)");
  lines.push(`   lobby fingerprint reproduced exactly        : ${controlFingerprint ? "YES" : "NO"}`);
  lines.push(`   impostor ids reproduced exactly             : ${controlRoles && mirroredRolesAgree ? "YES" : "NO"}  [${truthRoles(controlSeed, "Slot0", "0").join(", ")}]`);
  lines.push(`   mirrored role draw agrees with the engine   : ${engineAgrees ? "YES" : "NO"}`);

  const pass = independenceOk && !viewHasSeedMatch && !viewHasActions && attemptALeak === 0 && leakHits === 0 && controlFingerprint && controlRoles && mirroredRolesAgree && engineAgrees;
  lines.push(`\nSEED SEPARATION RESULT: ${pass ? "PASS — the published drip layer does not determine the impostor ids" : "FAIL"}`);
  Object.assign(detail, {
    publishedViewHasSeedMatch: viewHasSeedMatch,
    attemptACandidates: candidates.size, attemptAFingerprintHits: attemptAFingerprint, attemptALeakHits: attemptALeak,
    sweepCodes: codes, sweepMs, classHits, fingerprintHits, leakHits, leakCodes,
    controlFingerprint, controlRoles, mirroredRolesAgree, engineAgrees,
  });
  return { pass, lines, detail };
}

function alphabetSize(): number {
  return ROOM_CODE_ALPHABET.length;
}
