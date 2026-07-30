import { VIEW_WIDTH, STAGE_WIDTH, STAGE_HEIGHT } from "../sim/constants";

/**
 * The camera width decision, kept Phaser-free so vitest's node env can reach it — the same reason
 * `edge-latch.ts`, `flow-state.ts` and `meter-view.ts` live outside their scenes.
 *
 * The game is authored at VIEW_WIDTH x STAGE_HEIGHT (16:9). A phone in landscape is far wider than
 * that — a Pixel 5 is 851x393, about 2.17:1 — so `Scale.FIT` alone pillarboxes the canvas and ~18% of
 * the screen is bar. Instead `main.ts` reshapes the GAME to the device's aspect and lets FIT scale a
 * canvas that already fits, which leaves zero bars for any aspect between 16:9 and STAGE_WIDTH:720.
 *
 * The height never changes. The stage art is exactly STAGE_HEIGHT tall, so a taller game would show
 * empty bands above it and would break the bottom-aligned `centerOn` in MatchScene's camera code.
 * Only the WIDTH moves, and only between the authored viewport and the world:
 *
 *   - below VIEW_WIDTH we would show LESS than the game was laid out for (menus are budgeted against
 *     it — see `characterCardWidth`), so that is the floor and a narrow window letterboxes as before;
 *   - above STAGE_WIDTH the camera would need world that does not exist, so that is the ceiling.
 *
 * The sim is untouched: `MAX_SEPARATION` is still `VIEW_WIDTH - 240`, so the pair is framed at any of
 * these widths and the extra pixels show more rooftop, never more fighter separation.
 *
 * NOTE this is deliberately NOT `Phaser.Scale.EXPAND`. EXPAND computes the same shape, but
 * `scale.min`/`max` are the only way to bound it and `parseConfig` maps them onto `displaySize` — the
 * CSS size — where `Size.getNewWidth` clamps to `minWidth` BEFORE comparing to the parent. A
 * `min.width` of 1280 therefore writes `style.width: 1280px` onto an 851px phone viewport. Verified in
 * ScaleManager.js:577-585 and structs/Size.js.
 */

/** Never narrower than the authored viewport: the menus are budgeted against this width. */
export const VIEW_MIN_WIDTH = VIEW_WIDTH; // 1280
/** Never wider than the WORLD, or the camera would need stage that does not exist. */
export const VIEW_MAX_WIDTH = STAGE_WIDTH; // 1696
/**
 * A mobile URL bar animating in or out changes the viewport a pixel at a time, and every changed
 * pixel would otherwise be a full relayout of the HUD, the pad and the menu. Ignore sub-deadband
 * moves; they are invisible at the scale the canvas is then drawn at.
 */
export const VIEW_WIDTH_DEADBAND = 2;

/** The game width whose aspect matches this parent at the pinned STAGE_HEIGHT. */
export function viewWidthFor(parentW: number, parentH: number): number {
  // A parent with no computed size yet (Phaser's getParentBounds can store zeros) is not a device
  // claim — fall back to the authored width rather than dividing by it.
  if (!Number.isFinite(parentW) || !Number.isFinite(parentH) || parentW <= 0 || parentH <= 0) {
    return VIEW_MIN_WIDTH;
  }
  return clampWidth(Math.round((STAGE_HEIGHT * parentW) / parentH));
}

/**
 * Whatever Phaser reports as the current game width, made safe to lay out against. Every `layout()`
 * takes this rather than `gameSize.width` raw, so a fractional or out-of-range width can never reach
 * the HUD's arithmetic.
 */
export function liveWidth(gameWidth: number): number {
  if (!Number.isFinite(gameWidth)) return VIEW_MIN_WIDTH;
  return clampWidth(Math.round(gameWidth));
}

function clampWidth(w: number): number {
  return Math.min(VIEW_MAX_WIDTH, Math.max(VIEW_MIN_WIDTH, w));
}
