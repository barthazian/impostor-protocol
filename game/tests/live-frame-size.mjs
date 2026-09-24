/**
 * How big does the game frame actually get on the REAL deployed page?
 * Loads the live site at several viewport sizes and reports the host frame and the
 * game iframe boxes, plus the fraction of the screen the game occupies. This is the
 * measurement that decides whether the site can be made to fill a desktop screen.
 */
import { chromium } from "playwright";

const url = process.argv[2];
if (!url) throw new Error("usage: node live-frame-size.mjs <url>");

const SIZES = [
  { tag: "desktop-1920", width: 1920, height: 1080 },
  { tag: "desktop-1440", width: 1440, height: 900 },
  { tag: "phone-390", width: 390, height: 844 },
];

const browser = await chromium.launch();
for (const size of SIZES) {
  const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
  const problems = [];
  page.on("pageerror", error => problems.push(error.message));
  await page.goto(url, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(4000);

  const boxes = await page.evaluate(() => {
    const box = el => {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { w: Math.round(rect.width), h: Math.round(rect.height), x: Math.round(rect.x), y: Math.round(rect.y) };
    };
    const frame = document.querySelector(".rf-game-frame") ?? document.querySelector("[class*=frame]");
    const iframe = document.querySelector("iframe");
    const frameStyle = frame ? getComputedStyle(frame) : null;
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      frame: box(frame),
      frameMaxWidth: frameStyle?.maxWidth ?? null,
      frameWidth: frameStyle?.width ?? null,
      frameAspect: frameStyle?.aspectRatio ?? null,
      iframe: box(iframe),
      bodyWidth: Math.round(document.body.getBoundingClientRect().width),
    };
  });

  const share = boxes.iframe ? Math.round((boxes.iframe.w / boxes.viewport.w) * 100) : 0;
  console.log(`  · ${size.tag}: viewport ${boxes.viewport.w}x${boxes.viewport.h}`);
  console.log(`      host frame ${boxes.frame ? `${boxes.frame.w}x${boxes.frame.h} @${boxes.frame.x},${boxes.frame.y}` : "n/a"} · css width ${boxes.frameWidth} max-width ${boxes.frameMaxWidth} aspect ${boxes.frameAspect}`);
  console.log(`      game iframe ${boxes.iframe ? `${boxes.iframe.w}x${boxes.iframe.h}` : "none"} · uses ${share}% of viewport width`);
  if (problems.length) console.log(`      page errors: ${problems.join(" | ")}`);
  await page.close();
}
await browser.close();
console.log("live frame-size sweep complete");
