/**
 * throwaway probe: run keypad-check's flow verbatim with a background poller,
 * to see exactly when/if the arena canvas stops resolving.
 */
import { testGame } from "@rarefriends/friendsdk/testing";

const ROUTE = [[1200, 255], [1200, 510], [1200, 750], [1200, 990], [1200, 1245], [1640, 1245], [2020, 1245], [2170, 1370]];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await testGame("./games/impostor-protocol", {
  width: 960,
  height: 800,
  timeout: 60_000,
  check: async ({ page, game }) => {
    const t0 = Date.now();
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
    const read = () => canvas.evaluate((node) => ({ x: Number(node.dataset.x), y: Number(node.dataset.y) }));

    for (const [tx, ty] of ROUTE) {
      for (let step = 0; step < 24; step++) {
        const now = await read();
        if (Math.hypot(tx - now.x, ty - now.y) < 45) break;
        const dx = tx - now.x;
        const dy = ty - now.y;
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
    await prompt.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: "./artifacts/60-keypad-open.png" });

    const well = game.locator("canvas.ip-arc-canvas").first();
    console.log(`  · [+${Date.now() - t0}ms] count=${await well.count()}`);
    const title = (await game.locator(".ip-arc-title").first().innerText()).trim();
    console.log(`  · [+${Date.now() - t0}ms] title=${JSON.stringify(title)}`);

    // Background poller: is the canvas still attached, and what is the task clock?
    let stop = false;
    const poller = (async () => {
      while (!stop) {
        const at = Date.now() - t0;
        try {
          const n = await game.locator("canvas.ip-arc-canvas").count({ timeout: 2000 });
          const task = await game.locator(".ip-task").count({ timeout: 2000 });
          const secs = (await game.locator(".ip-task-seconds").count({ timeout: 2000 }))
            ? await game.locator(".ip-task-seconds").first().innerText({ timeout: 2000 }) : "-";
          const bodyStatus = (await game.locator(".ip-task-body").count({ timeout: 2000 }))
            ? await game.locator(".ip-task-body").first().getAttribute("data-status", { timeout: 2000 }) : "-";
          console.log(`      poll +${String(at).padStart(6)}ms canvas=${n} task=${task} clock=${secs} status=${bodyStatus}`);
        } catch (error) {
          console.log(`      poll +${String(at).padStart(6)}ms ERROR ${String(error.message).split("\n")[0]}`);
        }
        await sleep(400);
      }
    })();

    const state = () => well.evaluate((node) => ({
      phase: node.dataset.phase,
      board: node.dataset.board,
      cells: node.dataset.cells,
      x: Number(node.dataset.x),
      y: Number(node.dataset.y),
      cleared: Number(node.dataset.cleared),
    }));

    for (let i = 0; i < 5; i++) {
      const began = Date.now() - t0;
      try {
        const s = await state();
        console.log(`  · [+${began}ms -> +${Date.now() - t0}ms] state() ok phase=${s.phase} cells=${s.cells}`);
      } catch (error) {
        console.log(`  · [+${began}ms -> +${Date.now() - t0}ms] state() FAILED ${String(error.message).split("\n")[0]}`);
        break;
      }
      await sleep(500);
    }
    stop = true;
    await poller;
  },
});

console.log("poller probe done");
