// Phaser-free touch decisions: who counts as a touch device, when the rotate gate closes, where the
// on-screen buttons sit, and how a contact becomes a held flag. Lives outside the scene for the same
// reason edge-latch.ts / flow-state.ts / meter-view.ts do — vitest runs in the node env, so anything
// worth testing has to sit outside the Phaser import. `touch-view.ts` is the Phaser adapter over this.

import { VIEW_WIDTH, STAGE_HEIGHT } from "../sim/constants";

export type TouchButton = "left" | "right" | "up" | "down" | "light" | "heavy" | "block" | "special";

/** The held flags a pad hands to InputReader. Exactly the InputSnapshot held fields, no edges — the
 *  edges are still computed in the ONE place that computes them (`InputReader.readOne`). */
export type TouchHeld = Record<TouchButton, boolean>;

export const TOUCH_BUTTONS: TouchButton[] = ["left", "right", "up", "down", "light", "heavy", "block", "special"];

export interface TouchEnv {
  /** navigator.maxTouchPoints */
  maxTouchPoints: number;
  /** matchMedia("(pointer: coarse)").matches — the PRIMARY pointing device is a finger */
  pointerCoarse: boolean;
}

/**
 * Touch-PRIMARY device: it can be touched, and the pointer you actually point with is a finger.
 *
 * Capability alone (what `game.device.input.touch` reports) is the wrong question — a touchscreen
 * Windows laptop answers yes, and would lose local two-player, the one mode a laptop is genuinely good
 * at, while gaining a pad nobody needs. But **`any-pointer: fine` is the wrong discriminator**, which
 * this shipped with and a real phone disproved in one try: a Samsung S23+ on Android 16 reports
 * `any-pointer: fine` TRUE (Android exposes stylus/DeX pointer capability), so the whole touch path
 * switched itself off — the title read "PRESS ENTER", nothing was tappable, and portrait never raised
 * the rotate gate. Every emulator said otherwise.
 *
 * `pointer: coarse` asks about the PRIMARY pointer instead of whether any fine one could exist. A
 * phone answers coarse whatever else it supports; a laptop answers fine because you point with the
 * trackpad. That is the distinction this function was always trying to make.
 */
export function isTouchDevice(env: TouchEnv): boolean {
  return env.maxTouchPoints > 0 && env.pointerCoarse;
}

/**
 * What this device actually reports, as one short line for `?diag=1`.
 *
 * Device classification is the only decision in this project that cannot be reproduced from the
 * machine it is written on, and it has now shipped wrong once and survived a fix. Guessing at it from
 * an emulator that agrees with whatever is written is how that happened. So the phone answers for
 * itself: load `?diag=1` and read the line off the title screen.
 *
 * Its mere PRESENCE is half the diagnostic — a build without this function cannot draw it, so a line
 * that does not appear means a stale cached bundle rather than a wrong predicate.
 */
export function touchDiagnostics(): string {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "no window";
  const mm = (q: string): string => (window.matchMedia?.(q).matches ? "1" : "0");
  const forced = new URLSearchParams(window.location.search).get("touch");
  return [
    `touch=${touchMode() ? 1 : 0}${forced === "1" || forced === "0" ? "(forced)" : ""}`,
    `maxTouchPoints=${navigator.maxTouchPoints ?? "?"}`,
    `pointer:coarse=${mm("(pointer: coarse)")}`,
    `any-pointer:coarse=${mm("(any-pointer: coarse)")}`,
    `any-pointer:fine=${mm("(any-pointer: fine)")}`,
    `hover:none=${mm("(hover: none)")}`,
    `ontouchstart=${"ontouchstart" in window ? 1 : 0}`,
    `vp=${window.innerWidth}x${window.innerHeight}`,
    `dpr=${window.devicePixelRatio}`,
  ].join(" · ");
}

let cachedTouch: boolean | undefined;

/**
 * The ONE answer the whole app uses, evaluated once.
 *
 * FlowScene (hide PvP), MatchScene (build the pad), and main.ts (the `html.touch` class + the rotate
 * gate) all need it, and they are constructed at different times. Re-deriving it per caller would be
 * three chances for them to disagree — the exact shape of the Phase 17 meter bug, where the HUD and
 * the sim answered the same question differently. Memoised, so they cannot.
 *
 * **`?touch=1` / `?touch=0` forces the answer, in PRODUCTION as well as dev.** Normally a seam like
 * this would be DEV-gated with the rest of them, but device classification is the one decision here
 * that cannot be reproduced from this machine — it is a claim about hardware nobody here is holding,
 * and it shipped wrong once. A URL parameter is the difference between a player confirming it in ten
 * seconds and another deploy round trip. It can only pick a UI mode, so there is nothing to abuse.
 */
export function touchMode(): boolean {
  if (cachedTouch !== undefined) return cachedTouch;
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const forced = new URLSearchParams(window.location.search).get("touch");
  if (forced === "1" || forced === "0") {
    cachedTouch = forced === "1";
    return cachedTouch;
  }
  cachedTouch = isTouchDevice({
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    pointerCoarse: window.matchMedia?.("(pointer: coarse)").matches ?? false,
  });
  return cachedTouch;
}

/**
 * The rotate gate: a touch device held taller than it is wide.
 *
 * Deliberately NOT `screen.orientation.type` and NOT Phaser's `scale.isPortrait`. This is a plain
 * comparison of the numbers the layout actually gets, which is the thing that makes the game
 * unplayable — and it is a pure function, so the overlay and the loop pause are driven by one tested
 * decision rather than two readings of the platform that can drift apart.
 *
 * Square counts as landscape: there is nothing to fix by rotating.
 */
export function shouldBlockForOrientation(env: { touch: boolean; width: number; height: number }): boolean {
  return env.touch && env.height > env.width;
}

export interface TouchButtonSpec {
  id: TouchButton;
  x: number;
  y: number;
  r: number;
  label: string;
}

/** Button radius in GAME space. At 1280x720 letterboxed into a 844x390 phone (FIT scale 0.542) this
 *  draws ~56 CSS px across, about 9 mm — the floor for a reliable thumb target.
 *
 *  EXPORTED because the art is generated against it: `scripts/build-atlases.py` draws each pad frame
 *  as a circle of exactly this radius, and `TouchPad`'s constructor refuses to start if the loaded
 *  frame is not `2 * (BUTTON_R + PAD_BLEED)` across. A radius change on either side is then a loud
 *  boot failure rather than a pad whose art has quietly stopped matching its hit test. */
export const BUTTON_R = 52;

/** Transparent margin around the drawn circle in each atlas frame — headroom for the ring stroke and
 *  its antialiasing, so the art is never clipped by the frame edge. Part of the same contract. */
export const PAD_BLEED = 12;

/** Texture key for the pad art (see `scripts/build-atlases.py --pad`). */
export const PAD_ATLAS = "pad-atlas";

/** The action half of the pad. Attacks and block share one accent colour; movement gets the other. */
export function isActionButton(id: TouchButton): boolean {
  return id === "light" || id === "heavy" || id === "block" || id === "special";
}

/**
 * Which atlas frame a button wears right now. FOUR frames cover all eight buttons, because the art
 * only ever varies by those two axes — each button's identity is carried by its `Text` label, not by
 * its shape. Pure and exported so the frame NAMES are unit-tested: `Texture.get()` answers a missing
 * frame with a `console.warn` and the atlas's FIRST frame, so a renamed frame would not throw, it
 * would just quietly draw the wrong state forever.
 */
export function frameFor(id: TouchButton, pressed: boolean): string {
  return `pad-${isActionButton(id) ? "action" : "move"}${pressed ? "-down" : ""}`;
}

/** Every frame the pad atlas must contain, for the boot-time completeness check. */
export const PAD_FRAMES = ["pad-move", "pad-move-down", "pad-action", "pad-action-down"] as const;

/**
 * Where the buttons sit, in GAME space (1280x720), so they ride `Scale.FIT` with everything else and
 * need no resize handling of their own.
 *
 * Two symmetric crosses, both bottom-aligned so the thumbs rest naturally and the middle of the screen
 * — where the fight is — stays clear. Labels are WORDS, not invented glyphs: `LIGHT`/`HEAVY` are the
 * same names the keyboard legend and the docs use, so a first-time player reads what the button does
 * instead of decoding an icon.
 */
export function touchLayout(width = VIEW_WIDTH, height = STAGE_HEIGHT): TouchButtonSpec[] {
  const r = BUTTON_R;
  const bottom = height - 60; // centre of the lowest row
  const mid = bottom - 90;
  const top = mid - 90;
  const lx = 160;
  const rx = width - 160;
  return [
    { id: "up", x: lx, y: top, r, label: "JUMP" },
    { id: "left", x: lx - 92, y: mid, r, label: "◀" },
    { id: "right", x: lx + 92, y: mid, r, label: "▶" },
    { id: "down", x: lx, y: bottom, r, label: "CROUCH" },
    { id: "block", x: rx, y: top, r, label: "BLOCK" },
    { id: "light", x: rx - 92, y: mid, r, label: "LIGHT" },
    { id: "heavy", x: rx + 92, y: mid, r, label: "HEAVY" },
    { id: "special", x: rx, y: bottom, r, label: "SUPER" },
  ];
}

/** Which button contains this point, or null. Exported for the tests; the state class uses it too. */
export function hitButton(layout: TouchButtonSpec[], x: number, y: number): TouchButton | null {
  for (const b of layout) {
    const dx = x - b.x;
    const dy = y - b.y;
    if (dx * dx + dy * dy <= b.r * b.r) return b.id;
  }
  return null;
}

function emptyHeld(): TouchHeld {
  return { left: false, right: false, up: false, down: false, light: false, heavy: false, block: false, special: false };
}

/** A mash cannot bank more than this many presses; beyond it the queue is the player's problem. */
const MAX_QUEUED = 2;

/**
 * Contacts in, held flags out.
 *
 * `consume()` is a queued press counter with a forced release gap, NOT a plain "is a finger on it"
 * read, because two separate things break the naive version:
 *
 *  1. A tap whose touchstart and touchend both land between two `game.step`s is never seen as held.
 *     Phaser dispatches touch synchronously from the DOM listener rather than queuing it for the next
 *     step, so this is not a rare interleaving — it is what a quick tap does, and under the e2e's
 *     pumped clock it is what EVERY `touchscreen.tap` does. The attack would silently not come out.
 *  2. Sticky-until-read still drops the SECOND of two fast taps: if the previous frame already
 *     reported `true`, `InputReader.prev` is `true`, so reporting `true` again produces no rising
 *     edge. Mashing LIGHT is the most common thing a phone player does.
 *
 * So a press is QUEUED on touchdown and released one frame at a time, and a queued press waiting
 * behind a frame that already read `true` first forces one `false` frame — the gap the edge detector
 * needs. Cost: one frame (16 ms) of latency on the second of two very fast taps, which is invisible;
 * benefit: every tap produces exactly one edge.
 */
export class TouchPadState {
  private layout: TouchButtonSpec[];
  /** live contacts per button — a Set because two thumbs can share a button and lifting one of them
   *  must not release it */
  private pointers = new Map<TouchButton, Set<number>>();
  /** which button each live pointer is currently on (for move/up without a hit test). A pointer that
   *  has slid into the gap is absent here but still in `padPointers`. */
  private assigned = new Map<number, TouchButton>();
  /** pointers whose touchdown landed ON a button. Tracked separately from `assigned` so a thumb can
   *  slide off a button and back on — it is the same finger, still down — while a pointer that began
   *  somewhere else (the MENU button, a stray palm) can never grab one mid-drag. */
  private padPointers = new Set<number>();
  private queued: Record<TouchButton, number>;
  private lastOut: TouchHeld = emptyHeld();
  /** while false, down/move are ignored — a hidden pad must not collect contacts */
  private active = true;

  constructor(layout: TouchButtonSpec[] = touchLayout()) {
    this.layout = layout;
    this.queued = { left: 0, right: 0, up: 0, down: 0, light: 0, heavy: 0, block: 0, special: 0 };
    for (const b of TOUCH_BUTTONS) this.pointers.set(b, new Set());
  }

  setActive(on: boolean): void {
    this.active = on;
    if (!on) this.cancel();
  }

  /**
   * Move the buttons — the game width is not a constant (render/viewport.ts), so the pad re-anchors
   * to the screen edges when the viewport changes.
   *
   * `cancel()` FIRST, and it is not optional: every live contact is recorded against the button it
   * was over, and after the swap those assignments describe positions that no longer exist. A thumb
   * resting on LIGHT at the old x would keep LIGHT held while the drawn button sits somewhere else —
   * a stuck input with no visible cause. Dropping the contacts costs the player one re-press during
   * a rotation they are already not playing through.
   */
  setLayout(layout: TouchButtonSpec[]): void {
    this.cancel();
    this.layout = layout;
  }

  down(pointerId: number, x: number, y: number): void {
    if (!this.active) return;
    const b = hitButton(this.layout, x, y);
    if (!b) return;
    this.padPointers.add(pointerId);
    this.assigned.set(pointerId, b);
    this.pointers.get(b)!.add(pointerId);
    this.queued[b] = Math.min(this.queued[b] + 1, MAX_QUEUED);
  }

  /** A thumb that slides off a button releases it; sliding ONTO another button takes that one. */
  move(pointerId: number, x: number, y: number): void {
    if (!this.active || !this.padPointers.has(pointerId)) return;
    const was = this.assigned.get(pointerId);
    const now = hitButton(this.layout, x, y);
    if (now === was) return;
    if (was !== undefined) this.pointers.get(was)!.delete(pointerId);
    if (now) {
      this.assigned.set(pointerId, now);
      this.pointers.get(now)!.add(pointerId);
      // deliberately NO queued++ here: a slide is not a press, and queueing it would fire an attack
      // the player never tapped.
    } else {
      this.assigned.delete(pointerId);
    }
  }

  up(pointerId: number): void {
    this.padPointers.delete(pointerId);
    const b = this.assigned.get(pointerId);
    if (b === undefined) return;
    this.pointers.get(b)!.delete(pointerId);
    this.assigned.delete(pointerId);
  }

  /** Pointer ids Phaser still considers live. Anything we track that is not here gets released — a
   *  self-healing net under whichever terminal event (pointercancel, a shutdown mid-gesture) we did
   *  not subscribe to. */
  reconcile(liveIds: Iterable<number>): void {
    const live = new Set(liveIds);
    // padPointers, not assigned: a thumb that slid into the gap is still ours to clean up.
    for (const id of [...this.padPointers]) if (!live.has(id)) this.up(id);
  }

  cancel(): void {
    for (const set of this.pointers.values()) set.clear();
    this.assigned.clear();
    this.padPointers.clear();
    for (const b of TOUCH_BUTTONS) this.queued[b] = 0;
    this.lastOut = emptyHeld();
  }

  consume(): TouchHeld {
    const out = emptyHeld();
    for (const b of TOUCH_BUTTONS) {
      const held = this.pointers.get(b)!.size > 0;
      if (this.queued[b] > 0 && !this.lastOut[b]) {
        out[b] = true;
        this.queued[b] -= 1;
      } else if (this.queued[b] > 0) {
        out[b] = false; // the forced gap, so the next queued press reads as a rising edge
      } else {
        out[b] = held;
      }
    }
    this.lastOut = out;
    return { ...out };
  }
}
