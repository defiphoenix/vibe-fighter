import { describe, it, expect } from "vitest";
import { superCutIn } from "./super-cutin";

// The cut-in is derived arithmetic over the sim's freeze countdown rather than a tween, so it can be
// exercised here in the node env — which is the whole reason it lives outside the scene. The traps it
// has to survive are the ones that bit hud-entrance: a NaN reaching a Game Object's `x` (Phaser stops
// rendering silently instead of throwing), and an interrupted animation leaving the art mid-screen.

const FREEZE = 36;

describe("superCutIn", () => {
  it("starts fully off-screen and invisible", () => {
    const a = superCutIn(FREEZE, FREEZE);
    expect(a.x).toBeLessThan(-1); // clear of the left edge by more than its own width
    expect(a.alpha).toBe(0);
    expect(a.done).toBe(false);
  });

  it("parks on screen at full opacity during the hold", () => {
    // Halfway through the freeze is inside the hold (slide is the first 35%, exit the last 20%).
    const mid = superCutIn(FREEZE, FREEZE / 2);
    expect(mid.x).toBeCloseTo(0, 2);
    expect(mid.alpha).toBeCloseTo(1, 2);
  });

  it("is back off-screen and invisible by the time the world unfreezes", () => {
    const end = superCutIn(FREEZE, 0);
    expect(end.x).toBeLessThan(-1);
    expect(end.alpha).toBeCloseTo(0, 5);
    expect(end.done).toBe(true);
  });

  it("moves monotonically in, then monotonically out — never jitters", () => {
    const xs = Array.from({ length: FREEZE + 1 }, (_, i) => superCutIn(FREEZE, FREEZE - i).x);
    const peak = xs.indexOf(Math.max(...xs));
    for (let i = 1; i <= peak; i++) expect(xs[i], `in @${i}`).toBeGreaterThanOrEqual(xs[i - 1]);
    for (let i = peak + 1; i < xs.length; i++) expect(xs[i], `out @${i}`).toBeLessThanOrEqual(xs[i - 1]);
  });

  it("sweeps once across the portrait, ending at 1", () => {
    expect(superCutIn(FREEZE, FREEZE).sweep).toBe(0);
    const sweeps = Array.from({ length: FREEZE + 1 }, (_, i) => superCutIn(FREEZE, FREEZE - i).sweep);
    for (let i = 1; i < sweeps.length; i++) expect(sweeps[i]).toBeGreaterThanOrEqual(sweeps[i - 1]);
    expect(sweeps[sweeps.length - 1]).toBe(1);
  });

  // A freeze of 0 is what a fighter with no `freeze` authored produces, and NaN is what a lost/reset
  // counter produces. Both must degrade to "not showing", never to a portrait stranded on screen.
  it.each([0, -5, Number.NaN])("degrades to hidden-and-done for a freeze of %s", (freeze) => {
    const s = superCutIn(freeze, 10);
    expect(s.alpha).toBe(0);
    expect(s.done).toBe(true);
    expect(Number.isFinite(s.x)).toBe(true);
  });

  it("never emits a non-finite number, whatever the countdown does", () => {
    for (const remaining of [Number.NaN, Infinity, -Infinity, 999, -999]) {
      const s = superCutIn(FREEZE, remaining);
      expect(Number.isFinite(s.x), `x @${remaining}`).toBe(true);
      expect(Number.isFinite(s.alpha), `alpha @${remaining}`).toBe(true);
      expect(Number.isFinite(s.sweep), `sweep @${remaining}`).toBe(true);
    }
  });
});
