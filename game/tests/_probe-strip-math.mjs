/**
 * Probe: the reveal strip's cell math against the RECORDED chain artwork, so the
 * strip check's thresholds and its "frame 0 is the idle-down clip" assumption are
 * measured before the multi-minute browser run. Read-only, never part of the build.
 *
 *   node games/impostor-protocol/tests/_probe-strip-math.mjs
 */
import { decodeGenerationSprites, decodeSpriteBitmap } from "@rarefriends/friendsdk/sprites";
import { CREW_POOL } from "../../../scripts/crew-pool.mjs";

const haloKept = (px, py, intact) => intact || (px * 7 + py * 13) % 3 !== 0;

for (const [id, record] of Object.entries(CREW_POOL)) {
  const sprites = decodeGenerationSprites(BigInt(id), record.familyId, record.seed, record.frames);
  const rows = decodeSpriteBitmap(record.frames[0]).rows;
  const idle = sprites.clips.idle.down[0].rows;
  const solid = (x, y) => rows[y]?.[x] === "#";
  let mask = 0, orphans = 0, orphansKept = 0, boxes = 0;
  for (let py = 0; py < 16; py++) {
    for (let px = 0; px < 16; px++) {
      if (solid(px, py)) {
        mask++;
        if (haloKept(px, py, false)) boxes++;
        continue;
      }
      let neighbours = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && solid(px + dx, py + dy)) neighbours++;
      }
      if (neighbours === 1) {
        orphans++;
        if (haloKept(px, py, false)) orphansKept++;
      }
    }
  }
  const same = rows.join("/") === idle.join("/");
  console.log(`token ${id}: rows ${rows.length}x${rows[0].length} · mask ${mask} · halo boxes (damaged) ${boxes}`
    + ` · single-neighbour cells ${orphans} (kept ${orphansKept}, dropped ${orphans - orphansKept})`
    + ` · frame0 === clips.idle.down[0]: ${same}`);
  if (mask < 24) throw new Error(`token ${id} has only ${mask} mask cells, below the check's floor`);
  if (orphans < 8) throw new Error(`token ${id} has only ${orphans} single-neighbour cells, below the check's floor`);
  if (!same) throw new Error(`token ${id}: frame 0 is not the idle-down clip`);
}
console.log("strip math probe passed: every pool token clears the check's floors and frame 0 is the idle-down clip");
