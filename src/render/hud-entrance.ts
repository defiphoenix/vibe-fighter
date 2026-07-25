import { INTRO_TICKS, TICK_HZ } from "../sim/constants";
import type { MatchPhase } from "../sim/match";

/** Match-start HUD entrance: the bars fill while the whole band slides down into place.
 *
 *  Phaser-free on purpose, like `anim-timing.ts` / `camera-frame.ts` / `flow-state.ts`, so vitest can
 *  exercise it in the node env — the HUD is only the adapter that applies these numbers.
 *
 *  Driven by the sim's own intro countdown rather than a clock or a tween. Three reasons:
 *  a tween takes its delta from `Date.now()` (Phaser 4 `TweenManager.getDelta`), so it neither
 *  advances under the e2e's pumped `game.step` nor survives an interruption; deriving from
 *  `introTicks` needs ZERO render state, so the entrance replays on every round and on the
 *  Enter-rematch for free (both go through `MatchState.beginRound`); and an e2e can scrub the whole
 *  animation by writing one number.
 */

const ms = (ticks: number): number => Math.round((ticks / TICK_HZ) * 1000);

/** Slide: 900 ms. `motion-design`'s "dramatic reveal" band is 600-1200 ms and the source prompt's
 *  one piece of feedback was that the first cut was too rapid, so this sits deliberately high — and
 *  distance scales duration, so it went up with SLIDE_DROP_PX below. */
export const SLIDE_TICKS = 54;
/** The fill trails the slide rather than racing it — lead with the hero, and keep the whole stagger
 *  under 500 ms. */
export const FILL_DELAY_TICKS = 18;
/** Fill: 900 ms. Longer than the slide so the bar is still visibly charging after the band lands. */
export const FILL_TICKS = 54;
/** 72 ticks = 1.2 s, inside the 90-tick (1.5 s) intro, leaving 0.3 s settled before "FIGHT!".
 *  A unit test pins that relationship — lengthening these knobs past INTRO_TICKS would otherwise
 *  silently cut the entrance off at the phase change. */
export const ENTRANCE_TICKS = FILL_DELAY_TICKS + FILL_TICKS;
/** How far above its parked y the band starts. Must be >= the band's own bottom edge (TOP + the
 *  portrait plate's scaled height, ~220 px at the shipped scales) or the HUD starts half on-screen
 *  and the "slides down" reads as "twitches down". This module cannot see the band (that is hud.ts,
 *  and it needs Phaser to measure the art), so the relationship is pinned in `e2e/phase14-hud.spec.ts`
 *  against the real objects instead of asserted here against a copied number. */
export const SLIDE_DROP_PX = 240;

export interface HudEntrance {
  /** Added to every parked y. Negative (above the screen edge) until the slide lands, then exactly 0. */
  slideY: number;
  /** 0..1 multiplier on the drawn health fraction. */
  fillFrac: number;
  done: boolean;
}

/** NaN fails both comparisons, so it has to be caught explicitly or it propagates all the way out to
 *  a Game Object's `y` — where Phaser silently stops rendering rather than throwing. Treat a
 *  non-finite countdown as "not started". */
const clamp01 = (v: number): number => (Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0);

/** Entrance easings. Decelerate on the way in — never linear for spatial motion. The fill is the one
 *  place a gentler curve is fine (it reads as a charge, not a move), hence quad vs cubic. */
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeOutQuad = (t: number): number => 1 - (1 - t) * (1 - t);

/** Where the entrance is, given the sim's phase and intro countdown.
 *
 *  Any phase but `intro` is settled: by the time a round can end, the 72-tick entrance is long done,
 *  and `beginRound()` restores `introTicks` to full for the next one. */
export function hudEntrance(phase: MatchPhase, introTicks: number): HudEntrance {
  const elapsed = phase === "intro" ? INTRO_TICKS - introTicks : ENTRANCE_TICKS;
  const slide = easeOutCubic(clamp01(elapsed / SLIDE_TICKS));
  const fill = easeOutQuad(clamp01((elapsed - FILL_DELAY_TICKS) / FILL_TICKS));
  return {
    // Written as (slide - 1) rather than -(1 - slide) so a settled entrance lands on +0, not -0:
    // Object.is separates them, and the test that pins "exactly parked" should mean it.
    slideY: SLIDE_DROP_PX * (slide - 1),
    fillFrac: fill,
    done: elapsed >= ENTRANCE_TICKS,
  };
}

/** Human-readable durations, for the phase log and for anyone tuning the knobs above. */
export const ENTRANCE_MS = {
  slide: ms(SLIDE_TICKS),
  fillDelay: ms(FILL_DELAY_TICKS),
  fill: ms(FILL_TICKS),
  total: ms(ENTRANCE_TICKS),
};
