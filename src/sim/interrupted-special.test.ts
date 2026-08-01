import { describe, it, expect } from "vitest";
import { World } from "./world";
import { FIGHTER_A, FIGHTER_B } from "./config";
import { METER_MAX } from "./fighter";
import { emptyInput, type InputSnapshot } from "./types";
import { DT } from "./constants";

/**
 * The interrupted-special signal: `Fighter.interruptedSpecial` -> `World.interruptedSpecials`.
 *
 * It exists for the render layer's audio, and it exists as a SIM field rather than a render-side
 * heuristic for one reason, which test 3 below is the whole proof of: a render frame samples state
 * once but `advance()` can drain up to 15 ticks, so "the special finished and THEN its owner was hit"
 * and "the special was interrupted" are the same observation from outside. They are not the same
 * event, and only the sim is standing at the moment that tells them apart.
 */

function mk(over: Partial<InputSnapshot> = {}): InputSnapshot {
  return { ...emptyInput(), ...over };
}
const NONE: [InputSnapshot, InputSnapshot] = [mk(), mk()];
const specialPress = mk({ special: true, specialPressed: true });
const lightHold = mk({ light: true, lightPressed: true });

/** Fresh world in the fight phase, fighters `gap` px apart. 90 is the separation every multi-hit
 *  test in `combat.test.ts` uses — the dummy's special and its light both connect at it. */
function fightWorld(gap = 90): World {
  const w = new World(FIGHTER_A, FIGHTER_B);
  w.match.phase = "fight";
  w.match.introTicks = 0;
  w.fighters[0].reset(640 - gap / 2, 1);
  w.fighters[1].reset(640 + gap / 2, -1);
  return w;
}

/** P1 fires the special and the world freezes. Returns the world on the first UNFROZEN tick, i.e.
 *  with P1 in `special` and its startup about to advance. */
function afterSuperFreeze(): World {
  const w = fightWorld();
  w.fighters[0].meter = METER_MAX;
  w.tick([specialPress, mk()]);
  expect(w.fighters[0].state).toBe("special");
  expect(w.hitstop).toBeGreaterThan(0);
  while (w.hitstop > 0) w.tick(NONE); // burn the 30-tick freeze; these ticks advance nothing else
  return w;
}

describe("Fighter.interruptedSpecial — set at the moment of the hit", () => {
  it("is set when a hit lands on a fighter who is IN the special", () => {
    const w = afterSuperFreeze();
    const p1 = w.fighters[0];
    expect(p1.state).toBe("special");

    p1.interruptedSpecial = false;
    p1.applyHit(6, 12, 100, 0, false);

    expect(p1.interruptedSpecial).toBe(true);
    expect(p1.state).toBe("hitstun");
  });

  it("is NOT set when the same hit lands on a fighter who is not in the special", () => {
    const w = fightWorld();
    const p1 = w.fighters[0];
    expect(p1.state).toBe("idle");

    p1.interruptedSpecial = false;
    p1.applyHit(6, 12, 100, 0, false);

    expect(p1.interruptedSpecial).toBe(false);
    expect(p1.state).toBe("hitstun");
  });

  // `applyHit`'s KO branch RETURNS before the normal setState, so a flag written after it would miss
  // the single most dramatic way a super gets interrupted: the one that kills you mid-animation.
  it("is set when the hit that interrupts the special also KOs", () => {
    const w = afterSuperFreeze();
    const p1 = w.fighters[0];
    expect(p1.state).toBe("special");

    p1.interruptedSpecial = false;
    p1.applyHit(p1.health, 12, 100, 0, false);

    expect(p1.interruptedSpecial).toBe(true);
    expect(p1.state).toBe("ko");
  });

  // A blocked hit routes through the same door. A fighter mid-special is not guarding, so this is
  // belt-and-braces on the CONDITION rather than on a reachable state — but the condition is what is
  // being tested, and it must not silently key off `blocked`.
  it("keys off the state, not off whether the hit was blocked", () => {
    const w = afterSuperFreeze();
    const p1 = w.fighters[0];

    p1.interruptedSpecial = false;
    p1.applyHit(1, 12, 100, 0, true);

    expect(p1.interruptedSpecial).toBe(true);
    expect(p1.state).toBe("blockstun");
  });
});

describe("World.interruptedSpecials — accumulated per advance", () => {
  it("reports a REAL in-tick interruption, and the fighter really is stunned out of the move", () => {
    const w = afterSuperFreeze();
    expect(w.fighters[0].state).toBe("special");

    // P2's light is startup 4; P1's special has 8 ticks of startup left, so the light lands while P1
    // is still winding up and BEFORE the special's first active window can put P2 in hitstun.
    let sawFlag = false;
    for (let i = 0; i < 8 && !sawFlag; i++) {
      w.advance(DT, [mk(), lightHold]);
      sawFlag = w.interruptedSpecials[0];
    }

    expect(sawFlag).toBe(true);
    expect(w.fighters[0].state).toBe("hitstun");
  });

  it("SURVIVES the rest of a multi-tick batch — the accumulation is an OR, not an assignment", () => {
    // The interrupting tick is almost never the last tick of its advance: the hit sets hitstop, and
    // every frozen tick after it clears the per-fighter flag before its own early return. Only
    // OR-accumulating into the batch total keeps the report alive to the end of the frame; a plain
    // assignment would overwrite it with the next tick's `false` and the render layer would see
    // nothing. Every other test here advances one tick at a time and cannot tell the two apart.
    const w = afterSuperFreeze();
    const p1 = w.fighters[0];

    // Walk to one tick before the hit lands, so the batch below CONTAINS the interruption and then
    // keeps going well past it.
    let armedTicks = 0;
    while (p1.state === "special" && armedTicks < 12) {
      w.advance(DT, [mk(), lightHold]);
      armedTicks++;
      if (w.interruptedSpecials[0]) break;
    }
    expect(w.interruptedSpecials[0]).toBe(true);

    // Now do it again from scratch, but as ONE batch that runs several ticks past the hit.
    const w2 = afterSuperFreeze();
    w2.advance(DT * 12, [mk(), lightHold]);
    expect(w2.fighters[0].state, "the hit did not land inside the batch").toBe("hitstun");
    expect(
      w2.interruptedSpecials[0],
      "the interruption was overwritten by a later tick in the same advance",
    ).toBe(true);
  });

  it("resets per advance — a flag from one batch does not survive into the next", () => {
    const w = afterSuperFreeze();
    let sawFlag = false;
    for (let i = 0; i < 8 && !sawFlag; i++) {
      w.advance(DT, [mk(), lightHold]);
      sawFlag = w.interruptedSpecials[0];
    }
    expect(sawFlag).toBe(true);

    w.advance(DT, NONE);
    expect(w.interruptedSpecials[0]).toBe(false);
  });

  it("stays false when a NORMAL attack is interrupted — this is not a generic got-hit flag", () => {
    const w = fightWorld();
    // P1 throws a light and P2 throws one back; whoever lands first stuns the other, and neither was
    // in a special.
    for (let i = 0; i < 12; i++) {
      w.advance(DT, [i === 0 ? lightHold : mk(), lightHold]);
      expect(w.interruptedSpecials[0]).toBe(false);
      expect(w.interruptedSpecials[1]).toBe(false);
    }
  });

  /**
   * THE test. The reason this field is in the sim at all.
   *
   * One advance batch that contains BOTH the special's final ticks AND a hit landing after it. From
   * outside, that frame is indistinguishable from an interruption: the director samples `special` at
   * the start and `hitstun` at the end and never sees the `idle` in between. The flag must stay false,
   * because the hit did not interrupt anything — the move was already over.
   */
  it("stays FALSE when the special COMPLETES and its owner is hit later in the SAME advance", () => {
    const w = afterSuperFreeze();
    const p1 = w.fighters[0];

    // Measured on this fixture, not assumed: the special is 57 frames, and with P2 taking the whole
    // flurry it runs out over 72 one-tick advances. Walk to 3 frames from the end, so the batch below
    // straddles the boundary rather than landing near it.
    const lastFrame = p1.cfg.states.special.frames.length - 1;
    for (let i = 0; i < 200 && p1.stateFrame < lastFrame - 2; i++) w.advance(DT, NONE);
    expect(p1.state).toBe("special");
    expect(w.interruptedSpecials[0]).toBe(false);

    // ONE advance containing: the special's last frames, P1 returning to idle, P2 leaving the hitstun
    // the flurry put it in, and P2's light (startup 4) landing. ~7 ticks of work; 10 for margin, still
    // inside advance()'s 15-tick clamp.
    w.advance(DT * 10, [mk(), lightHold]);

    // The hit really landed...
    expect(p1.state).toBe("hitstun");
    // ...and this is the frame a render-side state comparison reads as `special` -> `hitstun` and
    // calls an interruption. It was not one. The move had already finished.
    expect(w.interruptedSpecials[0]).toBe(false);
  });
});
