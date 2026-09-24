/** Live deployment smoke test: load a public preview URL in a real browser. */
import { chromium } from "playwright";

const url = process.argv[2];
if (!url) throw new Error("usage: node live-preview-check.mjs <url>");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
const problems = [];
page.on("pageerror", e => problems.push(`page: ${e.message}`));
page.on("console", m => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
page.on("requestfailed", r => problems.push(`failed: ${r.url()} (${r.failure()?.errorText ?? "?"})`));

await page.goto(url, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(6000);
console.log("  · title:", await page.title());
console.log("  · frames:", page.frames().length);
console.log("  · text:", JSON.stringify((await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 240)));
const buttons = await page.getByRole("button").evaluateAll(ns => ns.map(n => n.textContent.trim()).filter(Boolean));
console.log("  · host buttons:", JSON.stringify(buttons.slice(0, 8)));
await page.screenshot({ path: "./artifacts/70-live-pages.png" });
await browser.close();
if (problems.length) { console.log("  · PROBLEMS:", problems.join(" | ")); process.exitCode = 1; }
else console.log("  · no page errors, no failed requests");
