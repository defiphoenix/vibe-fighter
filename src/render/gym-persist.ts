import type { Box, CharacterData, FrameOverride } from "../sim/types";

// The Gym's save arithmetic, kept out of GymScene so vitest's node env can reach it (same reason
// edge-latch.ts / anim-timing.ts live outside their scenes). No Phaser, no DOM.
//
// Every box the Gym draws is in ASSEMBLED space — character-builder has already multiplied it by
// stats.scale — while every box it SAVES is authored unscaled. That inverse is the whole job.

export type GuardKind = "guardStand" | "guardCrouch";

/** 2dp, never integers: at scale 1.3 an integer round turns 56 into 72.8 → 73 → 56.15, so a box
 *  creeps a little every time it is touched. */
const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Assembled-space box → the number to store in CharacterData. */
export function toAuthored(b: Box, scale: number): Box {
  return { x: r2(b.x / scale), y: r2(b.y / scale), w: r2(b.w / scale), h: r2(b.h / scale) };
}

/**
 * The guard stance template as the Gym shows it: authored × stats.scale, matching the overlay.
 *
 * Deliberately NOT the assembled frame's guard boxes. Guard edits write the whole stance, and a
 * frame may already carry a hand-authored per-frame override — editing that frame's box and saving
 * it as the template would smear one frame's shape across every other frame while leaving the
 * override in place.
 */
export function guardView(data: CharacterData, kind: GuardKind): Box[] {
  const s = data.stats.scale;
  return data.boxes[kind].map((b) => ({ x: r2(b.x * s), y: r2(b.y * s), w: r2(b.w * s), h: r2(b.h * s) }));
}

/** Write one edited (assembled-space) guard box back into the stance template. */
export function persistGuard(data: CharacterData, kind: GuardKind, idx: number, box: Box): void {
  if (idx < 0 || idx >= data.boxes[kind].length) return;
  data.boxes[kind][idx] = toAuthored(box, data.stats.scale);
}

/**
 * Merge a freshly-built BODY override (hurt/push/hit for one frame) onto whatever override already
 * existed for that frame, carrying over its guard fields.
 *
 * The Gym only ever authors guard as a stance template, never as a per-frame override — but a
 * hand-authored JSON can carry a per-frame guard override, and the Gym rebuilds a frame's override
 * from scratch on every hurt/push/hit edit. Without this merge, one hurt drag would silently delete
 * that frame's authored guard box.
 */
export function mergeFrameOverride(existing: FrameOverride | undefined, next: FrameOverride): FrameOverride {
  if (!existing) return next;
  const merged: FrameOverride = { ...next };
  if (existing.guardStand) merged.guardStand = existing.guardStand;
  if (existing.guardCrouch) merged.guardCrouch = existing.guardCrouch;
  return merged;
}
