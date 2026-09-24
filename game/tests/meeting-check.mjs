/**
 * Meeting check: call an emergency meeting from the station, vote, and confirm
 * the tally resolves into either an ejection or a no-eject result.
 *
 *   node games/impostor-protocol/tests/meeting-check.mjs
 */
import { mkdir } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";

await mkdir("./artifacts", { recursive: true });

await testGame("./games/impostor-protocol", {
  width: 960,
  height: 800,
  timeout: 20_000,
  screenshot: "./artifacts/50-meeting-final.png",
  check: async ({ page, game }) => {
    const problems = [];
    page.on("pageerror", error => problems.push(`page: ${error.message}`));
    page.on("console", message => { if (message.type() === "error") problems.push(`console: ${message.text()}`); });

    const text = async selector => (await game.locator(selector).first().innerText()).replace(/\s+/g, " ").trim();

    await game.locator("section.ip-root").first().waitFor({ timeout: 25_000 });
    await game.getByRole("button", { name: /start/i }).first().click();
    await page.waitForTimeout(1300);
    await game.getByRole("button", { name: /begin/i }).first().click();
    await page.waitForTimeout(1700);
    await game.locator("canvas.ip-canvas").click({ position: { x: 480, y: 300 } });
    await page.waitForTimeout(400);

    // Steer precisely to the emergency button using the published position.
    const read = async () => game.locator("canvas.ip-canvas").evaluate(node => ({
      x: Number(node.dataset.x), y: Number(node.dataset.y),
      phase: node.dataset.phase ?? "", prompt: node.dataset.prompt ?? "",
    }));
    const prompt = game.locator("button.ip-prompt").first();
    for (let attempt = 0; attempt < 8; attempt++) {
      const state = await read();
      console.log(`  · step ${attempt}: at (${state.x}, ${state.y}) phase=${state.phase} prompt=${JSON.stringify(state.prompt)}`);
      if (state.prompt) break;
      if (state.phase !== "play") {
        const frame = (await game.locator("section.ip-root").innerText()).replace(/\s+/g, " ");
        throw new Error(`Left the play phase before reaching the button (phase=${state.phase}): ${frame.slice(0, 220)}`);
      }
      const dx = 1140 - state.x;
      const dy = 350 - state.y;
      const keys = [];
      if (Math.abs(dx) > 20) keys.push(dx > 0 ? "d" : "a");
      if (Math.abs(dy) > 20) keys.push(dy > 0 ? "s" : "w");
      for (const key of keys) await page.keyboard.down(key);
      await page.waitForTimeout(Math.min(900, Math.max(250, (Math.hypot(dx, dy) / 155) * 1000)));
      for (const key of keys) await page.keyboard.up(key);
      await page.waitForTimeout(320);
    }
    console.log(`  · prompt: ${JSON.stringify(await prompt.innerText())}`);
    await prompt.click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: "./artifacts/50-meeting.png" });

    const meetingOpen = (await game.locator(".ip-meet").count()) > 0;
    console.log(`  · meeting screen open: ${meetingOpen}`);
    if (!meetingOpen) throw new Error("Pressing E at the emergency button did not open a meeting.");
    console.log(`  · meeting text: ${JSON.stringify((await text(".ip-meet")).slice(0, 200))}`);

    // The vote grid: crew names plus a skip option.
    const voteTargets = await game.locator(".ip-meet button")
      .evaluateAll(nodes => nodes.map(node => node.textContent.replace(/\s+/g, " ").trim()).filter(Boolean));
    console.log(`  · vote controls: ${JSON.stringify(voteTargets)}`);
    if (voteTargets.length < 6) throw new Error(`The vote grid only offered ${voteTargets.length} controls.`);

    // Vote for the first crewmate that is not "You"/skip.
    const target = voteTargets.find(name => !/you|skip|close|leave/i.test(name));
    console.log(`  · voting for: ${JSON.stringify(target)}`);
    await game.locator(".ip-meet button").filter({ hasText: target }).first().click();
    await page.screenshot({ path: "./artifacts/51-voted.png" });

    // Wait out the 20 s vote window for the tally.
    let ejection = false;
    let backInStation = false;
    for (let step = 0; step < 40 && !ejection && !backInStation; step++) {
      await page.waitForTimeout(1500);
      ejection = (await game.locator(".ip-eject").count()) > 0;
      backInStation = (await game.locator("canvas.ip-canvas").count()) > 0 && (await game.locator(".ip-meet").count()) === 0;
    }
    const verdict = ejection ? await text(".ip-eject") : backInStation ? "(returned to the station)" : "(nothing resolved)";
    console.log(`  · ejection screen: ${ejection}, back in station: ${backInStation}`);
    console.log(`  · verdict: ${JSON.stringify(verdict.slice(0, 200))}`);
    await page.screenshot({ path: "./artifacts/52-tally.png" });
    if (!ejection && !backInStation) throw new Error("The meeting never resolved into an ejection or a return to the station.");

    if (ejection) {
      // The ejection notice should hand control back on its own.
      for (let step = 0; step < 30 && !backInStation; step++) {
        await page.waitForTimeout(1500);
        backInStation = (await game.locator("canvas.ip-canvas").count()) > 0 && (await game.locator(".ip-eject").count()) === 0;
      }
      console.log(`  · returned to the station after the ejection: ${backInStation}`);
      if (!backInStation) throw new Error("The ejection notice never returned to the station.");
      const after = await game.locator(".ip-hud").innerText();
      console.log(`  · crew after the tally: ${JSON.stringify(after.replace(/\s+/g, " ").slice(0, 120))}`);
    }

    if (problems.length) throw new Error(`Browser problems:\n${problems.join("\n")}`);
  },
});

console.log("meeting check passed: the emergency meeting, vote and tally resolved");
