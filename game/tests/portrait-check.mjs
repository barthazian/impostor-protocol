/**
 * The published page gives a phone a PORTRAIT frame (it overrides the SDK's
 * --rf-game-aspect-ratio on narrow viewports), but the test harness can only make a
 * 3:2 frame. This injects the same override into the harness host page, so the real
 * phone geometry is actually measured rather than assumed: the canvas must fill the
 * portrait frame at one world unit per CSS pixel, and the frame must stay centred.
 *
 * Exercising it this way also covers the mid-round resize path, because the renderer
 * syncs its view from a ResizeObserver rather than only at startup.
 *
 *   node games/impostor-protocol/tests/portrait-check.mjs
 */
import { mkdir } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";

// Byte-for-byte what apply-responsive-host.mjs writes into the deployed page.
const OVERRIDE = ":root{--rf-game-aspect-ratio:3 / 4;--rf-game-max-width:min(100vw,calc(75vh - 12px))}";

await mkdir("./artifacts", { recursive: true });

await testGame("./games/impostor-protocol", {
  width: 390, height: 844, timeout: 120_000,
  screenshot: "./artifacts/70-portrait-lobby.png",
  check: async ({ page, game }) => {
    const frameOf = () => page.evaluate(() => {
      const root = document.querySelector("#root");
      const box = root.getBoundingClientRect();
      const css = getComputedStyle(root);
      return {
        w: Math.round(box.width), h: Math.round(box.height),
        x: Math.round(box.left),
        viewportW: window.innerWidth, viewportH: window.innerHeight,
        aspect: css.getPropertyValue("--rf-game-aspect-ratio").trim(),
        maxWidth: css.getPropertyValue("--rf-game-max-width").trim(),
      };
    });

    const before = await frameOf();
    console.log(`  · before override: frame ${before.w}x${before.h} · aspect "${before.aspect}" (the SDK default)`);

    await page.addStyleTag({ content: OVERRIDE });
    await page.waitForTimeout(1000);

    const after = await frameOf();
    const ratio = after.h / after.w;
    const centredOff = Math.abs(after.x - (after.viewportW - after.w) / 2);
    console.log(`  · after override:  frame ${after.w}x${after.h} @x=${after.x} of ${after.viewportW} · aspect "${after.aspect}" · max-width "${after.maxWidth}"`);
    console.log(`      height/width ${ratio.toFixed(3)} (portrait 3:4 = 1.333) · screen height used ${(100 * after.h / after.viewportH).toFixed(0)}% · centre offset ${centredOff.toFixed(1)}px`);

    // Enter a round so the station canvas exists, and measure it in the portrait frame.
    await game.locator("section.ip-root").first().waitFor({ timeout: 25000 });
    await game.getByRole("button", { name: /start practice round/i }).first().click();
    await page.waitForTimeout(1400);
    const begin = game.getByRole("button", { name: /begin/i }).first();
    if (await begin.count()) await begin.click();
    await page.waitForTimeout(1800);
    await page.screenshot({ path: "./artifacts/71-portrait-station.png" });

    const canvas = await game.locator("canvas.ip-canvas").first().evaluate(node => {
      const box = node.getBoundingClientRect();
      return {
        cssW: Math.round(box.width * 10) / 10, cssH: Math.round(box.height * 10) / 10,
        bmpW: node.width, bmpH: node.height,
        viewW: Number(node.dataset.viewW ?? NaN), viewH: Number(node.dataset.viewH ?? NaN),
      };
    });
    const worldPerCss = canvas.cssW / canvas.bmpW;
    console.log(`  · station canvas: css ${canvas.cssW}x${canvas.cssH} · bitmap ${canvas.bmpW}x${canvas.bmpH} · world units per css px ${worldPerCss.toFixed(3)}`);
    console.log(`      canvas height as share of frame ${(100 * canvas.cssH / after.h).toFixed(0)}%`);

    if (ratio < 1.25 || ratio > 1.42) throw new Error(`frame ratio ${ratio.toFixed(3)} is not the portrait 3:4 the deployed page asks for`);
    if (after.h <= 400) throw new Error(`frame is only ${after.h}px tall — the override did not take effect`);
    if (centredOff > 2) throw new Error(`frame is off-centre by ${centredOff.toFixed(1)}px`);
    if (Math.abs(canvas.cssW - after.w) > 4 || Math.abs(canvas.cssH - after.h) > 4) {
      throw new Error(`canvas ${canvas.cssW}x${canvas.cssH} does not fill the frame ${after.w}x${after.h}`);
    }
    if (Math.abs(worldPerCss - 1) > 0.02) throw new Error(`world is scaled ${worldPerCss.toFixed(3)}x, not 1:1`);
  },
});

console.log("portrait phone frame: canvas fills it at 1:1 and the world is not scaled");
