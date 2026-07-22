import * as Phaser from "phaser";
import { Fighter } from "../sim/fighter";
import { toWorld } from "../sim/geometry";
import { allHitBoxes } from "../sim/character-builder";
import { isAttackState } from "../sim/types";
import type { Box } from "../sim/types";

// debug box colors — one per bound kind
const COL = {
  hurt: 0x33dd55,
  hit: 0xff3355,
  push: 0xffffff,
  guard: 0x33bbff,
};

// A bound that can only be live on some frames draws SOLID while active and FAINT while inactive:
// still perceivable, obviously weaker. Bounds that are always live (hurt/push) are always solid.
// 0.28 measured as near-invisible against the dusk sky and the warm rooftop (QA screenshots) — the
// backdrop competes with red/blue at low alpha, so faint also gets a DASHED stroke, which reads as
// "not live" independently of how bright the pixels behind it are.
const SOLID = 1.0;
const FAINT = 0.5;
const DASH = 8; // px on, px off

/** Which bound kinds to draw. All four on = the historical overlay. */
export interface BoundsToggles {
  hurt: boolean;
  hit: boolean;
  push: boolean;
  guard: boolean;
}

export const BOUND_KINDS = ["hurt", "hit", "push", "guard"] as const;

export const allBounds = (on: boolean): BoundsToggles => ({ hurt: on, hit: on, push: on, guard: on });

const ALL_ON = allBounds(true);

function drawBoxes(g: Phaser.GameObjects.Graphics, boxes: Box[], f: Fighter, color: number, alpha: number): void {
  const dashed = alpha === FAINT;
  g.lineStyle(2, color, alpha);
  g.fillStyle(color, alpha * 0.18);
  for (const b of boxes) {
    const w = toWorld(b, f.x, f.y, f.facing);
    if (dashed) strokeDashedRect(g, w.left, w.top, w.right - w.left, w.bottom - w.top);
    else g.strokeRect(w.left, w.top, w.right - w.left, w.bottom - w.top);
    g.fillRect(w.left, w.top, w.right - w.left, w.bottom - w.top);
  }
}

/** Dashed rectangle outline — Phaser Graphics has no line-dash, so walk each edge in DASH steps. */
function strokeDashedRect(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
  const edge = (x1: number, y1: number, x2: number, y2: number): void => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    for (let d = 0; d < len; d += DASH * 2) {
      const e = Math.min(d + DASH, len);
      g.lineBetween(x1 + ux * d, y1 + uy * d, x1 + ux * e, y1 + uy * e);
    }
  };
  edge(x, y, x + w, y);
  edge(x + w, y, x + w, y + h);
  edge(x + w, y + h, x, y + h);
  edge(x, y + h, x, y);
}

/** Draw the four box kinds for one fighter, faint when the bound isn't live this frame. */
export function drawDebugBoxes(g: Phaser.GameObjects.Graphics, f: Fighter, show: BoundsToggles = ALL_ON): void {
  const boxes = f.activeBoxes();
  if (show.push) drawBoxes(g, [boxes.push], f, COL.push, 0.5);
  if (show.hurt) drawBoxes(g, boxes.hurt, f, COL.hurt, 0.8);

  // Guard: the sim only resolves a guard box while `guarding` (block held, grounded, guardable
  // state). Show the stance's box faint the rest of the time so you can see WHERE it would protect
  // before committing. crouchIntent picks high vs low, exactly as activeBoxes does.
  if (show.guard) {
    if (boxes.guard.length) drawBoxes(g, boxes.guard, f, COL.guard, SOLID);
    else drawBoxes(g, f.crouchIntent ? f.cfg.guardCrouch : f.cfg.guardStand, f, COL.guard, FAINT);
  }

  // Hit: live only during an attack's active window. Outside it, show the move's whole reach faint
  // during startup/recovery so the frame data is readable while tuning.
  if (show.hit) {
    if (boxes.hit.length) drawBoxes(g, boxes.hit, f, COL.hit, SOLID);
    else if (isAttackState(f.state)) drawBoxes(g, allHitBoxes(f.cfg, f.state), f, COL.hit, FAINT);
  }
}
