import { describe, it, expect } from "vitest";
import { meterView, UNREADY_SPAN } from "./meter-view";
import { METER_MAX } from "../sim/fighter";

describe("meter view", () => {
  it("is ready only at or above METER_MAX, matching the sim's gate exactly", () => {
    for (const m of [0, 50, 96, 98, 99, METER_MAX - 1]) {
      expect(meterView(m).ready, `meter ${m} must not be ready`).toBe(false);
    }
    for (const m of [METER_MAX, METER_MAX + 1, 250]) {
      expect(meterView(m).ready, `meter ${m} must be ready`).toBe(true);
    }
  });

  // The defect this module exists for: jiujitsu and monk rest on 98 after seven clean heavies, and
  // 98/100 of the slot is full width to the eye.
  it("never draws an unready bar as a full slot", () => {
    for (const m of [96, 97, 98, 99]) {
      expect(meterView(m).fillFrac, `meter ${m} drew a full slot`).toBeLessThanOrEqual(UNREADY_SPAN);
    }
  });

  it("makes the step from one-short to ready visible, not 1% of the slot", () => {
    const gap = meterView(METER_MAX).fillFrac - meterView(METER_MAX - 1).fillFrac;
    expect(gap).toBeGreaterThan(0.05);
  });

  it("fills the whole slot once ready", () => {
    expect(meterView(METER_MAX).fillFrac).toBe(1);
    expect(meterView(METER_MAX + 40).fillFrac).toBe(1);
  });

  it("stays monotonic so charging still reads as progress", () => {
    let prev = -1;
    for (let m = 0; m <= METER_MAX; m++) {
      const f = meterView(m).fillFrac;
      expect(f, `meter ${m} went backwards`).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  it("rides the HUD entrance's fill fraction", () => {
    expect(meterView(METER_MAX, 0).fillFrac).toBe(0);
    expect(meterView(METER_MAX, 0.5).fillFrac).toBe(0.5);
    // readiness is about the sim's number, never the entrance animation
    expect(meterView(METER_MAX, 0).ready).toBe(true);
  });

  // Caught in review, not by play: `Fighter.meter` survives `reset()`, so a fighter who banks a full
  // bar in round 1 enters round 2's entrance ready while the drawn bar is still at zero. Keying the
  // cue off `ready` alone put "MAX" over a visibly empty meter for the first ~18 ticks of every later
  // round — the same disagreement between the cue and the drawing that this module exists to end.
  it("holds the MAX cue back until the bar it labels has actually charged", () => {
    expect(meterView(METER_MAX, 0).showMax, "MAX over an empty bar").toBe(false);
    expect(meterView(METER_MAX, 0.5).showMax, "MAX over a half-drawn bar").toBe(false);
    expect(meterView(METER_MAX, 0.99).showMax).toBe(false);
    expect(meterView(METER_MAX, 1).showMax).toBe(true);
    // ...and never on a bar that is merely finished charging while short of the super.
    expect(meterView(METER_MAX - 1, 1).showMax).toBe(false);
    expect(meterView(0, 1).showMax).toBe(false);
  });

  it("clamps a negative or over-full meter", () => {
    expect(meterView(-20).fillFrac).toBe(0);
    expect(meterView(-20).ready).toBe(false);
  });
});
