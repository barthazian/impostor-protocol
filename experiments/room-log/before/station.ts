/**
 * IMPOSTOR PROTOCOL — hand-authored station.
 *
 * Nothing in this file is generated: every rectangle was placed by hand so the
 * layout reads at a glance on the 960x640 play viewport. Coordinates are world
 * units inside a 2400x1500 station.
 *
 * Layout — a 3x3 grid of rooms joined by twelve short corridors, one per gap
 * between two neighbouring rooms. Rooms never overlap; every corridor physically
 * touches the two rooms it joins, so the walkable union is contiguous and the
 * only way between two rooms is through a doorway. The graph has cycles (four
 * rooms around the middle), so crews can take different routes.
 *
 *      Reactor  ─West Corridor─  Cafeteria  ─East Corridor─  Navigation
 *         │                          │                            │
 *   Reactor Access             Cafeteria Access            Navigation Access
 *         │                          │                            │
 *      MedBay   ─West Hall────  Storage   ──East Hall────     Comms
 *         │                          │                            │
 *    MedBay Access              Storage Access               Comms Access
 *         │                          │                            │
 *    Electrical ─Lower West Hall─ Engine ─Lower East Hall──      O2
 *
 * Rooms are 520x390 (corners) or 640x390 (middle column) with 120-unit gaps;
 * corridors are 140 units wide, which is four player radii — bots path down the
 * corridor centreline so they never scrape a wall.
 */
import type { SabotageKind, Station, TaskStation, Vec, Vent, Zone } from "./types";

/** A console the crew repairs sabotage at, and (for the two impostor consoles) triggers it from. */
export type ConsoleKind = "sabotage-fix" | "sabotage-trigger";

export type Console = Readonly<{
  id: string;
  kind: ConsoleKind;
  sabotage: SabotageKind;
  x: number;
  y: number;
  name: string;
}>;

export const STATION_WIDTH = 2400;
export const STATION_HEIGHT = 1500;

/** Actor radius used by every collision / walkability query in the game. */
export const ACTOR_RADIUS = 15;

function room(id: string, name: string, x: number, y: number, w: number, h: number): Zone {
  return { id, kind: "room", name, x, y, w, h };
}

function corridor(id: string, name: string, x: number, y: number, w: number, h: number): Zone {
  return { id, kind: "corridor", name, x, y, w, h };
}

/* ------------------------------------------------------------------ *
 *  ZONES                                                             *
 * ------------------------------------------------------------------ */

const ZONES: readonly Zone[] = [
  // 3x3 room grid. Columns at x 120/880/1760, rows at y 60/570/1050.
  room("reactor", "Reactor", 120, 60, 520, 390),
  room("cafeteria", "Cafeteria", 880, 60, 640, 390),
  room("navigation", "Navigation", 1760, 60, 520, 390),
  room("medbay", "MedBay", 120, 570, 520, 360),
  room("storage", "Storage", 880, 570, 640, 360),
  room("comms", "Comms", 1760, 570, 520, 360),
  room("electrical", "Electrical", 120, 1050, 520, 390),
  room("engine", "Engine", 880, 1050, 640, 390),
  room("o2", "O2", 1760, 1050, 520, 390),

  // Vertical corridors: 140 wide, filling the 120-unit gap between two rows.
  corridor("corridor-reactor-medbay", "Reactor Access", 310, 450, 140, 120),
  corridor("corridor-medbay-electrical", "Lower Reactor Access", 310, 930, 140, 120),
  corridor("corridor-cafeteria-storage", "Cafeteria Access", 1130, 450, 140, 120),
  corridor("corridor-storage-engine", "Lower Cafeteria Access", 1130, 930, 140, 120),
  corridor("corridor-navigation-comms", "Navigation Access", 1950, 450, 140, 120),
  corridor("corridor-comms-o2", "Lower Navigation Access", 1950, 930, 140, 120),

  // Horizontal corridors: 140 tall, filling the 240-unit gap between two columns.
  corridor("corridor-reactor-cafeteria", "West Corridor", 640, 185, 240, 140),
  corridor("corridor-cafeteria-navigation", "East Corridor", 1520, 185, 240, 140),
  corridor("corridor-medbay-storage", "West Hall", 640, 680, 240, 140),
  corridor("corridor-storage-comms", "East Hall", 1520, 680, 240, 140),
  corridor("corridor-electrical-engine", "Lower West Hall", 640, 1175, 240, 140),
  corridor("corridor-engine-o2", "Lower East Hall", 1520, 1175, 240, 140),
];

/**
 * One navigation point per zone. Every hub sits on the corridor centreline it
 * serves, so each ZONE_LINKS lane is a straight, axis-aligned run: the lane from
 * `hub A` to `hub B` never leaves the union of the two rectangles it joins.
 */
export const HUBS: Readonly<Record<string, Vec>> = {
  reactor: { x: 380, y: 255 },
  cafeteria: { x: 1200, y: 255 },
  navigation: { x: 2020, y: 255 },
  medbay: { x: 380, y: 750 },
  storage: { x: 1200, y: 750 },
  comms: { x: 2020, y: 750 },
  electrical: { x: 380, y: 1245 },
  engine: { x: 1200, y: 1245 },
  o2: { x: 2020, y: 1245 },
  "corridor-reactor-medbay": { x: 380, y: 510 },
  "corridor-medbay-electrical": { x: 380, y: 990 },
  "corridor-cafeteria-storage": { x: 1200, y: 510 },
  "corridor-storage-engine": { x: 1200, y: 990 },
  "corridor-navigation-comms": { x: 2020, y: 510 },
  "corridor-comms-o2": { x: 2020, y: 990 },
  "corridor-reactor-cafeteria": { x: 760, y: 255 },
  "corridor-cafeteria-navigation": { x: 1640, y: 255 },
  "corridor-medbay-storage": { x: 760, y: 750 },
  "corridor-storage-comms": { x: 1640, y: 750 },
  "corridor-electrical-engine": { x: 760, y: 1245 },
  "corridor-engine-o2": { x: 1640, y: 1245 },
};

/**
 * Every pair of zones that is directly walkable. Each lane is a straight
 * axis-aligned run between two hubs; a 30-unit wide lane (radius 15) plus the
 * lanes' own width keeps the whole segment inside the union.
 */
export const ZONE_LINKS: readonly (readonly [string, string])[] = [
  ["reactor", "corridor-reactor-medbay"],
  ["reactor", "corridor-reactor-cafeteria"],
  ["cafeteria", "corridor-reactor-cafeteria"],
  ["cafeteria", "corridor-cafeteria-navigation"],
  ["cafeteria", "corridor-cafeteria-storage"],
  ["navigation", "corridor-cafeteria-navigation"],
  ["navigation", "corridor-navigation-comms"],
  ["medbay", "corridor-reactor-medbay"],
  ["medbay", "corridor-medbay-storage"],
  ["medbay", "corridor-medbay-electrical"],
  ["storage", "corridor-cafeteria-storage"],
  ["storage", "corridor-medbay-storage"],
  ["storage", "corridor-storage-comms"],
  ["storage", "corridor-storage-engine"],
  ["comms", "corridor-navigation-comms"],
  ["comms", "corridor-storage-comms"],
  ["comms", "corridor-comms-o2"],
  ["electrical", "corridor-medbay-electrical"],
  ["electrical", "corridor-electrical-engine"],
  ["engine", "corridor-storage-engine"],
  ["engine", "corridor-electrical-engine"],
  ["engine", "corridor-engine-o2"],
  ["o2", "corridor-comms-o2"],
  ["o2", "corridor-engine-o2"],
];

/* ------------------------------------------------------------------ *
 *  TASK STATIONS — six crew tasks, three long, one per relevant room. *
 * ------------------------------------------------------------------ */

const TASK_STATIONS: readonly TaskStation[] = [
  { id: "task-reactor", zoneId: "reactor", name: "Calibrate Reactor", kind: "calibrate", x: 230, y: 130, long: true },
  { id: "task-navigation", zoneId: "navigation", name: "Align Navigation Dials", kind: "dials", x: 2170, y: 130, long: true },
  { id: "task-comms", zoneId: "comms", name: "Reboot Comms Array", kind: "reboot", x: 2170, y: 860, long: true },
  { id: "task-medbay", zoneId: "medbay", name: "Analyse Blood Sample", kind: "sample", x: 230, y: 860, long: false },
  { id: "task-electrical", zoneId: "electrical", name: "Repair Wiring", kind: "wiring", x: 230, y: 1370, long: false },
  { id: "task-o2", zoneId: "o2", name: "Unlock O2 Filters", kind: "keypad", x: 2170, y: 1370, long: false },
];

/* ------------------------------------------------------------------ *
 *  VENTS — two, linking Electrical and Navigation (opposite corners).  *
 * ------------------------------------------------------------------ */

const VENTS: readonly Vent[] = [
  { id: "vent-electrical", zoneId: "electrical", x: 300, y: 1240, link: "vent-navigation" },
  { id: "vent-navigation", zoneId: "navigation", x: 1840, y: 240, link: "vent-electrical" },
];

/**
 * Sabotage consoles.
 *
 * - `sabotage-trigger` consoles (Reactor, O2) are the impostor's sabotage
 *   consoles and double as the repair point: stand on one while that sabotage
 *   is running and the same console offers the repair.
 * - `sabotage-fix` consoles (Electrical breaker for lights, Comms relay for
 *   comms) exist purely so the crew can clear those two persistent sabotages,
 *   which have no countdown of their own.
 */
export const CONSOLES: readonly Console[] = [
  { id: "console-reactor", kind: "sabotage-trigger", sabotage: "reactor", x: 560, y: 130, name: "Reactor Console" },
  { id: "console-o2", kind: "sabotage-trigger", sabotage: "o2", x: 1840, y: 1370, name: "O2 Console" },
  { id: "console-lights", kind: "sabotage-fix", sabotage: "lights", x: 560, y: 1370, name: "Electrical Breaker" },
  { id: "console-comms", kind: "sabotage-fix", sabotage: "comms", x: 1840, y: 860, name: "Comms Relay" },
];

/* ------------------------------------------------------------------ *
 *  SPAWNS                                                            *
 * ------------------------------------------------------------------ */

const BOT_SPAWNS: readonly Vec[] = [
  { x: 300, y: 180 },
  { x: 2000, y: 180 },
  { x: 300, y: 700 },
  { x: 2000, y: 700 },
  { x: 300, y: 1300 },
  { x: 1050, y: 1300 },
  { x: 2000, y: 1300 },
  { x: 1050, y: 700 },
  { x: 1400, y: 320 },
  { x: 1400, y: 700 },
];

export const STATION: Station = {
  id: "kestrel",
  name: "Kestrel Station",
  width: STATION_WIDTH,
  height: STATION_HEIGHT,
  zones: ZONES,
  stations: TASK_STATIONS,
  vents: VENTS,
  emergency: { x: 1140, y: 350 },
  playerSpawn: { x: 1140, y: 220 },
  botSpawns: BOT_SPAWNS,
};

/* ------------------------------------------------------------------ *
 *  Walkability                                                       *
 * ------------------------------------------------------------------ */

/**
 * True when the disc of `radius` around `point` fits inside the union of the
 * station's zone rectangles.
 *
 * Fast path: the disc is entirely inside a single zone (this is what happens
 * almost every frame). Slow path: the disc straddles a doorway, so the disc is
 * sampled on a 5x5 grid and every sample must land in some zone. The second test
 * is conservative — it can report "blocked" for a disc that technically fits —
 * which is exactly what we want for collision: agents keep a hair of clearance
 * around door frames instead of clipping them.
 */
export function isWalkable(station: Station, point: Vec, radius: number): boolean {
  const zones = station.zones;
  for (let index = 0; index < zones.length; index++) {
    const zone = zones[index];
    if (point.x - radius >= zone.x && point.x + radius <= zone.x + zone.w &&
        point.y - radius >= zone.y && point.y + radius <= zone.y + zone.h) {
      return true;
    }
  }
  if (radius <= 0) return true;
  const samples = 5;
  for (let row = 0; row < samples; row++) {
    const y = point.y - radius + (2 * radius * row) / (samples - 1);
    for (let column = 0; column < samples; column++) {
      const x = point.x - radius + (2 * radius * column) / (samples - 1);
      const dx = x - point.x;
      const dy = y - point.y;
      if (dx * dx + dy * dy > radius * radius) continue;
      let covered = false;
      for (let index = 0; index < zones.length; index++) {
        const zone = zones[index];
        if (x >= zone.x && x <= zone.x + zone.w && y >= zone.y && y <= zone.y + zone.h) {
          covered = true;
          break;
        }
      }
      if (!covered) return false;
    }
  }
  return true;
}
