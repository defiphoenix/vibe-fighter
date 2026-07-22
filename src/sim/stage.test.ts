import { describe, it, expect } from "vitest";
import { World } from "./world";
import { FIGHTER_A, FIGHTER_B } from "./config";
import { emptyInput, type InputSnapshot } from "./types";
import { STAGE_WIDTH, VIEW_WIDTH, STAGE_MARGIN, MAX_SEPARATION } from "./constants";

function mk(over: Partial<InputSnapshot> = {}): InputSnapshot {
  return { ...emptyInput(), ...over };
}

// Phase 08 split STAGE_WIDTH (world) from VIEW_WIDTH (camera). These tests keep the split honest:
// the world must be genuinely wider than the viewport, and a fighter must be able to walk into the
// region that only exists because of that extra width (otherwise there's nothing to scroll).
describe("Phase 08 world > viewport", () => {
  it("world is wider than the camera viewport", () => {
    expect(VIEW_WIDTH).toBeLessThan(STAGE_WIDTH);
  });

  it("a fighter can walk past the right edge of one viewport", () => {
    const w = new World(FIGHTER_A, FIGHTER_B);
    w.match.phase = "fight";
    w.match.introTicks = 0;
    const right = mk({ right: true });
    for (let i = 0; i < 600; i++) w.tick([right, mk()]);
    // MAX_X = STAGE_WIDTH - STAGE_MARGIN = 1606, well past VIEW_WIDTH - STAGE_MARGIN = 1190.
    expect(w.fighters[0].x).toBeGreaterThan(VIEW_WIDTH - STAGE_MARGIN);
    expect(w.fighters[0].x).toBeLessThanOrEqual(STAGE_WIDTH - STAGE_MARGIN + 1e-6);
  });
});

// The follow-camera is 1:1 zoom over a world wider than the viewport, so a pair further apart than
// VIEW_WIDTH would leave one (or both) off-screen. spatial.ts caps the gap at MAX_SEPARATION.
describe("max separation cap", () => {
  const sep = (w: World): number => Math.abs(w.fighters[0].x - w.fighters[1].x);
  const inBounds = (x: number): boolean =>
    x >= STAGE_MARGIN - 1e-6 && x <= STAGE_WIDTH - STAGE_MARGIN + 1e-6;

  it("cannot exceed the viewport even when both walk to opposite walls", () => {
    const w = new World(FIGHTER_A, FIGHTER_B);
    w.match.phase = "fight";
    w.match.introTicks = 0;
    // P1 drives to the left wall, P2 to the right wall — 1516px apart uncapped.
    for (let i = 0; i < 600; i++) w.tick([mk({ left: true }), mk({ right: true })]);
    expect(sep(w)).toBeLessThanOrEqual(MAX_SEPARATION + 1e-6);
    expect(inBounds(w.fighters[0].x)).toBe(true);
    expect(inBounds(w.fighters[1].x)).toBe(true);
  });

  it("caps an extreme wall-to-wall placement in a single resolve, staying in bounds", () => {
    const w = new World(FIGHTER_A, FIGHTER_B);
    w.match.phase = "fight";
    w.match.introTicks = 0;
    w.fighters[0].x = STAGE_MARGIN; // 90
    w.fighters[1].x = STAGE_WIDTH - STAGE_MARGIN; // 1606 -> gap 1516
    w.tick([mk(), mk()]);
    expect(sep(w)).toBeLessThanOrEqual(MAX_SEPARATION + 1e-6);
    expect(inBounds(w.fighters[0].x)).toBe(true);
    expect(inBounds(w.fighters[1].x)).toBe(true);
  });
});
