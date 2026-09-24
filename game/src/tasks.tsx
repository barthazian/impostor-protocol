/**
 * IMPOSTOR PROTOCOL — station task arcade.
 *
 * Six *different* retro pixel-arcade games, one per task console. The console
 * ids and `TaskKind`s are unchanged (`station.ts`), so the rest of the match —
 * prompts, crew progress, payouts — sees exactly the same contract:
 *
 *   calibrate   Calibrate Reactor       BREAKOUT     paddle + coolant pulse
 *   dials       Align Navigation Dials  SNAKE        waypoint course, in order
 *   reboot      Reboot Comms Array      MEMORY       growing signal sequence
 *   sample      Analyse Blood Sample    MINESWEEPER  clean cells, flag the rest
 *   wiring      Repair Wiring           PATCH PANEL  (same route puzzle, pixel)
 *   keypad      Unlock O2 Filters       STACKER      falling filter blocks
 *
 * Every game runs on an integer grid driven by a fixed-step ticker, which is
 * what the 8-bit cabinets did: motion is chunky, nothing interpolates it, and a
 * reduced-motion player gets the identical game. Randomness only ever comes
 * from `./rng`, seeded from `attempt.seed`, so a room code replays the same
 * consoles and the tests can drive them by hand.
 *
 * PRESENTATION ONLY. This module never touches the FriendSDK action client, the
 * RF economy or the match simulation. It reports exactly one boolean plus one
 * fresh `cryptoRoll()` back through `onResolve`, and it can be cancelled through
 * `onCancel`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { createRng, cryptoRoll } from "./rng";
import type { Rng } from "./rng";
import { TASK_LABELS } from "./types";
import type { TaskAttempt, TaskKind } from "./types";
import "./tasks.css";

export type TaskCue = "start" | "tick" | "ok" | "fail";

export type TaskOverlayProps = Readonly<{
  attempt: TaskAttempt;
  reducedMotion: boolean;
  soundEnabled: boolean;
  /** Called exactly once, with a fresh roll from ./rng. */
  onResolve: (success: boolean, roll: number) => void;
  onCancel: () => void;
  onCue: (cue: TaskCue) => void;
}>;

type Phase = "play" | "won" | "lost";
type LossReason = "failed" | "timeout";

/**
 * Long consoles (Reactor, Navigation, Comms) get a 26 s cycle, the three short
 * ones 22 s. One timer per attempt, ticking once a second, urgent over the last
 * quarter — the behaviour the console always had, sized so an arcade-length
 * game leaves a competent player a couple of seconds of slack.
 */
function taskSeconds(long: boolean): number {
  return long ? 26 : 22;
}

const INSTRUCTIONS: Readonly<Record<TaskKind, string>> = {
  calibrate: "BREAKOUT — slide the coolant paddle, keep the pulse alive and smash every corrupted reactor cell.",
  dials: "SNAKE — eat the six nav waypoints in order. Your own track and the nav frame are lethal.",
  reboot: "MEMORY — repeat the growing signal sequence on the pads. A wrong pad costs an attempt.",
  sample: "MINESWEEPER — open every clean cell. A contaminated reveal fails the console.",
  wiring: "Repair wiring — pair each left node with the right node of the same colour.",
  keypad: "STACKER — rotate and fit the falling filter blocks, then clear two rows.",
};

/* ------------------------------------------------------------------ *
 *  shared helpers                                                    *
 * ------------------------------------------------------------------ */

/** Positive modulo (JS `%` keeps the sign of the dividend). */
function wrap(value: number, bound: number): number {
  return ((value % bound) + bound) % bound;
}

/** Each minigame derives its own deterministic stream from the station seed. */
function seededRng(seed: number, salt: number): Rng {
  return createRng((seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0);
}

/**
 * Swallows a second activation of the same control within `windowMs`.
 * A pointerup/click pair or a keydown/native-click pair lands well inside this
 * window; a human double-tap never does.
 */
function createGate(windowMs: number): () => boolean {
  let last = -Infinity;
  return () => {
    const now = performance.now();
    if (now - last < windowMs) return false;
    last = now;
    return true;
  };
}

/**
 * Window-level key handling, kept in sync with the latest render so handlers
 * never read stale state. Capture lets the overlay consume a key before the
 * station behind it (movement, menu shortcuts) sees it.
 */
function useWindowKeys(active: boolean, handler: (event: KeyboardEvent) => void): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    if (!active) return;
    const listener = (event: KeyboardEvent): void => {
      latest.current(event);
    };
    window.addEventListener("keydown", listener, true);
    return () => {
      window.removeEventListener("keydown", listener, true);
    };
  }, [active]);
}

/**
 * A short-lived status message: pushing a new one restarts the timer, and the
 * message clears itself so it never displaces the permanent control hints.
 */
function useFlash(ms: number): readonly [string, (text: string) => void] {
  const [flash, setFlash] = useState<{ text: string; id: number } | null>(null);
  const counter = useRef(0);
  useEffect(() => {
    if (flash === null) return;
    const id = window.setTimeout(() => {
      setFlash(null);
    }, ms);
    return () => {
      window.clearTimeout(id);
    };
  }, [flash, ms]);
  const push = useCallback((text: string): void => {
    counter.current += 1;
    setFlash({ text, id: counter.current });
  }, []);
  return [flash?.text ?? "", push] as const;
}

/** Resolves a minigame exactly once and freezes it afterwards. */
function useFinish(onDone: (success: boolean) => void): {
  finished: { readonly current: boolean };
  finish: (success: boolean) => void;
} {
  const finished = useRef(false);
  const finish = useCallback(
    (success: boolean): void => {
      if (finished.current) return;
      finished.current = true;
      onDone(success);
    },
    [onDone],
  );
  return { finished, finish };
}

/** Fixed-step ticker: grid games read a tick, not a frame. */
function useTicker(active: boolean, ms: number, step: () => void): void {
  const latest = useRef(step);
  useEffect(() => {
    latest.current = step;
  });
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      latest.current();
    }, ms);
    return () => {
      window.clearInterval(id);
    };
  }, [active, ms]);
}

/** Keys the arcade owns while a console is open. */
const GAME_KEYS: readonly string[] = [
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "Enter",
  "a", "d", "w", "s", "f", "z", "x",
  "1", "2", "3", "4",
];

function keyName(event: KeyboardEvent): string {
  if (event.key === " " || event.key === "Spacebar") return "Space";
  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

/**
 * Keyboard state for the grid games: a live `held` set for continuous motion
 * plus an edge callback for one-shot actions. Keys are consumed in the capture
 * phase so the station behind the console never walks the crewmate.
 *
 * A focused real control keeps its native Enter/Space activation, so the
 * on-screen controls stay usable from the keyboard too.
 */
function useKeys(active: boolean, onPress?: (key: string) => void): { readonly current: Set<string> } {
  const held = useRef(new Set<string>());
  const press = useRef(onPress);
  useEffect(() => {
    press.current = onPress;
  });
  useEffect(() => {
    if (!active) {
      held.current.clear();
      return;
    }
    const down = (event: KeyboardEvent): void => {
      const key = keyName(event);
      if (!GAME_KEYS.includes(key)) return;
      const target = event.target;
      const native = (key === "Space" || key === "Enter") && target instanceof HTMLElement &&
        (target.tagName === "BUTTON" || target.tagName === "INPUT");
      if (native) return;
      event.preventDefault();
      event.stopPropagation();
      held.current.add(key);
      if (!event.repeat) press.current?.(key);
    };
    const up = (event: KeyboardEvent): void => {
      held.current.delete(keyName(event));
    };
    const clear = (): void => {
      held.current.clear();
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", clear);
    };
  }, [active]);
  return held;
}

/** Limited 8-bit palette; tasks.css mirrors these tokens. */
const ARC = {
  void: "#05070c",
  screen: "#0a0e17",
  steel: "#263043",
  ink: "#e8edf7",
  dim: "#8b9bb4",
  lime: "#ccff00",
  cyan: "#38fedc",
  red: "#ff4d4d",
  amber: "#f5f557",
  violet: "#b06bff",
} as const;

/** One chunky pixel block, in logical cells. */
function block(
  context: CanvasRenderingContext2D,
  cell: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  context.fillStyle = color;
  context.fillRect(Math.round(x) * cell, Math.round(y) * cell, Math.round(w) * cell, Math.round(h) * cell);
}

/** A block carrying the 1-pixel top/left bevel 8-bit sprites always had. */
function bevelled(
  context: CanvasRenderingContext2D,
  cell: number,
  x: number,
  y: number,
  color: string,
  highlight: string,
): void {
  block(context, cell, x, y, 1, 1, color);
  context.fillStyle = highlight;
  context.fillRect(x * cell, y * cell, cell, 1);
  context.fillRect(x * cell, y * cell, 1, cell);
}

/**
 * `data-*` attributes for a cabinet element. Every one of them is a documented
 * hook: a screen reader, a curious player and the check scripts all read the
 * same published state.
 */
function dataProps(values: Readonly<Record<string, string | number | undefined>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) out[`data-${key}`] = String(value);
  }
  return out;
}

/**
 * Integer-scaled pixel screen: the canvas bitmap is a small logical grid and
 * the CSS box is an exact whole-number multiple of it, so every block lands on
 * a hard edge with no interpolation.
 */
function ArcadeScreen(props: {
  width: number;
  height: number;
  draw: (context: CanvasRenderingContext2D) => void;
  label: string;
  data: Readonly<Record<string, string | number | undefined>>;
}): ReactElement {
  const { width, height, draw, label, data } = props;
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [scale, setScale] = useState(3);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = (): void => {
      const box = stage.getBoundingClientRect();
      if (box.width < 8 || box.height < 8) return;
      const next = Math.max(1, Math.floor(Math.min(box.width / width, box.height / height)));
      setScale((previous) => (previous === next ? previous : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => {
      observer.disconnect();
    };
  }, [width, height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.imageSmoothingEnabled = false;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    drawRef.current(context);
  });

  return (
    <div className="ip-arc-stage" ref={stageRef}>
      <div className="ip-arc-screen" style={{ width: width * scale, height: height * scale }}>
        <canvas
          ref={canvasRef}
          className="ip-arc-canvas"
          width={width}
          height={height}
          role="img"
          aria-label={label}
          data-scale={scale}
          {...dataProps(data)}
        />
      </div>
    </div>
  );
}

/** One cabinet button: pointerdown fires instantly, a held button repeats. */
function PadKey(props: Readonly<{
  label: string;
  hint: string;
  run: () => void;
  repeatMs?: number;
  primary?: boolean;
  disabled?: boolean;
}>): ReactElement {
  const { label, hint, run, repeatMs, primary, disabled } = props;
  const timer = useRef<number | null>(null);

  const stop = useCallback((): void => {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => stop, [stop]);

  return (
    <button
      type="button"
      className="ip-arc-btn"
      data-primary={primary === true}
      disabled={disabled === true}
      aria-label={hint}
      onPointerDown={(event) => {
        if (disabled === true) return;
        run();
        // A tapped pad must not keep focus, or SPACE would re-fire it instead
        // of reaching the game's own action.
        const node = event.currentTarget;
        window.setTimeout(() => {
          if (document.activeElement === node) node.blur();
        }, 0);
        if (repeatMs !== undefined) {
          stop();
          timer.current = window.setInterval(run, repeatMs);
        }
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onClick={(event) => {
        // detail 0 is a keyboard/screen-reader activation, which never fires
        // pointerdown.
        if (event.detail === 0) run();
      }}
    >
      {label}
    </button>
  );
}

/** A row of cabinet buttons. */
function ArcadePad(props: { buttons: readonly ReactNode[]; columns?: number }): ReactElement {
  const { buttons, columns } = props;
  return (
    <div className="ip-arc-pad" style={{ gridTemplateColumns: `repeat(${columns ?? buttons.length}, minmax(0, 1fr))` }}>
      {buttons}
    </div>
  );
}

/** Corner D-pad used by the snake course. */
function ArcadeDpad(props: Readonly<{
  onUp: () => void;
  onDown: () => void;
  onLeft: () => void;
  onRight: () => void;
}>): ReactElement {
  const { onUp, onDown, onLeft, onRight } = props;
  return (
    <div className="ip-arc-dpad">
      <span className="ip-arc-dpad-gap" />
      <PadKey label="▲" hint="Steer up" run={onUp} />
      <span className="ip-arc-dpad-gap" />
      <PadKey label="◀" hint="Steer left" run={onLeft} />
      <PadKey label="▼" hint="Steer down" run={onDown} />
      <PadKey label="▶" hint="Steer right" run={onRight} />
    </div>
  );
}

/** The shared cabinet chrome: marquee, HUD strip, screen, controls, status. */
function Cabinet(props: {
  title: string;
  tag: string;
  hud: readonly Readonly<{ label: string; value: string }>[];
  status: string;
  alert?: boolean;
  children: ReactNode;
}): ReactElement {
  const { title, tag, hud, status, alert, children } = props;
  return (
    <div className="ip-arc">
      <div className="ip-arc-marquee">
        <span className="ip-arc-title">{title}</span>
        <span className="ip-arc-tag">{tag}</span>
      </div>
      <div className="ip-arc-hud">
        {hud.map((item) => (
          <span key={item.label} className="ip-arc-hud-item">
            <span className="ip-arc-hud-label">{item.label}</span>
            <span className="ip-arc-hud-value">{item.value}</span>
          </span>
        ))}
      </div>
      {children}
      <p className="ip-arc-status" data-alert={alert === true} role="status">
        {status}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 1. calibrate — BREAKOUT                                            *
 * ------------------------------------------------------------------ */

const BO_CELL = 6;
const BO_COLS = 12;
const BO_ROWS = 14;
const BO_PADDLE_ROW = BO_ROWS - 1;
const BO_BRICK_ROWS = 2;
const BO_BRICK_LEFT = 2;
const BO_BRICK_RIGHT = 10;
const BO_PADDLE_WIDTH = 3;
const BO_BALL_MS = 52;
const BO_PADDLE_MS = 38;
const BO_LIVES = 2;

const BO_W = BO_COLS * BO_CELL;
const BO_H = BO_ROWS * BO_CELL;

type BreakoutWorld = {
  paddle: number;
  ballC: number;
  ballR: number;
  dc: number;
  dr: number;
  bricks: boolean[][];
  left: number;
  lives: number;
  phase: "ready" | "live" | "won" | "lost";
  countdown: number;
};

function createBreakout(seed: number): BreakoutWorld {
  const rng = seededRng(seed, 0x1b7e);
  const bricks: boolean[][] = [];
  for (let row = 0; row < BO_ROWS; row++) bricks.push(new Array<boolean>(BO_COLS).fill(false));
  for (let row = 1; row <= BO_BRICK_ROWS; row++) {
    for (let col = BO_BRICK_LEFT; col < BO_BRICK_RIGHT; col++) bricks[row][col] = true;
  }
  const paddle = Math.floor((BO_COLS - BO_PADDLE_WIDTH) / 2);
  return {
    paddle,
    ballC: paddle + 1,
    ballR: BO_PADDLE_ROW - 1,
    dc: rng.chance(0.5) ? 1 : -1,
    dr: -1,
    bricks,
    left: (BO_BRICK_RIGHT - BO_BRICK_LEFT) * BO_BRICK_ROWS,
    lives: BO_LIVES,
    phase: "ready",
    countdown: 12,
  };
}

function BreakoutGame({ attempt, onDone }: {
  attempt: TaskAttempt;
  onDone: (success: boolean) => void;
}): ReactElement {
  const { finished, finish } = useFinish(onDone);
  const worldRef = useRef<BreakoutWorld>(createBreakout(attempt.seed));
  const [, setVersion] = useState(0);
  const bump = useCallback((): void => {
    setVersion((value) => value + 1);
  }, []);

  const reset = useCallback((world: BreakoutWorld): void => {
    world.ballC = world.paddle + 1;
    world.ballR = BO_PADDLE_ROW - 1;
    world.dr = -1;
  }, []);

  const launch = useCallback((): void => {
    const world = worldRef.current;
    if (finished.current || world.phase !== "ready") return;
    world.phase = "live";
    reset(world);
    bump();
  }, [bump, finished, reset]);

  const nudge = useCallback((delta: number): void => {
    const world = worldRef.current;
    if (world.phase === "won" || world.phase === "lost") return;
    const limit = BO_COLS - BO_PADDLE_WIDTH;
    world.paddle = Math.min(limit, Math.max(0, world.paddle + delta));
    if (world.phase === "ready") reset(world);
    bump();
  }, [bump, reset]);

  const held = useKeys(true, (key) => {
    if (key === "Space" || key === "Enter") launch();
  });

  useTicker(true, BO_PADDLE_MS, () => {
    const world = worldRef.current;
    if (world.phase === "won" || world.phase === "lost") return;
    const left = held.current.has("ArrowLeft") || held.current.has("a");
    const right = held.current.has("ArrowRight") || held.current.has("d");
    if (left === right) return;
    nudge(right ? 1 : -1);
  });

  useTicker(true, BO_BALL_MS, () => {
    const world = worldRef.current;
    if (world.phase === "won" || world.phase === "lost") return;
    if (world.phase === "ready") {
      world.countdown -= 1;
      if (world.countdown <= 0) launch();
      else bump();
      return;
    }
    let column = world.ballC + world.dc;
    let row = world.ballR + world.dr;
    if (column < 0) {
      column = 0;
      world.dc = 1;
    } else if (column >= BO_COLS) {
      column = BO_COLS - 1;
      world.dc = -1;
    }
    if (row < 0) {
      row = 0;
      world.dr = 1;
    }
    if (world.dr > 0 && row === BO_PADDLE_ROW) {
      const onPaddle = column >= world.paddle && column < world.paddle + BO_PADDLE_WIDTH;
      if (!onPaddle) {
        world.lives -= 1;
        if (world.lives <= 0) {
          world.phase = "lost";
          bump();
          finish(false);
          return;
        }
        world.phase = "ready";
        world.countdown = 8;
        reset(world);
        bump();
        return;
      }
      row = BO_PADDLE_ROW - 1;
      world.dr = -1;
      const offset = column - (world.paddle + 1);
      if (offset !== 0) world.dc = offset > 0 ? 1 : -1;
    }
    if (row <= BO_BRICK_ROWS && world.bricks[row][column]) {
      world.bricks[row][column] = false;
      world.left -= 1;
      world.dr = -world.dr;
    }
    world.ballC = column;
    world.ballR = row;
    if (world.left <= 0) {
      world.phase = "won";
      bump();
      finish(true);
      return;
    }
    bump();
  });

  const world = worldRef.current;

  const draw = (context: CanvasRenderingContext2D): void => {
    const state = worldRef.current;
    block(context, BO_CELL, 0, 0, BO_COLS, BO_ROWS, ARC.screen);
    for (let row = 1; row <= BO_BRICK_ROWS; row++) {
      for (let col = 0; col < BO_COLS; col++) {
        if (!state.bricks[row][col]) continue;
        bevelled(context, BO_CELL, col, row, row === 1 ? ARC.violet : ARC.cyan, ARC.ink);
      }
    }
    for (let cell = 0; cell < BO_PADDLE_WIDTH; cell++) {
      block(context, BO_CELL, state.paddle + cell, BO_PADDLE_ROW, 1, 1, cell === 1 ? ARC.lime : ARC.amber);
    }
    const pulse = Math.floor(Date.now() / 220) % 2 === 0;
    const ballColour = state.phase === "lost" ? ARC.red : state.phase === "ready" && !pulse ? ARC.steel : ARC.ink;
    block(context, BO_CELL, state.ballC, state.ballR, 1, 1, ballColour);
  };

  return (
    <Cabinet
      title="COOLANT BREAKOUT"
      tag="REACTOR"
      hud={[
        { label: "CELLS", value: `${world.left}` },
        { label: "PULSES", value: world.lives > 0 ? "♥".repeat(world.lives) : "—" },
      ]}
      status={
        world.phase === "lost"
          ? "Coolant pulse lost."
          : world.phase === "won"
            ? "Wall cleared."
            : world.phase === "ready"
              ? `Launch in ${Math.max(1, world.countdown)} — SPACE or LAUNCH`
              : `Smash the wall · ${world.left} cells left`
      }
      alert={world.phase === "lost"}
    >
      <ArcadeScreen
        width={BO_W}
        height={BO_H}
        label="Coolant breakout playfield"
        draw={draw}
        data={{
          phase: world.phase,
          ball: `${world.ballC},${world.ballR}`,
          dir: `${world.dc},${world.dr}`,
          paddle: world.paddle,
          left: world.left,
          lives: world.lives,
        }}
      />
      <ArcadePad
        buttons={[
          <PadKey key="bo-left" label="◀" hint="Move the paddle left" run={() => nudge(-1)} repeatMs={80} />,
          <PadKey key="bo-launch" label="LAUNCH" hint="Launch the coolant pulse" run={launch} primary disabled={world.phase !== "ready"} />,
          <PadKey key="bo-right" label="▶" hint="Move the paddle right" run={() => nudge(1)} repeatMs={80} />,
        ]}
      />
    </Cabinet>
  );
}

/* ------------------------------------------------------------------ *
 * 2. dials — SNAKE                                                   *
 * ------------------------------------------------------------------ */

const SN_CELL = 5;
const SN_FIELD = 14;
const SN_SIZE = SN_FIELD + 2;
const SN_TICK_MS = 130;
const SN_POINTS = 6;
const SN_START = 3;

const SN_W = SN_SIZE * SN_CELL;
const SN_H = SN_SIZE * SN_CELL;

type GridCell = { x: number; y: number };

type SnakeWorld = {
  body: GridCell[];
  dir: GridCell;
  next: GridCell;
  food: GridCell[];
  eaten: number;
  phase: "run" | "won" | "lost";
};

function createSnake(seed: number): SnakeWorld {
  const rng = seededRng(seed, 0x5c1a);
  const centre = Math.floor(SN_FIELD / 2);
  const body: GridCell[] = [];
  for (let index = 0; index < SN_START; index++) body.push({ x: centre - index, y: centre });
  const taken = new Set(body.map((cell) => `${cell.x},${cell.y}`));
  const food: GridCell[] = [];
  let guard = 0;
  while (food.length < SN_POINTS && guard < 600) {
    guard += 1;
    const gap = guard < 220 ? 3 : guard < 420 ? 2 : 0;
    const x = 1 + rng.int(SN_FIELD - 2);
    const y = 1 + rng.int(SN_FIELD - 2);
    const key = `${x},${y}`;
    if (taken.has(key)) continue;
    if (food.some((cell) => Math.abs(cell.x - x) + Math.abs(cell.y - y) < gap)) continue;
    taken.add(key);
    food.push({ x, y });
  }
  return { body, dir: { x: 1, y: 0 }, next: { x: 1, y: 0 }, food, eaten: 0, phase: "run" };
}

function SnakeGame({ attempt, onDone }: {
  attempt: TaskAttempt;
  onDone: (success: boolean) => void;
}): ReactElement {
  const { finished, finish } = useFinish(onDone);
  const worldRef = useRef<SnakeWorld>(createSnake(attempt.seed));
  const [, setVersion] = useState(0);
  const bump = useCallback((): void => {
    setVersion((value) => value + 1);
  }, []);

  const turn = useCallback((dx: number, dy: number): void => {
    const world = worldRef.current;
    if (world.phase !== "run") return;
    if (dx === -world.dir.x && dy === -world.dir.y) return;
    world.next = { x: dx, y: dy };
  }, []);

  useKeys(true, (key) => {
    if (key === "ArrowLeft" || key === "a") turn(-1, 0);
    else if (key === "ArrowRight" || key === "d") turn(1, 0);
    else if (key === "ArrowUp" || key === "w") turn(0, -1);
    else if (key === "ArrowDown" || key === "s") turn(0, 1);
  });

  useTicker(true, SN_TICK_MS, () => {
    const world = worldRef.current;
    if (world.phase !== "run") return;
    world.dir = world.next;
    const head = { x: world.body[0].x + world.dir.x, y: world.body[0].y + world.dir.y };
    if (head.x < 0 || head.y < 0 || head.x >= SN_FIELD || head.y >= SN_FIELD) {
      world.phase = "lost";
      bump();
      finish(false);
      return;
    }
    const target = world.food[world.eaten];
    const eating = target !== undefined && head.x === target.x && head.y === target.y;
    // Unless it is growing, the tail vacates on this very tick, so following it
    // is legal.
    const segments = eating ? world.body.length : world.body.length - 1;
    for (let index = 0; index < segments; index++) {
      if (world.body[index].x === head.x && world.body[index].y === head.y) {
        world.phase = "lost";
        bump();
        finish(false);
        return;
      }
    }
    world.body.unshift(head);
    if (eating) {
      world.eaten += 1;
      if (world.eaten >= world.food.length) {
        world.phase = "won";
        bump();
        finish(true);
        return;
      }
    } else {
      world.body.pop();
    }
    bump();
  });

  const world = worldRef.current;
  const target = world.food[world.eaten];

  const draw = (context: CanvasRenderingContext2D): void => {
    const state = worldRef.current;
    block(context, SN_CELL, 0, 0, SN_SIZE, SN_SIZE, ARC.steel);
    block(context, SN_CELL, 1, 1, SN_FIELD, SN_FIELD, ARC.screen);
    const pulse = Math.floor(Date.now() / 260) % 2 === 0;
    state.food.forEach((cell, index) => {
      const colour = index < state.eaten ? ARC.steel
        : index === state.eaten ? (pulse ? ARC.amber : ARC.lime)
          : ARC.cyan;
      block(context, SN_CELL, cell.x + 1, cell.y + 1, 1, 1, colour);
    });
    for (let index = state.body.length - 1; index >= 0; index--) {
      const cell = state.body[index];
      const colour = state.phase === "lost" ? ARC.red : index === 0 ? ARC.ink : ARC.lime;
      block(context, SN_CELL, cell.x + 1, cell.y + 1, 1, 1, colour);
    }
  };

  return (
    <Cabinet
      title="NAV VECTOR SNAKE"
      tag="NAVIGATION"
      hud={[
        { label: "WAYPOINT", value: `${Math.min(world.eaten + 1, SN_POINTS)}/${SN_POINTS}` },
        { label: "TRACK", value: `${world.body.length}` },
      ]}
      status={
        world.phase === "lost"
          ? "Hull breached — track lost."
          : world.phase === "won"
            ? "Course complete."
            : target
              ? `Next waypoint at column ${target.x + 1}, row ${target.y + 1}`
              : "Course complete."
      }
      alert={world.phase === "lost"}
    >
      <ArcadeScreen
        width={SN_W}
        height={SN_H}
        label="Navigation snake course"
        draw={draw}
        data={{
          phase: world.phase,
          head: `${world.body[0].x},${world.body[0].y}`,
          body: world.body.map((cell) => `${cell.x},${cell.y}`).join(";"),
          food: target ? `${target.x},${target.y}` : "",
          eaten: world.eaten,
          len: world.body.length,
        }}
      />
      <ArcadeDpad
        onUp={() => turn(0, -1)}
        onDown={() => turn(0, 1)}
        onLeft={() => turn(-1, 0)}
        onRight={() => turn(1, 0)}
      />
    </Cabinet>
  );
}

/* ------------------------------------------------------------------ *
 * 3. reboot — MEMORY (growing signal sequence)                       *
 * ------------------------------------------------------------------ */

const MEM_PADS = 4;
const MEM_LENGTHS = [3, 4, 5] as const;
const MEM_LIT_MS = 430;
const MEM_GAP_MS = 190;
const MEM_PAUSE_MS = 320;
const MEM_ATTEMPTS = 3;
const MEM_LABELS = ["A", "B", "C", "D"] as const;

function MemoryGame({ attempt, onDone }: {
  attempt: TaskAttempt;
  onDone: (success: boolean) => void;
}): ReactElement {
  const { finished, finish } = useFinish(onDone);
  const sequence = useMemo(() => {
    const rng = seededRng(attempt.seed, 0x2e77);
    const picks: number[] = [];
    for (let index = 0; index < MEM_LENGTHS[MEM_LENGTHS.length - 1]; index++) picks.push(rng.int(MEM_PADS));
    return picks;
  }, [attempt.seed]);

  const [mode, setMode] = useState<"watch" | "input" | "won" | "lost">("watch");
  const [round, setRound] = useState(0);
  const [lit, setLit] = useState(-1);
  const [progress, setProgress] = useState(0);
  const [attempts, setAttempts] = useState(MEM_ATTEMPTS);
  const [playback, setPlayback] = useState(0);
  const [flash, pushFlash] = useFlash(1500);
  const gate = useRef(createGate(60));

  const length = MEM_LENGTHS[Math.min(round, MEM_LENGTHS.length - 1)];

  useEffect(() => {
    if (mode !== "watch") return;
    let cancelled = false;
    const timers: number[] = [];
    const run = (index: number): void => {
      if (cancelled) return;
      if (index >= length) {
        setLit(-1);
        timers.push(window.setTimeout(() => {
          if (cancelled) return;
          setProgress(0);
          setMode("input");
        }, MEM_PAUSE_MS));
        return;
      }
      setLit(sequence[index]);
      timers.push(window.setTimeout(() => {
        if (cancelled) return;
        setLit(-1);
        timers.push(window.setTimeout(() => run(index + 1), MEM_GAP_MS));
      }, MEM_LIT_MS));
    };
    run(0);
    return () => {
      cancelled = true;
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [mode, round, length, sequence, playback]);

  const press = useCallback((pad: number): void => {
    if (finished.current || mode !== "input" || !gate.current()) return;
    if (sequence[progress] !== pad) {
      const left = attempts - 1;
      setAttempts(left);
      if (left <= 0) {
        setMode("lost");
        finish(false);
        return;
      }
      pushFlash(`Wrong pad — ${left} attempt${left === 1 ? "" : "s"} left.`);
      setLit(-1);
      setProgress(0);
      setMode("watch");
      setPlayback((value) => value + 1);
      return;
    }
    const next = progress + 1;
    if (next < length) {
      setProgress(next);
      return;
    }
    const nextRound = round + 1;
    if (nextRound >= MEM_LENGTHS.length) {
      setProgress(next);
      setMode("won");
      finish(true);
      return;
    }
    setProgress(0);
    setRound(nextRound);
    setMode("watch");
    setPlayback((value) => value + 1);
  }, [attempts, finish, finished, gate, length, mode, progress, pushFlash, round, sequence]);

  useKeys(mode === "input", (key) => {
    const index = "1234".indexOf(key);
    if (index >= 0) press(index);
  });

  const status =
    mode === "lost"
      ? "Signal lost."
      : mode === "won"
        ? "Array rebooted."
        : mode === "watch"
          ? `Watch the sequence — ${length} pads`
          : `Repeat it · step ${Math.min(progress + 1, length)} of ${length}`;

  return (
    <Cabinet
      title="SIGNAL MEMORY"
      tag="COMMS"
      hud={[
        { label: "ROUND", value: `${Math.min(round + 1, MEM_LENGTHS.length)}/${MEM_LENGTHS.length}` },
        { label: "ATTEMPTS", value: `${Math.max(0, attempts)}` },
      ]}
      status={flash !== "" ? flash : status}
      alert={flash !== "" || mode === "lost"}
    >
      <div
        className="ip-arc-mempad"
        data-phase={mode}
        data-lit={lit >= 0 ? lit : ""}
        data-round={round + 1}
        data-length={length}
        data-progress={progress}
        data-attempts={attempts}
      >
        {MEM_LABELS.map((label, index) => (
          <button
            key={label}
            type="button"
            className="ip-arc-mempad-key"
            data-lit={lit === index}
            data-taken={mode === "input" && index < progress}
            aria-label={`Signal pad ${label}${lit === index ? ", lit" : ""}`}
            onClick={() => press(index)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="ip-arc-note">Keys 1-4 repeat a pad, or tap the pad. A wrong pad costs an attempt.</p>
    </Cabinet>
  );
}

/* ------------------------------------------------------------------ *
 * 4. sample — MINESWEEPER                                            *
 * ------------------------------------------------------------------ */

const MS_COLS = 6;
const MS_ROWS = 6;
const MS_MINES = 5;
const MS_TOTAL = MS_COLS * MS_ROWS;
const MS_CLEAN = MS_TOTAL - MS_MINES;
const MS_FIRST = 2 * MS_COLS + 2; // the console's pre-scan cell, never mined

const MS_RING: readonly (readonly number[])[] = Array.from({ length: MS_TOTAL }, (_, index) => {
  const row = Math.floor(index / MS_COLS);
  const column = index % MS_COLS;
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const y = row + dy;
      const x = column + dx;
      if (y < 0 || x < 0 || y >= MS_ROWS || x >= MS_COLS) continue;
      out.push(y * MS_COLS + x);
    }
  }
  return out;
});

/** Repeat-safe flood: an empty cell opens itself and every neighbour. */
function msFlood(mines: readonly boolean[], counts: readonly number[], from: number): Set<number> {
  const open = new Set<number>();
  const queue: number[] = [from];
  while (queue.length) {
    const index = queue.shift() as number;
    if (open.has(index) || mines[index]) continue;
    open.add(index);
    if (counts[index] === 0) {
      for (const next of MS_RING[index]) if (!open.has(next)) queue.push(next);
    }
  }
  return open;
}

/**
 * Deduction from what is on screen only: a marked-up ring means the rest of the
 * ring is clean, a ring that accounts for its whole count means the rest is
 * contaminated. The generator runs exactly these rules, so a board only ships
 * when a player who never guesses can finish it — and the check script can
 * prove the same thing from the rendered cells.
 */
function msDeduce(
  counts: ReadonlyMap<number, number>,
  open: ReadonlySet<number>,
  flags: ReadonlySet<number>,
): { safe: number[]; mines: number[] } {
  const safe: number[] = [];
  const mines: number[] = [];
  for (const [index, count] of counts) {
    if (!open.has(index)) continue;
    const hidden = MS_RING[index].filter((cell) => !open.has(cell) && !flags.has(cell));
    if (hidden.length === 0) continue;
    const marked = MS_RING[index].filter((cell) => flags.has(cell)).length;
    if (marked >= count) safe.push(...hidden);
    else if (hidden.length + marked === count) mines.push(...hidden);
  }
  return { safe, mines };
}

type Minefield = Readonly<{
  mines: readonly boolean[];
  counts: readonly number[];
  first: number;
  solvable: boolean;
}>;

function msCounts(mines: readonly boolean[]): number[] {
  return Array.from({ length: MS_TOTAL }, (_, index) => MS_RING[index].filter((cell) => mines[cell]).length);
}

function buildMinefield(seed: number): Minefield {
  const rng = seededRng(seed, 0x3d17);
  for (let roll = 0; roll < 64; roll++) {
    const pool: number[] = [];
    for (let index = 0; index < MS_TOTAL; index++) if (index !== MS_FIRST) pool.push(index);
    for (let index = pool.length - 1; index > 0; index--) {
      const swap = rng.int(index + 1);
      const held = pool[index];
      pool[index] = pool[swap];
      pool[swap] = held;
    }
    const mines = new Array<boolean>(MS_TOTAL).fill(false);
    for (let index = 0; index < MS_MINES; index++) mines[pool[index]] = true;
    const counts = msCounts(mines);
    // Simulate a player who only ever acts on a certainty, starting from the
    // console's pre-scan.
    const open = msFlood(mines, counts, MS_FIRST);
    const flags = new Set<number>();
    let grew = true;
    while (grew) {
      grew = false;
      const known = new Map<number, number>();
      for (const index of open) known.set(index, counts[index]);
      const { safe, mines: found } = msDeduce(known, open, flags);
      for (const cell of safe) {
        if (open.has(cell)) continue;
        for (const revealed of msFlood(mines, counts, cell)) {
          if (!open.has(revealed)) {
            open.add(revealed);
            grew = true;
          }
        }
      }
      for (const cell of found) {
        if (!flags.has(cell)) {
          flags.add(cell);
          grew = true;
        }
      }
    }
    if (open.size >= MS_CLEAN) return { mines, counts, first: MS_FIRST, solvable: true };
  }
  // Practically unreachable: ship a plain board rather than throwing.
  const mines = new Array<boolean>(MS_TOTAL).fill(false);
  let placed = 0;
  for (let index = 0; index < MS_TOTAL && placed < MS_MINES; index += 7) {
    if (index === MS_FIRST) continue;
    mines[index] = true;
    placed += 1;
  }
  return { mines, counts: msCounts(mines), first: MS_FIRST, solvable: false };
}

function MinesweeperGame({ attempt, onDone }: {
  attempt: TaskAttempt;
  onDone: (success: boolean) => void;
}): ReactElement {
  const { finished, finish } = useFinish(onDone);
  const field = useMemo(() => buildMinefield(attempt.seed), [attempt.seed]);
  const [flash, pushFlash] = useFlash(1500);
  const gate = useRef(createGate(50));
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const uiRef = useRef({
    open: msFlood(field.mines, field.counts, field.first) as ReadonlySet<number>,
    flags: new Set<number>() as ReadonlySet<number>,
    cursor: field.first,
    flagMode: false,
    boom: -1,
  });
  const [, setVersion] = useState(0);
  const bump = useCallback((): void => {
    setVersion((value) => value + 1);
  }, []);

  const flag = useCallback((index: number): void => {
    const ui = uiRef.current;
    if (finished.current || ui.open.has(index)) return;
    const next = new Set(ui.flags);
    if (next.has(index)) next.delete(index);
    else {
      if (next.size >= MS_MINES) {
        pushFlash("All five markers are already flagged.");
        return;
      }
      next.add(index);
    }
    ui.flags = next;
    bump();
  }, [bump, finished, pushFlash]);

  const reveal = useCallback((index: number): void => {
    const ui = uiRef.current;
    if (finished.current || !gate.current() || ui.open.has(index) || ui.flags.has(index)) return;
    if (field.mines[index]) {
      ui.boom = index;
      bump();
      finish(false);
      return;
    }
    const opened = msFlood(field.mines, field.counts, index);
    const next = new Set(ui.open);
    for (const cell of opened) next.add(cell);
    ui.open = next;
    if (next.size >= MS_CLEAN) {
      const marked = new Set<number>();
      field.mines.forEach((mine, cell) => {
        if (mine) marked.add(cell);
      });
      ui.flags = marked;
      bump();
      finish(true);
      return;
    }
    bump();
  }, [bump, field, finish, finished, gate]);

  const activate = useCallback((index: number): void => {
    if (uiRef.current.flagMode) flag(index);
    else reveal(index);
  }, [flag, reveal]);

  const moveTo = useCallback((index: number): void => {
    uiRef.current.cursor = index;
    cellRefs.current[index]?.focus();
    bump();
  }, [bump]);

  const move = useCallback((dx: number, dy: number): void => {
    const cursor = uiRef.current.cursor;
    const row = Math.floor(cursor / MS_COLS);
    const column = cursor % MS_COLS;
    moveTo(wrap(row + dy, MS_ROWS) * MS_COLS + wrap(column + dx, MS_COLS));
  }, [moveTo]);

  const focused = (): number => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return -1;
    const raw = element.dataset.cell;
    if (raw === undefined) return -1;
    const index = Number.parseInt(raw, 10);
    return Number.isNaN(index) ? -1 : index;
  };

  useKeys(!finished.current, (key) => {
    if (key === "f") {
      uiRef.current.flagMode = !uiRef.current.flagMode;
      bump();
      return;
    }
    const from = focused();
    const base = from >= 0 ? from : uiRef.current.cursor;
    if (from >= 0 && from !== uiRef.current.cursor) uiRef.current.cursor = from;
    const row = Math.floor(base / MS_COLS);
    const column = base % MS_COLS;
    if (key === "ArrowLeft" || key === "a") move(-1, 0);
    else if (key === "ArrowRight" || key === "d") move(1, 0);
    else if (key === "ArrowUp" || key === "w") move(0, -1);
    else if (key === "ArrowDown" || key === "s") move(0, 1);
    else if (key === "Space" || key === "Enter") activate(base);
    else if (row < 0 || column < 0) bump();
  });

  const ui = uiRef.current;
  const clean = ui.open.size;

  return (
    <Cabinet
      title="CONTAMINANT SWEEP"
      tag="MEDBAY"
      hud={[
        { label: "CLEAN", value: `${clean}/${MS_CLEAN}` },
        { label: "FLAGS", value: `${ui.flags.size}/${MS_MINES}` },
        { label: "MODE", value: ui.flagMode ? "FLAG" : "DIG" },
      ]}
      status={
        flash !== ""
          ? flash
          : ui.boom >= 0
            ? "Contaminated cell opened."
            : ui.flagMode
              ? "FLAG armed — tap a cell to mark it contaminated"
              : "DIG armed — arrows aim, SPACE opens, F flags, right-click flags"
      }
      alert={flash !== "" || ui.boom >= 0}
    >
      <div
        className="ip-arc-minegrid"
        data-phase={ui.boom >= 0 ? "boom" : finished.current ? "done" : "dig"}
        data-cursor={`${Math.floor(ui.cursor / MS_COLS)},${ui.cursor % MS_COLS}`}
        data-clean={clean}
        data-flags={ui.flags.size}
        data-mines={MS_MINES}
      >
        {Array.from({ length: MS_TOTAL }, (_, index) => {
          const isOpen = ui.open.has(index);
          const isFlag = ui.flags.has(index);
          const count = field.counts[index];
          const state = ui.boom === index ? "boom" : isOpen ? "open" : isFlag ? "flag" : "hidden";
          return (
            <button
              key={`cell-${index}`}
              type="button"
              ref={(element) => {
                cellRefs.current[index] = element;
              }}
              className="ip-arc-cell"
              data-cell={index}
              data-state={state}
              data-count={isOpen ? count : undefined}
              data-cursor={ui.cursor === index}
              data-tone={isOpen && count > 0 ? (count === 1 ? "one" : count === 2 ? "two" : "three") : undefined}
              aria-label={
                state === "boom" ? `Cell ${index + 1}, contaminated`
                  : isOpen ? `Cell ${index + 1}, clean, ${count} adjacent markers`
                    : isFlag ? `Cell ${index + 1}, flagged contaminated`
                      : `Cell ${index + 1}, hidden`
              }
              onClick={() => {
                uiRef.current.cursor = index;
                activate(index);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                flag(index);
              }}
            >
              {isOpen ? (count === 0 ? "" : String(count)) : isFlag ? "⚑" : ""}
            </button>
          );
        })}
      </div>
      <ArcadePad
        columns={5}
        buttons={[
          <PadKey key="ms-left" label="◀" hint="Aim left" run={() => move(-1, 0)} repeatMs={150} />,
          <PadKey key="ms-up" label="▲" hint="Aim up" run={() => move(0, -1)} repeatMs={150} />,
          <PadKey key="ms-down" label="▼" hint="Aim down" run={() => move(0, 1)} repeatMs={150} />,
          <PadKey key="ms-right" label="▶" hint="Aim right" run={() => move(1, 0)} repeatMs={150} />,
          <PadKey key="ms-dig" label="DIG" hint="Open the aimed cell" run={() => activate(uiRef.current.cursor)} primary />,
          <PadKey
            key="ms-flag"
            label={ui.flagMode ? "FLAG ON" : "FLAG"}
            hint="Arm or disarm flag mode"
            run={() => {
              uiRef.current.flagMode = !uiRef.current.flagMode;
              bump();
            }}
            primary={ui.flagMode}
          />,
        ]}
      />
      <p className="ip-arc-note">
        {field.solvable
          ? "Sensor pre-scanned the origin cell — the rest can be deduced, never guessed."
          : "Manual sensor sweep."}
      </p>
    </Cabinet>
  );
}

/* ------------------------------------------------------------------ *
 * 5. wiring — the existing route puzzle, pixel restyle               *
 * ------------------------------------------------------------------ */

const WIRE_NODES = [
  { id: "red", label: "RED", color: "#ff4d4d" },
  { id: "cyan", label: "CYA", color: "#38fedc" },
  { id: "amber", label: "AMB", color: "#f5f557" },
  { id: "violet", label: "VIO", color: "#b06bff" },
] as const;

/**
 * Row geometry of .ip-wire-grid in tasks.css (48 px rows, 10 px gaps, no
 * padding). Keep the two in step: the wire layer maps these pixels onto a
 * 0..100 viewBox.
 */
const WIRE_ROW_PITCH = 58;
const WIRE_ROW_OFFSET = 24;
const WIRE_BOARD_HEIGHT = 222;

function wireRowY(row: number): number {
  return ((row * WIRE_ROW_PITCH + WIRE_ROW_OFFSET) / WIRE_BOARD_HEIGHT) * 100;
}

function wirePath(leftRow: number, rightRow: number): string {
  const top = wireRowY(leftRow);
  const bottom = wireRowY(rightRow);
  if (leftRow === rightRow) return `M48.5 ${top} L51.5 ${bottom}`;
  return `M48.5 ${top} L50 ${top} L50 ${bottom} L51.5 ${bottom}`;
}

type WireLink = Readonly<{ left: number; right: number }>;

function WiringGame({ attempt, onDone, onHint }: {
  attempt: TaskAttempt;
  onDone: (success: boolean) => void;
  onHint: (text: string) => void;
}): ReactElement {
  const { finished, finish } = useFinish(onDone);
  const gate = useRef(createGate(60));
  const rows = useMemo(() => {
    const rng = seededRng(attempt.seed, 0x71c1);
    const order = [0, 1, 2, 3];
    for (let index = order.length - 1; index > 0; index--) {
      const swap = rng.int(index + 1);
      const held = order[index];
      order[index] = order[swap];
      order[swap] = held;
    }
    // A permutation that maps every node onto itself would be a free puzzle.
    if (order.every((value, index) => value === index)) {
      order[0] = 1;
      order[1] = 0;
    }
    return order;
  }, [attempt.seed]);

  const [picked, setPicked] = useState<number | null>(null);
  const [links, setLinks] = useState<readonly WireLink[]>([]);
  const nodeRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const pickLeft = (index: number): void => {
    if (finished.current || !gate.current()) return;
    setPicked((current) => (current === index ? null : index));
  };

  const pickRight = (columnIndex: number): void => {
    if (finished.current || !gate.current()) return;
    if (picked === null) {
      onHint("Select a left node first.");
      return;
    }
    if (rows[columnIndex] !== picked) {
      finish(false);
      return;
    }
    const next: readonly WireLink[] = [...links, { left: picked, right: columnIndex }];
    setLinks(next);
    setPicked(null);
    if (next.length === WIRE_NODES.length) finish(true);
  };

  useWindowKeys(true, (event) => {
    const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1
      : event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : 0;
    if (step === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const refs = nodeRefs.current;
    const found = refs.findIndex((element) => element === document.activeElement);
    const from = found < 0 ? 0 : found;
    const column = from < 4 ? 0 : 1;
    const row = from % 4;
    let next = from;
    if (event.key === "ArrowUp") next = column * 4 + wrap(row - 1, 4);
    else if (event.key === "ArrowDown") next = column * 4 + wrap(row + 1, 4);
    else if (event.key === "ArrowLeft") next = row;
    else next = 4 + row;
    refs[next]?.focus();
  });

  return (
    <Cabinet
      title="PATCH PANEL"
      tag="ELECTRICAL"
      hud={[{ label: "PAIRS", value: `${links.length}/${WIRE_NODES.length}` }]}
      status={picked === null ? "Tap a left node, then its twin colour on the right." : "Node armed — pick its twin colour."}
    >
      <div className="ip-wire">
        <div className="ip-wire-board">
          <svg
            className="ip-wire-lines"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
            shapeRendering="crispEdges"
          >
            {links.map((link) => (
              <path
                key={`${link.left}-${link.right}`}
                d={wirePath(link.left, link.right)}
                stroke={WIRE_NODES[link.left].color}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          <div className="ip-wire-grid">
            <div className="ip-wire-col">
              {WIRE_NODES.map((node, index) => (
                <button
                  key={`left-${node.id}`}
                  type="button"
                  ref={(element) => {
                    nodeRefs.current[index] = element;
                  }}
                  className="ip-wire-node"
                  data-side="left"
                  data-picked={picked === index}
                  data-linked={links.some((link) => link.left === index)}
                  aria-pressed={picked === index}
                  aria-label={`Left node ${index + 1}, ${node.label.toLowerCase()} wire${picked === index ? ", selected" : ""}`}
                  onClick={() => {
                    pickLeft(index);
                  }}
                >
                  <span className="ip-wire-swatch" style={{ background: node.color }} />
                  <span className="ip-wire-tag">{node.label}</span>
                </button>
              ))}
            </div>
            <div className="ip-wire-col">
              {rows.map((row, index) => {
                const node = WIRE_NODES[row];
                return (
                  <button
                    key={`right-${index}`}
                    type="button"
                    ref={(element) => {
                      nodeRefs.current[4 + index] = element;
                    }}
                    className="ip-wire-node"
                    data-side="right"
                    data-linked={links.some((link) => link.right === index)}
                    aria-label={`Right node ${index + 1}, ${node.label.toLowerCase()} wire`}
                    onClick={() => {
                      pickRight(index);
                    }}
                  >
                    <span className="ip-wire-swatch" style={{ background: node.color }} />
                    <span className="ip-wire-tag">{node.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <p className="ip-arc-note">
          {links.length}/{WIRE_NODES.length} pairs linked{picked === null ? "" : " · node armed"}
        </p>
      </div>
    </Cabinet>
  );
}

/* ------------------------------------------------------------------ *
 * 6. keypad — TETRIS-STYLE STACKER                                   *
 * ------------------------------------------------------------------ */

const TT_CELL = 6;
const TT_COLS = 8;
const TT_ROWS = 12;
const TT_BOX = 4; // every piece lives in a 4x4 box
const TT_GOAL = 2;
const TT_FALL_MS = 520;
const TT_SOFT_MS = 90;
const TT_MOVE_MS = 105;

const TT_W = (TT_COLS + 2) * TT_CELL;
const TT_H = (TT_ROWS + 2) * TT_CELL;

type PackedCell = readonly [number, number];

const TT_PIECES: Readonly<Record<string, readonly PackedCell[]>> = {
  O: [[1, 0], [2, 0], [1, 1], [2, 1]],
  I: [[0, 1], [1, 1], [2, 1], [3, 1]],
  L: [[0, 0], [0, 1], [0, 2], [1, 2]],
  J: [[1, 0], [1, 1], [1, 2], [0, 2]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],
  T: [[1, 0], [0, 1], [1, 1], [2, 1]],
};

const TT_KINDS = ["O", "I", "L", "J", "S", "T"] as const;

const TT_COLOURS: Readonly<Record<string, string>> = {
  O: "#f5f557",
  I: "#38fedc",
  L: "#b06bff",
  J: "#ff4d4d",
  S: "#ccff00",
  T: "#e8edf7",
};

function ttShape(kind: string): readonly PackedCell[] {
  return TT_PIECES[kind] ?? TT_PIECES.O;
}

function ttRotate(cells: readonly PackedCell[], turns: number): PackedCell[] {
  let out: PackedCell[] = cells.map((cell) => [cell[0], cell[1]] as PackedCell);
  const steps = wrap(turns, 4);
  for (let turn = 0; turn < steps; turn++) {
    out = out.map((cell) => [TT_BOX - 1 - cell[1], cell[0]] as PackedCell);
  }
  return out;
}

type TetrisWorld = {
  board: string[][];
  bag: string[];
  kind: string;
  next: string;
  rot: number;
  x: number;
  y: number;
  cleared: number;
  phase: "run" | "won" | "lost";
};

function ttRefill(world: TetrisWorld, rng: Rng): void {
  if (world.bag.length > 1) return;
  const bag = [...TT_KINDS];
  for (let index = bag.length - 1; index > 0; index--) {
    const swap = rng.int(index + 1);
    const held = bag[index];
    bag[index] = bag[swap];
    bag[swap] = held;
  }
  world.bag = [...bag, ...world.bag];
}

function ttSpawn(world: TetrisWorld, rng: Rng): void {
  ttRefill(world, rng);
  world.kind = world.bag.pop() ?? "O";
  ttRefill(world, rng);
  world.next = world.bag[world.bag.length - 1] ?? world.kind;
  world.rot = 0;
  world.x = 2;
  world.y = 0;
}

function ttCells(world: TetrisWorld, rot = world.rot, x = world.x, y = world.y): PackedCell[] {
  return ttRotate(ttShape(world.kind), rot).map((cell) => [cell[0] + x, cell[1] + y] as PackedCell);
}

function ttFits(world: TetrisWorld, cells: readonly PackedCell[]): boolean {
  return cells.every(([x, y]) =>
    x >= 0 && x < TT_COLS && y < TT_ROWS && (y < 0 || world.board[y][x] === ""));
}

function createTetris(seed: number): TetrisWorld {
  const board: string[][] = [];
  for (let row = 0; row < TT_ROWS; row++) board.push(new Array<string>(TT_COLS).fill(""));
  const world: TetrisWorld = { board, bag: [], kind: "O", next: "O", rot: 0, x: 2, y: 0, cleared: 0, phase: "run" };
  ttSpawn(world, seededRng(seed, 0x51b3));
  return world;
}

function StackerGame({ attempt, onDone }: {
  attempt: TaskAttempt;
  onDone: (success: boolean) => void;
}): ReactElement {
  const { finished, finish } = useFinish(onDone);
  const rngRef = useRef<Rng>(seededRng(attempt.seed, 0x51b3));
  const worldRef = useRef<TetrisWorld>(createTetris(attempt.seed));
  const [, setVersion] = useState(0);
  const bump = useCallback((): void => {
    setVersion((value) => value + 1);
  }, []);

  const lock = useCallback((): void => {
    const world = worldRef.current;
    if (world.phase !== "run") return;
    const cells = ttCells(world);
    if (cells.some(([, y]) => y < 0)) {
      world.phase = "lost";
      bump();
      finish(false);
      return;
    }
    for (const [x, y] of cells) world.board[y][x] = world.kind;
    let cleared = 0;
    for (let row = TT_ROWS - 1; row >= 0; row--) {
      if (world.board[row].every((cell) => cell !== "")) {
        world.board.splice(row, 1);
        world.board.unshift(new Array<string>(TT_COLS).fill(""));
        cleared += 1;
        row += 1;
      }
    }
    world.cleared += cleared;
    if (world.cleared >= TT_GOAL) {
      world.phase = "won";
      bump();
      finish(true);
      return;
    }
    ttSpawn(world, rngRef.current);
    if (!ttFits(world, ttCells(world))) {
      world.phase = "lost";
      bump();
      finish(false);
      return;
    }
    bump();
  }, [bump, finish]);

  const step = useCallback((delta: number): boolean => {
    const world = worldRef.current;
    if (world.phase !== "run") return false;
    if (!ttFits(world, ttCells(world, world.rot, world.x, world.y + delta))) return false;
    world.y += delta;
    bump();
    return true;
  }, [bump]);

  const nudge = useCallback((delta: number): void => {
    const world = worldRef.current;
    if (world.phase !== "run") return;
    if (ttFits(world, ttCells(world, world.rot, world.x + delta, world.y))) {
      world.x += delta;
      bump();
    }
  }, [bump]);

  const rotate = useCallback((): void => {
    const world = worldRef.current;
    if (world.phase !== "run") return;
    const next = wrap(world.rot + 1, 4);
    for (const kick of [0, -1, 1, -2, 2]) {
      if (ttFits(world, ttCells(world, next, world.x + kick, world.y))) {
        world.rot = next;
        world.x += kick;
        bump();
        return;
      }
    }
  }, [bump]);

  const hardDrop = useCallback((): void => {
    const world = worldRef.current;
    if (world.phase !== "run" || finished.current) return;
    while (ttFits(world, ttCells(world, world.rot, world.x, world.y + 1))) world.y += 1;
    lock();
  }, [finished, lock]);

  const held = useKeys(true, (key) => {
    if (key === "ArrowLeft" || key === "a") nudge(-1);
    else if (key === "ArrowRight" || key === "d") nudge(1);
    else if (key === "ArrowDown" || key === "s") step(1);
    else if (key === "ArrowUp" || key === "w" || key === "z" || key === "x") rotate();
    else if (key === "Space" || key === "Enter") hardDrop();
  });

  useTicker(true, TT_MOVE_MS, () => {
    const left = held.current.has("ArrowLeft") || held.current.has("a");
    const right = held.current.has("ArrowRight") || held.current.has("d");
    if (left !== right) nudge(right ? 1 : -1);
  });

  useTicker(true, TT_SOFT_MS, () => {
    if (held.current.has("ArrowDown") || held.current.has("s")) step(1);
  });

  useTicker(true, TT_FALL_MS, () => {
    const world = worldRef.current;
    if (world.phase !== "run") return;
    if (!step(1)) lock();
  });

  const world = worldRef.current;

  const draw = (context: CanvasRenderingContext2D): void => {
    const state = worldRef.current;
    block(context, TT_CELL, 0, 0, TT_COLS + 2, TT_ROWS + 2, ARC.steel);
    block(context, TT_CELL, 1, 1, TT_COLS, TT_ROWS, ARC.screen);
    for (let row = 0; row < TT_ROWS; row++) {
      for (let column = 0; column < TT_COLS; column++) {
        const cell = state.board[row][column];
        if (cell === "") continue;
        bevelled(context, TT_CELL, column + 1, row + 1, TT_COLOURS[cell] ?? ARC.cyan, ARC.ink);
      }
    }
    for (const [x, y] of ttCells(state)) {
      if (y < 0) continue;
      bevelled(context, TT_CELL, x + 1, y + 1, state.phase === "lost" ? ARC.red : TT_COLOURS[state.kind] ?? ARC.cyan, ARC.ink);
    }
  };

  return (
    <Cabinet
      title="FILTER STACKER"
      tag="O2"
      hud={[
        { label: "ROWS", value: `${world.cleared}/${TT_GOAL}` },
        { label: "BLOCK", value: world.kind },
        { label: "NEXT", value: world.next },
      ]}
      status={
        world.phase === "lost"
          ? "Stack jammed — filters offline."
          : world.phase === "won"
            ? "Rows cleared — filters unlocked."
            : `Clear ${TT_GOAL - world.cleared} more row${TT_GOAL - world.cleared === 1 ? "" : "s"} — SPACE drops`
      }
      alert={world.phase === "lost"}
    >
      <ArcadeScreen
        width={TT_W}
        height={TT_H}
        label="Filter stacker well"
        draw={draw}
        data={{
          phase: world.phase,
          board: world.board.map((row) => row.map((cell) => (cell === "" ? "." : "#")).join("")).join("/"),
          piece: world.kind,
          cells: ttCells(world).map(([x, y]) => `${x},${y}`).join(";"),
          rot: world.rot,
          x: world.x,
          y: world.y,
          cleared: world.cleared,
        }}
      />
      <ArcadePad
        columns={5}
        buttons={[
          <PadKey key="tt-left" label="◀" hint="Shift the block left" run={() => nudge(-1)} repeatMs={110} />,
          <PadKey key="tt-rot" label="⟳" hint="Rotate the block" run={rotate} />,
          <PadKey key="tt-right" label="▶" hint="Shift the block right" run={() => nudge(1)} repeatMs={110} />,
          <PadKey key="tt-down" label="▼" hint="Nudge the block down" run={() => step(1)} repeatMs={90} />,
          <PadKey key="tt-drop" label="DROP" hint="Drop and lock the block" run={hardDrop} primary />,
        ]}
      />
      <p className="ip-arc-note">◀ ▶ shift · ⟳ rotate · ▼ nudge · SPACE hard-drops</p>
    </Cabinet>
  );
}

/* ------------------------------------------------------------------ *
 * overlay shell                                                      *
 * ------------------------------------------------------------------ */

function TaskSession(props: TaskOverlayProps): ReactElement {
  const { attempt, reducedMotion, soundEnabled, onCancel } = props;
  const duration = taskSeconds(attempt.long);
  const label = TASK_LABELS[attempt.kind];

  const [phase, setPhase] = useState<Phase>("play");
  const [loss, setLoss] = useState<LossReason>("failed");
  const [remaining, setRemaining] = useState(duration);
  const [hint, setHint] = useFlash(1800);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const settledRef = useRef(false);
  const finishTimerRef = useRef<number | null>(null);
  const startCueRef = useRef(false);
  const resolveRef = useRef(props.onResolve);
  const cueRef = useRef(props.onCue);
  const cancelRef = useRef(onCancel);
  const soundRef = useRef(soundEnabled);

  useEffect(() => {
    resolveRef.current = props.onResolve;
    cueRef.current = props.onCue;
    cancelRef.current = onCancel;
    soundRef.current = soundEnabled;
  });

  /**
   * Cues exist to drive FriendSDK audio in index.tsx, so when sound is off we
   * do not request them at all.
   */
  const cue = useCallback((value: TaskCue): void => {
    if (!soundRef.current) return;
    cueRef.current(value);
  }, []);

  const resolve = useCallback(
    (success: boolean, reason: LossReason = "failed"): void => {
      if (settledRef.current) return;
      settledRef.current = true;
      if (!success) setLoss(reason);
      setPhase(success ? "won" : "lost");
      cue(success ? "ok" : "fail");
      finishTimerRef.current = window.setTimeout(() => {
        finishTimerRef.current = null;
        // Exactly one fresh roll, drawn at the end of the sequence.
        resolveRef.current(success, cryptoRoll());
      }, success ? 850 : 750);
    },
    [cue],
  );

  // The panel takes focus on mount so the overlay owns the keyboard.
  useEffect(() => {
    panelRef.current?.focus();
    if (!startCueRef.current) {
      startCueRef.current = true;
      cue("start");
    }
  }, [cue]);

  useEffect(
    () => () => {
      if (finishTimerRef.current !== null) window.clearTimeout(finishTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (phase !== "play") return;
    const deadline = performance.now() + duration * 1000;
    let lastSecond = duration;
    setRemaining(duration);
    const id = window.setInterval(
      () => {
        const left = Math.max(0, (deadline - performance.now()) / 1000);
        setRemaining(left);
        const second = Math.ceil(left);
        if (second !== lastSecond) {
          lastSecond = second;
          if (second > 0) cue("tick");
        }
        if (left <= 0) resolve(false, "timeout");
      },
      reducedMotion ? 200 : 80,
    );
    return () => {
      window.clearInterval(id);
    };
  }, [phase, duration, reducedMotion, cue, resolve]);

  // Escape cancels; it is consumed before the station behind can react.
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (settledRef.current) return; // already deciding — let it resolve itself
      cancelRef.current();
    };
    window.addEventListener("keydown", listener, true);
    return () => {
      window.removeEventListener("keydown", listener, true);
    };
  }, []);

  const seconds = Math.max(0, Math.ceil(remaining));
  const fraction = Math.max(0, Math.min(1, remaining / duration));
  const urgent = fraction <= 0.28;
  const percent = reducedMotion ? Math.round(fraction * 20) * 5 : fraction * 100;
  const status = phase === "play" ? "play" : phase;

  const result =
    phase === "won"
      ? { title: "TASK COMPLETE", note: "Console sealed — progress logged to the station ledger." }
      : loss === "timeout"
        ? { title: "OUT OF TIME", note: "The console locked before the sequence finished." }
        : { title: "TASK FAILED", note: "Sequence rejected by the console." };

  return (
    <div className={"ip-task" + (reducedMotion ? " ip-task-reduced" : "")}>
      <div
        className="ip-task-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`${attempt.name} — ${label}`}
        tabIndex={-1}
        ref={panelRef}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) panelRef.current?.focus();
        }}
      >
        <div className="ip-task-head">
          <div className="ip-task-id">
            <span className="ip-task-station">{attempt.name}</span>
            <span className="ip-task-kind">{label}</span>
          </div>
          <div className="ip-task-clock">
            <div
              className="ip-task-bar"
              role="progressbar"
              aria-label="Time remaining"
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={seconds}
            >
              <div className="ip-task-bar-fill" data-urgent={urgent} style={{ width: `${percent}%` }} />
            </div>
            <span className="ip-task-seconds" data-urgent={urgent}>
              {seconds}s
            </span>
            <button type="button" className="ip-task-close" data-ip-cancel="1" aria-label="Cancel task" onClick={onCancel}>
              X
            </button>
          </div>
        </div>

        <p className="ip-task-instruction">
          {INSTRUCTIONS[attempt.kind]}
          {attempt.long ? " Long console — extended cycle." : ""}
        </p>

        <div className="ip-task-body" data-status={status}>
          {phase === "play" ? (
            attempt.kind === "wiring" ? (
              <WiringGame attempt={attempt} onDone={resolve} onHint={setHint} />
            ) : attempt.kind === "calibrate" ? (
              <BreakoutGame attempt={attempt} onDone={resolve} />
            ) : attempt.kind === "dials" ? (
              <SnakeGame attempt={attempt} onDone={resolve} />
            ) : attempt.kind === "reboot" ? (
              <MemoryGame attempt={attempt} onDone={resolve} />
            ) : attempt.kind === "sample" ? (
              <MinesweeperGame attempt={attempt} onDone={resolve} />
            ) : (
              <StackerGame attempt={attempt} onDone={resolve} />
            )
          ) : (
            <div className="ip-task-result" data-result={phase} role="status">
              <p className="ip-task-result-title">{result.title}</p>
              <p className="ip-task-result-note">{result.note}</p>
            </div>
          )}
        </div>

        <div className="ip-task-foot">
          <span className="ip-task-hint" data-alert={hint !== ""} role="status">
            {hint !== "" ? hint : "ARROWS move · SPACE/ENTER act · ESC cancel"}
          </span>
          <span className="ip-task-tag">
            {label.toUpperCase()} · {attempt.long ? "LONG" : "SHORT"}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function TaskOverlay(props: TaskOverlayProps): ReactElement {
  const { attempt } = props;
  // A new attempt always starts from a clean console, even if the parent
  // reuses the same element position.
  return (
    <TaskSession
      key={`${attempt.stationId}|${attempt.kind}|${attempt.seed}|${attempt.long ? "long" : "short"}`}
      {...props}
    />
  );
}
