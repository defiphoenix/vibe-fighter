import { TICK_HZ } from "../sim/constants";

/** The super cut-in: the special's portrait sweeps in from the left over the frozen world.
 *
 *  Phaser-free on purpose, exactly like `hud-entrance.ts` — and for the same three reasons. A tween
 *  takes its delta from `Date.now()` (Phaser 4 `TweenManager.getDelta`), so it neither advances under
 *  the e2e's pumped `game.step` nor survives an interruption; deriving from the sim's own freeze
 *  countdown needs ZERO render state, so the cut-in replays on every special for free; and an e2e can
 *  scrub the whole animation by writing one number.
 *
 *  The driving number is `World.hitstop` while a special's super freeze is running. That is a real sim
 *  value counting down at 60 Hz, so this is frame-rate independent and identical on every replay.
 */

/** Fraction of the freeze spent sliding in. The rest is the hold — the portrait has to actually be
 *  READ, and the source video's cut-in lingers. Slide fast, hold long. */
const SLIDE_FRAC = 0.35;
/** Fraction spent sliding back out at the end. Faster than the entrance: an exit that matches its
 *  entrance in length reads as hesitation. */
const EXIT_FRAC = 0.2;
/** How far off the left edge the portrait starts, as a fraction of its own width. >1 so it is fully
 *  clear of the screen before it moves. */
const OFF_LEFT = 1.15;

export interface SuperCutIn {
  /** 0..1 across the portrait's own width: 0 = parked at its on-screen x, negative = still off-left. */
  x: number;
  /** 0..1 opacity for the portrait and the scrim behind it. */
  alpha: number;
  /** 0..1 position of the light sweep travelling across the portrait. */
  sweep: number;
  done: boolean;
}

/** NaN fails both comparisons, so catch it explicitly or it reaches a Game Object's `x`, where Phaser
 *  silently stops rendering rather than throwing. Same trap `hud-entrance.ts` documents. */
const clamp01 = (v: number): number => (Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0);

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number): number => t * t * t;

/**
 * Where the cut-in is, given the freeze it was armed with and how much of that freeze is left.
 *
 * `remaining` is `World.hitstop`, which counts DOWN. When it reaches 0 the world is moving again and
 * the cut-in is done — so a caller that loses track (a KO, a scene restart) degrades to "not
 * showing" rather than to a portrait stuck on screen.
 */
export function superCutIn(freezeTicks: number, remaining: number): SuperCutIn {
  if (!Number.isFinite(freezeTicks) || freezeTicks <= 0) return { x: -OFF_LEFT, alpha: 0, sweep: 0, done: true };
  const t = clamp01((freezeTicks - remaining) / freezeTicks); // 0 at the start of the freeze, 1 at its end

  const slideIn = easeOutCubic(clamp01(t / SLIDE_FRAC));
  const slideOut = easeInCubic(clamp01((t - (1 - EXIT_FRAC)) / EXIT_FRAC));

  return {
    // In from off-left, then back out the same way. Written as one expression so the portrait can
    // never be left mid-screen by a freeze that ends early.
    x: OFF_LEFT * (slideIn - 1) - OFF_LEFT * slideOut,
    alpha: clamp01(slideIn) * (1 - slideOut),
    // The sweep crosses once, during the hold — it is the beat that says "this is the moment".
    sweep: clamp01((t - SLIDE_FRAC) / Math.max(1e-6, 1 - SLIDE_FRAC - EXIT_FRAC)),
    done: remaining <= 0,
  };
}

/** Human-readable durations for the phase log and for anyone tuning the knobs above. */
export const cutInMs = (freezeTicks: number) => ({
  total: Math.round((freezeTicks / TICK_HZ) * 1000),
  slide: Math.round(((freezeTicks * SLIDE_FRAC) / TICK_HZ) * 1000),
  exit: Math.round(((freezeTicks * EXIT_FRAC) / TICK_HZ) * 1000),
});
