/**
 * Are every window's exit controls actually reachable by a payer?
 *
 * Two independent failure modes are measured, because both were real:
 *   1. OFF-SCREEN — an auto-height scrim let the Locker grow past the frame, so its
 *      × measured y=-95 and Close y=694 inside a 640px viewport.
 *   2. INTERCEPTED — the SDK's host toolbar (.rf-frame-toolbar, "Local preview")
 *      is painted over the game area and swallows clicks on anything beneath it.
 *
 * Reports geometry for both sizes and clicks each exit for real.
 */
import { mkdir } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";

await mkdir("./artifacts", { recursive: true });

const VIEWPORTS = [
  { tag: "desktop", width: 960, height: 800 },
  { tag: "phone", width: 390, height: 844 },
];

const attempt = async (label, action) => {
  try {
    await action();
    console.log(`    ${label}: OK`);
    return null;
  } catch (error) {
    const line = String(error.message).split("\n").find(text => /intercepts pointer events|not visible|outside of the viewport|Timeout/.test(text)) ?? String(error.message).slice(0, 120);
    console.log(`    ${label}: BLOCKED — ${line.trim()}`);
    return `${label}: ${line.trim()}`;
  }
};

for (const viewport of VIEWPORTS) {
  await testGame("./games/impostor-protocol", {
    width: viewport.width, height: viewport.height, timeout: 90000,
    screenshot: `./artifacts/33-exits-${viewport.tag}.png`,
    check: async ({ page, game }) => {
      const blocked = [];

      // Where does the host chrome sit relative to the game frame?
      const frame = await page.locator("iframe").first().boundingBox();
      const toolbar = await page.locator(".rf-frame-toolbar").first().boundingBox().catch(() => null);
      console.log(`  · ${viewport.tag}: iframe ${frame ? `${Math.round(frame.width)}x${Math.round(frame.height)} @${Math.round(frame.x)},${Math.round(frame.y)}` : "?"}`
        + ` · host toolbar ${toolbar ? `${Math.round(toolbar.width)}x${Math.round(toolbar.height)} @${Math.round(toolbar.x)},${Math.round(toolbar.y)}` : "none"}`);

      await game.locator("section.ip-root").first().waitFor();
      await game.getByRole("button", { name: /^Locker$/ }).first().click();
      await page.waitForTimeout(600);

      const exits = await game.locator(".ip-modal button").evaluateAll(nodes => {
        const view = { w: window.innerWidth, h: window.innerHeight };
        return nodes.map(node => {
          const box = node.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          const inside = box.top >= -1 && box.left >= -1 && box.bottom <= view.h + 1 && box.right <= view.w + 1;
          return {
            label: (node.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 18),
            at: `${Math.round(box.x)},${Math.round(box.y)}`,
            size: `${Math.round(box.width)}x${Math.round(box.height)}`,
            onScreen: inside && box.width > 0 && box.height > 0,
            clickable: hit === node || node.contains(hit),
            frame: `${view.w}x${view.h}`,
          };
        }).filter(row => /close|done|×|dismiss/i.test(row.label));
      });
      console.log(`  · ${viewport.tag} frame ${exits[0]?.frame} exits: ${JSON.stringify(exits)}`);
      for (const row of exits) {
        if (!row.onScreen) blocked.push(`${row.label} off-screen at ${row.at}`);
        else if (!row.clickable) blocked.push(`${row.label} not hittable at ${row.at}`);
      }

      const close = game.locator(".ip-modal button", { hasText: /^Close$/ }).first();
      if (await close.count()) {
        const failure = await attempt(`${viewport.tag} footer Close`, () => close.click({ timeout: 2500 }));
        if (failure) blocked.push(failure);
        else {
          await page.waitForTimeout(400);
          if (await game.locator(".ip-modal").count()) blocked.push(`${viewport.tag} Close clicked but window stayed open`);
        }
      } else {
        blocked.push(`${viewport.tag}: no footer Close rendered`);
      }

      // Settings shares the shell, so its Done control must be reachable too.
      if (!(await game.locator(".ip-modal").count())) {
        const failure = await attempt(`${viewport.tag} Settings open`, () => game.getByRole("button", { name: /^Settings$/ }).first().click({ timeout: 2500 }));
        if (failure) blocked.push(failure);
        else {
          await page.waitForTimeout(450);
          const done = game.locator(".ip-modal button", { hasText: /^(Done|Close)$/ }).first();
          if (await done.count()) {
            const doneFailure = await attempt(`${viewport.tag} Settings Done`, () => done.click({ timeout: 2500 }));
            if (doneFailure) blocked.push(doneFailure);
          } else blocked.push(`${viewport.tag}: Settings renders no Done control`);
        }
      }

      // Escape is the universal fallback and must always work.
      if (await game.locator(".ip-modal").count()) {
        await game.locator(".ip-modal").press("Escape");
        await page.waitForTimeout(350);
      }
      await game.getByRole("button", { name: /^Locker$/ }).first().click();
      await page.waitForTimeout(450);
      const escFailure = await attempt(`${viewport.tag} Escape`, async () => {
        await game.locator(".ip-modal").press("Escape");
        await page.waitForTimeout(350);
        if (await game.locator(".ip-modal").count()) throw new Error("window still open after Escape");
      });
      if (escFailure) blocked.push(escFailure);

      if (blocked.length) throw new Error(`${viewport.tag} unreachable exits:\n    ${blocked.join("\n    ")}`);
    },
  });
}

console.log("all window exits are on-screen, hittable and clickable at both frame sizes");
