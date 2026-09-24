/**
 * throwaway probe: stacker board trace, aggressive lowest-row completion.
 */
import { mkdir } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";

await mkdir("./artifacts", { recursive: true });
const ROUTE = [[1200, 255], [1200, 510], [1200, 750], [1200, 990], [1200, 1245], [1640, 1245], [2020, 1245], [2170, 1370]];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const COLS = 8;
const ROWS = 12;
const READ_MS = 2500;

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
    for (let row = 0; row < ROWS; row++) if (kept[row][column] === "#") { top = row; break; }
    if (top < 0) { heights.push(0); continue; }
    heights.push(ROWS - top);
    for (let row = top + 1; row < ROWS; row++) if (kept[row][column] === ".") holes += 1;
  }
  let bumpiness = 0;
  for (let index = 0; index + 1 < COLS; index++) bumpiness += Math.abs(heights[index] - heights[index + 1]);
  const aggregate = heights.reduce((sum, value) => sum + value, 0);
  const maxHeight = Math.max(...heights);
  const rowFill = (row) => kept[row].filter((cell) => cell === "#").length;
  const score = cleared * 1_000_000
    + rowFill(ROWS - 1) * 120
    + rowFill(ROWS - 2) * 40
    - holes * 400
    - maxHeight * 8
    - aggregate * 2
    - bumpiness * 6;
  return { cleared, score };
}

await testGame("./games/impostor-protocol", {
  width: 960,
  height: 800,
  timeout: 60_000,
  check: async ({ page, game }) => {
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
    const read = () => canvas.evaluate((n) => ({ x: Number(n.dataset.x), y: Number(n.dataset.y) }), undefined, { timeout: READ_MS });
    for (const [tx, ty] of ROUTE) {
      for (let step = 0; step < 24; step++) {
        const now = await read();
        if (Math.hypot(tx - now.x, ty - now.y) < 45) break;
        const dx = tx - now.x; const dy = ty - now.y;
        const keys = [];
        if (Math.abs(dx) > 14) keys.push(dx > 0 ? "d" : "a");
        if (Math.abs(dy) > 14) keys.push(dy > 0 ? "s" : "w");
        for (const k of keys) await page.keyboard.down(k);
        await page.waitForTimeout(Math.min(800, Math.max(200, (Math.hypot(dx, dy) / 155) * 1000)));
        for (const k of keys) await page.keyboard.up(k);
        await page.waitForTimeout(120);
      }
    }
    await game.locator("button.ip-prompt").first().click();
    await page.waitForTimeout(800);
    const well = game.locator("canvas.ip-arc-canvas").first();
    const state = async () => {
      try {
        return await well.evaluate((n) => ({
          phase: n.dataset.phase, board: n.dataset.board, cells: n.dataset.cells,
          x: Number(n.dataset.x), y: Number(n.dataset.y), cleared: Number(n.dataset.cleared),
        }), undefined, { timeout: READ_MS });
      } catch { return null; }
    };

    const started = Date.now();
    let pieces = 0;
    while (pieces < 60 && Date.now() - started < 20_000) {
      const last = await state();
      if (last === null) { console.log(`  · canvas gone after ${pieces} blocks (topped out)`); break; }
      if (last.phase !== "run") { console.log(`  · phase=${last.phase} after ${pieces} blocks`); break; }
      const cells = last.cells.split(";").map((p) => p.split(",").map(Number));
      const local = cells.map(([x, y]) => [x - last.x, y - last.y]);
      const board = last.board.split("/");
      let best = null;
      for (let turns = 0; turns < 4; turns++) {
        const shape = rotate(local, turns);
        const minX = Math.min(...shape.map((c) => c[0]));
        const maxX = Math.max(...shape.map((c) => c[0]));
        for (let column = minX >= 0 ? 0 : -minX; column + maxX < COLS; column++) {
          const placed = shape.map((c) => [c[0] + column, c[1]]);
          const r = simulate(board, placed, last.y);
          if (r.score === Number.NEGATIVE_INFINITY) continue;
          if (best === null || r.score > best.score) best = { score: r.score, turns, column };
        }
      }
      if (best === null) { console.log("  · no legal placement"); break; }
      for (let t = 0; t < best.turns; t++) { await page.keyboard.press("ArrowUp"); await sleep(28); }
      for (let g = 0; g < 12; g++) {
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
      const after = await state();
      if (after === null) { console.log(`  · canvas gone right after block ${pieces}`); break; }
      if (pieces <= 16) console.log(`  · block ${pieces} cleared=${after.cleared} cols=${JSON.stringify(best.column)} turns=${best.turns}\n${after.board.split("/").map((r) => "        " + r).join("\n")}`);
      if (after.phase === "won") { console.log(`  · WON after ${pieces} blocks in ${((Date.now() - started) / 1000).toFixed(1)}s`); break; }
      if (after.phase === "lost") { console.log(`  · LOST after ${pieces} blocks`); break; }
    }
  },
});
console.log("aggressive probe done");
