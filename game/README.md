# Rare Friends: Impostor Protocol

**Category:** Character Spotlight (primary) · Token Activity (secondary)
**Builder:** Barthazian · [@barthazian](https://github.com/barthazian)
**Stack:** FriendSDK **v0.1.2** (TypeScript + React 19 + a custom canvas renderer)
**Playable preview:** https://barthazian.github.io/impostor-protocol/
**One sentence:** Your owned Rare Friends Generations Friend is the main character
of a *single-player* social-deduction round aboard a salvage station — complete RNG
crew tasks, report bodies, call meetings and vote, while an AI impostor hunts the
crew and the only RF spent is a simulated Tournament Pass whose Reward Cache is the
weighted prize roll.

---

## Playable preview

<!-- Preview URL: fill in once the static build is published. -->
- **URL:** https://barthazian.github.io/impostor-protocol/
- **Open it** in a browser that has (or can connect) a wallet on **Robinhood mainnet
  (chain 4663)** holding a hardwired Generations NFT, generation ≥ 1 — the SDK's
  ownership gate runs before play and this build keeps it intact.
- **Free path:** choose the **Practice** tier (0 RF) to play a full round.
- **Which Friends can be selected:** only **hardwired** Friends — generation ≥ 1.
  The SDK's own discovery (`owned-friends.ts`) drops generation-0 mints from the
  picker and reports them as a hidden count, and this game does no filtering of its
  own. A wallet holding a mix shows only its gen-1 Friends; that is the platform's
  rule.
- **Wallet / network required:** a browser wallet on **Robinhood mainnet (chain
  4663)** holding a hardwired Rare Friends Generations NFT, **generation ≥ 1**.
  The SDK's ownership gate runs before play and this build keeps it intact.
- **No RF, private key or signature is needed** for the preview: balances and prize
  rolls are simulated and reset on reload.

## What it is

Impostor Protocol is one *Among Us*-style round, played against AI crewmates.
Your Friend is the player character, drawn from its **unmodified canonical
16×16 sprite mask** (white halo + mask, integer 5× scale, tinted as a crew suit —
the silhouette is never redrawn). Your Friend keeps the identity role: the runtime
verifies fresh ownership of the selected hardwired Generations NFT before play,
exactly as the SDK requires.

The loop:

1. **Airlock** — choose a tournament tier and a Friend Room code, read the roster.
2. **Briefing** — your role is revealed: Crewmate or Impostor.
3. **Station** — vision-limited top-down station. Crewmates finish six tasks (RNG
   action sequences), watch for bodies and sabotage. An impostor sabotages the
   reactor, the O2 scrubbers, lights and comms, eliminates crewmates and vents.
4. **Meeting** — bots testify from their own suspicion state, then everyone votes.
   Ejections are announced and win conditions checked.
5. **Debrief** — win/lose, rank stars, Salvage Points, then open your **Reward
   Caches** with the platform's weighted RF roll.

## FriendSDK v0.1.2 boundary (read this before judging the design)

| Idea | What the SDK actually provides | What this game does |
| --- | --- | --- |
| Live multiplayer | No networking, no save API, no `localStorage` in the sandbox | **AI crewmates.** "Friend Rooms" are **shared seeds**: a 4-character room code reproduces the same station, roles, bot personalities and sabotage schedule for anyone who enters it. It is not a live lobby and the game says so. |
| RF wager | One RF-priced consumable with one weighted outcome table (`buy` → `play` → `settle` → `redeem`) | Tournament Pass (1 RF) → 1 pending play → `settle` opens the Reward Cache. `redeem` sells held salvage at its fixed value. |
| "Skill should pay out more" | `settle` draws from a fixed weight table; weights cannot change per play | Skill pays in **Salvage Points**, a session-only cosmetic currency that cannot be redeemed for RF. The RF layer is honestly a wager. |
| Persistent progression | Not supplied in v0.1.2 | Ranks, Salvage Points, suits and the roster reset when the session reloads. Stated in the UI. |

Nothing here claims a live transaction. `client.mode` drives the SIMULATED /
LIVE label everywhere RF appears.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | `W A S D` / arrow keys | Tap a destination on the station |
| Interact (task / report / emergency / console) | `E` | Tap the prompt button |
| Use ability (kill, impostor only) | `Q` | Ability button in the HUD |
| Vent (impostor only) | `R` | Vent button in the HUD |
| Task list | `T` | Task list button in the HUD |
| Mute | `M` | Mute button in the HUD |
| Cancel a task / close an overlay | `Esc` | Close (×) button |

Also provided: loading and error states with retry, reduced-motion support (the
in-match animations and sweeping task minigames go static), mute, and touch
targets of at least 44 px.

## Rules

- **Actors.** 7 total: your Friend plus 6 AI crewmates. 2 impostors.
- **Crew win:** complete 100% of crew tasks. **Impostor win:** living impostors
  reach parity with living crew, a 40 s reactor/O2 countdown expires, or the 420 s
  station clock runs out.
- **Tasks.** You have 6 (3 long, 3 short) of the crew's total; bots work their own.
  Each task is an RNG action sequence — wiring, keypad, dials, calibrate, sample,
  reboot. A failed or timed-out task stays available and can be retried.
- **Meetings.** Report a body or use the emergency button (once per match). Bots
  testify for 7 s, then you have 20 s to vote. Ties and skips eject nobody.
  After a meeting everyone returns to a spawn point and the bodies are cleared.
- **Kills.** Impostors can eliminate a crewmate in reach; a 25 s cooldown for you,
  ~28 s for AI impostors, who only strike when no third crewmate is within 220 px.
- **Sabotage.** Reactor and O2 run a 40 s countdown — fail to fix them and the
  impostors win. Lights cut your vision from 210 px to 90 px; comms hide task
  markers. Fix them at the matching console.
- **In-match randomness** (roles, bot personalities, sabotage schedule, task
  layouts, dialogue) is seeded from the room code. It is presentation and
  gameplay randomness only: **it never decides an RF outcome.**

## Economy (exact)

The consumable is a **Tournament Pass** at **1 RF** (`1000000000000000000` base
units). One pass produces exactly one weighted roll, which you open as a Reward
Cache after the match.

| Outcome | Chance | Reward |
| --- | ---: | ---: |
| Scrap Metal | 21.00% (2100 bps) | 0 RF |
| Spare Parts | 30.00% (3000 bps) | 0.25 RF |
| Circuit Board | 19.00% (1900 bps) | 0.50 RF |
| Power Cell | 15.00% (1500 bps) | 1.00 RF |
| Rare Alloy | 9.00% (900 bps) | 2.00 RF |
| Quantum Core | 4.00% (400 bps) | 5.00 RF |
| Genesis Artifact | 2.00% (200 bps) | 10.00 RF |
| **Total** | **100.00%** | **EV 0.90 RF / pass** |

- **House edge 10%** — deliberately the same edge as the SDK's fishing reference
  (0.90 RF expected per 1 RF pass), so the station economy reads as one system.
- **Consumable rule:** each purchased pass reserves the **10 RF** highest prize
  against free stake. New purchases stop when free stake cannot cover the reserve;
  already-bought passes stay playable. A pending play keeps its reserve until it
  is settled. Kept salvage keeps its full value reserved with no expiry.
- **Tiers:** *Practice* — 0 RF, the complete match, no rolls (this is how to test
  the game for free). *Standard* — 1 pass, 1 cache. *Elite* — 3 passes, 3 caches.
- **Plays never expire.** Unopened caches are listed in the Locker and can be
  opened after a reload, without buying another pass.

## Run it

Requires **Node.js 22+**, npm and Git. On Windows, run inside **WSL2 Ubuntu**
(the SDK's verified workflow), then open `http://localhost:4173` in the Windows
browser.

```sh
git clone https://github.com/spokesz/friendsdk.git
cd friendsdk
npm ci
npm run dev:game -- games/impostor-protocol
```

Open the printed URL, connect a browser wallet on **Robinhood mainnet (chain
4663)** holding a hardwired Rare Friends Generations NFT (generation ≥ 1), select
your Friend, and choose **Practice** to play a full round at no cost.

Static build (this is what the preview above is deployed from):

```sh
npx friendsdk build games/impostor-protocol
# static output: games/impostor-protocol/.friendsdk/
# publish that directory to any static host; the ownership gate stays intact.
```

## Checks

```sh
npx friendsdk check games/impostor-protocol
# games/impostor-protocol: valid; expected reward 900000000000000000 (0.90 RF);
# maximum 10000000000000000000 RF base units (10 RF); build 875905 bytes

./node_modules/.bin/tsc -p games/impostor-protocol/tsconfig.json
# exit 0, no errors

cd games/impostor-protocol && ../../node_modules/.bin/esbuild tests/sim.test.ts \
  --bundle --format=esm --platform=node --outfile=/tmp/sim.test.mjs && node --test /tmp/sim.test.mjs
# 13 tests, 13 pass, 0 fail
```

Browser checks run the **real SDK runtime in headless Chromium** — real host
frame, real sandboxed game document, real ownership gate, mocked wallet/RPC only:

```sh
node games/impostor-protocol/tests/browser-check.mjs        # lobby -> briefing -> station, zero console/page errors
node games/impostor-protocol/tests/task-check.mjs           # steered the Friend to the Electrical console, solved the
                                                            # wiring sequence, task counter 0/6 -> 1/6
node games/impostor-protocol/tests/overlay-check.mjs        # task list (6 rows, Esc closes), mute toggle,
                                                            # in-match Settings menu opens/closes, reduced motion honoured
node games/impostor-protocol/tests/meeting-check.mjs        # emergency meeting, 7 crew + Skip vote grid, live tally,
                                                            # the ejection verdict screen, then back to the station
node games/impostor-protocol/tests/mobile-check.mjs         # 390x844 phone viewport: 388x258 frame, start control,
                                                            # a 185x46 interaction prompt and all 6 task rows
node games/impostor-protocol/tests/economy-check.mjs        # paid round end to end (see below)
node games/impostor-protocol/tests/static-preview-check.mjs # serves the built preview over HTTP the way a static
                                                            # host does: every asset resolves, gate renders, no errors
```

The economy check drives the whole RF path through the real runtime: it approves
the host's **"Buy tournament pass"** and **"Use tournament pass"** confirmations,
plays the paid round to its debrief (a Standard round reported *IMPOSTOR WIN · YOU
SURVIVED · ★★★ RANK SPECIALIST · SALVAGE POINTS EARNED 100 · REWARD CACHES 0/1*),
opens the cache, and reads the roll back — in that run **Scrap Metal · 21%**, drawn
from the published table and labelled SIMULATED.

The simulation engine carries 13 unit tests covering walkability of every hub,
station, vent, console and spawn, lane connectivity, roster determinism, role and
impostor counts, crew/impostor win conditions, sabotage expiry, vent travel,
one-emergency-per-match and seed reproducibility.

## Assets

- Friend artwork: canonical Generations sprites read at runtime with the SDK's
  `createFriendReader()` from the public registry — never re-drawn or re-coloured
  in a way that changes the silhouette.
- All station, crewmate, console and UI art is original, drawn procedurally in
  canvas and CSS in this project. No third-party sprites, fonts or audio files.
- Sound: the SDK's procedural sound kit (`@rarefriends/friendsdk/sounds`).

## Known issues and capability gaps

- Single-player only. Friend Rooms are shared seeds, not networked lobbies; there
  is no way to see another player move in this build.
- No persistence: ranks, Salvage Points, owned suits and the roster are
  session-scoped and reset on reload.
- Salvage Points cannot be redeemed for RF and hold no prize reserve, by design.
- On-chain play is out of scope for this submission; the economy is simulated.
  Wiring the cache roll to the Dice RNG and the contract is a later-phase task.
- The AI impostor is intentionally simple (isolation heuristic + seeded sabotage
  schedule); it does not reason about the player's movement.
