/**
 * Focused browser check for Impostor Protocol.
 *
 * Runs the SDK's own harness: a real headless Chromium, the real runtime, the
 * real sandbox and ownership gate, with mocked wallet/RPC/sprite fixtures (as
 * the SDK documents for automated tests). It walks the game from the Airlock
 * into a live station and writes screenshots for inspection.
 *
 *   node games/impostor-protocol/tests/browser-check.mjs
 */
import { mkdir } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";

const out = "./artifacts";
await mkdir(out, { recursive: true });

const shot = async (page, name) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`  · captured ${name}.png`);
};

const describe = async (game, label) => {
  const buttons = await game.getByRole("button").evaluateAll(nodes =>
    nodes.map(node => (node.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean));
  console.log(`  · ${label} buttons: ${JSON.stringify(buttons)}`);
  return buttons;
};

const press = async (game, name) => {
  const target = game.getByRole("button", { name });
  await target.first().click({ timeout: 10_000 });
};

const result = await testGame("./games/impostor-protocol", {
  width: 960,
  height: 800,
  timeout: 25_000,
  screenshot: `${out}/99-final.png`,
  check: async ({ page, game }) => {
    const problems = [];
    page.on("console", message => { if (message.type() === "error") problems.push(`console: ${message.text()}`); });
    page.on("pageerror", error => problems.push(`page: ${error.message}`));

    await game.locator("section.ip-root, div.ip-boot").first().waitFor({ timeout: 25_000 });
    await shot(page, "01-lobby");
    const buttons = await describe(game, "lobby");

    const start = buttons.find(name => /start|launch|deploy/i.test(name));
    if (!start) throw new Error(`No start control in the lobby. Buttons seen: ${JSON.stringify(buttons)}`);
    await press(game, start);
    await page.waitForTimeout(1200);
    await shot(page, "02-briefing");
    await describe(game, "briefing");

    const begin = game.getByRole("button", { name: /begin|enter|board|go|start/i }).first();
    if (await begin.count()) { await begin.click(); }
    await page.waitForTimeout(1600);
    await shot(page, "03-station");

    // Move with the keyboard, then tap a destination, and look for a console prompt.
    const canvas = game.locator("canvas.ip-canvas");
    await canvas.click({ position: { x: 480, y: 320 } });
    await page.waitForTimeout(900);
    for (const key of ["d", "d", "s", "d", "d"]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(160);
    }
    await page.waitForTimeout(700);
    await shot(page, "04-moved");
    const position = await canvas.evaluate(node => `${node.dataset.x ?? "?"},${node.dataset.y ?? "?"}`).catch(() => "n/a");
    console.log(`  · canvas position after movement: ${position}`);

    const prompt = await game.locator("button.ip-prompt").count();
    console.log(`  · interaction prompt present: ${prompt > 0}`);
    if (prompt > 0) {
      await game.locator("button.ip-prompt").first().click();
      await page.waitForTimeout(900);
      await shot(page, "05-task");
      await describe(game, "task overlay");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }

    const hud = await game.locator("section.ip-root").getAttribute("data-hud");
    console.log(`  · hud tick attribute: ${hud}`);

    if (problems.length) throw new Error(`Browser problems:\n${problems.join("\n")}`);
  },
});

console.log("browser check passed", JSON.stringify(result));
