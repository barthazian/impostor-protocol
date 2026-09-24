/**
 * Scratch probe for tests/crew-art-check.mjs — what does the station actually
 * hand a check, and can the impostor be held at a measurable stand-off?
 *
 *   node games/impostor-protocol/tests/_probe-crew-state.mjs [seconds]
 *
 * It plays no assertions: it prints the briefing layout, chases one NPC impostor
 * and prints the framebuffer readback of its 80x80 box over time, then a cell
 * classification grid (T = the suit tint, H = the halo colour, t = a solid cell
 * that is neither, o = an opaque non-solid cell, space = transparent).
 */
import { testGame } from "@rarefriends/friendsdk/testing";

const ROOM = "CREW";
const CHASE_MS = Number(process.argv[2] ?? 40) * 1000;
const STANDOFF = 95;

await testGame("./games/impostor-protocol", {
  width: 1280, height: 800, timeout: 60_000,
  check: async ({ page, game }) => {
    const canvas = game.locator("canvas.ip-canvas").first();
    const read = () => game.locator("body").evaluate(`(() => {
      const hook = window.__ipImpostorProtocol;
      if (!hook) return null;
      const blits = hook.blits();
      const node = document.querySelector("canvas.ip-canvas");
      return {
        phase: hook.phase(), revealed: hook.revealed(), actors: hook.actors(), blits,
        pixels: Object.fromEntries(blits.map(entry => [entry.id, hook.pixels(entry.id)])),
        art: hook.crewArt(), roundStartMs: hook.roundStartMs(),
        domRevealed: node ? node.dataset.revealed : null,
        canvas: node ? { w: node.width, h: node.height, cssW: Math.round(node.getBoundingClientRect().width) } : null,
      };
    })()`);
    const grid = (id) => game.locator("body").evaluate(`(() => {
      const hook = window.__ipImpostorProtocol;
      const blit = hook.blits().find(entry => entry.id === ${JSON.stringify(id)});
      if (!blit) return null;
      const node = document.querySelector("canvas.ip-canvas");
      const scale = node.width / node.getBoundingClientRect().width;
      const left = Math.round(blit.left * scale), top = Math.round(blit.top * scale);
      const w = Math.round(80 * scale), h = Math.round(80 * scale);
      const data = node.getContext("2d").getImageData(left, top, w, h).data;
      const at = (x, y) => { const px = Math.min(w - 1, Math.max(0, Math.round((x + 0.5) * scale)));
        const py = Math.min(h - 1, Math.max(0, Math.round((y + 0.5) * scale))); const i = (py * w + px) * 4;
        return [data[i], data[i + 1], data[i + 2], data[i + 3]]; };
      const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
      const tint = hex(blit.tint), halo = hex(blit.haloColor);
      const near = (a, b) => a[3] > 240 && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= 24;
      const rows = blit.rows.split("\\n");
      let out = "";
      for (let py = 0; py < 16; py++) {
        for (let px = 0; px < 16; px++) {
          const p = at(px * 5 + 2, py * 5 + 2);
          out += rows[py][px] === "#" ? (near(p, tint) ? "T" : "t") : (near(p, halo) ? "H" : (p[3] > 8 ? "o" : " "));
        }
        out += "\\n";
      }
      return { grid: out, box: [blit.left, blit.top], tint: blit.tint, halo: blit.haloColor };
    })()`);

    await game.locator("input.ip-code").first().waitFor({ timeout: 30_000 });
    await game.locator("input.ip-code").first().fill(ROOM);
    await game.locator("label.ip-tier", { hasText: "Crewmate" }).first().click();
    await game.getByRole("button", { name: /start practice round/i }).first().click();
    const box = await canvas.boundingBox();

    const dump = (label, state) => {
      const me = state.actors.find(actor => actor.isPlayer);
      console.log(`\n--- ${label}: phase=${state.phase} revealed=${JSON.stringify(state.revealed)} dom=${JSON.stringify(state.domRevealed)} canvas=${JSON.stringify(state.canvas)}`);
      console.log(`    canvas box ${box.width}x${box.height} · art entries=${state.art?.entries.length} impostors=${JSON.stringify(state.art?.impostorIds)} readMs=${state.art?.readMs} roundStartMs=${state.roundStartMs}`);
      console.log("    id      who     alive token role      tint     halo     intact box        solid tinted fogged orphan dist");
      for (const blit of state.blits) {
        const px = state.pixels[blit.id];
        const actor = state.actors.find(value => value.id === blit.id);
        if (!px) { console.log(`    ${blit.id} NO READBACK`); continue; }
        console.log(`    ${blit.id.padEnd(7)} ${(blit.isPlayer ? "player" : "npc").padEnd(7)} ${String(blit.alive).padEnd(5)} `
          + `${String(px.tokenId).padEnd(5)} ${blit.role.padEnd(9)} ${blit.tint.padEnd(8)} ${blit.haloColor.padEnd(8)} ${String(blit.haloIntact).padEnd(6)} `
          + `(${String(px.left).padStart(4)},${String(px.top).padStart(4)}) ${String(px.solidCells).padStart(5)} ${String(px.tintCells).padStart(6)} `
          + `${String(px.solidCells - px.tintCells).padStart(6)} ${String(px.orphanHits).padStart(3)}/${String(px.orphanCells).padEnd(4)} `
          + `${me && actor ? Math.round(Math.hypot(actor.x - me.x, actor.y - me.y)) : "?"}`);
      }
    };

    const state = await read();
    dump("briefing", state);
    await game.getByRole("button", { name: /^Begin/i }).first().click();
    await page.waitForTimeout(1200);
    dump("play", await read());

    const target = (state.art.impostorIds ?? [state.art.impostorId])[0];
    console.log(`\n  chasing ${target} at a ${STANDOFF}-unit stand-off for ${CHASE_MS / 1000}s`);
    const started = Date.now();
    let lastLog = 0, lit = 0, samples = 0, best = null;
    let standoff = STANDOFF, lastPos = null, stalled = 0, leg = "h";
    while (Date.now() - started < CHASE_MS) {
      const value = await read();
      const me = value.actors.find(actor => actor.isPlayer);
      const impostor = value.actors.find(actor => actor.id === target);
      const px = value.pixels[target];
      if (!me || !impostor || !px) break;
      const gap = Math.hypot(me.x - impostor.x, me.y - impostor.y);
      samples++;
      const clean = px.solidCells > 0 && px.tintCells === px.solidCells;
      if (clean) { lit++; if (standoff < STANDOFF) standoff = Math.min(STANDOFF, standoff + 3); }
      else standoff = Math.max(38, standoff - 12);
      if (clean && (!best || Math.abs(gap - STANDOFF) < Math.abs(best.gap - STANDOFF))) {
        best = { gap: Math.round(gap), solid: px.solidCells, tinted: px.tintCells, orphans: `${px.orphanHits}/${px.orphanCells}`, box: [px.left, px.top] };
      }
      const elapsed = Date.now() - started;
      if (elapsed - lastLog > 5000) {
        lastLog = elapsed;
        console.log(`  t=${(elapsed / 1000).toFixed(0)}s phase=${value.phase} gap=${gap.toFixed(0)} standoff=${standoff} solid=${px.solidCells} `
          + `tinted=${px.tintCells} box=(${px.left},${px.top}) orphans=${px.orphanHits}/${px.orphanCells} `
          + `dead=${value.actors.filter(actor => !actor.alive).length} player=${me.alive ? "alive" : "DEAD"} revealed=${JSON.stringify(value.revealed)}`);
      }
      if (value.phase !== "play") { console.log(`  phase left play at ${(elapsed / 1000).toFixed(1)}s: ${value.phase} revealed=${JSON.stringify(value.revealed)} gap=${gap.toFixed(0)}`); break; }
      const moved = lastPos ? Math.hypot(me.x - lastPos.x, me.y - lastPos.y) : 999;
      lastPos = { x: me.x, y: me.y };
      stalled = moved < 5 ? stalled + 1 : 0;
      // The station is axis-aligned rectangles, so an L-shaped two-leg walk beats a
      // straight line into a wall; swap which leg leads whenever the player stops
      // making progress.
      if (stalled >= 3) { leg = leg === "h" ? "v" : "h"; stalled = 0; }
      const dx = impostor.x - me.x, dy = impostor.y - me.y;
      let point;
      if (gap < 200) {
        point = { x: impostor.x, y: impostor.y - standoff };
      } else if (leg === "h") {
        point = Math.abs(dx) > 40 ? { x: impostor.x, y: me.y } : { x: impostor.x, y: impostor.y - standoff };
      } else {
        point = Math.abs(dy) > 40 ? { x: me.x, y: impostor.y - standoff } : { x: impostor.x, y: impostor.y - standoff };
      }
      const cameraX = me.x - (value.pixels.player.left + 40), cameraY = me.y - (value.pixels.player.top + 75);
      const x = Math.max(6, Math.min(box.width - 6, point.x - cameraX));
      const y = Math.max(6, Math.min(box.height - 6, point.y - cameraY));
      await canvas.evaluate(`(() => {
        const node = document.querySelector("canvas.ip-canvas");
        const rect = node.getBoundingClientRect();
        node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: rect.left + ${x}, clientY: rect.top + ${y} }));
      })()`);
      await page.waitForTimeout(220);
    }
    console.log(`  clean samples: ${lit}/${samples} · best ${JSON.stringify(best)}`);
    dump("final", await read());
    const grade = await grid(target);
    if (grade) {
      console.log(`\n  ${target} box=(${grade.box}) tint=${grade.tint} halo=${grade.halo}`);
      console.log(grade.grid.split("\n").map(line => `    |${line}|`).join("\n"));
    }
  },
});
console.log("probe done");
