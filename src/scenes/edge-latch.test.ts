import { describe, it, expect } from "vitest";
import { EdgeLatch } from "./edge-latch";
import { emptyInput, type InputSnapshot } from "../sim/types";

const mk = (over: Partial<InputSnapshot> = {}): InputSnapshot => ({ ...emptyInput(), ...over });

describe("EdgeLatch", () => {
  it("keeps a pressed edge alive until clear()", () => {
    const l = new EdgeLatch();
    expect(l.apply(0, mk({ light: true, lightPressed: true })).lightPressed).toBe(true);
    expect(l.apply(0, mk()).lightPressed).toBe(true); // still latched: no tick consumed it
    l.clear();
    expect(l.apply(0, mk()).lightPressed).toBe(false);
  });

  it("captures the crouch stance at press time and holds it after down is released", () => {
    const l = new EdgeLatch();
    // press down+light together (a low)
    expect(l.apply(0, mk({ down: true, light: true, lightPressed: true })).downAtPress).toBe(true);
    // player releases down before any actionable tick ran — the buffered press is still a low
    const later = l.apply(0, mk({ down: false }));
    expect(later.lightPressed).toBe(true);
    expect(later.downAtPress).toBe(true);
    expect(later.down).toBe(false); // live `down` is untouched: guard stance must stay live
    l.clear();
    expect(l.apply(0, mk()).downAtPress).toBeUndefined();
  });

  it("a standing press stays standing even if down is pressed afterwards", () => {
    const l = new EdgeLatch();
    l.apply(0, mk({ light: true, lightPressed: true })); // pressed while standing
    expect(l.apply(0, mk({ down: true })).downAtPress).toBe(false);
  });

  it("does not capture a stance when no attack edge is latched", () => {
    const l = new EdgeLatch();
    expect(l.apply(0, mk({ down: true, up: true, upPressed: true })).downAtPress).toBeUndefined();
  });

  it("latches each player independently", () => {
    const l = new EdgeLatch();
    l.apply(0, mk({ heavy: true, heavyPressed: true, down: true }));
    const p2 = l.apply(1, mk());
    expect(p2.heavyPressed).toBe(false);
    expect(p2.downAtPress).toBeUndefined();
  });
});
