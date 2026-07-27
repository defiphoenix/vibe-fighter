import { describe, it, expect } from "vitest";
import { stateFrameRate, stunFrameRate, attackFrameDurations, attackStartFrame, stunStartFrame } from "./anim-timing";
import { ATTACK_STATE_TO_KEY, attackSimTicks, isAttackState } from "../sim/types";
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
        // attackSimTicks, not the raw sum: a `repeat` special occupies several windows plus the gaps
        // between them, and this test is the thing that notices if the render clock forgets that.
        const simSec = attackSimTicks(a) / TICK_HZ;
        const animSec = meta.frames / stateFrameRate(state, meta, data);
        // Exact by construction; a tolerance only to allow float noise.
        expect(animSec, `${id}.${state}`).toBeCloseTo(simSec, 6);
      }
    });
  }

  // Phase 15. `meta.hit` is ONE measured contact frame; a multi-hit special has N. Splitting the
  // animation into wind-up/strike around a single number would phase-align window 0 and smear every
  // window after it, so a repeat attack keeps uniform timing — the same answer an unmeasurable sheet
  // already gets. Guessing a second contact frame is the failure this whole module exists to prevent.
  it("gives a repeat (multi-hit) attack uniform timing, never a guessed phase split", () => {
    const { data, render } = reg[FIGHTERS[0]];
    const meta = { ...render.sheets.special, hit: 3 }; // even WITH a contact frame authored
    expect(data.attacks.special.repeat!.count).toBeGreaterThan(1);
    expect(attackFrameDurations("special", meta, data)).toBeNull();

    // ...while a single-window normal still gets its phase split, so this isn't a blanket opt-out.
    expect(attackFrameDurations("attackLight", render.sheets.attackLight, data)).not.toBeNull();
  });

  it("leaves the genuinely open-ended states on their authored fps", () => {
    // The looping ones (idle/walk repeat until the player stops) plus the held guard braces
    // (block/blockCrouch) and ko: no sim duration to match, so they ride the authored fps. Everything
    // else in STATE_NAMES is timed against the sim by one of the two functions.
    const { data, render } = reg[FIGHTERS[0]];
    for (const state of ["idle", "walkF", "walkB", "crouch", "block", "blockCrouch", "ko"] as StateName[]) {
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
        // Measured over the DRAWN frames: a window too short to show every pose at a readable rate
        // starts partway in (see stunStartFrame), and the rate spans what is actually played.
        const drawn = meta.frames - stunStartFrame(state, meta, ticks);
        expect(drawn / rate!, `${id}.${state}`).toBeCloseTo(ticks / TICK_HZ, 6);
        // ...and no drawn pose is under one refresh at 60Hz.
        expect(ticks / drawn, `${id}.${state} ticks per pose`).toBeGreaterThan(1);
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
    const s = attackStartFrame("attackLight", meta, data);
    expect(d).toHaveLength(6);
    // The load-bearing assertion: the wind-up segment is `startup - 1` ticks, so frame `hit` is on
    // screen exactly when the hit box goes live. The -1 is the play() lag, measured live — see
    // PLAY_LAG_TICKS. Without it the contact frame lands on the LAST active tick, not the first.
    // Measured on the DRAWN frames: playback begins at `attackStartFrame`, and the frames before it
    // are never reached, so their duration is inert padding and would only inflate the sum.
    expect(sum(d.slice(s, 3))).toBeCloseTo((a.startup - 1) * MS - 1, 9); // -1ms boundary bias
    expect(sum(d.slice(3))).toBeCloseTo((a.active + a.recovery + 1) * MS + 1, 9);
    expect(sum(d.slice(s))).toBeCloseTo((a.startup + a.active + a.recovery) * MS, 9);
    // uniform within each segment, and the strike half is faster than the wind-up here
    expect(new Set(d.slice(s, 3)).size).toBe(1);
    expect(new Set(d.slice(3)).size).toBe(1);
  });

  // The wind-up budget is fixed at `startup - 1` ticks by phase alignment, so a sheet with more
  // wind-up poses than ticks to spend cannot slow them down — it can only draw fewer. Traced live:
  // brawler/attackLight spent three wind-up frames on ONE tick each (16.7ms, a single refresh).
  it("starts an attack partway in when the wind-up cannot afford every pose", () => {
    const meta = { frames: 6, fps: 14, hit: 3 };
    const a = data.attacks[ATTACK_STATE_TO_KEY.attackLight];
    const windUp = a.startup - 1;
    const s = attackStartFrame("attackLight", meta, data);
    const d = attackFrameDurations("attackLight", meta, data)!;

    expect(windUp / meta.hit, "this fixture must be a sheet that cannot afford its wind-up").toBeLessThan(2);
    expect(s, "playback must skip the poses there is no time for").toBeGreaterThan(0);
    expect(s, "...but never the pose the strike departs from").toBeLessThan(meta.hit);
    // Every DRAWN wind-up pose now clears the one-refresh floor.
    for (let i = s; i < meta.hit; i++) expect(d[i], `frame ${i}`).toBeGreaterThanOrEqual(2 * MS - 1);
    // ...and the strike is untouched: same start tick, same total.
    expect(sum(d.slice(s))).toBeCloseTo((a.startup + a.active + a.recovery) * MS, 9);
  });

  // The two floors are deliberately different, chosen by looking at the result rather than by taste.
  // A stun is a pose you are PUT INTO, so its lead-in frames are dead weight and 3 ticks is right; an
  // attack wind-up is anticipation the player reads, so it only gets trimmed where it was genuinely
  // sub-perceptual. Pinning both so a future "simplify to one constant" has to argue with the case.
  it("uses a higher floor for stuns than for attack wind-ups", () => {
    // jiujitsu's light already showed 2 wind-up poses at 2.0 ticks each — readable, so left alone.
    const jj = reg.jiujitsu;
    expect(attackStartFrame("attackLight", jj.render.sheets.attackLight, jj.data)).toBe(0);
    // ...while blockstun's 4 poses over a 9-tick window are trimmed to 3 so each clears 3 ticks.
    const bs = reg[FIGHTERS[0]].render.sheets.blockstun;
    expect(stunStartFrame("blockstun", bs, 9)).toBe(1);
    expect(9 / (bs.frames - stunStartFrame("blockstun", bs, 9))).toBeGreaterThanOrEqual(3);
    // hitstun at 12 ticks already affords all 4 poses, so nothing is dropped.
    expect(stunStartFrame("hitstun", reg[FIGHTERS[0]].render.sheets.hitstun, 12)).toBe(0);
  });

  it("leaves an attack alone when its wind-up already fits, and never trims a multi-hit", () => {
    // A generous startup: 9 ticks over 2 wind-up poses is 4 ticks each, well clear of the floor.
    const roomy: CharacterData = {
      ...data,
      attacks: { ...data.attacks, light: { ...data.attacks.light, startup: 9 } },
    };
    expect(attackStartFrame("attackLight", { frames: 6, fps: 14, hit: 2 }, roomy)).toBe(0);
    // A repeat special keeps uniform timing, so it has no wind-up segment to trim.
    expect(attackStartFrame("special", { ...reg[FIGHTERS[0]].render.sheets.special, hit: 3 }, data)).toBe(0);
    // ...and a sheet with no measured contact frame is never second-guessed.
    expect(attackStartFrame("attackLight", { frames: 6, fps: 14 }, data)).toBe(0);
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
        const s = attackStartFrame(state, meta, d);
        expect(durs, `${id}.${state}`).toHaveLength(meta.frames);
        expect(durs.every((x: number) => x > 0), `${id}.${state}: no zero-length frame`).toBe(true);
        // Measured over the DRAWN frames — playback starts at `s`, and anything before it is padding.
        expect(sum(durs.slice(s)), `${id}.${state} total`).toBeCloseTo((a.startup + a.active + a.recovery) * MS, 6);
        expect(sum(durs.slice(s, meta.hit)), `${id}.${state} wind-up`).toBeCloseTo((a.startup - 1) * MS - 1, 6);
        // No drawn pose may sit under one refresh at 60Hz — the defect this trimming exists to remove.
        for (let i = s; i < meta.frames; i++) {
          expect(durs[i], `${id}.${state} frame ${i} is sub-perceptual`).toBeGreaterThan(MS);
        }
      }
    }
    expect(checked, "expected the registry to carry measured contact frames").toBeGreaterThan(0);
  });
});
