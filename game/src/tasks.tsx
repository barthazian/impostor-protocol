/**
 * IMPOSTOR PROTOCOL — station task console overlay.
 *
 * Six RNG action sequences a crewmate performs at a task station: wiring,
 * keypad, dials, calibrate, sample, reboot. Every one of them is playable with
 * keyboard and touch, and every puzzle is derived from `attempt.seed`, so the
 * same room code replays the same consoles.
 *
 * PRESENTATION ONLY. This module never touches the FriendSDK action client, the
 * RF economy or the match simulation. It reports exactly one boolean plus one
 * fresh `cryptoRoll()` back through `onResolve`, and it can be cancelled through
 * `onCancel`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactElement } from "react";
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

/** Long consoles get 22 s, the rest 13 s. */
function taskSeconds(long: boolean): number {
  return long ? 22 : 13;
}

const INSTRUCTIONS: Readonly<Record<TaskKind, string>> = {
  wiring: "Tap a left node, then the right node of the same colour — match all four pairs.",
  keypad: "Key in the five-digit access code, then press ENTER.",
  dials: "Turn every dial until its needle meets the green marker (Δ0).",
  calibrate: "Press SPACE or tap CALIBRATE while the needle is in the green zone — three times.",
  sample: "One sample carries a different number of markers. Pick it out.",
  reboot: "Watch the four-step pattern, then repeat it on the tiles.",
};

/* ------------------------------------------------------------------ *
 * small shared helpers
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
 * never read stale state. `capture` lets the overlay consume a key before the
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

function isButtonFocused(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement && active.tagName === "BUTTON";
}

function arrowStep(key: string): number {
  if (key === "ArrowLeft" || key === "ArrowUp") return -1;
  if (key === "ArrowRight" || key === "ArrowDown") return 1;
  return 0;
}

/* ------------------------------------------------------------------ *
 * 1. wiring — pair up four coloured nodes across two columns
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
    if (arrowStep(event.key) === 0) return;
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

  const linkedRight = (index: number): boolean => links.some((link) => link.right === index);

  return (
    <div className="ip-wire">
      <div className="ip-wire-board">
        <svg className="ip-wire-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
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
                  data-linked={linkedRight(index)}
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
      <p className="ip-wire-count">
        {links.length}/{WIRE_NODES.length} pairs linked{picked === null ? "" : " · node armed"}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 2. keypad — type the displayed access code
 * ------------------------------------------------------------------ */

type KeypadKey = Readonly<{ id: string; label: string; action: "digit" | "del" | "ok"; digit?: string }>;

const KEYPAD_KEYS: readonly KeypadKey[] = [
  { id: "k1", label: "1", action: "digit", digit: "1" },
  { id: "k2", label: "2", action: "digit", digit: "2" },
  { id: "k3", label: "3", action: "digit", digit: "3" },
  { id: "k4", label: "4", action: "digit", digit: "4" },
  { id: "k5", label: "5", action: "digit", digit: "5" },
  { id: "k6", label: "6", action: "digit", digit: "6" },
  { id: "k7", label: "7", action: "digit", digit: "7" },
  { id: "k8", label: "8", action: "digit", digit: "8" },
  { id: "k9", label: "9", action: "digit", digit: "9" },
  { id: "kdel", label: "DEL", action: "del" },
  { id: "k0", label: "0", action: "digit", digit: "0" },
  { id: "kok", label: "ENTER", action: "ok" },
];

const CODE_LENGTH = 5;

function KeypadGame({ attempt, onDone }: {
  attempt: TaskAttempt;
  onDone: (success: boolean) => void;
}): ReactElement {
  const { finished, finish } = useFinish(onDone);
  const gate = useRef(createGate(60));
  const code = useMemo(() => {
    const rng = seededRng(attempt.seed, 0x4b59);
    let value = "";
    for (let index = 0; index < CODE_LENGTH; index++) value += String(rng.int(10));
    return value;
  }, [attempt.seed]);

  const [entry, setEntry] = useState("");
  const [flash, setFlash] = useFlash(1400);

  const addDigit = (digit: string): void => {
    if (finished.current || !gate.current()) return;
    setEntry((current) => (current.length >= CODE_LENGTH ? current : current + digit));
  };

  const removeDigit = (): void => {
    if (finished.current || !gate.current()) return;
    setEntry((current) => current.slice(0, -1));
  };

  const submit = (): void => {
    if (finished.current || !gate.current()) return;
    if (entry.length !== CODE_LENGTH) {
      setFlash(`Code must be ${CODE_LENGTH} digits.`);
      return;
    }
    finish(entry === code);
  };

  useWindowKeys(true, (event) => {
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      event.stopPropagation();
      removeDigit();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      submit();
      return;
    }
    if (!event.repeat && event.key.length === 1 && event.key >= "0" && event.key <= "9") {
      event.preventDefault();
      event.stopPropagation();
      addDigit(event.key);
    }
  });

  const ready = entry.length === CODE_LENGTH;
  return (
    <div className="ip-key">
      <div className="ip-key-screen">
        <span className="ip-key-screen-label">ACCESS CODE</span>
        <span className="ip-key-code" aria-label={`Access code ${code.split("").join(" ")}`}>
          {code.split("").map((digit, index) => (
            <span key={`code-${index}`} className="ip-key-chip">
              {digit}
            </span>
          ))}
        </span>
      </div>
      <div className="ip-key-screen ip-key-screen-entry">
        <span className="ip-key-screen-label">INPUT</span>
        <span className="ip-key-entry" aria-label={`Entered ${entry.length} of ${CODE_LENGTH} digits`}>
          {Array.from({ length: CODE_LENGTH }, (_, index) => (
            <span key={`slot-${index}`} className="ip-key-chip" data-filled={index < entry.length}>
              {entry[index] ?? "-"}
            </span>
          ))}
        </span>
      </div>
      <div className="ip-key-pad">
        {KEYPAD_KEYS.map((key) => (
          <button
            key={key.id}
            type="button"
            className="ip-key-button"
            data-action={key.action}
            disabled={key.action === "ok" && !ready}
            aria-label={
              key.action === "ok" ? "Submit access code" : key.action === "del" ? "Delete last digit" : undefined
            }
            onClick={() => {
              if (key.action === "digit" && key.digit !== undefined) addDigit(key.digit);
              else if (key.action === "del") removeDigit();
              else submit();
            }}
          >
            {key.label}
          </button>
        ))}
      </div>
      <p className="ip-key-note" data-flash={flash !== ""} role="status">
        {flash !== "" ? flash : `Digits typed: ${entry.length}/${CODE_LENGTH}`}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 3. dials — rotate four dials onto their markers
 * ------------------------------------------------------------------ */

const DIAL_STEPS = 24; // 15° per step
const DIAL_TOLERANCE = 1;
const DIAL_PITCH_PX = 12;

function dialDistance(a: number, b: number): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, DIAL_STEPS - raw);
}

type DialSetup = Readonly<{ targets: readonly number[]; values: readonly number[]; driftIndex: number; driftDir: number }>;

function DialsGame({ attempt, onDone }: {
  attempt: TaskAttempt;
  onDone: (success: boolean) => void;
}): ReactElement {
  const { finished, finish } = useFinish(onDone);
  const setup = useMemo<DialSetup>(() => {
    const rng = seededRng(attempt.seed, 0x64a1);
    const targets: number[] = [];
    const values: number[] = [];
    for (let index = 0; index < 4; index++) {
      const target = rng.int(DIAL_STEPS);
      const offset = 4 + rng.int(DIAL_STEPS - 7); // 4..20 steps away, never pre-aligned
      const direction = rng.chance(0.5) ? 1 : -1;
      targets.push(target);
      values.push(wrap(target + direction * offset, DIAL_STEPS));
    }
    return { targets, values, driftIndex: rng.int(4), driftDir: rng.chance(0.5) ? 1 : -1 };
  }, [attempt.seed]);

  const [values, setValues] = useState<readonly number[]>(() => setup.values.slice());
  const [activeDial, setActiveDial] = useState(0);
  const activeRef = useRef(0);
  const dragRef = useRef<{ index: number; pointerId: number; x: number; value: number; steps: number; moved: boolean } | null>(null);
  const dialRefs = useRef<(HTMLDivElement | null)[]>([]);
  const holdRef = useRef<number | null>(null);

  useEffect(() => {
    activeRef.current = activeDial;
  }, [activeDial]);

  useEffect(() => {
    if (finished.current) return;
    const aligned = values.every((value, index) => dialDistance(value, setup.targets[index]) <= DIAL_TOLERANCE);
    if (aligned) finish(true);
  }, [values, setup.targets, finish, finished]);

  // A seeded slow drift keeps one dial creeping until it reaches its marker.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (finished.current) return;
      setValues((current) => {
        if (dialDistance(current[setup.driftIndex], setup.targets[setup.driftIndex]) <= DIAL_TOLERANCE) return current;
        const next = current.slice();
        next[setup.driftIndex] = wrap(next[setup.driftIndex] + setup.driftDir, DIAL_STEPS);
        return next;
      });
    }, 900);
    return () => {
      window.clearInterval(id);
    };
  }, [setup.driftIndex, setup.driftDir, setup.targets, finished]);

  useEffect(
    () => () => {
      if (holdRef.current !== null) window.clearInterval(holdRef.current);
    },
    [],
  );

  const nudge = useCallback((index: number, delta: number): void => {
    setValues((current) => {
      const next = current.slice();
      next[index] = wrap(next[index] + delta, DIAL_STEPS);
      return next;
    });
  }, []);

  const focusDial = (index: number): void => {
    setActiveDial(index);
    dialRefs.current[index]?.focus();
  };

  const pointerDial = (): number | null => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return null;
    const dial = active.closest("[data-dial]");
    if (!(dial instanceof HTMLElement)) return null;
    const raw = dial.dataset.dial;
    if (raw === undefined) return null;
    const index = Number.parseInt(raw, 10);
    return Number.isNaN(index) ? null : index;
  };

  useWindowKeys(true, (event) => {
    const key = event.key;
    if (key === "ArrowUp" || key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      const from = pointerDial() ?? activeRef.current;
      focusDial(wrap(from + (key === "ArrowDown" ? 1 : -1), 4));
      return;
    }
    if (key !== "ArrowLeft" && key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    if (finished.current) return;
    const from = pointerDial() ?? activeRef.current;
    setActiveDial(from);
    nudge(from, key === "ArrowRight" ? 1 : -1);
  });

  const onKnobDown = (event: ReactPointerEvent<SVGSVGElement>, index: number): void => {
    if (finished.current) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a nicety: dragging still works without it.
    }
    dragRef.current = {
      index,
      pointerId: event.pointerId,
      x: event.clientX,
      value: values[index],
      steps: 0,
      moved: false,
    };
    setActiveDial(index);
    dialRefs.current[index]?.focus();
  };

  const onKnobMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId || finished.current) return;
    const dx = event.clientX - drag.x;
    if (Math.abs(dx) >= 4) drag.moved = true;
    const steps = Math.round(dx / DIAL_PITCH_PX);
    if (steps === drag.steps) return;
    drag.steps = steps;
    const target = wrap(drag.value + steps, DIAL_STEPS);
    setValues((current) => {
      if (current[drag.index] === target) return current;
      const next = current.slice();
      next[drag.index] = target;
      return next;
    });
  };

  const onKnobUp = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (finished.current || drag.moved) return;
    // A clean tap on the knob turns it: left half back, right half forward.
    const box = event.currentTarget.getBoundingClientRect();
    nudge(drag.index, event.clientX < box.left + box.width / 2 ? -1 : 1);
  };

  const startHold = (index: number, delta: number): void => {
    if (finished.current) return;
    setActiveDial(index);
    nudge(index, delta);
    holdRef.current = window.setInterval(() => {
      nudge(index, delta);
    }, 120);
  };

  const stopHold = (): void => {
    if (holdRef.current !== null) {
      window.clearInterval(holdRef.current);
      holdRef.current = null;
    }
  };

  useEffect(() => {
    window.addEventListener("pointerup", stopHold);
    window.addEventListener("pointercancel", stopHold);
    return () => {
      window.removeEventListener("pointerup", stopHold);
      window.removeEventListener("pointercancel", stopHold);
    };
  }, []);

  const alignedCount = values.filter((value, index) => dialDistance(value, setup.targets[index]) <= DIAL_TOLERANCE).length;

  return (
    <div className="ip-dial">
      <div className="ip-dial-row">
        {setup.targets.map((target, index) => {
          const value = values[index];
          const off = dialDistance(value, target);
          const aligned = off <= DIAL_TOLERANCE;
          return (
            <div
              key={`dial-${index}`}
              className="ip-dial-cell"
              data-dial={index}
              data-aligned={aligned}
              data-active={activeDial === index}
              data-drift={setup.driftIndex === index}
              tabIndex={0}
              role="group"
              aria-label={`Dial ${index + 1} of 4, ${aligned ? "aligned" : `${off} steps off`}${setup.driftIndex === index ? ", drifting" : ""}`}
              ref={(element) => {
                dialRefs.current[index] = element;
              }}
              onFocus={() => {
                setActiveDial(index);
              }}
            >
              <svg
                className="ip-dial-knob"
                viewBox="0 0 100 100"
                aria-hidden="true"
                onPointerDown={(event) => {
                  onKnobDown(event, index);
                }}
                onPointerMove={onKnobMove}
                onPointerUp={onKnobUp}
                onPointerCancel={() => {
                  dragRef.current = null;
                }}
              >
                <circle className="ip-dial-face" cx="50" cy="50" r="45" />
                {Array.from({ length: DIAL_STEPS }, (_, tick) => (
                  <line
                    key={`tick-${tick}`}
                    className="ip-dial-tick"
                    x1="50"
                    y1={tick % 2 === 0 ? 9 : 12}
                    x2="50"
                    y2="17"
                    transform={`rotate(${tick * (360 / DIAL_STEPS)} 50 50)`}
                  />
                ))}
                <g transform={`rotate(${target * (360 / DIAL_STEPS)} 50 50)`}>
                  <polygon className="ip-dial-mark" points="50,17 45,5 55,5" />
                </g>
                <g className="ip-dial-needle" transform={`rotate(${value * (360 / DIAL_STEPS)} 50 50)`}>
                  <line x1="50" y1="50" x2="50" y2="22" />
                  <circle className="ip-dial-hub" cx="50" cy="50" r="6" />
                </g>
              </svg>
              {setup.driftIndex === index ? <span className="ip-dial-tag">DRIFT</span> : null}
              <div className="ip-dial-controls">
                <button
                  type="button"
                  className="ip-dial-button"
                  aria-label={`Turn dial ${index + 1} left`}
                  onPointerDown={() => {
                    startHold(index, -1);
                  }}
                  onPointerUp={stopHold}
                  onPointerLeave={stopHold}
                  onClick={(event) => {
                    stopHold();
                    // detail === 0 means a keyboard/screen-reader activation,
                    // which never fires pointerdown.
                    if (event.detail === 0) nudge(index, -1);
                  }}
                >
                  {"<"}
                </button>
                <span className="ip-dial-readout" data-aligned={aligned}>
                  {aligned ? "Δ0" : `Δ${off}`}
                </span>
                <button
                  type="button"
                  className="ip-dial-button"
                  aria-label={`Turn dial ${index + 1} right`}
                  onPointerDown={() => {
                    startHold(index, 1);
                  }}
                  onPointerUp={stopHold}
                  onPointerLeave={stopHold}
                  onClick={(event) => {
                    stopHold();
                    if (event.detail === 0) nudge(index, 1);
                  }}
                >
                  {">"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="ip-dial-note" role="status">
        {alignedCount === 4 ? "All dials aligned." : `${alignedCount}/4 dials aligned`} · one dial drifts until it locks
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 4. calibrate — stop the needle inside the green zone, three times
 * ------------------------------------------------------------------ */

const CAL_BASE_SPEED = 0.62; // fraction of the gauge per second
const CAL_GAUGE_MIN = 0.06;
const CAL_GAUGE_MAX = 0.94;

type CalZone = Readonly<{ start: number; end: number }>;

function CalibrateGame({ attempt, reducedMotion, onDone }: {
  attempt: TaskAttempt;
  reducedMotion: boolean;
  onDone: (success: boolean) => void;
}): ReactElement {
  const { finished, finish } = useFinish(onDone);
  const gate = useRef(createGate(60));
  const zones = useMemo<readonly CalZone[]>(() => {
    const rng = seededRng(attempt.seed, 0x7c31);
    const out: CalZone[] = [];
    for (let index = 0; index < 3; index++) {
      const width = 0.16 + rng.next() * 0.06;
      const start = CAL_GAUGE_MIN + 0.14 + rng.next() * (CAL_GAUGE_MAX - width - (CAL_GAUGE_MIN + 0.14));
      out.push({ start, end: start + width });
    }
    return out;
  }, [attempt.seed]);

  const [hits, setHits] = useState(0);
  const [pos, setPos] = useState(CAL_GAUGE_MIN);
  const posRef = useRef(CAL_GAUGE_MIN);
  const dirRef = useRef(1);
  const speedRef = useRef(CAL_BASE_SPEED);

  useEffect(() => {
    speedRef.current = CAL_BASE_SPEED * Math.pow(1.38, hits);
  }, [hits]);

  useEffect(() => {
    if (finished.current) return;
    const advance = (dt: number): void => {
      let next = posRef.current + dirRef.current * speedRef.current * dt;
      let guard = 0;
      while ((next > 1 || next < 0) && guard < 8) {
        if (next > 1) {
          next = 2 - next;
          dirRef.current = -1;
        } else {
          next = -next;
          dirRef.current = 1;
        }
        guard++;
      }
      posRef.current = Math.min(1, Math.max(0, next));
      setPos(posRef.current);
    };
    if (reducedMotion) {
      // Stepped sweep: same average speed, no continuous motion.
      const id = window.setInterval(() => {
        advance(0.15);
      }, 150);
      return () => {
        window.clearInterval(id);
      };
    }
    let frame = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      advance(dt);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [reducedMotion, finished]);

  const zone = zones[Math.min(hits, zones.length - 1)];

  const strike = (): void => {
    if (finished.current || !gate.current()) return;
    const value = posRef.current;
    if (value < zone.start || value > zone.end) {
      finish(false);
      return;
    }
    const next = hits + 1;
    if (next >= zones.length) {
      finish(true);
      return;
    }
    setHits(next);
  };

  useWindowKeys(true, (event) => {
    if (event.repeat) return;
    if (event.key !== " " && event.key !== "Enter") return;
    // A focused real button keeps its native activation (cancel, and the
    // CALIBRATE button itself, which routes back into strike()).
    if (isButtonFocused()) return;
    event.preventDefault();
    event.stopPropagation();
    strike();
  });

  const inZone = pos >= zone.start && pos <= zone.end;

  return (
    <div className="ip-cal">
      <div className="ip-cal-gauge" aria-hidden="true">
        <div
          className="ip-cal-zone"
          style={{ left: `${zone.start * 100}%`, width: `${(zone.end - zone.start) * 100}%` }}
        />
        <div className="ip-cal-needle" data-in-zone={inZone} style={{ left: `${pos * 100}%` }} />
        <div className="ip-cal-track" />
      </div>
      <div className="ip-cal-pips" role="status" aria-label={`${hits} of ${zones.length} calibrations locked`}>
        {zones.map((_, index) => (
          <span key={`pip-${index}`} className="ip-cal-pip" data-done={index < hits} />
        ))}
        <span className="ip-cal-pip-label">
          {hits}/{zones.length} locked
        </span>
      </div>
      <button type="button" className="ip-action ip-cal-button" onClick={strike}>
        CALIBRATE
      </button>
      <p className="ip-cal-note" role="status">
        {inZone ? "In range — lock it in." : "Hold for the green zone."}
        {reducedMotion ? "" : " Controls are instant."}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 5. sample — spot the sample with a different marker count
 * ------------------------------------------------------------------ */

const SAMPLE_LETTERS = ["A", "B", "C", "D", "E"] as const;

type SampleSetup = Readonly<{ normal: readonly number[]; odd: readonly number[]; oddIndex: number }>;

function SampleGame({ attempt, onDone }: {
  attempt: TaskAttempt;
  onDone: (success: boolean) => void;
}): ReactElement {
  const { finished, finish } = useFinish(onDone);
  const gate = useRef(createGate(60));
  const setup = useMemo<SampleSetup>(() => {
    const rng = seededRng(attempt.seed, 0x5a99);
    const pool = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const normal: number[] = [];
    while (normal.length < 4) {
      normal.push(pool.splice(rng.int(pool.length), 1)[0]);
    }
    const missing = normal[rng.int(normal.length)];
    return { normal, odd: normal.filter((cell) => cell !== missing), oddIndex: rng.int(SAMPLE_LETTERS.length) };
  }, [attempt.seed]);

  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useWindowKeys(true, (event) => {
    const delta = arrowStep(event.key);
    if (delta === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const refs = cardRefs.current;
    const found = refs.findIndex((element) => element === document.activeElement);
    const next = found < 0 ? 0 : wrap(found + delta, SAMPLE_LETTERS.length);
    refs[next]?.focus();
  });

  return (
    <div className="ip-sample">
      <div className="ip-sample-row">
        {SAMPLE_LETTERS.map((letter, index) => {
          const cells = index === setup.oddIndex ? setup.odd : setup.normal;
          return (
            <button
              key={`sample-${letter}`}
              type="button"
              ref={(element) => {
                cardRefs.current[index] = element;
              }}
              className="ip-sample-card"
              aria-label={`Sample ${letter}, ${cells.length} markers`}
              onClick={() => {
                if (finished.current || !gate.current()) return;
                finish(index === setup.oddIndex);
              }}
            >
              <span className="ip-sample-plate">
                {Array.from({ length: 9 }, (_, cell) => (
                  <span key={`cell-${cell}`} className="ip-sample-dot" data-lit={cells.includes(cell)} />
                ))}
              </span>
              <span className="ip-sample-tag">{letter}</span>
            </button>
          );
        })}
      </div>
      <p className="ip-sample-note">
        Marker counts: {SAMPLE_LETTERS.map((letter, index) => {
          const cells = index === setup.oddIndex ? setup.odd : setup.normal;
          return `${letter}${cells.length}`;
        }).join(" ")}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 6. reboot — watch a four-step pattern and repeat it
 * ------------------------------------------------------------------ */

const REBOOT_TILES = ["1", "2", "3", "4"] as const;

function RebootGame({ attempt, reducedMotion, onDone }: {
  attempt: TaskAttempt;
  reducedMotion: boolean;
  onDone: (success: boolean) => void;
}): ReactElement {
  const { finished, finish } = useFinish(onDone);
  const gate = useRef(createGate(60));
  const pattern = useMemo(() => {
    const rng = seededRng(attempt.seed, 0x2e77);
    return REBOOT_TILES.map(() => rng.int(REBOOT_TILES.length));
  }, [attempt.seed]);

  const [view, setView] = useState<"watch" | "input">("watch");
  const [lit, setLit] = useState<number | null>(null);
  const [litStep, setLitStep] = useState(0);
  const [playback, setPlayback] = useState(0);
  const [progress, setProgress] = useState(0);
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];
    const stepMs = reducedMotion ? 460 : 400;
    const gapMs = 200;
    const run = (index: number): void => {
      if (cancelled) return;
      if (index >= pattern.length) {
        setLit(null);
        setView("input");
        return;
      }
      setLit(pattern[index]);
      setLitStep(index + 1);
      timers.push(
        window.setTimeout(() => {
          if (cancelled) return;
          setLit(null);
          timers.push(
            window.setTimeout(() => {
              run(index + 1);
            }, gapMs),
          );
        }, stepMs),
      );
    };
    run(0);
    return () => {
      cancelled = true;
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [pattern, playback, reducedMotion]);

  const press = (tile: number): void => {
    if (view !== "input" || finished.current || !gate.current()) return;
    if (pattern[progress] !== tile) {
      finish(false);
      return;
    }
    const next = progress + 1;
    setProgress(next);
    if (next >= pattern.length) finish(true);
  };

  useWindowKeys(view === "input", (event) => {
    if (event.repeat) return;
    const tile = REBOOT_TILES.indexOf(event.key as (typeof REBOOT_TILES)[number]);
    if (tile < 0) return;
    event.preventDefault();
    event.stopPropagation();
    press(tile);
  });

  useWindowKeys(view === "input", (event) => {
    const delta = arrowStep(event.key);
    if (delta === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const refs = tileRefs.current;
    const found = refs.findIndex((element) => element === document.activeElement);
    const next = found < 0 ? 0 : wrap(found + delta, REBOOT_TILES.length);
    refs[next]?.focus();
  });

  return (
    <div className="ip-reboot">
      <div className="ip-reboot-grid">
        {REBOOT_TILES.map((label, index) => (
          <button
            key={`tile-${label}`}
            type="button"
            ref={(element) => {
              tileRefs.current[index] = element;
            }}
            className="ip-reboot-tile"
            data-lit={lit === index}
            data-step={reducedMotion && lit === index ? litStep : undefined}
            aria-label={`Reboot tile ${label}${lit === index ? ", lit" : ""}`}
            onClick={() => {
              press(index);
            }}
          >
            <span className="ip-reboot-number">{label}</span>
            <span className="ip-reboot-echo" data-set={index < progress} />
          </button>
        ))}
      </div>
      <div className="ip-reboot-foot">
        <span className="ip-reboot-status" role="status">
          {view === "watch" ? "Watching the boot pattern…" : `Step ${Math.min(progress + 1, pattern.length)} of ${pattern.length}`}
        </span>
        <button
          type="button"
          className="ip-reboot-replay"
          disabled={view !== "input"}
          onClick={() => {
            setProgress(0);
            setView("watch");
            setPlayback((value) => value + 1);
          }}
        >
          REPLAY
        </button>
      </div>
      <p className="ip-reboot-note">{reducedMotion ? "Steps are numbered — no motion required." : "Keys 1-4 repeat a step."}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * overlay shell
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
          {attempt.long ? " Long console — extended timer." : ""}
        </p>

        <div className="ip-task-body" data-status={status}>
          {phase === "play" ? (
            attempt.kind === "wiring" ? (
              <WiringGame attempt={attempt} onDone={resolve} onHint={setHint} />
            ) : attempt.kind === "keypad" ? (
              <KeypadGame attempt={attempt} onDone={resolve} />
            ) : attempt.kind === "dials" ? (
              <DialsGame attempt={attempt} onDone={resolve} />
            ) : attempt.kind === "calibrate" ? (
              <CalibrateGame attempt={attempt} reducedMotion={reducedMotion} onDone={resolve} />
            ) : attempt.kind === "sample" ? (
              <SampleGame attempt={attempt} onDone={resolve} />
            ) : (
              <RebootGame attempt={attempt} reducedMotion={reducedMotion} onDone={resolve} />
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
