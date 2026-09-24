/**
 * IMPOSTOR PROTOCOL — every React screen of the game frame.
 *
 * Props come verbatim from `screens.ts` (frozen contract); `index.tsx` owns the
 * match, the SDK action client and the wallet. This module is presentation only:
 * it never touches the network, the wallet, or the simulation.
 *
 * Two contract notes worth keeping in mind while reading this file:
 *  - `HudProps` has no interact callback, so the HUD renders `state.prompt` as a
 *    read-only hint (the actionable prompt belongs to `index.tsx`, which owns
 *    the tap/E handling). The HUD itself is a click-through overlay: only its own
 *    buttons take pointer events.
 *  - `MatchState` carries no per-station completion flag. `TaskList` therefore
 *    marks a station done only from two honest signals it can actually see: the
 *    station that was active while `tasksDone` ticked up, and `task-done` events
 *    whose text names the station. The aggregate bars stay authoritative.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { formatGameAmount } from "@rarefriends/friendsdk/ui";
import { GameMenu } from "@rarefriends/friendsdk/frame";
import type {
  BriefingProps, CacheOffer, DebriefProps, EjectionProps, HudProps, InventoryRow,
  LobbyProps, LockerProps, MeetingProps, RosterEntry, SettingsProps, TaskListProps,
} from "./screens";
import {
  CREW_COLORS, ROOM_CODE_ALPHABET, TASK_LABELS,
  type ActorId, type CrewColorId, type Role, type SabotageKind, type Tier, type VoteTarget,
} from "./types";
import "./ui.css";

/* ---------------------------------------------------------------- *
 * formatting + small pure helpers (module-private)
 * ---------------------------------------------------------------- */

/** Every RF amount on screen goes through the SDK formatter at 18 decimals. */
function rf(value: bigint): string {
  return `${formatGameAmount(value, 18)} RF`;
}

/** Basis points → short percentage: 2100 → "21%", 50 → "0.5%". */
function chance(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`;
}

/** Simulation seconds → whole seconds, never negative. */
function seconds(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.ceil(value)) : 0;
}

/** Simulation time → mm:ss. */
function clock(at: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(at) ? at : 0));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Counter pair → clamped percentage for progress bars. */
function fraction(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

/** Crew-wide fraction (0..1) or already-scaled percent (0..100) → clamped percent. */
function percent(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(value <= 1 ? value * 100 : value)));
}

/** Friend Room codes are four characters from the SDK's alphabet. */
function roomCode(input: string): string {
  return input
    .toUpperCase()
    .split("")
    .filter(character => ROOM_CODE_ALPHABET.includes(character))
    .slice(0, 4)
    .join("");
}

function swatch(color: CrewColorId): { background: string } {
  return { background: CREW_COLORS[color] };
}

/** The crew roster may already name the player "You"; don't stack a second badge. */
function needsYouBadge(name: string): boolean {
  return name.trim().toLowerCase() !== "you";
}

/* ---------------------------------------------------------------- *
 * economy facts the screens must state verbatim
 * ---------------------------------------------------------------- */

type CacheOutcome = Readonly<{ name: string; chanceBps: number; reward: bigint }>;

/**
 * The Reward Cache weight table this game settles against (DESIGN.md). The SDK
 * action client draws the outcome; this table is what the player is shown.
 * `screens.ts` exposes no odds prop, so the published table lives here.
 */
const CACHE_OUTCOMES: readonly CacheOutcome[] = Object.freeze([
  { name: "Scrap Metal", chanceBps: 2100, reward: 0n },
  { name: "Spare Parts", chanceBps: 3000, reward: 250000000000000000n },
  { name: "Circuit Board", chanceBps: 1900, reward: 500000000000000000n },
  { name: "Power Cell", chanceBps: 1500, reward: 1000000000000000000n },
  { name: "Rare Alloy", chanceBps: 900, reward: 2000000000000000000n },
  { name: "Quantum Core", chanceBps: 400, reward: 5000000000000000000n },
  { name: "Genesis Artifact", chanceBps: 200, reward: 10000000000000000000n },
]);

/** Σ(bps × reward): basis points times base units. */
const CACHE_SCALED_RETURN = CACHE_OUTCOMES.reduce((sum, outcome) => sum + BigInt(outcome.chanceBps) * outcome.reward, 0n);
const CACHE_ROLL_TOTAL = CACHE_OUTCOMES.reduce((sum, outcome) => sum + outcome.chanceBps, 0);
/** Expected return of one pass, in base units (exact integer division). */
const CACHE_EXPECTED = CACHE_SCALED_RETURN / 10000n;
/** House edge in whole percent, integer-exact: (10000 - Σ(bps × RF)) / 100. */
const CACHE_EDGE_PERCENT = Number(10000n - CACHE_SCALED_RETURN / 10n ** 18n) / 100;
const CACHE_MAX_REWARD = CACHE_OUTCOMES.reduce<bigint>((max, outcome) => (outcome.reward > max ? outcome.reward : max), 0n);

type TierRow = Readonly<{ id: Tier; name: string; passes: bigint; caches: number; blurb: string }>;

const TIER_ROWS: readonly TierRow[] = Object.freeze([
  { id: "practice", name: "Practice", passes: 0n, caches: 0, blurb: "The whole round, free. No pass is spent and no cache is rolled." },
  { id: "standard", name: "Standard", passes: 1n, caches: 1, blurb: "One pass buys exactly one weighted cache roll." },
  { id: "elite", name: "Elite", passes: 3n, caches: 3, blurb: "Three passes buy three weighted cache rolls." },
]);

const ROLE_CHOICES: readonly Readonly<{ id: Role | "random"; name: string; note: string }>[] = Object.freeze([
  { id: "random", name: "Random", note: "The seed decides" },
  { id: "crew", name: "Crewmate", note: "Requested" },
  { id: "impostor", name: "Impostor", note: "Requested" },
]);

const SABOTAGE_TEXT: Readonly<Record<Exclude<SabotageKind, "none">, string>> = Object.freeze({
  lights: "Lights sabotaged",
  comms: "Comms down",
  o2: "Oxygen critical",
  reactor: "Reactor meltdown",
});

/* ---------------------------------------------------------------- *
 * shared pieces
 * ---------------------------------------------------------------- */

function Progress({ label, value, detail, tone }: {
  label: string; value: number; detail?: string; tone?: "info" | "danger";
}): ReactElement {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="ip-progress">
      <p className="ip-progress-head"><span>{label}</span><b>{detail ?? `${clamped}%`}</b></p>
      <div className={tone ? `ip-bar ip-bar--${tone}` : "ip-bar"} role="progressbar" aria-label={label}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={clamped}>
        <i style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

function RosterList({ roster, hint }: { roster: readonly RosterEntry[]; hint: string }): ReactElement {
  return (
    <>
      {roster.length > 0 && (
        <ul className="ip-roster">
          {roster.map(entry => (
            <li key={entry.id} data-you={entry.isPlayer || undefined}>
              <span className="ip-dot" style={swatch(entry.color)} aria-hidden="true" />
              <span className="ip-roster-name">
                <b>{entry.name || entry.id}</b>
                {entry.isPlayer && needsYouBadge(entry.name) && <span className="ip-chip ip-chip--accent">You</span>}
              </span>
              <span className="ip-tag">{entry.tag}</span>
            </li>
          ))}
        </ul>
      )}
      {roster.length === 0 && <p className="ip-note">{hint}</p>}
    </>
  );
}

function OddsTable(): ReactElement {
  return (
    <table className="ip-table">
      <thead>
        <tr><th scope="col">Salvage</th><th scope="col">Chance</th><th scope="col">Reward</th></tr>
      </thead>
      <tbody>
        {CACHE_OUTCOMES.map(outcome => (
          <tr key={outcome.name}>
            <th scope="row">{outcome.name}</th>
            <td>{chance(outcome.chanceBps)}</td>
            <td>{rf(outcome.reward)}</td>
          </tr>
        ))}
        <tr data-total="true">
          <th scope="row">Total</th>
          <td>{chance(Number(CACHE_ROLL_TOTAL))}</td>
          <td>{rf(CACHE_EXPECTED)} expected</td>
        </tr>
      </tbody>
    </table>
  );
}

function InventoryList({ inventory, busy, onRedeem }: {
  inventory: readonly InventoryRow[]; busy: boolean; onRedeem: (outcomeId: number) => void;
}): ReactElement {
  return (
    <ul className="ip-inv">
      {inventory.map(row => (
        <li className="ip-inv-row" key={row.outcomeId}>
          <span className="ip-inv-meta">
            <b>{row.name || `Salvage #${row.outcomeId}`}</b>
            <span className="ip-chip">×{row.count.toString()}</span>
            <span className="ip-note">{chance(row.chanceBps)} · {rf(row.reward)} each</span>
          </span>
          <button className="ip-btn ip-btn--sm" type="button" disabled={busy || row.reward === 0n}
            aria-label={`Redeem ${row.name || `salvage ${row.outcomeId}`} for ${rf(row.reward)} each`}
            onClick={() => onRedeem(row.outcomeId)}>
            {row.reward > 0n ? `Redeem · ${rf(row.reward)}` : "No RF value"}
          </button>
        </li>
      ))}
    </ul>
  );
}

function CacheCard({ cache, busy, open, kept, onOpen, onKeep, onRedeem }: {
  cache: CacheOffer; busy: boolean; open: boolean; kept: boolean;
  onOpen: () => void; onKeep: () => void; onRedeem: (outcomeId: number) => void;
}): ReactElement {
  const outcomeId = cache.outcomeId;
  return (
    <article className="ip-cache" data-open={open || undefined}>
      <div className="ip-cache-top">
        <b>Cache #{cache.playId.toString()}</b>
        <span className="ip-chip">
          {outcomeId === null ? (cache.opened ? "Awaiting result" : "Unopened") : cache.reward > 0n ? "Ready" : "No RF value"}
        </span>
      </div>
      {outcomeId === null ? (
        <>
          <p className="ip-note">
            {cache.opened
              ? "This cache was opened but has no result yet. Checking again never spends a second pass."
              : "One weighted roll from the published table. Opening spends the pass and the outcome cannot be re-rolled."}
          </p>
          <button className="ip-btn ip-btn--primary" type="button" disabled={busy} onClick={onOpen}>
            {cache.opened ? "Check result" : "Open cache"}
          </button>
        </>
      ) : kept ? (
        <p className="ip-note">
          Kept <b>{cache.name || "salvage"}</b> — it stays in held salvage at its exact RF value until you redeem it.
        </p>
      ) : (
        <>
          <div className="ip-cache-reveal">
            <span className="ip-eyebrow">Revealed</span>
            <b>{cache.name || "Unknown salvage"}</b>
            <span className="ip-note">{chance(cache.chanceBps)} chance · {cache.reward > 0n ? rf(cache.reward) : "no RF value"}</span>
          </div>
          <div className="ip-cache-actions">
            <button className="ip-btn" type="button" onClick={onKeep}>Keep</button>
            <button className="ip-btn ip-btn--primary" type="button" disabled={busy || cache.reward === 0n}
              onClick={() => onRedeem(outcomeId)}>
              {cache.reward > 0n ? `Redeem · ${rf(cache.reward)}` : "No RF value"}
            </button>
          </div>
        </>
      )}
    </article>
  );
}

/* ---------------------------------------------------------------- *
 * Lobby
 * ---------------------------------------------------------------- */

export function Lobby({
  friendId, stationName, tier, onTier, roomCode: code, onRoomCode, onRandomRoom,
  roleChoice, onRoleChoice, roster, passes, rfBalance, freeStake, maxPrize, price,
  simulated, busy, error, note, onStart, onLocker, onSettings, salvage,
}: LobbyProps): ReactElement {
  const tierRow = TIER_ROWS.find(row => row.id === tier) ?? TIER_ROWS[0];
  const stake = tierRow.passes * price;
  const feedback = error || note || (tierRow.id === "practice"
    ? "Practice is free: no pass is spent and no cache is rolled."
    : `${tierRow.passes} pass${tierRow.passes === 1n ? "" : "es"} (${rf(stake)}) would be spent from this Friend's RF balance.`);

  return (
    <section className="ip ip-lobby" aria-label="Airlock lobby">
      <header className="ip-lobby-head">
        <div className="ip-head-left">
          <p className="ip-eyebrow">Rare Friends · Impostor Protocol</p>
          <h1 className="ip-title">{stationName || "Unknown station"}</h1>
          <p className="ip-sub">Friend #{friendId} · {roster.length} crew aboard · Salvage Points {salvage}</p>
        </div>
        <div className="ip-head-right">
          <div className="ip-kv">
            <span><em>Passes</em><b>{passes.toString()}</b></span>
            <span><em>RF balance</em><b>{rf(rfBalance)}</b></span>
            <span><em>Pass price</em><b>{rf(price)}</b></span>
            <span><em>Free stake</em><b>{rf(freeStake)}</b></span>
            <span><em>Max prize</em><b>{rf(maxPrize)}</b></span>
          </div>
          <div className="ip-head-actions">
            <button className="ip-btn ip-btn--sm" type="button" onClick={onLocker}>Locker</button>
            <button className="ip-btn ip-btn--sm" type="button" onClick={onSettings}>Settings</button>
          </div>
        </div>
      </header>

      <div className="ip-lobby-body">
        <section className="ip-card" aria-labelledby="ip-tier-heading">
          <h2 className="ip-h" id="ip-tier-heading">Tournament tier</h2>
          <div className="ip-tiers" role="radiogroup" aria-label="Tournament tier">
            {TIER_ROWS.map(row => (
              <label key={row.id} className="ip-tier" data-selected={row.id === tier || undefined}>
                <input type="radio" name="ip-tier" value={row.id} checked={row.id === tier} disabled={busy}
                  onChange={() => onTier(row.id)} />
                <span className="ip-tier-top">
                  <b>{row.name}</b>
                  <span>{row.passes === 0n ? "0 RF · no cache" : `${row.passes} pass${row.passes === 1n ? "" : "es"} · ${rf(row.passes * price)}`}</span>
                </span>
                <span className="ip-tier-sub">{row.blurb}</span>
              </label>
            ))}
          </div>
          <p className="ip-note">
            A pass reserves <b>{rf(maxPrize)}</b> of free stake and buys exactly one weighted roll. Unopened
            caches stay backed by that reserve, and a held outcome keeps its exact RF value with no expiry.
          </p>
        </section>

        <section className="ip-card" aria-labelledby="ip-room-heading">
          <h2 className="ip-h" id="ip-room-heading">Friend Room</h2>
          <div className="ip-room">
            <input className="ip-input ip-code" type="text" value={code} maxLength={4} placeholder="CODE"
              autoComplete="off" spellCheck={false} aria-label="Friend Room code" disabled={busy}
              onChange={event => onRoomCode(roomCode(event.target.value))} />
            <button className="ip-btn" type="button" disabled={busy} onClick={onRandomRoom}>Random</button>
          </div>
          <p className="ip-note">
            <b>A Friend Room is a shared seed, not a live lobby.</b> Anyone entering the same four characters
            gets the same station, the same role draw, the same bot personalities and the same sabotage
            schedule — the code decides the round. SDK v0.1.2 has no networking, so no second player can
            actually join your station.
          </p>
        </section>

        <section className="ip-card" aria-labelledby="ip-role-heading">
          <h2 className="ip-h" id="ip-role-heading">Your role</h2>
          <div className="ip-tiers" role="radiogroup" aria-label="Requested role">
            {ROLE_CHOICES.map(choice => (
              <label key={choice.id} className="ip-tier" data-selected={choice.id === roleChoice || undefined}>
                <input type="radio" name="ip-role" value={choice.id} checked={choice.id === roleChoice} disabled={busy}
                  onChange={() => onRoleChoice(choice.id)} />
                <span className="ip-tier-top"><b>{choice.name}</b><span>{choice.note}</span></span>
              </label>
            ))}
          </div>
          <p className="ip-note">
            The room seed deals the roles. <em>Random</em> lets the seed choose; a named role is a request the
            round tries to honour. Neither changes what a cache can pay.
          </p>
        </section>

        <section className="ip-card" aria-labelledby="ip-roster-heading">
          <h2 className="ip-h" id="ip-roster-heading">Crew manifest</h2>
          <RosterList roster={roster} hint="No crew is aboard yet." />
        </section>

        <section className="ip-card ip-card--wide" aria-labelledby="ip-odds-heading">
          <h2 className="ip-h" id="ip-odds-heading">Passes, caches and the exact odds</h2>
          <div className="ip-split">
            <div className="ip-section">
              <p className="ip-eyebrow">Tiers</p>
              <table className="ip-table">
                <thead><tr><th scope="col">Tier</th><th scope="col">Cost</th><th scope="col">Caches</th></tr></thead>
                <tbody>
                  {TIER_ROWS.map(row => (
                    <tr key={row.id}>
                      <th scope="row">{row.name}</th>
                      <td>{row.passes === 0n ? "0 RF" : `${row.passes} pass${row.passes === 1n ? "" : "es"} · ${rf(row.passes * price)}`}</td>
                      <td>{row.caches === 0 ? "None" : row.caches}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ip-section">
              <p className="ip-eyebrow">Reward cache odds · one pass = one roll</p>
              <OddsTable />
            </div>
          </div>
          <p className="ip-note">
            Expected return <b>{rf(CACHE_EXPECTED)}</b> per pass, a <b>{CACHE_EDGE_PERCENT}%</b> house edge, maximum
            prize <b>{rf(CACHE_MAX_REWARD)}</b>. Redeem sells held salvage back for its exact RF value.
          </p>
          {simulated ? (
            <p className="ip-note">
              <b>Simulated:</b> in preview the pass purchase, the roll, every balance and every redemption are
              simulated — no transaction is created and no payout is promised. Playing still requires a Generations
              Friend this wallet owns; the SDK runtime owns wallet connection, the ownership gate and purchases,
              outside this frame.
            </p>
          ) : (
            <p className="ip-note">
              <b>Chain mode:</b> the SDK runtime settles pass purchases and redemptions against this Friend's RF
              wallet. The game frame never renders the wallet, never signs anything and promises no payout — it only
              reports what the runtime returned.
            </p>
          )}
          <p className="ip-note">
            Salvage Points (<b>{salvage}</b> this session) are a session-only cosmetics currency earned by playing.
            They are <b>not</b> redeemable for RF, and ranks, points and cosmetics reset when the page reloads.
          </p>
        </section>
      </div>

      <footer className="ip-lobby-foot">
        <p className="ip-feedback" role={error ? "alert" : "status"} data-tone={error ? "error" : note ? "note" : "message"}>
          {feedback}
        </p>
        <div className="ip-foot-actions">
          <span className={simulated ? "ip-sim" : "ip-chip"}>{simulated ? "Simulated" : "Chain mode"}</span>
          <button className="ip-btn ip-btn--primary ip-start" type="button" disabled={busy} onClick={onStart}>
            {busy ? "Working…" : tierRow.passes === 0n ? "Start practice round" : `Enter ${tierRow.name} · ${tierRow.passes} pass${tierRow.passes === 1n ? "" : "es"}`}
          </button>
        </div>
      </footer>
    </section>
  );
}

/* ---------------------------------------------------------------- *
 * Briefing (role reveal)
 * ---------------------------------------------------------------- */

export function Briefing({ state, roster, impostorCount, onBegin, reducedMotion, onReducedMotion }: BriefingProps): ReactElement {
  const impostor = state.config.playerRole === "impostor";
  const count = `${impostorCount} impostor${impostorCount === 1 ? "" : "s"}`;
  const plan: readonly Readonly<{ text: string; danger?: boolean }>[] = impostor
    ? [
        { text: "Break the crew: eliminations and sabotage are how you win.", danger: true },
        { text: "Vent to move unseen — the crew cannot follow you through the ducts.", danger: true },
        { text: "Sabotage to pull the crew apart while you are somewhere else.", danger: true },
        { text: `Survive the votes. There are ${count} aboard, and you are one of them.`, danger: true },
      ]
    : [
        { text: `Finish your ${state.tasksTotal} station tasks — every one moves the crew bar.` },
        { text: "Find the bodies and report them before the impostors thin the crew." },
        { text: "Call an emergency meeting at the button to force a vote." },
        { text: `Vote carefully: there ${impostorCount === 1 ? "is" : "are"} ${count} among you, and ejecting crew helps them.` },
      ];

  return (
    <section className="ip ip-brief" data-role={state.config.playerRole} aria-label="Mission briefing">
      <header className="ip-brief-head">
        <div className="ip-head-left">
          <p className="ip-eyebrow">Role assignment · room seed {state.config.seed}</p>
          <h1 className="ip-title">{state.station.name || "Station"}</h1>
          <p className="ip-sub">
            {state.config.playerName} · Friend #{state.config.friendId} · {roster.length} crew aboard · {count} aboard
          </p>
        </div>
        <div className="ip-head-right">
          <span className={impostor ? "ip-chip ip-chip--danger" : "ip-chip ip-chip--accent"}>
            {impostor ? "You are the Impostor" : "You are Crew"}
          </span>
          <span className="ip-chip">{state.tasksTotal} tasks assigned</span>
        </div>
      </header>

      <div className="ip-brief-body">
        <section className="ip-role" data-role={state.config.playerRole} aria-labelledby="ip-brief-role">
          <h2 id="ip-brief-role">{impostor ? "Impostor" : "Crewmate"}</h2>
          <p className="ip-note">
            {impostor
              ? "Nobody knows it is you. Kill the crew, break the station, and be standing somewhere else when the meeting starts."
              : "You are crew. Finish the tasks, watch who moves wrong, and use the vote."}
          </p>
          <p className="ip-note">
            {impostor
              ? `Impostors aboard: ${count} — the crew only knows there is at least one.`
              : `Impostors aboard: ${count}. Nobody knows who they are.`}
          </p>
        </section>

        <section className="ip-card" aria-labelledby="ip-brief-roster">
          <h2 className="ip-h" id="ip-brief-roster">Crew roster</h2>
          <RosterList roster={roster} hint="No crew is aboard yet." />
        </section>

        <section className="ip-card" aria-labelledby="ip-brief-plan">
          <h2 className="ip-h" id="ip-brief-plan">Mission plan</h2>
          <ul className="ip-plan">
            {plan.map(item => (
              <li key={item.text} data-danger={item.danger || undefined}>{item.text}</li>
            ))}
          </ul>
          <p className="ip-note">
            Roles, bot personalities and the sabotage schedule all come out of this room seed, so the same code
            always produces the same round.
          </p>
        </section>
      </div>

      <footer className="ip-brief-foot">
        <label className="ip-toggle">
          <input type="checkbox" checked={reducedMotion} onChange={event => onReducedMotion(event.target.checked)} />
          <span className="ip-toggle-text">
            <b>Reduce motion</b>
            <span>Shortens HUD and reveal animation in the frame.</span>
          </span>
        </label>
        <button className="ip-btn ip-btn--primary ip-start" type="button" onClick={onBegin}>
          {impostor ? "Begin the hunt" : "Begin the shift"}
        </button>
      </footer>
    </section>
  );
}

/* ---------------------------------------------------------------- *
 * HUD
 * ---------------------------------------------------------------- */

export function Hud({ state, muted, onToggleMute, onMenu, onTaskList, onAbility, onVent, visionLabel }: HudProps): ReactElement {
  const [crewListOpen, setCrewListOpen] = useState(false);
  const player = state.actors.find(actor => actor.id === state.playerId) ?? null;
  const impostor = state.config.playerRole === "impostor";
  const down = player ? !player.alive || player.state === "down" : false;
  const living = state.actors.filter(actor => actor.alive).length;
  const feed = state.events.slice(-3).reverse();
  const prompt = state.prompt;
  const sabotage = state.sabotage === "none" ? null : state.sabotage;
  const sabotageLeft = sabotage ? seconds(state.sabotageEndsAt - state.time) : 0;

  return (
    <div className="ip ip-hud" aria-label="Match HUD"
      onKeyDown={event => {
        if (event.key === "Escape" && crewListOpen) { event.stopPropagation(); setCrewListOpen(false); }
      }}>
      <div className="ip-hud-top">
        <div className="ip-hud-left">
          <Progress label="Your tasks" value={fraction(state.tasksDone, state.tasksTotal)}
            detail={`${state.tasksDone}/${state.tasksTotal}`} />
          <Progress label="Crew tasks" value={percent(state.crewProgress)} tone="info" />
          {prompt && (
            <p className="ip-hint" data-kind={prompt.kind}>
              <kbd className="ip-keycap">E</kbd>
              <span>{prompt.label}</span>
            </p>
          )}
          {state.alarm && state.phase !== "play" && <p className="ip-hud-alarm" title={state.alarm}>{state.alarm}</p>}
        </div>

        <div className="ip-hud-right">
          <div className="ip-hud-buttons">
            <button className="ip-btn ip-btn--sm ip-hud-btn" type="button" aria-pressed={muted} onClick={onToggleMute}>
              {muted ? "Sound off" : "Sound on"}
            </button>
            <button className="ip-btn ip-btn--sm ip-hud-btn" type="button" aria-expanded={crewListOpen}
              onClick={() => setCrewListOpen(open => !open)}>
              Crew {living}/{state.actors.length}
            </button>
            <button className="ip-btn ip-btn--sm ip-hud-btn" type="button" onClick={onTaskList}>Tasks</button>
            <button className="ip-btn ip-btn--sm ip-hud-btn" type="button" onClick={onMenu}>Menu</button>
          </div>
          <p className="ip-vision" title="Vision range">{visionLabel}</p>
          {down && <span className="ip-chip ip-chip--danger">You are down</span>}
        </div>
      </div>

      <div className="ip-hud-mid">
        <div className="ip-hud-banner">
          {sabotage && (
            <p className="ip-sabotage" role="status">
              <span>{SABOTAGE_TEXT[sabotage]}</span>
              <b>{sabotageLeft}s</b>
            </p>
          )}
        </div>
        {crewListOpen && (
          <ul className="ip-hud-roster" aria-label="Crew list">
            {state.actors.map(actor => (
              <li key={actor.id} data-alive={actor.alive || undefined}>
                <span className="ip-dot" style={swatch(actor.color)} aria-hidden="true" />
                <span className="ip-hud-roster-name">
                  <b>{actor.name || actor.id}</b>
                  {actor.isPlayer && needsYouBadge(actor.name) && <span className="ip-chip ip-chip--accent">You</span>}
                </span>
                <span className="ip-hud-roster-state">{actor.alive ? (actor.state === "working" ? "Working" : "Alive") : "Down"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="ip-hud-foot">
        {feed.length > 0 && (
          <ul className="ip-feed" aria-label="Recent events">
            {feed.map(event => <li key={event.id}>{clock(event.at)} · {event.text}</li>)}
          </ul>
        )}
        <div className="ip-hud-actions">
          {impostor && (
            <>
              <button className="ip-btn ip-btn--sm ip-btn--danger ip-hud-btn" type="button" disabled={down}
                title="Kill (Q)" onClick={onAbility}>Kill</button>
              <button className="ip-btn ip-btn--sm ip-hud-btn" type="button" disabled={down}
                title="Vent in / out (R)" onClick={onVent}>Vent</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Task list
 * ---------------------------------------------------------------- */

export function TaskList({ state, onClose, visible }: TaskListProps): ReactElement {
  const sheet = useRef<HTMLDivElement>(null);
  const learned = useRef<Set<string>>(new Set());
  const lastActive = useRef<string | null>(null);
  const lastDone = useRef(state.tasksDone);
  const stations = state.station.stations;

  // The contract exposes no per-station flag: a station that was active while the
  // completion counter ticked up is the only completion this list can observe.
  if (state.activeTask) lastActive.current = state.activeTask.stationId;
  else if (lastActive.current !== null && state.tasksDone > lastDone.current) {
    learned.current.add(lastActive.current);
    lastActive.current = null;
  }
  lastDone.current = state.tasksDone;

  useEffect(() => {
    if (!visible) return;
    const node = sheet.current;
    node?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    node?.addEventListener("keydown", onKey);
    return () => node?.removeEventListener("keydown", onKey);
  }, [visible, onClose]);

  if (!visible) return <></>;

  // Second honest signal: a `task-done` event for this player whose text names the station.
  const named = new Set<string>();
  for (const event of state.events) {
    if (event.kind !== "task-done") continue;
    if (event.actorId !== undefined && event.actorId !== state.playerId) continue;
    const text = event.text.toLowerCase();
    for (const station of stations) {
      const candidates = [station.name, TASK_LABELS[station.kind]].filter(value => value.length > 2);
      if (candidates.some(value => text.includes(value.toLowerCase()))) named.add(station.id);
    }
  }
  const isDone = (id: string) => learned.current.has(id) || named.has(id);
  const zones = state.station.zones
    .map(zone => ({ zone, list: stations.filter(station => station.zoneId === zone.id) }))
    .filter(entry => entry.list.length > 0);

  return (
    <div className="ip ip-tasklist">
      <div className="ip-overlay">
        <div className="ip-sheet" ref={sheet} role="dialog" aria-modal="true" aria-label="Task list" tabIndex={-1}>
          <header className="ip-sheet-head">
            <div className="ip-head-left">
              <p className="ip-eyebrow">Task list</p>
              <h2 className="ip-h">{state.station.name || "Station"}</h2>
            </div>
            <button className="ip-btn ip-btn--sm" type="button" onClick={onClose}>Close</button>
          </header>

          <div className="ip-sheet-body">
            <div className="ip-progress-block">
              <Progress label="Your tasks" value={fraction(state.tasksDone, state.tasksTotal)}
                detail={`${state.tasksDone}/${state.tasksTotal} done`} />
              <Progress label="Crew progress" value={percent(state.crewProgress)} tone="info" />
            </div>

            {state.activeTask && (
              <p className="ip-note">
                <em>In progress:</em> {state.activeTask.name || TASK_LABELS[state.activeTask.kind]}
                {state.activeTask.long ? " · long task" : ""}
              </p>
            )}

            {zones.length === 0 && <p className="ip-note">This station has no task stations listed.</p>}

            {zones.map(({ zone, list }) => (
              <section className="ip-zone" key={zone.id}>
                <h3><span>{zone.name || zone.id}</span><span>{zone.kind}</span></h3>
                <ul className="ip-trows">
                  {list.map(station => {
                    const done = isDone(station.id);
                    const active = state.activeTask !== null && state.activeTask.stationId === station.id;
                    return (
                      <li className="ip-trow" key={station.id} data-done={done || undefined} data-active={active || undefined}>
                        <span className="ip-check" aria-hidden="true">{done ? "✓" : ""}</span>
                        <span className="ip-trow-name">
                          <b>{station.name || TASK_LABELS[station.kind]}</b>
                          <span className="ip-trow-kind">{TASK_LABELS[station.kind]}{station.long ? " · long task" : ""}</span>
                        </span>
                        <span className="ip-chip">{active ? "In progress" : done ? "Done" : "Not done yet"}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}

            <p className="ip-note">
              The bars above are the match totals. Rows check off as tasks finish in front of you, so a task finished
              before this list was open may still read as not done.
            </p>
          </div>

          <footer className="ip-sheet-foot">
            <span className="ip-note">Press <kbd className="ip-keycap">Esc</kbd> to close.</span>
            <button className="ip-btn" type="button" onClick={onClose}>Close</button>
          </footer>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Meeting
 * ---------------------------------------------------------------- */

export function Meeting({ state, roster, remaining, localVotes, onVote }: MeetingProps): ReactElement {
  const meeting = state.meeting;
  const chat = useRef<HTMLDivElement>(null);
  const lineCount = meeting ? meeting.lines.length : 0;

  useEffect(() => {
    const node = chat.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lineCount]);

  if (!meeting) {
    return (
      <section className="ip ip-meet" aria-label="Emergency meeting">
        <p className="ip-note">No meeting is in session.</p>
      </section>
    );
  }

  const names = new Map<ActorId, string>(state.actors.map(actor => [actor.id, actor.name || actor.id] as const));
  const tags = new Map<ActorId, string>(roster.map(entry => [entry.id, entry.tag] as const));
  const voteText = (target: VoteTarget): string => (target === "skip" ? "Skip" : names.get(target) ?? target);
  const reporter = names.get(meeting.reporterId) ?? meeting.reporterId;
  const victim = meeting.victimId === null ? null : names.get(meeting.victimId) ?? meeting.victimId;
  const mine = localVotes[state.playerId];
  const living = state.actors.filter(actor => actor.alive).length;
  const votesIn = Object.keys(meeting.votes).length;

  return (
    <section className="ip ip-meet" aria-label="Emergency meeting">
      <header className="ip-meet-head">
        <div className="ip-head-left">
          <p className="ip-eyebrow">
            {meeting.resolved ? "Votes resolved" : "Voting open"} · {clock(meeting.startedAt)}–{clock(meeting.endsAt)} ·
            tasks {state.tasksDone}/{state.tasksTotal}
          </p>
          <h1 className="ip-title">{victim ? `${reporter} reported ${victim}` : `${reporter} called an emergency meeting`}</h1>
          <p className="ip-sub">
            {victim ? `${victim} was found dead. ` : "The crew is talking. "}
            {living} of {state.actors.length} crew alive
          </p>
        </div>
        <div className="ip-head-right">
          <span className="ip-chip ip-chip--accent">Closes in {seconds(remaining)}s</span>
          <span className="ip-chip">{votesIn}/{state.actors.length} votes in</span>
        </div>
      </header>

      <div className="ip-meet-body">
        <div className="ip-chat-wrap">
          <div className="ip-chat" ref={chat} role="log" aria-label="Testimony" tabIndex={0}>
            {meeting.lines.length === 0 && <p className="ip-note">Nobody has spoken yet.</p>}
            {meeting.lines.map(line => (
              <article className="ip-line" key={line.id} data-you={line.actorId === state.playerId || undefined}>
                <span className="ip-dot" style={swatch(line.color)} aria-hidden="true" />
                <div className="ip-line-body">
                  <div className="ip-line-head">
                    <b>{line.name || line.actorId}</b>
                    <time>{clock(line.at)}</time>
                  </div>
                  <p className="ip-line-text">{line.text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="ip-votes">
          <div className="ip-tally">
            <p className="ip-eyebrow">Your vote</p>
            {mine === undefined
              ? <p className="ip-waiting">Waiting for your vote</p>
              : <span className="ip-chip ip-chip--info">Locked: {voteText(mine)}</span>}
          </div>

          <div className="ip-vote-grid" role="group" aria-label="Cast your vote">
            {state.actors.map(actor => {
              const cast = meeting.votes[actor.id];
              const meta = !actor.alive
                ? "down"
                : mine === actor.id
                  ? "your vote"
                  : cast !== undefined
                    ? (meeting.resolved ? `voted ${voteText(cast)}` : "vote in")
                    : tags.get(actor.id) ?? "crew";
              return (
                <button key={actor.id} className="ip-vote" type="button" data-dead={!actor.alive || undefined}
                  aria-pressed={mine === actor.id} disabled={!actor.alive} onClick={() => onVote(actor.id)}>
                  <span className="ip-dot" style={swatch(actor.color)} aria-hidden="true" />
                  <span className="ip-vote-meta">
                    <b>{actor.name || actor.id}{actor.isPlayer && needsYouBadge(actor.name) ? " (you)" : ""}</b>
                    <span>{meta}</span>
                  </span>
                </button>
              );
            })}
            <button className="ip-vote" type="button" aria-pressed={mine === "skip"} onClick={() => onVote("skip")}>
              <span className="ip-dot ip-dot--skip" aria-hidden="true" />
              <span className="ip-vote-meta">
                <b>Skip</b>
                <span>{mine === "skip" ? "your vote" : "No one is ejected"}</span>
              </span>
            </button>
          </div>

          <p className="ip-note">
            Dead crew cannot vote and cannot be voted for. The tally is decided when the timer runs out.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- *
 * Ejection
 * ---------------------------------------------------------------- */

export function Ejection({ ejection, onContinue, remaining }: EjectionProps): ReactElement {
  const skipped = ejection.actorId === null;
  const impostor = ejection.role === "impostor";
  const verdict = skipped ? "skipped" : impostor ? "impostor" : "crew";

  return (
    <section className="ip ip-eject" data-verdict={verdict} aria-label="Ejection result">
      <div className="ip-eject-card" data-verdict={verdict}>
        <p className="ip-eyebrow">{skipped ? "Vote skipped" : "Ejected"}</p>

        {!skipped && (
          <span className="ip-eject-actor">
            <span className="ip-eject-ring" style={swatch(ejection.color)} aria-hidden="true" />
            <b>{ejection.name || ejection.actorId}</b>
          </span>
        )}

        <h2>
          {skipped
            ? "No one was ejected"
            : impostor
              ? `${ejection.name} was The Impostor`
              : `${ejection.name} was not the Impostor`}
        </h2>

        <p className="ip-note">
          {skipped
            ? "The vote was skipped, so nobody left the station."
            : impostor
              ? `${ejection.name} was an impostor. The rest of the crew is not out of danger yet.`
              : `${ejection.name} was crew. The impostors are still hiding in plain sight.`}
        </p>

        <div className="ip-eject-meta">
          <span className={ejection.impostorCount > 0 ? "ip-chip ip-chip--danger" : "ip-chip ip-chip--info"}>
            {ejection.impostorCount} impostor{ejection.impostorCount === 1 ? "" : "s"} still aboard
          </span>
          <span className="ip-chip">Next phase in {seconds(remaining)}s</span>
        </div>

        <button className="ip-btn ip-btn--primary ip-start" type="button" onClick={onContinue}>Continue</button>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- *
 * Debrief (cache opening)
 * ---------------------------------------------------------------- */

export function Debrief({
  summary, state, caches, onOpenCache, inventory, onRedeem, busy, error, message,
  finishNote, onPlayAgain, onLobby, simulated,
}: DebriefProps): ReactElement {
  const [kept, setKept] = useState<readonly string[]>([]);
  const role = summary.playerRole === "impostor" ? "the impostor" : "crew";
  const outcome = summary.outcome === "crew-win" ? "Crew win" : summary.outcome === "impostor-win" ? "Impostor win" : "Timeout";
  const held = inventory.reduce((total, row) => total + row.reward * row.count, 0n);
  const opened = caches.filter(cache => cache.outcomeId !== null).length;
  const keep = (id: string) => setKept(previous => (previous.includes(id) ? previous : [...previous, id]));

  return (
    <section className="ip ip-debrief" data-win={summary.playerWon} aria-label="Match debrief">
      <header className="ip-debrief-head">
        <div className="ip-outcome">
          <p className="ip-eyebrow">
            {outcome} · you played {role} · {summary.playerAlive ? "you survived" : "you did not survive"} · seed {state.config.seed}
          </p>
          <h1>{summary.playerWon ? "Victory" : "Defeat"}</h1>
          <p className="ip-sub">
            {summary.tasksDone}/{summary.tasksTotal} tasks · {summary.correctVotes} correct / {summary.wrongVotes} wrong
            votes · {summary.reported} report{summary.reported === 1 ? "" : "s"} · {summary.kills} kill{summary.kills === 1 ? "" : "s"}
          </p>
        </div>
        <div className="ip-debrief-meta">
          <div className="ip-stars" role="img" aria-label={`Rank ${summary.rank}: ${summary.stars} of 3 stars`}>
            {[0, 1, 2].map(index => (
              <span key={index} data-off={index >= summary.stars || undefined}>★</span>
            ))}
          </div>
          <span className="ip-chip">Rank {summary.rank}</span>
          <div className="ip-salvage">
            <span className="ip-eyebrow">Salvage Points earned</span>
            <b>{summary.salvagePoints}</b>
          </div>
        </div>
      </header>

      <div className="ip-debrief-body">
        <section className="ip-card" aria-labelledby="ip-debrief-caches">
          <h2 className="ip-h" id="ip-debrief-caches">
            Reward caches{caches.length > 0 ? ` · ${opened}/${caches.length} opened` : ""}
          </h2>
          {caches.length === 0 ? (
            <p className="ip-note">This tier rolled no cache. Practice rounds never open one.</p>
          ) : (
            <div className="ip-caches">
              {caches.map(cache => {
                const id = cache.playId.toString();
                return (
                  <CacheCard key={id} cache={cache} busy={busy} open={cache.outcomeId !== null}
                    kept={kept.includes(id)} onKeep={() => keep(id)}
                    onOpen={() => onOpenCache(cache.playId)} onRedeem={onRedeem} />
                );
              })}
            </div>
          )}
          <p className="ip-note">
            <b>Keep</b> holds a revealed outcome in your inventory; <b>Redeem</b> sells it back for its exact RF value.
            Neither is a promised payout — a cache pays whatever its settled roll paid.
          </p>
        </section>

        <section className="ip-card" aria-labelledby="ip-debrief-held">
          <h2 className="ip-h" id="ip-debrief-held">Held salvage</h2>
          {inventory.length === 0
            ? <p className="ip-note">Nothing held. Kept outcomes land here.</p>
            : <InventoryList inventory={inventory} busy={busy} onRedeem={onRedeem} />}
          <p className="ip-note">Held value: <b>{rf(held)}</b> · held salvage keeps its exact RF value with no expiry.</p>
        </section>

        <section className="ip-card ip-card--wide" aria-labelledby="ip-debrief-odds">
          <h2 className="ip-h" id="ip-debrief-odds">The exact cache economy</h2>
          <OddsTable />
          <p className="ip-note">
            One pass = one roll. Expected return <b>{rf(CACHE_EXPECTED)}</b> per pass, <b>{CACHE_EDGE_PERCENT}%</b>{" "}
            house edge, maximum prize <b>{rf(CACHE_MAX_REWARD)}</b>. The SDK action client draws the outcome; this is
            the published weight table the roll comes from.
          </p>
        </section>
      </div>

      <footer className="ip-debrief-foot">
        <div className="ip-foot-actions">
          <span className={simulated ? "ip-sim" : "ip-chip"}>{simulated ? "Simulated economy" : "Chain mode"}</span>
          <p className="ip-feedback" role={error ? "alert" : "status"} data-tone={error ? "error" : message ? "message" : "note"}>
            {error || message || finishNote}
          </p>
        </div>
        <div className="ip-foot-actions">
          <span className="ip-chip">{summary.salvagePoints} SP · session only, not redeemable for RF</span>
          <button className="ip-btn" type="button" disabled={busy} onClick={onLobby}>Airlock</button>
          <button className="ip-btn ip-btn--primary" type="button" disabled={busy} onClick={onPlayAgain}>Play again</button>
        </div>
      </footer>
    </section>
  );
}

/* ---------------------------------------------------------------- *
 * Locker
 * ---------------------------------------------------------------- */

export function Locker({
  inventory, salvage, rank, bestStars, cosmetics, onBuyCosmetic, pending, onOpenCache,
  onRedeem, onClose, simulated, busy, error, message,
}: LockerProps): ReactElement {
  const [kept, setKept] = useState<readonly string[]>([]);
  const held = inventory.reduce((total, row) => total + row.reward * row.count, 0n);
  const keep = (id: string) => setKept(previous => (previous.includes(id) ? previous : [...previous, id]));

  return (
    <div className="ip ip-modal">
      <GameMenu title="Locker" onClose={onClose}>
        <div className="ip-panel">
          <div className="ip-panel-body">
            <div className="ip-kv">
              <span><em>Rank</em><b>{rank || "Unranked"}</b></span>
              <span><em>Best</em><b>{bestStars}/3 stars</b></span>
              <span><em>Salvage Points</em><b>{salvage}</b></span>
              <span><em>Held value</em><b>{rf(held)}</b></span>
            </div>

            <p className="ip-note">
              Salvage Points are a session-only cosmetics currency earned by playing. They buy cosmetics here and are{" "}
              <b>not</b> redeemable for RF. Ranks, points and unlocks reset when the page reloads — the SDK has no save API.
            </p>

            <section className="ip-section" aria-labelledby="ip-locker-caches">
              <h2 className="ip-h" id="ip-locker-caches">Unopened caches</h2>
              {pending.length === 0
                ? <p className="ip-note">No cache is waiting. A pass bought for a tournament shows up here until it is opened.</p>
                : (
                  <div className="ip-caches">
                    {pending.map(cache => {
                      const id = cache.playId.toString();
                      return (
                        <CacheCard key={id} cache={cache} busy={busy} open={cache.outcomeId !== null}
                          kept={kept.includes(id)} onKeep={() => keep(id)}
                          onOpen={() => onOpenCache(cache.playId)} onRedeem={onRedeem} />
                      );
                    })}
                  </div>
                )}
            </section>

            <section className="ip-section" aria-labelledby="ip-locker-held">
              <h2 className="ip-h" id="ip-locker-held">Held salvage</h2>
              {inventory.length === 0
                ? <p className="ip-note">Nothing held yet.</p>
                : <InventoryList inventory={inventory} busy={busy} onRedeem={onRedeem} />}
              <p className="ip-note">Redeem sells held salvage back for its exact RF value. Nothing expires.</p>
            </section>

            <section className="ip-section" aria-labelledby="ip-locker-cosmetics">
              <h2 className="ip-h" id="ip-locker-cosmetics">Cosmetics · {salvage} SP</h2>
              {cosmetics.length === 0 ? <p className="ip-note">No cosmetics are on offer.</p> : (
                <div className="ip-cosm">
                  {cosmetics.map(cosmetic => (
                    <div className="ip-cosm-row" key={cosmetic.id} data-owned={cosmetic.owned || undefined}>
                      <span className="ip-swatch" style={{ background: cosmetic.color }} aria-hidden="true" />
                      <span className="ip-inv-meta">
                        <b>{cosmetic.name}</b>
                        <span className="ip-chip">
                          {cosmetic.owned ? (cosmetic.equipped ? "Equipped" : "Owned") : `${cosmetic.cost} SP`}
                        </span>
                      </span>
                      <button className="ip-btn ip-btn--sm" type="button"
                        disabled={busy || cosmetic.owned || salvage < cosmetic.cost}
                        onClick={() => onBuyCosmetic(cosmetic.id)}>
                        {cosmetic.owned ? "Owned" : `Buy · ${cosmetic.cost} SP`}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <div className="ip-panel-foot">
            <p className="ip-feedback" role={error ? "alert" : "status"} data-tone={error ? "error" : message ? "message" : "note"}>
              {error || message || (simulated ? "Simulated inventory: nothing here touches a wallet." : "Chain mode: the SDK runtime settles every redemption.")}
            </p>
            <button className="ip-btn" type="button" disabled={busy} onClick={onClose}>Close</button>
          </div>
        </div>
      </GameMenu>
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Settings
 * ---------------------------------------------------------------- */

export function Settings({ muted, onMute, reducedMotion, onReducedMotion, onClose, mode }: SettingsProps): ReactElement {
  return (
    <div className="ip ip-modal">
      <GameMenu title="Settings" onClose={onClose}>
        <div className="ip-panel">
          <div className="ip-panel-body">
            <label className="ip-toggle">
              <input type="checkbox" checked={muted} onChange={event => onMute(event.target.checked)} />
              <span className="ip-toggle-text">
                <b>Mute sound effects</b>
                <span>{muted ? "Every cue is muted." : "Cues play inside this frame only."}</span>
              </span>
            </label>

            <label className="ip-toggle">
              <input type="checkbox" checked={reducedMotion} onChange={event => onReducedMotion(event.target.checked)} />
              <span className="ip-toggle-text">
                <b>Reduce motion</b>
                <span>Shortens HUD, meeting and reveal animation.</span>
              </span>
            </label>

            <p className="ip-note">
              Economy mode: <b>{mode === "preview" ? "Preview (simulated)" : "Chain"}</b>.
            </p>

            <p className="ip-note">
              {mode === "preview"
                ? "In preview, every balance, pass purchase, cache roll and redemption in this frame is simulated and resets when the page reloads. No transaction is created and no payout is promised."
                : "In chain mode the SDK runtime settles pass purchases and redemptions against this Friend's RF wallet; the game frame only calls it and reports what came back."}{" "}
              Playing requires a Generations Friend this wallet owns. The runtime owns wallet connection, the ownership
              gate and every purchase — this frame never renders a wallet, an NFT picker or a transaction prompt.
            </p>

            <p className="ip-note">
              In-match randomness (roles, sabotage schedule, task sequences, bot chat) is gameplay RNG seeded by the
              room code. It never decides an RF outcome.
            </p>
          </div>

          <div className="ip-panel-foot">
            <span className="ip-note">Ranks, Salvage Points and cosmetics are session-scoped.</span>
            <button className="ip-btn ip-btn--primary" type="button" onClick={onClose}>Done</button>
          </div>
        </div>
      </GameMenu>
    </div>
  );
}
