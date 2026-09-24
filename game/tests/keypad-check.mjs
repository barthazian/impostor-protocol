/**
 * O2 check: drive the NEW "Unlock O2 Filters" console — the Tetris-style filter
 * stacker — to completion through the real runtime and report the task count it
 * credited.
 *
 *   node games/impostor-protocol/tests/keypad-check.mjs
 *
 * The player walks to the O2 console with real key input, opens it, then plays
 * the stacker with the keyboard only: rotate (ArrowUp), shift, hard drop
 * (Space). Placements are chosen by the same 12x8 well model the cabinet draws,
 * read from `data-board` / `data-cells` — no internal hooks.
 *
 * Three things a driver of this console has to get right, and all three are
 * load-bearing:
 *
 *  1. `data-x` is the piece's 4x4 BOX column, and the placement model's target
 *     column is in the same space. Aiming on the leftmost occupied cell instead
 *     lands the block `minX` columns off, which silently jams the well.
 *  2. The score must weight holes and stack height above everything but a row
 *     clear, or the driver happily builds a tall, tidy, unclearable stack.
 *  3. `TaskSession` swaps the game for its result panel the INSTANT the console
 *     resolves, so the arena canvas unmounts while the overlay lives on for
 *     another 750-850 ms. A read of the arena therefore returns null the moment
 *     the game is won, and the win has to be read from `.ip-task-result` and the
 *     station's own task counter instead of polled off the canvas.
 */
import { mkdir } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";

await mkdir("./artifacts", { recursive: true });

/** Cafeteria -> Storage -> Engine -> O2 lanes, straight by construction. */
const ROUTE = [[1200, 255], [1200, 510], [1200, 750], [1200, 990], [1200, 1245], [1640, 1245], [2020, 1245], [2170, 1370]];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const READ_MS = 2500;

const COLS = 8;
const ROWS = 12;

/** Mirror of the cabinet's 4x4 box rotation. */
function rotate(cells, turns) {
  let out = cells.map((cell) => [cell[0], cell[1]]);
  for (let turn = 0; turn < turns; turn++) out = out.map((cell) => [3 - cell[1], cell[0]]);
  return out;
}

function fits(board, cells, y) {
  return cells.every(([x, cy]) => {
    const ny = cy + y;
    return x >= 0 && x < COLS && ny < ROWS && (ny < 0 || board[ny][x] === ".");
  });
}

/** Drop a placement from where the block actually is, clear completed rows, score it. */
function simulate(board, cells, startY) {
  if (!fits(board, cells, startY)) return { score: Number.NEGATIVE_INFINITY, cleared: 0 };
  let y = startY;
  while (fits(board, cells, y + 1)) y += 1;
  const filled = board.map((row) => row.split(""));
  for (const [x, cy] of cells) filled[cy + y][x] = "#";
  const kept = filled.filter((row) => row.some((cell) => cell === "."));
  const cleared = ROWS - kept.length;
  while (kept.length < ROWS) kept.unshift(Array.from({ length: COLS }, () => "."));

  const heights = [];
  let holes = 0;
  for (let column = 0; column < COLS; column++) {
    let top = -1;
    for (let row = 0; row < ROWS; row++) {
      if (kept[row][column] === "#") { top = row; break; }
    }
    if (top < 0) { heights.push(0); continue; }
    heights.push(ROWS - top);
    for (let row = top + 1; row < ROWS; row++) if (kept[row][column] === ".") holes += 1;
  }
  let bumpiness = 0;
  for (let index = 0; index + 1 < COLS; index++) bumpiness += Math.abs(heights[index] - heights[index + 1]);
  const aggregate = heights.reduce((sum, value) => sum + value, 0);
  const maxHeight = Math.max(...heights);
  const rowFill = (row) => kept[row].filter((cell) => cell === "#").length;
  // A clear is worth more than anything; then no holes, then complete the
  // lowest row, then stay low and flat.
  return {
    cleared,
    score: cleared * 1_000_000 + rowFill(ROWS - 1) * 120 + rowFill(ROWS - 2) * 40
      - holes * 400 - maxHeight * 8 - aggregate * 2 - bumpiness * 6,
  };
}

await testGame("./games/impostor-protocol", {
  width: 960,
  height: 800,
  timeout: 60_000,
  screenshot: "./artifacts/60-keypad-final.png",
  check: async ({ page, game }) => {
    const problems = [];
    page.on("pageerror", (error) => problems.push(`page: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error") problems.push(`console: ${message.text()}`); });

    await game.locator("section.ip-root").first().waitFor({ timeout: 30_000 });
    const crew = game.getByRole("radio", { name: /crewmate/i });
    if (await crew.count()) await crew.first().check();
    await game.getByRole("button", { name: /start/i }).first().click();
    await page.waitForTimeout(1200);
    const begin = game.getByRole("button", { name: /begin/i }).first();
    if (await begin.count()) await begin.click();
    await page.waitForTimeout(1600);

    const canvas = game.locator("canvas.ip-canvas");
    await canvas.click({ position: { x: 480, y: 300 } });
    await page.waitForTimeout(300);
    const read = () => canvas.evaluate((node) => ({
      x: Number(node.dataset.x), y: Number(node.dataset.y), phase: node.dataset.phase ?? "",
      tasks: node.dataset.tasks ?? "", prompt: node.dataset.prompt ?? "",
    }), undefined, { timeout: READ_MS });

    for (const [targetX, targetY] of ROUTE) {
      for (let step = 0; step < 24; step++) {
        const now = await read();
        if (Math.hypot(targetX - now.x, targetY - now.y) < 45) break;
        const dx = targetX - now.x;
        const dy = targetY - now.y;
        const keys = [];
        if (Math.abs(dx) > 14) keys.push(dx > 0 ? "d" : "a");
        if (Math.abs(dy) > 14) keys.push(dy > 0 ? "s" : "w");
        for (const key of keys) await page.keyboard.down(key);
        await page.waitForTimeout(Math.min(800, Math.max(200, (Math.hypot(dx, dy) / 155) * 1000)));
        for (const key of keys) await page.keyboard.up(key);
        await page.waitForTimeout(120);
      }
    }

    const prompt = game.locator("button.ip-prompt").first();
    const label = (await prompt.count()) ? (await prompt.innerText()).replace(/\s+/g, " ") : "";
    const before = (await read()).tasks;
    console.log(`  · arrived at the O2 console · prompt ${JSON.stringify(label)} · tasks ${before}`);
    if (!/filter|keypad|o2/i.test(label)) throw new Error(`Not at the O2 console: ${JSON.stringify(label)}`);

    await prompt.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: "./artifacts/60-keypad-open.png" });

    const well = game.locator("canvas.ip-arc-canvas").first();
    if ((await well.count()) === 0) throw new Error("The O2 console did not open a stacker well.");
    const title = (await game.locator(".ip-arc-title").first().innerText()).trim();
    console.log(`  · console opened: ${JSON.stringify(title)}`);
    const box = await well.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { w: Math.round(rect.width), h: Math.round(rect.height) };
    });
    if (box.w < 8 || box.h < 8) throw new Error(`The O2 well has an empty box ${box.w}x${box.h}`);
    console.log(`  · well box: ${box.w}x${box.h}`);

    /** Null once the console has resolved and unmounted its arena. */
    const state = async () => {
      try {
        return await well.evaluate((node) => ({
          phase: node.dataset.phase,
          board: node.dataset.board,
          cells: node.dataset.cells,
          x: Number(node.dataset.x),
          y: Number(node.dataset.y),
          cleared: Number(node.dataset.cleared),
        }), undefined, { timeout: READ_MS });
      } catch {
        return null;
      }
    };

    const first = await state();
    if (first === null) throw new Error("The O2 well vanished immediately after opening.");

    // Input response: rotating or shifting the block must change its published cells.
    await page.keyboard.press("ArrowUp");
    await sleep(160);
    let reacted = await state();
    if (reacted !== null && reacted.cells === first.cells) {
      await page.keyboard.press("ArrowRight");
      await sleep(160);
      reacted = await state();
    }
    if (reacted === null || reacted.cells === first.cells) {
      throw new Error("The O2 stacker did not respond to keyboard input.");
    }
    console.log(`  · input response: cells ${JSON.stringify(first.cells)} -> ${JSON.stringify(reacted.cells)}`);

    const started = Date.now();
    const deadline = started + 22_000;
    let pieces = 0;
    let last = reacted;
    let sawWin = reacted.phase === "won";
    while (Date.now() < deadline) {
      const current = await state();
      if (current === null) break; // resolved: the arena is gone
      last = current;
      if (last.phase === "won") { sawWin = true; break; }
      if (last.phase === "lost") break;

      const cells = last.cells.split(";").map((pair) => pair.split(",").map(Number));
      const local = cells.map(([x, y]) => [x - last.x, y - last.y]);
      const board = last.board.split("/");

      let best = null;
      for (let turns = 0; turns < 4; turns++) {
        const shape = rotate(local, turns);
        const minX = Math.min(...shape.map((cell) => cell[0]));
        const maxX = Math.max(...shape.map((cell) => cell[0]));
        for (let column = minX >= 0 ? 0 : -minX; column + maxX < COLS; column++) {
          const placed = shape.map((cell) => [cell[0] + column, cell[1]]);
          const { score, cleared } = simulate(board, placed, last.y);
          if (score === Number.NEGATIVE_INFINITY) continue;
          if (best === null || score > best.score) best = { score, turns, column, cleared };
        }
      }
      if (best === null) throw new Error("No legal placement for the falling block.");

      for (let turn = 0; turn < best.turns; turn++) {
        await page.keyboard.press("ArrowUp");
        await sleep(28);
      }
      // Aim on the box column, which is exactly what data-x publishes.
      for (let guard = 0; guard < 12; guard++) {
        const now = await state();
        if (now === null) break;
        const delta = best.column - now.x;
        if (delta === 0) break;
        await page.keyboard.press(delta > 0 ? "ArrowRight" : "ArrowLeft");
        await sleep(28);
      }
      await page.keyboard.press("Space");
      pieces += 1;
      await sleep(45);
    }

    // The outcome: the result panel first (it only lives ~800 ms), then the
    // station counter, which is the durable record of the credit.
    const panelOf = async () => {
      try {
        if (!(await game.locator(".ip-task-result").count())) return "";
        return (await game.locator(".ip-task-result").first().getAttribute("data-result", { timeout: READ_MS })) ?? "";
      } catch {
        return "";
      }
    };
    let panel = "";
    const settle = Date.now() + 12_000;
    while (Date.now() < settle) {
      panel = panel || (await panelOf());
      if ((await game.locator(".ip-task").count()) === 0) break;
      await page.waitForTimeout(120);
    }

    await page.waitForTimeout(400);
    await page.screenshot({ path: "./artifacts/60-keypad-result.png" });
    const resolved = (await game.locator(".ip-task").count()) === 0;
    const after = (await read()).tasks;
    const hud = (await game.locator("section.ip-root").innerText()).match(/YOUR TASKS\s*(\d+)\s*\/\s*(\d+)/i);
    const toast = (await game.locator("p.ip-toast").count())
      ? (await game.locator("p.ip-toast").first().innerText()).replace(/\s+/g, " ").trim()
      : "(none)";
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`  · stacker: ${pieces} blocks in ${seconds}s · last rows ${last.cleared} · arena ${sawWin ? "won" : "resolved"} · result panel ${JSON.stringify(panel)}`);
    console.log(`  · overlay closed=${resolved} · task counter ${before} -> ${after} (HUD: ${hud ? hud[0].replace(/\s+/g, " ") : "unreadable"})`);
    console.log(`  · toast: ${JSON.stringify(toast)}`);

    if (panel === "lost" || (panel === "" && !sawWin && last.cleared === 0)) {
      throw new Error(`The stacker did not clear two rows (panel=${JSON.stringify(panel)}, rows=${last.cleared}, blocks=${pieces}).`);
    }
    if (!resolved) throw new Error("The O2 console never closed after the win.");
    if (after === before) throw new Error(`The O2 stacker credited no task (${before} -> ${after}).`);
    if (!/complete/i.test(toast)) throw new Error(`No task result reached the HUD; toast was ${JSON.stringify(toast)}`);
    if (problems.length) throw new Error(`Browser problems:\n${problems.join("\n")}`);
  },
});

console.log("keypad check passed: the O2 filter stacker was cleared with real input");
