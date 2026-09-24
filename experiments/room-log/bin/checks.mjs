// experiments/room-log/src/checks.ts
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
function verifyProof(leaf, proof, root) {
  let hash2 = leafHash(leaf);
  for (const step of proof) hash2 = step.side === "left" ? nodeHash(step.hash, hash2) : nodeHash(hash2, step.hash);
  return hash2 === root;
}
var MATCH_ONLY_KINDS = /* @__PURE__ */ new Set(["genesis", "join", "run-sealed", "close", "settle"]);
var ECONOMY_ONLY_KINDS = /* @__PURE__ */ new Set(["deposit", "pass-purchase", "cache-draw", "merkle-root"]);
var MATCH_KINDS = /* @__PURE__ */ new Set([...MATCH_ONLY_KINDS, "claim"]);
var ECONOMY_KINDS = /* @__PURE__ */ new Set([...ECONOMY_ONLY_KINDS, "claim"]);
function eventsOfKind(events, kind) {
  return events.filter((event) => event.kind === kind);
}
function genesisOf(log) {
  const found = eventsOfKind(log.streams.match, "genesis")[0];
  if (!found) throw new Error("log has no genesis event");
  return found;
}
function logProblems(log) {
  const problems = [];
  if (log.version !== LOG_VERSION) problems.push(`version ${log.version} != ${LOG_VERSION}`);
  if (!(log.frameSeconds > 0)) problems.push("frameSeconds missing");
  if (!(log.frames > 0)) problems.push("frames missing");
  for (const event of log.streams.match) {
    if (!MATCH_KINDS.has(event.kind)) problems.push(`match stream carries a non-match event: ${event.kind}`);
    if (ECONOMY_ONLY_KINDS.has(event.kind)) problems.push(`match stream carries a payout-only event: ${event.kind}`);
  }
  for (const event of log.streams.economy) {
    if (!ECONOMY_KINDS.has(event.kind)) problems.push(`economy stream carries a non-economy event: ${event.kind}`);
    if (MATCH_ONLY_KINDS.has(event.kind)) problems.push(`economy stream carries a gameplay-only event: ${event.kind}`);
  }
  const genesis = eventsOfKind(log.streams.match, "genesis")[0];
  if (!genesis) {
    problems.push("no genesis event");
    return problems;
  }
  if (genesis.slotCount !== SLOT_COUNT) problems.push(`slotCount ${genesis.slotCount} != ${SLOT_COUNT}`);
  if (!genesis.commitMatch || !genesis.commitDrop) problems.push("genesis is missing a commitment");
  if (genesis.roster.length !== SLOT_COUNT) problems.push(`roster has ${genesis.roster.length} entries, expected ${SLOT_COUNT}`);
  if (genesis.frames !== log.frames || genesis.frameSeconds !== log.frameSeconds) problems.push("genesis frames/frameSeconds disagree with the log");
  const joins = eventsOfKind(log.streams.match, "join");
  if (joins.length !== SLOT_COUNT) problems.push(`${joins.length} join events, expected ${SLOT_COUNT}`);
  const slots = new Set(joins.map((join) => join.slot));
  if (slots.size !== joins.length) problems.push("two joins claim the same slot");
  const wallets = new Set(joins.map((join) => join.wallet));
  if (wallets.size !== joins.length) problems.push("two joins claim the same wallet");
  for (const join of joins) {
    if (join.supplied && !join.actionsCommitment) problems.push(`slot ${join.slot} is supplied but sealed nothing`);
    if (!join.supplied && join.actionsCommitment) problems.push(`slot ${join.slot} is a no-show but sealed something`);
    if (join.supplied && join.frames !== genesis.frames) problems.push(`slot ${join.slot} sealed ${join.frames} frames, expected ${genesis.frames}`);
  }
  const sealedSlots = Object.keys(log.sealed);
  const supplied = joins.filter((join) => join.supplied);
  if (sealedSlots.length !== supplied.length) problems.push(`${sealedSlots.length} sealed streams for ${supplied.length} supplied slots`);
  for (const join of supplied) {
    const sealed = log.sealed[String(join.slot)];
    if (!sealed) {
      problems.push(`no sealed stream for supplied slot ${join.slot}`);
      continue;
    }
    if (sealed.actionsCommitment !== join.actionsCommitment) problems.push(`sealed stream ${join.slot} does not match the join commitment`);
    if (sealed.actions && actionsDigest(sealed.actions) !== sealed.actionsCommitment) problems.push(`revealed stream ${join.slot} does not match its commitment`);
  }
  const closes = eventsOfKind(log.streams.match, "close");
  if (closes.length !== 1) problems.push(`${closes.length} close events, expected 1`);
  else if (commitMatchSeed(closes[0].revealSeedMatch) !== genesis.commitMatch) problems.push("close reveal does not open the genesis match commitment");
  const settles = eventsOfKind(log.streams.match, "settle");
  if (settles.length !== 1) problems.push(`${settles.length} settle events, expected 1`);
  else {
    const settle = settles[0];
    if (commitDropSeed(settle.seedDrop) !== genesis.commitDrop) problems.push("settle reveal does not open the genesis drop commitment");
    if (settle.leaves.length !== SLOT_COUNT) problems.push(`settle covers ${settle.leaves.length} leaves, expected ${SLOT_COUNT}`);
    if (buildTree(settle.leaves).root !== settle.dropRoot) problems.push("published dropRoot is not the tree over the published leaves");
  }
  const draws = eventsOfKind(log.streams.economy, "cache-draw");
  const seen = /* @__PURE__ */ new Set();
  for (const draw of draws) {
    const key = `${draw.slot}:${draw.passIndex}`;
    if (seen.has(key)) problems.push(`cache draw reused (slot ${draw.slot}, passIndex ${draw.passIndex})`);
    seen.add(key);
    const join = joins.find((entry) => entry.slot === draw.slot);
    if (!join) problems.push(`cache draw for slot ${draw.slot} has no join`);
    else if (join.wallet !== draw.wallet) problems.push(`cache draw for slot ${draw.slot} names a different wallet`);
    if (draw.hiddenUntil !== "settle") problems.push(`cache draw ${key} is not marked hidden until settle`);
  }
  for (const join of joins) {
    const own = draws.filter((draw) => draw.slot === join.slot);
    if (own.length === 0) problems.push(`joined slot ${join.slot} holds no cache`);
  }
  const roots = eventsOfKind(log.streams.economy, "merkle-root");
  if (roots.length !== 1) problems.push(`${roots.length} merkle-root events, expected 1`);
  else if (settles.length === 1 && roots[0].root !== settles[0].dropRoot) problems.push("economy root and settle root disagree");
  if (settles.length === 1) {
    for (const join of joins) {
      const owed = draws.filter((draw) => draw.slot === join.slot).reduce((sum, draw) => sum + draw.rfCents, 0);
      const leaf = settles[0].leaves.find((entry) => entry.wallet === join.wallet);
      if (!leaf) problems.push(`settle has no leaf for slot ${join.slot}`);
      else if (leaf.amountCents !== owed) problems.push(`settle leaf for slot ${join.slot} is ${leaf.amountCents}c, the drawn caches add to ${owed}c`);
    }
  }
  if (settles.length === 1) {
    for (const claim of eventsOfKind(log.streams.economy, "claim")) {
      const leaf = settles[0].leaves.find((entry) => entry.wallet === claim.wallet);
      if (!leaf) {
        problems.push(`claim from ${claim.wallet} has no entitlement`);
        continue;
      }
      if (claim.amountCents !== leaf.amountCents) problems.push(`claim for ${claim.wallet} asks ${claim.amountCents}, owed ${leaf.amountCents}`);
      if (claim.root !== settles[0].dropRoot) problems.push(`claim for ${claim.wallet} targets a different root`);
    }
    for (const claim of eventsOfKind(log.streams.match, "claim")) {
      if (!verifyProof({ wallet: claim.wallet, amountCents: claim.amountCents }, claim.proof, claim.root)) {
        problems.push(`claim proof for ${claim.wallet} does not verify against its root`);
      }
    }
  }
  return problems;
}
function publishedView(log) {
  const genesis = eventsOfKind(log.streams.match, "genesis")[0] ?? null;
  const settle = eventsOfKind(log.streams.match, "settle")[0] ?? null;
  return {
    roomId: log.roomId,
    frameSeconds: log.frameSeconds,
    frames: log.frames,
    genesis,
    joins: eventsOfKind(log.streams.match, "join").map((join) => ({ ...join, actions: "[sealed]" })),
    sealedCommitments: Object.values(log.sealed).map((sealed) => ({ slot: sealed.slot, actionsCommitment: sealed.actionsCommitment })),
    close: "[sealed until close \u2014 seedMatch and the action streams live here]",
    settle,
    economy: log.streams.economy
  };
}

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
var ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

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
    const record2 = promptRecord;
    if (!record2) return;
    switch (record2.action) {
      case "task": {
        const station = stationById(record2.targetId);
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
        if (!record2.targetId) return;
        startMeeting(state.playerId, record2.targetId);
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
        const console2 = consoleById(record2.targetId);
        if (!console2 || state.sabotage !== console2.sabotage) return;
        clearSabotage(console2, playerActor());
        refreshPrompt();
        return;
      }
      case "trigger": {
        const console2 = consoleById(record2.targetId);
        if (!console2) return;
        triggerSabotage(console2.sabotage, playerActor());
        refreshPrompt();
        return;
      }
    }
  }
  function finishTask(stationId, success, roll3) {
    const attempt = state.activeTask;
    void roll3;
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
    lines: value.meeting.lines.map((line) => [line.id, line.actorId, line.text, line.at]),
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

// experiments/room-log/src/rebuild.ts
var IDLE = { up: false, down: false, left: false, right: false, destination: null };
function replayLog(log, order = "forward") {
  const problems = logProblems(log);
  const genesis = genesisOf(log);
  const joins = [...eventsOfKind(log.streams.match, "join")].sort((a, b) => a.slot - b.slot);
  const supplied = joins.filter((join) => join.supplied);
  const settles = eventsOfKind(log.streams.match, "settle");
  const settle = settles[0] ?? null;
  const closes = eventsOfKind(log.streams.match, "close");
  const draws = eventsOfKind(log.streams.economy, "cache-draw");
  const slotOrder = order === "forward" ? joins.map((join) => join.slot) : joins.map((join) => join.slot).reverse();
  const checkDrips = () => {
    const drops = [];
    const leaves = [];
    for (const slot of slotOrder) {
      const join = joins.find((entry) => entry.slot === slot);
      if (!join || !settle) continue;
      const own = draws.filter((draw) => draw.slot === slot).sort((a, b) => a.passIndex - b.passIndex);
      let owed = 0;
      for (const draw of own) {
        const entry = roll(settle.seedDrop, draw.slot, draw.passIndex);
        owed += entry.rfCents;
        drops.push({
          slot: draw.slot,
          passIndex: draw.passIndex,
          recomputed: entry.id,
          published: draw.drip,
          recomputedCents: entry.rfCents,
          publishedCents: draw.rfCents,
          agrees: entry.id === draw.drip && entry.rfCents === draw.rfCents
        });
      }
      leaves.push({ wallet: join.wallet, amountCents: owed });
    }
    return { drops, leaves, root: leaves.length > 0 ? buildTree(leaves).root : null };
  };
  const checkCommitments = () => {
    let checked = 0;
    let ok = true;
    for (const slot of slotOrder) {
      const join = joins.find((entry) => entry.slot === slot);
      if (!join || !join.supplied) continue;
      const sealed = log.sealed[String(slot)];
      if (!sealed || !sealed.actions) {
        ok = false;
        problems.push(`slot ${slot}: sealed stream missing`);
        continue;
      }
      checked++;
      if (actionsDigest(sealed.actions) !== join.actionsCommitment) {
        ok = false;
        problems.push(`slot ${slot}: revealed run does not match its join commitment`);
      }
    }
    let closeOk = true;
    if (closes.length === 1 && closes[0].revealSeedMatch) {
      closeOk = commitMatchSeed(closes[0].revealSeedMatch) === genesis.commitMatch;
      if (!closeOk) problems.push("close reveal does not open the genesis match commitment");
    } else {
      closeOk = false;
      problems.push("no close reveal to check");
    }
    return { checked, ok: ok && closeOk };
  };
  const rebuildMatch = () => {
    if (closes.length !== 1) return null;
    const config = {
      seed: hashSeed(closes[0].revealSeedMatch),
      tier: genesis.tier,
      playerRole: genesis.playerRole,
      botCount: genesis.botCount,
      playerName: genesis.playerName,
      friendId: genesis.friendId
    };
    const match = createMatch(config);
    match.advance();
    const actorIdBySlot = new Map(joins.map((join) => [join.slot, join.actorId]));
    if (order === "reverse") {
      const preloaded = slotOrder.map((slot) => ({ actorId: actorIdBySlot.get(slot) ?? "", actions: log.sealed[String(slot)]?.actions ?? null })).filter((entry) => entry.actions !== null);
      for (let frame = 0; frame < log.frames; frame++) {
        const frameMap = {};
        for (const entry of preloaded) frameMap[entry.actorId] = entry.actions[frame];
        if (Object.keys(frameMap).length > 0) match.update(log.frameSeconds, IDLE, frameMap);
        else match.update(log.frameSeconds, IDLE);
      }
    } else {
      for (let frame = 0; frame < log.frames; frame++) {
        const frameMap = {};
        for (const slot of slotOrder) {
          const actorId = actorIdBySlot.get(slot) ?? "";
          const actions = log.sealed[String(slot)]?.actions;
          if (actions) frameMap[actorId] = actions[frame];
        }
        if (Object.keys(frameMap).length > 0) match.update(log.frameSeconds, IDLE, frameMap);
        else match.update(log.frameSeconds, IDLE);
      }
    }
    return {
      stateHash: stateDigest(match.state),
      phase: match.state.phase,
      time: match.state.time,
      actors: match.state.actors.map((actor) => ({
        id: actor.id,
        role: actor.role,
        alive: actor.alive,
        tasksDone: actor.tasksDone,
        x: actor.pos.x,
        y: actor.pos.y
      }))
    };
  };
  const checkClaims = (leaves, root) => {
    let verified = 0;
    for (const claim of eventsOfKind(log.streams.match, "claim")) {
      const leaf = leaves.find((entry) => entry.wallet === claim.wallet);
      if (leaf && root && verifyProof(leaf, claim.proof, root)) verified++;
      else problems.push(`claim for ${claim.wallet} does not verify`);
    }
    for (const claim of eventsOfKind(log.streams.economy, "claim")) {
      const leaf = leaves.find((entry) => entry.wallet === claim.wallet);
      if (!leaf || !root) {
        problems.push(`ledger claim for ${claim.wallet} has no leaf`);
        continue;
      }
      const proof = proofFor(leaves, claim.wallet);
      if (!verifyProof(leaf, proof.proof, root)) problems.push(`ledger claim for ${claim.wallet} does not verify`);
    }
    return verified;
  };
  let drip;
  let commitments;
  let rebuilt;
  let claimsVerified;
  if (order === "forward") {
    drip = checkDrips();
    commitments = checkCommitments();
    rebuilt = rebuildMatch();
    claimsVerified = checkClaims(drip.leaves, drip.root);
  } else {
    commitments = checkCommitments();
    rebuilt = rebuildMatch();
    drip = checkDrips();
    claimsVerified = checkClaims(drip.leaves, drip.root);
  }
  if (settle && drip.root !== settle.dropRoot) problems.push("recomputed entitlement root differs from the published root");
  if (rebuilt && settle && rebuilt.stateHash !== settle.stateHash) {
    problems.push("replayed state hash differs from the published state hash");
  }
  return {
    replayOrder: order,
    roomId: genesis.roomId,
    problems,
    frames: log.frames,
    commitmentsChecked: commitments.checked,
    commitmentsOk: commitments.ok,
    closeRevealOk: commitments.ok,
    stateHash: rebuilt ? rebuilt.stateHash : null,
    publishedStateHash: settle ? settle.stateHash : "",
    stateHashAgrees: Boolean(rebuilt && settle && rebuilt.stateHash === settle.stateHash),
    finalPhase: rebuilt ? rebuilt.phase : null,
    simTime: rebuilt ? rebuilt.time : null,
    drops: drip.drops,
    root: drip.root,
    publishedRoot: settle ? settle.dropRoot : null,
    rootAgrees: Boolean(settle && drip.root === settle.dropRoot),
    claimsVerified,
    claimsExpected: eventsOfKind(log.streams.match, "claim").length,
    backfilledSlots: supplied.length === joins.length ? [] : joins.filter((join) => !join.supplied).map((join) => join.slot),
    actors: rebuilt ? rebuilt.actors : []
  };
}

// experiments/room-log/src/room.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
var STEWARD_SECRET = "ip-room-spike/v1/steward";
function secretFor(roomId, purpose, steward = STEWARD_SECRET) {
  return sha256hex(`${steward}|${roomId}|${purpose}`);
}
var IDLE2 = { up: false, down: false, left: false, right: false, destination: null };
function generateActions(tag, slot, frames) {
  const rng = createRng(hashSeed(`${tag}:actions:${slot}`));
  const actions = [];
  let direction = null;
  let remaining = 0;
  for (let frame = 0; frame < frames; frame++) {
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
  const frames = spec.frames;
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
    if (spec.supplied[slot]) actionsBySlot.set(slot, generateActions(spec.roomId, slot, frames));
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
  const playTo = playFrom + frames * dt;
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
    frames,
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
      frames: supplied ? frames : 0,
      actionsCommitment: commitment
    };
    matchStream.push(join);
    if (actions && commitment) {
      const runSealed = { stream: "match", kind: "run-sealed", at: joinAt(slot), slot, frames, actionsCommitment: commitment };
      matchStream.push(runSealed);
      sealed[String(slot)] = { slot, frames, actionsCommitment: commitment, actions, revealedAt: settleAt };
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
  for (let frame = 0; frame < frames; frame++) {
    const frameMap = {};
    for (const [slot, actions] of actionsBySlot) frameMap[actorIdBySlot.get(slot) ?? actorIdForSlot(slot)] = actions[frame];
    if (Object.keys(frameMap).length > 0) match.update(dt, IDLE2, frameMap);
    else match.update(dt, IDLE2);
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
    frames,
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

// experiments/room-log/src/separation.ts
function fingerprint(roster) {
  return roster.map((entry) => `${entry.actorId}:${entry.name}:${entry.color}`).join("|");
}
function fingerprintForSeed(seed) {
  const roster = createRoster({ seed, botCount: 6, playerName: "Slot0", playerColor: playerColorFor(seed) });
  return roster.map((entry) => `${entry.id}:${entry.name}:${entry.color}`).join("|");
}
function impostorSetForSeed(seed) {
  const rng = createRng(hashSeed(`${seed}:roles`));
  const ids = ["bot-0", "bot-1", "bot-2", "bot-3", "bot-4", "bot-5"];
  for (let index = ids.length - 1; index > 0; index--) {
    const swap = rng.int(index + 1);
    const held = ids[index];
    ids[index] = ids[swap];
    ids[swap] = held;
  }
  return ids.slice(0, 2).sort();
}
function truthRoles(seed, playerName, friendId) {
  const match = createMatch({ seed, tier: "standard", playerRole: "crew", botCount: 6, playerName, friendId });
  return match.state.actors.filter((actor) => actor.role === "impostor").map((actor) => actor.id).sort();
}
function runSeparation(roomA, frames, sweep) {
  const lines = [];
  const detail = {};
  const truth = roomA.truth;
  const log = roomA.log;
  const target = fingerprint(truth.roster);
  const trueSet = [...truth.impostorIds].sort().join(",");
  const M1 = sha256hex("sep-fixture-match-1");
  const M2 = sha256hex("sep-fixture-match-2");
  const D1 = sha256hex("sep-fixture-drop-1");
  const D2 = sha256hex("sep-fixture-drop-2");
  const fixture = (roomId, seedMatch, seedDrop) => buildRoomLog(specFor(roomId, { frames, seedMatch, seedDrop }));
  let sepA = fixture("SEP-1", M1, D1);
  let sepB = fixture("SEP-2", M2, D1);
  let sepC = fixture("SEP-3", M1, D2);
  const dropLine = (room2) => room2.truth.drops.map((drop) => `${drop.slot}:${drop.drip}/${drop.rfCents}`).join(" ");
  for (let attempt = 2; attempt <= 32 && fingerprint(sepB.truth.roster) === fingerprint(sepA.truth.roster); attempt++) {
    sepB = fixture("SEP-2", sha256hex(`sep-fixture-match-2#${attempt}`), D1);
  }
  for (let attempt = 2; attempt <= 32 && dropLine(sepC) === dropLine(sepA); attempt++) {
    sepC = fixture("SEP-3", M1, sha256hex(`sep-fixture-drop-2#${attempt}`));
  }
  const sameDropSame = dropLine(sepA) === dropLine(sepB);
  const rolesDiffer = sepA.truth.impostorIds.slice().sort().join(",") !== sepB.truth.impostorIds.slice().sort().join(",");
  const sameMatchSame = sepA.truth.impostorIds.slice().sort().join(",") === sepC.truth.impostorIds.slice().sort().join(",");
  const dropDiffers = dropLine(sepA) !== dropLine(sepC);
  const rosterSameAcrossM = fingerprint(sepA.truth.roster) === fingerprint(sepC.truth.roster);
  lines.push("1. INDEPENDENCE (crossed fixture rooms, same code path as ROOM-A)");
  lines.push(`   same seedDrop, different seedMatch : drip layer identical = ${sameDropSame ? "YES" : "NO"} | roles differ = ${rolesDiffer ? "YES" : "NO"}`);
  lines.push(`     drips  = ${dropLine(sepA)}`);
  lines.push(`     roles  = [${sepA.truth.impostorIds.join(", ")}] vs [${sepB.truth.impostorIds.join(", ")}]`);
  lines.push(`   same seedMatch, different seedDrop : roles identical = ${sameMatchSame ? "YES" : "NO"} | roster identical = ${rosterSameAcrossM ? "YES" : "NO"} | drips differ = ${dropDiffers ? "YES" : "NO"}`);
  lines.push(`     drips  = ${dropLine(sepA)}`);
  lines.push(`     drips  = ${dropLine(sepC)}`);
  Object.assign(detail, { fixtureDripsA: dropLine(sepA), fixtureDripsB: dropLine(sepB), fixtureDripsC: dropLine(sepC), fixtureRolesA: sepA.truth.impostorIds, fixtureRolesB: sepB.truth.impostorIds, fixtureRolesC: sepC.truth.impostorIds });
  const independenceOk = sameDropSame && rolesDiffer && sameMatchSame && dropDiffers;
  const view = publishedView(log);
  const viewText = JSON.stringify(view);
  const viewHasSeedMatch = viewText.includes(truth.seedMatch);
  const viewHasSeedDrop = viewText.includes(truth.seedDrop);
  const viewHasActions = JSON.stringify(view).includes("actions") && Array.isArray(view.joins) && view.joins.some((join) => Array.isArray(join.actions));
  const viewDraws = Array.isArray(view.economy) ? view.economy.filter((event) => event.kind === "cache-draw") : [];
  lines.push("\n2. THE PUBLISHED VIEW (everything a reader has after settlement, before close)");
  lines.push(`   cache draws with outcomes and amounts : ${viewDraws.length} (${viewDraws.map((draw) => `s${draw.slot}:${draw.drip}/${draw.rfCents}c`).join(" ")})`);
  lines.push(`   contains the seedDrop preimage         : ${viewHasSeedDrop ? "YES (revealed with the settlement)" : "NO"}`);
  lines.push(`   contains seedMatch                     : ${viewHasSeedMatch ? "YES (LEAK)" : "NO \u2014 still sealed"}`);
  lines.push(`   contains any revealed action stream    : ${viewHasActions ? "YES (LEAK)" : "NO \u2014 sealed to a hash"}`);
  const strings = [];
  const push = (value) => {
    if (typeof value === "string" && value.length > 0) strings.push(value);
  };
  push(view.roomId);
  push(view.genesis?.commitMatch);
  push(view.genesis?.commitDrop);
  push(view.genesis?.sponsor);
  push(view.genesis?.playerName);
  push(view.genesis?.friendId);
  push(view.settle?.seedDrop);
  push(view.settle?.stateHash);
  push(view.settle?.dropRoot);
  for (const join of view.joins ?? []) {
    push(join.wallet);
    push(join.actionsCommitment);
  }
  for (const event of view.economy ?? []) {
    push(event.root);
    push(event.drip);
    push(event.label);
    push(event.wallet);
    push(String(event.rfCents));
    push(String(event.amountCents));
  }
  push(view.frames === void 0 ? "" : String(view.frames));
  const candidates = /* @__PURE__ */ new Map();
  const add = (label, seed) => {
    if (!candidates.has(label)) candidates.set(label, seed);
  };
  for (const text of strings) {
    add(`hashSeed(${text})`, hashSeed(text));
    add(`hashSeed(${text}:roles)`, hashSeed(`${text}:roles`));
    add(`hashSeed(commit|${text})`, hashSeed(`ip-room/v1/commit/match|${text}`));
  }
  const head = strings.slice(0, 12);
  for (let i = 0; i < head.length; i++) {
    for (let j = 0; j < head.length; j++) if (i !== j) add(`hashSeed(${head[i]}+${head[j]})`, hashSeed(head[i] + head[j]));
  }
  let attemptAFingerprint = 0;
  let attemptALeak = 0;
  const attemptAHits = [];
  for (const [label, seed] of candidates) {
    const fingerprintHit = fingerprintForSeed(seed) === target;
    const roleHit = impostorSetForSeed(seed).join(",") === trueSet;
    if (fingerprintHit) attemptAFingerprint++;
    if (fingerprintHit && roleHit) {
      attemptALeak++;
      if (attemptAHits.length < 5) attemptAHits.push(label);
    }
  }
  lines.push("\n3. THE ATTEMPT");
  lines.push(`   A. candidates built from published fields (real engine, ${candidates.size} candidates):`);
  lines.push(`      reproduce the room's lobby fingerprint : ${attemptAFingerprint}`);
  lines.push(`      reproduce fingerprint AND impostor ids : ${attemptALeak}${attemptAHits.length ? ` (${attemptAHits.join(", ")})` : ""}`);
  let codes = 0;
  let classHits = 0;
  let fingerprintHits = 0;
  let leakHits = 0;
  const leakCodes = [];
  const startedAt = Date.now();
  if (sweep) {
    const alphabet = ROOM_CODE_ALPHABET;
    for (const a of alphabet) for (const b of alphabet) for (const c of alphabet) for (const d of alphabet) {
      const code = `${a}${b}${c}${d}`;
      const seed = hashSeed(code);
      codes++;
      const roleHit = impostorSetForSeed(seed).join(",") === trueSet;
      if (roleHit) classHits++;
      if (fingerprintForSeed(seed) === target) {
        fingerprintHits++;
        if (roleHit) {
          leakHits++;
          if (leakCodes.length < 5) leakCodes.push(code);
        }
      }
    }
  }
  const sweepMs = Date.now() - startedAt;
  lines.push(`   B. exhaustive sweep of the game's own 4-character room-code space (${alphabetSize()}^4 = ${alphabetSize() ** 4} codes, ${sweep ? `${codes} swept in ${sweepMs} ms` : "SKIPPED"}):`);
  lines.push(`      codes whose impostor set equals the room's : ${classHits}  (the class is 1-in-15 \u2014 matching it identifies nothing)`);
  lines.push(`      codes whose lobby fingerprint matches      : ${fingerprintHits}`);
  lines.push(`      codes matching fingerprint AND roles      : ${leakHits}${leakCodes.length ? ` (${leakCodes.join(", ")})` : ""}`);
  lines.push(`      the room's own seed hashSeed(seedMatch) is in this space : NO (seedMatch is a ${truth.seedMatch.length}-char secret, not a 4-char code)`);
  const controlSeed = hashSeed(truth.seedMatch);
  const controlFingerprint = fingerprintForSeed(controlSeed) === target;
  const controlRoles = truthRoles(controlSeed, truth.roster[0].name, roomA.log.streams.match.length ? "0" : "0").join(",") === trueSet;
  const mirroredRolesAgree = impostorSetForSeed(controlSeed).join(",") === trueSet;
  const engineAgrees = truthRoles(controlSeed, "Slot0", "0").join(",") === impostorSetForSeed(controlSeed).join(",");
  lines.push("\n4. THE CONTROL (the same derivation, given the seedMatch that close reveals)");
  lines.push(`   lobby fingerprint reproduced exactly        : ${controlFingerprint ? "YES" : "NO"}`);
  lines.push(`   impostor ids reproduced exactly             : ${controlRoles && mirroredRolesAgree ? "YES" : "NO"}  [${truthRoles(controlSeed, "Slot0", "0").join(", ")}]`);
  lines.push(`   mirrored role draw agrees with the engine   : ${engineAgrees ? "YES" : "NO"}`);
  const pass = independenceOk && !viewHasSeedMatch && !viewHasActions && attemptALeak === 0 && leakHits === 0 && controlFingerprint && controlRoles && mirroredRolesAgree && engineAgrees;
  lines.push(`
SEED SEPARATION RESULT: ${pass ? "PASS \u2014 the published drip layer does not determine the impostor ids" : "FAIL"}`);
  Object.assign(detail, {
    publishedViewHasSeedMatch: viewHasSeedMatch,
    attemptACandidates: candidates.size,
    attemptAFingerprintHits: attemptAFingerprint,
    attemptALeakHits: attemptALeak,
    sweepCodes: codes,
    sweepMs,
    classHits,
    fingerprintHits,
    leakHits,
    leakCodes,
    controlFingerprint,
    controlRoles,
    mirroredRolesAgree,
    engineAgrees
  });
  return { pass, lines, detail };
}
function alphabetSize() {
  return ROOM_CODE_ALPHABET.length;
}

// experiments/room-log/src/tampers.ts
function clone(log) {
  return JSON.parse(JSON.stringify(log));
}
function flipLowestBit(input) {
  if (input.up) return { ...input, up: false };
  if (input.down) return { ...input, down: false };
  if (input.left) return { ...input, left: false };
  if (input.right) return { ...input, right: false };
  return input;
}
function runTampers(roomA) {
  const results2 = [];
  const published = roomA.log;
  const settle = eventsOfKind(published.streams.match, "settle")[0];
  const publishedHash = settle.stateHash;
  {
    const tampered = clone(published);
    const slot = 2;
    const sealed = tampered.sealed[String(slot)];
    const actions = sealed.actions;
    const codeOf = (input) => (input.up ? 1 : 0) | (input.down ? 2 : 0) | (input.left ? 4 : 0) | (input.right ? 8 : 0);
    const starts = [];
    for (let frame = 1; frame < actions.length; frame++) {
      if (codeOf(actions[frame]) !== 0 && codeOf(actions[frame]) !== codeOf(actions[frame - 1])) starts.push(frame);
    }
    const candidates = starts.slice(-24).reverse();
    const induced = [];
    let used = -1;
    for (const frame of candidates) {
      const pristine = actions[frame];
      actions[frame] = flipLowestBit(pristine);
      const replayed = replayLog(tampered, "forward");
      const diverged = replayed.stateHash !== publishedHash;
      if (diverged) {
        used = frame;
        const flipped = actions[frame];
        induced.push(`one byte of slot ${slot}: frame ${frame} of ${actions.length} 0x0${codeOf(pristine)} -> 0x0${codeOf(flipped)} (the last leg of the run is cut short)`);
        induced.push(`commitment: ${replayed.problems.find((problem) => /commitment/.test(problem)) ?? "NOT REPORTED"}`);
        induced.push(`state:      published state hash = ${publishedHash}`);
        induced.push(`            replayed  state hash = ${replayed.stateHash}`);
        induced.push(`            verifier rejects the replayed hash: ${!replayed.stateHashAgrees}`);
        break;
      }
      actions[frame] = pristine;
    }
    const pass = used >= 0;
    if (used < 0) induced.push(`NO DIVERGENCE FOUND across ${candidates.length} candidate frames \u2014 the state hash did not move`);
    else induced.push(`frames tried = ${candidates.indexOf(used) + 1} of ${candidates.length}`);
    results2.push({
      id: "T1",
      name: "flip one input byte \u2192 state hash mismatch",
      required: "state hash mismatch",
      induced,
      pass
    });
  }
  {
    const tampered = clone(published);
    const draw = eventsOfKind(tampered.streams.economy, "cache-draw").find((entry) => entry.slot === 3 && entry.passIndex === 0);
    const replacement = DROP_TABLE.find((entry) => entry.id === "genesis-artifact");
    draw.drip = replacement.id;
    draw.label = replacement.label;
    draw.rfCents = replacement.rfCents;
    const problems = logProblems(tampered);
    const joins = eventsOfKind(tampered.streams.match, "join");
    const draws = eventsOfKind(tampered.streams.economy, "cache-draw");
    const recomputedLeaves = joins.map((join) => ({
      wallet: join.wallet,
      amountCents: draws.filter((entry) => entry.slot === join.slot).reduce((sum, entry) => sum + entry.rfCents, 0)
    }));
    const tamperedRoot = buildTree(recomputedLeaves).root;
    const replayed = replayLog(tampered, "forward");
    const trueRoll = roll(settle.seedDrop, 3, 0);
    const claim = eventsOfKind(tampered.streams.match, "claim").find((entry) => entry.slot === 3);
    const claimRejected = claim ? !verifyProof({ wallet: claim.wallet, amountCents: claim.amountCents }, claim.proof, tamperedRoot) : false;
    const induced = [];
    induced.push(`draw:      slot 3 pass 0 published as "${draw.drip}" (${draw.rfCents}c); roll(seedDrop, 3, 0) says "${trueRoll.id}" (${trueRoll.rfCents}c) \u2192 verifier agrees: ${replayed.drops.find((entry) => entry.slot === 3)?.agrees}`);
    induced.push(`root:      published root = ${settle.dropRoot}`);
    induced.push(`           root over the tampered drip layer = ${tamperedRoot}`);
    induced.push(`           roots equal: ${tamperedRoot === settle.dropRoot}`);
    induced.push(`claim:     slot 3 proof against the tampered root verifies: ${!claimRejected}`);
    induced.push(`structure: ${problems.slice(0, 3).join(" | ")}`);
    const pass = tamperedRoot !== settle.dropRoot && claimRejected && problems.length > 0 && replayed.problems.length > 0;
    results2.push({ id: "T2", name: "flip one drip \u2192 merkle root mismatch", required: "root mismatch + verifier rejects the draw", induced, pass });
  }
  {
    const tampered = clone(published);
    tampered.streams.match = tampered.streams.match.filter((event) => !(event.kind === "join" && event.slot === 5));
    const problems = logProblems(tampered);
    const replayed = replayLog(tampered, "forward");
    const induced = [
      `structure: ${problems.slice(0, 4).join(" | ") || "NOTHING \u2014 the log was accepted"}`,
      `replay:    verifier accepts: ${replayed.problems.length === 0}`,
      `replay:    entitlement root over the surviving joins = ${replayed.root}`,
      `replay:    published root = ${settle.dropRoot}`
    ];
    const pass = problems.some((problem) => /join events, expected/.test(problem)) && replayed.problems.length > 0;
    results2.push({ id: "T3", name: "drop one join event \u2192 rejection", required: "log rejected (missing join)", induced, pass });
  }
  {
    const tampered = clone(published);
    const draw = eventsOfKind(tampered.streams.economy, "cache-draw").find((entry) => entry.slot === 1 && entry.passIndex === 0);
    tampered.streams.economy.push({ ...draw });
    const problems = logProblems(tampered);
    const replayed = replayLog(tampered, "forward");
    const induced = [
      `structure: ${problems.slice(0, 4).join(" | ") || "NOTHING \u2014 the log was accepted"}`,
      `replay:    verifier accepts: ${replayed.problems.length === 0}`,
      `replay:    drops checked = ${replayed.drops.length}, all agree = ${replayed.drops.every((entry) => entry.agrees)}`
    ];
    const pass = problems.some((problem) => /reused \(slot 1, passIndex 0\)/.test(problem)) && replayed.problems.length > 0;
    results2.push({ id: "T4", name: "reuse a passIndex \u2192 rejection", required: "duplicate (slot, passIndex) rejected", induced, pass });
  }
  return results2;
}

// experiments/room-log/src/checks.ts
var here = fileURLToPath(new URL(".", import.meta.url));
var logsDir = resolve(here, "..", "logs");
var outDir = resolve(here, "..", "out");
var replayBundle = resolve(here, "replay.mjs");
var results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`
[${pass ? "PASS" : "FAIL"}] ${name}`);
  console.log(detail.split("\n").map((line) => `    ${line}`).join("\n"));
}
var readLog = (name) => JSON.parse(readFileSync(resolve(logsDir, name), "utf8"));
var readTruth = (name) => JSON.parse(readFileSync(resolve(logsDir, name), "utf8"));
var roomALog = readLog("room-a.log.json");
var roomBLog = readLog("room-b.log.json");
var roomATruth = readTruth("room-a.truth.json");
{
  const pays = DROP_TABLE.filter((entry) => entry.rfCents > 0).reduce((sum, entry) => sum + entry.bps, 0);
  const pass = DROP_BPS_TOTAL === 1e4 && DROP_EV_CENTS === 90 && pays === 7900;
  record(
    "economy: cache table sums to 10000 bps with EV 0.90 RF",
    pass,
    DROP_TABLE.map((entry) => `${entry.label}: ${entry.bps}bps / ${entry.rfCents}c`).join("\n") + `
bps total = ${DROP_BPS_TOTAL} (exact 10000)
EV = ${DROP_EV_CENTS} cents = ${(DROP_EV_CENTS / 100).toFixed(2)} RF
P(pays anything) = ${pays} bps = ${(pays / 100).toFixed(0)}%`
  );
}
{
  const seedDrop = roomATruth.seedDrop;
  const tally = /* @__PURE__ */ new Map();
  const draws = 1e5;
  for (let index = 0; index < draws; index++) {
    const entry = roll(seedDrop, index % SLOT_COUNT, Math.floor(index / SLOT_COUNT));
    tally.set(entry.id, (tally.get(entry.id) ?? 0) + 1);
  }
  const lines = [];
  let pass = true;
  for (const entry of DROP_TABLE) {
    const observed = (tally.get(entry.id) ?? 0) * 1e4 / draws;
    const off = Math.abs(observed - entry.bps);
    if (off > 400) pass = false;
    lines.push(`${entry.label.padEnd(17)} expected ${String(entry.bps).padStart(4)}bps  observed ${observed.toFixed(0).padStart(4)}bps  delta ${(observed - entry.bps).toFixed(0).padStart(5)}  ${off <= 400 ? "ok" : "OUT OF TOLERANCE"}`);
  }
  lines.push(`(${draws} draws of roll(seedDrop, slot, passIndex) \u2014 tolerance \xB1400bps from sampling noise)`);
  record("economy: 100k seeded draws land on the table", pass, lines.join("\n"));
}
{
  const problems = logProblems(roomALog);
  record(
    "log room-a: two streams, seven joins, no mix-ups",
    problems.length === 0,
    problems.length === 0 ? `match events = ${roomALog.streams.match.length}, economy events = ${roomALog.streams.economy.length}, sealed streams = ${Object.keys(roomALog.sealed).length}
no problem found by the structural verifier` : problems.join("\n")
  );
}
{
  const problems = logProblems(roomBLog);
  const backfilled = roomBLog.streams.match.filter((event) => event.kind === "join" && !event.supplied).map((event) => event.slot);
  record(
    "log room-b: a no-show seat is legal and marked",
    problems.length === 0 && backfilled.join(",") === "4",
    `problems = ${problems.length === 0 ? "none" : problems.join(" | ")}
no-show seats = [${backfilled.join(", ")}] (their run is not sealed; the bot backfills)`
  );
}
{
  const forward = replayLog(roomALog, "forward");
  const pass = forward.problems.length === 0 && forward.stateHashAgrees && forward.rootAgrees && forward.commitmentsChecked === SLOT_COUNT && forward.claimsVerified === SLOT_COUNT;
  record(
    "replay room-a (forward, in-process) verifies",
    pass,
    `problems = ${forward.problems.length === 0 ? "none" : forward.problems.join(" | ")}
sealed runs checked = ${forward.commitmentsChecked}
state hash (replayed) = ${forward.stateHash}
state hash (published) = ${forward.publishedStateHash}
state hash agrees = ${forward.stateHashAgrees}
root (recomputed) = ${forward.root}
root (published) = ${forward.publishedRoot}
root agrees = ${forward.rootAgrees}
claims verified = ${forward.claimsVerified}/${forward.claimsExpected}
final phase = ${forward.finalPhase} at sim time ${forward.simTime}`
  );
}
{
  const forward = replayLog(roomALog, "forward");
  const reverse = replayLog(roomALog, "reverse");
  const canonical = (drops) => [...drops].sort((a, b) => a.slot - b.slot || a.passIndex - b.passIndex).map((drop) => `${drop.slot}:${drop.passIndex}=${drop.recomputed}/${drop.recomputedCents}`).join(" ");
  const sameDrops = canonical(forward.drops) === canonical(reverse.drops);
  const same = forward.stateHash === reverse.stateHash && sameDrops && forward.root === reverse.root;
  record(
    "replay room-a (reverse order, in-process) is order-independent",
    same && reverse.problems.length === 0,
    `forward : hash=${forward.stateHash} root=${forward.root} drops emitted s${forward.drops.map((drop) => drop.slot).join(",s")}
reverse : hash=${reverse.stateHash} root=${reverse.root} drops emitted s${reverse.drops.map((drop) => drop.slot).join(",s")}
problems = ${reverse.problems.length}
canonical drops identical = ${sameDrops} | hashes identical = ${forward.stateHash === reverse.stateHash} | roots identical = ${forward.root === reverse.root}`
  );
}
{
  const runChild = (order) => {
    const args = [replayBundle, resolve(logsDir, "room-a.log.json")];
    if (order === "reverse") args.push("--reverse");
    const child = spawnSync(process.execPath, args, { encoding: "utf8" });
    if (child.status !== 0) throw new Error(`replay ${order} exited ${child.status}: ${child.stderr || child.stdout}`);
    return JSON.parse(child.stdout);
  };
  const forward = runChild("forward");
  const reverse = runChild("reverse");
  const canonical = (drops) => [...drops].sort((a, b) => a.slot - b.slot || a.passIndex - b.passIndex).map((drop) => `s${drop.slot}p${drop.passIndex}:${drop.recomputed}/${drop.recomputedCents}c`).join(" ");
  const dropsEqual = canonical(forward.drops) === canonical(reverse.drops);
  const same = forward.stateHash === reverse.stateHash && dropsEqual && forward.root === reverse.root && forward.stateHash === roomATruth.stateHash && forward.root === roomATruth.dropRoot;
  const dropLine = (replay) => replay.drops.map((drop) => `s${drop.slot}p${drop.passIndex}:${drop.recomputed}/${drop.recomputedCents}c`).join(" ");
  record(
    "CENTRAL CLAIM: two independent processes replay one log identically",
    same,
    `process A (replay.mjs --order forward):
  state hash = ${forward.stateHash}
  drops      = ${dropLine(forward)}
  merkle root = ${forward.root}
process B (replay.mjs --order reverse):
  state hash = ${reverse.stateHash}
  drops      = ${dropLine(reverse)}
  merkle root = ${reverse.root}
identical: state hash ${forward.stateHash === reverse.stateHash} | drops ${dropsEqual} (draw-for-draw; only the emission order differs) | root ${forward.root === reverse.root}
both match the steward's recorded truth: ${forward.stateHash === roomATruth.stateHash && forward.root === roomATruth.dropRoot}
both processes reported zero problems: ${forward.problems.length === 0 && reverse.problems.length === 0}`
  );
}
{
  const replayed = replayLog(roomBLog, "forward");
  const backfilledId = "bot-3";
  const actor = replayed.actors.find((entry) => entry.id === backfilledId);
  const spawn = STATION.botSpawns[3];
  const distance = actor ? Math.hypot(actor.x - spawn.x, actor.y - spawn.y) : 0;
  const moved = Boolean(actor) && (distance > 30 || actor.tasksDone > 0);
  record(
    "backfill: an unsupplied seat is driven by its bot brain",
    replayed.problems.length === 0 && replayed.stateHashAgrees && moved,
    `slot 4 is a no-show \u2192 actor ${backfilledId} has no entry in the input map
final position = (${actor?.x.toFixed(1)}, ${actor?.y.toFixed(1)}) vs spawn (${spawn.x}, ${spawn.y}) \u2192 moved ${distance.toFixed(1)} units
bot tasks completed = ${actor?.tasksDone}
state hash agrees with the published one = ${replayed.stateHashAgrees}`
  );
}
{
  const sweep = process.env.SWEEP !== "0";
  const report = runSeparation({ log: roomALog, truth: roomATruth }, roomALog.frames, sweep);
  console.log(`
${report.lines.join("\n")}`);
  record("seed separation: the drops do not leak the impostor ids", report.pass, report.lines.join("\n"));
}
{
  const tampers = runTampers({ log: roomALog, truth: roomATruth });
  for (const tamper of tampers) {
    record(`tamper ${tamper.id}: ${tamper.name}`, tamper.pass, [`required failure: ${tamper.required}`, ...tamper.induced].join("\n"));
  }
}
var failed = results.filter((result) => !result.pass);
writeJson(resolve(outDir, "checks-report.json"), {
  generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
  room: roomALog.roomId,
  frames: roomALog.frames,
  checks: results,
  passed: results.length - failed.length,
  failed: failed.length
});
console.log(`
================ CHECKS: ${results.length - failed.length}/${results.length} PASS ================`);
for (const result of results) console.log(`  ${result.pass ? "PASS" : "FAIL"}  ${result.name}`);
console.log(`
report written to ${resolve(outDir, "checks-report.json")}`);
process.exit(failed.length === 0 ? 0 : 1);
