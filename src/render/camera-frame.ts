import { VIEW_WIDTH, MAX_SEPARATION } from "../sim/constants";

/**
 * Group-camera framing math. Phaser-free on purpose, like `edge-latch.ts` / `flow-state.ts` /
 * `anim-timing.ts`, so vitest can exercise it in the node env — the scene is only the adapter that
 * feeds these numbers to `cameras.main`.
 *
 * The camera zooms IN when the fighters close, and never OUT. Zooming out was rejected in Phase 08
 * and the reason still holds: the stage art is exactly STAGE_HEIGHT tall, so any zoom < 1 exposes
 * empty bands above and below it. Framing at maximum separation is already solved in the sim —
 * `spatial.ts` caps the pair at MAX_SEPARATION < VIEW_WIDTH — so 1.0 is the widest the camera ever
 * needs to be, and everything above it is pure gain: at the start gap the fighters otherwise sit in
 * a lot of empty stage.
 */

/** Widest zoom. Bounded by the vertical budget, not taste: bottom-anchored at zoom Z the view top is
 *  world y = STAGE_HEIGHT - STAGE_HEIGHT/Z, and the highest art pixel is y ~= 250 (620 ground - 185
 *  fighter height - 185 jump apex, the monk's 980/2600 being the highest in the roster), so the
 *  ceiling is Z = 1.53. 1.25 keeps a comfortable margin. ponytail: eyeball-tuned within that budget. */
export const ZOOM_MAX = 1.25;
/** Slack added to the pair's separation before fitting it to the viewport. Chosen so groupZoom is
 *  exactly 1.0 at MAX_SEPARATION — the curve meets the un-zoomed camera continuously, with no step. */
export const ZOOM_PAD = VIEW_WIDTH - MAX_SEPARATION; // 240
/** Per-frame approach rate toward the target zoom.
 *  ponytail: frame-rate dependent (render-only, never feeds the sim); make it dt-based if the game
 *  ever runs at anything but 60 Hz. */
export const ZOOM_LERP = 0.12;
/** Below this the lerp snaps, so the zoom settles exactly instead of asymptoting forever. */
export const ZOOM_EPS = 0.001;

/** Zoom that frames a pair `sep` pixels apart, clamped to [1, ZOOM_MAX]. */
export function groupZoom(sep: number): number {
  const want = VIEW_WIDTH / (Math.max(0, sep) + ZOOM_PAD);
  return Math.min(ZOOM_MAX, Math.max(1, want));
}

/** One frame of easing toward `target`. Snaps once inside ZOOM_EPS. */
export function stepZoom(cur: number, target: number): number {
  if (Math.abs(target - cur) <= ZOOM_EPS) return target;
  return cur + (target - cur) * ZOOM_LERP;
}
