/**
 * How does the game adapt — chrome and world? Boots the real runtime at several
 * screen sizes, measures the UI type/controls in the lobby, then enters a practice
 * round and measures the canvas (CSS size vs bitmap = the world scale factor), the
 * HUD and the interaction prompt.
 */
import { mkdir } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";

await mkdir("./artifacts", { recursive: true });

const SIZES = [
  { tag: "desktop", width: 1440, height: 900 },
  { tag: "phone", width: 390, height: 844 },
];

const measure = (root, selectors) => ({
  viewport: `${window.innerWidth}x${window.innerHeight}`,
  canvas: (() => {
    const canvas = root.querySelector("canvas.ip-canvas");
    if (!canvas) return "none";
    const box = canvas.getBoundingClientRect();
    return `css ${Math.round(box.width)}x${Math.round(box.height)} · bitmap ${canvas.width}x${canvas.height} · scale ${(box.width / canvas.width).toFixed(3)}`;
  })(),
  samples: selectors.map(selector => {
    const el = root.querySelector(selector);
    if (!el) return null;
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return `${selector.padEnd(14)} font ${style.fontSize.padEnd(7)} box ${Math.round(box.width)}x${Math.round(box.height)}`;
  }).filter(Boolean),
});

for (const size of SIZES) {
  await testGame("./games/impostor-protocol", {
    width: size.width, height: size.height, timeout: 90000,
    screenshot: `./artifacts/51-adapt-${size.tag}.png`,
    check: async ({ page, game }) => {
      await game.locator("section.ip-root").first().waitFor();
      const chrome = await game.locator("section.ip-root").first()
        .evaluate(measure, [".ip-title", ".ip-kv span", ".ip-btn", ".ip-note", ".ip-chip"]);
      console.log(`  · ${size.tag} ${size.width}x${size.height} lobby: ${chrome.viewport}`);
      for (const line of chrome.samples) console.log(`      ${line}`);

      // Enter a real round and measure the world the player actually sees.
      await game.getByRole("button", { name: /start practice round/i }).first().click();
      await page.waitForTimeout(1400);
      const station = await game.locator("section.ip-root").first()
        .evaluate(measure, [".ip-hud", ".ip-prompt", ".ip-toast", ".ip-tasklist"]);
      console.log(`      station canvas: ${station.canvas}`);
      for (const line of station.samples) console.log(`      ${line}`);
      await page.screenshot({ path: `./artifacts/52-station-${size.tag}.png` });
    },
  });
}

console.log("adaptation sweep complete");
