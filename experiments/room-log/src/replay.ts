/**
 * Replay one published log. No secrets, no sidecar — just the file.
 *
 *   node experiments/room-log/bin/replay.mjs <log.json> [--reverse]
 *
 * Exit 0 when the log replays clean, 1 when any check fails.
 */
import { readFileSync } from "node:fs";

import { replayLog, type ReplayOrder } from "./rebuild";
import type { RoomLog } from "./format";

const file = process.argv[2];
if (!file) {
  console.error("usage: replay.mjs <log.json> [--reverse]");
  process.exit(2);
}
const order: ReplayOrder = process.argv.includes("--reverse") ? "reverse" : "forward";
const log = JSON.parse(readFileSync(file, "utf8")) as RoomLog;
const result = replayLog(log, order);
console.log(JSON.stringify(result, null, 2));
process.exit(result.problems.length === 0 && result.stateHashAgrees && result.rootAgrees ? 0 : 1);
