/**
 * Where does the task row's absolute positioning come from?
 *
 *   node games/impostor-protocol/tests/dump-tasklist.mjs
 */
import { testGame } from "@rarefriends/friendsdk/testing";

await testGame("./games/impostor-protocol", {
  width: 960,
  height: 800,
  timeout: 20_000,
  screenshot: "./artifacts/dump-tasklist.png",
  check: async ({ page, game }) => {
    await game.locator("section.ip-root").first().waitFor({ timeout: 25_000 });
    await game.getByRole("button", { name: /start/i }).first().click();
    await page.waitForTimeout(1200);
    await game.getByRole("button", { name: /begin/i }).first().click();
    await page.waitForTimeout(1600);
    await game.locator("canvas.ip-canvas").click({ position: { x: 480, y: 300 } });
    await page.waitForTimeout(300);
    await page.keyboard.press("t");
    await page.waitForTimeout(700);

    const result = await game.locator("div.ip-sheet").first().evaluate(sheet => {
      const row = sheet.querySelector(".ip-trow");
      const report = { inlineStyle: row.getAttribute("style"), dataAttrs: { ...row.dataset } };

      // Every stylesheet the engine will admit to, including constructed ones.
      const sheets = [
        ...[...document.styleSheets].map(entry => ({ name: entry.href ?? "(inline <style>)", rules: (() => { try { return entry.cssRules; } catch { return null; } })() })),
        ...[...(document.adoptedStyleSheets ?? [])].map(entry => ({ name: "(adopted)", rules: entry.cssRules })),
      ];
      report.sheetNames = sheets.map(entry => `${entry.name}: ${entry.rules ? entry.rules.length : "unreadable"} rules`);
      report.styleTags = [...document.querySelectorAll("style")].map(node => `${node.textContent.length} chars, has ip-task: ${node.textContent.includes("ip-task")}, has position:absolute: ${node.textContent.includes("position: absolute")}`);
      report.links = [...document.querySelectorAll("link[rel=stylesheet]")].map(node => node.href);

      const hits = [];
      const walk = (list, origin) => {
        for (const rule of list ?? []) {
          if (rule.cssRules && !rule.selectorText) { walk(rule.cssRules, origin); continue; }
          if (!rule.selectorText) continue;
          let matches = false;
          try { matches = row.matches(rule.selectorText); } catch { continue; }
          if (!matches) continue;
          hits.push(`[${origin}] ${rule.selectorText} { ${rule.style.cssText.slice(0, 220)} }`);
        }
      };
      for (const entry of sheets) walk(entry.rules, entry.name);
      report.matchingRules = hits;

      // A freshly built row tells us whether a selector or the instance is styled.
      const clone = row.cloneNode(false);
      clone.setAttribute("data-probe", "1");
      row.parentElement.appendChild(clone);
      report.freshRowComputed = (({ position, display, gridTemplateColumns }) => ({ position, display, gridTemplateColumns }))(getComputedStyle(clone));
      const bare = document.createElement("li");
      row.parentElement.appendChild(bare);
      report.bareLiComputed = (({ position, display }) => ({ position, display }))(getComputedStyle(bare));
      return report;
    });
    console.log(JSON.stringify(result, null, 1));
  },
});
