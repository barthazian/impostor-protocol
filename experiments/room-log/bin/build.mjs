// experiments/room-log/src/format.ts
import { createHash } from "node:crypto";

// games/impostor-protocol/src/rng.ts
function hashSeed(text) {
  let hash2 = 1779033703 ^ text.length;
  for (let index = 0; index < text.length; index++) {
    hash2 = Math.imul(hash2 ^ text.charCodeAt(index), 3432918353);
    hash2 = hash2 << 13 | hash2 >>> 19;
  }
  hash2 = Math.imul(hash2 ^ hash2 >>> 16, 2246822507);
  hash2 = Math.imul(hash2 ^ hash2 >>> 13, 3266489909);
  return (hash2 ^= hash2 >>> 16) >>> 0;
}
function createRng(seed) {
  let state = seed >>> 0 || 2654435769;
  const next = () => {
    state = state + 1831565813 >>> 0;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  return Object.freeze({
    next,
    /** Integer in [0, bound). */
    int: (bound) => Math.floor(next() * bound),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (probability) => next() < probability,
    range: (min, max) => min + next() * (max - min)
  });
}

// experiments/room-log/src/format.ts
var LOG_VERSION = 1;
var SLOT_COUNT = 7;
var PASS_PRICE_CENTS = 100;
var DROP_TABLE = Object.freeze([
  { id: "scrap-metal", label: "Scrap Metal", bps: 2100, rfCents: 0 },
  { id: "spare-parts", label: "Spare Parts", bps: 3e3, rfCents: 25 },
  { id: "circuit-board", label: "Circuit Board", bps: 1900, rfCents: 50 },
  { id: "power-cell", label: "Power Cell", bps: 1500, rfCents: 100 },
  { id: "rare-alloy", label: "Rare Alloy", bps: 900, rfCents: 200 },
  { id: "quantum-core", label: "Quantum Core", bps: 400, rfCents: 500 },
  { id: "genesis-artifact", label: "Genesis Artifact", bps: 200, rfCents: 1e3 }
]);
var DROP_BPS_TOTAL = DROP_TABLE.reduce((sum, entry) => sum + entry.bps, 0);
var DROP_EV_CENTS = DROP_TABLE.reduce((sum, entry) => sum + entry.bps * entry.rfCents, 0) / DROP_BPS_TOTAL;
function roll(seedDrop, slot, passIndex) {
  const rng = createRng(hashSeed(`${seedDrop}:drop:${slot}:${passIndex}`));
  let ticket = rng.int(DROP_BPS_TOTAL);
  for (const entry of DROP_TABLE) {
    if (ticket < entry.bps) return entry;
    ticket -= entry.bps;
  }
  return DROP_TABLE[DROP_TABLE.length - 1];
}
function sha256hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
var DOMAIN_MATCH = "ip-room/v1/commit/match";
var DOMAIN_DROP = "ip-room/v1/commit/drop";
function commitMatchSeed(seedMatch) {
  return sha256hex(`${DOMAIN_MATCH}|${seedMatch}`);
}
function commitDropSeed(seedDrop) {
  return sha256hex(`${DOMAIN_DROP}|${seedDrop}`);
}
function frameCode(input) {
  const bits = (input.up ? 1 : 0) | (input.down ? 2 : 0) | (input.left ? 4 : 0) | (input.right ? 8 : 0);
  return input.destination ? `${bits}@${input.destination.x.toFixed(6)},${input.destination.y.toFixed(6)}` : `${bits}`;
}
function actionsDigest(actions) {
  return sha256hex(`ip-room/v1/actions|${actions.length}|${actions.map(frameCode).join(",")}`);
}
function walletFor(roomId, slot) {
  return `0x${sha256hex(`ip-room/v1/wallet|${roomId}|${slot}`).slice(0, 40)}`;
}
function leafHash(leaf) {
  return sha256hex(`ip-room/v1/leaf|${leaf.wallet}|${leaf.amountCents}`);
}
function nodeHash(left, right) {
  return sha256hex(`ip-room/v1/node|${left}|${right}`);
}
function sortedLeaves(leaves) {
  return [...leaves].sort((a, b) => a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0);
}
function buildTree(leaves) {
  const sorted = sortedLeaves(leaves);
  if (sorted.length === 0) return { root: sha256hex("ip-room/v1/empty"), layers: [[sha256hex("ip-room/v1/empty")]], index: /* @__PURE__ */ new Map() };
  const layers = [sorted.map(leafHash)];
  while (layers[layers.length - 1].length > 1) {
    const layer = layers[layers.length - 1];
    const next = [];
    for (let index2 = 0; index2 < layer.length; index2 += 2) {
      const right = index2 + 1 < layer.length ? layer[index2 + 1] : layer[index2];
      next.push(nodeHash(layer[index2], right));
    }
    layers.push(next);
  }
  const index = new Map(sorted.map((leaf, position) => [leaf.wallet, position]));
  return { root: layers[layers.length - 1][0], layers, index };
}
function proofFor(leaves, wallet) {
  const sorted = sortedLeaves(leaves);
  const position = sorted.findIndex((leaf) => leaf.wallet === wallet);
  if (position < 0) throw new Error(`no entitlement leaf for ${wallet}`);
  const tree = buildTree(sorted);
  const proof = [];
  let cursor = position;
  for (let level = 0; level < tree.layers.length - 1; level++) {
    const layer = tree.layers[level];
    if (cursor % 2 === 0) {
      const right = cursor + 1 < layer.length ? cursor + 1 : cursor;
      proof.push({ side: "right", hash: layer[right] });
    } else {
      proof.push({ side: "left", hash: layer[cursor - 1] });
    }
    cursor = Math.floor(cursor / 2);
  }
  return { leaf: sorted[position], proof, root: tree.root };
}
var MATCH_ONLY_KINDS = /* @__PURE__ */ new Set(["genesis", "join", "run-sealed", "close", "settle"]);
var ECONOMY_ONLY_KINDS = /* @__PURE__ */ new Set(["deposit", "pass-purchase", "cache-draw", "merkle-root"]);
var MATCH_KINDS = /* @__PURE__ */ new Set([...MATCH_ONLY_KINDS, "claim"]);
var ECONOMY_KINDS = /* @__PURE__ */ new Set([...ECONOMY_ONLY_KINDS, "claim"]);

// experiments/room-log/src/room.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// games/impostor-protocol/src/types.ts
var CREW_COLORS = {
  red: "#c51111",
  blue: "#132ed1",
  green: "#117f2d",
  pink: "#ed54ba",
  orange: "#ef7d0d",
  yellow: "#f5f557",
  black: "#3f474e",
  white: "#d6e0f0",
  purple: "#6b2fbb",
  brown: "#71491e",
  cyan: "#38fedc",
  lime: "#50ef39"
};
var TASK_LABELS = Object.freeze({
  wiring: "Repair wiring",
  keypad: "Enter access code",
  dials: "Align dials",
  calibrate: "Calibrate engine",
  sample: "Analyse sample",
  reboot: "Reboot terminal"
});

// games/impostor-protocol/src/station.ts
var STATION_WIDTH = 2400;
var STATION_HEIGHT = 1500;
var ACTOR_RADIUS = 15;
function room(id, name, x, y, w, h) {
  return { id, kind: "room", name, x, y, w, h };
}
function corridor(id, name, x, y, w, h) {
  return { id, kind: "corridor", name, x, y, w, h };
}
var ZONES = [
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
  corridor("corridor-engine-o2", "Lower East Hall", 1520, 1175, 240, 140)
];
var HUBS = {
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
  "corridor-engine-o2": { x: 1640, y: 1245 }
};
var ZONE_LINKS = [
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
  ["o2", "corridor-engine-o2"]
];
var TASK_STATIONS = [
  { id: "task-reactor", zoneId: "reactor", name: "Calibrate Reactor", kind: "calibrate", x: 230, y: 130, long: true },
  { id: "task-navigation", zoneId: "navigation", name: "Align Navigation Dials", kind: "dials", x: 2170, y: 130, long: true },
  { id: "task-comms", zoneId: "comms", name: "Reboot Comms Array", kind: "reboot", x: 2170, y: 860, long: true },
  { id: "task-medbay", zoneId: "medbay", name: "Analyse Blood Sample", kind: "sample", x: 230, y: 860, long: false },
  { id: "task-electrical", zoneId: "electrical", name: "Repair Wiring", kind: "wiring", x: 230, y: 1370, long: false },
  { id: "task-o2", zoneId: "o2", name: "Unlock O2 Filters", kind: "keypad", x: 2170, y: 1370, long: false }
];
var VENTS = [
  { id: "vent-electrical", zoneId: "electrical", x: 300, y: 1240, link: "vent-navigation" },
  { id: "vent-navigation", zoneId: "navigation", x: 1840, y: 240, link: "vent-electrical" }
];
var CONSOLES = [
  { id: "console-reactor", kind: "sabotage-trigger", sabotage: "reactor", x: 560, y: 130, name: "Reactor Console" },
  { id: "console-o2", kind: "sabotage-trigger", sabotage: "o2", x: 1840, y: 1370, name: "O2 Console" },
  { id: "console-lights", kind: "sabotage-fix", sabotage: "lights", x: 560, y: 1370, name: "Electrical Breaker" },
  { id: "console-comms", kind: "sabotage-fix", sabotage: "comms", x: 1840, y: 860, name: "Comms Relay" }
];
var BOT_SPAWNS = [
  { x: 300, y: 180 },
  { x: 2e3, y: 180 },
  { x: 300, y: 700 },
  { x: 2e3, y: 700 },
  { x: 300, y: 1300 },
  { x: 1050, y: 1300 },
  { x: 2e3, y: 1300 },
  { x: 1050, y: 700 },
  { x: 1400, y: 320 },
  { x: 1400, y: 700 }
];
var STATION = {
  id: "kestrel",
  name: "Kestrel Station",
  width: STATION_WIDTH,
  height: STATION_HEIGHT,
  zones: ZONES,
  stations: TASK_STATIONS,
  vents: VENTS,
  emergency: { x: 1140, y: 350 },
  playerSpawn: { x: 1140, y: 220 },
  botSpawns: BOT_SPAWNS
};
function isWalkable(station, point, radius) {
  const zones = station.zones;
  for (let index = 0; index < zones.length; index++) {
    const zone = zones[index];
    if (point.x - radius >= zone.x && point.x + radius <= zone.x + zone.w && point.y - radius >= zone.y && point.y + radius <= zone.y + zone.h) {
      return true;
    }
  }
  if (radius <= 0) return true;
  const samples = 5;
  for (let row = 0; row < samples; row++) {
    const y = point.y - radius + 2 * radius * row / (samples - 1);
    for (let column = 0; column < samples; column++) {
      const x = point.x - radius + 2 * radius * column / (samples - 1);
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

// games/impostor-protocol/src/sim.ts
var PLAYER_SPEED = 155;
var BOT_SPEED = 120;
var MAX_DT = 0.5;
var MOVE_SUBSTEP = 6;
var KILL_RANGE = 62;
var PLAYER_KILL_COOLDOWN = 25;
var BOT_KILL_COOLDOWN = 28;
var BOT_KILL_SAFE_RADIUS = 220;
var WITNESS_RADIUS = 400;
var BODY_SUSPICION_RADIUS = 260;
var INTERACT_RANGE = 70;
var VENT_RANGE = 40;
var VENT_MAX_SECONDS = 15;
var SABOTAGE_MIN_GAP = 45;
var SABOTAGE_MAX_GAP = 70;
var SABOTAGE_COUNTDOWN = 40;
var MEETING_TESTIMONY_SECONDS = 7;
var MEETING_VOTE_SECONDS = 20;
var MATCH_LIMIT_SECONDS = 420;
var BOT_TASKS = 5;
var BOT_FIRST_KILL_DELAY = 22;
var BOT_WORK_MIN = 3.5;
var BOT_WORK_MAX = 7.5;
var BOT_IDLE_MIN = 0.8;
var BOT_IDLE_MAX = 2.6;
var ZONE_ARRIVE = 16;
var GOAL_ARRIVE = 12;
var EVENT_CAP = 512;
var TASK_SEED_BOUND = 2147483647;
var PLAYER_ID = "player";
var BOT_NAMES = [
  "Nova",
  "Pixel",
  "Bytes",
  "Rusty",
  "Circuit",
  "Glitch",
  "Cobalt",
  "Torque",
  "Widget",
  "Solder"
];
var BOT_TAGS = [
  "methodical",
  "twitchy",
  "quiet",
  "chatty",
  "paranoid",
  "steady",
  "sarcastic",
  "nervous",
  "bold",
  "careful"
];
var COLOR_IDS = Object.keys(CREW_COLORS);
function playerColorFor(seed) {
  const rng = createRng(hashSeed(`${seed}:player-color`));
  return COLOR_IDS[rng.int(COLOR_IDS.length)];
}
function createRoster(input) {
  const rng = createRng(hashSeed(`${input.seed}:roster`));
  const count = Math.max(0, Math.floor(input.botCount));
  const names = shuffle(rng, BOT_NAMES);
  const tags = shuffle(rng, BOT_TAGS);
  const palette = shuffle(rng, COLOR_IDS.filter((color) => color !== input.playerColor));
  const roster = [{
    id: PLAYER_ID,
    name: input.playerName.trim() || "You",
    color: input.playerColor,
    tag: "you",
    isPlayer: true
  }];
  for (let index = 0; index < count; index++) {
    const base = names[index % names.length];
    const cycle = Math.floor(index / names.length);
    roster.push({
      id: `bot-${index}`,
      name: cycle === 0 ? base : `${base}-${cycle + 1}`,
      color: palette.length > 0 ? palette[index % palette.length] : input.playerColor,
      tag: tags[index % tags.length],
      isPlayer: false
    });
  }
  return roster;
}
function shuffle(rng, items) {
  const out = items.slice();
  for (let index = out.length - 1; index > 0; index--) {
    const swap = rng.int(index + 1);
    const held = out[index];
    out[index] = out[swap];
    out[swap] = held;
  }
  return out;
}
function visionRadius(state) {
  return state.sabotage === "lights" ? 90 : WITNESS_RADIUS;
}
function sabotageLabel(kind) {
  switch (kind) {
    case "lights":
      return "Lights sabotaged";
    case "comms":
      return "Comms sabotaged";
    case "o2":
      return "O2 supply failing";
    case "reactor":
      return "Reactor meltdown";
    case "none":
      return "All systems nominal";
  }
}
var CODE_REPORT = 1;
var CODE_KILL = 2;
var CODE_FIX = 3;
var CODE_EMERGENCY = 4;
var CODE_TASK = 5;
var CODE_TRIGGER = 6;
var CODE_VENT = 7;
var CODE_VENT_EXIT = 8;
var roomNames = STATION.zones.filter((zone) => zone.kind === "room").map((zone) => zone.name);
var NO_LINKS = [];
var probe = { x: 0, y: 0 };
var adjacency = null;
function neighbours() {
  if (adjacency) return adjacency;
  const map = /* @__PURE__ */ new Map();
  for (const zone of STATION.zones) map.set(zone.id, []);
  for (const pair of ZONE_LINKS) {
    const left = map.get(pair[0]);
    const right = map.get(pair[1]);
    if (left) left.push(pair[1]);
    if (right) right.push(pair[0]);
  }
  adjacency = map;
  return map;
}
function zoneAt(point) {
  for (const zone of STATION.zones) {
    if (point.x >= zone.x && point.x <= zone.x + zone.w && point.y >= zone.y && point.y <= zone.y + zone.h) {
      return zone.id;
    }
  }
  return null;
}
function routeTo(fromZone, toZone) {
  if (fromZone === toZone) return [fromZone];
  const graph = neighbours();
  const cameFrom = /* @__PURE__ */ new Map();
  const queue = [fromZone];
  cameFrom.set(fromZone, fromZone);
  for (let head = 0; head < queue.length; head++) {
    const zone = queue[head];
    const links = graph.get(zone) ?? NO_LINKS;
    for (const next of links) {
      if (cameFrom.has(next)) continue;
      cameFrom.set(next, zone);
      if (next === toZone) {
        const path = [next];
        let cursor = zone;
        while (cursor !== fromZone) {
          path.push(cursor);
          cursor = cameFrom.get(cursor) ?? fromZone;
        }
        path.push(fromZone);
        path.reverse();
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}
function mutate(actor) {
  return actor;
}
function within(a, b, radius) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy <= radius * radius;
}
function moveActor(actor, dx, dy) {
  const distance = Math.hypot(dx, dy);
  if (distance <= 0) return;
  const steps = distance > MOVE_SUBSTEP ? Math.ceil(distance / MOVE_SUBSTEP) : 1;
  const stepX = dx / steps;
  const stepY = dy / steps;
  for (let index = 0; index < steps; index++) {
    const { pos } = actor;
    const nextX = pos.x + stepX;
    const nextY = pos.y + stepY;
    probe.x = nextX;
    probe.y = nextY;
    if (isWalkable(STATION, probe, ACTOR_RADIUS)) {
      pos.x = nextX;
      pos.y = nextY;
      continue;
    }
    probe.x = nextX;
    probe.y = pos.y;
    if (isWalkable(STATION, probe, ACTOR_RADIUS)) {
      pos.x = nextX;
      continue;
    }
    probe.x = pos.x;
    probe.y = nextY;
    if (isWalkable(STATION, probe, ACTOR_RADIUS)) {
      pos.y = nextY;
    }
  }
}
function createMatch(config) {
  const roleRng = createRng(hashSeed(`${config.seed}:roles`));
  const moveRng = createRng(hashSeed(`${config.seed}:bots`));
  const taskRng = createRng(hashSeed(`${config.seed}:tasks`));
  const sabotageRng = createRng(hashSeed(`${config.seed}:sabotage`));
  const meetingRng = createRng(hashSeed(`${config.seed}:meeting`));
  const voteRng = createRng(hashSeed(`${config.seed}:votes`));
  const roster = createRoster({
    seed: config.seed,
    botCount: config.botCount,
    playerName: config.playerName,
    playerColor: playerColorFor(config.seed)
  });
  const total = roster.length;
  const impostorCount = total >= 7 ? 2 : 1;
  const botImpostorSlots = Math.max(0, impostorCount - (config.playerRole === "impostor" ? 1 : 0));
  const botEntries = roster.filter((entry) => !entry.isPlayer);
  const impostorIds = new Set(shuffle(roleRng, botEntries).slice(0, botImpostorSlots).map((entry) => entry.id));
  const actors = roster.map((entry, index) => {
    const role = entry.isPlayer ? config.playerRole : impostorIds.has(entry.id) ? "impostor" : "crew";
    const spawn = entry.isPlayer ? STATION.playerSpawn : STATION.botSpawns[(index - 1) % STATION.botSpawns.length];
    return {
      id: entry.id,
      name: entry.name,
      color: entry.color,
      role,
      alive: true,
      isPlayer: entry.isPlayer,
      pos: { x: spawn.x, y: spawn.y },
      facing: "down",
      walking: false,
      state: "idle",
      tasksDone: 0,
      tasksTotal: entry.isPlayer ? STATION.stations.length : BOT_TASKS,
      suspicion: 0,
      lastSeen: 0,
      ventedUntil: 0,
      witnessed: false
    };
  });
  const state = {
    config,
    station: STATION,
    phase: "briefing",
    time: 0,
    actors,
    playerId: PLAYER_ID,
    activeTask: null,
    meeting: null,
    ejection: null,
    sabotage: "none",
    sabotageEndsAt: 0,
    prompt: null,
    tasksTotal: STATION.stations.length,
    tasksDone: 0,
    crewProgress: 0,
    alarm: "",
    events: [],
    version: 0,
    summary: null
  };
  const bodies = [];
  const brains = /* @__PURE__ */ new Map();
  let eventId = 0;
  let lineId = 0;
  let deaths = 0;
  let playerKills = 0;
  let playerKillReadyAt = 0;
  let emergencyUsed = false;
  let reportCount = 0;
  let correctVotes = 0;
  let wrongVotes = 0;
  let sabotageToken = 0;
  let nextSabotageAt = sabotageRng.range(SABOTAGE_MIN_GAP, SABOTAGE_MAX_GAP);
  let plan = null;
  let promptKey = "";
  let promptRecord = null;
  let alarmTick = -2;
  let alarmKind = "none";
  function bump() {
    state.version++;
  }
  function actorById(id) {
    for (const actor of state.actors) if (actor.id === id) return actor;
    return null;
  }
  function playerActor() {
    return actorById(state.playerId) ?? state.actors[0];
  }
  function countLiving(role) {
    let count = 0;
    for (const actor of state.actors) if (actor.alive && actor.role === role) count++;
    return count;
  }
  function nameOf(id) {
    return actorById(id)?.name ?? "Unknown";
  }
  function stationById(id) {
    if (!id) return null;
    for (const station of STATION.stations) if (station.id === id) return station;
    return null;
  }
  function consoleById(id) {
    if (!id) return null;
    for (const console2 of CONSOLES) if (console2.id === id) return console2;
    return null;
  }
  function consoleFor(kind) {
    for (const console2 of CONSOLES) if (console2.sabotage === kind) return console2;
    return null;
  }
  function isLethalSabotage() {
    return state.sabotage === "reactor" || state.sabotage === "o2";
  }
  function recomputeProgress() {
    const player = playerActor();
    let done = 0;
    let total2 = 0;
    for (const actor of state.actors) {
      if (actor.role !== "crew") continue;
      done += actor.tasksDone;
      total2 += actor.tasksTotal;
    }
    state.crewProgress = total2 > 0 ? Math.min(1, done / total2) : 0;
    state.tasksDone = player.tasksDone;
    state.tasksTotal = player.tasksTotal;
  }
  function pushEvent(kind, text, actorId, sabotage) {
    const event = {
      id: ++eventId,
      kind,
      text,
      at: state.time,
      ...actorId !== void 0 ? { actorId } : {},
      ...sabotage !== void 0 ? { sabotage } : {}
    };
    if (state.events.length >= EVENT_CAP) state.events.shift();
    state.events.push(event);
    bump();
  }
  function setFacing(actor, dx, dy) {
    if (Math.abs(dx) > Math.abs(dy)) actor.facing = dx < 0 ? "left" : "right";
    else actor.facing = dy < 0 ? "up" : "down";
  }
  function clearSabotageSilently() {
    if (state.sabotage === "none") return;
    state.sabotage = "none";
    state.sabotageEndsAt = 0;
    sabotageToken++;
  }
  function clearSabotage(console2, actor) {
    const kind = state.sabotage;
    clearSabotageSilently();
    pushEvent("sabotage-fixed", `${actor.name} repaired ${sabotageLabel(kind).toLowerCase()} at the ${console2.name}`, actor.id, kind);
    checkOutcome();
    bump();
  }
  function triggerSabotage(kind, actor) {
    if (kind === "none" || state.sabotage !== "none") return;
    state.sabotage = kind;
    state.sabotageEndsAt = kind === "reactor" || kind === "o2" ? state.time + SABOTAGE_COUNTDOWN : 0;
    sabotageToken++;
    pushEvent("sabotage", `${sabotageLabel(kind)} \u2014 report to ${consoleFor(kind)?.name ?? "the console"}`, actor.isPlayer ? actor.id : void 0, kind);
    bump();
  }
  function evaluateOutcome() {
    const livingImpostors = countLiving("impostor");
    const livingCrew = countLiving("crew");
    if (state.crewProgress >= 1) return "crew-win";
    if (deaths > 0 && livingImpostors === 0) return "crew-win";
    if (deaths > 0 && livingImpostors >= livingCrew) return "impostor-win";
    if (state.sabotage !== "none" && state.sabotageEndsAt > 0 && state.time >= state.sabotageEndsAt) return "impostor-win";
    if (state.time >= MATCH_LIMIT_SECONDS) return "timeout";
    return null;
  }
  function checkOutcome() {
    if (state.phase !== "play") return;
    const outcome = evaluateOutcome();
    if (outcome) endMatch(outcome);
  }
  function buildSummary(outcome) {
    const player = playerActor();
    const playerRole = player.role;
    const playerWon = outcome === "crew-win" === (playerRole === "crew");
    const tasksDone = player.tasksDone;
    const kills = playerKills;
    const bonus = playerRole === "crew" ? tasksDone >= 5 && correctVotes > 0 : kills >= 2;
    const stars = Math.min(3, 1 + (playerWon ? 1 : 0) + (bonus ? 1 : 0));
    const rank = stars === 3 ? "Commander" : stars === 2 ? "Specialist" : "Recruit";
    return {
      outcome,
      playerWon,
      playerRole,
      playerAlive: player.alive,
      tasksDone,
      tasksTotal: player.tasksTotal,
      correctVotes,
      wrongVotes,
      reported: reportCount,
      kills,
      stars,
      rank,
      salvagePoints: 40 + 30 * stars + 5 * tasksDone + 10 * kills
    };
  }
  function endMatch(outcome) {
    if (state.phase === "over") return;
    state.phase = "over";
    state.activeTask = null;
    state.summary = buildSummary(outcome);
    promptKey = "";
    promptRecord = null;
    state.prompt = null;
    const summary = state.summary;
    pushEvent(
      summary.playerWon ? "win" : "lose",
      outcome === "timeout" ? "Extraction window closed \u2014 impostors got away with it" : outcome === "crew-win" ? "Station secured \u2014 crew wins" : "The impostors win"
    );
    bump();
  }
  function resetRound() {
    bodies.length = 0;
    clearSabotageSilently();
    state.meeting = null;
    state.ejection = null;
    state.activeTask = null;
    plan = null;
    let botIndex = 0;
    for (const actor of state.actors) {
      const spawn = actor.isPlayer ? STATION.playerSpawn : STATION.botSpawns[botIndex++ % STATION.botSpawns.length];
      const live = mutate(actor);
      live.pos.x = spawn.x;
      live.pos.y = spawn.y;
      actor.walking = false;
      actor.ventedUntil = 0;
      actor.facing = "down";
      actor.state = actor.alive ? "idle" : "down";
      const brain = brains.get(actor.id);
      if (brain) {
        brain.goal = null;
        brain.path = [];
        brain.pathIndex = 0;
        brain.working = false;
        brain.idleUntil = 0;
        brain.repairing = false;
      }
    }
    nextSabotageAt = state.time + sabotageRng.range(SABOTAGE_MIN_GAP, SABOTAGE_MAX_GAP);
    bump();
    refreshPrompt();
  }
  function applyBodySuspicion(victimId, reporterId) {
    let spot = null;
    for (const body of bodies) if (body.actorId === victimId) spot = body;
    if (!spot) return;
    for (const actor of state.actors) {
      if (!actor.alive || actor.id === victimId || actor.id === reporterId) continue;
      if (within(actor.pos, spot, BODY_SUSPICION_RADIUS)) actor.suspicion += 2;
    }
  }
  function testimony(speaker, reporter, victim) {
    const others = state.actors.filter((actor) => actor.alive && actor.id !== speaker.id);
    const target = others.length > 0 ? meetingRng.pick(others) : speaker;
    const zone = meetingRng.pick(roomNames);
    if (speaker.role === "impostor") {
      return meetingRng.pick([
        `it's ${target.name}, I saw them near ${zone}`,
        `${target.name} was following me around ${zone}`,
        `I was doing tasks in ${zone} and ${target.name} came out of nowhere`,
        `vote ${target.name}, they are not doing tasks`,
        `${target.name} is faking tasks in ${zone}`
      ]);
    }
    const pool = [
      `${zone}: where was everyone?`,
      `I was in ${zone} the whole time`,
      `I saw ${target.name} near the body`,
      `${target.name} is acting sus`,
      `where were you, ${target.name}?`,
      `I was with ${target.name} in ${zone}`,
      `skip, we have no proof`,
      `${reporter ? reporter.name : "someone"}, why did you call this?`,
      `I'm crew, I was in ${zone} doing tasks`,
      `${target.name} vented, I swear`,
      `nothing happened in ${zone}, I was watching`
    ];
    if (victim) pool.push(`rest in peace ${victim.name}, I found nothing`);
    return meetingRng.pick(pool);
  }
  function botVote(voter, living) {
    if (voter.role === "impostor") {
      let framed = null;
      for (const candidate of living) {
        if (candidate.id === voter.id || candidate.role !== "crew") continue;
        if (!framed || candidate.suspicion > framed.suspicion) framed = candidate;
      }
      if (framed && voteRng.chance(0.8)) return framed.id;
      return "skip";
    }
    let suspect = null;
    for (const candidate of living) {
      if (candidate.id === voter.id || candidate.suspicion <= 0) continue;
      if (!suspect || candidate.suspicion > suspect.suspicion) suspect = candidate;
    }
    if (suspect && voteRng.chance(0.85)) return suspect.id;
    return "skip";
  }
  function buildPlan(reporter, victim) {
    const living = state.actors.filter((actor) => actor.alive);
    const speakers = living.filter((actor) => !actor.isPlayer);
    const lines = [];
    for (const speaker of shuffle(meetingRng, speakers)) {
      const count = meetingRng.chance(0.35) ? 2 : 1;
      for (let index = 0; index < count; index++) {
        lines.push({
          at: 0.4 + meetingRng.next() * (MEETING_TESTIMONY_SECONDS - 1.1),
          actorId: speaker.id,
          name: speaker.name,
          color: speaker.color,
          text: testimony(speaker, reporter, victim)
        });
      }
    }
    lines.sort((left, right) => left.at - right.at);
    const votes = [];
    for (const voter of speakers) {
      votes.push({
        at: MEETING_TESTIMONY_SECONDS + 0.4 + voteRng.next() * 15,
        actorId: voter.id,
        target: botVote(voter, living)
      });
    }
    votes.sort((left, right) => left.at - right.at);
    return { lines, lineIndex: 0, votes, voteIndex: 0 };
  }
  function startMeeting(reporterId, victimId) {
    const reporter = actorById(reporterId);
    const victim = victimId ? actorById(victimId) : null;
    const meeting = {
      reporterId,
      victimId,
      startedAt: state.time,
      endsAt: state.time + MEETING_TESTIMONY_SECONDS + MEETING_VOTE_SECONDS,
      lines: [],
      votes: {},
      resolved: false
    };
    state.meeting = meeting;
    state.phase = "meeting";
    state.activeTask = null;
    clearSabotageSilently();
    for (const actor of state.actors) {
      actor.walking = false;
      actor.ventedUntil = 0;
      if (actor.alive) actor.state = "meeting";
    }
    if (victimId) applyBodySuspicion(victimId, reporterId);
    if (reporterId === state.playerId) reportCount++;
    plan = buildPlan(reporter, victim);
    pushEvent(
      "meeting",
      victim ? `${reporter?.name ?? "Someone"} reported ${victim.name}'s body` : `${reporter?.name ?? "Someone"} called an emergency meeting`,
      reporterId
    );
    state.version++;
    refreshPrompt();
  }
  function tryResolveMeeting() {
    const meeting = state.meeting;
    if (!meeting || meeting.resolved) return;
    let expected = 0;
    let cast = 0;
    for (const actor of state.actors) {
      if (!actor.alive) continue;
      expected++;
      if (actor.id in meeting.votes) cast++;
    }
    if (cast < expected && state.time < meeting.endsAt) return;
    resolveMeeting(meeting);
  }
  function resolveMeeting(meeting) {
    meeting.resolved = true;
    const tally = /* @__PURE__ */ new Map();
    let skipVotes = 0;
    for (const key in meeting.votes) {
      const target = meeting.votes[key];
      tally.set(target, (tally.get(target) ?? 0) + 1);
      if (target === "skip") skipVotes++;
    }
    let leader = null;
    let leaderVotes = 0;
    let tied = false;
    tally.forEach((count, target) => {
      if (count > leaderVotes) {
        leader = target;
        leaderVotes = count;
        tied = false;
      } else if (count === leaderVotes) tied = true;
    });
    let ejected = null;
    if (!tied && leader !== null && leader !== "skip" && leaderVotes > 0 && skipVotes < leaderVotes) {
      ejected = actorById(leader);
    }
    if (ejected) {
      const fallen = mutate(ejected);
      fallen.alive = false;
      fallen.state = "down";
      fallen.walking = false;
      deaths++;
    }
    const playerVote = state.playerId in meeting.votes ? meeting.votes[state.playerId] : null;
    if (ejected && playerVote === ejected.id) {
      if (ejected.role === "impostor") correctVotes++;
      else wrongVotes++;
    }
    const remaining = countLiving("impostor");
    state.ejection = {
      actorId: ejected ? ejected.id : null,
      name: ejected ? ejected.name : "No one",
      color: ejected ? ejected.color : "white",
      role: ejected ? ejected.role : null,
      impostorCount: remaining
    };
    state.phase = "ejection";
    bodies.length = 0;
    plan = null;
    pushEvent(
      "eject",
      ejected ? `${ejected.name} was ejected \u2014 ${ejected.role === "impostor" ? `${remaining} impostor${remaining === 1 ? "" : "s"} left` : "they were not an impostor"}` : "No one was ejected (tie or skip)",
      ejected ? ejected.id : void 0
    );
    state.version++;
    refreshPrompt();
  }
  function updateMeeting() {
    const meeting = state.meeting;
    if (!meeting || meeting.resolved || !plan) return;
    const elapsed = state.time - meeting.startedAt;
    while (plan.lineIndex < plan.lines.length && plan.lines[plan.lineIndex].at <= elapsed) {
      const planned = plan.lines[plan.lineIndex++];
      meeting.lines.push({
        id: ++lineId,
        actorId: planned.actorId,
        name: planned.name,
        color: planned.color,
        text: planned.text,
        at: state.time
      });
      bump();
    }
    if (elapsed >= MEETING_TESTIMONY_SECONDS) {
      while (plan.voteIndex < plan.votes.length && plan.votes[plan.voteIndex].at <= elapsed) {
        const planned = plan.votes[plan.voteIndex++];
        if (!(planned.actorId in meeting.votes)) {
          meeting.votes[planned.actorId] = planned.target;
          bump();
        }
      }
    }
    tryResolveMeeting();
  }
  function nearestKillTarget(killer, range) {
    let best = null;
    let bestDistance = range * range;
    for (const actor of state.actors) {
      if (actor === killer || !actor.alive || actor.role === killer.role) continue;
      if (state.time < actor.ventedUntil) continue;
      const dx = actor.pos.x - killer.pos.x;
      const dy = actor.pos.y - killer.pos.y;
      const squared = dx * dx + dy * dy;
      if (squared <= bestDistance) {
        bestDistance = squared;
        best = actor;
      }
    }
    return best;
  }
  function performKill(killer, victim, byPlayer) {
    victim.alive = false;
    victim.state = "down";
    victim.walking = false;
    victim.ventedUntil = 0;
    bodies.push({ actorId: victim.id, x: victim.pos.x, y: victim.pos.y });
    deaths++;
    if (byPlayer) {
      playerKills++;
      playerKillReadyAt = state.time + PLAYER_KILL_COOLDOWN;
    }
    for (const watcher of state.actors) {
      if (watcher === killer || watcher === victim || !watcher.alive || watcher.isPlayer) continue;
      if (state.time < watcher.ventedUntil) continue;
      if (within(watcher.pos, victim.pos, WITNESS_RADIUS) || within(watcher.pos, killer.pos, WITNESS_RADIUS)) {
        killer.suspicion += 4;
      }
    }
    const player = playerActor();
    if (player !== victim && player.alive && within(player.pos, killer.pos, visionRadius(state))) {
      killer.witnessed = true;
      pushEvent("kill", `${killer.name} eliminated ${victim.name}`, killer.id);
    }
    bump();
    checkOutcome();
  }
  function ability() {
    const player = playerActor();
    if (state.phase !== "play" || !player.alive || state.activeTask) return;
    if (player.role !== "impostor" || state.time < player.ventedUntil) return;
    if (state.time < playerKillReadyAt) return;
    const victim = nearestKillTarget(player, KILL_RANGE);
    if (!victim) return;
    performKill(player, victim, true);
  }
  function vent() {
    const player = playerActor();
    if (state.phase !== "play" || !player.alive || state.activeTask) return;
    if (player.role !== "impostor") return;
    if (state.time < player.ventedUntil) {
      player.ventedUntil = 0;
      for (const actor of state.actors) {
        if (actor.isPlayer || !actor.alive) continue;
        if (within(actor.pos, player.pos, BODY_SUSPICION_RADIUS)) {
          player.suspicion += 3;
          player.witnessed = true;
        }
      }
      bump();
      refreshPrompt();
      return;
    }
    let spot = null;
    let linked = null;
    for (const entry of STATION.vents) {
      if (within(player.pos, entry, VENT_RANGE)) {
        spot = entry;
        linked = entry.link;
      }
    }
    if (!spot || !linked) return;
    let exit = null;
    for (const entry of STATION.vents) if (entry.id === linked) exit = entry;
    if (!exit) return;
    const live = mutate(player);
    live.pos.x = exit.x;
    live.pos.y = exit.y;
    player.ventedUntil = state.time + VENT_MAX_SECONDS;
    player.walking = false;
    player.state = "idle";
    player.facing = "down";
    bump();
    refreshPrompt();
  }
  function assignPrompt(code, target) {
    const key = code === 0 ? "" : `${code}:${target ?? ""}`;
    if (key === promptKey) return;
    promptKey = key;
    if (code === 0) {
      promptRecord = null;
      state.prompt = null;
      bump();
      return;
    }
    switch (code) {
      case CODE_REPORT: {
        promptRecord = {
          key,
          id: `report:${target ?? ""}`,
          kind: "report",
          action: "report",
          label: `Report ${nameOf(target ?? "")}`,
          targetId: target,
          sabotage: "none"
        };
        break;
      }
      case CODE_KILL: {
        promptRecord = {
          key,
          id: `kill:${target ?? ""}`,
          kind: "kill",
          action: "kill",
          label: `Eliminate ${nameOf(target ?? "")}`,
          targetId: target,
          sabotage: "none"
        };
        break;
      }
      case CODE_FIX: {
        const console2 = consoleById(target);
        promptRecord = {
          key,
          id: `fix:${target ?? ""}`,
          kind: "task",
          action: "fix",
          label: `Repair ${console2?.sabotage ?? "system"}`,
          targetId: target,
          sabotage: console2?.sabotage ?? "none"
        };
        break;
      }
      case CODE_EMERGENCY: {
        promptRecord = {
          key,
          id: "emergency",
          kind: "emergency",
          action: "emergency",
          label: "Call emergency meeting",
          targetId: null,
          sabotage: "none"
        };
        break;
      }
      case CODE_TASK: {
        const station = stationById(target);
        promptRecord = {
          key,
          id: `task:${target ?? ""}`,
          kind: "task",
          action: "task",
          label: station?.name ?? "Task",
          targetId: target,
          sabotage: "none"
        };
        break;
      }
      case CODE_TRIGGER: {
        const console2 = consoleById(target);
        promptRecord = {
          key,
          id: `sabotage:${target ?? ""}`,
          kind: "kill",
          action: "trigger",
          label: `Sabotage ${console2?.sabotage ?? "system"}`,
          targetId: target,
          sabotage: console2?.sabotage ?? "none"
        };
        break;
      }
      case CODE_VENT: {
        promptRecord = {
          key,
          id: `vent:${target ?? ""}`,
          kind: "vent",
          action: "vent",
          label: "Enter vent",
          targetId: target,
          sabotage: "none"
        };
        break;
      }
      default: {
        promptRecord = {
          key,
          id: "vent:exit",
          kind: "vent",
          action: "vent",
          label: "Leave vent",
          targetId: null,
          sabotage: "none"
        };
        break;
      }
    }
    state.prompt = { id: promptRecord.id, label: promptRecord.label, kind: promptRecord.kind };
    bump();
  }
  function refreshPrompt() {
    const player = playerActor();
    let code = 0;
    let target = null;
    let score = -1;
    if (state.phase === "play" && player.alive && !state.activeTask) {
      if (state.time < player.ventedUntil) {
        code = CODE_VENT_EXIT;
      } else {
        for (const body of bodies) {
          if (within(player.pos, body, INTERACT_RANGE) && 100 > score) {
            code = CODE_REPORT;
            target = body.actorId;
            score = 100;
          }
        }
        if (player.role === "impostor" && state.time >= playerKillReadyAt) {
          const victim = nearestKillTarget(player, KILL_RANGE);
          if (victim && 90 > score) {
            code = CODE_KILL;
            target = victim.id;
            score = 90;
          }
        }
        if (state.sabotage !== "none") {
          const console2 = consoleFor(state.sabotage);
          if (console2 && within(player.pos, console2, INTERACT_RANGE) && 80 > score) {
            code = CODE_FIX;
            target = console2.id;
            score = 80;
          }
        }
        if (!emergencyUsed && within(player.pos, STATION.emergency, INTERACT_RANGE) && 70 > score) {
          code = CODE_EMERGENCY;
          target = null;
          score = 70;
        }
        if (player.role === "crew") {
          for (const station of STATION.stations) {
            if (within(player.pos, station, INTERACT_RANGE) && 60 > score) {
              code = CODE_TASK;
              target = station.id;
              score = 60;
            }
          }
        }
        if (player.role === "impostor" && state.sabotage === "none") {
          for (const console2 of CONSOLES) {
            if (console2.kind !== "sabotage-trigger") continue;
            if (within(player.pos, console2, INTERACT_RANGE) && 50 > score) {
              code = CODE_TRIGGER;
              target = console2.id;
              score = 50;
            }
          }
        }
        if (player.role === "impostor") {
          for (const entry of STATION.vents) {
            if (within(player.pos, entry, VENT_RANGE) && 40 > score) {
              code = CODE_VENT;
              target = entry.id;
              score = 40;
            }
          }
        }
      }
    }
    assignPrompt(code, target);
  }
  function interact() {
    if (state.phase !== "play" || state.activeTask) return;
    refreshPrompt();
    const record = promptRecord;
    if (!record) return;
    switch (record.action) {
      case "task": {
        const station = stationById(record.targetId);
        if (!station) return;
        state.activeTask = {
          stationId: station.id,
          name: station.name,
          kind: station.kind,
          seed: taskRng.int(TASK_SEED_BOUND),
          long: station.long
        };
        bump();
        return;
      }
      case "report": {
        if (!record.targetId) return;
        startMeeting(state.playerId, record.targetId);
        return;
      }
      case "emergency": {
        if (emergencyUsed) return;
        emergencyUsed = true;
        startMeeting(state.playerId, null);
        return;
      }
      case "vent": {
        vent();
        return;
      }
      case "kill": {
        ability();
        return;
      }
      case "fix": {
        const console2 = consoleById(record.targetId);
        if (!console2 || state.sabotage !== console2.sabotage) return;
        clearSabotage(console2, playerActor());
        refreshPrompt();
        return;
      }
      case "trigger": {
        const console2 = consoleById(record.targetId);
        if (!console2) return;
        triggerSabotage(console2.sabotage, playerActor());
        refreshPrompt();
        return;
      }
    }
  }
  function finishTask(stationId, success, roll2) {
    const attempt = state.activeTask;
    void roll2;
    if (!attempt || attempt.stationId !== stationId) return;
    state.activeTask = null;
    if (success) {
      const player = playerActor();
      player.tasksDone++;
      recomputeProgress();
      pushEvent("task-done", `${attempt.name} complete`, state.playerId);
      checkOutcome();
    } else {
      pushEvent("task-failed", `${attempt.name} failed \u2014 try again`, state.playerId);
    }
    bump();
  }
  function cancelTask() {
    if (!state.activeTask) return;
    state.activeTask = null;
    bump();
  }
  function vote(target) {
    const meeting = state.meeting;
    if (!meeting || meeting.resolved || state.phase !== "meeting") return;
    const player = playerActor();
    if (!player.alive) return;
    if (state.time - meeting.startedAt < MEETING_TESTIMONY_SECONDS) return;
    if (target !== "skip" && !actorById(target)) return;
    meeting.votes[state.playerId] = target;
    pushEvent("vote", target === "skip" ? "You voted to skip" : `You voted for ${nameOf(target)}`, state.playerId);
    state.version++;
    tryResolveMeeting();
  }
  function advance() {
    if (state.phase === "briefing") {
      state.phase = "play";
      pushEvent("info", "Match started \u2014 check your task list");
      bump();
      refreshPrompt();
      return;
    }
    if (state.phase === "ejection") {
      const outcome = evaluateOutcome();
      resetRound();
      if (outcome) endMatch(outcome);
      else {
        state.phase = "play";
        bump();
      }
    }
  }
  function drainEvents() {
    const drained = state.events;
    state.events = [];
    return drained;
  }
  function pickStation(brain) {
    const stations = STATION.stations;
    let index = moveRng.int(stations.length);
    if (stations.length > 1 && stations[index].id === brain.lastStation) index = (index + 1) % stations.length;
    const station = stations[index];
    brain.lastStation = station.id;
    return station;
  }
  function buildPath(from, goalX, goalY) {
    const startZone = zoneAt(from);
    probe.x = goalX;
    probe.y = goalY;
    const goalZone = zoneAt(probe);
    const points = [];
    if (startZone && goalZone && startZone !== goalZone) {
      const route = routeTo(startZone, goalZone);
      if (route) {
        for (let index = 1; index < route.length; index++) {
          const hub = HUBS[route[index]];
          if (hub) points.push(hub);
        }
      }
    }
    points.push({ x: goalX, y: goalY });
    return points;
  }
  function assignGoal(actor, brain) {
    let goal = null;
    if (brain.repairing && state.sabotage !== "none") {
      const console2 = consoleFor(state.sabotage);
      if (console2) {
        goal = { kind: "repair", x: console2.x, y: console2.y, stationId: console2.id, sabotage: console2.sabotage };
      }
    }
    if (!goal) {
      const station = pickStation(brain);
      goal = { kind: "task", x: station.x, y: station.y, stationId: station.id, sabotage: "none" };
    }
    brain.goal = goal;
    brain.path = buildPath(actor.pos, goal.x, goal.y);
    brain.pathIndex = 0;
  }
  function finishBotWork(actor, brain) {
    const goal = brain.goal;
    brain.goal = null;
    brain.path = [];
    brain.pathIndex = 0;
    brain.idleUntil = state.time + moveRng.range(BOT_IDLE_MIN, BOT_IDLE_MAX);
    if (!goal) return;
    if (goal.kind === "repair") {
      brain.repairing = false;
      if (state.sabotage !== "none" && state.sabotage === goal.sabotage) {
        const console2 = consoleFor(state.sabotage);
        if (console2) clearSabotage(console2, actor);
      }
      return;
    }
    if (actor.role === "crew" && actor.tasksDone < actor.tasksTotal) {
      actor.tasksDone++;
      recomputeProgress();
      bump();
      checkOutcome();
    }
  }
  function tryBotKill(killer, brain) {
    if (state.time < brain.killReadyAt) return;
    const victim = nearestKillTarget(killer, KILL_RANGE);
    if (!victim) return;
    for (const other of state.actors) {
      if (other === killer || other === victim || !other.alive) continue;
      if (state.time < other.ventedUntil) continue;
      if (within(other.pos, killer.pos, BOT_KILL_SAFE_RADIUS)) return;
      if (within(other.pos, victim.pos, BOT_KILL_SAFE_RADIUS)) return;
    }
    performKill(killer, victim, false);
    brain.killReadyAt = state.time + BOT_KILL_COOLDOWN + moveRng.range(-3, 4);
  }
  function updateBot(actor, brain, dt) {
    if (state.phase !== "play") {
      actor.walking = false;
      return;
    }
    if (brain.working) {
      actor.walking = false;
      actor.state = "working";
      if (state.time < brain.workingUntil) return;
      brain.working = false;
      finishBotWork(actor, brain);
      return;
    }
    if (state.time < brain.idleUntil) {
      actor.walking = false;
      if (actor.state !== "working") actor.state = "idle";
      return;
    }
    if (brain.sabotageToken !== sabotageToken) {
      brain.sabotageToken = sabotageToken;
      brain.repairing = actor.role === "crew" && (isLethalSabotage() || moveRng.chance(0.5));
      brain.goal = null;
      brain.pathIndex = 0;
    }
    if (brain.repairing && state.sabotage === "none") {
      brain.repairing = false;
      brain.goal = null;
    }
    if (!brain.goal) assignGoal(actor, brain);
    const goal = brain.goal;
    if (!goal) return;
    const onWaypoint = brain.pathIndex < brain.path.length;
    const waypoint = onWaypoint ? brain.path[brain.pathIndex] : goal;
    const dx = waypoint.x - actor.pos.x;
    const dy = waypoint.y - actor.pos.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= (onWaypoint ? ZONE_ARRIVE : GOAL_ARRIVE)) {
      if (onWaypoint) {
        brain.pathIndex++;
        return;
      }
      brain.working = true;
      brain.workingUntil = state.time + moveRng.range(BOT_WORK_MIN, BOT_WORK_MAX);
      actor.walking = false;
      actor.state = "working";
      return;
    }
    const step = Math.min(distance, BOT_SPEED * dt);
    moveActor(actor, dx / distance * step, dy / distance * step);
    actor.walking = true;
    if (actor.state !== "working") actor.state = "walking";
    setFacing(actor, dx, dy);
  }
  function updateBotActor(actor, dt) {
    if (actor.isPlayer || !actor.alive) return true;
    if (state.time < actor.ventedUntil) {
      actor.walking = false;
      actor.state = "idle";
      return true;
    }
    let brain = brains.get(actor.id);
    if (!brain) {
      brain = {
        goal: null,
        path: [],
        pathIndex: 0,
        working: false,
        workingUntil: 0,
        idleUntil: 0,
        sabotageToken: 0,
        repairing: false,
        killReadyAt: state.time + BOT_FIRST_KILL_DELAY + moveRng.range(0, 10),
        lastStation: ""
      };
      brains.set(actor.id, brain);
    }
    if (actor.role === "impostor") {
      tryBotKill(actor, brain);
      if (state.phase !== "play") {
        actor.walking = false;
        return false;
      }
    }
    updateBot(actor, brain, dt);
    return true;
  }
  function updateBots(dt) {
    for (const actor of state.actors) {
      if (!updateBotActor(actor, dt)) return;
    }
  }
  function driveActor(actor, dt, input) {
    if (!actor.alive || state.time < actor.ventedUntil) {
      actor.walking = false;
      if (actor.state !== "down") actor.state = "idle";
      return;
    }
    let dx = 0;
    let dy = 0;
    if (input.left) dx -= 1;
    if (input.right) dx += 1;
    if (input.up) dy -= 1;
    if (input.down) dy += 1;
    if (dx === 0 && dy === 0 && input.destination) {
      const toX = input.destination.x - actor.pos.x;
      const toY = input.destination.y - actor.pos.y;
      const distance = Math.hypot(toX, toY);
      if (distance > 6) {
        dx = toX / distance;
        dy = toY / distance;
      }
    }
    if (dx === 0 && dy === 0) {
      actor.walking = false;
      if (actor.state !== "down") actor.state = "idle";
      return;
    }
    const length = Math.hypot(dx, dy) || 1;
    const step = PLAYER_SPEED * dt;
    moveActor(actor, dx / length * step, dy / length * step);
    actor.walking = true;
    if (actor.state !== "down") actor.state = "walking";
    setFacing(actor, dx, dy);
  }
  function updatePlayer(dt, input) {
    driveActor(playerActor(), dt, input);
  }
  function updateActorsFromInputs(dt, input, actorInputs) {
    for (const actor of state.actors) {
      const supplied = actorInputs[actor.id];
      if (supplied !== void 0) {
        driveActor(actor, dt, supplied);
        continue;
      }
      if (actor.isPlayer) {
        driveActor(actor, dt, input);
        continue;
      }
      if (!updateBotActor(actor, dt)) return;
    }
  }
  function refreshLastSeen() {
    const player = playerActor();
    if (!player.alive) return;
    const radius = visionRadius(state);
    for (const actor of state.actors) {
      if (actor.isPlayer || !actor.alive) continue;
      if (state.time < actor.ventedUntil) continue;
      if (within(actor.pos, player.pos, radius)) actor.lastSeen = state.time;
    }
  }
  function refreshAlarm() {
    const seconds = state.sabotageEndsAt > 0 ? Math.max(0, Math.ceil(state.sabotageEndsAt - state.time)) : -1;
    if (seconds === alarmTick && alarmKind === state.sabotage) return;
    alarmTick = seconds;
    alarmKind = state.sabotage;
    const next = state.sabotage === "none" ? "" : state.sabotage === "lights" ? "LIGHTS OFFLINE \u2014 vision reduced" : state.sabotage === "comms" ? "COMMS DOWN \u2014 task list offline" : `${sabotageLabel(state.sabotage).toUpperCase()} \u2014 ${seconds}s TO IMPACT`;
    if (next !== state.alarm) {
      state.alarm = next;
      bump();
    }
  }
  function updateSabotageClock() {
    if (state.sabotage !== "none" && state.sabotageEndsAt > 0 && state.time >= state.sabotageEndsAt) {
      endMatch("impostor-win");
      return;
    }
    if (state.sabotage !== "none" || state.time < nextSabotageAt) return;
    let trigger = null;
    for (const actor of state.actors) {
      if (!actor.alive || actor.isPlayer || actor.role !== "impostor") continue;
      if (!trigger) trigger = actor;
    }
    if (trigger) triggerSabotage(sabotageRng.pick(["reactor", "o2", "lights", "comms"]), trigger);
    nextSabotageAt = state.time + sabotageRng.range(SABOTAGE_MIN_GAP, SABOTAGE_MAX_GAP);
  }
  function update(dtSeconds, input, actorInputs) {
    const dt = dtSeconds > MAX_DT ? MAX_DT : dtSeconds > 0 ? dtSeconds : 0;
    state.time += dt;
    if (state.phase === "play") {
      recomputeProgress();
      if (!state.activeTask) {
        if (actorInputs === void 0) {
          updatePlayer(dt, input);
          updateBots(dt);
        } else {
          updateActorsFromInputs(dt, input, actorInputs);
        }
        checkOutcome();
      }
      if (state.phase === "play") updateSabotageClock();
      refreshLastSeen();
    } else if (state.phase === "meeting") {
      updateMeeting();
    }
    refreshAlarm();
    refreshPrompt();
  }
  refreshPrompt();
  recomputeProgress();
  return { state, update, interact, ability, vent, finishTask, cancelTask, vote, advance, drainEvents };
}

// experiments/room-log/src/digest.ts
import { createHash as createHash2 } from "node:crypto";
function hash(text) {
  return createHash2("sha256").update(text, "utf8").digest("hex");
}
function stateDigest(state) {
  const value = state;
  const actor = (entry) => [
    entry.id,
    entry.name,
    entry.color,
    entry.role,
    entry.alive ? 1 : 0,
    entry.isPlayer ? 1 : 0,
    entry.pos.x,
    entry.pos.y,
    entry.facing,
    entry.walking ? 1 : 0,
    entry.state,
    entry.tasksDone,
    entry.tasksTotal,
    entry.suspicion,
    entry.lastSeen,
    entry.ventedUntil,
    entry.witnessed ? 1 : 0
  ];
  const event = (entry) => [entry.id, entry.kind, entry.text, entry.at, entry.actorId ?? null, entry.sabotage ?? null];
  const meeting = value.meeting ? {
    reporterId: value.meeting.reporterId,
    victimId: value.meeting.victimId,
    startedAt: value.meeting.startedAt,
    endsAt: value.meeting.endsAt,
    resolved: value.meeting.resolved,
    lines: value.meeting.lines.map((line2) => [line2.id, line2.actorId, line2.text, line2.at]),
    votes: Object.keys(value.meeting.votes).sort().map((key) => [key, value.meeting.votes[key]])
  } : null;
  const payload = {
    seed: value.config.seed,
    phase: value.phase,
    time: value.time,
    playerId: value.playerId,
    version: value.version,
    actors: value.actors.map(actor),
    activeTask: value.activeTask ? [value.activeTask.stationId, value.activeTask.kind, value.activeTask.seed] : null,
    meeting,
    ejection: value.ejection,
    sabotage: value.sabotage,
    sabotageEndsAt: value.sabotageEndsAt,
    prompt: value.prompt ? [value.prompt.id, value.prompt.label, value.prompt.kind] : null,
    tasksTotal: value.tasksTotal,
    tasksDone: value.tasksDone,
    crewProgress: value.crewProgress,
    alarm: value.alarm,
    events: value.events.map(event),
    summary: value.summary
  };
  return hash(JSON.stringify(payload));
}

// experiments/room-log/src/room.ts
var STEWARD_SECRET = "ip-room-spike/v1/steward";
function secretFor(roomId, purpose, steward = STEWARD_SECRET) {
  return sha256hex(`${steward}|${roomId}|${purpose}`);
}
var IDLE = { up: false, down: false, left: false, right: false, destination: null };
function generateActions(tag, slot, frames2) {
  const rng = createRng(hashSeed(`${tag}:actions:${slot}`));
  const actions = [];
  let direction = null;
  let remaining = 0;
  for (let frame = 0; frame < frames2; frame++) {
    if (remaining <= 0) {
      if (rng.int(10) < 6) {
        const pick = rng.int(4);
        direction = [pick === 0, pick === 1, pick === 2, pick === 3];
        remaining = 20 + rng.int(40);
      } else {
        direction = null;
        remaining = 5 + rng.int(20);
      }
    }
    remaining--;
    actions.push({
      up: direction ? direction[0] : false,
      down: direction ? direction[1] : false,
      left: direction ? direction[2] : false,
      right: direction ? direction[3] : false,
      destination: null
    });
  }
  return actions;
}
function actorIdForSlot(slot) {
  return slot === 0 ? "player" : `bot-${slot - 1}`;
}
function buildRoomLog(spec) {
  if (spec.supplied.length !== SLOT_COUNT) throw new Error(`supplied[] must cover ${SLOT_COUNT} slots`);
  const dt = 1 / 60;
  const frames2 = spec.frames;
  const commitMatch = commitMatchSeed(spec.seedMatch);
  const commitDrop = commitDropSeed(spec.seedDrop);
  const config = {
    seed: hashSeed(spec.seedMatch),
    tier: spec.tier,
    playerRole: spec.playerRole,
    botCount: spec.botCount,
    playerName: spec.playerName,
    friendId: spec.friendId
  };
  const match = createMatch(config);
  const actionsBySlot = /* @__PURE__ */ new Map();
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    if (spec.supplied[slot]) actionsBySlot.set(slot, generateActions(spec.roomId, slot, frames2));
  }
  const wallets = Array.from({ length: SLOT_COUNT }, (_, slot) => walletFor(spec.roomId, slot));
  const drops = [];
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const entry = roll(spec.seedDrop, slot, 0);
    drops.push({ slot, passIndex: 0, drip: entry.id, label: entry.label, rfCents: entry.rfCents });
  }
  const amounts = wallets.map((wallet, slot) => ({
    wallet,
    slot,
    amountCents: drops.filter((drop) => drop.slot === slot).reduce((sum, drop) => sum + drop.rfCents, 0)
  }));
  const leaves = amounts.map((amount) => ({ wallet: amount.wallet, amountCents: amount.amountCents }));
  const tree = buildTree(leaves);
  const joinAt = (slot) => 1 + slot * 0.25;
  const playFrom = 1 + SLOT_COUNT * 0.25;
  const playTo = playFrom + frames2 * dt;
  const settleAt = playTo + 0.5;
  const matchStream = [];
  const economyStream = [];
  const sealed = {};
  const genesis = {
    stream: "match",
    kind: "genesis",
    at: 0,
    roomId: spec.roomId,
    tier: spec.tier,
    botCount: spec.botCount,
    playerRole: spec.playerRole,
    playerName: spec.playerName,
    friendId: spec.friendId,
    slotCount: SLOT_COUNT,
    roundSeconds: spec.roundSeconds,
    frameSeconds: dt,
    frames: frames2,
    sponsor: spec.sponsor,
    supplyCents: spec.supplyCents,
    passPriceCents: PASS_PRICE_CENTS,
    commitMatch,
    commitDrop,
    // The lobby snapshot is public — the seven Friends are literally visible in
    // the room. It carries NO role information.
    roster: match.state.actors.map((actor, slot) => ({ slot, actorId: actor.id, name: actor.name, color: actor.color }))
  };
  matchStream.push(genesis);
  const deposit = { stream: "economy", kind: "deposit", at: 0, sponsor: spec.sponsor, amountCents: spec.supplyCents };
  economyStream.push(deposit);
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const supplied = spec.supplied[slot];
    const actions = actionsBySlot.get(slot) ?? null;
    const commitment = actions ? actionsDigest(actions) : null;
    const join = {
      stream: "match",
      kind: "join",
      at: joinAt(slot),
      slot,
      actorId: actorIdForSlot(slot),
      wallet: wallets[slot],
      supplied,
      frames: supplied ? frames2 : 0,
      actionsCommitment: commitment
    };
    matchStream.push(join);
    if (actions && commitment) {
      const runSealed = { stream: "match", kind: "run-sealed", at: joinAt(slot), slot, frames: frames2, actionsCommitment: commitment };
      matchStream.push(runSealed);
      sealed[String(slot)] = { slot, frames: frames2, actionsCommitment: commitment, actions, revealedAt: settleAt };
    }
    const pass = { stream: "economy", kind: "pass-purchase", at: joinAt(slot), slot, wallet: wallets[slot], priceCents: PASS_PRICE_CENTS };
    economyStream.push(pass);
    const drop = drops[slot];
    const draw = {
      stream: "economy",
      kind: "cache-draw",
      at: joinAt(slot),
      slot,
      wallet: wallets[slot],
      passIndex: drop.passIndex,
      drip: drop.drip,
      label: drop.label,
      rfCents: drop.rfCents,
      hiddenUntil: "settle"
    };
    economyStream.push(draw);
  }
  match.advance();
  const actorIdBySlot = new Map(matchStream.filter((event) => event.kind === "join").map((event) => [event.slot, event.actorId]));
  for (let frame = 0; frame < frames2; frame++) {
    const frameMap = {};
    for (const [slot, actions] of actionsBySlot) frameMap[actorIdBySlot.get(slot) ?? actorIdForSlot(slot)] = actions[frame];
    if (Object.keys(frameMap).length > 0) match.update(dt, IDLE, frameMap);
    else match.update(dt, IDLE);
  }
  const close = {
    stream: "match",
    kind: "close",
    at: playTo,
    revealSeedMatch: spec.seedMatch,
    runs: Array.from(actionsBySlot.entries()).map(([slot, actions]) => {
      const commitment = sealed[String(slot)].actionsCommitment;
      const actionsHash = actionsDigest(actions);
      return { slot, actionsHash, commitment, matches: actionsHash === commitment };
    })
  };
  matchStream.push(close);
  const stateHash = stateDigest(match.state);
  const settle = {
    stream: "match",
    kind: "settle",
    at: settleAt,
    seedDrop: spec.seedDrop,
    stateHash,
    dropRoot: tree.root,
    leaves
  };
  matchStream.push(settle);
  const root = {
    stream: "economy",
    kind: "merkle-root",
    at: settleAt,
    root: tree.root,
    leaves: leaves.length,
    totalCents: leaves.reduce((sum, leaf) => sum + leaf.amountCents, 0)
  };
  economyStream.push(root);
  let claimAt = settleAt + 1;
  for (const amount of amounts) {
    const { proof, root: proofRoot } = proofFor(leaves, amount.wallet);
    const verified = proofRoot === tree.root;
    const claim = {
      stream: "match",
      kind: "claim",
      at: claimAt,
      slot: amount.slot,
      wallet: amount.wallet,
      amountCents: amount.amountCents,
      root: tree.root,
      proof,
      verified
    };
    matchStream.push(claim);
    const ledger = {
      stream: "economy",
      kind: "claim",
      at: claimAt,
      slot: amount.slot,
      wallet: amount.wallet,
      amountCents: amount.amountCents,
      root: tree.root,
      verified
    };
    economyStream.push(ledger);
    claimAt += 0.25;
  }
  const log = {
    version: LOG_VERSION,
    roomId: spec.roomId,
    frameSeconds: dt,
    frames: frames2,
    streams: { match: matchStream, economy: economyStream },
    sealed
  };
  const truth = {
    roomId: spec.roomId,
    seedMatch: spec.seedMatch,
    seedDrop: spec.seedDrop,
    matchSeed: config.seed,
    commitMatch,
    commitDrop,
    impostorIds: match.state.actors.filter((actor) => actor.role === "impostor").map((actor) => actor.id),
    roster: genesis.roster,
    stateHash,
    dropRoot: tree.root,
    drops,
    amounts,
    backfilledSlots: spec.supplied.map((supplied, slot) => supplied ? -1 : slot).filter((slot) => slot >= 0),
    roomCostCents: leaves.reduce((sum, leaf) => sum + leaf.amountCents, 0),
    passesInCents: SLOT_COUNT * PASS_PRICE_CENTS
  };
  return { log, truth };
}
function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}
`, "utf8");
}
function specFor(roomId, options = {}) {
  return {
    roomId,
    seedMatch: secretFor(roomId, "match"),
    seedDrop: secretFor(roomId, "drop"),
    supplied: Array.from({ length: SLOT_COUNT }, () => true),
    frames: 180 * 60,
    roundSeconds: 180,
    tier: "standard",
    playerRole: "crew",
    botCount: 6,
    playerName: "Slot0",
    friendId: "0",
    sponsor: "0x5pons0r0000000000000000000000000000000000",
    supplyCents: 1e7,
    ...options
  };
}

// experiments/room-log/src/build.ts
var outDir = process.argv[2] ?? "experiments/room-log/logs";
var frames = Number(process.env.FRAMES ?? 180 * 60);
if (DROP_BPS_TOTAL !== 1e4) throw new Error(`drop table bps sum to ${DROP_BPS_TOTAL}, expected 10000`);
if (DROP_EV_CENTS !== 90) throw new Error(`drop table EV is ${DROP_EV_CENTS} cents, expected 90`);
var roomA = buildRoomLog(specFor("ROOM-A", { frames, seedMatch: secretFor("ROOM-A", "match"), seedDrop: secretFor("ROOM-A", "drop") }));
var roomB = buildRoomLog(specFor("ROOM-B", {
  frames,
  seedMatch: secretFor("ROOM-A", "match"),
  // same role layer as ROOM-A
  seedDrop: secretFor("ROOM-A", "drop"),
  // same drip layer as ROOM-A
  supplied: [true, true, true, true, false, true, true]
}));
writeJson(`${outDir}/room-a.log.json`, roomA.log);
writeJson(`${outDir}/room-a.truth.json`, roomA.truth);
writeJson(`${outDir}/room-b.log.json`, roomB.log);
writeJson(`${outDir}/room-b.truth.json`, roomB.truth);
var line = (room2, label) => [
  `${label}  ${room2.log.roomId}  frames=${room2.log.frames}  slots=${SLOT_COUNT}`,
  `    seedMatch commitment = ${room2.truth.commitMatch}`,
  `    seedDrop  commitment = ${room2.truth.commitDrop}`,
  `    impostor ids (steward's truth, sealed until close) = ${room2.truth.impostorIds.join(", ")}`,
  `    drops (drawn at join, hidden until settle) = ${room2.truth.drops.map((drop) => `${drop.slot}:${drop.drip}/${drop.rfCents}c`).join(" ")}`,
  `    room cost = ${room2.truth.roomCostCents} cents | passes in = ${room2.truth.passesInCents} cents | pool delta = ${room2.truth.passesInCents - room2.truth.roomCostCents} cents`,
  `    final state hash = ${room2.truth.stateHash}`,
  `    entitlement root = ${room2.truth.dropRoot}`,
  `    backfilled seats  = ${room2.truth.backfilledSlots.length === 0 ? "none" : room2.truth.backfilledSlots.join(", ")}`
].join("\n");
console.log("ROOM LOGS WRITTEN");
console.log(line(roomA, "room-a"));
console.log(line(roomB, "room-b"));
console.log(`outDir = ${outDir}`);
