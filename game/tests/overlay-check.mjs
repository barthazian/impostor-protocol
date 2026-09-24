/**
 * Overlay check: exercise the in-match overlays (task list, in-match menu, mute)
 * in the real runtime and report objective geometry, not just a picture.
 *
 *   node games/impostor-protocol/tests/overlay-check.mjs
 */
import { mkdir } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";

await mkdir("./artifacts", { recursive: true });

await testGame("./games/impostor-protocol", {
  width: 960,
  height: 800,
  timeout: 20_000,
  screenshot: "./artifacts/24-overlay-final.png",
  check: async ({ page, game }) => {
    const problems = [];
    page.on("pageerror", error => problems.push(`page: ${error.message}`));
    page.on("console", message => { if (message.type() === "error") problems.push(`console: ${message.text()}`); });

    const report = async label => {
      const sheet = game.locator(".ip-sheet").first();
      const box = (await sheet.count()) ? await sheet.boundingBox() : null;
      const zones = await game.locator(".ip-zone").count();
      const rows = await game.locator(".ip-trow").count();
      const firstRow = rows ? await game.locator(".ip-trow").first().boundingBox() : null;
      const scroll = (await sheet.count())
        ? await sheet.evaluate(node => ({ scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }))
        : null;
      const head = (await game.locator(".ip-sheet-head").first().count())
        ? await game.locator(".ip-sheet-head").first().boundingBox()
        : null;
      console.log(`  · ${label}`);
      console.log(`      sheet: ${box ? `${Math.round(box.width)}x${Math.round(box.height)} @ (${Math.round(box.x)}, ${Math.round(box.y)})` : "not rendered"}`);
      console.log(`      head: ${head ? `top ${Math.round(head.y)}` : "none"} · zones ${zones} · task rows ${rows}`);
      console.log(`      first row: ${firstRow ? `${Math.round(firstRow.width)}x${Math.round(firstRow.height)}` : "none"} · scroll ${scroll ? `${scroll.scrollHeight}/${scroll.clientHeight}` : "-"}`);
      const names = await game.locator(".ip-trow-name b").evaluateAll(nodes => nodes.map(node => node.textContent));
      const chips = await game.locator(".ip-trow .ip-chip").evaluateAll(nodes => nodes.map(node => node.textContent));
      console.log(`      rows: ${JSON.stringify(names)}`);
      console.log(`      chips: ${JSON.stringify(chips)}`);
      return { box, rows, zones, scroll, names };
    };

    await game.locator("section.ip-root").first().waitFor({ timeout: 25_000 });
    await game.getByRole("button", { name: /start/i }).first().click();
    await page.waitForTimeout(1200);
    await game.getByRole("button", { name: /begin/i }).first().click();
    await page.waitForTimeout(1600);
    await game.locator("canvas.ip-canvas").click({ position: { x: 480, y: 300 } });
    await page.waitForTimeout(300);

    // --- task list --------------------------------------------------------
    await page.keyboard.press("t");
    await page.waitForTimeout(700);
    await page.screenshot({ path: "./artifacts/20-tasklist.png" });
    const tasklist = await report("task list (T)");
    if (tasklist.rows < 1) throw new Error("The task list rendered no task rows.");
    if (!tasklist.box || tasklist.box.height < 120) throw new Error("The task list sheet has no usable height.");

    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    const closed = (await game.locator(".ip-sheet").count()) === 0;
    console.log(`  · Escape closed the task list: ${closed}`);
    if (!closed) throw new Error("Escape did not close the task list.");

    // --- mute -------------------------------------------------------------
    const soundButton = game.getByRole("button", { name: /sound|mute/i }).first();
    const before = (await soundButton.count()) ? (await soundButton.innerText()).trim() : "(no sound button)";
    await page.keyboard.press("m");
    await page.waitForTimeout(400);
    const after = (await soundButton.count()) ? (await soundButton.innerText()).trim() : "(no sound button)";
    console.log(`  · mute: ${JSON.stringify(before)} -> ${JSON.stringify(after)} (changed: ${before !== after})`);
    await page.keyboard.press("m");
    await page.waitForTimeout(300);
    const restored = (await soundButton.count()) ? (await soundButton.innerText()).trim() : "-";
    console.log(`  · mute restored: ${JSON.stringify(restored)}`);

    // --- in-match menu ----------------------------------------------------
    const menuButton = game.getByRole("button", { name: /^menu$/i }).first();
    if (await menuButton.count()) {
      await menuButton.click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: "./artifacts/21-menu.png" });
      await report("in-match menu");
      const modalOpen = (await game.locator(".ip-modal").count()) > 0;
      const title = modalOpen ? (await game.locator(".ip-modal h2").first().innerText()).trim() : "";
      const menuButtons = modalOpen
        ? await game.locator(".ip-modal button").evaluateAll(nodes => nodes.map(node => node.textContent.trim()))
        : [];
      console.log(`      menu modal open: ${modalOpen}, title ${JSON.stringify(title)}`);
      console.log(`      menu actions: ${JSON.stringify(menuButtons)}`);
      if (!modalOpen) throw new Error("The HUD Menu button did not open the in-match menu.");
      if (!menuButtons.some(name => /done|close|leave/i.test(name))) throw new Error(`The in-match menu has no exit control: ${JSON.stringify(menuButtons)}`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      let menuClosed = (await game.locator(".ip-modal").count()) === 0;
      if (!menuClosed) {
        await game.locator(".ip-modal button").filter({ hasText: /done|close/i }).first().click();
        await page.waitForTimeout(500);
        menuClosed = (await game.locator(".ip-modal").count()) === 0;
      }
      console.log(`  · the in-match menu closed: ${menuClosed}`);
      if (!menuClosed) throw new Error("The in-match menu could not be closed.");
    } else {
      console.log("  · no Menu button found in the HUD");
    }

    // --- reduced motion ---------------------------------------------------
    const reduced = await game.locator("section.ip-root").first().evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
    console.log(`  · reduced-motion media query: ${reduced}`);

    if (problems.length) throw new Error(`Browser problems:\n${problems.join("\n")}`);
  },
});

console.log("overlay check passed");
