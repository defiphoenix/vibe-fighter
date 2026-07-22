import { Fighter } from "./fighter";
import { toWorld, overlaps, xOverlapDepth } from "./geometry";
import { STAGE_MARGIN, STAGE_WIDTH, MAX_SEPARATION } from "./constants";

const MIN_X = STAGE_MARGIN;
const MAX_X = STAGE_WIDTH - STAGE_MARGIN;

function clampX(f: Fighter): void {
  if (f.x < MIN_X) f.x = MIN_X;
  else if (f.x > MAX_X) f.x = MAX_X;
}

/** Step 5: resolve pushbox overlap AND stage bounds as coupled constraints.
 *  When a cornered fighter can't move, the residual penetration is transferred to the other. */
export function resolveSpatial(a: Fighter, b: Fighter): void {
  for (let iter = 0; iter < 4; iter++) {
    // clamp FIRST so a corner (both walking into the wall) is measured after bounds,
    // otherwise the no-overlap early exit can leave residual penetration at the wall.
    clampX(a);
    clampX(b);
    const ab = toWorld(a.activeBoxes().push, a.x, a.y, a.facing);
    const bb = toWorld(b.activeBoxes().push, b.x, b.y, b.facing);
    if (!overlaps(ab, bb)) break; // includes vertical check — a jump-over won't push
    const depth = xOverlapDepth(ab, bb);
    if (depth <= 0) break;

    const left = a.x <= b.x ? a : b;
    const right = left === a ? b : a;
    left.x -= depth / 2;
    right.x += depth / 2;

    // transfer penetration off the walls
    if (left.x < MIN_X) {
      right.x += MIN_X - left.x;
      left.x = MIN_X;
    }
    if (right.x > MAX_X) {
      left.x -= right.x - MAX_X;
      right.x = MAX_X;
    }
    clampX(left);
    clampX(right);
  }
  clampX(a);
  clampX(b);

  // Cap max separation so the follow-camera can always frame both (see MAX_SEPARATION). Only ever
  // REDUCES the gap; runs after the wall clamp, and a midpoint near a wall just clamps back in (which
  // tightens the gap further, still <= cap). Safe for the roster because every pushbox is far
  // narrower than the cap, so pulling to MAX_SEPARATION can't reintroduce overlap. (validate-character
  // caps no box WIDTH, so a pathological pushbox wider than MAX_SEPARATION could — not a real config.)
  // ponytail: symmetric pull toward the midpoint drags the stationary fighter a little at the
  // extreme; make it intent-aware (move only the one increasing the gap) if it ever feels draggy.
  const lo = Math.min(a.x, b.x);
  const hi = Math.max(a.x, b.x);
  if (hi - lo > MAX_SEPARATION) {
    const mid = (lo + hi) / 2;
    const aLeft = a.x <= b.x;
    a.x = aLeft ? mid - MAX_SEPARATION / 2 : mid + MAX_SEPARATION / 2;
    b.x = aLeft ? mid + MAX_SEPARATION / 2 : mid - MAX_SEPARATION / 2;
    clampX(a);
    clampX(b);
  }
}
