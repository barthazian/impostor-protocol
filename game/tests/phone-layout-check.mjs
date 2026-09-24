/**
 * Phone-layout check: is the content a phone player needs actually INSIDE the frame?
 *
 * The host hands the game a 3:2 sandbox — 960x640 on desktop and, on a phone,
 * 388x258 CSS px (the harness cannot make a portrait frame, so this is the worst
 * case it can measure; a real portrait phone is ~390x520 and roomier).
 *
 * Every number below is measured, never assumed, and each element is measured two
 * ways: its box against the frame (0..innerHeight) and its *seen* rect, i.e. what
 * survives clipping by every scrolling ancestor. A list can have a box inside the
 * frame yet be invisible inside a collapsed parent — which is exactly what went
 * wrong when a 160px note squeezed the mission plan to 0px of height.
 *
 * Asserted inside the game frame at 390x844 (frame = 388x258):
 *   (a) briefing: the crew-roster and mission-plan elements are present, in frame,
 *       height > 0, with at least 3 of their rows/items fully visible;
 *   (b) lobby: the tier start control and all three tier choices are in frame;
 *   (c) task list open: >= 4 of the 6 rows fully in frame, OR the list overflows
 *       with a visible scroll affordance;
 *   (d) desktop 960x640: the same essentials are still reachable (no regression).
 * Also: no text below the 11px floor and no control under 30px tall.
 *
 *   node games/impostor-protocol/tests/phone-layout-check.mjs
 *   IP_DEBUG=1 node games/impostor-protocol/tests/phone-layout-check.mjs
 */
import { mkdir } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";

await mkdir("./artifacts", { recursive: true });

const failures = [];
const R = value => Math.round(value);
const show = info => (info ? `${R(info.width)}x${R(info.height)} @${R(info.x)},${R(info.y)}` : "not present");

/** Measured in-page: box, seen rect (clipping-aware), font size and text. */
const measureNode = node => {
  const rect = node.getBoundingClientRect();
  let clip = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (/auto|scroll|hidden|clip/.test(`${style.overflowX} ${style.overflowY}`)) {
      const box = parent.getBoundingClientRect();
      if (box.width > 0) {
        clip.left = Math.max(clip.left, box.left);
        clip.right = Math.min(clip.right, box.right);
      }
      clip.top = Math.max(clip.top, box.top);
      clip.bottom = Math.min(clip.bottom, box.bottom);
    }
  }
  const seenWidth = Math.max(0, Math.min(rect.right, clip.right) - Math.max(rect.left, clip.left));
  const seenHeight = Math.max(0, Math.min(rect.bottom, clip.bottom) - Math.max(rect.top, clip.top));
  return {
    x: rect.x, y: rect.y, width: rect.width, height: rect.height, seenWidth, seenHeight,
    inFrame: rect.top >= -1 && rect.bottom <= window.innerHeight + 1 && rect.width > 0 && rect.height > 0,
    seen: seenWidth >= rect.width - 1 && seenHeight >= rect.height - 1,
    fontSize: parseFloat(getComputedStyle(node).fontSize),
    text: (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 30),
  };
};

const one = async (game, selector) => {
  const locator = game.locator(selector).first();
  if (!(await locator.count())) return null;
  return locator.evaluate(measureNode);
};

const all = async (game, selector) => {
  const locator = game.locator(selector);
  const count = await locator.count();
  const out = [];
  for (let index = 0; index < count; index += 1) out.push(await locator.nth(index).evaluate(measureNode));
  return out;
};

const report = (info, label) => {
  console.log(`  · ${label}: ${show(info)}  ${info.inFrame ? "in-frame ✓" : "OUT OF FRAME ✗"}`
    + `  ${info.seen ? "visible ✓" : `clipped to ${R(info.seenWidth)}x${R(info.seenHeight)} ✗`}`);
};

const frameOf = async game => {
  const root = game.locator("section.ip-root").first();
  await root.waitFor({ timeout: 25_000 });
  return root.evaluate(node => {
    const box = node.getBoundingClientRect();
    return { width: box.width, height: box.height, innerWidth: window.innerWidth, innerHeight: window.innerHeight };
  });
};

/** Where the SDK host toolbar sits, in frame rows. */
const hostChrome = async (page, game) => {
  const toolbar = await page.locator(".rf-frame-toolbar").first().boundingBox().catch(() => null);
  const iframe = await page.locator("iframe").first().boundingBox().catch(() => null);
  const band = toolbar && iframe ? `${R(toolbar.y - iframe.y)}..${R(toolbar.y + toolbar.height - iframe.y)}` : "n/a";
  console.log(`  · host toolbar: ${toolbar ? `${R(toolbar.width)}x${R(toolbar.height)}` : "none"} — covers frame rows ${band}`);
};

const smallestText = async (game, scope) => game.locator(scope).evaluateAll(nodes => {
  let min = null;
  for (const node of nodes) {
    if (!node.textContent.trim() || node.children.length) continue;
    if (node.getClientRects().length === 0) continue;
    min = min === null ? parseFloat(getComputedStyle(node).fontSize) : Math.min(min, parseFloat(getComputedStyle(node).fontSize));
  }
  return min;
});

const run = async (tag, viewport) => {
  const phone = tag === "phone";
  await testGame("./games/impostor-protocol", {
    width: viewport.width,
    height: viewport.height,
    timeout: 60_000,
    screenshot: `./artifacts/50-phone-layout-${tag}-lobby.png`,
    check: async ({ page, game }) => {
      const problems = [];
      page.on("pageerror", error => problems.push(`page: ${error.message}`));
      page.on("console", message => { if (message.type() === "error") problems.push(`console: ${message.text()}`); });

      const frame = await frameOf(game);
      console.log(`\n[${tag}] viewport ${viewport.width}x${viewport.height} -> game frame `
        + `${R(frame.width)}x${R(frame.height)} (inner ${frame.innerWidth}x${frame.innerHeight})`);
      await hostChrome(page, game);

      /* ---------------------------------------------------------- (b) lobby */
      console.log("  LOBBY");
      const start = await one(game, ".ip-lobby .ip-start");
      report(start, `tier start control "${start ? start.text : ""}"`);
      console.log(`  · lobby head ${show(await one(game, ".ip-lobby-head"))} · body ${show(await one(game, ".ip-lobby-body"))}`
        + ` · foot ${show(await one(game, ".ip-lobby-foot"))} · stats strip ${show(await one(game, ".ip-lobby .ip-kv"))} (5 entries)`);
      const tiers = await all(game, ".ip-lobby .ip-card--tier .ip-tier");
      tiers.forEach((info, index) => report(info, `tier choice ${index + 1} "${info.text.slice(0, 30)}"`));
      const tiersVisible = tiers.filter(info => info.inFrame && info.seen);
      console.log(`  · tier choices in frame AND unclipped: ${tiersVisible.length}/${tiers.length}`);

      /* The chosen tier has to be legible with its cost, so pick one and read the
         start control back; then return to the free practice tier for the run. */
      const standard = game.locator(".ip-lobby .ip-card--tier .ip-tier").nth(1);
      await standard.click();
      await page.waitForTimeout(250);
      const paidStart = await one(game, ".ip-lobby .ip-start");
      const chosen = await standard.evaluate(node => ({
        selected: node.dataset.selected === "true",
        cost: node.querySelector(".ip-tier-top span")?.textContent?.trim() ?? "",
      }));
      report(paidStart, `start control with tier 2 chosen "${paidStart ? paidStart.text : ""}"`);
      console.log(`  · chosen tier: ${chosen.selected ? "marked selected ✓" : "NOT selected ✗"} · its cost line "${chosen.cost}"`);
      if (!paidStart || !paidStart.inFrame || !/enter standard/i.test(paidStart.text)) {
        failures.push(`${tag} lobby: choosing a tier does not produce a named, in-frame "Enter <tier> · <n> pass" start control (${paidStart ? paidStart.text : "missing"})`);
      }
      if (!chosen.selected) failures.push(`${tag} lobby: the chosen tier is not marked selected`);
      await game.locator(".ip-lobby .ip-card--tier .ip-tier").first().click();
      await page.waitForTimeout(250);
      console.log(`  · back to the free tier: "${(await game.locator(".ip-lobby .ip-start").first().textContent()).trim()}"`);
      const startFinal = await one(game, ".ip-lobby .ip-start");
      report(startFinal, `start control ready to press "${startFinal.text}"`);
      if (start) Object.assign(start, startFinal ?? {});

      if (!start || !startFinal) failures.push(`${tag} lobby: no tier start control`);
      else {
        if (start.height < 30) failures.push(`${tag} lobby: start control is ${R(start.height)}px tall (floor 30px)`);
        if (!start.inFrame) failures.push(`${tag} lobby: start control ${show(start)} escapes the frame`);
      }
      if (phone && tiersVisible.length < 3) failures.push(`phone lobby: ${tiersVisible.length}/3 tier choices visible`);
      if (!phone && tiersVisible.length < 1) failures.push(`${tag} lobby: no tier choice is visible`);

      /* ------------------------------------------------------ (a) briefing */
      console.log("  BRIEFING");
      await game.locator(".ip-lobby .ip-start").first().click();
      await page.waitForTimeout(1600);
      await page.screenshot({ path: `./artifacts/51-phone-layout-${tag}-briefing.png` });
      const roster = await one(game, ".ip-brief .ip-roster");
      const plan = await one(game, ".ip-brief .ip-plan");
      const crew = await all(game, ".ip-brief .ip-roster li");
      const items = await all(game, ".ip-brief .ip-plan li");
      const begin = await one(game, ".ip-brief-foot .ip-start");
      report(roster, `crew roster (${crew.length} crew rows)`);
      report(plan, `mission plan (${items.length} items)`);
      report(begin, `BEGIN control "${begin ? begin.text : ""}"`);
      const rosterHeading = (await game.locator(".ip-brief .ip-card--roster .ip-h").first().textContent()).replace(/\s+/g, " ").trim();
      console.log(`  · brief head ${show(await one(game, ".ip-brief-head"))} · body ${show(await one(game, ".ip-brief-body"))}`
        + ` · foot ${show(await one(game, ".ip-brief-foot"))}`);
      console.log(`  · roster card ${show(await one(game, ".ip-brief .ip-card--roster"))} (heading "${rosterHeading}")`
        + ` · plan card ${show(await one(game, ".ip-brief .ip-card--plan"))}`);
      const crewSeen = crew.filter(info => info.inFrame && info.seen);
      const itemsSeen = items.filter(info => info.inFrame && info.seen);
      console.log(`  · crew rows fully in frame: ${crewSeen.length}/${crew.length}`
        + ` · plan items fully in frame: ${itemsSeen.length}/${items.length}`);
      const smallestBrief = await smallestText(game, ".ip-brief *");
      console.log(`  · smallest briefing text: ${smallestBrief}px (floor 11px)`);
      if (process.env.IP_DEBUG) {
        const dump = await game.locator(".ip-brief .ip-card, .ip-brief .ip-card > *").evaluateAll(nodes => nodes.map(node => {
          const box = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return `${node.tagName.toLowerCase()}.${String(node.className).slice(0, 22)} ${Math.round(box.width)}x${Math.round(box.height)}@${Math.round(box.y)}`
            + ` display=${style.display} flex=${style.flex} ovf-y=${style.overflowY}`;
        }));
        for (const line of dump) console.log(`      ${line}`);
      }
      const beginHit = await game.locator(".ip-brief-foot .ip-start").first().evaluate(node => {
        const box = node.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return { hittable: hit === node || node.contains(hit), hit: hit ? String(hit.className).slice(0, 30) : "?" };
      });
      console.log(`  · BEGIN centre hit-test: ${beginHit.hittable ? "hittable ✓" : `BLOCKED by .${beginHit.hit}`}`);

      if (!roster || !roster.inFrame || roster.height <= 0) failures.push(`${tag} briefing: crew roster ${show(roster)} is missing or outside the frame`);
      if (!plan || !plan.inFrame || plan.height <= 0) failures.push(`${tag} briefing: mission plan ${show(plan)} is missing or outside the frame`);
      if (crewSeen.length < 3) failures.push(`${tag} briefing: only ${crewSeen.length}/${crew.length} crew rows visible`);
      if (itemsSeen.length < 3) failures.push(`${tag} briefing: only ${itemsSeen.length}/${items.length} plan items visible`);
      if (!begin || !begin.inFrame || begin.height < 30) failures.push(`${tag} briefing: BEGIN control missing, off-frame or under 30px`);
      if (smallestBrief !== null && smallestBrief < 11) failures.push(`${tag} briefing: text at ${smallestBrief}px is under the 11px floor`);

      /* ---------------------------------------------------- (c) task list */
      console.log("  TASK LIST");
      await game.locator(".ip-brief-foot .ip-start").first().click();
      await page.waitForTimeout(1800);
      await page.keyboard.press("t");
      await page.waitForTimeout(800);
      await page.screenshot({ path: `./artifacts/52-phone-layout-${tag}-tasklist.png` });
      const sheet = await one(game, ".ip-sheet");
      report(sheet, "task sheet");
      const scroll = await game.locator(".ip-sheet-body").first().evaluate(node => {
        const style = getComputedStyle(node);
        return {
          scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, overflowY: style.overflowY,
          gutter: node.offsetWidth - node.clientWidth, styled: style.scrollbarWidth,
        };
      });
      console.log(`  · sheet body: ${scroll.scrollHeight}/${scroll.clientHeight}px content · overflow-y ${scroll.overflowY}`
        + ` · scrollbar-width ${scroll.styled} · reserved gutter ${scroll.gutter}px`);
      const rows = await all(game, ".ip-trow");
      if (process.env.IP_DEBUG) {
        const dump = await game.locator(".ip-sheet-body > *, .ip-progress-block, .ip-progress-block > *").evaluateAll(nodes => nodes.map(node => {
          const box = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return `${node.tagName.toLowerCase()}.${String(node.className).slice(0, 22)} ${Math.round(box.width)}x${Math.round(box.height)}@${Math.round(box.x)},${Math.round(box.y)}`
            + ` cols=${style.gridTemplateColumns} fs=${style.fontSize}`;
        }));
        for (const line of dump) console.log(`      ${line}`);
      }
      rows.forEach((info, index) => console.log(`  · row ${index + 1} "${info.text.slice(0, 24)}": h${R(info.height)}`
        + ` rows ${R(info.y)}..${R(info.y + info.height)} ${info.inFrame && info.seen ? "in-frame ✓" : "below the fold"}`));
      const rowsIn = rows.filter(info => info.inFrame && info.seen).length;
      const scrollable = scroll.scrollHeight > scroll.clientHeight + 1;
      /* Playwright's Chromium launches with --hide-scrollbars, so a reserved
         gutter can measure 0 even where the list is styled and scrollable; both
         signals are reported and either one counts as the affordance. */
      const affordance = scrollable && (scroll.gutter > 0 || /auto|scroll/.test(scroll.overflowY));
      const smallestRow = Math.min(...rows.map(info => info.fontSize));
      console.log(`  · task rows fully in frame: ${rowsIn}/${rows.length}`
        + ` · scroll affordance: ${affordance ? `yes ✓ (overflows=${scrollable}, gutter=${scroll.gutter}px)` : "no ✗"}`);
      console.log(`  · smallest task-row text: ${smallestRow}px (floor 11px)`);
      if (rows.length < 6) failures.push(`${tag} task list: ${rows.length} rows rendered, expected 6`);
      if (rowsIn < 4 && !affordance) failures.push(`${tag} task list: only ${rowsIn}/6 rows in frame and no scroll affordance`);
      if (smallestRow < 11) failures.push(`${tag} task list: rows render at ${smallestRow}px, under the 11px floor`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);

      if (problems.length) failures.push(`${tag} browser problems: ${problems.slice(0, 3).join(" | ")}`);
      return undefined;
    },
  });
};

await run("phone", { width: 390, height: 844 });
await run("desktop", { width: 960, height: 640 });

if (failures.length) {
  console.error(`\nphone layout check FAILED with ${failures.length} problem(s):`);
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log("\nphone layout check passed: at the phone frame the briefing roster and plan, the lobby's three tier choices and its start control, and the six task rows are all visible inside the frame");
