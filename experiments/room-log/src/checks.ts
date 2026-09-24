/**
 * The spike's check suite — run it and read the verdicts.
 *
 *   node experiments/room-log/bin/build.mjs      (writes the logs)
 *   node experiments/room-log/bin/checks.mjs     (this file)
 *
 * Every check prints PASS/FAIL with the raw evidence it used, and the whole run
 * lands in out/checks-report.json.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { STATION } from "../../../games/impostor-protocol/src/station";

import { DROP_BPS_TOTAL, DROP_EV_CENTS, DROP_TABLE, SLOT_COUNT, logProblems, roll, type RoomLog } from "./format";
import { replayLog } from "./rebuild";
import { writeJson } from "./room";
import { runSeparation } from "./separation";
import { runTampers } from "./tampers";

const here = fileURLToPath(new URL(".", import.meta.url));
const logsDir = resolve(here, "..", "logs");
const outDir = resolve(here, "..", "out");
const replayBundle = resolve(here, "replay.mjs");

type CheckResult = Readonly<{ name: string; pass: boolean; detail: string }>;
const results: CheckResult[] = [];
function record(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail });
  console.log(`\n[${pass ? "PASS" : "FAIL"}] ${name}`);
  console.log(detail.split("\n").map(line => `    ${line}`).join("\n"));
}

const readLog = (name: string): RoomLog => JSON.parse(readFileSync(resolve(logsDir, name), "utf8")) as RoomLog;
const readTruth = (name: string): any => JSON.parse(readFileSync(resolve(logsDir, name), "utf8"));

const roomALog = readLog("room-a.log.json");
const roomBLog = readLog("room-b.log.json");
const roomATruth = readTruth("room-a.truth.json");

/* ---- 1. the table itself ---------------------------------------------- */
{
  const pays = DROP_TABLE.filter(entry => entry.rfCents > 0).reduce((sum, entry) => sum + entry.bps, 0);
  const pass = DROP_BPS_TOTAL === 10000 && DROP_EV_CENTS === 90 && pays === 7900;
  record("economy: cache table sums to 10000 bps with EV 0.90 RF", pass,
    DROP_TABLE.map(entry => `${entry.label}: ${entry.bps}bps / ${entry.rfCents}c`).join("\n")
    + `\nbps total = ${DROP_BPS_TOTAL} (exact 10000)\nEV = ${DROP_EV_CENTS} cents = ${(DROP_EV_CENTS / 100).toFixed(2)} RF\nP(pays anything) = ${pays} bps = ${(pays / 100).toFixed(0)}%`);
}

/* ---- 2. the table, empirically ---------------------------------------- */
{
  const seedDrop = roomATruth.seedDrop as string;
  const tally = new Map<string, number>();
  const draws = 100_000;
  for (let index = 0; index < draws; index++) {
    const entry = roll(seedDrop, index % SLOT_COUNT, Math.floor(index / SLOT_COUNT));
    tally.set(entry.id, (tally.get(entry.id) ?? 0) + 1);
  }
  const lines: string[] = [];
  let pass = true;
  for (const entry of DROP_TABLE) {
    const observed = (tally.get(entry.id) ?? 0) * 10000 / draws;
    const off = Math.abs(observed - entry.bps);
    if (off > 400) pass = false;
    lines.push(`${entry.label.padEnd(17)} expected ${String(entry.bps).padStart(4)}bps  observed ${observed.toFixed(0).padStart(4)}bps  delta ${(observed - entry.bps).toFixed(0).padStart(5)}  ${off <= 400 ? "ok" : "OUT OF TOLERANCE"}`);
  }
  lines.push(`(${draws} draws of roll(seedDrop, slot, passIndex) — tolerance ±400bps from sampling noise)`);
  record("economy: 100k seeded draws land on the table", pass, lines.join("\n"));
}

/* ---- 3. the logs ------------------------------------------------------ */
{
  const problems = logProblems(roomALog);
  record("log room-a: two streams, seven joins, no mix-ups", problems.length === 0,
    problems.length === 0
      ? `match events = ${roomALog.streams.match.length}, economy events = ${roomALog.streams.economy.length}, sealed streams = ${Object.keys(roomALog.sealed).length}\nno problem found by the structural verifier`
      : problems.join("\n"));
}
{
  const problems = logProblems(roomBLog);
  const backfilled = roomBLog.streams.match.filter(event => event.kind === "join" && !event.supplied).map(event => event.slot);
  record("log room-b: a no-show seat is legal and marked", problems.length === 0 && backfilled.join(",") === "4",
    `problems = ${problems.length === 0 ? "none" : problems.join(" | ")}\nno-show seats = [${backfilled.join(", ")}] (their run is not sealed; the bot backfills)`);
}

/* ---- 4. replay, both orders, in-process ------------------------------- */
{
  const forward = replayLog(roomALog, "forward");
  const pass = forward.problems.length === 0 && forward.stateHashAgrees && forward.rootAgrees
    && forward.commitmentsChecked === SLOT_COUNT && forward.claimsVerified === SLOT_COUNT;
  record("replay room-a (forward, in-process) verifies", pass,
    `problems = ${forward.problems.length === 0 ? "none" : forward.problems.join(" | ")}\nsealed runs checked = ${forward.commitmentsChecked}\nstate hash (replayed) = ${forward.stateHash}\nstate hash (published) = ${forward.publishedStateHash}\nstate hash agrees = ${forward.stateHashAgrees}\nroot (recomputed) = ${forward.root}\nroot (published) = ${forward.publishedRoot}\nroot agrees = ${forward.rootAgrees}\nclaims verified = ${forward.claimsVerified}/${forward.claimsExpected}\nfinal phase = ${forward.finalPhase} at sim time ${forward.simTime}`);
}
{
  const forward = replayLog(roomALog, "forward");
  const reverse = replayLog(roomALog, "reverse");
  // The two orders emit the drops in a different sequence by construction; the
  // draws themselves must be identical draw-for-draw.
  const canonical = (drops: readonly any[]) => [...drops]
    .sort((a, b) => a.slot - b.slot || a.passIndex - b.passIndex)
    .map(drop => `${drop.slot}:${drop.passIndex}=${drop.recomputed}/${drop.recomputedCents}`)
    .join(" ");
  const sameDrops = canonical(forward.drops) === canonical(reverse.drops);
  const same = forward.stateHash === reverse.stateHash && sameDrops && forward.root === reverse.root;
  record("replay room-a (reverse order, in-process) is order-independent", same && reverse.problems.length === 0,
    `forward : hash=${forward.stateHash} root=${forward.root} drops emitted s${forward.drops.map(drop => drop.slot).join(",s")}\nreverse : hash=${reverse.stateHash} root=${reverse.root} drops emitted s${reverse.drops.map(drop => drop.slot).join(",s")}\nproblems = ${reverse.problems.length}\ncanonical drops identical = ${sameDrops} | hashes identical = ${forward.stateHash === reverse.stateHash} | roots identical = ${forward.root === reverse.root}`);
}

/* ---- 5. THE CENTRAL CLAIM: two separate processes --------------------- */
{
  const runChild = (order: "forward" | "reverse") => {
    const args = [replayBundle, resolve(logsDir, "room-a.log.json")];
    if (order === "reverse") args.push("--reverse");
    const child = spawnSync(process.execPath, args, { encoding: "utf8" });
    if (child.status !== 0) throw new Error(`replay ${order} exited ${child.status}: ${child.stderr || child.stdout}`);
    return JSON.parse(child.stdout) as any;
  };
  const forward = runChild("forward");
  const reverse = runChild("reverse");
  const canonical = (drops: readonly any[]) => [...drops]
    .sort((a, b) => a.slot - b.slot || a.passIndex - b.passIndex)
    .map(drop => `s${drop.slot}p${drop.passIndex}:${drop.recomputed}/${drop.recomputedCents}c`)
    .join(" ");
  const dropsEqual = canonical(forward.drops) === canonical(reverse.drops);
  const same = forward.stateHash === reverse.stateHash && dropsEqual && forward.root === reverse.root
    && forward.stateHash === roomATruth.stateHash && forward.root === roomATruth.dropRoot;
  const dropLine = (replay: any) => replay.drops.map((drop: any) => `s${drop.slot}p${drop.passIndex}:${drop.recomputed}/${drop.recomputedCents}c`).join(" ");
  record("CENTRAL CLAIM: two independent processes replay one log identically", same,
    `process A (replay.mjs --order forward):\n  state hash = ${forward.stateHash}\n  drops      = ${dropLine(forward)}\n  merkle root = ${forward.root}\nprocess B (replay.mjs --order reverse):\n  state hash = ${reverse.stateHash}\n  drops      = ${dropLine(reverse)}\n  merkle root = ${reverse.root}\nidentical: state hash ${forward.stateHash === reverse.stateHash} | drops ${dropsEqual} (draw-for-draw; only the emission order differs) | root ${forward.root === reverse.root}\nboth match the steward's recorded truth: ${forward.stateHash === roomATruth.stateHash && forward.root === roomATruth.dropRoot}\nboth processes reported zero problems: ${forward.problems.length === 0 && reverse.problems.length === 0}`);
}

/* ---- 6. cold-start backfill ------------------------------------------ */
{
  const replayed = replayLog(roomBLog, "forward");
  const backfilledId = "bot-3";
  const actor = replayed.actors.find(entry => entry.id === backfilledId);
  const spawn = STATION.botSpawns[3];
  const distance = actor ? Math.hypot(actor.x - spawn.x, actor.y - spawn.y) : 0;
  const moved = Boolean(actor) && (distance > 30 || actor!.tasksDone > 0);
  record("backfill: an unsupplied seat is driven by its bot brain", replayed.problems.length === 0 && replayed.stateHashAgrees && moved,
    `slot 4 is a no-show → actor ${backfilledId} has no entry in the input map\nfinal position = (${actor?.x.toFixed(1)}, ${actor?.y.toFixed(1)}) vs spawn (${spawn.x}, ${spawn.y}) → moved ${distance.toFixed(1)} units\nbot tasks completed = ${actor?.tasksDone}\nstate hash agrees with the published one = ${replayed.stateHashAgrees}`);
}

/* ---- 7. seed separation ---------------------------------------------- */
{
  const sweep = process.env.SWEEP !== "0";
  const report = runSeparation({ log: roomALog, truth: roomATruth }, roomALog.frames, sweep);
  console.log(`\n${report.lines.join("\n")}`);
  record("seed separation: the drops do not leak the impostor ids", report.pass, report.lines.join("\n"));
}

/* ---- 8. tamper tests -------------------------------------------------- */
{
  const tampers = runTampers({ log: roomALog, truth: roomATruth });
  for (const tamper of tampers) {
    record(`tamper ${tamper.id}: ${tamper.name}`, tamper.pass, [`required failure: ${tamper.required}`, ...tamper.induced].join("\n"));
  }
}

/* ---- report ----------------------------------------------------------- */
const failed = results.filter(result => !result.pass);
writeJson(resolve(outDir, "checks-report.json"), {
  generatedAt: new Date().toISOString(),
  room: roomALog.roomId,
  frames: roomALog.frames,
  checks: results,
  passed: results.length - failed.length,
  failed: failed.length,
});
console.log(`\n================ CHECKS: ${results.length - failed.length}/${results.length} PASS ================`);
for (const result of results) console.log(`  ${result.pass ? "PASS" : "FAIL"}  ${result.name}`);
console.log(`\nreport written to ${resolve(outDir, "checks-report.json")}`);
process.exit(failed.length === 0 ? 0 : 1);
