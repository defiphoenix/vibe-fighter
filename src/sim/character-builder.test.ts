import { describe, it, expect } from "vitest";
import { assembleCharacter, allHitBoxes } from "./character-builder";
import type { CharacterData } from "./types";

/** Minimal but complete authorable data for one fighter. */
function sampleData(): CharacterData {
  return {
    stats: { walkSpeed: 220, jumpVelocity: 900, gravity: 2600, maxHealth: 100, scale: 1 },
    boxes: {
      pushStand: { x: -28, y: 0, w: 56, h: 175 },
      pushCrouch: { x: -30, y: 0, w: 60, h: 110 },
      hurtStand: [{ x: -30, y: 0, w: 60, h: 185 }],
      hurtCrouch: [{ x: -32, y: 0, w: 64, h: 110 }],
      hurtAir: [{ x: -28, y: 0, w: 56, h: 150 }],
      knockdown: { hurt: [{ x: -40, y: 0, w: 80, h: 60 }], push: { x: -40, y: 0, w: 80, h: 40 } },
      ko: { hurt: [{ x: -40, y: 0, w: 80, h: 50 }], push: { x: -40, y: 0, w: 80, h: 40 } },
      guardStand: [{ x: 15, y: 70, w: 40, h: 105 }],
      guardCrouch: [{ x: 15, y: 0, w: 40, h: 80 }],
    },
    attacks: {
      light: {
        body: "stand", startup: 4, active: 3, recovery: 8,
        hit: { x: 40, y: 100, w: 70, h: 45 },
        damage: 6, hitstun: 12, blockstun: 9, hitstop: 6, knockback: { x: 130, y: 0 }, chip: 1,
      },
      heavy: {
        body: "crouch", startup: 9, active: 4, recovery: 18,
        hit: { x: 45, y: 8, w: 95, h: 48 },
        damage: 14, hitstun: 18, blockstun: 14, hitstop: 10, knockback: { x: 240, y: -260 }, chip: 3,
      },
      airLight: {
        body: "air", startup: 6, active: 3, recovery: 12,
        hit: { x: 40, y: 80, w: 70, h: 50 },
        damage: 6, hitstun: 12, blockstun: 9, hitstop: 6, knockback: { x: 120, y: 0 }, chip: 1,
      },
      airHeavy: {
        body: "air", startup: 8, active: 4, recovery: 16,
        hit: { x: 45, y: 40, w: 90, h: 60 },
        damage: 12, hitstun: 16, blockstun: 12, hitstop: 9, knockback: { x: 180, y: 0 }, chip: 3,
      },
      crouchLight: {
        body: "crouch", startup: 4, active: 3, recovery: 9,
        hit: { x: 38, y: 18, w: 66, h: 40 },
        damage: 5, hitstun: 11, blockstun: 8, hitstop: 6, knockback: { x: 110, y: 0 }, chip: 1,
      },
      crouchHeavy: {
        body: "crouch", startup: 8, active: 4, recovery: 20,
        hit: { x: 48, y: 6, w: 100, h: 42 },
        damage: 13, hitstun: 18, blockstun: 14, hitstop: 10, knockback: { x: 220, y: -240 }, chip: 3,
      },
    },
    frames: {
      idle: 4, walkF: 6, walkB: 6, crouch: 2, jumpRise: 1, jumpFall: 1,
      hitstun: 1, blockstun: 1, knockdown: 1, ko: 1,
    },
  };
}

describe("assembleCharacter", () => {
  it("builds all 16 states with the authored frame counts", () => {
    const c = assembleCharacter("test", sampleData());
    expect(c.id).toBe("test");
    expect(c.states.idle.frames.length).toBe(4);
    expect(c.states.walkF.frames.length).toBe(6);
    expect(c.states.crouch.frames.length).toBe(2);
    expect(c.states.jumpRise.frames.length).toBe(1);
    // attack length == startup + active + recovery
    expect(c.states.attackLight.frames.length).toBe(4 + 3 + 8);
    expect(c.states.attackHeavy.frames.length).toBe(9 + 4 + 18);
    expect(c.states.airLight.frames.length).toBe(6 + 3 + 12);
    expect(c.states.crouchHeavy.frames.length).toBe(8 + 4 + 20);
  });

  it("carries loop flags for locomotion, not for one-shots", () => {
    const c = assembleCharacter("test", sampleData());
    expect(c.states.idle.loop).toBe(true);
    expect(c.states.walkF.loop).toBe(true);
    expect(c.states.crouch.loop).toBe(true);
    expect(c.states.attackLight.loop).toBe(false);
    expect(c.states.ko.loop).toBe(false);
  });

  it("places the hit box only on the active window", () => {
    const c = assembleCharacter("test", sampleData());
    const f = c.states.attackLight.frames;
    // startup 4: no hit
    for (let i = 0; i < 4; i++) expect(f[i].hit.length).toBe(0);
    // active 3: exactly the authored hit box
    for (let i = 4; i < 7; i++) {
      expect(f[i].hit.length).toBe(1);
      expect(f[i].hit[0]).toEqual({ x: 40, y: 100, w: 70, h: 45 });
    }
    // recovery 8: no hit
    for (let i = 7; i < 15; i++) expect(f[i].hit.length).toBe(0);
  });

  it("copies stats, global guard, and attack specs", () => {
    const c = assembleCharacter("test", sampleData());
    expect(c.stats.walkSpeed).toBe(220);
    expect(c.guardStand).toEqual([{ x: 15, y: 70, w: 40, h: 105 }]);
    expect(c.attacks.light.damage).toBe(6);
    expect(c.attacks.heavy.knockback).toEqual({ x: 240, y: -260 });
    // AttackSpec must not leak the frame-building fields
    expect((c.attacks.light as unknown as { hit?: unknown }).hit).toBeUndefined();
    expect((c.attacks.light as unknown as { body?: unknown }).body).toBeUndefined();
  });

  it("applies a per-frame override to that frame only", () => {
    const data = sampleData();
    data.overrides = { attackHeavy: [{ frame: 9, hurt: [{ x: -30, y: 0, w: 90, h: 120 }] }] };
    const c = assembleCharacter("test", data);
    expect(c.states.attackHeavy.frames[9].hurt).toEqual([{ x: -30, y: 0, w: 90, h: 120 }]);
    // frame 8 keeps the base crouch hurt box
    expect(c.states.attackHeavy.frames[8].hurt).toEqual([{ x: -32, y: 0, w: 64, h: 110 }]);
  });

  it("scales every box by stats.scale — including overrides (overrides first, scale second)", () => {
    const data = sampleData();
    data.overrides = { attackHeavy: [{ frame: 9, hurt: [{ x: -30, y: 0, w: 90, h: 120 }] }] };
    data.stats.scale = 2;
    const c = assembleCharacter("test", data);
    expect(c.states.idle.frames[0].hurt[0]).toEqual({ x: -60, y: 0, w: 120, h: 370 });
    expect(c.states.idle.frames[0].push).toEqual({ x: -56, y: 0, w: 112, h: 350 });
    expect(c.states.attackLight.frames[4].hit[0]).toEqual({ x: 80, y: 200, w: 140, h: 90 });
    expect(c.guardStand).toEqual([{ x: 30, y: 140, w: 80, h: 210 }]);
    expect(c.guardCrouch).toEqual([{ x: 30, y: 0, w: 80, h: 160 }]);
    // the OVERRIDDEN frame is scaled too — proves the override is authored in unscaled space and
    // scaling runs after it, not before (which would leave this frame at 1x).
    expect(c.states.attackHeavy.frames[9].hurt).toEqual([{ x: -60, y: 0, w: 180, h: 240 }]);
    // knockback is NOT geometry — stays put
    expect(c.attacks.heavy.knockback).toEqual({ x: 240, y: -260 });
  });

  it("leaves geometry untouched at scale 1 and never mutates the source data", () => {
    const data = sampleData();
    const c = assembleCharacter("test", data);
    expect(c.states.idle.frames[0].hurt[0]).toEqual({ x: -30, y: 0, w: 60, h: 185 });
    data.stats.scale = 3;
    assembleCharacter("test", data);
    expect(data.boxes.hurtStand[0]).toEqual({ x: -30, y: 0, w: 60, h: 185 });
    expect(data.boxes.guardStand[0]).toEqual({ x: 15, y: 70, w: 40, h: 105 });
  });

  it("allHitBoxes returns the distinct reach of a state, including per-frame override shapes", () => {
    const data = sampleData();
    // attackLight is active on frames 4..6; override frame 5 with a longer-reach box.
    data.overrides = { attackLight: [{ frame: 5, hit: [{ x: 90, y: 100, w: 120, h: 45 }] }] };
    const c = assembleCharacter("test", data);
    expect(allHitBoxes(c, "attackLight")).toEqual([
      { x: 40, y: 100, w: 70, h: 45 },   // frames 4 and 6 — deduped to one
      { x: 90, y: 100, w: 120, h: 45 },  // the frame-5 override, which a "first frame" scan misses
    ]);
    // non-attack states have no hit boxes at all
    expect(allHitBoxes(c, "idle")).toEqual([]);
    expect(allHitBoxes(c, "crouch")).toEqual([]);
  });

  it("produces independent objects (no aliasing across fighters or frames)", () => {
    const data = sampleData();
    const a = assembleCharacter("a", data);
    const b = assembleCharacter("b", data);
    // mutating a's box must not touch b
    a.states.idle.frames[0].hurt[0].w = 999;
    expect(b.states.idle.frames[0].hurt[0].w).toBe(60);
    // two frames of one state are independent objects
    a.states.walkF.frames[1].push.w = 111;
    expect(a.states.walkF.frames[0].push.w).toBe(56);
  });
});
