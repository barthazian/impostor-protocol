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
const marker = "responsive-host";
// 3:2 means the width may be at most 1.5x the viewport height; 3:4 is 0.75x. The 12px
// keeps a scrollbar from forming, so this takes whichever dimension actually binds.
// Phones get a portrait frame, because a 3:2 game in a 390x844 viewport wastes most of
// the screen. The renderer sizes the world to the frame box, so nothing letterboxes.
const styles = [
  ":root{--rf-game-max-width:min(100vw,calc(150vh - 12px))}",
  "@media (max-width:620px){:root{--rf-game-aspect-ratio:3 / 4;--rf-game-max-width:min(100vw,calc(75vh - 12px))}}",
];
const block = `<style>/* ${marker} */\n${styles.join("\n")}\n</style>`;

const html = readFileSync(path, "utf8");
// Replace an earlier block this script inserted, so re-running keeps it current.
const previous = new RegExp(`<style>/\\* ${marker} \\*/[\\s\\S]*?</style>`, "u");
const cleaned = html.replace(previous, "");
const patched = cleaned.replace("</head>", `${block}</head>`);
if (patched === html) {
  console.log(`${path}: responsive override already current`);
} else {
  if (patched === cleaned && cleaned.includes("</head>") === false) {
    throw new Error(`${path}: no </head> to insert the override before`);
  }
  writeFileSync(path, patched);
  console.log(`${path}: responsive override applied (desktop fills the screen, phones get a portrait frame)`);
}
