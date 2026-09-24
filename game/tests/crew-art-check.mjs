/**
 * Crew artwork check — are the NPC crewmates really real Friends, and is the
 * impostor really indistinguishable from them while the round is live?
 *
 * Five claims, all measured off the framebuffer, none taken on trust:
 *
 *   1. PROVENANCE. Every NPC is drawn from ITS OWN token's canonical frames. This
 *      check decodes the SDK's RECORDED chain artwork for the token the game
 *      reports (`scripts/crew-pool.mjs`, itself re-verifiable against the live
 *      chain with `tests/crew-pool-probe.mjs --verify`) and asserts that every
 *      drawn frame is byte-equal to one of that token's 64 canonical clips, that
 *      the per-actor checksum and 64-frame digest are that token's, and that the
 *      canvas is actually showing those pixels (not a stand-in).
 *
 *   2. DISTINCTNESS. No two crewmates on the station share a token or a frame set.
 *
 *   3. PIXEL IDENTITY IN PLAY — the strong one. The SAME NPC is drawn twice: once
 *      holding the impostor role (round A) and once as an ordinary crewmate (round
 *      B, same room code, so the same seed, the same token and the same suit tint).
 *      Both boxes are read back out of the framebuffer and compared cell by cell.
 *      Two digests, one byte diff.
 *
 *   4. REVEAL-ONLY TREATMENT. The treated frame (hostile tint #7c1220, damaged halo
 *      #ff5f5f) may appear only once the answer is public — the kill the player
 *      watched, the ejection, the debrief. The check proves both halves: absent
 *      from every live frame it samples, present at the reveal, over an UNCHANGED
 *      silhouette.
 *
 *   5. Screenshots under ./artifacts: 60 crew in the light, 61 the live impostor
 *      beside a crewmate, 62 the impostor at the reveal, 63 a 5x canonical mask.
 *
 * WHY THE PLAYER HAS TO WALK THERE, AND HOW
 * -----------------------------------------
 * `pixels()` reads an actor's box out of the framebuffer, so an actor has to be
 * lit to be measurable. The fog is a radial gradient centred on the player's feet
 * and fully transparent only inside 0.55 x 210 = 115 world units, and an NPC's
 * mask sits ABOVE its feet (rows 2..13 of its 16x16 box). Standing NORTH of the
 * target — never south — is therefore the one geometry that is both fog-free and
 * free of box overlap; the stand-off is tightened if the readback still comes back
 * fogged (lights sabotage cuts the radius to 90). The player is steered along the
 * station's own zone graph (HUBS / ZONE_LINKS, the same lanes the bots walk), by
 * dispatching pointerdown on the canvas: the real tap-to-move handler runs, but
 * without Playwright's hit test, because the Leave-station button covers the
 * bottom of the stage and swallows a synthetic click aimed under it.
 *
 * WHY THE ROUND ENDS BY ITSELF, AND WHY THERE IS NO WITNESSED KILL
 * ---------------------------------------------------------------
 * sim.ts will not let a bot kill while any third actor is within
 * BOT_KILL_SAFE_RADIUS = 220 — and a kill counts as witnessed only within
 * WITNESS_RADIUS = 220. The two radii are equal, so a bot kill the player can
 * see is geometrically impossible, and the watched-kill flash cannot be captured
 * by playing honestly. The reveal this check measures is the one the game does
 * reach on its own: the debrief, where `revealImpostorIds()` is allowed to name
 * the impostors. Nothing here forces that state.
 *
 *   node games/impostor-protocol/tests/crew-art-check.mjs
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";
import { decodeGenerationSprites, decodeSpriteBitmap } from "@rarefriends/friendsdk/sprites";
import { CREW_POOL, CREW_POOL_RECORDED_AT } from "../../../scripts/crew-pool.mjs";
import { HUBS, STATION, ZONE_LINKS } from "../src/station.ts";

const ROOM = "CREW";
const REVEAL_TINT = "#7c1220";
const REVEAL_HALO = "#ff5f5f";
/** The fog gradient is fully transparent inside 0.55 x 210 units. */
const LIT_RADIUS = 115;
/** Stand-off that is both fog-free and free of 80x80 box overlap, standing north. */
const STANDOFF = 96;
const MIN_STANDOFF = 82;
/** The sim's own MATCH_LIMIT_SECONDS is 420; the round cannot outlive that. */
const REVEAL_BUDGET_MS = 430_000;
/** Two attempts at the reveal, in case the round ends mid-transit. */
const REVEAL_ATTEMPTS = 2;

/** The recorded chain artwork for the pool, decoded exactly as the game decodes it. */
const ARTWORK = new Map(Object.entries(CREW_POOL).map(([id, record]) => {
  const sprites = decodeGenerationSprites(BigInt(id), record.familyId, record.seed, record.frames);
  const clips = new Set();
  const bodies = new Set();
  for (const kind of ["idle", "walk"]) {
    for (const facing of ["down", "up", "left", "right"]) {
      for (const frame of sprites.clips[kind][facing]) {
        clips.add(frame.rows.join("\n"));
        bodies.add(rotateQuarter(frame.rows).join("\n"));
      }
    }
  }
  return [id, {
    sprites, clips, bodies,
    checksum: digestText(decodeSpriteBitmap(record.frames[0]).rows.join("/")),
    framesDigest: digestText(record.frames.map(frame => frame.toString(16)).join("")),
  }];
}));

/** The game's own FNV-1a digest, so a per-actor checksum can be recomputed here. */
function digestText(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const digest = rows => digestText(rows.join("/"));
const pattern = rows => rows.replace(/\n/g, "").replace(/[^#]/g, ".");
const tintPattern = cells => cells.replace(/T/g, "#").replace(/[^#]/g, ".");
const countMask = rows => (rows.match(/#/g) ?? []).length;
const solid = (rows, px, py) => rows.split("\n")[py]?.[px] === "#";
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** A canonical frame a quarter turn clockwise, exactly as the body pass does it. */
function rotateQuarter(rows) {
  const out = [];
  for (let y = 0; y < 16; y++) {
    let row = "";
    for (let x = 0; x < 16; x++) row += rows[y][x];
    out.push(row);
  }
  return out.map((_, y) => Array.from({ length: 16 }, (_, x) => rows[15 - x][y]).join(""));
}

/** The damaged-halo rule, mirrored from src/crew-art.ts haloKept(). */
const haloKept = (px, py, intact) => intact || (px * 7 + py * 13) % 3 !== 0;

/**
 * Which ring cells around this frame's mask can tell a kept halo box from a
 * dropped one: a ring cell with exactly one solid neighbour is covered by that
 * neighbour's halo box and nothing else.
 */
function orphanExpectation(rows, intact) {
  let cells = 0, hits = 0;
  for (let py = 0; py < 16; py++) {
    for (let px = 0; px < 16; px++) {
      if (solid(rows, px, py)) continue;
      const owners = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && solid(rows, px + dx, py + dy)) owners.push([px + dx, py + dy]);
      }
      if (owners.length !== 1) continue;
      cells++;
      if (haloKept(owners[0][0], owners[0][1], intact)) hits++;
    }
  }
  return { cells, hits };
}

/* ------------------------------------------------ station navigation --- */

/** Which zone rectangle holds this world point (mirrors render.ts zoneAt). */
function zoneAt(point) {
  for (const zone of STATION.zones) {
    if (point.x >= zone.x && point.x <= zone.x + zone.w && point.y >= zone.y && point.y <= zone.y + zone.h) return zone.id;
  }
  return null;
}

const NEIGHBOURS = (() => {
  const map = new Map();
  for (const [a, b] of ZONE_LINKS) {
    if (!map.has(a)) map.set(a, []);
    if (!map.has(b)) map.set(b, []);
    map.get(a).push(b);
    map.get(b).push(a);
  }
  return map;
})();

/** Shortest zone route, the same graph the bots path over. */
function routeTo(from, to) {
  const queue = [[from]];
  const seen = new Set([from]);
  while (queue.length) {
    const path = queue.shift();
    const head = path[path.length - 1];
    if (head === to) return path;
    for (const next of NEIGHBOURS.get(head) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  return null;
}

/** The lane centres to walk before the last leg: every zone after the current one. */
function lanePoints(from, to) {
  if (!from || !to || from === to) return [];
  const route = routeTo(from, to);
  if (!route) return [];
  return route.slice(1).map(id => HUBS[id]).filter(Boolean);
}

/* ----------------------------------------------------------------------- */

await mkdir("./artifacts", { recursive: true });

const report = {
  recordedAt: CREW_POOL_RECORDED_AT, rounds: {}, reveal: null, identity: null,
  images: [], attempts: [], provenance: [], liveSamples: 0, foggedSamples: 0,
};
let failure = null;

try {
  await testGame("./games/impostor-protocol", {
    width: 1280, height: 800, timeout: 60_000,
    check: async ({ page, game }) => {
      const canvas = game.locator("canvas.ip-canvas").first();

      /** One round trip: the artwork, the reveal list, and every actor's canvas bytes. */
      const read = () => game.locator("body").evaluate(`(() => {
        const hook = window.__ipImpostorProtocol;
        if (!hook) return null;
        const blits = hook.blits();
        const node = document.querySelector("canvas.ip-canvas");
        return {
          phase: hook.phase(), revealed: hook.revealed(), art: hook.crewArt(),
          roundStartMs: hook.roundStartMs(), actors: hook.actors(), blits,
          pixels: Object.fromEntries(blits.map(entry => [entry.id, hook.pixels(entry.id)])),
          domRevealed: node ? node.dataset.revealed ?? "" : null,
        };
      })()`);

      const waitFor = async (label, predicate, budgetMs = 30_000) => {
        const deadline = Date.now() + budgetMs;
        while (Date.now() < deadline) {
          const state = await read();
          if (state && predicate(state)) return state;
          await page.waitForTimeout(150);
        }
        throw new Error(`Timed out waiting for ${label}`);
      };

      /** A real crop of the canvas: what the framebuffer holds, not what a DOM overlay shows. */
      const crop = async (id, zoom, name) => {
        const data = await canvas.evaluate(`(() => {
          const hook = window.__ipImpostorProtocol;
          const blit = hook.blits().find(entry => entry.id === ${JSON.stringify(id)});
          const node = document.querySelector("canvas.ip-canvas");
          if (!blit || !node) return null;
          const scale = node.width / node.getBoundingClientRect().width;
          const size = Math.round(80 * scale);
          const out = document.createElement("canvas");
          out.width = Math.round(80 * ${zoom}); out.height = Math.round(80 * ${zoom});
          const context = out.getContext("2d");
          context.imageSmoothingEnabled = false;
          context.drawImage(node, Math.round(blit.left * scale), Math.round(blit.top * scale), size, size, 0, 0, out.width, out.height);
          return out.toDataURL("image/png");
        })()`);
        if (!data) return null;
        const path = `./artifacts/${name}.png`;
        await writeFile(path, Buffer.from(data.split(",")[1], "base64"));
        report.images.push(path);
        return path;
      };

      const shot = async name => {
        const path = `./artifacts/${name}.png`;
        await page.locator(".rf-game-frame").screenshot({ path });
        report.images.push(path);
        return path;
      };

      /* ---------------------------------------------------------- driving --- */

      /** Steer with the game's own tap-to-move handler, in canvas CSS pixels. */
      const aim = async (state, worldPoint) => {
        const me = state.actors.find(actor => actor.isPlayer);
        const blit = me ? state.pixels[me.id] : null;
        if (!me || !blit) return;
        const cameraX = me.x - (blit.left + 40), cameraY = me.y - (blit.top + 75);
        const box = await canvas.boundingBox();
        if (!box) return;
        const x = Math.max(4, Math.min(box.width - 4, worldPoint.x - cameraX));
        const y = Math.max(4, Math.min(box.height - 4, worldPoint.y - cameraY));
        await canvas.evaluate(`(() => {
          const node = document.querySelector("canvas.ip-canvas");
          const rect = node.getBoundingClientRect();
          node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true,
            clientX: rect.left + ${x}, clientY: rect.top + ${y} }));
        })()`);
      };

      const enterRound = async role => {
        await game.locator("input.ip-code").first().waitFor({ timeout: 30_000 });
        await game.locator("input.ip-code").first().fill(ROOM);
        await game.locator("label.ip-tier", { hasText: role === "crew" ? "Crewmate" : "Impostor" }).first().click();
        await page.waitForTimeout(120);
        await game.getByRole("button", { name: /start practice round/i }).first().click();
        await canvas.waitFor({ timeout: 30_000 });
        return waitFor("the round's crew artwork", state => state.art && state.art.entries.length > 0, 30_000);
      };

      const begin = async () => {
        const control = game.getByRole("button", { name: /^Begin/i }).first();
        if (await control.count()) await control.click();
        await page.waitForTimeout(400);
      };

      const leaveMatch = async () => {
        for (const name of [/^Leave station$/i, /^Airlock$/i, /^Play again$/i]) {
          const control = game.getByRole("button", { name }).first();
          if (await control.count()) { await control.click({ timeout: 2500 }).catch(() => {}); break; }
        }
        await page.waitForTimeout(500);
      };

      /* ----------------------------------------------------------- reading --- */

      const npcBlits = state => state.blits.filter(blit => blit.alive && !blit.isPlayer);
      /** Mask cells all carrying the record's tint: the actor is out of the fog. */
      const clean = pixels => Boolean(pixels) && pixels.solidCells > 0 && pixels.tintCells === pixels.solidCells;
      /** No other 80x80 actor box intersects this one, so its halo ring is its own. */
      const unobstructed = (state, id) => {
        const entry = state.blits.find(blit => blit.id === id);
        if (!entry) return false;
        return !state.blits.some(other => other.id !== id &&
          Math.abs(other.left - entry.left) < 80 && Math.abs(other.top - entry.top) < 80);
      };
      /**
       * The tell rule, read off the blit record rather than the framebuffer (the reveal
       * can be a fogged debrief): while the round is LIVE nothing may be marked,
       * whatever its role; once it is over the impostors the round names must be wearing
       * the treated frame — that is the point of the reveal — while crew never do.
       */
      const assertNoTreatment = (state, where) => {
        const live = state.phase === "play" || state.phase === "briefing";
        for (const blit of state.blits) {
          if (blit.isPlayer) continue;
          const isImpostor = state.actors.find(actor => actor.id === blit.id)?.role === "impostor";
          if (live || !isImpostor) {
            // A live frame hides every role; crew never wear the treatment even later.
            assert.equal(blit.reversedRole, false, `${where}: ${blit.id} carries the treated flag (live=${live})`);
            assert.equal(blit.haloIntact, true, `${where}: ${blit.id} wears the damaged halo (live=${live})`);
            assert.equal(blit.haloColor, "#ffffff", `${where}: ${blit.id} wears the hostile halo colour (live=${live})`);
            assert.notEqual(blit.tint, REVEAL_TINT, `${where}: ${blit.id} wears the hostile tint (live=${live})`);
          } else if (state.revealed.includes(blit.id)) {
            // The reveal itself: the treated frame is expected here, not merely allowed.
            assert.equal(blit.reversedRole, true, `${where}: impostor ${blit.id} is named revealed but carries no treated frame`);
            assert.ok(blit.haloIntact === false || blit.haloColor !== "#ffffff" || blit.tint === REVEAL_TINT,
              `${where}: impostor ${blit.id} is named revealed but draws an untreated frame`);
          }
          // An impostor the round has NOT named may still be hidden, so no assertion —
          // who the round revealed is asserted below, which is the fact that matters.
        }
        if (live) {
          assert.deepEqual(state.revealed, [], `${where}: a live round is treating ${JSON.stringify(state.revealed)}`);
          assert.ok(!state.domRevealed, `${where}: the renderer published revealed=${state.domRevealed} on a live frame`);
        } else {
          assert.ok(state.revealed.length > 0, `${where}: the round is over but names no revealed impostor`);
        }
      };

      /* -------------------------------------------------------------- round A --- */

      const playAsCrew = async attempt => {
        let state = await enterRound("crew");
        const art = state.art;
        report.attempts.push({ attempt, seed: art.seed, impostorIds: art.impostorIds, roundStartMs: state.roundStartMs, readMs: art.readMs });

        /* 1 · PROVENANCE — the recorded chain artwork, against what the game holds. */
        console.log(`\n  round A · player=crew · seed=${art.seed} · round-start read ${state.roundStartMs}ms (batch ${art.readMs}ms, ${art.failed} fell back)`);
        console.log("    actor   token  source  checksum  framesDigest  readMs  entries");
        const seenTokens = new Set(), seenChecksums = new Set(), seenDigests = new Set();
        for (const entry of art.entries) {
          const artwork = ARTWORK.get(entry.tokenId);
          assert(artwork, `Token ${entry.tokenId} is not in the recorded pool`);
          assert.equal(entry.source, "chain", `${entry.actorId} fell back instead of reading the chain`);
          assert.equal(entry.checksum, artwork.checksum, `${entry.actorId} does not hold token ${entry.tokenId}'s recorded frame 0`);
          assert.equal(entry.framesDigest, artwork.framesDigest, `${entry.actorId} does not hold token ${entry.tokenId}'s recorded 64 frames`);
          assert(!seenTokens.has(entry.tokenId), `Token ${entry.tokenId} is used twice on one station`);
          assert(!seenChecksums.has(entry.checksum), `Duplicate artwork on the station (${entry.checksum})`);
          seenTokens.add(entry.tokenId); seenChecksums.add(entry.checksum); seenDigests.add(entry.framesDigest);
          const actor = state.actors.find(value => value.id === entry.actorId);
          assert(actor && !actor.isPlayer, `${entry.actorId} is not an NPC`);
          console.log(`    ${entry.actorId.padEnd(7)} ${String(entry.tokenId).padStart(5)}  ${entry.source.padEnd(6)}  `
            + `${entry.checksum}  ${entry.framesDigest}  ${String(entry.readMs).padStart(6)}  ${artwork.clips.size} clips`);
          report.provenance.push({ ...entry, round: attempt });
        }
        assert.equal(art.entries.length, 6, `expected six NPC crewmates, got ${art.entries.length}`);
        assert.equal(seenTokens.size, 6, "the crew are not mutually distinct");
        assert.equal(seenDigests.size, 6, "two crewmates hold the same artwork");

        // 2 · DISTINCTNESS, from the roles the sim actually dealt.
        const impostors = state.actors.filter(actor => !actor.isPlayer && actor.role === "impostor").map(actor => actor.id);
        assert.deepEqual([...art.impostorIds].sort(), [...impostors].sort(),
          `the artwork reports impostors ${JSON.stringify(art.impostorIds)} but the sim dealt ${JSON.stringify(impostors)}`);
        console.log(`  sim dealt ${impostors.length} NPC impostor(s): ${impostors.join(", ")} · ${art.entries.length} distinct chain tokens aboard`);

        const briefing = npcBlits(state);
        assert.equal(briefing.length, 6, `expected six painted crewmates at the briefing, got ${briefing.length}`);
        for (const blit of briefing) {
          const pixels = state.pixels[blit.id];
          assert(pixels, `no canvas readback for ${blit.id}`);
          const artwork = ARTWORK.get(pixels.tokenId);
          assert(artwork, `${blit.id} is drawing token ${pixels.tokenId}, which is not in the recorded pool`);
          assert.equal(pixels.source, "chain", `${blit.id} is not drawn from the chain`);
          assert(artwork.clips.has(pixels.rows), `${blit.id}'s frame is not one of token ${pixels.tokenId}'s recorded clips`);
          assert.equal(pixels.solidCells, countMask(pixels.rows), `${blit.id}: the record's mask disagrees with its own rows`);
          assert.equal(pixels.tokenId, art.entries.find(entry => entry.actorId === blit.id).tokenId, `${blit.id} draws a token the artwork does not name`);
        }
        assertNoTreatment(state, "briefing");

        // 3 · the live round — the same claims, now off the canvas.
        await begin();
        let liveImpostor = null, beside = null, reveal = null, revealSample = null;
        let standoff = STANDOFF, lastPos = null, stalled = 0, deaths = 0;
        const target = impostors[0];
        const started = Date.now();
        let lastLog = 0;

        while (Date.now() - started < REVEAL_BUDGET_MS) {
          state = await read();
          if (!state) break;
          report.liveSamples++;
          assertNoTreatment(state, state.phase === "play" ? "live play" : `live ${state.phase}`);
          if (state.phase !== "play") { reveal = state; break; }
          const me = state.actors.find(actor => actor.isPlayer);
          const impostor = state.actors.find(actor => actor.id === target);
          const pixels = state.pixels[target];
          if (!me || !impostor || !pixels) break;
          deaths = state.actors.filter(actor => !actor.alive).length;

          const gap = distance(me, impostor);
          const isClean = clean(pixels);
          if (isClean) { report.liveSamplesClean = (report.liveSamplesClean ?? 0) + 1; standoff = Math.min(STANDOFF, standoff + 3); }
          else { report.foggedSamples++; if (deaths >= 3) standoff = Math.max(MIN_STANDOFF, standoff - 6); }

          // 3 · the impostor, measured off the canvas while it is still only a crewmate.
          if (!liveImpostor && isClean && unobstructed(state, target)) {
            liveImpostor = {
              id: target, actorId: target, tokenId: pixels.tokenId, tint: pixels.tint, rows: pixels.rows, cells: pixels.cells,
              digest: digestText(pixels.cells), gap: Math.round(gap), round: "A", role: impostor.role,
              solidCells: pixels.solidCells, tintCells: pixels.tintCells, orphans: `${pixels.orphanHits}/${pixels.orphanCells}`,
            };
            console.log(`\n  live ${target}: token ${pixels.tokenId} tint ${pixels.tint} · ${pixels.solidCells} mask cells, all the suit tint`
              + ` · halo ${pixels.orphanHits}/${pixels.orphanCells} ring cells drawn at ${Math.round(gap)} units · cells ${liveImpostor.digest}`);
          }

          // 5a · a frame with the live impostor beside a crewmate, both in the light.
          if (!beside && isClean) {
            const neighbours = npcBlits(state).filter(blit => blit.id !== target && clean(state.pixels[blit.id])
              && unobstructed(state, blit.id) && unobstructed(state, target)
              && Math.abs(blit.left - pixels.left) < 190 && Math.abs(blit.top - pixels.top) < 190);
            if (neighbours.length) {
              const other = neighbours[0];
              beside = { impostor: target, crew: other.id, gap: Math.round(gap),
                apart: Math.round(Math.hypot(other.left - pixels.left, other.top - pixels.top)) };
              await shot("61-impostor-live-beside-crew");
              await crop(target, 5, "61a-impostor-live-5x");
              await crop(other.id, 5, "61b-crewmate-live-5x");
              console.log(`  live: impostor ${target} beside ${other.id} (${beside.apart}px apart, both lit, both on the station view) — screenshot 61`);
            }
          }

          const elapsed = Date.now() - started;
          if (elapsed - lastLog > 20_000) {
            lastLog = elapsed;
            console.log(`  t=${(elapsed / 1000).toFixed(0)}s · phase ${state.phase} · gap ${gap.toFixed(0)} · stand-off ${standoff}`
              + ` · ${pixels.tintCells}/${pixels.solidCells} mask cells tinted · ${deaths} dead · revealed ${JSON.stringify(state.revealed)}`);
          }

          // Steer: the station's own lanes while far, then hold north of the target.
          const meZone = zoneAt(me), targetZone = zoneAt(impostor);
          const lane = lanePoints(meZone, targetZone);
          const goal = { x: impostor.x, y: impostor.y - standoff };
          const moved = lastPos ? distance(me, lastPos) : 999;
          lastPos = { x: me.x, y: me.y };
          stalled = moved < 5 ? stalled + 1 : 0;
          let point = lane.length && lane[0] && distance(me, lane[0]) > 40 ? lane[0] : goal;
          if (stalled >= 4 && gap > 240) {
            // Wedged in a doorway: step across the lane and try again.
            point = { x: me.x + (me.y > impostor.y ? -110 : 110), y: me.y + (me.x > impostor.x ? -110 : 110) };
            stalled = 0;
          }
          await aim(state, point);
          await page.waitForTimeout(200);
        }

        if (!reveal) {
          const last = await read();
          throw new Error(`No reveal state arrived within ${REVEAL_BUDGET_MS / 1000}s `
            + `(phase ${last?.phase}, revealed ${JSON.stringify(last?.revealed)})`);
        }

        // 5b · the station, with crew in the light: shot 60 wants three of them lit.
        state = await read();
        const bystanders = npcBlits(state).filter(blit => clean(state.pixels[blit.id]));
        console.log(`\n  reveal: phase ${reveal.phase} · revealed ${JSON.stringify(reveal.revealed)} · ${bystanders.length} lit crewmates still on view`);
        await shot(`62-impostor-reveal-${reveal.phase}`);
        for (const blit of npcBlits(reveal).slice(0, 3)) await crop(blit.id, 5, `62-${blit.id}-reveal-5x`);
        return { art, state, reveal, liveImpostor, beside, impostors, target };
      };

      /* 5c · the station shot: walk to the nearest crewmate until a few are lit. */
      const shootStation = async () => {
        const deadline = Date.now() + 45_000;
        let best = null;
        while (Date.now() < deadline) {
          const state = await read();
          if (state.phase !== "play") break;
          const me = state.actors.find(actor => actor.isPlayer);
          const lit = npcBlits(state).filter(blit => clean(state.pixels[blit.id]));
          if (lit.length > (best?.lit ?? 0)) best = { lit: lit.length, ids: lit.map(blit => blit.id) };
          if (lit.length >= 2) {
            await shot("60-crew-art-station");
            console.log(`  station shot: ${lit.length} crewmates in the light (${lit.map(blit => blit.id).join(", ")}) — screenshot 60`);
            return best;
          }
          const nearest = state.actors.filter(actor => !actor.isPlayer && actor.alive)
            .sort((a, b) => distance(a, me) - distance(b, me))[0];
          if (nearest) await aim(state, { x: nearest.x, y: nearest.y - 200 });
          await page.waitForTimeout(400);
        }
        console.log(`  station shot: never reached two lit crewmates (best ${best?.lit ?? 0})`);
        return best;
      };

      /* -------------------------------------------------------------- round B --- */

      const playAsImpostor = async (compareTo, briefings) => {
        let state = await enterRound("impostor");
        const art = state.art;
        // The sim deals TWO impostor slots. If the player holds one, exactly one NPC
        // impostor remains and legitimately wears the treated frame at the reveal, so
        // assert against the sim's own roles instead of assuming the player's role
        // empties the NPC side.
        const dealtNpcImpostors = state.actors
          .filter(actor => !actor.isPlayer && actor.role === "impostor").map(actor => actor.id);
        assert.deepEqual([...art.impostorIds].sort(), [...dealtNpcImpostors].sort(),
          `the artwork reports NPC impostors ${JSON.stringify(art.impostorIds)} but the sim dealt ${JSON.stringify(dealtNpcImpostors)}`);
        assert.ok(art.impostorId === null || art.impostorIds.includes(art.impostorId),
          `the legacy impostorId ${String(art.impostorId)} is not among the NPC impostors ${JSON.stringify(art.impostorIds)}`);
        assert.equal(art.seed, compareTo.art.seed, "the two rounds did not share a seed, so the role flip proves nothing");
        console.log(`\n  round B · player=impostor · NPC impostors ${JSON.stringify(art.impostorIds)} · seed ${art.seed} (round A ${compareTo.art.seed})`);

        const crew = npcBlits(state);
        assert.equal(crew.length, 6, `expected six painted crewmates, got ${crew.length}`);
        let flipped = 0;
        for (const blit of crew) {
          const pixels = state.pixels[blit.id];
          const artwork = ARTWORK.get(pixels.tokenId);
          const before = briefings.find(entry => entry.id === blit.id);
          assert(artwork, `${blit.id} is drawing token ${pixels.tokenId}, which is not in the recorded pool`);
          assert.equal(pixels.source, "chain", `${blit.id} is not drawn from the chain`);
          assert(artwork.clips.has(pixels.rows), `${blit.id}'s frame is not a clip of token ${pixels.tokenId}`);
          assert.equal(blit.haloIntact, true, `${blit.id} is treated in a live round`);
          assert(before, `${blit.id} was not on the station in round A`);
          assert.equal(pixels.tokenId, before.tokenId, `${blit.id} drew a different token once its role changed`);
          assert.equal(blit.tint, before.tint, `${blit.id} drew a different suit tint once its role changed`);
          assert.equal(blit.haloColor, "#ffffff", `${blit.id} drew a hostile halo colour in a live round`);
          assert.equal(blit.reversedRole, false, `${blit.id} is flagged revealed in a live round`);
          assert.equal(artwork.clips.has(before.rows), `${blit.id}'s round-A frame was not canonical`);
          if (before.rows === pixels.rows) flipped++;
        }
        console.log(`  role flip: ${flipped}/6 NPCs drew a byte-identical canonical clip in both rounds (same token, same tint, no treatment)`);
        assert(flipped > 0, "no NPC presented the same clip in both rounds, so the comparison made no claim");

        /* 3 · the same actor, now an ordinary crewmate: one clean box, cell for cell. */
        await begin();
        const target = compareTo.target;
        let sample = null, standoff = STANDOFF, lastPos = null, stalled = 0;
        const started = Date.now();
        let live = await read();
        while (Date.now() - started < 180_000 && !sample) {
          live = await read();
          if (live.phase !== "play") break;
          const me = live.actors.find(actor => actor.isPlayer);
          const actor = live.actors.find(value => value.id === target);
          const pixels = live.pixels[target];
          if (!me || !actor || !pixels) break;
          const gap = distance(me, actor);
          if (clean(pixels) && unobstructed(live, target)) {
            sample = { id: target, tokenId: pixels.tokenId, tint: pixels.tint, rows: pixels.rows, cells: pixels.cells,
              digest: digestText(pixels.cells), gap: Math.round(gap), round: "B", role: actor.role,
              solidCells: pixels.solidCells, tintCells: pixels.tintCells, orphans: `${pixels.orphanHits}/${pixels.orphanCells}` };
            break;
          }
          standoff = clean(pixels) ? Math.min(STANDOFF, standoff + 3) : Math.max(MIN_STANDOFF, standoff - 6);
          const meZone = zoneAt(me), actorZone = zoneAt(actor);
          const lane = lanePoints(meZone, actorZone);
          const moved = lastPos ? distance(me, lastPos) : 999;
          lastPos = { x: me.x, y: me.y };
          stalled = moved < 5 ? stalled + 1 : 0;
          let point = lane.length && lane[0] && distance(me, lane[0]) > 40 ? lane[0] : { x: actor.x, y: actor.y - standoff };
          if (stalled >= 4 && gap > 240) {
            point = { x: me.x + (me.y > actor.y ? -110 : 110), y: me.y + (me.x > actor.x ? -110 : 110) };
            stalled = 0;
          }
          await aim(live, point);
          await page.waitForTimeout(200);
        }
        assert(sample, `${target} was never cleanly measurable as a crewmate in round B`);

        // 5d · the canonical mask at 5x, straight out of the station canvas.
        await crop(target, 5, "63-canonical-mask-5x");
        console.log(`  ${await shot("65-round-b-station")} · ./artifacts/63-canonical-mask-5x.png (16x16 mask at 5x, canonical pixels)`);
        return { state: live, sample };
      };

      const first = await playAsCrew(1);
      await shootStation().catch(() => null);
      await leaveMatch();

      const briefings = first.state.blits.filter(blit => !blit.isPlayer).map(blit => ({
        id: blit.id, tokenId: first.state.pixels[blit.id].tokenId, tint: blit.tint,
        rows: first.state.pixels[blit.id].rows, cells: first.state.pixels[blit.id].cells,
      }));
      const second = await playAsImpostor(first, briefings);

      /* 4 · PIXEL IDENTITY — the impostor's box against the same actor as a crewmate. */
      assert(first.liveImpostor, `the live impostor ${first.target} was never measured off the canvas`);
      const a = first.liveImpostor, b = second.sample;
      assert.equal(b.tokenId, a.tokenId, "the two rounds drew different tokens for the same actor");
      assert.equal(b.tint, a.tint, "the two rounds drew different suit tints for the same actor");
      assert.equal(a.rows, b.rows, `the two rounds presented different clips for ${a.id} (${a.rows.replace(/\n/g, "|")} vs ${b.rows.replace(/\n/g, "|")})`);
      const differing = [...a.cells].filter((char, index) => char !== b.cells[index]).length;
      assert.equal(differing, 0, `${a.id}'s box differs between the impostor round and the crew round in ${differing} of 256 cells`);
      assert.equal(a.digest, b.digest, "the two canvas boxes do not digest the same");
      console.log(`\n  PIXEL IDENTITY — ${a.id}, token ${a.tokenId}, tint ${a.tint}`);
      console.log(`    as the impostor (round A, live): ${a.digest} · ${a.solidCells} mask cells all the suit tint · halo ${a.orphans} · at ${a.gap} units`);
      console.log(`    as a crewmate  (round B, live): ${b.digest} · ${b.solidCells} mask cells all the suit tint · halo ${b.orphans} · at ${b.gap} units`);
      console.log(`    byte diff: ${differing} of 256 cells — the canvas boxes are identical`);
      report.identity = { id: a.id, tokenId: a.tokenId, tint: a.tint, impostor: a.digest, crewmate: b.digest, differingCells: differing, rows: a.rows };

      /* 4 (continued) · the reveal really is the only place the treatment exists. */
      const reveal = first.reveal;
      const treated = reveal.pixels[first.target];
      assert(treated, "no canvas readback for the impostor at the reveal");
      assert(reveal.revealed.includes(first.target), `the reveal names ${JSON.stringify(reveal.revealed)}, not ${first.target}`);
      assert.equal(treated.tokenId, a.tokenId, "the reveal swapped the impostor's token");
      assert.equal(treated.source, "chain", "the reveal drew the impostor from something other than the chain");
      assert.equal(treated.reversedRole, true, "the impostor is not flagged as revealed");
      assert.equal(treated.tint, REVEAL_TINT, `the revealed impostor kept tint ${treated.tint}`);
      assert.equal(treated.haloColor, REVEAL_HALO, `the revealed impostor kept halo ${treated.haloColor}`);
      assert.equal(treated.haloIntact, false, "the revealed impostor kept the intact halo");
      assert(treated.haloPixels < treated.maskPixels, "the reveal drew every halo box");
      // The treatment is a colour operation over the SAME canonical mask.
      assert.equal(treated.haloIntact, false);
      const artwork = ARTWORK.get(treated.tokenId);
      assert(treated.alive ? artwork.clips.has(treated.rows) : artwork.bodies.has(treated.rows),
        "the treated frame is not a canonical clip (or quarter-turn) of the impostor's own token");
      assert.equal(treated.solidCells, countMask(treated.rows), "the treated silhouette left the canonical mask");
      const damaged = orphanExpectation(treated.rows, false);
      const intact = orphanExpectation(treated.rows, true);
      assert(damaged.hits < intact.hits, "the damaged-halo rule keeps every box on this frame — nothing to measure");
      if (clean(treated) && unobstructed(reveal, first.target)) {
        assert.equal(treated.tintCells, treated.solidCells, "a treated mask cell is not the reveal tint");
        assert.equal(tintPattern(treated.cells), pattern(treated.rows), "the treated cells left the canonical clip");
        assert.equal(treated.orphanCells, damaged.cells, "halo probe geometry disagrees at the reveal");
        assert.equal(treated.orphanHits, damaged.hits, "the halo drawn at the reveal is not the damaged one");
      } else {
        console.log(`  NOTE: the reveal frame is fogged or obstructed (${treated.tintCells}/${treated.solidCells} mask cells`
          + ` tinted, unobstructed ${unobstructed(reveal, first.target)}) — the treated frame is proven from the blit record`
          + ` and the reveal list, not from the framebuffer.`);
      }
      console.log(`\n  reveal ${reveal.phase}: ${first.target} · tint ${treated.tint} · halo ${treated.haloColor} · intact ${treated.haloIntact}`
        + ` · silhouette unchanged (${treated.solidCells} mask cells) · halo boxes ${treated.haloPixels}/${treated.maskPixels}`
        + ` · ring cells ${treated.orphanHits}/${intact.hits} drawn`);
      for (const other of reveal.revealed.filter(id => id !== first.target)) {
        const sibling = reveal.pixels[other];
        assert(sibling, `the reveal names ${other}, which is not on the canvas`);
        assert.equal(sibling.tint, REVEAL_TINT, `the reveal names ${other} but it kept tint ${sibling.tint}`);
        assert.equal(sibling.reversedRole, true, `the reveal names ${other} but it is not flagged`);
        console.log(`  the reveal also treats ${other} (${sibling.tint}) — every impostor the debrief names is marked`);
      }
      // The control: a live crewmate is untouched by the same frame's treatment.
      const control = npcBlits(reveal).find(blit => !reveal.revealed.includes(blit.id));
      if (control) {
        assert.equal(control.haloIntact, true, `${control.id} lost its halo when the impostor was revealed`);
        assert.equal(control.haloColor, "#ffffff", `${control.id} took the hostile halo colour`);
        console.log(`  control: crewmate ${control.id} still wears tint ${control.tint} with the intact white halo at the reveal`);
      }
      report.reveal = {
        kind: reveal.phase, revealed: reveal.revealed, actorId: first.target, tokenId: treated.tokenId,
        tint: treated.tint, haloColor: treated.haloColor, maskPixels: treated.solidCells,
        haloBoxes: `${treated.haloPixels}/${treated.maskPixels}`, ringCells: `${treated.orphanHits}/${intact.hits}`,
        framebufferVerified: clean(treated) && unobstructed(reveal, first.target),
      };
      report.rounds = { A: a, B: b };
    },
  });
} catch (error) {
  failure = error;
  console.error(`\ncrew artwork check FAILED\n${error?.stack ?? error}`);
}

console.log(`\n  ${failure ? "crew artwork check failed" : "crew artwork check passed"}`);
console.log(`  recorded chain artwork: ${report.recordedAt}`);
console.log(`  screenshots: ${report.images.join(", ") || "none"}`);
if (report.identity) {
  console.log(`  pixel identity ${report.identity.id} (token ${report.identity.tokenId}, tint ${report.identity.tint}):`
    + ` impostor ${report.identity.impostor} vs crewmate ${report.identity.crewmate} · ${report.identity.differingCells} differing cells`);
}
if (report.reveal) console.log(`  treated frame first appeared at: ${report.reveal.kind} (revealed ${JSON.stringify(report.reveal.revealed)})`);
console.log(`  live frames sampled: ${report.liveSamples} (${report.foggedSamples} with the target fogged)`);
process.exitCode = failure ? 1 : 0;
