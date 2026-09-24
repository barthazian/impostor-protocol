**Project name**
Rare Friends: Impostor Protocol

**Builder / contact**
Barthazian · [@barthazian](https://github.com/barthazian)

**Category**
Character Spotlight (primary) · Token Activity (secondary)

**What did you build?**
A single-player social-deduction round aboard a salvage station, played with your
own Rare Friend as the main character. You are one of seven crew; two are
impostors. Complete six RNG action-sequence tasks, watch for bodies, report them,
testify and vote — or, if you draw the impostor role, sabotage the reactor or the
O2 scrubbers, eliminate crewmates and vent between rooms. The station runs on a
420 s clock with vision-limited rendering, sabotage countdowns and AI crewmates
who work tasks and vote on their own suspicion.

**How does it use Rare Friends?**
Your selected Generations NFT *is* the player character: it is drawn from the
Friend's unmodified canonical 16×16 sprite mask (halo + mask, integer 5× scale,
tinted as a crew suit — the silhouette is never redrawn). The SDK runtime owns
wallet connection, owned-Friend selection and the fresh-ownership gate, which this
build keeps intact, and the only RF spent is the SDK's own weighted consumable:
a Tournament Pass whose Reward Cache is the prize roll.

**Source code**
[GitHub repository](https://github.com/barthazian/impostor-protocol) · FriendSDK v0.1.2
Game source lives in `game/`; the static preview build lives in `docs/`.

**Playable demo / how to run**
**https://barthazian.github.io/impostor-protocol/** — open in a browser with a wallet on Robinhood mainnet (chain 4663) holding a Generations NFT (generation ≥ 1); the SDK ownership gate runs before play. Practice tier costs 0 RF.

The preview needs a browser wallet on **Robinhood mainnet (chain 4663)** holding a
hardwired Generations NFT, **generation 1 or higher**. No RF funding, private key
or transaction signature is needed: balances and outcomes are simulated.

To run it locally, with Node.js 22+ (on Windows, inside WSL2 Ubuntu):

```sh
git clone https://github.com/spokesz/friendsdk.git
cd friendsdk
npm ci
npm run dev:game -- games/impostor-protocol
```

Open the printed URL (normally `http://localhost:4173`), connect the wallet and
choose your Friend. Pick **Practice** to play the complete round at zero cost.

**How do you play?**
Move with `W A S D` or the arrow keys, or tap a destination on the station. `E`
interacts (tasks, bodies, the emergency button, sabotage consoles), `Q` uses your
impostor ability, `R` vents, `T` opens the task list, `M` mutes, `Esc` closes an
overlay or cancels a task. On touch, the same actions are HUD buttons and the
interaction prompt.

Rules: 7 actors, 2 impostors. Crew win by completing every task; impostors win by
reaching parity with the living crew, letting the 40 s reactor/O2 countdown expire,
or running out the 420 s station clock. You have 6 tasks (3 long, 3 short); bot
crewmates work their own. Tasks are RNG action sequences — wiring, keypad, dials,
calibrate, sample, reboot — and a failed task stays available to retry. A meeting
gives bots 7 s of testimony and you 20 s to vote; ties and skips eject nobody.
Report a body or use the emergency button (once per match).

**Friend Rooms** are shared seeds, not networked lobbies: a 4-character room code
reproduces the same station, roles, bot personalities and sabotage schedule for
anyone who enters it, so a code is a shareable challenge. This is not live
multiplayer and the game says so in the interface.

**Costs and rewards**
Everything is simulated and labelled SIMULATED in the frame. The consumable is a
**Tournament Pass at 1 RF** (`1000000000000000000` base units). One pass produces
exactly one weighted roll, opened as a Reward Cache after the round:

| Outcome | Chance | Reward |
| --- | ---: | ---: |
| Scrap Metal | 21.00% | 0 RF |
| Spare Parts | 30.00% | 0.25 RF |
| Circuit Board | 19.00% | 0.50 RF |
| Power Cell | 15.00% | 1.00 RF |
| Rare Alloy | 9.00% | 2.00 RF |
| Quantum Core | 4.00% | 5.00 RF |
| Genesis Artifact | 2.00% | 10.00 RF |

Average reward **0.90 RF per 1 RF pass** (a 10% edge, the same as the SDK's fishing
reference). Consumable rules: each purchased pass reserves the 10 RF highest prize
against free stake, new purchases stop when free stake cannot cover the reserve,
a pending play keeps its reserve until it is settled, and kept salvage keeps its
full value reserved with no expiry. Tiers: **Practice** (0 RF, full round, no
rolls), **Standard** (1 pass, 1 cache), **Elite** (3 passes, 3 caches). Unopened
caches stay in the Locker and can be opened later without buying another pass.
Skill pays in **Salvage Points**, a session-only cosmetics currency that cannot be
redeemed for RF, because the SDK's outcome weights are fixed per roll.

**What have you tested?**
Run on Node 22 in WSL2 Ubuntu:

- `npx friendsdk check games/impostor-protocol` — valid; expected reward
  `900000000000000000` (0.90 RF); maximum `10000000000000000000` RF base units.
- `tsc -p games/impostor-protocol/tsconfig.json` — no errors (strict).
- 13 engine tests via `node --test` — 13 pass / 0 fail, covering walkability of
  every hub, station, vent, console and spawn, lane connectivity, roster
  determinism, role and impostor counts, crew/impostor win conditions, sabotage
  expiry, vent travel, one-emergency-per-match and seed reproducibility.
- Browser checks against the **real runtime** (real host frame, real sandboxed game
  document, real ownership gate; only the wallet and RPC are mocked):
  `browser-check.mjs` (lobby → briefing → station, zero console/page errors),
  `task-check.mjs` (steered the Friend to a console, solved the wiring sequence,
  task counter 0/6 → 1/6), `overlay-check.mjs` (task list, mute, in-match menu,
  reduced motion), and `economy-check.mjs` (the runtime's "Buy tournament pass"
  and "Use tournament pass" confirmations, then the round).
- The static preview build was served over HTTP and loaded in a real browser:
  every asset resolved and the ownership gate rendered with no page errors.

**Known limitations**
- Single-player only: Friend Rooms are shared seeds, not networked lobbies.
- No persistence — ranks, Salvage Points, owned suits and the roster are
  session-scoped and reset on reload (the SDK sandbox has no storage).
- On-chain play is out of scope for this submission; the RF economy is simulated.
  Wiring the cache roll to the Dice RNG and the contracts is a later-phase task.
- The AI impostor uses a simple isolation heuristic plus a seeded sabotage
  schedule; it does not reason about the player's movement.

**Credits**
All **character** artwork — the player's Friend, every crewmate and the impostor's
frame — is canonical on-chain Rare Friends artwork, read at runtime from the
Generations sprite registry: the player via the SDK's `createFriendReader()`, the
crewmates via the SDK's generation sprite reader, each from its own token. The
impostor's frame is one of those canonical masks with a reveal-only pixel treatment
(hostile tint, damaged halo) applied once the round is decided — never a redraw.
Station geometry, consoles and UI are drawn procedurally in canvas and CSS in this
project. Sound uses the SDK's procedural sound kit. No third-party sprites, fonts or
audio files.


## Artwork & assets provenance

Everything you see on the station falls into one of two buckets, and only one of them is Rare Friends artwork.

| element | what it is | how it is known |
|---|---|---|
| your Friend (the player) | its own **canonical on-chain sprite**, read at runtime and drawn as a 1px white halo then the mask at integer 5x — the silhouette is byte-for-byte canonical | `createFriendReader()`; `render.ts` |
| the NPC crewmates | **canonical on-chain artwork too, each from its own token** — read live from the Rare Friends Generations contract on Robinhood mainnet (chain 4663) through the SDK's generation sprite reader | `crew-art-check` proves 6 distinct tokens aboard, no token used twice, each actor's rows byte-equal to the recorded chain frames, and 0 fallbacks |
| the impostor | the **same canonical mask**, with a hostile tint (`#7c1220`) and a damaged halo (`#ff5f5f`) applied as pixel operations — and **only after the round is decided** | `crew-art-check` + `reveal-strip-check`: the treatment is absent from 138/138 live frames, including briefing frames, with computed-style sweeps finding nothing that paints `rgb(124,18,32)` or `rgb(255,95,95)`; at the reveal the named impostors wear it (2/2) and the crew carry zero hostile pixels (5/5) |
| the station (floor, walls, vents, consoles, props) | **drawn in code** as vector/canvas geometry — not Rare Friends artwork, and not third-party art either | the SDK's world-art generator emits isometric 1600x1200 SVG authored for a 3/4-view world (12 object layers, no `<image>`, no chain read), which does not sit correctly on this station's flat top-down plan; the artwork manifest's `seededLandscape`/`worldData` addresses are read by no SDK module, and all 20 plausible selectors revert on-chain |
| sound | the SDK's procedural sound kit — no audio files | — |
| third-party assets | **none**: no PNG/JPG/SVG/GIF, no `url()`, no `<img>`, no `new Image`, no `data:` URI anywhere in the game | `find` + `grep` across the source |

So: every **character** on the station is genuine on-chain Rare Friends artwork, the **station itself** is geometry drawn in code, and an impostor is a real Friend's own frame wearing a treatment you only ever see once the round is over.
