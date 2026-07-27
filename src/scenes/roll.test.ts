import { describe, expect, it } from "vitest";
import { makeRoll } from "./roll";

// This generator has exactly one job: make the CPU's character pick VARY while staying reproducible
// from a seed. Both halves have a failure mode that looks fine from the outside, so both are pinned.

describe("makeRoll", () => {
  it("is reproducible from its seed, and different seeds diverge", () => {
    const a = makeRoll(7), b = makeRoll(7), c = makeRoll(8);
    const seqA = [a(), a(), a(), a()];
    expect([b(), b(), b(), b()]).toEqual(seqA);
    expect([c(), c(), c(), c()]).not.toEqual(seqA);
  });

  it("stays inside [0, 1)", () => {
    const r = makeRoll(12345);
    for (let i = 0; i < 500; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  // THE trap. Raw xorshift32 seeded with a small integer emits a first value of ~0.00006, and it does
  // so for every small seed — so a caller that seeds and takes ONE sample gets a constant. The CPU
  // pick would then be exactly as fixed as the `wrap(taken + 1)` it replaced, while LOOKING random,
  // and the seeded e2e would "prove" a randomness that does not exist.
  it("does not hand every small seed the same near-zero first sample", () => {
    const firsts = Array.from({ length: 64 }, (_, i) => makeRoll(i + 1)());
    const low = firsts.filter((v) => v < 0.5).length;
    expect(low).toBeGreaterThan(8);
    expect(low).toBeLessThan(56);
  });

  it("picks both cards of a two-way choice across the low seeds an e2e would use", () => {
    // The concrete consumer: cpuPick's `1 + floor(roll * 1)` over two free cards.
    const picks = new Set(Array.from({ length: 20 }, (_, i) => Math.floor(makeRoll(i + 1)() * 2)));
    expect([...picks].sort()).toEqual([0, 1]);
  });

  // xorshift32's state is a fixed point at zero: once there it emits zero forever. A seed of 0 is not
  // hypothetical — it is what a masked clock or an uninitialised field hands you.
  it("survives a zero seed instead of emitting zero forever", () => {
    const r = makeRoll(0);
    const vals = [r(), r(), r(), r()];
    expect(vals.every((v) => v === 0)).toBe(false);
    expect(new Set(vals).size).toBeGreaterThan(1);
  });
});
