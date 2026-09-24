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
    const lines2 = [];
    for (const speaker of shuffle(meetingRng, speakers)) {
      const count = meetingRng.chance(0.35) ? 2 : 1;
      for (let index = 0; index < count; index++) {
        lines2.push({
          at: 0.4 + meetingRng.next() * (MEETING_TESTIMONY_SECONDS - 1.1),
          actorId: speaker.id,
          name: speaker.name,
          color: speaker.color,
          text: testimony(speaker, reporter, victim)
        });
      }
    }
    lines2.sort((left, right) => left.at - right.at);
    const votes = [];
    for (const voter of speakers) {
      votes.push({
        at: MEETING_TESTIMONY_SECONDS + 0.4 + voteRng.next() * 15,
        actorId: voter.id,
        target: botVote(voter, living)
      });
    }
    votes.sort((left, right) => left.at - right.at);
    return { lines: lines2, lineIndex: 0, votes, voteIndex: 0 };
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
  function finishTask(stationId, success, roll) {
    const attempt = state.activeTask;
    void roll;
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

// experiments/room-log/before/types.ts
var CREW_COLORS2 = {
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
var TASK_LABELS2 = Object.freeze({
  wiring: "Repair wiring",
  keypad: "Enter access code",
  dials: "Align dials",
  calibrate: "Calibrate engine",
  sample: "Analyse sample",
  reboot: "Reboot terminal"
});

// experiments/room-log/before/rng.ts
function hashSeed2(text) {
  let hash2 = 1779033703 ^ text.length;
  for (let index = 0; index < text.length; index++) {
    hash2 = Math.imul(hash2 ^ text.charCodeAt(index), 3432918353);
    hash2 = hash2 << 13 | hash2 >>> 19;
  }
  hash2 = Math.imul(hash2 ^ hash2 >>> 16, 2246822507);
  hash2 = Math.imul(hash2 ^ hash2 >>> 13, 3266489909);
  return (hash2 ^= hash2 >>> 16) >>> 0;
}
function createRng2(seed) {
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

// experiments/room-log/before/station.ts
var STATION_WIDTH2 = 2400;
var STATION_HEIGHT2 = 1500;
var ACTOR_RADIUS2 = 15;
function room2(id, name, x, y, w, h) {
  return { id, kind: "room", name, x, y, w, h };
}
function corridor2(id, name, x, y, w, h) {
  return { id, kind: "corridor", name, x, y, w, h };
}
var ZONES2 = [
  // 3x3 room grid. Columns at x 120/880/1760, rows at y 60/570/1050.
  room2("reactor", "Reactor", 120, 60, 520, 390),
  room2("cafeteria", "Cafeteria", 880, 60, 640, 390),
  room2("navigation", "Navigation", 1760, 60, 520, 390),
  room2("medbay", "MedBay", 120, 570, 520, 360),
  room2("storage", "Storage", 880, 570, 640, 360),
  room2("comms", "Comms", 1760, 570, 520, 360),
  room2("electrical", "Electrical", 120, 1050, 520, 390),
  room2("engine", "Engine", 880, 1050, 640, 390),
  room2("o2", "O2", 1760, 1050, 520, 390),
  // Vertical corridors: 140 wide, filling the 120-unit gap between two rows.
  corridor2("corridor-reactor-medbay", "Reactor Access", 310, 450, 140, 120),
  corridor2("corridor-medbay-electrical", "Lower Reactor Access", 310, 930, 140, 120),
  corridor2("corridor-cafeteria-storage", "Cafeteria Access", 1130, 450, 140, 120),
  corridor2("corridor-storage-engine", "Lower Cafeteria Access", 1130, 930, 140, 120),
  corridor2("corridor-navigation-comms", "Navigation Access", 1950, 450, 140, 120),
  corridor2("corridor-comms-o2", "Lower Navigation Access", 1950, 930, 140, 120),
  // Horizontal corridors: 140 tall, filling the 240-unit gap between two columns.
  corridor2("corridor-reactor-cafeteria", "West Corridor", 640, 185, 240, 140),
  corridor2("corridor-cafeteria-navigation", "East Corridor", 1520, 185, 240, 140),
  corridor2("corridor-medbay-storage", "West Hall", 640, 680, 240, 140),
  corridor2("corridor-storage-comms", "East Hall", 1520, 680, 240, 140),
  corridor2("corridor-electrical-engine", "Lower West Hall", 640, 1175, 240, 140),
  corridor2("corridor-engine-o2", "Lower East Hall", 1520, 1175, 240, 140)
];
var HUBS2 = {
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
var ZONE_LINKS2 = [
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
var TASK_STATIONS2 = [
  { id: "task-reactor", zoneId: "reactor", name: "Calibrate Reactor", kind: "calibrate", x: 230, y: 130, long: true },
  { id: "task-navigation", zoneId: "navigation", name: "Align Navigation Dials", kind: "dials", x: 2170, y: 130, long: true },
  { id: "task-comms", zoneId: "comms", name: "Reboot Comms Array", kind: "reboot", x: 2170, y: 860, long: true },
  { id: "task-medbay", zoneId: "medbay", name: "Analyse Blood Sample", kind: "sample", x: 230, y: 860, long: false },
  { id: "task-electrical", zoneId: "electrical", name: "Repair Wiring", kind: "wiring", x: 230, y: 1370, long: false },
  { id: "task-o2", zoneId: "o2", name: "Unlock O2 Filters", kind: "keypad", x: 2170, y: 1370, long: false }
];
var VENTS2 = [
  { id: "vent-electrical", zoneId: "electrical", x: 300, y: 1240, link: "vent-navigation" },
  { id: "vent-navigation", zoneId: "navigation", x: 1840, y: 240, link: "vent-electrical" }
];
var CONSOLES2 = [
  { id: "console-reactor", kind: "sabotage-trigger", sabotage: "reactor", x: 560, y: 130, name: "Reactor Console" },
  { id: "console-o2", kind: "sabotage-trigger", sabotage: "o2", x: 1840, y: 1370, name: "O2 Console" },
  { id: "console-lights", kind: "sabotage-fix", sabotage: "lights", x: 560, y: 1370, name: "Electrical Breaker" },
  { id: "console-comms", kind: "sabotage-fix", sabotage: "comms", x: 1840, y: 860, name: "Comms Relay" }
];
var BOT_SPAWNS2 = [
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
var STATION2 = {
  id: "kestrel",
  name: "Kestrel Station",
  width: STATION_WIDTH2,
  height: STATION_HEIGHT2,
  zones: ZONES2,
  stations: TASK_STATIONS2,
  vents: VENTS2,
  emergency: { x: 1140, y: 350 },
  playerSpawn: { x: 1140, y: 220 },
  botSpawns: BOT_SPAWNS2
};
function isWalkable2(station, point, radius) {
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

// experiments/room-log/before/sim.ts
var PLAYER_SPEED2 = 155;
var BOT_SPEED2 = 120;
var MAX_DT2 = 0.5;
var MOVE_SUBSTEP2 = 6;
var KILL_RANGE2 = 62;
var PLAYER_KILL_COOLDOWN2 = 25;
var BOT_KILL_COOLDOWN2 = 28;
var BOT_KILL_SAFE_RADIUS2 = 220;
var WITNESS_RADIUS2 = 400;
var BODY_SUSPICION_RADIUS2 = 260;
var INTERACT_RANGE2 = 70;
var VENT_RANGE2 = 40;
var VENT_MAX_SECONDS2 = 15;
var SABOTAGE_MIN_GAP2 = 45;
var SABOTAGE_MAX_GAP2 = 70;
var SABOTAGE_COUNTDOWN2 = 40;
var MEETING_TESTIMONY_SECONDS2 = 7;
var MEETING_VOTE_SECONDS2 = 20;
var MATCH_LIMIT_SECONDS2 = 420;
var BOT_TASKS2 = 5;
var BOT_FIRST_KILL_DELAY2 = 22;
var BOT_WORK_MIN2 = 3.5;
var BOT_WORK_MAX2 = 7.5;
var BOT_IDLE_MIN2 = 0.8;
var BOT_IDLE_MAX2 = 2.6;
var ZONE_ARRIVE2 = 16;
var GOAL_ARRIVE2 = 12;
var EVENT_CAP2 = 512;
var TASK_SEED_BOUND2 = 2147483647;
var PLAYER_ID2 = "player";
var BOT_NAMES2 = [
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
var BOT_TAGS2 = [
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
var COLOR_IDS2 = Object.keys(CREW_COLORS2);
function playerColorFor2(seed) {
  const rng = createRng2(hashSeed2(`${seed}:player-color`));
  return COLOR_IDS2[rng.int(COLOR_IDS2.length)];
}
function createRoster2(input) {
  const rng = createRng2(hashSeed2(`${input.seed}:roster`));
  const count = Math.max(0, Math.floor(input.botCount));
  const names = shuffle2(rng, BOT_NAMES2);
  const tags = shuffle2(rng, BOT_TAGS2);
  const palette = shuffle2(rng, COLOR_IDS2.filter((color) => color !== input.playerColor));
  const roster = [{
    id: PLAYER_ID2,
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
function shuffle2(rng, items) {
  const out = items.slice();
  for (let index = out.length - 1; index > 0; index--) {
    const swap = rng.int(index + 1);
    const held = out[index];
    out[index] = out[swap];
    out[swap] = held;
  }
  return out;
}
function visionRadius2(state) {
  return state.sabotage === "lights" ? 90 : WITNESS_RADIUS2;
}
function sabotageLabel2(kind) {
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
var CODE_REPORT2 = 1;
var CODE_KILL2 = 2;
var CODE_FIX2 = 3;
var CODE_EMERGENCY2 = 4;
var CODE_TASK2 = 5;
var CODE_TRIGGER2 = 6;
var CODE_VENT2 = 7;
var CODE_VENT_EXIT2 = 8;
var roomNames2 = STATION2.zones.filter((zone) => zone.kind === "room").map((zone) => zone.name);
var NO_LINKS2 = [];
var probe2 = { x: 0, y: 0 };
var adjacency2 = null;
function neighbours2() {
  if (adjacency2) return adjacency2;
  const map = /* @__PURE__ */ new Map();
  for (const zone of STATION2.zones) map.set(zone.id, []);
  for (const pair of ZONE_LINKS2) {
    const left = map.get(pair[0]);
    const right = map.get(pair[1]);
    if (left) left.push(pair[1]);
    if (right) right.push(pair[0]);
  }
  adjacency2 = map;
  return map;
}
function zoneAt2(point) {
  for (const zone of STATION2.zones) {
    if (point.x >= zone.x && point.x <= zone.x + zone.w && point.y >= zone.y && point.y <= zone.y + zone.h) {
      return zone.id;
    }
  }
  return null;
}
function routeTo2(fromZone, toZone) {
  if (fromZone === toZone) return [fromZone];
  const graph = neighbours2();
  const cameFrom = /* @__PURE__ */ new Map();
  const queue = [fromZone];
  cameFrom.set(fromZone, fromZone);
  for (let head = 0; head < queue.length; head++) {
    const zone = queue[head];
    const links = graph.get(zone) ?? NO_LINKS2;
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
function mutate2(actor) {
  return actor;
}
function within2(a, b, radius) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy <= radius * radius;
}
function moveActor2(actor, dx, dy) {
  const distance = Math.hypot(dx, dy);
  if (distance <= 0) return;
  const steps = distance > MOVE_SUBSTEP2 ? Math.ceil(distance / MOVE_SUBSTEP2) : 1;
  const stepX = dx / steps;
  const stepY = dy / steps;
  for (let index = 0; index < steps; index++) {
    const { pos } = actor;
    const nextX = pos.x + stepX;
    const nextY = pos.y + stepY;
    probe2.x = nextX;
    probe2.y = nextY;
    if (isWalkable2(STATION2, probe2, ACTOR_RADIUS2)) {
      pos.x = nextX;
      pos.y = nextY;
      continue;
    }
    probe2.x = nextX;
    probe2.y = pos.y;
    if (isWalkable2(STATION2, probe2, ACTOR_RADIUS2)) {
      pos.x = nextX;
      continue;
    }
    probe2.x = pos.x;
    probe2.y = nextY;
    if (isWalkable2(STATION2, probe2, ACTOR_RADIUS2)) {
      pos.y = nextY;
    }
  }
}
function createMatch2(config) {
  const roleRng = createRng2(hashSeed2(`${config.seed}:roles`));
  const moveRng = createRng2(hashSeed2(`${config.seed}:bots`));
  const taskRng = createRng2(hashSeed2(`${config.seed}:tasks`));
  const sabotageRng = createRng2(hashSeed2(`${config.seed}:sabotage`));
  const meetingRng = createRng2(hashSeed2(`${config.seed}:meeting`));
  const voteRng = createRng2(hashSeed2(`${config.seed}:votes`));
  const roster = createRoster2({
    seed: config.seed,
    botCount: config.botCount,
    playerName: config.playerName,
    playerColor: playerColorFor2(config.seed)
  });
  const total = roster.length;
  const impostorCount = total >= 7 ? 2 : 1;
  const botImpostorSlots = Math.max(0, impostorCount - (config.playerRole === "impostor" ? 1 : 0));
  const botEntries = roster.filter((entry) => !entry.isPlayer);
  const impostorIds = new Set(shuffle2(roleRng, botEntries).slice(0, botImpostorSlots).map((entry) => entry.id));
  const actors = roster.map((entry, index) => {
    const role = entry.isPlayer ? config.playerRole : impostorIds.has(entry.id) ? "impostor" : "crew";
    const spawn = entry.isPlayer ? STATION2.playerSpawn : STATION2.botSpawns[(index - 1) % STATION2.botSpawns.length];
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
      tasksTotal: entry.isPlayer ? STATION2.stations.length : BOT_TASKS2,
      suspicion: 0,
      lastSeen: 0,
      ventedUntil: 0,
      witnessed: false
    };
  });
  const state = {
    config,
    station: STATION2,
    phase: "briefing",
    time: 0,
    actors,
    playerId: PLAYER_ID2,
    activeTask: null,
    meeting: null,
    ejection: null,
    sabotage: "none",
    sabotageEndsAt: 0,
    prompt: null,
    tasksTotal: STATION2.stations.length,
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
  let nextSabotageAt = sabotageRng.range(SABOTAGE_MIN_GAP2, SABOTAGE_MAX_GAP2);
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
    for (const station of STATION2.stations) if (station.id === id) return station;
    return null;
  }
  function consoleById(id) {
    if (!id) return null;
    for (const console2 of CONSOLES2) if (console2.id === id) return console2;
    return null;
  }
  function consoleFor(kind) {
    for (const console2 of CONSOLES2) if (console2.sabotage === kind) return console2;
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
    if (state.events.length >= EVENT_CAP2) state.events.shift();
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
    pushEvent("sabotage-fixed", `${actor.name} repaired ${sabotageLabel2(kind).toLowerCase()} at the ${console2.name}`, actor.id, kind);
    checkOutcome();
    bump();
  }
  function triggerSabotage(kind, actor) {
    if (kind === "none" || state.sabotage !== "none") return;
    state.sabotage = kind;
    state.sabotageEndsAt = kind === "reactor" || kind === "o2" ? state.time + SABOTAGE_COUNTDOWN2 : 0;
    sabotageToken++;
    pushEvent("sabotage", `${sabotageLabel2(kind)} \u2014 report to ${consoleFor(kind)?.name ?? "the console"}`, actor.isPlayer ? actor.id : void 0, kind);
    bump();
  }
  function evaluateOutcome() {
    const livingImpostors = countLiving("impostor");
    const livingCrew = countLiving("crew");
    if (state.crewProgress >= 1) return "crew-win";
    if (deaths > 0 && livingImpostors === 0) return "crew-win";
    if (deaths > 0 && livingImpostors >= livingCrew) return "impostor-win";
    if (state.sabotage !== "none" && state.sabotageEndsAt > 0 && state.time >= state.sabotageEndsAt) return "impostor-win";
    if (state.time >= MATCH_LIMIT_SECONDS2) return "timeout";
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
      const spawn = actor.isPlayer ? STATION2.playerSpawn : STATION2.botSpawns[botIndex++ % STATION2.botSpawns.length];
      const live = mutate2(actor);
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
    nextSabotageAt = state.time + sabotageRng.range(SABOTAGE_MIN_GAP2, SABOTAGE_MAX_GAP2);
    bump();
    refreshPrompt();
  }
  function applyBodySuspicion(victimId, reporterId) {
    let spot = null;
    for (const body of bodies) if (body.actorId === victimId) spot = body;
    if (!spot) return;
    for (const actor of state.actors) {
      if (!actor.alive || actor.id === victimId || actor.id === reporterId) continue;
      if (within2(actor.pos, spot, BODY_SUSPICION_RADIUS2)) actor.suspicion += 2;
    }
  }
  function testimony(speaker, reporter, victim) {
    const others = state.actors.filter((actor) => actor.alive && actor.id !== speaker.id);
    const target = others.length > 0 ? meetingRng.pick(others) : speaker;
    const zone = meetingRng.pick(roomNames2);
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
    const lines2 = [];
    for (const speaker of shuffle2(meetingRng, speakers)) {
      const count = meetingRng.chance(0.35) ? 2 : 1;
      for (let index = 0; index < count; index++) {
        lines2.push({
          at: 0.4 + meetingRng.next() * (MEETING_TESTIMONY_SECONDS2 - 1.1),
          actorId: speaker.id,
          name: speaker.name,
          color: speaker.color,
          text: testimony(speaker, reporter, victim)
        });
      }
    }
    lines2.sort((left, right) => left.at - right.at);
    const votes = [];
    for (const voter of speakers) {
      votes.push({
        at: MEETING_TESTIMONY_SECONDS2 + 0.4 + voteRng.next() * 15,
        actorId: voter.id,
        target: botVote(voter, living)
      });
    }
    votes.sort((left, right) => left.at - right.at);
    return { lines: lines2, lineIndex: 0, votes, voteIndex: 0 };
  }
  function startMeeting(reporterId, victimId) {
    const reporter = actorById(reporterId);
    const victim = victimId ? actorById(victimId) : null;
    const meeting = {
      reporterId,
      victimId,
      startedAt: state.time,
      endsAt: state.time + MEETING_TESTIMONY_SECONDS2 + MEETING_VOTE_SECONDS2,
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
      const fallen = mutate2(ejected);
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
    if (elapsed >= MEETING_TESTIMONY_SECONDS2) {
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
      playerKillReadyAt = state.time + PLAYER_KILL_COOLDOWN2;
    }
    for (const watcher of state.actors) {
      if (watcher === killer || watcher === victim || !watcher.alive || watcher.isPlayer) continue;
      if (state.time < watcher.ventedUntil) continue;
      if (within2(watcher.pos, victim.pos, WITNESS_RADIUS2) || within2(watcher.pos, killer.pos, WITNESS_RADIUS2)) {
        killer.suspicion += 4;
      }
    }
    const player = playerActor();
    if (player !== victim && player.alive && within2(player.pos, killer.pos, visionRadius2(state))) {
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
    const victim = nearestKillTarget(player, KILL_RANGE2);
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
        if (within2(actor.pos, player.pos, BODY_SUSPICION_RADIUS2)) {
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
    for (const entry of STATION2.vents) {
      if (within2(player.pos, entry, VENT_RANGE2)) {
        spot = entry;
        linked = entry.link;
      }
    }
    if (!spot || !linked) return;
    let exit = null;
    for (const entry of STATION2.vents) if (entry.id === linked) exit = entry;
    if (!exit) return;
    const live = mutate2(player);
    live.pos.x = exit.x;
    live.pos.y = exit.y;
    player.ventedUntil = state.time + VENT_MAX_SECONDS2;
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
      case CODE_REPORT2: {
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
      case CODE_KILL2: {
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
      case CODE_FIX2: {
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
      case CODE_EMERGENCY2: {
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
      case CODE_TASK2: {
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
      case CODE_TRIGGER2: {
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
      case CODE_VENT2: {
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
        code = CODE_VENT_EXIT2;
      } else {
        for (const body of bodies) {
          if (within2(player.pos, body, INTERACT_RANGE2) && 100 > score) {
            code = CODE_REPORT2;
            target = body.actorId;
            score = 100;
          }
        }
        if (player.role === "impostor" && state.time >= playerKillReadyAt) {
          const victim = nearestKillTarget(player, KILL_RANGE2);
          if (victim && 90 > score) {
            code = CODE_KILL2;
            target = victim.id;
            score = 90;
          }
        }
        if (state.sabotage !== "none") {
          const console2 = consoleFor(state.sabotage);
          if (console2 && within2(player.pos, console2, INTERACT_RANGE2) && 80 > score) {
            code = CODE_FIX2;
            target = console2.id;
            score = 80;
          }
        }
        if (!emergencyUsed && within2(player.pos, STATION2.emergency, INTERACT_RANGE2) && 70 > score) {
          code = CODE_EMERGENCY2;
          target = null;
          score = 70;
        }
        if (player.role === "crew") {
          for (const station of STATION2.stations) {
            if (within2(player.pos, station, INTERACT_RANGE2) && 60 > score) {
              code = CODE_TASK2;
              target = station.id;
              score = 60;
            }
          }
        }
        if (player.role === "impostor" && state.sabotage === "none") {
          for (const console2 of CONSOLES2) {
            if (console2.kind !== "sabotage-trigger") continue;
            if (within2(player.pos, console2, INTERACT_RANGE2) && 50 > score) {
              code = CODE_TRIGGER2;
              target = console2.id;
              score = 50;
            }
          }
        }
        if (player.role === "impostor") {
          for (const entry of STATION2.vents) {
            if (within2(player.pos, entry, VENT_RANGE2) && 40 > score) {
              code = CODE_VENT2;
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
          seed: taskRng.int(TASK_SEED_BOUND2),
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
  function finishTask(stationId, success, roll) {
    const attempt = state.activeTask;
    void roll;
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
    if (state.time - meeting.startedAt < MEETING_TESTIMONY_SECONDS2) return;
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
    const stations = STATION2.stations;
    let index = moveRng.int(stations.length);
    if (stations.length > 1 && stations[index].id === brain.lastStation) index = (index + 1) % stations.length;
    const station = stations[index];
    brain.lastStation = station.id;
    return station;
  }
  function buildPath(from, goalX, goalY) {
    const startZone = zoneAt2(from);
    probe2.x = goalX;
    probe2.y = goalY;
    const goalZone = zoneAt2(probe2);
    const points = [];
    if (startZone && goalZone && startZone !== goalZone) {
      const route = routeTo2(startZone, goalZone);
      if (route) {
        for (let index = 1; index < route.length; index++) {
          const hub = HUBS2[route[index]];
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
    brain.idleUntil = state.time + moveRng.range(BOT_IDLE_MIN2, BOT_IDLE_MAX2);
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
    const victim = nearestKillTarget(killer, KILL_RANGE2);
    if (!victim) return;
    for (const other of state.actors) {
      if (other === killer || other === victim || !other.alive) continue;
      if (state.time < other.ventedUntil) continue;
      if (within2(other.pos, killer.pos, BOT_KILL_SAFE_RADIUS2)) return;
      if (within2(other.pos, victim.pos, BOT_KILL_SAFE_RADIUS2)) return;
    }
    performKill(killer, victim, false);
    brain.killReadyAt = state.time + BOT_KILL_COOLDOWN2 + moveRng.range(-3, 4);
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
    if (distance <= (onWaypoint ? ZONE_ARRIVE2 : GOAL_ARRIVE2)) {
      if (onWaypoint) {
        brain.pathIndex++;
        return;
      }
      brain.working = true;
      brain.workingUntil = state.time + moveRng.range(BOT_WORK_MIN2, BOT_WORK_MAX2);
      actor.walking = false;
      actor.state = "working";
      return;
    }
    const step = Math.min(distance, BOT_SPEED2 * dt);
    moveActor2(actor, dx / distance * step, dy / distance * step);
    actor.walking = true;
    if (actor.state !== "working") actor.state = "walking";
    setFacing(actor, dx, dy);
  }
  function updateBots(dt) {
    for (const actor of state.actors) {
      if (actor.isPlayer || !actor.alive) continue;
      if (state.time < actor.ventedUntil) {
        actor.walking = false;
        actor.state = "idle";
        continue;
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
          killReadyAt: state.time + BOT_FIRST_KILL_DELAY2 + moveRng.range(0, 10),
          lastStation: ""
        };
        brains.set(actor.id, brain);
      }
      if (actor.role === "impostor") {
        tryBotKill(actor, brain);
        if (state.phase !== "play") {
          actor.walking = false;
          return;
        }
      }
      updateBot(actor, brain, dt);
    }
  }
  function updatePlayer(dt, input) {
    const player = playerActor();
    if (!player.alive || state.time < player.ventedUntil) {
      player.walking = false;
      if (player.state !== "down") player.state = "idle";
      return;
    }
    let dx = 0;
    let dy = 0;
    if (input.left) dx -= 1;
    if (input.right) dx += 1;
    if (input.up) dy -= 1;
    if (input.down) dy += 1;
    if (dx === 0 && dy === 0 && input.destination) {
      const toX = input.destination.x - player.pos.x;
      const toY = input.destination.y - player.pos.y;
      const distance = Math.hypot(toX, toY);
      if (distance > 6) {
        dx = toX / distance;
        dy = toY / distance;
      }
    }
    if (dx === 0 && dy === 0) {
      player.walking = false;
      if (player.state !== "down") player.state = "idle";
      return;
    }
    const length = Math.hypot(dx, dy) || 1;
    const step = PLAYER_SPEED2 * dt;
    moveActor2(player, dx / length * step, dy / length * step);
    player.walking = true;
    if (player.state !== "down") player.state = "walking";
    setFacing(player, dx, dy);
  }
  function refreshLastSeen() {
    const player = playerActor();
    if (!player.alive) return;
    const radius = visionRadius2(state);
    for (const actor of state.actors) {
      if (actor.isPlayer || !actor.alive) continue;
      if (state.time < actor.ventedUntil) continue;
      if (within2(actor.pos, player.pos, radius)) actor.lastSeen = state.time;
    }
  }
  function refreshAlarm() {
    const seconds = state.sabotageEndsAt > 0 ? Math.max(0, Math.ceil(state.sabotageEndsAt - state.time)) : -1;
    if (seconds === alarmTick && alarmKind === state.sabotage) return;
    alarmTick = seconds;
    alarmKind = state.sabotage;
    const next = state.sabotage === "none" ? "" : state.sabotage === "lights" ? "LIGHTS OFFLINE \u2014 vision reduced" : state.sabotage === "comms" ? "COMMS DOWN \u2014 task list offline" : `${sabotageLabel2(state.sabotage).toUpperCase()} \u2014 ${seconds}s TO IMPACT`;
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
    nextSabotageAt = state.time + sabotageRng.range(SABOTAGE_MIN_GAP2, SABOTAGE_MAX_GAP2);
  }
  function update(dtSeconds, input) {
    const dt = dtSeconds > MAX_DT2 ? MAX_DT2 : dtSeconds > 0 ? dtSeconds : 0;
    state.time += dt;
    if (state.phase === "play") {
      recomputeProgress();
      if (!state.activeTask) {
        updatePlayer(dt, input);
        updateBots(dt);
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
import { createHash } from "node:crypto";
function hash(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
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

// experiments/room-log/src/backcompat.ts
var DT = 1 / 60;
var FRAMES = 3600;
var IDLE = { up: false, down: false, left: false, right: false, destination: null };
var SEED = 20260924;
var CONFIGS = [
  ["botCount=5 (6 actors)", { seed: SEED, tier: "standard", playerRole: "crew", botCount: 5, playerName: "Ferra", friendId: "42" }],
  ["botCount=6 (7 actors)", { seed: SEED, tier: "standard", playerRole: "crew", botCount: 6, playerName: "Ferra", friendId: "42" }]
];
function inputsFor(frames) {
  const rng = createRng(hashSeed(`${SEED}:backcompat-inputs`));
  const stream = [];
  let direction = null;
  let remaining = 0;
  for (let frame = 0; frame < frames; frame++) {
    if (remaining <= 0) {
      if (rng.int(10) < 7) {
        const pick = rng.int(4);
        direction = [pick === 0, pick === 1, pick === 2, pick === 3];
        remaining = 15 + rng.int(35);
      } else {
        direction = null;
        remaining = 5 + rng.int(15);
      }
    }
    remaining--;
    stream.push({
      up: direction ? direction[0] : false,
      down: direction ? direction[1] : false,
      left: direction ? direction[2] : false,
      right: direction ? direction[3] : false,
      destination: null
    });
  }
  return stream;
}
function run(create, config, inputs, mode) {
  const match = create(config);
  match.advance();
  const hashes = [];
  for (let frame = 0; frame < inputs.length; frame++) {
    const input = inputs[frame];
    if (mode === "two-arg") match.update(DT, input);
    else if (mode === "undefined-map") match.update(DT, input, void 0);
    else if (mode === "empty-map") match.update(DT, input, {});
    else {
      const actors = match.state.actors;
      const frameMap = {};
      for (const actor of actors) frameMap[actor.id] = actor.isPlayer ? input : { ...input, up: input.down, down: input.up };
      match.update(DT, IDLE, frameMap);
    }
    hashes.push(stateDigest(match.state));
  }
  return { hashes, final: hashes[hashes.length - 1] };
}
function compare(a, b) {
  const length = Math.min(a.length, b.length);
  let equal = 0;
  let firstDiff = -1;
  for (let index = 0; index < length; index++) {
    if (a[index] === b[index]) equal++;
    else if (firstDiff < 0) firstDiff = index;
  }
  return { equal, firstDiff };
}
var failures = 0;
var lines = [];
lines.push(`SPIKE A \u2014 single-player path before/after the per-actor input change`);
lines.push(`seed=${SEED} frames=${FRAMES} dt=${DT} inputs=seeded scripted walks`);
for (const [label, config] of CONFIGS) {
  const inputs = inputsFor(FRAMES);
  const before = run(createMatch2, config, inputs, "two-arg");
  const afterTwo = run(createMatch, config, inputs, "two-arg");
  const afterUndefined = run(createMatch, config, inputs, "undefined-map");
  const afterEmpty = run(createMatch, config, inputs, "empty-map");
  const afterSupplied = run(createMatch, config, inputs, "supplied-map");
  const two = compare(before.hashes, afterTwo.hashes);
  const undef = compare(before.hashes, afterUndefined.hashes);
  const empty = compare(before.hashes, afterEmpty.hashes);
  const supplied = compare(before.hashes, afterSupplied.hashes);
  const ok = two.equal === FRAMES && undef.equal === FRAMES && empty.equal === FRAMES && supplied.firstDiff >= 0;
  if (!ok) failures++;
  lines.push(`
${label}  ${ok ? "PASS" : "FAIL"}`);
  lines.push(`  before(2-arg)              final = ${before.final}`);
  lines.push(`  after (2-arg)              final = ${afterTwo.final}`);
  lines.push(`  after (3-arg undefined)    final = ${afterUndefined.final}`);
  lines.push(`  after (3-arg {})           final = ${afterEmpty.final}`);
  lines.push(`  after (supplied map)       final = ${afterSupplied.final}`);
  lines.push(`  per-frame identical before/after   : ${two.equal}/${FRAMES} frames${two.firstDiff >= 0 ? ` (first mismatch frame ${two.firstDiff})` : ""}`);
  lines.push(`  per-frame identical with undefined : ${undef.equal}/${FRAMES} frames`);
  lines.push(`  per-frame identical with empty map : ${empty.equal}/${FRAMES} frames`);
  lines.push(`  supplied map diverges at frame     : ${supplied.firstDiff} (the new path is live, not a no-op)`);
}
lines.push(`
SPIKE A RESULT: ${failures === 0 ? "PASS \u2014 no-map call sites are byte-identical" : `FAIL (${failures})`}`);
console.log(lines.join("\n"));
process.exit(failures === 0 ? 0 : 1);
