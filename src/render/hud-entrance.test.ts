import { describe, it, expect } from "vitest";
import { INTRO_TICKS } from "../sim/constants";
import {
  hudEntrance,
  ENTRANCE_TICKS,
  ENTRANCE_MS,
  SLIDE_TICKS,
  FILL_DELAY_TICKS,
  FILL_TICKS,
  SLIDE_DROP_PX,
} from "./hud-entrance";

/** The source prompt's only piece of feedback about this animation was "the slide-down of the UI and
 *  the fill need to be a bit slower — right now it's too rapid". So the interesting properties are
 *  not that the maths interpolates (it obviously does) but that the entrance is SLOW, that it FITS
 *  inside the intro it is derived from, and that it is settled in every phase where a fight is
 *  actually happening. */
describe("hudEntrance", () => {
  it("fits inside the round intro — the countdown it derives from is its whole budget", () => {
    expect(ENTRANCE_TICKS).toBeLessThanOrEqual(INTRO_TICKS);
    // ...and it does not use the entire window: the band should be parked and quiet before "FIGHT!".
    expect(ENTRANCE_TICKS).toBeLessThan(INTRO_TICKS);
  });

  it("starts fully retracted and empty on the first intro tick", () => {
    const e = hudEntrance("intro", INTRO_TICKS);
    expect(e.slideY).toBe(-SLIDE_DROP_PX);
    expect(e.fillFrac).toBe(0);
    expect(e.done).toBe(false);
  });

  it("lands exactly parked and exactly full — no residual offset, no 0.999 bar", () => {
    const e = hudEntrance("intro", INTRO_TICKS - ENTRANCE_TICKS);
    expect(e.slideY).toBe(0);
    expect(e.fillFrac).toBe(1);
    expect(e.done).toBe(true);
  });

  it("is settled in every phase that is not the intro", () => {
    for (const phase of ["fight", "roundEnd", "matchEnd"] as const) {
      const e = hudEntrance(phase, INTRO_TICKS); // a stale introTicks must not matter
      expect(e.slideY, phase).toBe(0);
      expect(e.fillFrac, phase).toBe(1);
      expect(e.done, phase).toBe(true);
    }
  });

  it("never leaves its bounds, and both curves only ever move forward", () => {
    let prevSlide = -Infinity;
    let prevFill = -Infinity;
    for (let t = 0; t <= INTRO_TICKS; t++) {
      const e = hudEntrance("intro", INTRO_TICKS - t);
      expect(e.slideY, `tick ${t}`).toBeGreaterThanOrEqual(-SLIDE_DROP_PX);
      expect(e.slideY, `tick ${t}`).toBeLessThanOrEqual(0);
      expect(e.fillFrac, `tick ${t}`).toBeGreaterThanOrEqual(0);
      expect(e.fillFrac, `tick ${t}`).toBeLessThanOrEqual(1);
      expect(e.slideY, `tick ${t}`).toBeGreaterThanOrEqual(prevSlide - 1e-12);
      expect(e.fillFrac, `tick ${t}`).toBeGreaterThanOrEqual(prevFill - 1e-12);
      prevSlide = e.slideY;
      prevFill = e.fillFrac;
    }
  });

  it("survives a non-finite countdown instead of poisoning a Game Object's y with NaN", () => {
    // Phaser doesn't throw on a NaN y — it just stops rendering the object, which is a much worse
    // failure than a HUD that starts retracted.
    for (const bad of [NaN, Infinity, -Infinity]) {
      const e = hudEntrance("intro", bad);
      expect(Number.isFinite(e.slideY), String(bad)).toBe(true);
      expect(Number.isFinite(e.fillFrac), String(bad)).toBe(true);
    }
  });

  it("clamps a garbage countdown rather than extrapolating past the ends", () => {
    // introTicks above its own maximum (a scene that reset mid-frame) reads as "not started yet".
    expect(hudEntrance("intro", INTRO_TICKS + 500).slideY).toBe(-SLIDE_DROP_PX);
    // ...and below zero as "long finished", not as an overshoot.
    const past = hudEntrance("intro", -500);
    expect(past.slideY).toBe(0);
    expect(past.fillFrac).toBe(1);
  });

  it("holds the fill at zero until the slide is under way — the stagger is real", () => {
    for (let t = 0; t <= FILL_DELAY_TICKS; t++) {
      expect(hudEntrance("intro", INTRO_TICKS - t).fillFrac, `tick ${t}`).toBe(0);
    }
    expect(hudEntrance("intro", INTRO_TICKS - (FILL_DELAY_TICKS + 1)).fillFrac).toBeGreaterThan(0);
    // ...and the stagger stays inside motion-design's <500 ms budget.
    expect(ENTRANCE_MS.fillDelay).toBeLessThan(500);
  });

  it("would have failed at the 'too rapid' tempo the source prompt complained about", () => {
    // A ~200 ms entrance (12 ticks) is the thing the user asked to slow down. At that point the
    // shipped curve must still be visibly mid-flight — otherwise the knobs have drifted back.
    const rapid = hudEntrance("intro", INTRO_TICKS - 12);
    expect(rapid.done).toBe(false);
    expect(rapid.fillFrac).toBe(0); // hasn't even started charging
    expect(rapid.slideY).toBeLessThan(0); // still above its parked position
    expect(ENTRANCE_MS.total).toBeGreaterThanOrEqual(1000);
  });

  it("reports the durations its constants actually imply", () => {
    expect(ENTRANCE_MS.slide).toBe(900);
    expect(ENTRANCE_MS.fill).toBe(900);
    expect(ENTRANCE_MS.total).toBe(1200);
    expect(SLIDE_TICKS + FILL_TICKS).toBeGreaterThan(ENTRANCE_TICKS); // slide and fill overlap
    expect(FILL_DELAY_TICKS + FILL_TICKS).toBe(ENTRANCE_TICKS);
  });
});
