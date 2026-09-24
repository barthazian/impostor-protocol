/**
 * Build the spike's rooms and write their logs.
 *
 *   node experiments/room-log/bin/build.mjs [outDir]
 *
 * ROOM-A — seven seats, every seat supplied, 3-minute round.
 * ROOM-B — same secrets, slot 4 is a NO-SHOW: no action stream is sealed, so
 *          the bot brain backfills that seat (the cold-start path).
 */
import { DROP_BPS_TOTAL, DROP_EV_CENTS, SLOT_COUNT } from "./format";
import { buildRoomLog, secretFor, specFor, writeJson } from "./room";

const outDir = process.argv[2] ?? "experiments/room-log/logs";
const frames = Number(process.env.FRAMES ?? 180 * 60);

if (DROP_BPS_TOTAL !== 10000) throw new Error(`drop table bps sum to ${DROP_BPS_TOTAL}, expected 10000`);
if (DROP_EV_CENTS !== 90) throw new Error(`drop table EV is ${DROP_EV_CENTS} cents, expected 90`);

const roomA = buildRoomLog(specFor("ROOM-A", { frames, seedMatch: secretFor("ROOM-A", "match"), seedDrop: secretFor("ROOM-A", "drop") }));
const roomB = buildRoomLog(specFor("ROOM-B", {
  frames,
  seedMatch: secretFor("ROOM-A", "match"),   // same role layer as ROOM-A
  seedDrop: secretFor("ROOM-A", "drop"),     // same drip layer as ROOM-A
  supplied: [true, true, true, true, false, true, true],
}));

writeJson(`${outDir}/room-a.log.json`, roomA.log);
writeJson(`${outDir}/room-a.truth.json`, roomA.truth);
writeJson(`${outDir}/room-b.log.json`, roomB.log);
writeJson(`${outDir}/room-b.truth.json`, roomB.truth);

const line = (room: typeof roomA, label: string) => [
  `${label}  ${room.log.roomId}  frames=${room.log.frames}  slots=${SLOT_COUNT}`,
  `    seedMatch commitment = ${room.truth.commitMatch}`,
  `    seedDrop  commitment = ${room.truth.commitDrop}`,
  `    impostor ids (steward's truth, sealed until close) = ${room.truth.impostorIds.join(", ")}`,
  `    drops (drawn at join, hidden until settle) = ${room.truth.drops.map(drop => `${drop.slot}:${drop.drip}/${drop.rfCents}c`).join(" ")}`,
  `    room cost = ${room.truth.roomCostCents} cents | passes in = ${room.truth.passesInCents} cents | pool delta = ${room.truth.passesInCents - room.truth.roomCostCents} cents`,
  `    final state hash = ${room.truth.stateHash}`,
  `    entitlement root = ${room.truth.dropRoot}`,
  `    backfilled seats  = ${room.truth.backfilledSlots.length === 0 ? "none" : room.truth.backfilledSlots.join(", ")}`,
].join("\n");

console.log("ROOM LOGS WRITTEN");
console.log(line(roomA, "room-a"));
console.log(line(roomB, "room-b"));
console.log(`outDir = ${outDir}`);
