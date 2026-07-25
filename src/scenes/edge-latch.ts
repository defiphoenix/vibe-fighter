import type { InputSnapshot } from "../sim/types";

/** Keeps a pressed EDGE alive until a sim tick actually consumes it.
 *  Render frames and sim ticks don't line up: a press during intro/roundEnd/hitstop lands on a
 *  non-actionable tick, and without latching it would vanish before the next fight tick. Held fields
 *  pass straight through — only the three edges latch, plus the STANCE (`down`) that was held at the
 *  moment the first edge latched, so a buffered crouch normal doesn't come out standing when the
 *  player releases down before the tick lands. Shared by MatchScene and PlaygroundScene.
 *
 *  Lives in its own Phaser-free file (input.ts imports Phaser; vitest runs the sim in `node`) so the
 *  buffering rules can be unit-tested directly. */
export class EdgeLatch {
  private pending = [
    { up: false, light: false, heavy: false, special: false, down: undefined as boolean | undefined },
    { up: false, light: false, heavy: false, special: false, down: undefined as boolean | undefined },
  ];

  /** OR this frame's edges into the latch and return the latched snapshot. */
  apply(i: 0 | 1, r: InputSnapshot): InputSnapshot {
    const p = this.pending[i];
    const hadAttack = p.light || p.heavy;
    p.up = p.up || r.upPressed;
    p.light = p.light || r.lightPressed;
    p.heavy = p.heavy || r.heavyPressed;
    // The special latches like any other edge but is deliberately OUTSIDE the stance capture below:
    // it is grounded-only with no crouch variant, so it has no use for downAtPress and must not be
    // able to strand the stance bit for a light/heavy that is still waiting.
    p.special = p.special || r.specialPressed;
    // ponytail: ONE stance bit per buffer window — captured on the first attack edge and held until
    // clear(). Light and heavy buffered in the same window with different stances share it; that
    // needs two frames of input inside one non-actionable window, and we accept it.
    if (!hadAttack && (p.light || p.heavy)) p.down = r.down;
    return {
      ...r,
      upPressed: p.up,
      lightPressed: p.light,
      heavyPressed: p.heavy,
      specialPressed: p.special,
      downAtPress: p.down,
    };
  }

  /** Clear ONLY the edges the sim actually acted on this frame (World.consumedInputs[i]). An edge the
   *  fighter could not act on — because it was locked in an attack or stun — stays buffered until it
   *  can, which is what makes a light→heavy reliable instead of dropping the heavy pressed during the
   *  light. Replaces the old "clear the whole latch on any fight tick", which threw the heavy away. */
  consume(i: 0 | 1, c: { up: boolean; light: boolean; heavy: boolean; special: boolean }): void {
    const p = this.pending[i];
    if (c.up) p.up = false;
    if (c.light) p.light = false;
    if (c.heavy) p.heavy = false;
    // The sim reports the special edge consumed even when it REFUSED the move (empty meter). That is
    // the point: otherwise a press on an empty bar stays latched and fires itself the moment the bar
    // fills, which reads as the special going off on its own.
    if (c.special) p.special = false;
    if (!p.light && !p.heavy) p.down = undefined; // the stance bit only matters while an attack waits
  }

  /** Drop everything held — on a restart/world rebuild (not per-tick; use consume() for that). */
  clear(): void {
    for (const p of this.pending) {
      p.up = p.light = p.heavy = p.special = false;
      p.down = undefined;
    }
  }
}
