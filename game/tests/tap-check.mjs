/**
 * Tap accuracy: does a click land on the world point under the finger?
 *
 * The renderer publishes the player's world position on canvas.dataset.x/y and the
 * camera on dataset.cameraX/cameraY, so the world point a tap should mean is
 * camera + the click's offset inside the canvas box — with no scale factor, because
 * the view IS the canvas box at one world unit per CSS pixel. The old fixed
 * 960x640 store would have mapped the same click to a point ~2.5x further out, so
 * both candidates are measured and only the 1:1 one may win.
 *
 *   node games/impostor-protocol/tests/tap-check.mjs
 */
import { mkdir } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";

await mkdir("./artifacts", { recursive: true });

const VIEWPORTS = [
  { tag: "desktop", width: 1440, height: 900 },
  { tag: "phone", width: 390, height: 844 },
];

for (const viewport of VIEWPORTS) {
  await testGame("./games/impostor-protocol", {
    width: viewport.width, height: viewport.height, timeout: 90_000,
    screenshot: `./artifacts/60-tap-${viewport.tag}.png`,
    check: async ({ page, game }) => {
      await game.locator("section.ip-root").first().waitFor({ timeout: 25000 });
      await game.getByRole("button", { name: /start practice round/i }).first().click();
      await page.waitForTimeout(1400);
      const begin = game.getByRole("button", { name: /begin/i }).first();
      if (await begin.count()) await begin.click();
      await page.waitForTimeout(1700);

      const canvas = game.locator("canvas.ip-canvas").first();
      const read = () => canvas.evaluate(node => {
        const box = node.getBoundingClientRect();
        return {
          bitmap: { w: node.width, h: node.height },
          css: { w: box.width, h: box.height },
          x: Number(node.dataset.x), y: Number(node.dataset.y),
          cameraX: Number(node.dataset.cameraX), cameraY: Number(node.dataset.cameraY),
        };
      });

      const before = await read();
      const onScreenX = before.x - before.cameraX, onScreenY = before.y - before.cameraY;
      // A point clearly to one side of the player, in CSS pixels inside the box.
      const reach = Math.max(40, Math.min(120, before.css.w / 2 - 24));
      const side = onScreenX + reach <= before.css.w - 12 ? 1 : -1;
      const clickX = onScreenX + side * reach;
      const clickY = onScreenY;
      const expected = { x: before.cameraX + clickX, y: before.cameraY + clickY };
      // The wrong answer this check exists to rule out: a 960x640 view scaled into
      // the canvas, which maps the same click far past the point under the finger.
      const scaled = { x: before.cameraX + clickX * (960 / before.css.w), y: before.cameraY + clickY * (640 / before.css.h) };

      console.log(`  · ${viewport.tag} ${viewport.width}x${viewport.height}: canvas css ${before.css.w.toFixed(1)}x${before.css.h.toFixed(1)} · bitmap ${before.bitmap.w}x${before.bitmap.h} · world units per css px ${(before.css.w / before.bitmap.w).toFixed(3)}`);
      console.log(`      player before (${before.x.toFixed(2)}, ${before.y.toFixed(2)}) · camera (${before.cameraX}, ${before.cameraY}) · player on screen (${onScreenX.toFixed(1)}, ${onScreenY.toFixed(1)})`);
      console.log(`      tap at css (${clickX.toFixed(1)}, ${clickY.toFixed(1)}) → 1:1 world (${expected.x.toFixed(1)}, ${expected.y.toFixed(1)}) · if scaled (${scaled.x.toFixed(1)}, ${scaled.y.toFixed(1)})`);

      await canvas.click({ position: { x: clickX, y: clickY } });
      await page.waitForTimeout(2200);
      const after = await read();
      const walked = { x: after.x - before.x, y: after.y - before.y };
      const error = Math.hypot(after.x - expected.x, after.y - expected.y);
      const scaledError = Math.hypot(after.x - scaled.x, after.y - scaled.y);
      console.log(`      player after (${after.x.toFixed(2)}, ${after.y.toFixed(2)}) · walked (${walked.x.toFixed(2)}, ${walked.y.toFixed(2)})`);
      console.log(`      distance to the 1:1 tap point ${error.toFixed(2)} world units · to the scaled point ${scaledError.toFixed(2)}`);
      await page.screenshot({ path: `./artifacts/61-tap-${viewport.tag}.png` });

      // The walk stops 6 units short of the destination, so 10 leaves room for one
      // frame of overshoot; a scaled mapping would miss by hundreds of units.
      if (walked.x * side < 40) throw new Error(`${viewport.tag}: the player did not walk toward the tap — walked (${walked.x.toFixed(2)}, ${walked.y.toFixed(2)}) for a tap ${side > 0 ? "right" : "left"} of them.`);
      if (error > 10) throw new Error(`${viewport.tag}: the tap landed ${error.toFixed(2)} world units from the point under the finger (a scaled view would land ${scaledError.toFixed(2)} away).`);
      if (scaledError < error) throw new Error(`${viewport.tag}: the scaled mapping fits better than 1:1 — the view is not one world unit per CSS pixel.`);
    },
  });
}

console.log("taps land on the world point under the finger at both frame sizes");
