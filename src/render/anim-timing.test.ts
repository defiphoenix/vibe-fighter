import { describe, it, expect } from "vitest";
import { stateFrameRate, stunFrameRate, attackFrameDurations } from "./anim-timing";
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
        const animSec = meta.frames / stateFrameRate(state, meta, data);
        // Exact by construction; a tolerance only to allow float noise.
        expect(animSec, `${id}.${state}`).toBeCloseTo(simSec, 6);
      }
    });
  }

  it("leaves the genuinely open-ended states on their authored fps", () => {
    // Only the looping ones: idle/walk repeat until the player stops, so there is no duration to
    // match. Everything else in STATE_NAMES is timed against the sim by one of the two functions.
    const { data, render } = reg[FIGHTERS[0]];
    for (const state of ["idle", "walkF", "walkB", "crouch", "ko"] as StateName[]) {
      const meta = render.sheets[state];
      expect(stateFrameRate(state, meta, data), state).toBe(meta.fps);
      expect(stunFrameRate(state, meta, 20), state).toBeNull();
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

// The same defect, in the states the attack fix never covered. Every non-attack sheet ships at a flat
// `fps: 8`, which matched no sim window: knockdown gave 750ms of art to a 300ms state, so playback was
// cut at frame 2 of 6 — and the FALL is frames 3-5. The fighter stood upright through his knockdown.
describe("stun and jump animations span their state", () => {
  it("a stun animation lasts exactly as long as the stun", () => {
    for (const id of FIGHTERS) {
      const { render } = reg[id];
      for (const [state, ticks] of [["hitstun", 14], ["blockstun", 9], ["knockdown", 18]] as const) {
        const meta = render.sheets[state];
        const rate = stunFrameRate(state, meta, ticks);
        expect(rate, `${id}.${state}`).not.toBeNull();
        expect(meta.frames / rate!, `${id}.${state}`).toBeCloseTo(ticks / TICK_HZ, 6);
      }
    }
  });

  it("would have caught the old drift: 8fps ran way past every real stun window", () => {
    // Not vacuous — the shipped `fps` is what the defect was, so assert it is still wrong on its own.
    const { render } = reg[FIGHTERS[0]];
    const kd = render.sheets.knockdown;
    expect(kd.frames / kd.fps).toBeGreaterThan((18 / TICK_HZ) * 2); // 750ms of art, 300ms of state
  });

  it("refuses a rate it cannot derive rather than guessing", () => {
    const meta = reg[FIGHTERS[0]].render.sheets.hitstun;
    for (const bad of [0, -1, NaN, Infinity]) expect(stunFrameRate("hitstun", meta, bad)).toBeNull();
  });

  it("a jump animation spans the arc to the apex", () => {
    for (const id of FIGHTERS) {
      const { data, render } = reg[id];
      const apexSec = data.stats.jumpVelocity / data.stats.gravity;
      for (const state of ["jumpRise", "jumpFall"] as StateName[]) {
        const meta = render.sheets[state];
        expect(meta.frames / stateFrameRate(state, meta, data), `${id}.${state}`).toBeCloseTo(apexSec, 6);
      }
    }
  });

});

// The companion defect, one layer in: `stateFrameRate` fixes the animation's LENGTH but not its
// PHASE. Measured on the shipped sheets, 13 of 18 attacks had the hit box go live about one render
// frame before the sprite reached full extension. `attackFrameDurations` redistributes the time so
// the measured contact frame starts on the first ACTIVE tick. The suite above cannot see this — it
// only checks frames/frameRate — so these assertions are on the SEGMENTS, not the total.
describe("attackFrameDurations places the contact frame on the first active tick", () => {
  const MS = 1000 / TICK_HZ;
  const data = reg[FIGHTERS[0]].data;

  const sum = (xs: number[]) => xs.reduce((t, x) => t + x, 0);

  it("splits startup over the wind-up frames and active+recovery over the rest", () => {
    const a = data.attacks[ATTACK_STATE_TO_KEY.attackLight];
    const meta = { frames: 6, fps: 14, hit: 3 };
    const d = attackFrameDurations("attackLight", meta, data)!;
    expect(d).toHaveLength(6);
    // The load-bearing assertion: the wind-up segment is `startup - 1` ticks, so frame `hit` is on
    // screen exactly when the hit box goes live. The -1 is the play() lag, measured live — see
    // PLAY_LAG_TICKS. Without it the contact frame lands on the LAST active tick, not the first.
    expect(sum(d.slice(0, 3))).toBeCloseTo((a.startup - 1) * MS - 1, 9); // -1ms boundary bias
    expect(sum(d.slice(3))).toBeCloseTo((a.active + a.recovery + 1) * MS + 1, 9);
    expect(sum(d)).toBeCloseTo((a.startup + a.active + a.recovery) * MS, 9);
    // uniform within each segment, and the strike half is faster than the wind-up here
    expect(new Set(d.slice(0, 3)).size).toBe(1);
    expect(new Set(d.slice(3)).size).toBe(1);
  });

  it("returns null (keep uniform timing) for anything it cannot place", () => {
    const base = { frames: 6, fps: 14 };
    expect(attackFrameDurations("attackLight", base, data)).toBeNull();            // no measurement
    expect(attackFrameDurations("attackLight", { ...base, hit: 0 }, data)).toBeNull();   // empty wind-up
    expect(attackFrameDurations("attackLight", { ...base, hit: 6 }, data)).toBeNull();   // out of range
    expect(attackFrameDurations("attackLight", { ...base, hit: 2.5 }, data)).toBeNull(); // not a frame
    expect(attackFrameDurations("idle", { frames: 8, fps: 10, hit: 3 }, data)).toBeNull(); // not an attack
  });

  it("refuses an attack whose startup is too short to spend on a wind-up", () => {
    const zero: CharacterData = {
      ...data,
      attacks: { ...data.attacks, light: { ...data.attacks.light, startup: 1 } }, // 1 - PLAY_LAG = 0
    };
    expect(attackFrameDurations("attackLight", { frames: 6, fps: 14, hit: 3 }, zero)).toBeNull();
  });

  it("every `hit` in the SHIPPED registry produces a total equal to its move duration", () => {
    let checked = 0;
    for (const id of FIGHTERS) {
      const { data: d, render } = reg[id];
      for (const state of STATE_NAMES as StateName[]) {
        if (!isAttackState(state)) continue;
        const meta = render.sheets[state];
        const durs = attackFrameDurations(state, meta, d);
        if (!durs) continue; // sheet with no measured contact frame — uniform timing, covered above
        checked++;
        const a = d.attacks[ATTACK_STATE_TO_KEY[state]];
        expect(durs, `${id}.${state}`).toHaveLength(meta.frames);
        expect(durs.every((x: number) => x > 0), `${id}.${state}: no zero-length frame`).toBe(true);
        expect(sum(durs), `${id}.${state} total`).toBeCloseTo((a.startup + a.active + a.recovery) * MS, 6);
        expect(sum(durs.slice(0, meta.hit)), `${id}.${state} wind-up`).toBeCloseTo((a.startup - 1) * MS - 1, 6);
      }
    }
    expect(checked, "expected the registry to carry measured contact frames").toBeGreaterThan(0);
  });
});
