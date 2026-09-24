# Async Friend Room — design spec (PROPOSAL, NOT IMPLEMENTED)

**Status: design proposal.** None of this exists in the shipped build. The published
game at https://barthazian.github.io/impostor-protocol/ remains **single-player**:
no networking, no persistence, no session, no shared pot. Everything below is the
design for an **external** product built around the game, and the submission wording
must say so plainly.

---

## 1. The model in one paragraph

A sponsor seeds a **supply** (10k–100k RF). Seven players occupy a room. Each buys a
**pass** (1 RF), each plays **one bounded run** of the room's shared seed, and each
pass entitles them to **one cache** drawn on the existing weighted table
(EV **0.90 RF**). The caches land in their **collection** and are **claimed whenever
they like**. The room **settles once, at the end, together** — one batch, not a
stream. The sponsor's supply is a **kickstart, not a subsidy**: at 1.00 RF in against
0.90 RF out the pool grows **+0.10 RF per pass** on its own.

## 2. The constraint that shapes everything

Grep-verified in FriendSDK v0.1.2 source: **no** WebSocket, socket.io, EventSource,
`sessionId`, `multiplayer`, `localStorage`, `indexedDB`, or even `fetch(`. So the
SDK carries the *game* and nothing else. The room, the pot, the log and the claims
all live in a new layer outside it.

What the SDK *does* give us, and why this design is cheap: `createMatch(config)` plus
`update(dtSeconds, input)` advances game time **only when the caller asks**, with `dt`
clamped by `MAX_DT`. The match is already a deterministic fold over its inputs, and a
room code already reproduces a match exactly. Event sourcing is not a rewrite here —
it is the shape the engine already has.

**One engine change is required:** `update` takes a single `PlayerInput` and drives
the other six actors from bot brains. A real seven-slot room needs a per-actor input
map. The movement code is already factored per actor, so this is an interface change.

## 3. Fixed-length rounds

A round is a **fixed wall-clock duration T ∈ {3, 5, 10} minutes**, chosen from data.
No turn engine, no per-turn reveals, no multi-day pacing: within T, a player's run
begins and ends.

**Choosing T (measurable, offline):** the sim is deterministic and already driveable
headlessly, so T is calibrated by running whole rounds at each candidate length and
comparing: actions per minute, tasks completed before the round ends, kills and
reports per round, and the share of rounds that reach a decisive end (crew win by
tasks/votes vs impostor win). Pick the smallest T whose median run still reaches a
decision. Instrumentation needed: the sim already tracks `state.time`, task counts and
kill events; a probe writes one row per run.

## 4. Room lifecycle

| phase | what happens | on-chain? |
|---|---|---|
| **create** | sponsor seeds the pot, T is set, the **seed is committed** | escrow deposit; seed hash |
| **join** | slots claimed by signature; each claim mints that wallet's **cache draws** from the seed | — (signature only) |
| **play** | each slot plays its own bounded T-minute run of the shared seed | — |
| **close** | all seven runs recorded, or the join window expires (no-shows forfeit) | — |
| **settle** | the room result is computed once and the **merkle root of entitlements** is published | root posted |
| **claim** | each holder claims their accumulated caches, whenever they want | claim tx |

## 5. The seven slots are seven wallets

Each slot is a wallet holding a Rare Friends Generations NFT (generation ≥ 1) — the
gate the SDK already enforces per device. Because the crew sprites are read from chain
per token, **the visible roster and the entry gate are the same object**: the room is
literally "these seven Friends."

Slot claims need a signed message (`personal_sign` of room id + slot), because the SDK
issues no session token. Cold start is the practical risk: a room that needs seven
*concurrent* humans never fills, so slots should be **seven seats occupied**, with bots
backfilling only after a deadline.

## 6. Shared-seed race (what "multiplayer" honestly means here)

All seven slots play **the same seed** — identical station, roles, bot personalities
and sabotage schedule. That makes the room a **true skill comparison**: the same game,
dealt the same way, scored across seven players. The deduction remains against bots;
the multiplayer is the fair leaderboard and the shared settlement.

This is the honest reading of "async execution, settling together": seven bounded
individual runs of one committed seed, one joint settlement. It is what the SDK can
support, and it is a real competitive format — but it is **not** seven humans
interacting live, and no wording may imply that.

## 7. The event log — two separate streams

**Match events** (one log per room): genesis commit, join, per-slot run action stream
(**sealed**), close, settle.

**Economy events** (kept apart so a payout record is never buried in gameplay): seed
deposit, pass purchase, cache draw, merkle root, claim.

Rules that make it trustworthy:

- every cache is `roll(seed, slot, passIndex)` — a deterministic function, so **anyone
  can replay the log and recompute every drop**; that is the whole fairness story
- each run's action stream is **sealed** until close, committed by hash at join — the
  no-tell rule, now a cryptographic boundary rather than a UI convention
- the log is public except the sealed segments, which is also what makes replays and
  spectating free later

## 8. The economy

Per room, with one pass per player:

| quantity | value |
|---|---:|
| passes in (7 × 1.00 RF) | 7.00 RF |
| caches out (7 × EV 0.90) | 6.30 RF |
| pool per room | **+0.70 RF** |
| P(a cache pays anything) | 79% |
| P(a cache pays zero) | 21% |
| max single cache | 10 RF |

**The liability rule.** Each slot's cache value is drawn from the seed **at join** and
revealed at settle, so:

- the room's cost is **exactly 6.30 RF, known before anyone plays a turn**
- the sponsor can be told, as fact, that 10,000 RF funds **1,587 rooms** and 100,000 RF
  funds **15,873** — a number, not a projection
- because the draw predates the outcome, no operator can reroll after seeing who won

**The pass price is the sustainability dial.** At 1.00 RF the pool grows; below 0.90 it
drains and the sponsor's supply becomes a real subsidy. Variants worth modelling:
one cache per player (participation, 6.30 RF/room), one pass + one sponsored bonus
cache (12.60 RF/room), and a bound on sponsor drawdown per period.

## 9. Collection and claims

The roll happens **at drop time** (the player sees what they hold; the collection case
shows it during play), and the **claim merely pays it out** — so mid-round feedback
costs nothing, because feedback is not the same as payout cadence.

Preferred mechanism: a **merkle root** of `(wallet, amount owed)`, published at settle.
Holders claim any time with a proof — cheap, standard, no per-player transaction at
drop time.

**Accounting consequence of "whenever they want":** entitlements are permanent, so the
pot must be **fully escrowed up front** and outstanding collection balances treated as
a reserved liability (the rolled amounts, which are fixed at draw time). That balance
cannot be re-spent.

Escrow options, in trust order: custodial ops wallet → hybrid contract holding the pot
with the settle root and a challenge window (recommended) → fully trustless challenge
by replay.

## 10. What must not be claimed

- the shipped build is single-player; this layer does not exist yet
- the seven slots are not seven humans interacting live — they are seven runs of one
  seed, settled together
- the docs currently state *"skill pays in SP, not RF"*. A drip that pays RF to players
  makes that **false**, so it must be rewritten before any of this ships
- a paid-entry pot with a cash-out is gambling-shaped in most jurisdictions; a **free
  entry with a sponsored prize** is the defensible version

## 11. Open decisions

1. **T** — 3, 5 or 10 minutes, from the calibration above
2. **cache per slot** — one per pass (self-sustaining) vs per player (sponsor subsidy)
   vs one pass + a sponsored bonus
3. **escrow** — custodial, hybrid contract, or trustless challenge
4. **no-show rule** — forfeit to the pool, or refund
5. **docs** — the "skill pays SP, not RF" line, and the async-room status section

## 12. Build order (cheapest de-risking first)

1. **Per-actor input path** — `update` accepting a map of actor inputs, bots filling
   gaps. Contained engine change; unblocks everything else.
2. **Event log + replay verifier** — genesis draw, sealed runs, and a verifier that
   recomputes every cache from `(seed, slot, passIndex)` and matches the published
   root. This is the trust anchor; nothing else matters if it fails.
3. **Play-by-mail prototype** — signed action files exchanged by hand, one script
   settling. Demos the whole format with zero infrastructure.
4. **Server-authoritative room** — turn loop, deadlines, join window, custodial escrow.
5. **Escrow contract + claims** — merkle root posted at settle, claims any time.

---

## 13. Spike results — what is now PROVEN

Both spikes are implemented and independently re-run by the owner; 13/13 checks pass.
Evidence lives in `experiments/room-log/` (`src/`, `logs/`, `out/checks-report.json`).

**Per-actor input path (Spike A).** `Match.update` gains an optional third parameter — an
`ActorInputMap` — without changing existing call sites. Backward compatibility is proven
*per frame*, not asserted: with the same seed and the same 3,600-frame scripted stream,
the state digest is identical before and after the change on both a 6-actor config
(`c41cf964…`) and a 7-actor config (`41c57981…`) — 3600/3600 frames each. A supplied map
diverges at frame 0, so the new path is genuinely live, and an actor with no supplied
input is still driven by its bot brain (the cold-start backfill).

**The trust anchor (Spike B).** One room log replayed by two independent processes in
opposite event order reaches the identical state digest `97e44524…` and the identical
merkle root `4a31be17…`, with 7/7 sealed-run commitments and 7/7 claim proofs verifying.

**Seed separation — the amendment this proved necessary.** A room must commit to **two**
independent seeds: `seedMatch` (station, roster, roles, bots — hidden until close) and
`seedDrop` (the cache draws — revealed with the settlement). Publishing the drops
therefore cannot reveal the impostors: with drops published and `seedMatch` sealed, a
243-candidate derivation and an exhaustive 1,048,576 room-code sweep both fail to recover
the roster or the roles, while the control *with* the revealed seed reproduces
`bot-1, bot-3` exactly. Had the drops derived from the match seed, publishing a payout
would have leaked the game.

**Tamper resistance, demonstrated rather than claimed.** Flipping one input byte breaks
the commitment and the state digest; flipping one drip breaks the published root and the
slot's claim proof; dropping a join event is rejected; reusing a `(slot, passIndex)` pair
is rejected and leaves the settle leaf disagreeing with the drawn caches.

## 14. Boundaries found while building (open work, not defects)

1. **The input map is movement-only.** A supplied actor can walk, but kills, vents,
   console use and votes remain player-scoped, so a supplied impostor slot cannot kill.
   Widening the verbs is the next engine task, and is required before a seven-human room
   is a *game* rather than a walking demo.
2. **One match, seven streams — not seven runs.** The spike drives a single match with
   per-actor streams; §6's "seven separate runs of one seed" is the other topology. Both
   are viable, they have different fairness stories (shared state vs independent runs),
   and one must be chosen before the server is written.
3. Escrow, custody, on-chain claims and no-show economics remain unbuilt.
