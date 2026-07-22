import type { Box, AABB } from "./types";

/** Convert a fighter-local box to a world AABB.
 *  px = feet center x, py = feet y (screen y-down), dir = +1 facing right, -1 facing left.
 *  Local +x is forward (facing dir); local +y is up (so world y = py - localUp). */
export function toWorld(box: Box, px: number, py: number, dir: 1 | -1): AABB {
  const x1 = px + dir * box.x;
  const x2 = px + dir * (box.x + box.w);
  const top = py - (box.y + box.h);
  const bottom = py - box.y;
  return {
    left: Math.min(x1, x2),
    right: Math.max(x1, x2),
    top,
    bottom,
  };
}

export function overlaps(a: AABB, b: AABB): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** signed horizontal overlap depth of two AABBs (0 if none) */
export function xOverlapDepth(a: AABB, b: AABB): number {
  const d = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  return d > 0 ? d : 0;
}
