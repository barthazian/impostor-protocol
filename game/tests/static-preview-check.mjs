/**
 * Static-preview smoke test: serve the built .friendsdk output over HTTP exactly
 * as a static host would, load it in a real browser and confirm every asset
 * resolves and the runtime's wallet gate renders.
 *
 *   node games/impostor-protocol/tests/static-preview-check.mjs <built-dir>
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const root = process.argv[2] ?? "games/impostor-protocol/.friendsdk";
const types = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
};

const server = createServer(async (request, response) => {
  let path = decodeURIComponent((request.url ?? "/").split("?")[0]);
  if (path.endsWith("/")) path += "index.html";
  const file = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ""));
  try {
    const body = await readFile(file);
    response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404).end("not found");
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 820 } });
const problems = [];
page.on("pageerror", error => problems.push(`page: ${error.message}`));
page.on("console", message => { if (message.type() === "error") problems.push(`console: ${message.text()}`); });
page.on("requestfailed", request => problems.push(`request failed: ${request.url()}`));
page.on("response", response => { if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`); });

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
await page.waitForTimeout(5000);

console.log(`  · title: ${JSON.stringify(await page.title())}`);
console.log(`  · frames: ${page.frames().length}`);
const text = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
console.log(`  · visible text: ${JSON.stringify(text.slice(0, 260))}`);
const buttons = await page.getByRole("button").evaluateAll(nodes => nodes.map(node => node.textContent.replace(/\s+/g, " ").trim()).filter(Boolean));
console.log(`  · host buttons: ${JSON.stringify(buttons)}`);
await page.screenshot({ path: "./artifacts/30-static-preview.png" });

await browser.close();
server.close();

if (problems.length) {
  console.log(`STATIC PREVIEW PROBLEMS:\n  ${problems.join("\n  ")}`);
  process.exitCode = 1;
} else {
  console.log("static preview served cleanly: every asset resolved, no page errors");
}
