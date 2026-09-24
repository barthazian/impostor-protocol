/**
 * Arcade check: reach EACH of the six task consoles in its own practice round,
 * open it, prove the cabinet renders (a real, non-empty arena) and that it
 * RESPONDS to real input, then attempt a full completion with scripted keys and
 * pointer events. One screenshot per console is written under ./artifacts
 * whatever the outcome, and one line is printed per console with
 * reached / open / rendered / responds / completed / elapsed and the reason.
 *
 *   node games/impostor-protocol/tests/minigame-check.mjs
 *
 * Everything a driver reads is the game's own published state — the `data-*`
 * attributes a screen reader gets for the same widget:
 *
 *   BREAKOUT   canvas.ip-arc-canvas   data-phase data-ball data-dir data-paddle data-left data-lives
 *   SNAKE      canvas.ip-arc-canvas   data-phase data-head data-body data-food data-eaten data-len
 *   MEMORY     .ip-arc-mempad         data-phase data-lit data-round data-length data-progress data-attempts
 *   SWEEP      .ip-arc-minegrid       data-phase data-cursor data-clean data-flags data-mines
 *                                     (cells: button.ip-arc-cell data-cell data-state data-count)
 *   WIRING     .ip-wire-grid          (nodes: button.ip-wire-node data-side data-picked data-linked)
 *   STACKER    canvas.ip-arc-canvas   data-phase data-board data-piece data-cells data-rot data-x data-y data-cleared
 *
 * Two rules make this sweep robust rather than heroic:
 *
 *  - `TaskSession` replaces the game with its result panel THE INSTANT the
 *    console resolves, so an arena unmounts while the overlay lives on for
 *    another 750-850 ms. Every arena read therefore carries its own short
 *    timeout and returns null on detachment, and the verdict is taken from the
 *    station's own task counter (plus `.ip-task-result[data-result]` when it is
 *    still on screen) — never polled off the arena.
 *  - No driver read may use the 60 s default timeout: a vanished arena must
 *    end the attempt, not hang it.
 */
import { mkdir } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";

await mkdir("./artifacts", { recursive: true });

/** Never let a detached arena turn a read into a hang. */
const READ_MS = 2500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ *
 *  consoles, routes and artifacts                                    *
 * ------------------------------------------------------------------ */

/**
 * Hub-to-hub lanes from station.ts, straight by construction; every list starts
 * from the cafeteria spawn and only turns on a hub centreline, so no leg asks
 * the walker to cross a door frame diagonally.
 */
const CONSOLES = [
  {
    id: "task-reactor", name: "Calibrate Reactor", game: "BREAKOUT", driver: "breakout",
    cabinet: "COOLANT BREAKOUT", arena: "canvas.ip-arc-canvas",
    artifact: "./artifacts/60-minigame-breakout.png",
    route: [{ x: 760, y: 255 }, { x: 380, y: 255 }, { x: 230, y: 130 }],
  },
  {
    id: "task-navigation", name: "Align Navigation Dials", game: "SNAKE", driver: "snake",
    cabinet: "NAV VECTOR SNAKE", arena: "canvas.ip-arc-canvas",
    artifact: "./artifacts/61-minigame-snake.png",
    route: [{ x: 1640, y: 255 }, { x: 2020, y: 255 }, { x: 2170, y: 130 }],
  },
  {
    id: "task-comms", name: "Reboot Comms Array", game: "MEMORY", driver: "memory",
    cabinet: "SIGNAL MEMORY", arena: ".ip-arc-mempad",
    artifact: "./artifacts/62-minigame-memory.png",
    route: [{ x: 1200, y: 750 }, { x: 1640, y: 750 }, { x: 2020, y: 750 }, { x: 2170, y: 860 }],
  },
  {
    id: "task-medbay", name: "Analyse Blood Sample", game: "MINESWEEPER", driver: "minesweeper",
    cabinet: "CONTAMINANT SWEEP", arena: ".ip-arc-minegrid",
    artifact: "./artifacts/63-minigame-minesweeper.png",
    route: [{ x: 1200, y: 750 }, { x: 760, y: 750 }, { x: 380, y: 750 }, { x: 230, y: 860 }],
  },
  {
    id: "task-electrical", name: "Repair Wiring", game: "WIRING", driver: "wiring",
    cabinet: "PATCH PANEL", arena: ".ip-wire-grid",
    artifact: "./artifacts/64-minigame-wiring.png",
    route: [{ x: 1200, y: 750 }, { x: 380, y: 750 }, { x: 380, y: 1245 }, { x: 230, y: 1370 }],
  },
  {
    id: "task-o2", name: "Unlock O2 Filters", game: "STACKER", driver: "stacker",
    cabinet: "FILTER STACKER", arena: "canvas.ip-arc-canvas",
    artifact: "./artifacts/65-minigame-tetris.png",
    route: [{ x: 1200, y: 750 }, { x: 1200, y: 1245 }, { x: 1640, y: 1245 }, { x: 2020, y: 1245 }, { x: 2170, y: 1370 }],
  },
];

const STATE_KEYS = {
  breakout: ["phase", "ball", "dir", "paddle", "left", "lives"],
  snake: ["phase", "head", "body", "food", "eaten", "len"],
  memory: ["phase", "lit", "round", "length", "progress", "attempts"],
  minesweeper: ["phase", "cursor", "clean", "flags", "mines"],
  wiring: ["phase"],
  stacker: ["phase", "board", "cells", "x", "y", "cleared"],
};

/* ------------------------------------------------------------------ *
 *  shared browser helpers                                            *
 * ------------------------------------------------------------------ */

async function startPractice(page, game) {
  await game.locator("section.ip-root").first().waitFor({ timeout: 30_000 });
  const crew = game.getByRole("radio", { name: /crewmate/i });
  if (await crew.count()) await crew.first().check();
  await game.getByRole("button", { name: /start/i }).first().click();
  await page.waitForTimeout(1200);
  const begin = game.getByRole("button", { name: /begin/i }).first();
  if (await begin.count()) await begin.click();
  await page.waitForTimeout(1600);
  await game.locator("canvas.ip-canvas").first().click({ position: { x: 480, y: 300 } });
  await page.waitForTimeout(250);
}

function stationReader(canvas) {
  return () => canvas.evaluate((node) => ({
    x: Number(node.dataset.x),
    y: Number(node.dataset.y),
    phase: node.dataset.phase ?? "",
    tasks: node.dataset.tasks ?? "",
  }), undefined, { timeout: READ_MS });
}

const taskCount = (station) => Number((station.tasks.split("/")[0] ?? "0"));

async function steer(page, read, target, tolerance, maxSteps = 34) {
  for (let step = 0; step < maxSteps; step++) {
    const now = await read();
    const distance = Math.hypot(target.x - now.x, target.y - now.y);
    if (distance <= tolerance) return true;
    const keys = [];
    if (Math.abs(target.x - now.x) > 14) keys.push(target.x > now.x ? "d" : "a");
    if (Math.abs(target.y - now.y) > 14) keys.push(target.y > now.y ? "s" : "w");
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(Math.min(900, Math.max(180, (distance / 155) * 1000)));
    for (const key of keys) await page.keyboard.up(key);
    await page.waitForTimeout(120);
  }
  return false;
}

async function walk(page, read, route) {
  for (const [index, waypoint] of route.entries()) {
    await steer(page, read, waypoint, index === route.length - 1 ? 40 : 60);
  }
}

async function promptText(game) {
  const node = game.locator("button.ip-prompt");
  if (!(await node.count())) return "";
  return (await node.first().innerText()).replace(/\s+/g, " ").trim();
}

async function openConsole(page, game, name) {
  const wanted = name.split(" ")[0].toLowerCase();
  let label = await promptText(game);
  for (let attempt = 0; attempt < 14 && !label.toLowerCase().includes(wanted); attempt++) {
    await page.waitForTimeout(300);
    label = await promptText(game);
  }
  if (!label.toLowerCase().includes(wanted)) {
    throw new Error(`no "${name}" prompt in reach (prompt=${JSON.stringify(label)})`);
  }
  await game.locator("button.ip-prompt").first().click();
  // Settle only until the console is really mounted: the signal-memory console
  // starts playing its sequence the moment it opens, so a long fixed wait would
  // make the driver join the first watch late.
  await game.locator(".ip-task").first().waitFor({ timeout: 6000 });
  await page.waitForTimeout(140);
  return label;
}

const overlayOpen = async (game) => (await game.locator(".ip-task").count()) > 0;

/** Reads one arena's published state, or null when the arena has unmounted. */
function arenaReader(game, selector, keys) {
  const node = game.locator(selector).first();
  return async () => {
    try {
      return await node.evaluate((element, wanted) => {
        const out = {};
        for (const key of wanted) out[key] = element.dataset[key] ?? "";
        return out;
      }, keys, { timeout: READ_MS });
    } catch {
      return null;
    }
  };
}

/** A non-zero CSS box proves the arena is really laid out, not a 0x0 ghost. */
async function arenaBox(game, selector) {
  try {
    return await game.locator(selector).first().evaluate((node) => {
      const box = node.getBoundingClientRect();
      return { w: Math.round(box.width), h: Math.round(box.height) };
    }, undefined, { timeout: READ_MS });
  } catch {
    return null;
  }
}

/**
 * Waits out the console: the result panel (which only lives ~800 ms) and then
 * the station's own task counter, which is the durable record of the credit.
 */
async function settleConsole(game, readStation, before) {
  const panelOf = async () => {
    try {
      if (!(await game.locator(".ip-task-result").count())) return "";
      return (await game.locator(".ip-task-result").first().getAttribute("data-result", { timeout: READ_MS })) ?? "";
    } catch {
      return "";
    }
  };
  let panel = "";
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    panel = panel || (await panelOf());
    if (!(await overlayOpen(game))) break;
    await sleep(120);
  }
  const closed = !(await overlayOpen(game));
  const station = await readStation();
  return { panel, closed, after: taskCount(station), credited: taskCount(station) > before };
}

/* ------------------------------------------------------------------ *
 *  per-game drivers                                                  *
 * ------------------------------------------------------------------ */

const BO_COLS = 12;
const BO_ROWS = 14;
const BO_PADDLE_ROW = BO_ROWS - 1;

async function playBreakout({ page, shot, read }) {
  // Mirror of the cabinet's own pulse physics, used only to aim the paddle.
  // BO_PADDLE_ROW is where the pulse meets the paddle.
  const predict = (column, row, dc, dr) => {
    for (let step = 0; step < 200; step++) {
      let nc = column + dc;
      let nr = row + dr;
      if (nc < 0) { nc = 0; dc = 1; } else if (nc > BO_COLS - 1) { nc = BO_COLS - 1; dc = -1; }
      if (nr < 0) { nr = 0; dr = 1; }
      if (nr === BO_PADDLE_ROW) return nc;
      column = nc;
      row = nr;
    }
    return column;
  };

  let held = null;
  const hold = async (key) => {
    if (key === held) return;
    if (held) await page.keyboard.up(held);
    held = key;
    if (key) await page.keyboard.down(key);
  };

  // Input response: a held arrow key must move the published paddle.
  const start0 = await read();
  if (start0 === null) return { responds: false, note: "the arena vanished before the first read" };
  await hold("ArrowLeft");
  await sleep(180);
  await hold(null);
  let moved = await read();
  if (moved !== null && moved.paddle === start0.paddle) {
    await hold("ArrowRight");
    await sleep(180);
    await hold(null);
    moved = await read();
  }
  const responds = moved !== null && moved.paddle !== start0.paddle;
  await shot();

  const deadline = Date.now() + 24_000;
  let last = start0;
  while (Date.now() < deadline) {
    const state = await read();
    if (state === null) break;
    last = state;
    if (state.phase === "won") { await hold(null); return { responds, note: `won with ${state.left} cells left` }; }
    if (state.phase === "lost") { await hold(null); return { responds, note: "both coolant pulses lost" }; }
    if (state.phase === "ready") {
      await hold(null);
      await page.keyboard.press("Space");
      await sleep(40);
      continue;
    }
    const [column, row] = state.ball.split(",").map(Number);
    const [dc, dr] = state.dir.split(",").map(Number);
    const target = dr > 0 && row >= 5 ? predict(column, row, dc, dr) : column;
    const want = Math.max(0, Math.min(BO_COLS - 4, target - 1));
    const diff = want - state.paddle;
    await hold(diff > 0 ? "ArrowRight" : diff < 0 ? "ArrowLeft" : null);
    await sleep(16);
  }
  await hold(null);
  return { responds, note: `arena gone with ${last.left} cells still standing` };
}

const SN_FIELD = 14;

async function playSnake({ page, shot, read }) {
  const firstStep = (body, goal) => {
    const blocked = new Set(body.slice(0, body.length - 1).map(([x, y]) => y * SN_FIELD + x));
    const start = body[0][1] * SN_FIELD + body[0][0];
    const goalIndex = goal[1] * SN_FIELD + goal[0];
    const previous = new Map([[start, -1]]);
    const queue = [start];
    while (queue.length) {
      const current = queue.shift();
      if (current === goalIndex) break;
      const cx = current % SN_FIELD;
      const cy = Math.floor(current / SN_FIELD);
      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
        if (nx < 0 || ny < 0 || nx >= SN_FIELD || ny >= SN_FIELD) continue;
        const next = ny * SN_FIELD + nx;
        if (previous.has(next) || blocked.has(next)) continue;
        previous.set(next, current);
        queue.push(next);
      }
    }
    if (!previous.has(goalIndex) || start === goalIndex) {
      const [hx, hy] = body[0];
      for (const [nx, ny] of [[hx + 1, hy], [hx - 1, hy], [hx, hy + 1], [hx, hy - 1]]) {
        if (nx < 0 || ny < 0 || nx >= SN_FIELD || ny >= SN_FIELD) continue;
        if (blocked.has(ny * SN_FIELD + nx)) continue;
        return [nx - hx, ny - hy];
      }
      return [0, 0];
    }
    let current = goalIndex;
    while (previous.get(current) !== start) {
      current = previous.get(current);
      if (current === undefined) return [0, 0];
    }
    return [(current % SN_FIELD) - body[0][0], Math.floor(current / SN_FIELD) - body[0][1]];
  };

  const KEYS = (dx, dy) => (dx > 0 ? "ArrowRight" : dx < 0 ? "ArrowLeft" : dy > 0 ? "ArrowDown" : "ArrowUp");

  const start0 = await read();
  if (start0 === null) return { responds: false, note: "the arena vanished before the first read" };
  await page.keyboard.press("ArrowUp");
  await sleep(260);
  const after = await read();
  const responds = after !== null && after.head !== start0.head;
  await shot();

  const deadline = Date.now() + 24_000;
  let last = start0;
  while (Date.now() < deadline) {
    const state = await read();
    if (state === null) break;
    last = state;
    if (state.phase === "won") return { responds, note: `ate all ${state.eaten} waypoints` };
    if (state.phase === "lost") return { responds, note: `crashed after ${state.eaten} waypoints` };
    if (!state.food) return { responds, note: `course read finished after ${state.eaten} waypoints` };
    const body = state.body.split(";").map((pair) => pair.split(",").map(Number));
    const goal = state.food.split(",").map(Number);
    const [dx, dy] = firstStep(body, goal);
    if (dx === 0 && dy === 0) return { responds, note: "no legal step out of the corner" };
    await page.keyboard.press(KEYS(dx, dy));
    await sleep(25);
  }
  return { responds, note: `time budget spent after ${last.eaten} waypoints` };
}

async function playMemory({ page, shot, read }) {
  const deadline = Date.now() + 24_000;
  let observed = [];
  let lastSeen = "";
  let currentRound = -1;
  let lastAttempts = Number.POSITIVE_INFINITY;
  let pressed = false;
  let responds = false;
  let shortObservations = 0;
  let last = { round: 1, length: 3 };

  while (Date.now() < deadline) {
    const state = await read();
    if (state === null) {
      return { responds, note: `the console resolved during round ${last.round} (${shortObservations} short observation(s))` };
    }
    const round = Number(state.round);
    const length = Number(state.length);
    const attempts = Number(state.attempts);
    last = { round, length };
    if (state.phase === "won") return { responds, note: `round ${round} repeated clean` };
    if (state.phase === "lost") return { responds, note: "sequence mismatch on the last attempt" };
    // A rejected repeat replays the SAME round from the top and a new round
    // replays a longer prefix: both mean the observation starts over.
    if (attempts < lastAttempts || round !== currentRound) {
      observed = [];
      lastSeen = "";
      currentRound = round;
      lastAttempts = attempts;
      pressed = false;
    }
    if (state.phase === "watch") {
      pressed = false;
      if (state.lit !== "" && state.lit !== lastSeen) observed.push(Number(state.lit));
      lastSeen = state.lit;
    } else if (state.phase === "input" && !pressed) {
      pressed = true;
      if (!responds) await shot();
      // A driver that joins the first watch late sees only a suffix of the
      // sequence. Answering with what it saw is a real attempt: the console
      // rejects it, replays the SAME round, and that replay is observed from
      // its first pad, so the round is recovered at the cost of one attempt
      // rather than being given up on.
      const answer = observed.slice(0, length);
      if (answer.length < length) shortObservations += 1;
      for (const pad of answer) {
        await page.keyboard.press(String(pad + 1));
        await sleep(110);
        if (!responds) {
          const now = await read();
          responds = now !== null && Number(now.progress) > 0;
          if (!responds) return { responds: false, note: "the pads did not register a key press" };
        }
      }
    }
    await sleep(35);
  }
  return { responds, note: `time budget spent in round ${last.round}` };
}

const MS_COLS = 6;
const MS_ROWS = 6;
const MS_MINES = 5;
const MS_RING = Array.from({ length: MS_COLS * MS_ROWS }, (_, index) => {
  const row = Math.floor(index / MS_COLS);
  const column = index % MS_COLS;
  const out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const y = row + dy;
      const x = column + dx;
      if (y < 0 || x < 0 || y >= MS_ROWS || x >= MS_COLS) continue;
      out.push(y * MS_COLS + x);
    }
  }
  return out;
});

/**
 * The same deduction rules the console generates its boards with: a ring that
 * already carries its whole count leaves the rest of the ring clean, and a ring
 * whose hidden cells plus flags account for exactly its count marks them all as
 * contaminated. Flagging is what unlocks the second rule, so a driver that never
 * flags can only ever walk zero-count regions and stalls.
 */
function msDeduce(cells) {
  const open = new Map();
  const flags = new Set();
  for (const cell of cells) {
    if (cell.state === "open") open.set(cell.index, cell.count ?? 0);
    if (cell.state === "flag") flags.add(cell.index);
  }
  const safe = new Set();
  const mines = new Set();
  for (const [index, count] of open) {
    const hidden = MS_RING[index].filter((cell) => !open.has(cell) && !flags.has(cell));
    if (hidden.length === 0) continue;
    const marked = MS_RING[index].filter((cell) => flags.has(cell)).length;
    if (marked >= count) for (const cell of hidden) safe.add(cell);
    else if (hidden.length + marked === count) for (const cell of hidden) mines.add(cell);
  }
  return { safe, mines };
}

async function playMinesweeper({ game, page, shot, read }) {
  const readCells = async () => {
    try {
      return await game.locator(".ip-arc-cell").evaluateAll((nodes) => nodes.map((node) => ({
        index: Number(node.dataset.cell),
        state: node.dataset.state,
        count: node.dataset.count === undefined ? null : Number(node.dataset.count),
      })), undefined, { timeout: READ_MS });
    } catch {
      return null;
    }
  };

  const start0 = await read();
  if (start0 === null) return { responds: false, note: "the arena vanished before the first read" };
  await page.keyboard.press("ArrowRight");
  await sleep(160);
  const after = await read();
  const responds = after !== null && after.cursor !== start0.cursor;
  await shot();

  const deadline = Date.now() + 20_000;
  let opened = 0;
  let flagsPlaced = 0;
  const cellButton = (index) => game.locator(`button.ip-arc-cell[data-cell="${index}"]`);
  for (let step = 0; step < 90 && Date.now() < deadline; step++) {
    const cells = await readCells();
    if (cells === null) return { responds, note: `the console resolved with ${opened} clean cells open` };
    if (cells.some((cell) => cell.state === "boom")) return { responds, note: "revealed a contaminated cell" };
    opened = cells.filter((cell) => cell.state === "open").length;
    const flagged = cells.filter((cell) => cell.state === "flag").length;
    const hidden = cells.filter((cell) => cell.state === "hidden").length;
    if (hidden === 0) return { responds, note: `all ${opened} clean cells open (${flagged} flagged)` };
    const { safe, mines } = msDeduce(cells);

    // Flag every deduced contaminant first: the flag is what lets the next ring
    // rule fire, so the sweep can only progress by marking as well as opening.
    let acted = false;
    for (const index of mines) {
      if (cells[index].state !== "hidden") continue;
      if (flagged + flagsPlaced >= MS_MINES) break;
      await cellButton(index).click({ button: "right" });
      flagsPlaced += 1;
      acted = true;
      await sleep(60);
    }
    if (acted) continue;

    const target = [...safe].find((index) => cells[index].state === "hidden");
    if (target === undefined) {
      return { responds, note: `deduction stalled with ${hidden} hidden cells (${flagged} flagged, ${opened} clean open)` };
    }
    // Open it with a real pointer click; the console publishes data-clean.
    await cellButton(target).click();
    await sleep(80);
  }
  return { responds, note: `time budget spent with ${opened} clean cells open` };
}

async function playWiring({ game, page, shot }) {
  const colour = (label) => (label ?? "").replace(/^(Left|Right) node \d+, /, "").replace(/ wire.*$/, "").trim();
  const lefts = await game.locator('button.ip-wire-node[data-side="left"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
  const rights = await game.locator('button.ip-wire-node[data-side="right"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
  if (lefts.length !== 4 || rights.length !== 4) {
    return { responds: false, note: `expected four pairs, saw ${lefts.length}/${rights.length}` };
  }

  // Input response: arming a left node publishes data-picked on that node.
  await game.locator('button.ip-wire-node[data-side="left"]').first().click();
  await page.waitForTimeout(160);
  const responds = (await game.locator('button.ip-wire-node[data-side="left"][data-picked="true"]').count()) > 0;
  // Disarm again before pairing: a second click on the same node toggles it off,
  // and leaving node 0 armed makes the pairing loop's first click CANCEL the
  // selection instead of picking it, which costs the whole first pair.
  await game.locator('button.ip-wire-node[data-side="left"]').first().click();
  await page.waitForTimeout(160);
  await shot();

  const remaining = rights.map((label, index) => ({ label, index }));
  for (let index = 0; index < lefts.length; index++) {
    const wanted = colour(lefts[index]);
    const match = remaining.find((entry) => colour(entry.label) === wanted);
    if (!match) return { responds, note: `no right node for ${wanted}` };
    remaining.splice(remaining.indexOf(match), 1);
    await game.locator('button.ip-wire-node[data-side="left"]').nth(index).click();
    await page.waitForTimeout(110);
    await game.locator('button.ip-wire-node[data-side="right"]').nth(match.index).click();
    await page.waitForTimeout(110);
  }
  await page.waitForTimeout(500);
  let linked = 0;
  try {
    linked = await game.locator('button.ip-wire-node[data-linked="true"]').count();
  } catch {
    linked = 0;
  }
  return { responds, note: `${linked}/8 nodes linked by colour` };
}

const TT_COLS = 8;
const TT_ROWS = 12;

async function playStacker({ page, shot, read }) {
  const rotateLocal = (cells, turns) => {
    let out = cells.map((cell) => [cell[0], cell[1]]);
    for (let turn = 0; turn < turns; turn++) out = out.map((cell) => [3 - cell[1], cell[0]]);
    return out;
  };
  const fits = (board, cells, y) => cells.every(([x, cy]) => {
    const ny = cy + y;
    return x >= 0 && x < TT_COLS && ny < TT_ROWS && (ny < 0 || board[ny][x] === ".");
  });
  const simulate = (board, cells, startY) => {
    if (!fits(board, cells, startY)) return Number.NEGATIVE_INFINITY;
    let y = startY;
    while (fits(board, cells, y + 1)) y += 1;
    const filled = board.map((row) => row.split(""));
    for (const [x, cy] of cells) filled[cy + y][x] = "#";
    const kept = filled.filter((row) => row.some((cell) => cell === "."));
    const cleared = TT_ROWS - kept.length;
    while (kept.length < TT_ROWS) kept.unshift(Array.from({ length: TT_COLS }, () => "."));

    const heights = [];
    let holes = 0;
    for (let column = 0; column < TT_COLS; column++) {
      let top = -1;
      for (let row = 0; row < TT_ROWS; row++) if (kept[row][column] === "#") { top = row; break; }
      if (top < 0) { heights.push(0); continue; }
      heights.push(TT_ROWS - top);
      for (let row = top + 1; row < TT_ROWS; row++) if (kept[row][column] === ".") holes += 1;
    }
    let bumpiness = 0;
    for (let index = 0; index + 1 < TT_COLS; index++) bumpiness += Math.abs(heights[index] - heights[index + 1]);
    const aggregate = heights.reduce((sum, value) => sum + value, 0);
    const maxHeight = Math.max(...heights);
    const rowFill = (row) => kept[row].filter((cell) => cell === "#").length;
    // A clear dominates; then no holes; then complete the lowest rows; then
    // stay low and flat. Weighting holes weakly builds a tidy, unclearable stack.
    return cleared * 1_000_000 + rowFill(TT_ROWS - 1) * 120 + rowFill(TT_ROWS - 2) * 40
      - holes * 400 - maxHeight * 8 - aggregate * 2 - bumpiness * 6;
  };

  const start0 = await read();
  if (start0 === null) return { responds: false, note: "the arena vanished before the first read" };
  await page.keyboard.press("ArrowUp");
  await sleep(160);
  let after = await read();
  if (after !== null && after.cells === start0.cells) {
    // Some pieces are rotation-invariant: a sideways nudge proves input too.
    await page.keyboard.press("ArrowRight");
    await sleep(160);
    after = await read();
  }
  const responds = after !== null && after.cells !== start0.cells;
  await shot();

  const deadline = Date.now() + 22_000;
  let pieces = 0;
  let last = start0;
  while (Date.now() < deadline) {
    const state = await read();
    if (state === null) break;
    last = state;
    if (state.phase === "won") break;
    if (state.phase === "lost") return { responds, note: `the stack topped out after ${pieces} blocks` };

    const cells = state.cells.split(";").map((pair) => pair.split(",").map(Number));
    const local = cells.map(([x, y]) => [x - Number(state.x), y - Number(state.y)]);
    const board = state.board.split("/");
    const boxY = Number(state.y);

    let best = null;
    for (let turns = 0; turns < 4; turns++) {
      const shape = rotateLocal(local, turns);
      const minX = Math.min(...shape.map((cell) => cell[0]));
      const maxX = Math.max(...shape.map((cell) => cell[0]));
      for (let column = minX >= 0 ? 0 : -minX; column + maxX < TT_COLS; column++) {
        const placed = shape.map((cell) => [cell[0] + column, cell[1]]);
        const score = simulate(board, placed, boxY);
        if (score === Number.NEGATIVE_INFINITY) continue;
        if (best === null || score > best.score) best = { score, turns, column };
      }
    }
    if (best === null) return { responds, note: `no legal placement after ${pieces} blocks` };

    for (let turn = 0; turn < best.turns; turn++) {
      await page.keyboard.press("ArrowUp");
      await sleep(28);
    }
    // `best.column` is the piece's 4x4 BOX column, which is exactly data-x —
    // aiming on the leftmost occupied cell instead puts the block minX off.
    for (let guard = 0; guard < 12; guard++) {
      const now = await read();
      if (now === null) break;
      const delta = best.column - Number(now.x);
      if (delta === 0) break;
      await page.keyboard.press(delta > 0 ? "ArrowRight" : "ArrowLeft");
      await sleep(28);
    }
    await page.keyboard.press("Space");
    pieces += 1;
    await sleep(45);
  }
  return { responds, note: `arena gone after ${pieces} blocks (${last.cleared} rows cleared)` };
}

const DRIVERS = { breakout: playBreakout, snake: playSnake, memory: playMemory, minesweeper: playMinesweeper, wiring: playWiring, stacker: playStacker };

/* ------------------------------------------------------------------ *
 *  run each console in its own practice round                        *
 * ------------------------------------------------------------------ */

const rows = [];

for (const entry of CONSOLES) {
  const result = {
    console: entry.name, game: entry.game,
    reached: "no", opened: "no", rendered: "no", responds: "no", completed: "no",
    elapsed: "-", note: "",
  };
  const started = Date.now();
  try {
    await testGame("./games/impostor-protocol", {
      width: 960,
      height: 800,
      timeout: 90_000,
      check: async ({ page, game }) => {
        const problems = [];
        page.on("pageerror", (error) => problems.push(`page: ${error.message}`));
        page.on("console", (message) => { if (message.type() === "error") problems.push(`console: ${message.text()}`); });

        const canvas = game.locator("canvas.ip-canvas");
        const readStation = stationReader(canvas);
        await startPractice(page, game);
        await walk(page, readStation, entry.route);
        const station = await readStation();
        if (station.phase !== "play") throw new Error(`left the play phase while walking (phase=${station.phase})`);
        result.reached = "yes";

        const label = await openConsole(page, game, entry.name);
        result.opened = "yes";

        // Cabinet identity: the marquee must be the console we walked to.
        const title = (await game.locator(".ip-arc-title").first().innerText({ timeout: READ_MS })).trim();
        if (title !== entry.cabinet) {
          throw new Error(`opened the wrong cabinet: ${JSON.stringify(title)}, wanted ${JSON.stringify(entry.cabinet)}`);
        }

        const box = await arenaBox(game, entry.arena);
        if (box === null) throw new Error(`the arena ${entry.arena} is not in the DOM`);
        if (box.w < 8 || box.h < 8) throw new Error(`the arena ${entry.arena} has an empty box ${box.w}x${box.h}`);
        result.rendered = `${box.w}x${box.h}`;

        const before = taskCount(await readStation());
        const read = arenaReader(game, entry.arena, STATE_KEYS[entry.driver]);
        const play = await DRIVERS[entry.driver]({
          page, game, read,
          shot: () => page.screenshot({ path: entry.artifact }),
        });

        result.responds = play.responds === false ? "NO" : "yes";
        if (play.responds === false) throw new Error(`the console did not respond to input — ${play.note}`);

        const settled = await settleConsole(game, readStation, before);
        if (!settled.closed) throw new Error(`the console stayed open after the attempt — ${play.note}`);
        result.completed = settled.credited ? "yes" : "no";
        result.note = `prompt ${JSON.stringify(label)} · counter ${before} -> ${settled.after}`
          + `${settled.credited ? "" : " (no credit)"} · result panel ${JSON.stringify(settled.panel)} · ${play.note}`;
        if (problems.length) result.note += ` · browser problems: ${problems.slice(0, 3).join("; ")}`;
      },
    });
  } catch (error) {
    result.note = result.note || (error instanceof Error ? error.message : String(error));
  }
  result.elapsed = `${Math.round((Date.now() - started) / 1000)}s`;
  rows.push(result);
  console.log(`  · ${result.game.padEnd(12)} ${result.console.padEnd(24)} reached=${result.reached} opened=${result.opened} rendered=${result.rendered} responds=${result.responds} completed=${result.completed} ${result.elapsed}`);
  console.log(`      ${result.note}`);
}

console.log("");
console.log("  console                  game          reached  opened  rendered  responds  completed  elapsed");
console.log("  -----------------------  ------------  -------  ------  --------  --------  ---------  -------");
for (const row of rows) {
  console.log(`  ${row.console.padEnd(23)}  ${row.game.padEnd(12)}  ${row.reached.padEnd(7)}  ${row.opened.padEnd(6)}  ${String(row.rendered).padEnd(8)}  ${row.responds.padEnd(8)}  ${row.completed.padEnd(9)}  ${row.elapsed}`);
}
const done = rows.filter((row) => row.completed === "yes").length;
const responding = rows.filter((row) => row.responds === "yes").length;
console.log("");
console.log(`minigame check: ${responding}/${rows.length} consoles responded to input, ${done}/${rows.length} played to completion`);
if (done < 3) throw new Error(`only ${done} consoles were played to completion — expected at least three`);
