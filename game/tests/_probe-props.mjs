/** throwaway: render every SDK prop at station-ish scale so a human can judge them. */
import { mkdir, writeFile } from "node:fs/promises";
import { renderProp, PROP_TYPES } from "@rarefriends/friendsdk/world";
import { chromium } from "playwright";

const CELL = 96;
const cells = PROP_TYPES.map(type => `
  <figure><div class="box">${renderProp(type).replace(/width="240" height="240"/, `width="${CELL}" height="${CELL}"`)}</div><figcaption>${type}</figcaption></figure>`).join("");
const html = `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; background: #8d99aa; font: 12px system-ui; }
  main { display: grid; grid-template-columns: repeat(6, ${CELL}px); gap: 8px; padding: 12px; }
  figure { margin: 0; text-align: center; }
  .box { width: ${CELL}px; height: ${CELL}px; background: #6c7787; border: 1px solid #1b2230; }
  figcaption { color: #10141c; }
</style><main>${cells}</main>`;

await mkdir("./artifacts", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 6 * (CELL + 10) + 20, height: 3 * (CELL + 30) + 30 } });
await page.setContent(html);
await page.screenshot({ path: "./artifacts/_probe-props.png" });
await writeFile("./tmp-prop-sheet.html", html);
await browser.close();
console.log("wrote ./artifacts/_probe-props.png");
