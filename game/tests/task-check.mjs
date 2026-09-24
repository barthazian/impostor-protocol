/**
 * Task-loop check: steer the Friend across the station with real key input,
 * open the wiring action sequence at the Electrical console, solve it, and prove
 * the success reached the simulation.
 *
 *   node games/impostor-protocol/tests/task-check.mjs
 */
import { mkdir } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";

await mkdir("./artifacts", { recursive: true });

/** Lanes between adjacent corridors and rooms, straight by construction. */
const ROUTE = [
  { x: 760, y: 255 },   // West Corridor
  { x: 380, y: 255 },   // Reactor
  { x: 380, y: 510 },   // Reactor Access
  { x: 380, y: 750 },   // MedBay
  { x: 380, y: 990 },   // Lower Reactor Access
  { x: 380, y: 1245 },  // Electrical
  { x: 230, y: 1370 },  // Wiring console
];

const color = label => (label ?? "").replace(/^(Left|Right) node \d+, /, "").replace(/ wire.*$/, "").trim();

await testGame("./games/impostor-protocol", {
  width: 960,
  height: 800,
  timeout: 20_000,
  screenshot: "./artifacts/13-task-final.png",
  check: async ({ page, game }) => {
    const problems = [];
    page.on("pageerror", error => problems.push(`page: ${error.message}`));
    page.on("console", message => { if (message.type() === "error") problems.push(`console: ${message.text()}`); });

    const canvas = game.locator("canvas.ip-canvas");
    const read = async () => canvas.evaluate(node => ({
      x: Number(node.dataset.x), y: Number(node.dataset.y),
      camX: Number(node.dataset.cameraX), camY: Number(node.dataset.cameraY),
      phase: node.dataset.phase ?? "", tasks: node.dataset.tasks ?? "",
    }));
    const prompt = async () => {
      const node = game.locator("button.ip-prompt");
      return (await node.count()) ? (await node.first().innerText()).replace(/\s+/g, " ").trim() : "";
    };

    await game.locator("section.ip-root").first().waitFor({ timeout: 25_000 });
    // Crewmate keeps the task loop unambiguous.
    const crew = game.getByRole("radio", { name: /crewmate/i });
    if (await crew.count()) await crew.first().check();
    await game.getByRole("button", { name: /start/i }).first().click();
    await page.waitForTimeout(1200);
    await game.getByRole("button", { name: /begin/i }).first().click();
    await page.waitForTimeout(1600);
    await canvas.click({ position: { x: 480, y: 300 } });
    await page.waitForTimeout(300);
    console.log(`  · station: ${JSON.stringify(await read())}`);

    const steer = async (target, tolerance = 55, maxSteps = 26) => {
      for (let step = 0; step < maxSteps; step++) {
        const now = await read();
        const distance = Math.hypot(target.x - now.x, target.y - now.y);
        if (distance <= tolerance) return true;
        const keys = [];
        if (Math.abs(target.x - now.x) > 16) keys.push(target.x > now.x ? "d" : "a");
        if (Math.abs(target.y - now.y) > 16) keys.push(target.y > now.y ? "s" : "w");
        for (const key of keys) await page.keyboard.down(key);
        await page.waitForTimeout(Math.min(900, Math.max(200, (distance / 155) * 1000)));
        for (const key of keys) await page.keyboard.up(key);
        await page.waitForTimeout(140);
      }
      const now = await read();
      console.log(`    ! did not settle at ${JSON.stringify(target)} (at ${now.x}, ${now.y})`);
      return false;
    };

    for (const [index, waypoint] of ROUTE.entries()) {
      const ok = await steer(waypoint, index === 0 ? 70 : 55);
      const now = await read();
      console.log(`  · leg ${index + 1} -> (${waypoint.x}, ${waypoint.y}) ${ok ? "ok" : "FAILED"} at (${now.x}, ${now.y})`);
      if (now.phase !== "play") throw new Error(`Left the play phase while walking (phase=${now.phase}).`);
    }
    await page.screenshot({ path: "./artifacts/10-electrical.png" });

    let label = await prompt();
    if (!/wiring/i.test(label)) {
      await steer({ x: 230, y: 1330 }, 35, 8);
      label = await prompt();
    }
    console.log(`  · prompt at the console: ${JSON.stringify(label)}`);
    if (!/wiring/i.test(label)) throw new Error(`Could not reach the wiring console; last prompt ${JSON.stringify(label)}`);

    const before = (await read()).tasks;
    await game.locator("button.ip-prompt").first().click();
    await page.waitForTimeout(900);
    const opened = await game.locator(".ip-task").count();
    await page.screenshot({ path: "./artifacts/11-task-open.png" });
    console.log(`  · wiring overlay opened: ${opened > 0}`);

    // Solve by colour: read both columns' accessible labels and pair them up.
    const lefts = await game.locator('button.ip-wire-node[data-side="left"]')
      .evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label")));
    const rights = await game.locator('button.ip-wire-node[data-side="right"]')
      .evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label")));
    console.log(`  · left column:  ${JSON.stringify(lefts.map(color))}`);
    console.log(`  · right column: ${JSON.stringify(rights.map(color))}`);

    const remaining = rights.map((label2, index) => ({ label: label2, index }));
    for (let index = 0; index < lefts.length; index++) {
      const wanted = color(lefts[index]);
      const match = remaining.find(entry => color(entry.label) === wanted);
      if (!match) throw new Error(`No matching right node for ${wanted}`);
      remaining.splice(remaining.indexOf(match), 1);
      await game.locator('button.ip-wire-node[data-side="left"]').nth(index).click();
      await page.waitForTimeout(140);
      await game.locator('button.ip-wire-node[data-side="right"]').nth(match.index).click();
      await page.waitForTimeout(140);
    }

    await page.waitForTimeout(900);
    await page.screenshot({ path: "./artifacts/12-task-resolved.png" });
    const resolved = (await game.locator(".ip-task").count()) === 0;
    const after = (await read()).tasks;
    const toast = (await game.locator("p.ip-toast").count())
      ? (await game.locator("p.ip-toast").first().innerText()).replace(/\s+/g, " ").trim()
      : "(none)";
    const hud = (await game.locator("section.ip-root").innerText()).match(/YOUR TASKS\s*\d+\s*\/\s*\d+/i);

    console.log(`  · overlay resolved: ${resolved}`);
    console.log(`  · task counter ${before} -> ${after} (HUD: ${hud ? hud[0] : "unreadable"})`);
    console.log(`  · toast: ${JSON.stringify(toast)}`);

    if (opened === 0) throw new Error("The task overlay never opened.");
    if (!resolved) throw new Error("The wiring overlay never resolved.");
    if (after === before) throw new Error(`The completed task did not reach the simulation (${before} -> ${after}).`);
    if (!/complete/i.test(toast)) throw new Error(`No task result reached the HUD; toast was ${JSON.stringify(toast)}`);

    console.log(`  · prompt after the task: ${JSON.stringify(await prompt())}`);
    if (problems.length) throw new Error(`Browser problems:\n${problems.join("\n")}`);
  },
});

console.log("task check passed: a wiring task was completed through real input");
