/**
 * Reveal strip check — the impostor artwork's visible home.
 *
 * The station can only wear the treated frame (hostile tint `#7c1220`, damaged
 * halo `#ff5f5f`) once the answer is public, and by then the debrief has replaced
 * the station — so the reveal used to happen off-screen. The strip fixes that:
 * one entry per actor on the post-round screen, each drawn from its canonical
 * on-chain frame, with the impostors the round named wearing the treated frame.
 *
 * Six claims, all measured in the real runtime:
 *
 *   1. ONE ENTRY PER ACTOR. Seven entries — the player and all six crewmates —
 *      with ids equal to the actors the sim reports, the player's entry present.
 *
 *   2. CANONICAL PIXELS. Every entry's 16 rows are byte-equal to the RECORDED
 *      chain frame 0 of the token the game names (`scripts/crew-pool.mjs`, the
 *      same recorded artwork `crew-art-check.mjs` re-verifies against the live
 *      registry) and its digest equals the checksum the game's own chain read
 *      publishes. The player's entry is grounded the same way when its token is in
 *      the pool, and otherwise against the frames the live canvas painted for the
 *      player during the round.
 *
 *   3. PAINTED AS DECLARED. For each entry the check decodes the entry's own
 *      canvas and asserts the pixel at the centre of all 256 canonical cells
 *      matches what the declared rows, tint, halo and halo rule require: mask
 *      cells carry the tint, a cell covered by a kept halo box carries the halo
 *      colour, everything else is transparent. Zero mismatches, per entry.
 *
 *   4. TREATED vs CLEAN, from the pixels. Treated entries carry the hostile tint
 *      and the hostile halo AND a halo that is genuinely damaged (ring cells the
 *      `haloKept(..., false)` rule drops are transparent), with no white pixel
 *      anywhere in the mask. Clean entries are the exact inverse: their own suit
 *      tint, an intact white halo, and not one hostile pixel in the whole canvas.
 *      The treated set is then compared with the reveal list the game itself
 *      publishes (`__ipImpostorProtocol.revealed()`) and with the actors holding
 *      the impostor role.
 *
 *   5. NO IN-PLAY TELL. On every live frame it samples — play, meetings,
 *      ejections — the strip's markup, its classes and its copy are ABSENT, and
 *      no element in the frame paints either hostile colour. The round is played
 *      as the impostor, so this also proves the game does not leak the player's
 *      own role to the DOM.
 *
 *   6. IT FITS A PHONE. The same screen is re-measured at a 390px viewport: the
 *      card never overflows the frame horizontally, the masks stay 1:1 integers,
 *      the labels stay above the 11px floor, and the entries wrap inside the card.
 *
 *   7. NOTHING IS CLIPPED, SLICED OR PAINTED OVER — at every scroll position. At
 *      the desktop frame and at a 390px viewport, every block of the debrief — the
 *      header, the strip and each of its entries, the reward-caches, salvage and
 *      economy cards, the simulated-economy banner, the feedback and session-points
 *      lines and the Airlock / Play again buttons — is collected and measured at
 *      rest, mid-scroll and at the end of the scroll, and:
 *        · no two of them that are not one box inside the other may INTERSECT on
 *          screen (each box is first clipped by the scroll containers above it);
 *        · none may be cut by the edge of the container that clips it while the
 *          cut part lies past the END OF THAT CONTAINER'S CONTENT: that is the
 *          block no amount of scrolling brings into view, and it is the failure a
 *          card sliced mid-sentence is. The content origin MOVES with the scroll —
 *          at scrollTop s it sits at the window's top minus s — so a block the
 *          reader has scrolled PAST the window's top edge is merely out of view:
 *          correct behaviour, and never reported as clipping. Measuring the
 *          content span from the unscrolled origin instead (what this check used
 *          to do) reads every scrolled-past block as an unreachable one, which is
 *          the confusion between "scrolled away" and "clipped" this check now
 *          avoids; the old rule is kept and printed alongside, so the difference is
 *          visible in the report rather than asserted away;
 *        · none may sit outside the debrief's own box unless a scroller clips it;
 *        · none may be smaller than its own content (the reward-caches copy the
 *          collapsed layout cut mid-sentence);
 *        · on a desktop frame the header and the exit controls must not move at all
 *          between scroll positions while the middle does: they are PINNED, and the
 *          pinned rows may never reach into the scrolling middle.
 *      A phone-sized frame keeps the ONE COLUMN IN FLOW layout instead — the two
 *      pinned rows alone are taller than its 258px, so a pinned middle would be a
 *      zero-height sliver (see COMPACT_HEIGHT in ui.tsx) — and there the whole
 *      screen is the one scroller.
 *      Measuring each block on its own is what let a phone-sized debrief pass while
 *      the footer was painted over the strip's entries and a desktop debrief cut the
 *      reward-caches copy. The report's non-vacuousness is proved in the check
 *      itself: re-run against the `auto auto auto` grid whose `min-height: 0` middle
 *      row collapses, it must light up with intersecting pairs again.
 *
 * The round is allowed to play itself out, so this takes several minutes: the AI
 * impostor hunts while the script watches for the post-round screen.
 *
 *   node games/impostor-protocol/tests/reveal-strip-check.mjs
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";
import { decodeSpriteBitmap } from "@rarefriends/friendsdk/sprites";
import { CREW_POOL, CREW_POOL_RECORDED_AT } from "../../../scripts/crew-pool.mjs";

await mkdir("./artifacts", { recursive: true });

const ROOM = "REVL";
const HOSTILE_TINT = "#7c1220";
const HOSTILE_HALO = "#ff5f5f";
const WHITE = "#ffffff";
/** ui.tsx REVEAL_SCALE: 16 canonical pixels at 3x. */
const SCALE = 3;
const BITMAP = 16 * SCALE;
/** Eight crewmates' worth of slack: sim.ts MATCH_LIMIT_SECONDS is 420. */
const ROUND_BUDGET_MS = 470_000;
/** How many live frames get the (expensive) computed-style sweep. */
const STYLE_SWEEPS = 4;
const DESKTOP_SHOT = "./artifacts/66-reveal-strip-desktop.png";
const PHONE_SHOT = "./artifacts/67-reveal-strip-phone.png";
const PHONE_CARD_SHOT = "./artifacts/67b-reveal-strip-phone-card.png";
/** The frame the host renders the game in at a 390x844 phone viewport. */
const PHONE = { width: 390, height: 844 };

/** The game's own FNV-1a, so a per-entry digest can be recomputed here. */
function digestText(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const digest = rows => digestText(rows.join("/"));
const hexToRgb = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
const sameColour = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= 6;
const haloKept = (px, py, intact) => intact || (px * 7 + py * 13) % 3 !== 0;

/** The RECORDED chain artwork for the crew pool, decoded as the game decodes it. */
const RECORDED = new Map(Object.entries(CREW_POOL).map(([id, record]) => {
  const rows = decodeSpriteBitmap(record.frames[0]).rows;
  return [id, { rows, digest: digest(rows) }];
}));

/**
 * What the declared rows, tint and halo rule require of every one of the 256
 * canonical cells — computed here, not read back from the game.
 */
function expectations(entry) {
  const rows = entry.rows;
  const solid = (px, py) => px >= 0 && px < 16 && py >= 0 && py < 16 && rows[py]?.[px] === "#";
  const covered = (px, py) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        if (solid(px + dx, py + dy) && haloKept(px + dx, py + dy, entry.haloIntact)) return true;
      }
    }
    return false;
  };
  const wanted = [];
  let mask = 0, boxes = 0, orphans = 0, orphansKept = 0;
  for (let py = 0; py < 16; py++) {
    for (let px = 0; px < 16; px++) {
      if (solid(px, py)) {
        mask++;
        if (haloKept(px, py, entry.haloIntact)) boxes++;
        wanted.push(entry.tint);
        continue;
      }
      let neighbours = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && solid(px + dx, py + dy)) neighbours++;
      }
      if (neighbours === 1) {
        orphans++;
        if (haloKept(px, py, entry.haloIntact)) orphansKept++;
      }
      wanted.push(covered(px, py) ? entry.halo : null);
    }
  }
  return { wanted, mask, boxes, orphans, orphansKept };
}

const report = {
  entries: [], treated: [], clean: [], liveSamples: 0, liveAbsent: 0, styleSweeps: 0,
  phases: {}, images: [], playerFrames: 0, playerGrounding: "none", phone: null, recordedAt: CREW_POOL_RECORDED_AT,
  layouts: [], evidence: [], fixture: null, fixturePhone: null, phoneBudget: null, cachesLine: null,
};
let failure = null;

try {
  await testGame("./games/impostor-protocol", {
    width: 1280, height: 800, timeout: 120_000,
    check: async ({ page, game }) => {
      const problems = [];
      page.on("pageerror", error => problems.push(`page: ${error.message}`));
      page.on("console", message => {
        if (message.type() !== "error") return;
        // The harness page itself asks for a favicon it does not ship; that is not
        // the game's console.
        const where = message.location?.()?.url ?? "";
        if (/favicon/i.test(message.text()) || /favicon/i.test(where)) return;
        problems.push(`console: ${message.text()} ${where}`);
      });

      const root = game.locator("section.ip-root").first();
      await root.waitFor({ timeout: 30_000 });

      /** The game's own hook, plus what the frame's DOM may not show while live. */
      const read = (styleSweep = false) => game.locator("body").evaluate(`(() => {
        const hook = window.__ipImpostorProtocol;
        const frame = document.querySelector("section.ip-root");
        if (!hook || !frame) return null;
        const stripSelectors = [".ip-rs-card", ".ip-rs-list", ".ip-rs-item", ".ip-rs-mask", ".ip-rs-name", ".ip-rs-tag",
          "[data-reveal-strip]", "[data-treated]"];
        const stray = stripSelectors.filter(selector => frame.querySelector(selector));
        const copy = ["Who was who", "impostor frame", "wear the impostor frame"]
          .filter(text => (frame.textContent || "").includes(text));
        const hostile = ["rgb(124, 18, 32)", "rgb(255, 95, 95)"];
        const styles = [];
        if (${styleSweep}) {
          for (const node of frame.querySelectorAll("*")) {
            const computed = getComputedStyle(node);
            for (const property of ["color", "backgroundColor", "borderTopColor", "borderLeftColor",
              "outlineColor", "boxShadow", "textShadow"]) {
              const value = computed[property];
              if (!value || value === "none") continue;
              for (const needle of hostile) if (value.includes(needle)) styles.push(property + ":" + value + " on " + node.className);
            }
          }
        }
        return {
          phase: hook.phase(), revealed: hook.revealed(), actors: hook.actors(), art: hook.crewArt(),
          blits: hook.blits(), stray, copy, styles: styles.slice(0, 4),
          debrief: !!frame.querySelector(".ip-debrief"), strip: !!frame.querySelector(".ip-rs-card"),
        };
      })()`);

      /**
       * Every entry's declared attributes AND its own pixels: the centre pixel of
       * each of the 256 canonical cells, plus a full-canvas colour histogram.
       */
      const readStrip = () => game.locator("body").evaluate(`(() => {
        const card = document.querySelector(".ip-rs-card");
        if (!card) return null;
        const list = card.querySelector(".ip-rs-list");
        const items = Array.from(card.querySelectorAll(".ip-rs-item"));
        const hex = (value) => value.toString(16).padStart(2, "0");
        const box = card.getBoundingClientRect();
        const frame = document.querySelector("section.ip-root").getBoundingClientRect();
        return {
          heading: (card.querySelector(".ip-h") || {}).textContent || "",
          note: (card.querySelector(".ip-note") || {}).textContent || "",
          declaredCount: list ? Number(list.dataset.actorCount) : -1,
          cardBox: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
          frameBox: { w: Math.round(frame.width), h: Math.round(frame.height) },
          overflow: { scrollWidth: card.scrollWidth, clientWidth: card.clientWidth },
          entries: items.map(item => {
            const canvas = item.querySelector("canvas.ip-rs-mask");
            const maskBox = canvas.getBoundingClientRect();
            const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
            const at = (x, y) => { const index = (y * canvas.width + x) * 4; return [data[index], data[index + 1], data[index + 2], data[index + 3]]; };
            const cells = [];
            const histogram = {};
            for (let py = 0; py < 16; py++) {
              for (let px = 0; px < 16; px++) {
                const pixel = at(px * ${SCALE} + 1, py * ${SCALE} + 1);
                cells.push(pixel[3] > 200 ? "#" + hex(pixel[0]) + hex(pixel[1]) + hex(pixel[2]) : null);
              }
            }
            for (let y = 0; y < canvas.height; y++) {
              for (let x = 0; x < canvas.width; x++) {
                const pixel = at(x, y);
                if (pixel[3] <= 200) continue;
                const key = "#" + hex(pixel[0]) + hex(pixel[1]) + hex(pixel[2]);
                histogram[key] = (histogram[key] || 0) + 1;
              }
            }
            const nameNode = item.querySelector(".ip-rs-name");
            const tagNode = item.querySelector(".ip-rs-tag");
            return {
              id: item.dataset.actor, name: item.dataset.name, role: item.dataset.role,
              treated: item.dataset.treated === "true", isPlayer: item.dataset.isPlayer === "true",
              alive: item.dataset.alive === "true", tokenId: item.dataset.tokenId, source: item.dataset.source,
              tint: item.dataset.tint, halo: item.dataset.halo, haloIntact: item.dataset.haloIntact === "true",
              rowsDigest: item.dataset.rowsDigest, rows: (item.dataset.rows || "").split("\\n"),
              label: item.getAttribute("aria-label") || "",
              tag: tagNode ? tagNode.textContent.trim() : "",
              nameFont: nameNode ? parseFloat(getComputedStyle(nameNode).fontSize) : 0,
              tagFont: tagNode ? parseFloat(getComputedStyle(tagNode).fontSize) : 0,
              drawn: canvas.dataset.drawn, maskCells: Number(canvas.dataset.maskCells),
              haloCells: Number(canvas.dataset.haloCells),
              bitmap: [canvas.width, canvas.height], cssBox: [Math.round(maskBox.width), Math.round(maskBox.height)],
              offset: { left: Math.round(maskBox.left), top: Math.round(maskBox.top), right: Math.round(maskBox.right) },
              imageRendering: getComputedStyle(canvas).imageRendering,
              cells, histogram,
            };
          }),
        };
      })()`);

      /**
       * The debrief's blocks, measured: whether any two of them intersect on
       * screen, whether any of them is out of reach, and where the scroll is. The
       * blocks are the panels and controls a reader sees: the header, the strip and
       * each of its entries, the three body cards, the footer and the banner /
       * feedback line / points line / buttons inside it. A pair where one box
       * CONTAINS the other (a block inside its own parent, an ancestor) is
       * containment, not overlap, and is skipped; every other pair must be disjoint
       * ON SCREEN, so each box is first clipped by the scroll containers above it.
       * Alongside the pairs:
       *
       *   · clipped    — a block that a clip edge cuts with the cut part lying past
       *                  the end of the clipper's CONTENT: the block no amount of
       *                  scrolling brings into view. The content span is measured
       *                  from the content origin, which sits at the clipper's window
       *                  top MINUS scrollTop — scrolling moves the content, not the
       *                  window. A block the reader has simply scrolled past the
       *                  window's top edge is INSIDE that span and is not a failure;
       *   · sliced     — the same failure while the block is still partially on
       *                  screen: a card cut mid-sentence with the rest of it past
       *                  the content, which is the case a reader cannot fix by
       *                  scrolling. A subset of clipped, reported separately so the
       *                  assertion names it;
       *   · escaped    — a PINNED block (one no scroller clips) that falls outside
       *                  the debrief's own box, or a scroll region that does: on a
       *                  frame it is content the reader never gets to;
       *   · selfOverflow — a block whose own content is taller than its box: the
       *                  "content that cannot grow" that cut the reward-caches copy;
       *   · scrolled   — how many blocks sit on screen, above the window and below
       *                  it. Reported so the report shows how much of the layout a
       *                  given scroll position actually puts out of view, and gives
       *                  the counts that make "scrolled away" and "clipped" two
       *                  different numbers;
       *   · legacy     — what the previous rule (content span measured from the
       *                  UNSROLLED origin, i.e. everything above the window counted
       *                  as clipped) flags at this position, and how many of those
       *                  blocks sit inside the corrected content span. Printed as
       *                  evidence, never asserted: at mid-scroll it names the very
       *                  blocks that are scrolled past the top edge and nothing else;
       *   · scroller   — which element inside the debrief actually scrolls and by
       *                  how much. Reported, not required to be absent: the pinned
       *                  layout scrolls its middle row and the phone layout scrolls
       *                  the screen, and what has to hold either way is that nothing
       *                  is clipped, sliced or overlapping at any scroll position;
       *   · content    — the scroller's window and its content span, the geometry the
       *                  clipping rule above is decided on;
       *   · pinned     — the header's and the footer's edges and the middle row's
       *                  box, so the caller can require the pins to stay put while
       *                  the middle moves, and to never reach into it.
       */
      const overlapReport = () => game.locator("body").evaluate(`(() => {
        const debrief = document.querySelector("section.ip-debrief");
        if (!debrief) return null;
        const blocks = [];
        const add = (key, node) => {
          if (!node) return;
          const box = node.getBoundingClientRect();
          blocks.push({ key, node, box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom } });
        };
        const name = node => {
          const text = node.textContent.trim().slice(0, 16);
          if (node.classList.contains("ip-btn")) return "button:" + text;
          if (node.classList.contains("ip-sim")) return "banner";
          if (node.classList.contains("ip-feedback")) return "feedback";
          if (node.classList.contains("ip-chip")) return "chip:" + text;
          return "actions:" + text;
        };
        for (const [key, selector] of [
          ["header", ".ip-debrief-head"],
          ["strip", ".ip-rs-card"],
          ["strip-list", ".ip-rs-list"],
          ["caches", '[aria-labelledby="ip-debrief-caches"]'],
          ["salvage", '[aria-labelledby="ip-debrief-held"]'],
          ["economy", '[aria-labelledby="ip-debrief-odds"]'],
          ["footer", ".ip-debrief-foot"],
        ]) add(key, debrief.querySelector(selector));
        for (const node of debrief.querySelectorAll(".ip-debrief-foot .ip-foot-actions")) add(name(node), node);
        for (const node of debrief.querySelectorAll(".ip-debrief-foot .ip-sim, .ip-debrief-foot .ip-chip, "
          + ".ip-debrief-foot .ip-feedback, .ip-debrief-foot .ip-btn")) add(name(node), node);
        for (const node of debrief.querySelectorAll(".ip-rs-item")) add("entry:" + node.dataset.actor, node);

        /* What is actually on screen for a block: its box clipped by every scroll
           container above it (a block scrolled out of view has an empty rect and
           cannot overlap anything a reader sees). */
        const visible = block => {
          let rect = { ...block.box };
          for (let node = block.node.parentElement; node && node !== document.documentElement; node = node.parentElement) {
            const overflow = getComputedStyle(node).overflowY;
            if (overflow === "visible" || overflow === "hidden") continue;
            const box = node.getBoundingClientRect();
            rect = {
              left: Math.max(rect.left, box.left + node.clientLeft),
              top: Math.max(rect.top, box.top + node.clientTop),
              right: Math.min(rect.right, box.left + node.clientLeft + node.clientWidth),
              bottom: Math.min(rect.bottom, box.top + node.clientTop + node.clientHeight),
            };
          }
          return rect;
        };
        const related = (a, b) => a.node === b.node || a.node.contains(b.node) || b.node.contains(a.node);
        for (const block of blocks) block.visible = visible(block);
        const overlaps = [];
        let pairs = 0;
        for (let i = 0; i < blocks.length; i++) {
          for (let j = i + 1; j < blocks.length; j++) {
            if (related(blocks[i], blocks[j])) continue;
            pairs++;
            const a = blocks[i].visible, b = blocks[j].visible;
            const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (width > 1 && height > 1) {
              overlaps.push(blocks[i].key + " x " + blocks[j].key
                + " (" + Math.round(width) + "x" + Math.round(height) + " on screen)");
            }
          }
        }

        /* ---------- what "clipped" has to mean, and what it must not -----------
           A scroll container shows a WINDOW (its client box) and RETAINS content
           for the whole of its scrollHeight from its content ORIGIN. The origin
           moves with the scroll: at scrollTop s it sits at the window's top minus
           s. Measuring a block against the unscrolled origin counts every block the
           reader has scrolled past the top edge as "clipped" — but that is what
           scrolling IS, and a reader who scrolled there did it on purpose. The
           failure that matters — the reward-caches card sliced mid-sentence — is a
           block cut by a clip edge with the cut part past the CONTENT, which no
           scroll ever brings into view. So the span below is measured from
           windowTop - scrollTop, and only a block outside THAT span is a failure. */
        const debriefBox = debrief.getBoundingClientRect();
        const inside = (box, outer) => box.top >= outer.top - 1 && box.bottom <= outer.bottom + 1
          && box.left >= outer.left - 1 && box.right <= outer.right + 1;
        const boxed = box => Math.round(box.top) + ".." + Math.round(box.bottom)
          + " x " + Math.round(box.left) + ".." + Math.round(box.right);
        const spans = new Map();
        const spanOf = node => {
          let span = spans.get(node);
          if (span) return span;
          const box = node.getBoundingClientRect();
          const windowTop = box.top + node.clientTop;
          const origin = windowTop - node.scrollTop;
          span = {
            windowTop, windowBottom: windowTop + node.clientHeight,
            scrollTop: node.scrollTop, content: node.scrollHeight,
            top: origin, bottom: origin + node.scrollHeight,
          };
          spans.set(node, span);
          return span;
        };
        const nearestClipper = node => {
          for (let current = node; current && current !== document.documentElement; current = current.parentElement) {
            const overflow = getComputedStyle(current).overflowY;
            if (overflow === "visible" || overflow === "hidden") continue;
            return current;
          }
          return null;
        };
        const clipped = [], sliced = [], escaped = [], selfOverflow = [];
        const scrolled = { onScreen: 0, above: 0, below: 0, pinned: 0 };
        const legacy = [];
        for (const block of blocks) {
          const clipper = nearestClipper(block.node);
          if (clipper) {
            const span = spanOf(clipper);
            const onScreen = block.visible.right > block.visible.left + 0.5
              && block.visible.bottom > block.visible.top + 0.5;
            if (onScreen) scrolled.onScreen++;
            else if (block.box.bottom <= span.windowTop + 1) scrolled.above++;
            else if (block.box.top >= span.windowBottom - 1) scrolled.below++;
            if (block.box.top < span.top - 1 || block.box.bottom > span.bottom + 1) {
              const line = block.key + " sits at " + Math.round(block.box.top) + ".." + Math.round(block.box.bottom)
                + " = content " + Math.round(block.box.top - span.top) + ".." + Math.round(block.box.bottom - span.top)
                + " of the " + Math.round(span.content) + "px content of " + (clipper.className || clipper.tagName)
                + (onScreen
                  ? ", cut while on screen: the part past the content can never be scrolled into view"
                  : ", which holds none of it: no amount of scrolling reaches it");
              clipped.push(line);
              if (onScreen) sliced.push(line);
            }
            /* The rule this check was corrected FROM, kept as the evidence: it
               measured the span from the clipper's UNSROLLED origin, so every block
               above the window counted as clipped. */
            if (block.box.top < span.windowTop - 1 || block.box.bottom > span.windowTop + span.content + 1) {
              legacy.push({
                key: block.key, offset: Math.round(block.box.top - span.top),
                insideContent: block.box.top >= span.top - 1 && block.box.bottom <= span.bottom + 1,
              });
            }
          } else {
            scrolled.pinned++;
            /* No scroller clips it, so it is a PINNED block: it has to be on screen. */
            if (!inside(block.box, debriefBox)) {
              escaped.push(block.key + " sits at " + boxed(block.box) + ", outside the debrief (" + boxed(debriefBox) + ")");
            }
          }
          if (getComputedStyle(block.node).overflowY === "visible"
            && block.node.scrollHeight > block.node.clientHeight + 1) {
            selfOverflow.push(block.key + ": content " + block.node.scrollHeight + "px in a " + block.node.clientHeight + "px box");
          }
        }
        /* Every scroller inside the debrief, and the one the reader actually moves:
           the middle row of the pinned layout, or the screen itself on a phone
           frame. A scroll region that is itself off the frame is just as lost as a
           block that is. */
        const scrolls = node => {
          const overflow = getComputedStyle(node).overflowY;
          return (overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight + 1;
        };
        const scrollers = [];
        for (const node of debrief.querySelectorAll("*")) {
          if (scrolls(node)) scrollers.push(node.className || node.tagName);
        }
        for (const node of [debrief, ...debrief.querySelectorAll("*")]) {
          if ((getComputedStyle(node).overflowY === "auto" || getComputedStyle(node).overflowY === "scroll")
            && !inside(node.getBoundingClientRect(), debriefBox)) {
            escaped.push("scroller " + (node.className || node.tagName) + " sits at " + boxed(node.getBoundingClientRect())
              + ", outside the debrief (" + boxed(debriefBox) + ")");
          }
        }
        const scroller = [debrief, ...debrief.querySelectorAll("*")].find(scrolls) || debrief;
        const middle = debrief.querySelector(".ip-debrief-body");
        const edges = node => {
          if (!node) return null;
          const box = node.getBoundingClientRect();
          return { top: Math.round(box.top), bottom: Math.round(box.bottom) };
        };
        /* The reward-caches copy: the panel the clipped sentence was reported in.
           insideContent is the property that matters — the last line lives inside
           the scroll content of whatever clips it, so scrolling reaches it whole. */
        const card = debrief.querySelector('[aria-labelledby="ip-debrief-caches"]');
        const notes = card ? card.querySelectorAll(".ip-note") : [];
        const lastNote = notes.length ? notes[notes.length - 1] : null;
        const cachesCopy = lastNote ? {
          bottom: Math.round(lastNote.getBoundingClientRect().bottom - debriefBox.top),
          frameBottom: Math.round(debriefBox.height),
          insideFrame: lastNote.getBoundingClientRect().bottom <= debriefBox.bottom + 0.5,
          insideContent: lastNote.getBoundingClientRect().bottom
            <= scroller.getBoundingClientRect().top + scroller.clientTop + scroller.scrollHeight + 1,
        } : null;
        const root = debrief.getBoundingClientRect();
        const scrollerSpan = spanOf(scroller);
        return {
          frame: Math.round(root.width) + "x" + Math.round(root.height),
          compact: debrief.dataset.compact,
          scrollable: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
          scrollTop: Math.round(scroller.scrollTop),
          blocks: blocks.length, pairs, overlapCount: overlaps.length, overlaps: overlaps.slice(0, 12),
          clipped, sliced, escaped, selfOverflow, scrollers, cachesCopy, scrolled,
          legacy: {
            count: legacy.length, insideContent: legacy.filter(item => item.insideContent).length,
            sample: legacy.slice(0, 4).map(item => item.key + " at content " + item.offset
              + (item.insideContent ? " (inside the content)" : " (outside the content)")),
          },
          content: {
            container: scroller.className || scroller.tagName,
            window: Math.round(scrollerSpan.windowTop) + ".." + Math.round(scrollerSpan.windowBottom),
            span: Math.round(scrollerSpan.top) + ".." + Math.round(scrollerSpan.bottom),
            scrollTop: Math.round(scrollerSpan.scrollTop), content: Math.round(scrollerSpan.content),
          },
          scroller: {
            key: scroller.className || scroller.tagName, client: scroller.clientHeight,
            content: scroller.scrollHeight, max: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
            scrollTop: Math.round(scroller.scrollTop),
          },
          pinned: {
            head: edges(debrief.querySelector(".ip-debrief-head")),
            foot: edges(debrief.querySelector(".ip-debrief-foot")),
            middle: edges(middle),
            middleClient: middle ? middle.clientHeight : 0,
            middleContent: middle ? middle.scrollHeight : 0,
            middleScrolled: middle ? Math.round(middle.scrollTop) : 0,
          },
        };
      })()`);

      /**
       * The element the debrief actually scrolls in — the middle row of the pinned
       * layout, or the screen itself on a phone frame — and a move to one end of it
       * (or to a position in between).
       *
       * `where` is a Node-side number or the string "end", so it is inlined into
       * the page script as a NUMBER, or as the page's own `max` expression. Passing
       * the Node variable itself through the template would splice a bare
       * identifier into the browser scope and throw `end is not defined` the moment
       * the script is evaluated — which is what killed this check at the phone step
       * before the assertions below ever ran.
       */
      const scrollDebrief = where => {
        const target = where === "end" ? "max" : String(Math.max(0, Math.round(Number(where))));
        return game.locator("section.ip-debrief").evaluate(`(() => {
          const debrief = document.querySelector("section.ip-debrief");
          const scrolls = node => {
            const overflow = getComputedStyle(node).overflowY;
            return (overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight + 1;
          };
          const scroller = [debrief, ...debrief.querySelectorAll("*")].find(scrolls) || debrief;
          const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
          scroller.scrollTop = Math.min(max, ${target});
          return {
            key: scroller.className || scroller.tagName, scrollTop: Math.round(scroller.scrollTop),
            max: Math.round(max), client: scroller.clientHeight,
          };
        })()`);
      };

      /**
       * Every block must be disjoint from every other on screen, every block must be
       * reachable by scrolling, no block or scroll region may be off the frame, and
       * no block may be smaller than its own content. Run at each scroll position a
       * reader can sit at, since "painted over" and "sliced" are properties of what
       * is on screen.
       *
       * What is asserted of clipping is REACHABILITY, not "inside the window" — a
       * reader's own scroll is what puts a block outside the window, so asserting
       * that would forbid scrolling:
       *
       *   · clipped (reachability) — a block cut by a clip edge with the cut part
       *     past the clipper's CONTENT, measured from the content origin that moves
       *     with scrollTop. Fatal at every position, visible or not.
       *   · sliced — the same, while the block is still partially on screen: the
       *     card cut mid-sentence. It is the subset of clipped a reader notices, and
       *     it is asserted under its own name.
       * A block inside its clipper's content is the case a reader can bring into
       * view by scrolling — it is what a block below the fold or one scrolled past
       * the top edge already is: correct, and not reportable. Nothing in the check
       * requires a block to be inside the WINDOW, because that would forbid both
       * scrolling and a card taller than the frame.
       *
       * Which element scrolls is REPORTED, not asserted: the pinned layout scrolls
       * its middle row and the phone layout scrolls the screen, and what has to hold
       * either way is the list below — nothing clipped, nothing sliced, nothing
       * overlapping at any scroll position.
       */
      const layouts = [];
      const assertNoOverlaps = async where => {
        const layout = await overlapReport();
        assert(layout, `${where}: the debrief is not on screen`);
        assert.deepEqual(layout.overlaps, [],
          `${where}: ${layout.overlapCount} of ${layout.pairs} block pairs are painted over each other: ${layout.overlaps.join(" · ")}`);
        assert.deepEqual(layout.sliced, [],
          `${where}: ${layout.sliced.length} block(s) are cut while on screen with the cut part past the content of the container that clips them:`
          + ` ${layout.sliced.join(" · ")}`);
        assert.deepEqual(layout.clipped, [],
          `${where}: ${layout.clipped.length} block(s) lie outside the content of the container that clips them,`
          + ` measured with the scroll applied: ${layout.clipped.join(" · ")}`);
        assert.deepEqual(layout.escaped, [],
          `${where}: a block or scroll region is outside the debrief's own box: ${layout.escaped.join(" · ")}`);
        assert.deepEqual(layout.selfOverflow, [],
          `${where}: a block is smaller than its own content: ${layout.selfOverflow.join(" · ")}`);
        if (layout.legacy.count) {
          report.evidence.push(`${where}: ${layout.scrolled.onScreen} blocks on screen, ${layout.scrolled.above} scrolled past the`
            + ` window's top edge, ${layout.scrolled.below} below it. The unscrolled-origin rule this check was corrected from flags`
            + ` ${layout.legacy.count} block(s) as clipped here; ${layout.legacy.insideContent}/${layout.legacy.count} of them sit inside the`
            + ` corrected content span (${layout.content.span} of ${layout.content.content}px, window ${layout.content.window}),`
            + ` i.e. scrolled past, not unreachable: ${layout.legacy.sample.join(" · ")}`);
        }
        layouts.push({ where, ...layout });
        return layout;
      };

      /**
       * The pinned layout's own property, which the overlap report cannot state on
       * its own: between two scroll positions the header and the exit controls do not
       * move at all while the middle does, and the pinned rows never reach into the
       * scrolling middle.
       */
      const assertPinned = (before, after, label) => {
        const near = (a, b) => Math.abs(a - b) <= 1;
        assert.equal(before.compact, "false", `${label}: the desktop frame is wearing the phone layout`);
        assert.equal(after.scroller.key, "ip-debrief-body",
          `${label}: the padded three-row grid scrolled "${after.scroller.key}", not the middle row`);
        assert(after.scroller.scrollTop > before.scroller.scrollTop,
          `${label}: the middle did not scroll (${before.scroller.scrollTop} -> ${after.scroller.scrollTop})`);
        assert(near(after.pinned.head.top, before.pinned.head.top) && near(after.pinned.head.bottom, before.pinned.head.bottom),
          `${label}: the header moved with the scroll (${before.pinned.head.top}..${before.pinned.head.bottom}`
          + ` -> ${after.pinned.head.top}..${after.pinned.head.bottom})`);
        assert(near(after.pinned.foot.top, before.pinned.foot.top) && near(after.pinned.foot.bottom, before.pinned.foot.bottom),
          `${label}: the exit controls moved with the scroll (${before.pinned.foot.top}..${before.pinned.foot.bottom}`
          + ` -> ${after.pinned.foot.top}..${after.pinned.foot.bottom})`);
        assert(before.pinned.head.bottom <= before.pinned.middle.top + 1,
          `${label}: the pinned header reaches into the scrolling middle (${before.pinned.head.bottom} > ${before.pinned.middle.top})`);
        assert(before.pinned.middle.bottom <= before.pinned.foot.top + 1,
          `${label}: the scrolling middle reaches into the pinned exit controls (${before.pinned.middle.bottom} > ${before.pinned.foot.top})`);
        assert(before.pinned.middleClient > 0,
          `${label}: the pinned middle row is ${before.pinned.middleClient}px tall — that is the collapse`);
      };

      const waitFor = async (label, predicate, budgetMs = 20_000) => {
        const deadline = Date.now() + budgetMs;
        while (Date.now() < deadline) {
          const state = await read().catch(() => null);
          if (state && predicate(state)) return state;
          await page.waitForTimeout(150);
        }
        throw new Error(`Timed out waiting for ${label}`);
      };

      /* ------------------------------------------------ 1 · into a round --- */

      await game.locator("input.ip-code").first().waitFor({ timeout: 30_000 });
      await game.locator("input.ip-code").first().fill(ROOM);
      // The player takes the impostor role on purpose: the strip must then show
      // the PLAYER wearing the treated frame, which is the case a crew playthrough
      // cannot prove.
      await game.locator("label.ip-tier", { hasText: "Impostor" }).first().click();
      await page.waitForTimeout(150);
      await game.getByRole("button", { name: /start practice round/i }).first().click();
      await game.locator("canvas.ip-canvas").first().waitFor({ timeout: 40_000 });
      const briefing = await waitFor("the round's crew artwork", state => state.art && state.art.entries.length > 0, 40_000);
      assert.equal(briefing.art.entries.length, 6, "the round did not read six crewmate tokens");
      console.log(`\n  round: seed ${briefing.art.seed} · ${briefing.art.entries.length} crew tokens read in ${briefing.art.readMs}ms`
        + ` (${briefing.art.failed} fell back) · player token ${briefing.art.playerTokenId}`);

      // The player's own canonical frames, straight off the live canvas: the strip
      // draws frame 0, and the station cycles all eight idle frames while the
      // briefing is up, so a short burst captures the set the strip must be inside.
      const playerFrames = new Map();
      const capturePlayer = state => {
        const me = state.actors.find(actor => actor.isPlayer);
        const blit = me ? state.blits.find(entry => entry.id === me.id) : null;
        if (!blit || !blit.rows) return;
        const rows = blit.rows.split("\n");
        if (rows.length === 16) playerFrames.set(digest(rows), rows);
      };
      for (let sample = 0; sample < 26; sample++) {
        const state = await read().catch(() => null);
        if (state) capturePlayer(state);
        await page.waitForTimeout(60);
      }
      report.playerFrames = playerFrames.size;

      /* ------------------------------------- 2 · the strip is absent live --- */

      const live = await read(true);
      assert(live, "the game never published its lifecycle hooks");
      assert.equal(live.phase, "briefing", `the round did not open on the briefing (phase ${live.phase})`);
      assert.equal(live.strip, false, "the reveal strip exists during the briefing");
      assert.equal(live.debrief, false, "the debrief exists during the briefing");
      assert.deepEqual(live.stray, [], "reveal-strip markup is in the frame during the briefing");
      assert.deepEqual(live.copy, [], "the reveal strip's copy is in the frame during the briefing");
      assert.deepEqual(live.styles, [], "the hostile colour is painted during the briefing");

      const begin = game.getByRole("button", { name: /^Begin/i }).first();
      if (await begin.count()) await begin.click();
      await page.waitForTimeout(400);
      // Keyboard reaches the game only once the frame has focus (a real tap).
      await game.locator("canvas.ip-canvas").first().click({ position: { x: 18, y: 18 }, timeout: 3_000 }).catch(() => {});

      const started = Date.now();
      let over = null, lastLog = 0, sweeps = 0, kills = 0;
      while (Date.now() - started < ROUND_BUDGET_MS) {
        const state = await read(sweeps < STYLE_SWEEPS).catch(() => null);
        if (!state) { await page.waitForTimeout(900); continue; }
        report.liveSamples++;
        report.phases[state.phase] = (report.phases[state.phase] ?? 0) + 1;

        if (state.phase === "over") {
          // The phase flips in the sim; React paints the debrief on its next tick.
          // Wait for the screen AND its strip rather than demanding both in one
          // snapshot.
          over = await waitFor("the post-round screen and its reveal strip",
            latest => latest.phase === "over" && latest.debrief && latest.strip, 20_000);
          break;
        }
        // Every live frame: nothing about the reveal may be on screen, and the
        // hostile colour may not be painted into the DOM anywhere.
        assert.equal(state.strip, false, `the reveal strip exists during phase ${state.phase}`);
        assert.deepEqual(state.stray, [], `reveal-strip markup is in the frame during phase ${state.phase}`);
        assert.deepEqual(state.copy, [], `the reveal strip's copy is in the frame during phase ${state.phase}`);
        if (sweeps < STYLE_SWEEPS) {
          sweeps++; report.styleSweeps++;
          assert.deepEqual(state.styles, [], `the hostile colour is painted in the frame during phase ${state.phase}`);
        }
        report.liveAbsent++;

        if (state.phase === "play") {
          capturePlayer(state);
          // The impostor's kill key: a real way for the player to shorten the round.
          await page.keyboard.press("q").catch(() => {});
          kills++;
        }
        const elapsed = Date.now() - started;
        if (elapsed - lastLog > 30_000) {
          lastLog = elapsed;
          const alive = state.actors.filter(actor => actor.alive).length;
          console.log(`  t=${(elapsed / 1000).toFixed(0)}s · phase ${state.phase} · ${alive}/7 alive`
            + ` · revealed ${JSON.stringify(state.revealed)} · strip absent on every live frame`);
        }
        await page.waitForTimeout(900);
      }
      if (!over) {
        const last = await read().catch(() => null);
        throw new Error(`No post-round screen within ${ROUND_BUDGET_MS / 1000}s (phase ${last?.phase},`
          + ` revealed ${JSON.stringify(last?.revealed)})`);
      }
      console.log(`\n  post-round: ${Math.round((Date.now() - started) / 1000)}s of play · ${report.liveAbsent} live frames sampled,`
        + ` the strip absent on every one · ${kills} kill attempts`);
      console.log(`  reveal list: ${JSON.stringify(over.revealed)} · phase ${over.phase}`);

      /* ------------------------------- 3 · one entry per actor, canonical --- */

      let strip = null;
      const drawnDeadline = Date.now() + 20_000;
      while (Date.now() < drawnDeadline) {
        strip = await readStrip().catch(() => null);
        if (strip && strip.entries.length > 0 && strip.entries.every(entry => entry.drawn === "yes")) break;
        await page.waitForTimeout(200);
      }
      assert(strip, "the debrief rendered no reveal strip at all");
      assert.equal(strip.heading, "Who was who", `the strip's heading is ${JSON.stringify(strip.heading)}`);

      const actorIds = over.actors.map(actor => actor.id).sort();
      const entryIds = strip.entries.map(entry => entry.id).sort();
      assert.equal(over.actors.length, 7, `the round has ${over.actors.length} actors, not 7`);
      assert.equal(strip.entries.length, 7, `the strip has ${strip.entries.length} entries, not one per actor`);
      assert.equal(strip.declaredCount, 7, `the strip declares ${strip.declaredCount} actors`);
      assert.deepEqual(entryIds, actorIds, "the strip's entries are not the round's actors");
      const players = strip.entries.filter(entry => entry.isPlayer);
      assert.equal(players.length, 1, `the strip has ${players.length} player entries`);
      assert.equal(players[0].id, over.actors.find(actor => actor.isPlayer).id, "the player's entry is not the player");

      const byActor = new Map(strip.entries.map(entry => [entry.id, entry]));
      assert(over.art, "the game published no crew artwork at the post-round screen");
      const impostorIds = over.actors.filter(actor => actor.role === "impostor").map(actor => actor.id).sort();
      const revealedIds = [...over.revealed].sort();
      const treatedIds = strip.entries.filter(entry => entry.treated).map(entry => entry.id).sort();
      const artByActor = new Map((over.art?.entries ?? []).map(entry => [entry.actorId, entry]));

      assert.deepEqual(revealedIds, impostorIds, "the reveal list is not the round's impostors");
      assert.deepEqual(treatedIds, impostorIds, "the treated set is not the reveal list");
      assert(treatedIds.includes(players[0].id), "the player held the impostor role but their entry is not treated");
      assert(treatedIds.length >= 1 && treatedIds.length < 7, `the treated set is ${JSON.stringify(treatedIds)}`);

      for (const entry of strip.entries) {
        const rows = entry.rows;
        assert.equal(rows.length, 16, `${entry.id}: ${rows.length} rows, not 16`);
        assert.equal(entry.drawn, "yes", `${entry.id}: the mask canvas was never drawn (${entry.drawn})`);
        assert.deepEqual(entry.bitmap, [BITMAP, BITMAP], `${entry.id}: bitmap is ${entry.bitmap.join("x")}`);
        assert.deepEqual(entry.cssBox, [BITMAP, BITMAP], `${entry.id}: the CSS box is ${entry.cssBox.join("x")}, not 1:1`);
        assert.equal(entry.imageRendering, "pixelated", `${entry.id}: image-rendering is ${entry.imageRendering}`);
        assert.notEqual(entry.source, "unavailable", `${entry.id}: no artwork resolved for this entry`);
        assert.equal(entry.rowsDigest, digest(rows), `${entry.id}: the declared digest is not the declared rows`);

        // The declared rows must be the recorded chain frame...
        const recorded = RECORDED.get(entry.tokenId);
        if (entry.isPlayer) {
          const playerToken = over.art?.playerTokenId;
          if (playerToken && RECORDED.has(playerToken)) {
            assert.equal(entry.tokenId, playerToken, `${entry.id}: the player's entry draws token ${entry.tokenId}, not ${playerToken}`);
            assert.deepEqual(rows, RECORDED.get(playerToken).rows, `${entry.id}: the player's rows are not its token's chain frame`);
            report.playerGrounding = "recorded chain artwork for the player's own token";
          } else {
            assert(playerFrames.has(entry.rowsDigest),
              `${entry.id}: the player's rows match none of the ${playerFrames.size} frames the live canvas painted`);
            report.playerGrounding = `the ${playerFrames.size} live canvas frames of the player's own mask`;
          }
        } else {
          assert(recorded, `${entry.id}: token ${entry.tokenId} is not in the recorded crew pool`);
          assert.deepEqual(rows, recorded.rows, `${entry.id}: the entry is not the token's recorded chain frame`);
          const checksum = artByActor.get(entry.id)?.checksum;
          assert.equal(checksum, entry.rowsDigest, `${entry.id}: digest ${entry.rowsDigest} is not the round's checksum ${checksum}`);
        }

        // ...and the pixels must be what those rows, that tint and that halo rule require.
        const want = expectations(entry);
        const mismatch = [];
        for (let index = 0; index < 256; index++) {
          const actual = entry.cells[index];
          const expected = want.wanted[index];
          if (expected === null) { if (actual !== null) mismatch.push(`${index % 16},${Math.floor(index / 16)}=${actual}`); }
          else if (!actual || !sameColour(hexToRgb(actual), hexToRgb(expected))) {
            mismatch.push(`${index % 16},${Math.floor(index / 16)}=${actual ?? "clear"} want ${expected}`);
          }
        }
        assert.deepEqual(mismatch.slice(0, 6), [], `${entry.id}: ${mismatch.length} cells are not what the declared frame requires`);
        assert.equal(entry.maskCells, want.mask, `${entry.id}: ${entry.maskCells} mask cells declared, ${want.mask} in the rows`);
        assert.equal(entry.haloCells, want.boxes, `${entry.id}: ${entry.haloCells} halo boxes drawn, ${want.boxes} required`);
        assert(want.mask >= 24, `${entry.id}: only ${want.mask} mask cells — that is not a Friend`);
        assert(want.orphans >= 8, `${entry.id}: only ${want.orphans} single-neighbour halo cells to read`);

        // The colour histogram: no more and no less than the two colours this
        // entry is allowed to carry. A clean entry with a hostile pixel in it, or a
        // treated entry with a white one, would show up right here.
        const colours = Object.keys(entry.histogram).sort();
        const allowed = [entry.tint, entry.halo].sort();
        const hostile = [HOSTILE_TINT, HOSTILE_HALO].map(colour => entry.histogram[colour] ?? 0);
        if (entry.treated) {
          assert.deepEqual(colours, allowed, `${entry.id}: a treated entry painted ${JSON.stringify(colours)}`);
          assert.equal(entry.tint, HOSTILE_TINT, `${entry.id}: treated tint is ${entry.tint}`);
          assert.equal(entry.halo, HOSTILE_HALO, `${entry.id}: treated halo is ${entry.halo}`);
          assert.equal(entry.haloIntact, false, `${entry.id}: the treated frame kept its halo intact`);
          assert.equal(entry.histogram[WHITE] ?? 0, 0, `${entry.id}: a treated entry still paints white pixels`);
          // A damaged halo is not a recoloured one: the dropped ring cells are clear.
          assert(want.orphansKept < want.orphans,
            `${entry.id}: the halo rule kept all ${want.orphans} ring cells — nothing is damaged`);
        } else {
          assert.equal(hostile[0] + hostile[1], 0, `${entry.id}: a clean entry paints ${JSON.stringify(hostile)} hostile pixels`);
          assert.equal(entry.halo, WHITE, `${entry.id}: clean halo is ${entry.halo}`);
          assert.equal(entry.haloIntact, true, `${entry.id}: a clean entry lost its halo`);
          assert.equal(want.orphansKept, want.orphans, `${entry.id}: the halo rule dropped a cell of an intact halo`);
          assert.deepEqual(colours, allowed, `${entry.id}: a clean entry painted ${JSON.stringify(colours)}`);
        }

        const row = {
          id: entry.id, name: entry.name, role: entry.role, isPlayer: entry.isPlayer, alive: entry.alive,
          tokenId: entry.tokenId, source: entry.source, verdict: entry.treated ? "TREATED" : "clean",
          tint: entry.tint, halo: entry.halo, haloIntact: entry.haloIntact,
          maskCells: want.mask, haloBoxes: `${entry.haloCells}/${want.boxes}`,
          ringCells: `${want.orphansKept}/${want.orphans}`, hostilePixels: hostile[0] + hostile[1],
          digest: entry.rowsDigest, cells: `${entry.cells.filter(cell => cell !== null).length}/256`, tag: entry.tag,
        };
        (entry.treated ? report.treated : report.clean).push(row);
        report.entries.push(row);
      }

      /* -------------------- 4 · desktop: pinned header, pinned controls ------ */

      // 960x638 is the frame a desktop player gets. The debrief is laid out as three
      // rows there: the header and the Airlock / Play again buttons are pinned and the
      // middle row is the scroll region between them. Every block has to be inside the
      // scrollable content, no two blocks may intersect at ANY scroll position, the
      // pins may not move while the middle does, and the reward-caches sentence the
      // collapsed layout cut has to be whole when it is scrolled to. Mid-scroll the
      // middle sits halfway through its range, so its blocks are above the window by
      // exactly that offset: out of view — what scrolling means — and not clipped.
      // The only clipping this position may name is a block cut by a clip edge with
      // the cut part past that clipper's content, which no scroll can reveal.
      await scrollDebrief(0);
      const desktopTop = await assertNoOverlaps("desktop debrief at rest");
      assert.equal(desktopTop.compact, "false", "the desktop frame is wearing the phone layout");
      assert(desktopTop.scrollable > 0, `the desktop debrief does not scroll (${desktopTop.scrollable}px)`);
      assert.equal(desktopTop.scroller.key, "ip-debrief-body",
        `the desktop debrief scrolls "${desktopTop.scroller.key}", not its middle row`);
      assert.equal(desktopTop.cachesCopy?.insideContent, true,
        `the reward-caches copy is outside the scroll content: last line ${desktopTop.cachesCopy?.bottom}`);
      console.log(`  desktop frame ${desktopTop.frame}: header ${desktopTop.pinned.head.top}..${desktopTop.pinned.head.bottom}`
        + ` · middle ${desktopTop.pinned.middle.top}..${desktopTop.pinned.middle.bottom}`
        + ` (${desktopTop.pinned.middleClient}px window, ${desktopTop.pinned.middleContent}px content)`
        + ` · footer ${desktopTop.pinned.foot.top}..${desktopTop.pinned.foot.bottom}`
        + ` · ${desktopTop.blocks} blocks, ${desktopTop.pairs} pairs, ${desktopTop.overlapCount} intersecting`);

      // The sentence the collapsed grid sliced: scrolled to, its last line is whole.
      const cachesLine = await game.locator("section.ip-debrief").evaluate(`(() => {
        const debrief = document.querySelector("section.ip-debrief");
        const card = debrief.querySelector('[aria-labelledby="ip-debrief-caches"]');
        const note = Array.from(card.querySelectorAll(".ip-note")).pop();
        note.scrollIntoView({ block: "nearest" });
        const box = note.getBoundingClientRect();
        const middle = debrief.querySelector(".ip-debrief-body");
        const window = middle.getBoundingClientRect();
        return {
          top: Math.round(box.top), bottom: Math.round(box.bottom),
          windowTop: Math.round(window.top), windowBottom: Math.round(window.bottom),
          text: note.textContent.replace(/\\s+/g, " ").trim().slice(0, 60),
        };
      })()`);
      assert(cachesLine.bottom <= cachesLine.windowBottom + 0.5 && cachesLine.top >= cachesLine.windowTop - 0.5,
        `the reward-caches copy is sliced: its last line sits at ${cachesLine.top}..${cachesLine.bottom}`
        + ` inside the ${cachesLine.windowTop}..${cachesLine.windowBottom} window ("${cachesLine.text}…")`);
      report.cachesLine = cachesLine;
      await scrollDebrief(0);

      // Mid-scroll and the far end: the same report, at the positions between the ends.
      await scrollDebrief(Math.round(desktopTop.scroller.max / 2));
      const desktopMid = await assertNoOverlaps("desktop debrief mid-scroll");
      assertPinned(desktopTop, desktopMid, "desktop debrief scrolled to its middle");
      await scrollDebrief("end");
      const desktopEnd = await assertNoOverlaps("desktop debrief scrolled to its end");
      assertPinned(desktopTop, desktopEnd, "desktop debrief scrolled to its end");
      await scrollDebrief(0);

      /* --------------------- 4b · the collapsed grid, on purpose ------------- */

      // Non-vacuousness, proved rather than assumed: the SAME report is run against
      // the shape this screen had before — a `auto auto auto` grid in a
      // definite-height container, whose `min-height: 0` middle row is handed a share
      // of the height and collapses, its content painting over the pinned footer. A
      // check that cannot see that is not a check — and it is a failure no scroll
      // correction can explain away, since the collapse paints cards ONTO the footer
      // whatever the scroll position is.
      const setFixture = on => game.locator("section.ip-debrief").evaluate(`(() => {
        const debrief = document.querySelector("section.ip-debrief");
        let style = document.getElementById("ip-fixture-collapsed");
        if (${on}) {
          if (!style) {
            style = document.createElement("style");
            style.id = "ip-fixture-collapsed";
            style.textContent = "section.ip-debrief { display: grid !important; grid-template-rows: auto auto auto !important;"
              + " overflow: visible !important; }"
              + " section.ip-debrief > .ip-debrief-body { min-height: 0 !important; overflow: visible !important; }";
            document.head.appendChild(style);
          }
        } else if (style) style.remove();
        void debrief.offsetHeight;
        return true;
      })()`);

      await scrollDebrief(0);
      await setFixture(true);
      const collapsed = await overlapReport();
      await setFixture(false);
      await page.waitForTimeout(200);
      report.fixture = {
        overlaps: collapsed.overlapCount, pairs: collapsed.pairs, middleClient: collapsed.pinned.middleClient,
        sample: collapsed.overlaps.slice(0, 4),
      };
      assert(collapsed.overlapCount > 0,
        "the report does not see the collapsed `auto auto auto` grid it was written for — the fixture proves nothing");
      console.log(`  fixture: the old auto auto auto grid collapses the middle row (${collapsed.pinned.middleClient}px)`
        + ` and the same report finds ${collapsed.overlapCount} of ${collapsed.pairs} pairs intersecting, e.g. ${collapsed.overlaps[0]}`);
      await scrollDebrief(0);

      /* ---------------------------------------------- 5 · screenshots -------- */

      // The desktop shot with the middle SCROLLED, so what it shows is the point of
      // this screen: the pinned header and the pinned Airlock / Play again controls
      // with the strip moving between them.
      const desktopShotAt = await scrollDebrief(Math.round(desktopTop.scroller.max / 2));
      await page.waitForTimeout(150);
      await page.locator(".rf-game-frame").screenshot({ path: DESKTOP_SHOT });
      report.images.push(DESKTOP_SHOT);
      console.log(`  desktop shot: ${DESKTOP_SHOT} (frame ${strip.frameBox.w}x${strip.frameBox.h},`
        + ` middle scrolled to ${desktopShotAt.scrollTop}px of ${desktopShotAt.max}px)`);
      await assertNoOverlaps("desktop debrief at the shot's scroll position");
      await scrollDebrief(0);

      /* ---------------------------------------------- 6 · the phone frame --- */

      await page.setViewportSize(PHONE);
      await page.waitForTimeout(1500);
      // A 258px-tall frame is short enough that the debrief switches to its
      // scrolling column; the strip has to survive that, stay 1:1, and stay in
      // reach — a strip nobody can scroll to is the bug this whole feature fixes.
      assert.equal(await game.locator("section.ip-debrief[data-compact='true']").count(), 1,
        "the debrief did not switch to its short-frame scrolling layout at phone size");
      // The frame the overlap was seen in: at rest the header and the strip are the
      // only things on screen, and neither may be painted over.
      await scrollDebrief(0);
      const phoneTop = await assertNoOverlaps("phone debrief at rest");
      assert.equal(phoneTop.compact, "true", "the phone debrief is not using its short-frame layout");
      const phone = await readStrip().catch(() => null);
      assert(phone, "the strip disappeared when the viewport changed");
      assert.equal(phone.entries.length, 7, `the strip has ${phone.entries.length} entries at ${PHONE.width}px wide`);
      assert.deepEqual(phone.entries.map(entry => entry.id), strip.entries.map(entry => entry.id),
        "the entries changed order at phone width");
      for (const entry of phone.entries) {
        const before = byActor.get(entry.id);
        assert.equal(entry.treated, before.treated, `${entry.id}: the treatment changed at phone width`);
        assert.equal(entry.rowsDigest, before.rowsDigest, `${entry.id}: the drawn frame changed at phone width`);
        assert.deepEqual(entry.bitmap, [BITMAP, BITMAP], `${entry.id}: bitmap is ${entry.bitmap.join("x")} at phone width`);
        assert.deepEqual(entry.cssBox, [BITMAP, BITMAP], `${entry.id}: the CSS box is ${entry.cssBox.join("x")} at phone width`);
        assert.equal(entry.imageRendering, "pixelated", `${entry.id}: image-rendering is ${entry.imageRendering} at phone width`);
        assert(entry.nameFont >= 11, `${entry.id}: the name is ${entry.nameFont}px at phone width`);
        assert(entry.tagFont >= 11, `${entry.id}: the role tag is ${entry.tagFont}px at phone width`);
        assert(entry.offset.right <= phone.cardBox.x + phone.cardBox.w + 1,
          `${entry.id}: the entry overflows the card at phone width`);
      }
      assert(phone.cardBox.w <= phone.frameBox.w + 1,
        `the strip is ${phone.cardBox.w}px wide inside a ${phone.frameBox.w}px frame`);
      assert(phone.overflow.scrollWidth <= phone.overflow.clientWidth + 1,
        `the strip scrolls sideways (${phone.overflow.scrollWidth} > ${phone.overflow.clientWidth})`);
      const rowsOnScreen = new Set(phone.entries.map(entry => entry.offset.top)).size;
      assert(rowsOnScreen >= 1, "the strip's entries are not laid out in rows");

      // Reachability: the frame must scroll, the strip must come into view, and a
      // full row of entries must land inside the frame at once.
      const view = await game.locator("section.ip-root").first().evaluate(`(() => {
        const root = document.querySelector(".ip-debrief");
        const card = document.querySelector(".ip-rs-card");
        const frame = document.querySelector("section.ip-root").getBoundingClientRect();
        root.scrollTop = 0;
        const start = card.getBoundingClientRect();
        card.scrollIntoView({ block: "start" });
        const after = card.getBoundingClientRect();
        const items = Array.from(card.querySelectorAll(".ip-rs-item")).map(node => node.getBoundingClientRect());
        return {
          scrollable: Math.round(root.scrollHeight - root.clientHeight),
          frame: Math.round(frame.height),
          cardTopBefore: Math.round(start.top - frame.top),
          cardTop: Math.round(after.top - frame.top),
          cardHeight: Math.round(after.height),
          itemsInFrame: items.filter(box => box.top >= frame.top - 0.5 && box.bottom <= frame.bottom + 0.5).length,
          items: items.length,
        };
      })()`);
      assert(view.scrollable > 0, `the debrief does not scroll at phone size (${JSON.stringify(view)})`);
      assert(view.cardTop >= -1 && view.cardTop < view.frame,
        `the strip will not come into view at phone size (card top ${view.cardTop} in a ${view.frame}px frame)`);
      assert(view.itemsInFrame >= 4,
        `only ${view.itemsInFrame} of ${view.items} entries are fully on screen after scrolling`);
      // The strip is in view here: no card or footer block may reach into it.
      const phoneStrip = await assertNoOverlaps("phone debrief scrolled to the strip");
      assert(phoneStrip.scrollTop > 0, `the debrief did not scroll to the strip (scrollTop ${phoneStrip.scrollTop})`);
      report.phone = {
        viewport: `${PHONE.width}x${PHONE.height}`, frame: `${phone.frameBox.w}x${phone.frameBox.h}`,
        card: `${phone.cardBox.w}x${phone.cardBox.h}`, entryRows: rowsOnScreen,
        mask: phone.entries[0].cssBox.join("x"), nameFont: phone.entries[0].nameFont,
        overflow: `${phone.overflow.scrollWidth}/${phone.overflow.clientWidth}`,
        scrollable: view.scrollable, itemsInFrame: `${view.itemsInFrame}/${view.items}`,
        cardTopAfterScroll: view.cardTop,
      };
      // The far end of the column: the salvage and economy panels and the footer's
      // banner, session-points line and buttons must be clear of each other, and all
      // of them reachable.
      await scrollDebrief("end");
      await assertNoOverlaps("phone debrief scrolled to the end");

      // The phone frame's own numbers, for the record: this is the size the pinned
      // layout cannot be used at — a pinned header and a pinned footer together are
      // taller than the whole 258px screen, so below COMPACT_HEIGHT the debrief stacks
      // into one scrolling column (ui.tsx COMPACT_HEIGHT) and this is the layout that
      // has to hold. The exit controls stay reachable here by scrolling to them.
      await scrollDebrief(0);
      const phoneBudget = await game.locator("section.ip-debrief").evaluate(`(() => {
        const debrief = document.querySelector("section.ip-debrief");
        const head = debrief.querySelector(".ip-debrief-head").getBoundingClientRect();
        const foot = debrief.querySelector(".ip-debrief-foot").getBoundingClientRect();
        return {
          frame: Math.round(debrief.getBoundingClientRect().height),
          header: Math.round(head.height), footer: Math.round(foot.height),
          scrollable: Math.round(debrief.scrollHeight - debrief.clientHeight),
        };
      })()`);
      report.phoneBudget = phoneBudget;
      console.log(`  phone budget: a ${phoneBudget.frame}px frame, header ${phoneBudget.header}px + exit controls`
        + ` ${phoneBudget.footer}px = ${phoneBudget.header + phoneBudget.footer}px pinned,`
        + ` so the screen scrolls as one ${phoneBudget.scrollable}px column`);

      /* ------------------ 6b · the collapsed grid, at the phone size -------- */

      // The frame the bug was measured in. The same fixture as the desktop run, so
      // the report is proved non-vacuous at both sizes.
      await setFixture(true);
      const collapsedPhone = await overlapReport();
      await setFixture(false);
      await page.waitForTimeout(200);
      report.fixturePhone = {
        overlaps: collapsedPhone.overlapCount, pairs: collapsedPhone.pairs,
        middleClient: collapsedPhone.pinned.middleClient, sample: collapsedPhone.overlaps.slice(0, 4),
      };
      assert(collapsedPhone.overlapCount > 0,
        "the report does not see the collapsed grid at phone size — the fixture proves nothing");
      console.log(`  fixture (phone): the old auto auto auto grid collapses the middle row (${collapsedPhone.pinned.middleClient}px)`
        + ` and the same report finds ${collapsedPhone.overlapCount} of ${collapsedPhone.pairs} pairs intersecting,`
        + ` e.g. ${collapsedPhone.overlaps[0]}`);
      await scrollDebrief(0);
      await assertNoOverlaps("phone debrief after the collapsed-grid fixture");

      report.layouts = layouts.map(({ where, frame, blocks, pairs, overlapCount, clipped, sliced, escaped, selfOverflow, scrolled, content, scrollTop, scroller, pinned }) =>
        `${where}: frame ${frame} · ${blocks} blocks · ${pairs} pairs checked, ${overlapCount} intersecting`
        + ` · ${clipped.length} unreachable (${sliced.length} cut while on screen), ${escaped.length} off the frame,`
        + ` ${selfOverflow.length} overflowing their own box`
        + ` · ${scrolled.onScreen} on screen / ${scrolled.above} scrolled past the window / ${scrolled.below} below it`
        + ` · scrolls "${scroller.key}" ${scrollTop}/${scroller.max}px (${scroller.client}px window: ${content.window},`
        + ` content ${content.span} = ${content.content}px)`
        + ` · pins: head ${pinned.head.top}..${pinned.head.bottom} foot ${pinned.foot.top}..${pinned.foot.bottom}`
        + ` middle ${pinned.middleClient}px`);
      // Leave the shots showing the strip; it is the point of the screen.
      await game.locator(".ip-rs-card").first().evaluate(node => node.scrollIntoView({ block: "start" }));
      // The frame's own scroll was just moved; the host page may have moved with it.
      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
      await page.waitForTimeout(250);
      await page.locator(".rf-game-frame").screenshot({ path: PHONE_SHOT });
      report.images.push(PHONE_SHOT);
      await game.locator(".ip-rs-card").first().screenshot({ path: PHONE_CARD_SHOT }).catch(() => {});
      report.images.push(PHONE_CARD_SHOT);
      console.log(`  phone: frame ${phone.frameBox.w}x${phone.frameBox.h} · card ${phone.cardBox.w}x${phone.cardBox.h}`
        + ` · ${rowsOnScreen} row(s) of entries, ${view.itemsInFrame}/${view.items} fully in frame after scrolling`
        + ` · ${view.scrollable}px of scroll`);
      console.log(`  phone shots: ${PHONE_SHOT} · ${PHONE_CARD_SHOT} (the strip itself at 390px, ${phone.cardBox.w}px wide)`);

      assert.deepEqual(problems, [], `Browser problems:\n${problems.join("\n")}`);
    },
  });
} catch (error) {
  failure = error;
  console.error(`\nreveal strip check FAILED\n${error?.stack ?? error}`);
}

/* ------------------------------------------------------------------ report */

const pad = (value, width) => String(value).padEnd(width);
console.log(`\n  ${failure ? "reveal strip check failed" : "reveal strip check passed"}`);
console.log(`  recorded chain artwork: ${report.recordedAt}`);
console.log(`  live frames sampled: ${report.liveSamples} (strip absent on ${report.liveAbsent},`
  + ` ${report.styleSweeps} full style sweeps) · phases seen: ${JSON.stringify(report.phases)}`);
if (report.entries.length) {
  console.log(`\n  ${pad("actor", 10)}${pad("name", 16)}${pad("role", 10)}${pad("entry", 10)}${pad("tint", 9)}${pad("halo", 9)}${pad("halo", 6)}${pad("mask", 6)}${pad("halobox", 9)}${pad("ring", 7)}${pad("hostile", 8)}${pad("digest", 10)}cells`);
  for (const row of report.entries) {
    console.log(`  ${pad(row.id, 10)}${pad(row.name + (row.isPlayer ? "*" : ""), 16)}${pad(row.role, 10)}${pad(row.verdict, 10)}`
      + `${pad(row.tint, 9)}${pad(row.halo, 9)}${pad(row.haloIntact ? "kept" : "broken", 6)}${pad(row.maskCells, 6)}`
      + `${pad(row.haloBoxes, 9)}${pad(row.ringCells, 7)}${pad(row.hostilePixels, 8)}${pad(row.digest, 10)}${row.cells}`);
  }
  const hostile = report.treated.filter(row => row.hostilePixels > 0).length;
  const clean = report.clean.filter(row => row.hostilePixels === 0).length;
  console.log(`\n  treated: ${report.treated.length} (${report.treated.map(row => row.id).join(", ")}) — all painted the hostile frame (${hostile}/${report.treated.length})`);
  console.log(`  clean:   ${report.clean.length} (${report.clean.map(row => row.id).join(", ")}) — none painted a hostile pixel (${clean}/${report.clean.length})`);
  console.log(`  player entry: ${report.treated.some(row => row.isPlayer) ? "TREATED (the player was the impostor)" : "clean"}`
    + ` · player's rows grounded by ${report.playerGrounding} · ${report.playerFrames} live player frames captured`);
}
if (report.phone) {
  console.log(`  phone (${report.phone.viewport}): frame ${report.phone.frame} · card ${report.phone.card}`
    + ` · ${report.phone.entryRows} row(s) · mask ${report.phone.mask} · name ${report.phone.nameFont}px`
    + ` · width ${report.phone.overflow} · ${report.phone.itemsInFrame} entries fully in frame after scrolling`
    + ` · ${report.phone.scrollable}px of scroll`);
}
if (report.phoneBudget) {
  console.log(`  phone budget: frame ${report.phoneBudget.frame}px vs header ${report.phoneBudget.header}px`
    + ` + exit controls ${report.phoneBudget.footer}px pinned`
    + ` (one ${report.phoneBudget.scrollable}px column instead)`);
}
if (report.cachesLine) {
  console.log(`  reward-caches copy scrolled to: ${report.cachesLine.top}..${report.cachesLine.bottom}`
    + ` inside its ${report.cachesLine.windowTop}..${report.cachesLine.windowBottom} scroll window`);
}
if (report.layouts.length) {
  console.log("  overlap report (blocks; no two may intersect at any scroll position, every block reachable):");
  for (const line of report.layouts) console.log(`    ${line}`);
}
if (report.evidence.length) {
  console.log("  scrolled-away vs clipped (the corrected rule, proved at the positions that expose the difference):");
  for (const line of report.evidence) console.log(`    ${line}`);
}
for (const [tag, fixture] of [["desktop", report.fixture], ["phone", report.fixturePhone]]) {
  if (!fixture) continue;
  console.log(`  non-vacuousness (${tag}): the collapsed auto auto auto grid leaves the middle row ${fixture.middleClient}px`
    + ` and the same report finds ${fixture.overlaps} of ${fixture.pairs} pairs intersecting:`);
  for (const line of fixture.sample) console.log(`    ${line}`);
}
console.log(`  screenshots: ${report.images.join(", ") || "none"}`);
process.exitCode = failure ? 1 : 0;
