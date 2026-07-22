import { describe, it, expect } from "vitest";
import { groupZoom, stepZoom, ZOOM_MAX, ZOOM_PAD, ZOOM_EPS } from "./camera-frame";
import { VIEW_WIDTH, MAX_SEPARATION, STAGE_HEIGHT, GROUND_Y } from "../sim/constants";

describe("groupZoom", () => {
  it("is exactly 1 at the sim's max separation — the curve meets the un-zoomed camera with no step", () => {
    expect(ZOOM_PAD).toBe(VIEW_WIDTH - MAX_SEPARATION);
    expect(groupZoom(MAX_SEPARATION)).toBe(1);
  });

  it("never zooms OUT, at any separation", () => {
    // A zoom < 1 would show more than STAGE_HEIGHT vertically, and the stage art is exactly that
    // tall — empty bands. Sweep past the cap and past anything the sim can produce.
    for (let sep = 0; sep <= 2000; sep += 10) {
      expect(groupZoom(sep)).toBeGreaterThanOrEqual(1);
    }
    expect(groupZoom(1e9)).toBe(1);
  });

  it("clamps to ZOOM_MAX at contact range and is monotonically non-increasing in separation", () => {
    expect(groupZoom(0)).toBe(ZOOM_MAX);
    expect(groupZoom(120)).toBe(ZOOM_MAX); // pushboxes touching
    let prev = Infinity;
    for (let sep = 0; sep <= MAX_SEPARATION; sep += 5) {
      const z = groupZoom(sep);
      expect(z).toBeLessThanOrEqual(prev + 1e-12);
      prev = z;
    }
  });

  it("keeps the whole jump arc on screen at every reachable zoom (bottom-anchored view)", () => {
    // The view is bottom-aligned, so its top edge is STAGE_HEIGHT - STAGE_HEIGHT/zoom. The highest
    // art pixel is the top of a fighter at the apex of the highest jump in the roster.
    const FIGHTER_H = 185;
    const APEX = (980 * 980) / (2 * 2600); // monk: jumpVelocity^2 / 2*gravity ~= 184.6
    const highest = GROUND_Y - FIGHTER_H - APEX;
    for (let sep = 0; sep <= MAX_SEPARATION; sep += 5) {
      const viewTop = STAGE_HEIGHT - STAGE_HEIGHT / groupZoom(sep);
      expect(viewTop).toBeLessThan(highest);
    }
  });

  it("treats a negative separation as zero rather than inverting the zoom", () => {
    expect(groupZoom(-500)).toBe(ZOOM_MAX);
  });
});

describe("stepZoom", () => {
  it("moves toward the target and snaps once inside the epsilon", () => {
    const mid = stepZoom(1, ZOOM_MAX);
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(ZOOM_MAX);
    expect(stepZoom(ZOOM_MAX - ZOOM_EPS / 2, ZOOM_MAX)).toBe(ZOOM_MAX);
    expect(stepZoom(1, 1)).toBe(1);
  });

  it("converges from either direction and never overshoots the [1, ZOOM_MAX] band", () => {
    for (const [from, to] of [[1, ZOOM_MAX], [ZOOM_MAX, 1]] as const) {
      let z: number = from;
      for (let i = 0; i < 200; i++) {
        z = stepZoom(z, to);
        expect(z).toBeGreaterThanOrEqual(1);
        expect(z).toBeLessThanOrEqual(ZOOM_MAX);
      }
      expect(z).toBe(to);
    }
  });
});
