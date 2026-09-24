# IMPOSTOR PROTOCOL — design and economy (internal note)

Rare Friends Vibeathon entry. FriendSDK **v0.1.2**. Game directory:
`games/impostor-protocol`.

## One sentence

A single-player *Among Us*-style social-deduction round played on a Rare Friends
space station, where your owned Generations Friend is the main character, crew
tasks are RNG action sequences, and tournaments are entered with $RAREFRIENDS
(RF) whose weighted Reward Cache is the wager payout.

## What the SDK actually supports (checked against v0.1.2)

| Need | SDK v0.1.2 reality | Our adaptation |
| --- | --- | --- |
| Live multiplayer | **Not supported.** No networking, no save API, no `localStorage` in the sandbox. | AI crewmates. "Friend Rooms" are **deterministic seeds**: the same room code reproduces the same station, roles, bot personalities and sabotage schedule for anyone who enters it. Labeled in-game, no fake netcode. |
| Wager / currency | One RF-priced consumable + one weighted outcome table. `buy` → `play` → `settle` → `redeem`. | Tournament Pass (1 RF) = 1 cache roll. `settle` opens the cache. `redeem` sells salvage back for RF. |
| Skill affecting RF | `settle` draws from a fixed weight table; outcome cannot be weighted per play. | Skill pays in **Salvage Points (SP)**, a session-only cosmetic currency. RF is the wager layer. Both are labeled separately. No fake "skill improves payout" claim. |
| Persistence | None. Reload = new session. | Everything is session-scoped and stated as such in the UI. |
| Friend artwork | `createFriendReader().read(friendId)` returns canonical 16×16 clips, reachable from inside the sandbox. The SDK's generation sprite reader reads any other token the same way. | The player's Friend is drawn from its **unmodified canonical mask** (white halo + mask, 5× integer scale), tinted by crew color like a suit. Crewmates are canonical on-chain artwork too — each from its own token, read at runtime. The impostor's frame is one of those masks with a reveal-only pixel treatment (no redraw). |

## Game loop

1. **Airlock (lobby)** — pick a tier, enter or generate a Friend Room code, see
   the roster of AI Friends with their colors and traits.
2. **Briefing** — role assignment from the room seed: Crewmate or Impostor.
3. **Station (play)** — top-down station, vision-limited, camera on the player.
   - Crewmate: complete 6 tasks (RNG action sequences), watch for the impostor,
     report bodies, call the emergency meeting, vote.
   - Impostor: sabotage (lights / comms / O2 / reactor), eliminate crewmates,
     slip through vents, survive the votes.
4. **Meeting** — bots testify with seeded suspicion-driven lines, then vote.
   Ejections are announced; win conditions are checked.
5. **Debrief** — win/lose, rank stars, Salvage Points, then **open Reward
   Caches** for the tournament tiers (RF, weighted RNG).

## Economy (exact)

Consumable **Tournament Pass**, price **1 RF** (`1000000000000000000`).

| Outcome | Chance | Reward |
| --- | ---: | ---: |
| Scrap Metal | 21% (2100 bps) | 0 RF |
| Spare Parts | 30% (3000 bps) | 0.25 RF |
| Circuit Board | 19% (1900 bps) | 0.50 RF |
| Power Cell | 15% (1500 bps) | 1.00 RF |
| Rare Alloy | 9% (900 bps) | 2.00 RF |
| Quantum Core | 4% (400 bps) | 5.00 RF |
| Genesis Artifact | 2% (200 bps) | 10.00 RF |
| **Total** | **100%** | **EV 0.90 RF** |

- Expected reward **0.90 RF per pass**, house edge **10%** — identical edge to
  the SDK's fishing reference, so the economy reads as one system.
- One pass produces **exactly one** weighted roll. The max prize is **10 RF**,
  so each purchased pass reserves 10 RF and unopened caches stay backed.
- Tiers: **Practice** (0 RF, no rolls — the full match, free, for judges),
  **Standard** (1 pass → 1 cache), **Elite** (3 passes → 3 caches).
- `redeem` sells a held outcome back for its exact RF value; held salvage keeps
  its value with no expiry.

## Fair labelling rules we hold ourselves to

- Preview balance, purchases, rolls, inventory and redemptions are **simulated**
  and say so on screen. `client.mode` drives the label.
- In-match randomness (role assignment, sabotage schedule, task sequences, bot
  dialogue) is **presentation/gameplay RNG**, seeded per room code, and is
  never presented as an RF outcome.
- No claim of live transactions, ownership-independent play, or multiplayer.
- The real wallet + hardwired Generations NFT gate is the SDK runtime's.

## Capability gaps to declare in the submission

- No networking: Friend Rooms are shared seeds, not live lobbies.
- No persistence: ranks, SP and cosmetics reset on reload.
- Additional currency APIs, upgrade actions and persistent saves are not
  supplied by the SDK; our SP layer is in-match/session-only and not redeemable
  for RF, which is why it holds no prize reserve.
- On-chain play is out of scope for this prototype (simulated economy only).
