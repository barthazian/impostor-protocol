# room-log — event log + replay verifier (SPIKE B), and the per-actor input path (SPIKE A)

**Status: spike.** Nothing here ships. It exists to prove two things the async-room
design (`ASYNC-ROOM-SPEC.md`) depends on, before anything is built on top of them:

- **SPIKE A** — the engine can be driven per actor (`update(dt, input, actorInputs)`)
  without changing a byte of the single-player path.
- **SPIKE B** — one published log replays to one result: two independent processes
  recompute the same final state hash, the same cache draws and the same merkle root,
  while the drip layer stays separate from the role layer.

Run everything from the repo root:

```
./node_modules/.bin/esbuild experiments/room-log/src/build.ts      --bundle --format=esm --platform=node --outfile=experiments/room-log/bin/build.mjs
./node_modules/.bin/esbuild experiments/room-log/src/replay.ts     --bundle --format=esm --platform=node --outfile=experiments/room-log/bin/replay.mjs
./node_modules/.bin/esbuild experiments/room-log/src/checks.ts     --bundle --format=esm --platform=node --outfile=experiments/room-log/bin/checks.mjs
./node_modules/.bin/esbuild experiments/room-log/src/backcompat.ts --bundle --format=esm --platform=node --outfile=experiments/room-log/bin/backcompat.mjs

node experiments/room-log/bin/backcompat.mjs                      # SPIKE A proof
node experiments/room-log/bin/build.mjs                           # writes logs/room-{a,b}.log.json + .truth.json
node experiments/room-log/bin/replay.mjs experiments/room-log/logs/room-a.log.json
node experiments/room-log/bin/replay.mjs experiments/room-log/logs/room-a.log.json --reverse
node experiments/room-log/bin/checks.mjs                          # the whole suite → out/checks-report.json
```

No new dependencies (node stdlib only), no network, no `Math.random` anywhere:
every random draw comes from the game's own `createRng`/`hashSeed` mulberry32 streams.

## SPIKE A — the per-actor input path

`Match.update(dtSeconds, input, actorInputs?)` gained one optional argument
(`ActorInputMap = Readonly<Record<ActorId, PlayerInput | undefined>>`).

- **No map** → today's code path, character for character: `updatePlayer` then
  `updateBots`. `backcompat.mjs` proves it: a byte copy of the shipped `sim.ts` lives
  in `before/`, both copies are run with the same seed and the same 3600-frame scripted
  input stream, and the whole observable state is hashed **every frame** with the same
  digest function. 3600/3600 frames identical, for a 6-actor and a 7-actor config; the
  same holds for `update(dt, input, undefined)` and `update(dt, input, {})`.
- **With a map** → every listed actor is driven by its own input through the *same*
  movement routine the local player uses; every actor **not** in the map keeps its
  fallback (player → `input`, bot → bot brain) — that is the cold-start backfill.
  Supplying a map moves the state away from the single-player result, so the new path
  is live rather than a no-op.

Boundary, stated plainly: the map carries **movement only**. Kill / vent / task verbs
are still the player-scoped `ability()` / `vent()` / `interact()`; a supplied slot that
is an impostor walks but does not kill. Widening the verbs is a separate interface
change and was deliberately not made here.

## SPIKE B — the log

```jsonc
{
  "version": 1, "roomId": "ROOM-A", "frameSeconds": 0.016666…, "frames": 10800,
  "streams": {
    "match":   [genesis, join ×7, run-sealed ×7, close, settle, claim ×7],
    "economy": [deposit, pass-purchase ×7, cache-draw ×7, merkle-root, claim ×7]
  },
  "sealed": { "0": { "slot": 0, "frames": 10800, "actionsCommitment": "…",
                     "actions": [ … ], "revealedAt": 180.5 }, … }
}
```

- **Two streams, never merged.** A payout record lives only in `economy`; gameplay
  — genesis, join, sealed run, close, settle — only in `match`. `claim` is the one
  kind that appears in both (event + ledger line), and the structural verifier knows
  that. `logProblems()` rejects a log that mixes anything else.
- **Two commitments, never merged.** Genesis publishes `commitMatch =
  sha256("ip-room/v1/commit/match|" + seedMatch)` and `commitDrop = sha256(…|seedDrop)`,
  hash only. `seedMatch` (station, roles, bots) is revealed by **close**; `seedDrop`
  (the drip layer) is revealed by **settlement**, and the draws themselves are made
  **at join** and marked `hiddenUntil: "settle"`, so the room's cost is fixed before
  anybody plays.
- **Sealed runs.** Each supplied slot commits `sha256` over its whole action stream at
  join (`run-sealed`), and the close event reveals the stream against that commitment.
  The no-tell rule becomes a cryptographic boundary: before close the log carries a
  hash, not a trace.
- **Cache draw.** `roll(seedDrop, slot, passIndex)` → one entry of the shipped table
  (Scrap Metal 21%/0 RF, Spare Parts 30%/0.25, Circuit Board 19%/0.50, Power Cell
  15%/1.00, Rare Alloy 9%/2.00, Quantum Core 4%/5.00, Genesis Artifact 2%/10). bps sum
  to exactly 10000, EV is exactly 0.90 RF = 90 cents; `checks.mjs` also tallies 100k
  draws against the table.
- **Entitlements.** Leaves are `(wallet, amountCents)`; the tree sorts them by wallet
  (so insertion order cannot matter), pairs an odd tail node with itself, and the root
  is published at settle in both streams. Claims carry a proof; every proof is verified
  against the root by both the structural verifier and every replay.

## What the checks prove (13/13)

| check | what it shows |
|---|---|
| cache table | bps 10000, EV 90c, P(pays) 79% |
| 100k draws | drawn outcomes land on the table |
| room-a / room-b structure | two streams intact, 7 joins, 7 seals, no mix-ups, no-show seat legal |
| replay forward / reverse | verifies and is order-independent |
| **CENTRAL CLAIM** | two separate `node` processes replaying the same log produce the same state hash, the same draws and the same root |
| backfill | an unsupplied seat is driven by its bot brain |
| seed separation | crossed fixtures + derivation attempt + control (below) |
| tamper T1–T4 | each induced failure reported verbatim |

### Seed separation (the load-bearing one)

1. **Independence.** Three fixture rooms driven from crossed secrets: same `seedDrop`
   with different `seedMatch` → byte-identical drip layer, different impostor ids; same
   `seedMatch` with different `seedDrop` → identical roles and roster, different drip
   layer. One published drip layer therefore corresponds to more than one role
   assignment.
2. **The attempt.** Every candidate a reader can build from the published view
   (`ROOM-A`'s settlement-time view: genesis commitments, joins, sealed commitments,
   the whole economy stream — no `seedMatch`, no action stream) is run through the
   shipped role derivation and tested against the room's public lobby fingerprint plus
   the true impostor set; then the game's own 4-character room-code space (32⁴ codes)
   is swept exhaustively the same way. Reported: candidates tried, hits of the
   15-way impostor class (they are chance, not identification), fingerprint hits, and
   the fingerprint+role hits that would be a real leak.
3. **The control.** With the `seedMatch` that close reveals, the same derivation
   reproduces the roster and the impostor ids exactly — so the attempt fails because
   the secret is sealed, not because the method is broken.

### Tamper tests

| tamper | induced failure |
|---|---|
| T1 flip one input byte in a sealed run (frame 10757 of 10800) | the stream no longer matches its join commitment **and** the replayed state hash moves (`97e445…` → `e2acec…`) |
| T2 flip one drip (slot 3, spare-parts→genesis-artifact) | `roll(seedDrop, 3, 0)` disagrees, the root over the tampered drip layer differs from the published root, the slot's claim proof no longer verifies |
| T3 drop one join event | rejected: `6 join events, expected 7`, orphan sealed stream, drawn cache with no join |
| T4 reuse a passIndex | rejected: `cache draw reused (slot 1, passIndex 0)`, and the settle leaf no longer matches the draws |

T1 note: a one-frame edit *mid-round* is often re-absorbed — these walks drive into
walls, so once an axis is pinned to the same wall the missing 2.58 units stop mattering,
and the final state can come back together. The tamper therefore edits the tail of the
run; the commitment check catches the edit at **any** frame regardless.

## Files

- `src/format.ts` — table, `roll`, commitments, canonical JSON, merkle + proofs, log
  types, `logProblems`, `publishedView`
- `src/digest.ts` — the one canonical `stateDigest` used by every check
- `src/room.ts` — builds a room's log (join-time draws, sealed streams, close, settle, claims)
- `src/rebuild.ts` — the replay verifier core (`replayLog(log, order)`)
- `src/separation.ts` — the crossed fixtures, the derivation attempt, the control
- `src/tampers.ts` — the four tamper tests
- `src/checks.ts` — the suite, spawns the two replay processes, writes the report
- `src/backcompat.ts` — the SPIKE A before/after proof
- `before/` — byte copy of `games/impostor-protocol/src/{sim,types,rng,station}.ts` as
  it was BEFORE the per-actor change (the "before" side of the proof)
- `bin/` — esbuild bundles (the test-flow style: bundle TS to mjs, then run node)
- `logs/` — room-a / room-b logs + the steward's truth sidecars. `build.mjs` is
  deterministic, so the logs are reproducible byte for byte (a rerun produces the
  same sha256); they are large (~11 MB and ~9 MB uncompressed) and ship here
  gzipped as `room-*.log.json.gz` (~56 KB each — `gunzip` before replaying them).
- `out/` — the raw evidence: `checks-report.json`, the two replay outputs, the
  backcompat output, the console transcript

## Honest boundaries

- The room runs **one** match driven by seven per-actor streams. The spec's shared-seed
  race (seven separate runs of one seed, settled together) is a different top-level
  shape and is not built here.
- Verb coverage is movement-only (see SPIKE A).
- The steward's two secrets are derived from a fixed `STEWARD_SECRET` so the spike is
  reproducible. A real steward draws them from entropy; the log format is unchanged.
- escrow, custody, claims against a chain, and the no-show economics are out of scope:
  the spike proves the *arithmetic and the log*, not the money movement.
