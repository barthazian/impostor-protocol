/**
 * SPIKE A — the backward-compatibility proof.
 *
 * Runs the SAME seed and the SAME scripted input sequence through the engine
 * BEFORE the per-actor input change (a byte copy of the shipped sim.ts, kept in
 * ../before/) and AFTER it, hashing the whole observable state every frame. The
 * two hash streams must be identical; then the new path is shown to be live by
 * supplying a map and watching the state DIVERGE.
 *
 *   node experiments/room-log/bin/backcompat.mjs
 */
import { createRng, hashSeed } from "../../../games/impostor-protocol/src/rng";
import { createMatch as matchAfter } from "../../../games/impostor-protocol/src/sim";
import type { MatchConfig, PlayerInput } from "../../../games/impostor-protocol/src/types";

import { createMatch as matchBefore } from "../before/sim";
import { stateDigest } from "./digest";

const DT = 1 / 60;
const FRAMES = 3600;
const IDLE: PlayerInput = { up: false, down: false, left: false, right: false, destination: null };

const SEED = 20260924;
const CONFIGS: readonly (readonly [string, MatchConfig])[] = [
  ["botCount=5 (6 actors)", { seed: SEED, tier: "standard", playerRole: "crew", botCount: 5, playerName: "Ferra", friendId: "42" }],
  ["botCount=6 (7 actors)", { seed: SEED, tier: "standard", playerRole: "crew", botCount: 6, playerName: "Ferra", friendId: "42" }],
];

/** One deterministic input stream, replayed into every leg. */
function inputsFor(frames: number): PlayerInput[] {
  const rng = createRng(hashSeed(`${SEED}:backcompat-inputs`));
  const stream: PlayerInput[] = [];
  let direction: readonly [boolean, boolean, boolean, boolean] | null = null;
  let remaining = 0;
  for (let frame = 0; frame < frames; frame++) {
    if (remaining <= 0) {
      if (rng.int(10) < 7) {
        const pick = rng.int(4);
        direction = [pick === 0, pick === 1, pick === 2, pick === 3];
        remaining = 15 + rng.int(35);
      } else {
        direction = null;
        remaining = 5 + rng.int(15);
      }
    }
    remaining--;
    stream.push({
      up: direction ? direction[0] : false,
      down: direction ? direction[1] : false,
      left: direction ? direction[2] : false,
      right: direction ? direction[3] : false,
      destination: null,
    });
  }
  return stream;
}

type Leg = Readonly<{ hashes: string[]; final: string }>;

function run(
  create: (config: MatchConfig) => { update: (...args: any[]) => void; advance: () => void; state: unknown },
  config: MatchConfig,
  inputs: readonly PlayerInput[],
  mode: "two-arg" | "undefined-map" | "empty-map" | "supplied-map",
): Leg {
  const match = create(config);
  match.advance();
  const hashes: string[] = [];
  for (let frame = 0; frame < inputs.length; frame++) {
    const input = inputs[frame];
    if (mode === "two-arg") match.update(DT, input);
    else if (mode === "undefined-map") match.update(DT, input, undefined);
    else if (mode === "empty-map") match.update(DT, input, {});
    else {
      const actors = (match.state as any).actors as { id: string; isPlayer: boolean }[];
      const frameMap: Record<string, PlayerInput> = {};
      // Seven-slot shape: every actor gets its own stream, keyed off this one.
      for (const actor of actors) frameMap[actor.id] = actor.isPlayer ? input : { ...input, up: input.down, down: input.up };
      match.update(DT, IDLE, frameMap);
    }
    hashes.push(stateDigest(match.state));
  }
  return { hashes, final: hashes[hashes.length - 1] };
}

function compare(a: readonly string[], b: readonly string[]): { equal: number; firstDiff: number } {
  const length = Math.min(a.length, b.length);
  let equal = 0;
  let firstDiff = -1;
  for (let index = 0; index < length; index++) {
    if (a[index] === b[index]) equal++;
    else if (firstDiff < 0) firstDiff = index;
  }
  return { equal, firstDiff };
}

let failures = 0;
const lines: string[] = [];
lines.push(`SPIKE A — single-player path before/after the per-actor input change`);
lines.push(`seed=${SEED} frames=${FRAMES} dt=${DT} inputs=seeded scripted walks`);

for (const [label, config] of CONFIGS) {
  const inputs = inputsFor(FRAMES);
  const before = run(matchBefore as never, config, inputs, "two-arg");
  const afterTwo = run(matchAfter as never, config, inputs, "two-arg");
  const afterUndefined = run(matchAfter as never, config, inputs, "undefined-map");
  const afterEmpty = run(matchAfter as never, config, inputs, "empty-map");
  const afterSupplied = run(matchAfter as never, config, inputs, "supplied-map");

  const two = compare(before.hashes, afterTwo.hashes);
  const undef = compare(before.hashes, afterUndefined.hashes);
  const empty = compare(before.hashes, afterEmpty.hashes);
  const supplied = compare(before.hashes, afterSupplied.hashes);

  const ok = two.equal === FRAMES && undef.equal === FRAMES && empty.equal === FRAMES && supplied.firstDiff >= 0;
  if (!ok) failures++;
  lines.push(`\n${label}  ${ok ? "PASS" : "FAIL"}`);
  lines.push(`  before(2-arg)              final = ${before.final}`);
  lines.push(`  after (2-arg)              final = ${afterTwo.final}`);
  lines.push(`  after (3-arg undefined)    final = ${afterUndefined.final}`);
  lines.push(`  after (3-arg {})           final = ${afterEmpty.final}`);
  lines.push(`  after (supplied map)       final = ${afterSupplied.final}`);
  lines.push(`  per-frame identical before/after   : ${two.equal}/${FRAMES} frames${two.firstDiff >= 0 ? ` (first mismatch frame ${two.firstDiff})` : ""}`);
  lines.push(`  per-frame identical with undefined : ${undef.equal}/${FRAMES} frames`);
  lines.push(`  per-frame identical with empty map : ${empty.equal}/${FRAMES} frames`);
  lines.push(`  supplied map diverges at frame     : ${supplied.firstDiff} (the new path is live, not a no-op)`);
}
lines.push(`\nSPIKE A RESULT: ${failures === 0 ? "PASS — no-map call sites are byte-identical" : `FAIL (${failures})`}`);
console.log(lines.join("\n"));
process.exit(failures === 0 ? 0 : 1);
