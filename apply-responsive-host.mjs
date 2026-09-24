/**
 * The SDK's host page caps the game frame at 960px through a CSS variable
 * (`--rf-game-max-width`, used by both runtime.css and layout.css). This re-applies
 * the full-screen override to a freshly built page, which otherwise ships with the
 * 960px ceiling and letterboxes the game on any large display.
 *
 *   node apply-responsive-host.mjs docs/index.html
 *
 * Idempotent: safe to run after every `friendsdk build`.
 */
import { readFileSync, writeFileSync } from "node:fs";

const path = process.argv[2] ?? "docs/index.html";
const marker = "--rf-game-max-width";
// 3:2 means the width may be at most 1.5x the viewport height; the 12px keeps a
// scrollbar from forming, so this takes whichever dimension actually binds.
const style = "<style>:root{--rf-game-max-width:min(100vw,calc(150vh - 12px))}</style>";

const html = readFileSync(path, "utf8");
if (html.includes(marker)) {
  console.log(`${path}: responsive override already present`);
} else {
  const patched = html.replace("</head>", `${style}</head>`);
  if (patched === html) throw new Error(`${path}: no </head> to insert the override before`);
  writeFileSync(path, patched);
  console.log(`${path}: full-screen frame override applied`);
}
