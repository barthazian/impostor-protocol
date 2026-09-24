# Rare Friends: Impostor Protocol

**▶ Play it now: https://barthazian.github.io/impostor-protocol/**

A single-player social-deduction round for the [Rare Friends Vibeathon](https://github.com/spokesz/rarefriends-vibeathon),
built on **FriendSDK v0.1.2**. Your own Rare Friends Generations Friend *is* the
player character — drawn from its unmodified canonical 16×16 sprite mask
(halo + mask, 5× integer scale, tinted like a crew suit, silhouette never redrawn).

**Builder:** Barthazian · [@barthazian](https://github.com/barthazian)
**Category:** Character Spotlight (primary) · Token Activity (secondary)

## What it is

A vision-limited space station, six AI crewmates, and impostors among them. Fix six
RNG action-sequence tasks, report bodies, argue in meetings, vote, and survive.
Sabotage countdowns force triage. Every round is reproducible from its 4-character
**Friend Room code** — no networking, just the same seed for everyone who enters it.

## How to play

- **Move** `W A S D` / arrow keys, or tap the floor. **Interact** `E` / tap the prompt.
- **Task list** `T` · **ability** `Q` · **vent** `R` (as impostor) · **mute** `M` · **close** `Esc`.
- Worked on a phone: the frame is 3:2, so at 390 px wide it renders a 388×258 station
  with a 185×46 touch prompt.

## Costs and rewards

| Tier | Cost | Reward |
| --- | --- | --- |
| Practice | 0 RF | no cache, full round |
| Standard | 1 Tournament Pass (1 RF) | 1 Reward Cache |
| Elite | 3 Tournament Passes (3 RF) | 3 Reward Caches |

Each cache is one weighted roll from the table in `game/game.json`: 21% Scrap Metal
(0 RF), 30% 0.25, 19% 0.5, 15% 1, 9% 2, 4% 5, 2% 10 RF — **EV 0.90 RF per 1 RF
pass, a 10% house edge**, maximum prize 10 RF. Skill pays **Salvage Points**, a
session-only cosmetics currency that is *not* redeemable for RF, because the SDK's
outcome weights are fixed per definition.

**Everything here is simulated** and labelled as such in-game: preview balances,
rolls, prizes and salvage never touch a contract and no payout is promised.

## Requirements

A browser wallet on **Robinhood mainnet (chain 4663)** holding a hardwired Rare
Friends Generations NFT, **generation ≥ 1**. The SDK's ownership gate runs before
play and this build keeps it intact. No RF, private key or signature is needed.

## This repository

```
docs/          the built static preview — this is what GitHub Pages serves
game/          the game source (index.tsx, src/, tests/, game.json, README.md)
SUBMISSION.md  the submitted write-up, in the vibeathon's expected format
PUBLISH.md     how this repo was produced / how to redeploy
```

The game source is the product; `docs/` is a build of it. To rebuild:

```sh
git clone https://github.com/spokesz/friendsdk && cd friendsdk && npm ci
cp -r <this repo>/game <friendsdk>/games/impostor-protocol
npm run dev:game -- games/impostor-protocol      # play locally on http://localhost:4173
npx friendsdk build games/impostor-protocol      # rebuild docs/
```

See `game/README.md` for the full verification log (what was tested and how) and
the known limitations.

## Credits

Built with FriendSDK v0.1.2 by Rare Friends. All **character** artwork — your
Friend, the crewmates and the impostor's frame — is canonical on-chain Rare
Friends artwork, read at runtime; the station geometry, the UI and the audio
cues are drawn and generated in code. See *Artwork & assets provenance* below
for exactly which is which.


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
