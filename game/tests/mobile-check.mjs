/**
 * Phone-viewport check: the SDK frame is 3:2, so at 390 px wide it is only about
 * 260 px tall. This runs the real runtime at a phone size and asserts the
 * controls the game needs are still on screen and tappable.
 *
 *   node games/impostor-protocol/tests/mobile-check.mjs
 */
import { mkdir } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";

await mkdir("./artifacts", { recursive: true });
const VIEWPORT = { width: 390, height: 844 };

await testGame("./games/impostor-protocol", {
  width: VIEWPORT.width,
  height: VIEWPORT.height,
  timeout: 20_000,
  screenshot: "./artifacts/40-mobile-final.png",
  check: async ({ page, game }) => {
    const problems = [];
    page.on("pageerror", error => problems.push(`page: ${error.message}`));
    page.on("console", message => { if (message.type() === "error") problems.push(`console: ${message.text()}`); });

    const describe = async (locator, label) => {
      const box = (await locator.count()) ? await locator.first().boundingBox() : null;
      console.log(`  · ${label}: ${box ? `${Math.round(box.width)}x${Math.round(box.height)} at (${Math.round(box.x)}, ${Math.round(box.y)})` : "not present"}`);
      return box;
    };

    await game.locator("section.ip-root").first().waitFor({ timeout: 25_000 });
    const frame = await game.locator("section.ip-root").first().boundingBox();
    console.log(`  · game frame at ${VIEWPORT.width}x${VIEWPORT.height}: ${Math.round(frame.width)}x${Math.round(frame.height)}`);

    await page.screenshot({ path: "./artifacts/41-mobile-lobby.png" });
    const start = game.getByRole("button", { name: /start|enter|play/i }).first();
    const startBox = await describe(start, "lobby start control");
    if (!startBox) throw new Error("The lobby has no start control at phone width.");
    if (startBox.height < 24) throw new Error(`Start control is only ${Math.round(startBox.height)}px tall.`);
    if (startBox.y + startBox.height > VIEWPORT.height) throw new Error("The start control is below the viewport.");

    await start.click();
    await page.waitForTimeout(1400);
    const begin = game.getByRole("button", { name: /begin/i }).first();
    if (await begin.count()) await begin.click();
    await page.waitForTimeout(1700);
    await page.screenshot({ path: "./artifacts/42-mobile-station.png" });

    const canvas = await describe(game.locator("canvas.ip-canvas"), "station canvas");
    if (!canvas) throw new Error("The station canvas did not render at phone size.");

    const prompt = game.locator("button.ip-prompt").first();
    let promptBox = await describe(prompt, "interaction prompt");
    if (!promptBox) {
      // Touch players need that button, so walk within reach of the emergency
      // button and measure the prompt the game raises.
      await page.keyboard.down("s");
      await page.waitForTimeout(950);
      await page.keyboard.up("s");
      await page.waitForTimeout(500);
      const where = await game.locator("canvas.ip-canvas").evaluate(node => `${node.dataset.x},${node.dataset.y} prompt=${node.dataset.prompt}`);
      console.log(`      player after walking: ${where}`);
      promptBox = await describe(prompt, "interaction prompt (in reach)");
    }
    if (promptBox) {
      if (promptBox.y + promptBox.height > frame.y + frame.height + 1) throw new Error("The interaction prompt sits outside the game frame.");
      if (promptBox.height < 22) throw new Error(`The interaction prompt is only ${Math.round(promptBox.height)}px tall.`);
    }

    await page.keyboard.press("t");
    await page.waitForTimeout(800);
    const sheet = game.locator(".ip-sheet").first();
    const sheetBox = await describe(sheet, "task list sheet");
    await page.screenshot({ path: "./artifacts/43-mobile-tasklist.png" });
    if (sheetBox) {
      const scroll = await sheet.evaluate(node => ({ scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }));
      console.log(`      sheet scroll: ${scroll.scrollHeight}/${scroll.clientHeight} (internal scrolling allowed)`);
      if (sheetBox.height > VIEWPORT.height) throw new Error("The task sheet is taller than the phone viewport.");
      const rows = await game.locator(".ip-trow").count();
      console.log(`      task rows rendered: ${rows}`);
      if (rows < 6) throw new Error(`Only ${rows} task rows rendered at phone size.`);
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    const hudButtons = await game.locator(".ip-hud-buttons button")
      .evaluateAll(nodes => nodes.map(node => node.textContent.replace(/\s+/g, " ").trim()).filter(Boolean)).catch(() => []);
    console.log(`  · HUD buttons at phone size: ${JSON.stringify(hudButtons)}`);

    if (problems.length) throw new Error(`Browser problems:\n${problems.join("\n")}`);
  },
});

console.log("mobile check passed: the phone-sized frame keeps its controls usable");
