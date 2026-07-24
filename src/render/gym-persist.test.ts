import { describe, it, expect } from "vitest";
import { guardView, mergeFrameOverride, persistGuard, toAuthored } from "./gym-persist";
import { TEST_DUMMY } from "../sim/config";
import type { CharacterData, FrameOverride } from "../sim/types";

function data(scale = 1): CharacterData {
  const d: CharacterData = JSON.parse(JSON.stringify(TEST_DUMMY));
  d.stats.scale = scale;
  return d;
}

describe("Gym guard persistence", () => {
  it("shows the template in ASSEMBLED space, the same space the overlay draws in", () => {
    const d = data(1.3);
    expect(guardView(d, "guardStand")).toEqual([{ x: -41.6, y: 91, w: 117, h: 136.5 }]);
  });

  it("writes an edited box back to the template, undoing the scale", () => {
    const d = data(1.3);
    const box = guardView(d, "guardCrouch")[0];
    box.y += 13; // nudge in assembled space, as a drag would
    persistGuard(d, "guardCrouch", 0, box);
    expect(d.boxes.guardCrouch[0].y).toBe(10); // 13 / 1.3
    // …and the round trip is stable: reading the view back gives what was dragged
    expect(guardView(d, "guardCrouch")[0].y).toBeCloseTo(13, 6);
  });

  it("edits the STANCE, never a per-frame override", () => {
    const d = data();
    persistGuard(d, "guardStand", 0, { x: 1, y: 2, w: 3, h: 4 });
    expect(d.boxes.guardStand[0]).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(d.overrides).toBeUndefined();
  });

  it("ignores an index the template does not have", () => {
    const d = data();
    persistGuard(d, "guardStand", 7, { x: 1, y: 2, w: 3, h: 4 });
    expect(d.boxes.guardStand.length).toBe(1);
  });

  it("rounds to 2dp, not to integers, so a fractional scale round-trips", () => {
    // Integer rounding at scale 1.3 turns 56 into 72.8 -> 73 -> 56.15: the box creeps every edit.
    expect(toAuthored({ x: 72.8, y: 0, w: 72.8, h: 0.001 }, 1.3)).toEqual({ x: 56, y: 0, w: 56, h: 0 });
  });

  it("a body-box edit preserves an existing per-frame GUARD override on that frame", () => {
    // The Gym never authors a per-frame guard override, but a hand-authored JSON can carry one.
    // Rebuilding the frame's override from only hurt/push/hit on a hurt drag would silently drop it.
    const existing: FrameOverride = { frame: 1, guardCrouch: [{ x: 1, y: 2, w: 3, h: 4 }] };
    const next: FrameOverride = { frame: 1, hurt: [{ x: 0, y: 0, w: 9, h: 9 }], push: { x: 0, y: 0, w: 1, h: 1 } };
    expect(mergeFrameOverride(existing, next)).toEqual({
      frame: 1,
      hurt: [{ x: 0, y: 0, w: 9, h: 9 }],
      push: { x: 0, y: 0, w: 1, h: 1 },
      guardCrouch: [{ x: 1, y: 2, w: 3, h: 4 }],
    });
  });

  it("mergeFrameOverride returns the new entry unchanged when nothing pre-existed", () => {
    const next: FrameOverride = { frame: 0, push: { x: 0, y: 0, w: 1, h: 1 } };
    expect(mergeFrameOverride(undefined, next)).toEqual(next);
  });
});
