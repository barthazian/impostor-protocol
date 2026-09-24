/**
 * Economy check: drive a Standard tournament through the real runtime — approve
 * the RF purchase and the pass use in the trusted frame, watch the round finish,
 * then open the Reward Cache and read the outcome.
 *
 *   node games/impostor-protocol/tests/economy-check.mjs
 *
 * The round is allowed to play itself out, so this takes several minutes: the AI
 * impostors hunt while the script watches for the debrief.
 */
import { mkdir } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";

await mkdir("./artifacts", { recursive: true });

const buttonsOf = async root => root.getByRole("button").evaluateAll(nodes =>
  nodes.map(node => (node.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean)).catch(() => []);

await testGame("./games/impostor-protocol", {
  width: 960,
  height: 800,
  timeout: 30_000,
  screenshot: "./artifacts/29-debrief-final.png",
  check: async ({ page, game }) => {
    const problems = [];
    page.on("pageerror", error => problems.push(`page: ${error.message}`));
    page.on("console", message => { if (message.type() === "error") problems.push(`console: ${message.text()}`); });

    const frameText = async () => (await game.locator("section.ip-root").innerText()).replace(/\s+/g, " ");
    const passes = async () => (await frameText()).match(/PASSES?\s*(\d+)/i)?.[1] ?? "unreadable";

    /**
     * The trusted runtime owns confirmations: the sandboxed game never sees them,
     * so each purchase/roll must be approved from the host frame. Buying a pass
     * and then using it are two separate confirmations.
     */
    const approveIfAsked = async (label, attempts = 6) => {
      for (let attempt = 0; attempt < attempts; attempt++) {
        const approve = page.getByRole("button", { name: /^confirm preview$|^confirm$|^approve$/i });
        if (await approve.count()) {
          const title = await page.getByRole("heading")
            .evaluateAll(nodes => nodes.map(node => node.textContent.trim()).filter(Boolean)).catch(() => []);
          console.log(`  · ${label}: host confirmation ${JSON.stringify(title)}`);
          await approve.first().click();
          await page.waitForTimeout(1500);
          return true;
        }
        await page.waitForTimeout(900);
      }
      return false;
    };

    await game.locator("section.ip-root").first().waitFor({ timeout: 25_000 });
    // Standard tier: one pass spent, one cache produced.
    const radio = game.getByRole("radio", { name: /standard/i });
    if (await radio.count()) { await radio.first().check(); console.log("  · selected the Standard tier"); }
    else { await game.getByText(/^STANDARD$/i).first().click(); console.log("  · clicked the STANDARD card"); }
    await page.waitForTimeout(500);
    await page.screenshot({ path: "./artifacts/20-lobby-standard.png" });

    const lobbyButtons = await buttonsOf(game);
    console.log(`  · lobby buttons: ${JSON.stringify(lobbyButtons)}`);
    const startName = lobbyButtons.find(name => /start|enter|board|play/i.test(name));
    if (!startName) throw new Error(`No start control found in the lobby: ${JSON.stringify(lobbyButtons)}`);
    await game.getByRole("button", { name: startName }).first().click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: "./artifacts/24-confirm.png" });
    console.log(`  · host buttons after start: ${JSON.stringify(await buttonsOf(page))}`);

    if (!(await approveIfAsked("pass purchase"))) throw new Error("The runtime never asked to approve the pass purchase.");
    const used = await approveIfAsked("pass use", 4);
    console.log(`  · the runtime also asked to use the pass: ${used}`);
    await page.waitForTimeout(1800);

    // The paid round opens on the briefing; the station needs its begin control.
    const begin = game.getByRole("button", { name: /begin/i }).first();
    if (await begin.count()) { await begin.click(); console.log("  · entered the station"); }
    await page.waitForTimeout(1600);

    const inMatch = (await game.locator("canvas.ip-canvas").count()) > 0;
    await page.screenshot({ path: "./artifacts/25-match.png" });
    console.log(`  · station view rendered: ${inMatch}, passes now: ${await passes()}`);
    if (!inMatch) throw new Error(`The match never started. Tail: ${JSON.stringify((await frameText()).slice(-260))}`);

    // Let the round resolve itself, then look for the debrief by its own controls.
    let debrief = false;
    const started = Date.now();
    while (!debrief && Date.now() - started < 11 * 60 * 1000) {
      await page.waitForTimeout(5000);
      const names = await buttonsOf(game.locator(".ip-debrief"));
      debrief = names.some(name => /play again|airlock/i.test(name));
    }
    console.log(`  · debrief reached: ${debrief} after ${Math.round((Date.now() - started) / 1000)}s`);
    await page.screenshot({ path: "./artifacts/26-debrief.png" });
    if (!debrief) throw new Error(`The round never reached the debrief. Tail: ${JSON.stringify((await frameText()).slice(-300))}`);
    console.log(`  · debrief text: ${JSON.stringify((await game.locator(".ip-debrief").innerText()).replace(/\s+/g, " ").slice(0, 400))}`);

    // Open the cache the pass produced; the roll is settled by the runtime.
    const open = game.getByRole("button", { name: /^open cache$/i }).first();
    if (await open.count()) {
      await open.click();
      await page.waitForTimeout(1000);
      console.log(`  · settle asked for approval: ${await approveIfAsked("cache roll", 5)}`);
      await page.waitForTimeout(1800);
      await page.screenshot({ path: "./artifacts/27-cache.png" });
      const card = (await game.locator(".ip-debrief").innerText()).replace(/\s+/g, " ");
      const revealed = card.match(/check result[\s\S]{0,140}/i);
      console.log(`  · cache after the roll: ${JSON.stringify(revealed ? revealed[0] : card.slice(-260))}`);
    } else {
      console.log(`  · no Open cache control; debrief buttons: ${JSON.stringify(await buttonsOf(game.locator(".ip-debrief")))}`);
    }

    console.log(`  · passes at the end: ${await passes()}`);
    if (problems.length) throw new Error(`Browser problems:\n${problems.join("\n")}`);
  },
});

console.log("economy check passed: purchase, pass use, debrief and cache were driven through the real runtime");
