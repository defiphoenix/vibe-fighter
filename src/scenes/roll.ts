/**
 * The CPU character-pick's randomness.
 *
 * Its own module because it is the one STATEFUL thing this flow needs, and `flow-state.ts` promises
 * in its header that every function there is pure. `cpuPick` takes the resulting number, not this
 * generator, so that promise stays true.
 *
 * Deliberately NOT shared with `src/sim/cpu.ts`'s generator, which uses the same xorshift32 shifts.
 * That stream is pinned by seed-sensitive tests, and reusing it would risk changing a difficulty
 * behaviour to tidy up a menu.
 */

/**
 * A generator of samples in [0, 1). Same seed, same sequence — that is the whole point.
 *
 * Two steps here are load-bearing and both were measured, not assumed (`roll.test.ts` fails without
 * either):
 *
 *  - **The Knuth mix + 4-draw warm-up.** Raw xorshift32 seeded with a small integer emits a first
 *    value around 0.00006 — and it does so for EVERY small seed: all 64 of seeds 1..64 landed below
 *    0.5, so a caller that seeds and takes one sample gets a constant. The CPU's "random" pick would
 *    have been exactly as fixed as the `wrap(taken + 1)` it replaced while looking random, and the
 *    seeded e2e would have certified a randomness that was not there.
 *  - **The zero guard.** Zero is a fixed point of xorshift32 (it emits zero forever), and a
 *    multiplicative mix maps 0 to 0, so the guard has to come after the mix. `sim/cpu.ts` guards the
 *    same way for the same reason.
 */
export function makeRoll(seed: number): () => number {
  let x = (Math.imul(seed >>> 0, 2654435761) >>> 0) || 1;
  const next = (): number => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x / 0x100000000;
  };
  for (let i = 0; i < 4; i++) next();
  return next;
}
