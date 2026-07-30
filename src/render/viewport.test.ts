import { describe, it, expect } from "vitest";
import { viewWidthFor, liveWidth, VIEW_MIN_WIDTH, VIEW_MAX_WIDTH } from "./viewport";
import { VIEW_WIDTH, STAGE_WIDTH, STAGE_HEIGHT } from "../sim/constants";

// These are claims about DEVICES, not restatements of the arithmetic. Each case is a viewport a real
// browser reports, and the expected number is what the player should get on it — so a change to the
// formula that still "looks right" has to survive the whole set.
describe("viewWidthFor: the game width that matches the device", () => {
  it("fills a Pixel 5 in landscape edge to edge", () => {
    // 851x393 CSS px. 720 * 851/393 = 1559.08 -> 1559, an aspect within a pixel of the device's own,
    // so Scale.FIT then leaves no bar worth seeing. This is THE case the phase exists for.
    expect(viewWidthFor(851, 393)).toBe(1559);
  });

  it("fills a 20:9 handset", () => {
    expect(viewWidthFor(780, 360)).toBe(1560);
  });

  it("rounds to the nearest width rather than truncating", () => {
    // iPhone 13 Pro Max landscape, 926x428: 720 * 926/428 = 1557.76. Kept as a separate case because
    // it is the only device here whose fraction is over .5 — Pixel 5 lands on .08 and the 20:9 phone
    // on .00, so swapping round() for floor() leaves both green and silently gives away a pixel.
    expect(viewWidthFor(926, 428)).toBe(1558);
  });

  it("leaves a 16:9 desktop exactly as it was", () => {
    // Load-bearing beyond the obvious: playwright.config.ts drives Desktop Chrome at 1280x720, so
    // every existing e2e spec keeps measuring a 1280-wide game. If this ever stops being 1280, the
    // suite starts measuring the harness.
    expect(viewWidthFor(VIEW_WIDTH, STAGE_HEIGHT)).toBe(VIEW_WIDTH);
    expect(viewWidthFor(2560, 1440)).toBe(VIEW_WIDTH);
  });

  it("never exceeds the world, however wide the screen", () => {
    // 21:9 and 32:9 both want more stage than exists; the camera would show past STAGE_WIDTH.
    expect(viewWidthFor(3440, 1440)).toBe(VIEW_MAX_WIDTH);
    expect(viewWidthFor(5120, 1440)).toBe(VIEW_MAX_WIDTH);
    expect(VIEW_MAX_WIDTH).toBe(STAGE_WIDTH);
  });

  it("never narrows below the authored viewport", () => {
    // Portrait is gated by the rotate overlay on touch, but a narrow desktop window is not gated at
    // all — and the menus are budgeted against VIEW_WIDTH, so narrowing would clip the card row.
    expect(viewWidthFor(393, 851)).toBe(VIEW_MIN_WIDTH);
    expect(viewWidthFor(1000, 800)).toBe(VIEW_MIN_WIDTH); // 4:3
    expect(VIEW_MIN_WIDTH).toBe(VIEW_WIDTH);
  });

  it("treats a parent with no measured size as no claim at all", () => {
    // Phaser's getParentBounds can store zeros before layout settles; dividing by that is how you
    // get an Infinity into the HUD's arithmetic.
    for (const [w, h] of [[0, 0], [851, 0], [0, 393], [NaN, 393], [851, NaN], [-851, 393]]) {
      expect(viewWidthFor(w, h), `${w}x${h}`).toBe(VIEW_MIN_WIDTH);
    }
  });
});

describe("liveWidth: whatever Phaser reports, made safe to lay out against", () => {
  it("rounds a fractional width", () => {
    expect(liveWidth(1558.93)).toBe(1559);
  });

  it("clamps to the same band as the decision itself", () => {
    expect(liveWidth(900)).toBe(VIEW_MIN_WIDTH);
    expect(liveWidth(9000)).toBe(VIEW_MAX_WIDTH);
    expect(liveWidth(NaN)).toBe(VIEW_MIN_WIDTH);
  });
});
