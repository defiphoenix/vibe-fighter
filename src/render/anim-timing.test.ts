import { describe, it, expect } from "vitest";
import { attackFrameRate } from "./anim-timing";
import { ATTACK_STATE_TO_KEY, isAttackState } from "../sim/types";
import type { CharacterData, StateName } from "../sim/types";
import { TICK_HZ } from "../sim/constants";
import { STATE_NAMES } from "../sim/validate-character";
import registry from "../../public/configs/character-gym.json";

// Regression for "the light attack does nothing / some moves run too quickly".
// The attack animations were timed by an authored per-state `fps` that had drifted from the move's
// real duration: attackLight needed 0.43s of art over a 0.25-0.27s move, so playback was cut off at
// ~60% and the strike was NEVER drawn; crouchHeavy was the opposite (0.40s of art over a 0.53s move),
// finishing early and freezing. Both are invisible to every other test — nothing compared animation
// length to move length. This runs against the SHIPPED registry so a future art/timing edit that
// desyncs them fails here.

/* eslint-disable @typescript-eslint/no-explicit-any */
const reg = registry as unknown as Record<string, { render: { sheets: Record<string, any> }; data: CharacterData }>;
const FIGHTERS = Object.keys(reg).filter((k) => (reg[k] as any)?.data); // skip the `_doc` metadata key

describe("attack animations span their move exactly", () => {
  it("has fighters to check", () => {
    expect(FIGHTERS.length).toBeGreaterThan(0);
  });

  for (const id of FIGHTERS) {
    it(`${id}: every attack's animation length == its sim duration`, () => {
      const { data, render } = reg[id];
      for (const state of STATE_NAMES as StateName[]) {
        if (!isAttackState(state)) continue;
        const meta = render.sheets[state];
        const a = data.attacks[ATTACK_STATE_TO_KEY[state]];
        const simSec = (a.startup + a.active + a.recovery) / TICK_HZ;
        const animSec = meta.frames / attackFrameRate(state, meta, data);
        // Exact by construction; a tolerance only to allow float noise.
        expect(animSec, `${id}.${state}`).toBeCloseTo(simSec, 6);
      }
    });
  }

  it("leaves non-attack states on their authored fps (no fixed duration to match)", () => {
    const { data, render } = reg[FIGHTERS[0]];
    for (const state of STATE_NAMES as StateName[]) {
      if (isAttackState(state)) continue;
      const meta = render.sheets[state];
      expect(attackFrameRate(state, meta, data)).toBe(meta.fps);
    }
  });

  it("would have caught the old drift: the authored fps did NOT span the move", () => {
    // Pin the actual defect so this test is not vacuous — with the authored numbers, attackLight's
    // animation was far longer than the move that contains it.
    const { data, render } = reg[FIGHTERS[0]];
    const a = data.attacks[ATTACK_STATE_TO_KEY.attackLight];
    const simSec = (a.startup + a.active + a.recovery) / TICK_HZ;
    const authoredSec = render.sheets.attackLight.frames / render.sheets.attackLight.fps;
    expect(authoredSec).toBeGreaterThan(simSec * 1.3); // cut off at well under 80%
  });
});
