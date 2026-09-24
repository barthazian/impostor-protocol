/**
 * IMPOSTOR PROTOCOL — station renderer.
 *
 * Owns the whole fixed 960x640 backing store: metal floors and walls, task
 * consoles, vents, the emergency button, depth-sorted actors (the player's
 * canonical Friend mask, original crewmate bot art, dead bodies), sabotage
 * washes, the fog of war and the minimap.
 *
 * Rules held here: no React, no DOM beyond the canvas we were handed, no
 * randomness of any kind (every frame is a pure function of `MatchState` +
 * `RenderOptions`), and no per-frame heap churn beyond a handful of tiny path
 * objects, so a 60 fps loop stays flat.
 */

import { CREW_COLORS, type Actor, type CrewColorId, type MatchState, type Station, type TaskStation, type Vec, type Vent, type Zone } from "./types";
import { spriteFrame, type GenerationSprites } from "@rarefriends/friendsdk/sprites";

export const VIEW_WIDTH = 960;
export const VIEW_HEIGHT = 640;

export type RenderOptions = Readonly<{
  /** Canonical artwork loaded by index.tsx via createFriendReader(). */
  playerSprites: GenerationSprites;
  /** Resolved hex used to tint the player's canonical mask like a crew suit. */
  playerColor: string;
  /** Vision radius in world pixels (210 normally, 90 while the lights are out). */
  visionRadius: number;
  reducedMotion: boolean;
  /** Millisecond animation clock. */
  time: number;
  showMinimap: boolean;
}>;

export type Renderer = Readonly<{
  paint(state: MatchState, options: RenderOptions): void;
  /** Convert a pointer event position (CSS pixels relative to the canvas) into world coordinates. */
  screenToWorld(clientX: number, clientY: number, canvasRect: { left: number; top: number; width: number; height: number }): Vec;
  readonly camera: Vec;
}>;

/* ------------------------------------------------------------------ */
/* palette and layout                                                  */
/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2;

const SPACE = "#06090f";
const ROOM_FLOOR = "#8d99aa";
const CORRIDOR_FLOOR = "#78838f";
const ROOM_PLATE = "rgba(255, 255, 255, 0.05)";
const ROOM_PLATE_LOW = "rgba(10, 14, 22, 0.12)";
const WALL_FILL = "#1b2230";
const WALL_EDGE = "#3a475a";
const SEAM = "rgba(56, 66, 82, 0.55)";
const SEAM_CORRIDOR = "rgba(44, 54, 68, 0.5)";
const INK = "#10141c";
const ACCENT_TASK = "#ccff00";
const SHADOW = "rgba(4, 6, 10, 0.2)";
const DANGER = "#ff5f5f";

/** Thickness of the dark wall drawn around every zone rectangle. */
const WALL = 8;
/** Panel seam spacing inside a floor. */
const PANEL = 56;
/** The fog gradient is authored once at this radius and scaled per frame. */
const FOG_ART = 256;
/** An actor stays on the minimap while `state.time - lastSeen` is under this many seconds. */
const MINIMAP_SEEN_SECONDS = 6;

const ROOM_ACCENTS = ["#4f8cff", "#ff9a3d", "#7de08a", "#e05fd0", "#ffd23d", "#54d8e0", "#b48cff", "#ff6b6b"] as const;

const FONT_TAG = '700 13px system-ui, "Segoe UI", Roboto, sans-serif';
const FONT_LABEL = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
const FONT_MAP = '700 10px ui-monospace, SFMono-Regular, Menlo, monospace';
/** Zone-name fonts are cached per integer size so no string is built per frame. */
const ZONE_FONTS: readonly string[] = Array.from({ length: 18 }, (_, size) =>
  `700 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`);

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Deterministic 2D hash in [0, 1); the star field and jitter come from this, never Math.random. */
function hash01(a: number, b: number): number {
  let h = Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2d);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** FNV-1a over a string; used for stable per-zone and per-actor variation. */
function hashCode(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function parseHex(hex: string): readonly [number, number, number] {
  const text = hex.trim();
  const body = text.startsWith("#") ? text.slice(1) : text;
  const expanded = body.length === 3 ? `${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}` : body;
  const value = Number.parseInt(expanded, 16);
  return Number.isFinite(value) ? [(value >> 16) & 255, (value >> 8) & 255, value & 255] : [214, 224, 240];
}

/** Mix a hex colour toward black (target 0) or white (target 255). */
function mixHex(hex: string, target: number, amount: number): string {
  const [r, g, b] = parseHex(hex);
  const mix = (channel: number) => Math.round(channel + (target - channel) * amount);
  return `#${((1 << 24) | (mix(r) << 16) | (mix(g) << 8) | mix(b)).toString(16).slice(1)}`;
}

type Shades = Readonly<{ body: string; dark: string; light: string; rim: string; visor: string }>;

/** Precomputed bot shades: one entry per crew colour, built once at module load. */
const CREW_SHADES: Readonly<Record<string, Shades>> = Object.freeze(Object.fromEntries(
  Object.keys(CREW_COLORS).map(id => {
    const hex = CREW_COLORS[id as CrewColorId];
    return [id, Object.freeze({
      body: hex,
      dark: mixHex(hex, 0, 0.44),
      light: mixHex(hex, 255, 0.3),
      rim: mixHex(hex, 0, 0.7),
      visor: "#b9dcf2",
    })];
  }),
));
const FALLBACK_SHADES: Shades = Object.freeze({
  body: "#c6d2e6", dark: "#6f7a8c", light: "#e6ecf5", rim: "#3c4452", visor: "#b9dcf2",
});

function shadesFor(color: CrewColorId): Shades {
  return CREW_SHADES[color] ?? FALLBACK_SHADES;
}

function accentFor(zone: Zone): string {
  return ROOM_ACCENTS[hashCode(zone.id) % ROOM_ACCENTS.length];
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Three stacked ellipses read as one soft shadow without gradients or offscreen buffers. */
function paintShadow(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
  ctx.fillStyle = SHADOW;
  for (let layer = 0; layer < 3; layer++) {
    const scale = 1 - layer * 0.3;
    ctx.beginPath();
    ctx.ellipse(x, y, (width * 0.5) * scale, (height * 0.5) * scale, 0, 0, TAU);
    ctx.fill();
  }
}

function paintTag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, underline: string | null): void {
  ctx.font = FONT_TAG;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = "rgba(8, 11, 17, 0.92)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, x, y);
  if (underline) {
    const width = ctx.measureText(text).width;
    ctx.fillStyle = underline;
    ctx.fillRect(x - width / 2, y + 3, width, 2);
  }
}

function paintLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.font = FONT_LABEL;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(8, 11, 17, 0.82)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "rgba(228, 238, 252, 0.94)";
  ctx.fillText(text, x, y);
}

/* ------------------------------------------------------------------ */
/* renderer state                                                      */
/* ------------------------------------------------------------------ */

type ConsoleState = "available" | "active" | "done";

type Scene = {
  readonly ctx: CanvasRenderingContext2D;
  readonly camera: { x: number; y: number };
  readonly fog: CanvasGradient;
  readonly reactor: CanvasGradient;
  readonly o2: CanvasGradient;
  readonly order: number[];
  /** Station ids whose console has been observed to complete; presentation-only inference. */
  readonly completed: Set<string>;
  /** Last horizontal facing, kept so vertical motion keeps the canonical side art. */
  side: "left" | "right";
  station: Station | null;
  activeStation: string | null;
  tasksDone: number;
};

function buildFogGradient(ctx: CanvasRenderingContext2D): CanvasGradient {
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, FOG_ART);
  gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
  gradient.addColorStop(0.55, "rgba(0, 0, 0, 0)");
  gradient.addColorStop(0.78, "rgba(0, 0, 0, 0.6)");
  gradient.addColorStop(0.92, "rgba(0, 0, 0, 0.92)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 1)");
  return gradient;
}

function buildVignette(ctx: CanvasRenderingContext2D, kind: "reactor" | "o2"): CanvasGradient {
  const cx = VIEW_WIDTH / 2, cy = VIEW_HEIGHT / 2;
  const gradient = ctx.createRadialGradient(cx, cy, 130, cx, cy, 620);
  gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
  gradient.addColorStop(0.55, kind === "reactor" ? "rgba(150, 18, 24, 0.3)" : "rgba(28, 150, 178, 0.2)");
  gradient.addColorStop(1, kind === "reactor" ? "rgba(198, 26, 26, 0.78)" : "rgba(44, 212, 228, 0.6)");
  return gradient;
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  // The backing store is fixed; CSS owns the presentation scale.
  if (canvas.width !== VIEW_WIDTH) canvas.width = VIEW_WIDTH;
  if (canvas.height !== VIEW_HEIGHT) canvas.height = VIEW_HEIGHT;
  const ctx = canvas.getContext("2d");
  const camera = { x: 0, y: 0 };

  if (!ctx) {
    // No 2D context: stay silent, the HUD still reports the match.
    return Object.freeze({
      paint(_state: MatchState, _options: RenderOptions): void { /* nothing to draw into */ },
      screenToWorld(clientX: number, clientY: number, canvasRect: { left: number; top: number; width: number; height: number }): Vec {
        return { x: camera.x + (clientX - canvasRect.left), y: camera.y + (clientY - canvasRect.top) };
      },
      get camera(): Vec { return camera; },
    });
  }

  ctx.imageSmoothingEnabled = false;

  const scene: Scene = {
    ctx, camera,
    fog: buildFogGradient(ctx),
    reactor: buildVignette(ctx, "reactor"),
    o2: buildVignette(ctx, "o2"),
    order: [],
    completed: new Set<string>(),
    side: "right",
    station: null,
    activeStation: null,
    tasksDone: 0,
  };

  return Object.freeze({
    paint(state: MatchState, options: RenderOptions): void {
      paintMatch(scene, state, options);
    },
    screenToWorld(clientX: number, clientY: number, canvasRect: { left: number; top: number; width: number; height: number }): Vec {
      // The canvas is scaled by CSS, so undo that scale before undoing the camera.
      const scaleX = canvasRect.width > 0 ? VIEW_WIDTH / canvasRect.width : 1;
      const scaleY = canvasRect.height > 0 ? VIEW_HEIGHT / canvasRect.height : 1;
      return {
        x: scene.camera.x + (clientX - canvasRect.left) * scaleX,
        y: scene.camera.y + (clientY - canvasRect.top) * scaleY,
      };
    },
    get camera(): Vec { return scene.camera; },
  });
}

/* ------------------------------------------------------------------ */
/* frame                                                               */
/* ------------------------------------------------------------------ */

function findPlayer(state: MatchState): Actor | null {
  const actors = state.actors;
  for (let i = 0; i < actors.length; i++) if (actors[i].isPlayer) return actors[i];
  for (let i = 0; i < actors.length; i++) if (actors[i].id === state.playerId) return actors[i];
  return null;
}

function paintMatch(scene: Scene, state: MatchState, options: RenderOptions): void {
  const ctx = scene.ctx;
  const station = state.station;
  const player = findPlayer(state);
  const focus = player ? player.pos : station.playerSpawn;

  // Camera: keep the player centred, never show past the station bounds.
  const maxX = Math.max(0, station.width - VIEW_WIDTH);
  const maxY = Math.max(0, station.height - VIEW_HEIGHT);
  scene.camera.x = Math.round(clamp(focus.x - VIEW_WIDTH / 2, 0, maxX));
  scene.camera.y = Math.round(clamp(focus.y - VIEW_HEIGHT / 2, 0, maxY));
  const camX = scene.camera.x, camY = scene.camera.y;

  // Published on the canvas the way the SDK's own renderer examples do, so an
  // automated check can read the player's world position and the camera without
  // reaching into React state.
  const node = ctx.canvas;
  if (node) {
    node.dataset.x = focus.x.toFixed(2);
    node.dataset.y = focus.y.toFixed(2);
    node.dataset.cameraX = String(camX);
    node.dataset.cameraY = String(camY);
    node.dataset.phase = state.phase;
    node.dataset.prompt = state.prompt ? state.prompt.label : "";
    node.dataset.tasks = `${state.tasksDone}/${state.tasksTotal}`;
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.imageSmoothingEnabled = false;
  ctx.lineJoin = "miter";

  paintBackdrop(ctx, camX, camY);

  ctx.save();
  ctx.translate(-camX, -camY);
  paintZones(ctx, station, camX, camY);
  paintProps(ctx, station, state, options, scene);
  paintActors(ctx, state, options, scene);
  ctx.restore();

  paintSabotage(ctx, state, options, scene);
  paintFog(ctx, focus.x - camX, focus.y - camY, options.visionRadius, scene.fog);
  if (options.showMinimap) paintMinimap(ctx, state, player, camX, camY);
}

/* ------------------------------------------------------------------ */
/* backdrop                                                            */
/* ------------------------------------------------------------------ */

function paintBackdrop(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
  ctx.fillStyle = SPACE;
  ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
  // Sparse stars in the gaps between zones; a slow parallax keeps the void alive.
  const shiftX = ((camX * 0.06) % 112 + 112) % 112;
  const shiftY = ((camY * 0.06) % 112 + 112) % 112;
  for (let gy = -1; gy < 8; gy++) {
    for (let gx = -1; gx < 11; gx++) {
      const seed = hash01(gx + 17, gy + 31);
      if (seed < 0.62) continue;
      const size = seed > 0.94 ? 2 : 1;
      ctx.fillStyle = seed > 0.9 ? "rgba(188, 212, 255, 0.5)" : "rgba(150, 172, 210, 0.26)";
      ctx.fillRect(gx * 112 + shiftX + ((seed * 977) % 96), gy * 112 + shiftY + ((seed * 613) % 96), size, size);
    }
  }
}

/* ------------------------------------------------------------------ */
/* station floors, walls and names                                     */
/* ------------------------------------------------------------------ */

function zoneVisible(zone: Zone, camX: number, camY: number): boolean {
  return zone.x + zone.w + WALL >= camX && zone.y + zone.h + WALL >= camY &&
    zone.x - WALL <= camX + VIEW_WIDTH && zone.y - WALL <= camY + VIEW_HEIGHT;
}

function paintZones(ctx: CanvasRenderingContext2D, station: Station, camX: number, camY: number): void {
  const zones = station.zones;
  // Pass 1: every wall first, so a neighbouring floor can never cover one.
  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i];
    if (!zoneVisible(zone, camX, camY)) continue;
    ctx.fillStyle = WALL_FILL;
    roundRect(ctx, zone.x - WALL, zone.y - WALL, zone.w + WALL * 2, zone.h + WALL * 2, 6);
    ctx.fill();
    ctx.strokeStyle = WALL_EDGE;
    ctx.lineWidth = 2;
    roundRect(ctx, zone.x - WALL + 1.5, zone.y - WALL + 1.5, zone.w + WALL * 2 - 3, zone.h + WALL * 2 - 3, 5);
    ctx.stroke();
  }
  // Pass 2: floors, plate shading, panel seams.
  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i];
    if (!zoneVisible(zone, camX, camY)) continue;
    const corridor = zone.kind === "corridor";
    ctx.fillStyle = corridor ? CORRIDOR_FLOOR : ROOM_FLOOR;
    ctx.fillRect(zone.x, zone.y, zone.w, zone.h);
    ctx.fillStyle = ROOM_PLATE;
    ctx.fillRect(zone.x, zone.y, zone.w, Math.max(3, Math.min(zone.h * 0.34, 110)));
    ctx.fillStyle = ROOM_PLATE_LOW;
    ctx.fillRect(zone.x, zone.y + zone.h * 0.62, zone.w, zone.h * 0.38);
    // Seams are bounded to the visible slice, so cost does not grow with the station.
    const left = Math.max(zone.x, camX - 2), right = Math.min(zone.x + zone.w, camX + VIEW_WIDTH + 2);
    const top = Math.max(zone.y, camY - 2), bottom = Math.min(zone.y + zone.h, camY + VIEW_HEIGHT + 2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(zone.x, zone.y, zone.w, zone.h);
    ctx.clip();
    ctx.strokeStyle = corridor ? SEAM_CORRIDOR : SEAM;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let sx = zone.x + PANEL * Math.ceil((left - zone.x) / PANEL); sx < right; sx += PANEL) {
      ctx.moveTo(sx + 0.5, top);
      ctx.lineTo(sx + 0.5, bottom);
    }
    for (let sy = zone.y + PANEL * Math.ceil((top - zone.y) / PANEL); sy < bottom; sy += PANEL) {
      ctx.moveTo(left, sy + 0.5);
      ctx.lineTo(right, sy + 0.5);
    }
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = "rgba(10, 14, 22, 0.32)";
    ctx.lineWidth = 3;
    ctx.strokeRect(zone.x + 1.5, zone.y + 1.5, zone.w - 3, zone.h - 3);
  }
  // Pass 3: accents and stencilled names on top of every floor.
  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i];
    if (!zoneVisible(zone, camX, camY)) continue;
    if (zone.kind === "room" && zone.w > 40 && zone.h > 26) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = accentFor(zone);
      ctx.fillRect(zone.x + 5, zone.y + 5, Math.max(6, zone.w - 10), 3);
      ctx.fillRect(zone.x + 5, zone.y + 5, 3, Math.min(Math.max(8, zone.h - 10), 24));
      ctx.globalAlpha = 1;
    }
    paintZoneName(ctx, zone);
  }
}

function paintZoneName(ctx: CanvasRenderingContext2D, zone: Zone): void {
  const text = zone.name;
  if (!text) return;
  const size = Math.max(9, Math.min(15, Math.floor((zone.w - 18) / Math.max(1, text.length * 0.62))));
  if (size >= ZONE_FONTS.length) return;
  const cx = zone.x + zone.w / 2;
  const cy = zone.y + Math.min(30, zone.h * 0.22) + 8;
  if (cx < -60 || cx > VIEW_WIDTH + 60) return;
  ctx.font = ZONE_FONTS[size];
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(242, 247, 255, 0.4)";
  ctx.fillText(text, cx, cy + 1);
  ctx.fillStyle = "rgba(38, 48, 62, 0.82)";
  ctx.fillText(text, cx, cy);
}

/* ------------------------------------------------------------------ */
/* task consoles, vents, emergency button                              */
/* ------------------------------------------------------------------ */

/**
 * MatchState exposes no per-station task flag, so completion is inferred: a
 * console that was open and then closed while the player's counter advanced was
 * finished. Cancel and failure leave the counter untouched and stay lit.
 */
function updateTaskLedger(scene: Scene, state: MatchState): void {
  if (scene.station !== state.station) {
    scene.station = state.station;
    scene.completed.clear();
    scene.activeStation = null;
    scene.tasksDone = state.tasksDone;
  }
  const active = state.activeTask ? state.activeTask.stationId : null;
  if (scene.activeStation !== null && active !== scene.activeStation && state.tasksDone > scene.tasksDone) {
    scene.completed.add(scene.activeStation);
  }
  scene.activeStation = active;
  scene.tasksDone = state.tasksDone;
}

function consoleState(scene: Scene, state: MatchState, id: string): ConsoleState {
  if (scene.completed.has(id)) return "done";
  if (state.activeTask && state.activeTask.stationId === id) return "active";
  return "available";
}

function paintProps(ctx: CanvasRenderingContext2D, station: Station, state: MatchState, options: RenderOptions, scene: Scene): void {
  updateTaskLedger(scene, state);
  const stations = station.stations;
  for (let i = 0; i < stations.length; i++) {
    const entry = stations[i];
    if (entry.x + 90 < scene.camera.x || entry.y + 90 < scene.camera.y ||
      entry.x - 90 > scene.camera.x + VIEW_WIDTH || entry.y - 90 > scene.camera.y + VIEW_HEIGHT) continue;
    paintConsole(ctx, entry, consoleState(scene, state, entry.id), options, state.activeTask !== null && state.activeTask.stationId === entry.id);
  }
  const vents = station.vents;
  for (let i = 0; i < vents.length; i++) paintVent(ctx, vents[i]);
  paintEmergency(ctx, station.emergency, options);
}

function paintConsole(ctx: CanvasRenderingContext2D, entry: TaskStation, mode: ConsoleState, options: RenderOptions, showArrow: boolean): void {
  const width = entry.long ? 58 : 34;
  const height = 22;
  const x = entry.x, y = entry.y;
  const left = x - width / 2;
  const top = y - height - 10;
  paintShadow(ctx, x, y + 2, width + 18, 16);

  if (mode !== "done") {
    // Soft halo behind the box: the console reads as "still to do" from across the room.
    ctx.globalAlpha = mode === "active" ? 0.2 : 0.1;
    ctx.fillStyle = ACCENT_TASK;
    roundRect(ctx, left - 9, top - 9, width + 18, height + 18, 8);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = "#2f3846";
  roundRect(ctx, left - 3, y - 11, width + 6, 13, 4);
  ctx.fill();
  ctx.fillStyle = "#3d4756";
  roundRect(ctx, left, top, width, height, 5);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  roundRect(ctx, left, top, width, height, 5);
  ctx.stroke();
  ctx.fillStyle = "#525e70";
  roundRect(ctx, left + 3, top + 2, width - 6, 4, 2);
  ctx.fill();

  const sx = left + 5, sy = top + 6, sw = width - 10, sh = height - 10;
  ctx.fillStyle = mode === "done" ? "#18222c" : "#0a0f15";
  roundRect(ctx, sx, sy, sw, sh, 2);
  ctx.fill();
  if (mode === "done") {
    ctx.strokeStyle = "rgba(204, 255, 0, 0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx + sw * 0.2, sy + sh * 0.52);
    ctx.lineTo(sx + sw * 0.42, sy + sh * 0.8);
    ctx.lineTo(sx + sw * 0.82, sy + sh * 0.18);
    ctx.stroke();
  } else {
    const pulse = options.reducedMotion
      ? 0.8
      : mode === "active" ? 0.7 + 0.3 * Math.sin(options.time / 170) : 0.78;
    ctx.globalAlpha = clamp(pulse, 0.3, 1);
    ctx.fillStyle = ACCENT_TASK;
    roundRect(ctx, sx + 1, sy + 1, sw - 2, sh - 2, 2);
    ctx.fill();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = "#0a1005";
    for (let tick = 0; tick < 3; tick++) ctx.fillRect(sx + 3 + tick * 5, sy + 2, 2, sh - 4);
    ctx.globalAlpha = 1;
  }

  paintLabel(ctx, entry.name, x, y + 15);

  if (showArrow) {
    const bob = options.reducedMotion ? 0 : Math.sin(options.time / 260) * 2;
    const ay = top - 16 + bob;
    ctx.fillStyle = ACCENT_TASK;
    ctx.beginPath();
    ctx.moveTo(x - 6, ay);
    ctx.lineTo(x + 6, ay);
    ctx.lineTo(x, ay + 8);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(8, 11, 17, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function paintVent(ctx: CanvasRenderingContext2D, vent: Vent): void {
  const x = vent.x, y = vent.y;
  paintShadow(ctx, x, y + 1, 48, 14);
  ctx.fillStyle = "#171c26";
  roundRect(ctx, x - 21, y - 13, 42, 26, 5);
  ctx.fill();
  ctx.strokeStyle = "#080b10";
  ctx.lineWidth = 2;
  roundRect(ctx, x - 21, y - 13, 42, 26, 5);
  ctx.stroke();
  ctx.fillStyle = "#3a4351";
  for (let slat = 0; slat < 3; slat++) ctx.fillRect(x - 14, y - 8 + slat * 6, 28, 3);
  ctx.fillStyle = "#4b5666";
  ctx.fillRect(x - 18, y - 10, 2, 2);
  ctx.fillRect(x + 16, y - 10, 2, 2);
  ctx.fillRect(x - 18, y + 8, 2, 2);
  ctx.fillRect(x + 16, y + 8, 2, 2);
}

function paintEmergency(ctx: CanvasRenderingContext2D, at: Vec, options: RenderOptions): void {
  const x = at.x, y = at.y;
  paintShadow(ctx, x, y + 4, 72, 20);
  ctx.fillStyle = "#2a3140";
  roundRect(ctx, x - 30, y - 18, 60, 36, 8);
  ctx.fill();
  ctx.strokeStyle = "#12161f";
  ctx.lineWidth = 2;
  roundRect(ctx, x - 30, y - 18, 60, 36, 8);
  ctx.stroke();
  ctx.fillStyle = "#3c4557";
  roundRect(ctx, x - 24, y - 13, 48, 26, 6);
  ctx.fill();
  const glow = options.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(options.time / 380);
  ctx.globalAlpha = 0.2 + 0.22 * glow;
  ctx.fillStyle = DANGER;
  ctx.beginPath();
  ctx.arc(x, y - 1, 17, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#c62828";
  ctx.beginPath();
  ctx.arc(x, y - 1, 12, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "#7e1414";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y - 1, 12, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = "#ef5350";
  ctx.beginPath();
  ctx.arc(x - 3, y - 5, 6, 0, TAU);
  ctx.fill();
  ctx.font = FONT_LABEL;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(226, 236, 250, 0.8)";
  ctx.fillText("EMERGENCY", x, y + 27);
}

/* ------------------------------------------------------------------ */
/* actors                                                              */
/* ------------------------------------------------------------------ */

function paintActors(ctx: CanvasRenderingContext2D, state: MatchState, options: RenderOptions, scene: Scene): void {
  const actors = state.actors;
  const order = scene.order;
  order.length = 0;
  for (let i = 0; i < actors.length; i++) order.push(i);
  // Insertion sort by ground position: the roster is tiny, so this beats allocating.
  for (let i = 1; i < order.length; i++) {
    const value = order[i];
    const depth = actors[value].pos.y;
    let j = i - 1;
    while (j >= 0 && actors[order[j]].pos.y > depth) {
      order[j + 1] = order[j];
      j--;
    }
    order[j + 1] = value;
  }
  for (let i = 0; i < order.length; i++) {
    const actor = actors[order[i]];
    if (!actor.alive) {
      paintBody(ctx, actor, options);
      continue;
    }
    if (actor.ventedUntil > state.time) {
      if (actor.isPlayer) paintVentedMarker(ctx, actor, options);
      continue;
    }
    if (actor.isPlayer) paintPlayerActor(ctx, actor, options, scene);
    else paintCrewmatePose(ctx, actor, options);
  }
}

/** Canonical Friend mask: white one-pixel halo then the mask, integer 5x, clipped to an 80x80 box. */
function paintPlayerActor(ctx: CanvasRenderingContext2D, actor: Actor, options: RenderOptions, scene: Scene): void {
  const x = Math.round(actor.pos.x), y = Math.round(actor.pos.y);
  if (actor.facing === "left" || actor.facing === "right") scene.side = actor.facing;
  paintShadow(ctx, x, y + 2, 50, 17);

  const walking = actor.walking && actor.state !== "down";
  const frame = options.reducedMotion ? 0 : ((Math.floor(options.time / 110) % 8) + 8) % 8;
  const rows = spriteFrame(options.playerSprites, actor.facing, walking, frame, scene.side).frame.rows;
  const left = x - 40, top = y - 75;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, 80, 80);
  ctx.clip();
  ctx.fillStyle = "#ffffff";
  for (let py = 0; py < 16; py++) {
    const row = rows[py];
    for (let px = 0; px < 16; px++) {
      if (row.charCodeAt(px) === 35) ctx.fillRect(left + px * 5 - 5, top + py * 5 - 5, 15, 15);
    }
  }
  // The suit tint replaces the mask pass; the silhouette stays byte-for-byte canonical.
  ctx.fillStyle = options.playerColor || "#d6e0f0";
  for (let py = 0; py < 16; py++) {
    const row = rows[py];
    for (let px = 0; px < 16; px++) {
      if (row.charCodeAt(px) === 35) ctx.fillRect(left + px * 5, top + py * 5, 5, 5);
    }
  }
  ctx.restore();

  const chevronY = y + 12 + (options.reducedMotion ? 0 : Math.round(Math.sin(options.time / 380) * 1.5));
  ctx.fillStyle = options.playerColor || "#d6e0f0";
  ctx.beginPath();
  ctx.moveTo(x - 7, chevronY);
  ctx.lineTo(x + 7, chevronY);
  ctx.lineTo(x, chevronY + 7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  paintTag(ctx, actor.name, x, y - 84, options.playerColor || "#d6e0f0");
}

function paintCrewmatePose(ctx: CanvasRenderingContext2D, actor: Actor, options: RenderOptions): void {
  const x = actor.pos.x, y = actor.pos.y;
  const shades = shadesFor(actor.color);
  const walking = actor.walking && actor.state !== "down";
  const phase = (hashCode(actor.id) % 628) / 100;
  const bob = options.reducedMotion ? 0 : Math.sin(options.time / 430 + phase) * 1.4;
  const shuffle = walking && !options.reducedMotion ? Math.floor(options.time / 150) % 2 : 0;
  const bodyTop = y - 46 + bob;

  paintShadow(ctx, x, y + 2, 40, 15);

  // Legs: a two-frame shuffle while walking.
  ctx.fillStyle = shades.dark;
  roundRect(ctx, x - 10, y - 13 + (shuffle === 1 ? -2 : 0), 8, 13, 3);
  ctx.fill();
  roundRect(ctx, x + 2, y - 13 + (shuffle === 0 && walking ? -2 : 0), 8, 13, 3);
  ctx.fill();
  // Backpack.
  ctx.fillStyle = shades.dark;
  roundRect(ctx, x - 21, bodyTop + 3, 8, 22, 3);
  ctx.fill();
  // Capsule body.
  ctx.fillStyle = shades.body;
  roundRect(ctx, x - 16, bodyTop, 32, 40, 15);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  roundRect(ctx, x - 16, bodyTop, 32, 40, 15);
  ctx.stroke();
  ctx.fillStyle = shades.light;
  ctx.globalAlpha = 0.45;
  roundRect(ctx, x - 13, bodyTop + 3, 11, 12, 5);
  ctx.fill();
  ctx.globalAlpha = 1;
  // Visor faces the direction of travel.
  const visorX = x - 9 + (actor.facing === "left" ? -3 : actor.facing === "right" ? 5 : 2);
  ctx.fillStyle = shades.visor;
  roundRect(ctx, visorX, bodyTop + 6, 15, 11, 5);
  ctx.fill();
  ctx.strokeStyle = "rgba(16, 20, 28, 0.75)";
  ctx.lineWidth = 1.5;
  roundRect(ctx, visorX, bodyTop + 6, 15, 11, 5);
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.fillRect(visorX + 2, bodyTop + 8, 4, 2);

  paintTag(ctx, actor.name, x, bodyTop - 10, null);
}

function paintBody(ctx: CanvasRenderingContext2D, actor: Actor, options: RenderOptions): void {
  const x = actor.pos.x, y = actor.pos.y;
  const shades = shadesFor(actor.color);
  paintShadow(ctx, x, y + 4, 66, 26);

  ctx.save();
  ctx.translate(x, y - 4);
  ctx.rotate(1.35);
  ctx.fillStyle = shades.body;
  roundRect(ctx, -15, -42, 30, 44, 14);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  roundRect(ctx, -15, -42, 30, 44, 14);
  ctx.stroke();
  ctx.fillStyle = shades.dark;
  roundRect(ctx, -19, -38, 7, 20, 3);
  ctx.fill();
  // Bone-coloured visor marker: an X reads as "down" at a glance.
  ctx.fillStyle = "#9fc4dc";
  roundRect(ctx, -9, -37, 16, 12, 5);
  ctx.fill();
  ctx.strokeStyle = "#16232e";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(-6.5, -34.5);
  ctx.lineTo(1.5, -27.5);
  ctx.moveTo(1.5, -34.5);
  ctx.lineTo(-6.5, -27.5);
  ctx.stroke();
  ctx.restore();

  // Bone.
  ctx.fillStyle = "#e8e6dc";
  roundRect(ctx, x + 11, y - 34, 17, 6, 3);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + 11, y - 33, 3.4, 0, TAU);
  ctx.arc(x + 11, y - 29, 3.4, 0, TAU);
  ctx.fill();

  // Pulsing alert ring so a body is findable through the fog of a dark room.
  const pulse = options.reducedMotion ? 1 : 1 + 0.14 * Math.sin(options.time / 300);
  ctx.globalAlpha = options.reducedMotion ? 0.45 : 0.3 + 0.35 * (0.5 + 0.5 * Math.sin(options.time / 300));
  ctx.strokeStyle = DANGER;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(x, y - 4, 27 * pulse, 21 * pulse, 0, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** The sprite hides inside the vent, so a small marker keeps the player oriented. */
function paintVentedMarker(ctx: CanvasRenderingContext2D, actor: Actor, options: RenderOptions): void {
  const x = actor.pos.x, y = actor.pos.y;
  const pulse = options.reducedMotion ? 0.6 : 0.45 + 0.4 * (0.5 + 0.5 * Math.sin(options.time / 320));
  paintShadow(ctx, x, y + 2, 44, 15);
  ctx.globalAlpha = pulse;
  ctx.fillStyle = ACCENT_TASK;
  ctx.beginPath();
  ctx.arc(x, y - 12, 4, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(204, 255, 0, 0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y - 12, options.reducedMotion ? 12 : 12 + 5 * (0.5 + 0.5 * Math.sin(options.time / 320)), 0, TAU);
  ctx.stroke();
}

/* ------------------------------------------------------------------ */
/* sabotage washes                                     (before fog)   */
/* ------------------------------------------------------------------ */

function paintSabotage(ctx: CanvasRenderingContext2D, state: MatchState, options: RenderOptions, scene: Scene): void {
  const kind = state.sabotage;
  if (kind === "none") return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  if (kind === "lights") {
    ctx.fillStyle = "rgba(6, 10, 32, 0.42)";
    ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    ctx.fillStyle = "rgba(14, 20, 52, 0.24)";
    ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    return;
  }
  if (kind === "comms") {
    ctx.fillStyle = "rgba(40, 84, 122, 0.09)";
    ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    ctx.strokeStyle = "rgba(154, 198, 255, 0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const offset = options.reducedMotion ? 0 : Math.floor((options.time / 45) % 4);
    for (let y = offset; y < VIEW_HEIGHT; y += 4) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(VIEW_WIDTH, y + 0.5);
    }
    ctx.stroke();
    return;
  }
  // reactor: red pulse, o2: cyan pulse.
  const reactor = kind === "reactor";
  const pulse = options.reducedMotion ? 0.6 : 0.45 + 0.4 * (0.5 + 0.5 * Math.sin(options.time / (reactor ? 300 : 520)));
  ctx.globalAlpha = clamp(pulse, 0.1, 0.95);
  ctx.fillStyle = reactor ? scene.reactor : scene.o2;
  ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
  ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------------ */
/* fog of war                                                          */
/* ------------------------------------------------------------------ */

function paintFog(ctx: CanvasRenderingContext2D, screenX: number, screenY: number, visionRadius: number, gradient: CanvasGradient): void {
  const radius = Math.max(8, visionRadius);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  // Opaque black everywhere, with the vision circle punched out by winding.
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.rect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
  ctx.arc(screenX, screenY, radius, 0, TAU, true);
  ctx.fill();

  // Soft falloff inside the circle, authored once at FOG_ART and scaled into place.
  const scale = radius / FOG_ART;
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, screenX, screenY);
  ctx.fillStyle = gradient;
  ctx.fillRect(-FOG_ART, -FOG_ART, FOG_ART * 2, FOG_ART * 2);
  ctx.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  ctx.strokeStyle = "rgba(168, 200, 255, 0.1)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(screenX, screenY, radius - 1, 0, TAU);
  ctx.stroke();
}

/* ------------------------------------------------------------------ */
/* minimap                                                             */
/* ------------------------------------------------------------------ */

function zoneAt(station: Station, x: number, y: number): Zone | null {
  const zones = station.zones;
  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i];
    if (x >= zone.x && x <= zone.x + zone.w && y >= zone.y && y <= zone.y + zone.h) return zone;
  }
  return null;
}

function paintMinimap(ctx: CanvasRenderingContext2D, state: MatchState, player: Actor | null, camX: number, camY: number): void {
  const width = 190, height = 130, margin = 12;
  const panelX = VIEW_WIDTH - width - margin, panelY = VIEW_HEIGHT - height - margin;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "rgba(8, 12, 20, 0.74)";
  roundRect(ctx, panelX, panelY, width, height, 8);
  ctx.fill();
  ctx.strokeStyle = "rgba(198, 214, 240, 0.35)";
  ctx.lineWidth = 1.5;
  roundRect(ctx, panelX, panelY, width, height, 8);
  ctx.stroke();

  const station = state.station;
  const innerW = width - 16, innerH = height - 34;
  const scale = Math.min(innerW / Math.max(1, station.width), innerH / Math.max(1, station.height));
  const offX = panelX + 8 + (innerW - station.width * scale) / 2;
  const offY = panelY + 8 + (innerH - station.height * scale) / 2;

  const current = player ? zoneAt(station, player.pos.x, player.pos.y) : null;
  const zones = station.zones;
  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i];
    const x = offX + zone.x * scale, y = offY + zone.y * scale;
    const w = Math.max(2, zone.w * scale), h = Math.max(2, zone.h * scale);
    if (current && zone === current) {
      ctx.fillStyle = accentFor(zone);
      ctx.globalAlpha = 0.5;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(240, 246, 255, 0.22)";
      ctx.fillRect(x, y, w, h);
    } else {
      ctx.fillStyle = zone.kind === "corridor" ? "rgba(104, 124, 152, 0.32)" : "rgba(132, 152, 184, 0.38)";
      ctx.fillRect(x, y, w, h);
    }
  }

  // Where the camera is looking.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
  ctx.lineWidth = 1;
  ctx.strokeRect(offX + camX * scale, offY + camY * scale, VIEW_WIDTH * scale, VIEW_HEIGHT * scale);

  // Task consoles vanish while comms are sabotaged.
  if (state.sabotage !== "comms") {
    ctx.fillStyle = ACCENT_TASK;
    const stations = station.stations;
    for (let i = 0; i < stations.length; i++) {
      ctx.fillRect(offX + stations[i].x * scale - 1.5, offY + stations[i].y * scale - 1.5, 3, 3);
    }
  }

  const actors = state.actors;
  for (let i = 0; i < actors.length; i++) {
    const actor = actors[i];
    if (actor.isPlayer) continue;
    // Hidden while inside a vent, exactly like the world pass.
    if (actor.ventedUntil > state.time) continue;
    if (state.time - actor.lastSeen >= MINIMAP_SEEN_SECONDS) continue;
    const x = offX + actor.pos.x * scale, y = offY + actor.pos.y * scale;
    ctx.fillStyle = CREW_COLORS[actor.color];
    ctx.beginPath();
    ctx.arc(x, y, 2.4, 0, TAU);
    ctx.fill();
    if (!actor.alive) {
      ctx.strokeStyle = DANGER;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(x, y, 4.6, 0, TAU);
      ctx.stroke();
    }
  }

  if (player) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(offX + player.pos.x * scale, offY + player.pos.y * scale, 3.2, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(8, 11, 17, 0.9)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(offX + player.pos.x * scale, offY + player.pos.y * scale, 3.2, 0, TAU);
    ctx.stroke();
  }

  ctx.font = FONT_MAP;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(226, 236, 250, 0.88)";
  ctx.fillText(current ? current.name : station.name, panelX + width / 2, panelY + height - 9);
}
