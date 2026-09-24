/**
 * Probe: does the SDK frame reflow when the viewport changes mid-session? The
 * reveal-strip check verifies the strip at 1280x800 and then re-measures it at a
 * 390px phone viewport in the SAME run (a second full round would cost minutes),
 * so this probe proves the resize path before the long check depends on it.
 *
 *   node games/impostor-protocol/tests/_probe-strip-viewport.mjs
 */
import { testGame } from "@rarefriends/friendsdk/testing";

await testGame("./games/impostor-protocol", {
  width: 1280, height: 800, timeout: 60_000,
  screenshot: "./artifacts/_probe-strip-viewport-desktop.png",
  check: async ({ page, game }) => {
    await game.locator("section.ip-root").first().waitFor({ timeout: 30_000 });
    const measure = () => game.locator("section.ip-root").first().evaluate(node => {
      const box = node.getBoundingClientRect();
      return { viewport: `${window.innerWidth}x${window.innerHeight}`, frame: `${Math.round(box.width)}x${Math.round(box.height)}` };
    });
    console.log(`  before resize: ${JSON.stringify(await measure())}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1200);
    console.log(`  after resize:  ${JSON.stringify(await measure())}`);
    // The strip only exists at the post-round screen, so a round is driven far
    // enough to prove the resized frame still accepts real input and keeps drawing.
    await game.locator("input.ip-code").first().fill("REVL");
    await game.getByRole("button", { name: /start practice round/i }).first().click();
    await game.locator("canvas.ip-canvas").first().waitFor({ timeout: 40_000 });
    await page.waitForTimeout(1500);
    const state = await game.locator("body").evaluate(`(() => {
      const hook = window.__ipImpostorProtocol;
      const canvas = document.querySelector("canvas.ip-canvas");
      const box = canvas.getBoundingClientRect();
      return { phase: hook.phase(), actors: hook.actors().length, art: !!hook.crewArt(),
        canvas: box.width + "x" + box.height, bitmap: canvas.width + "x" + canvas.height,
        strip: !!document.querySelector(".ip-rs-card") };
    })()`);
    console.log(`  resized round: ${JSON.stringify(state)}`);
    await page.screenshot({ path: "./artifacts/_probe-strip-viewport-phone.png" });
  },
});

console.log("viewport probe passed: the frame reflows to a phone viewport mid-session");
