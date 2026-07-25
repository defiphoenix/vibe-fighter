import { describe, it, expect } from "vitest";
import { assembleCharacter, allHitBoxes } from "./character-builder";
import { isGuardableState } from "./types";
import type { CharacterData, StateName } from "./types";

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
      special: {
        body: "stand", startup: 8, active: 3, recovery: 18,
        repeat: { count: 5, gap: 4 }, freeze: 30,
        hit: { x: 42, y: 60, w: 96, h: 90 },
        damage: 8, hitstun: 14, blockstun: 10, hitstop: 6, knockback: { x: 40, y: 0 }, chip: 2,
      },
    },
    frames: {
      idle: 4, walkF: 6, walkB: 6, crouch: 2, block: 2, blockCrouch: 2, jumpRise: 1, jumpFall: 1,
      hitstun: 1, blockstun: 1, knockdown: 1, ko: 1,
    },
  };
}

describe("assembleCharacter", () => {
  it("builds all 18 states with the authored frame counts", () => {
    const c = assembleCharacter("test", sampleData());
    expect(c.id).toBe("test");
    expect(c.states.idle.frames.length).toBe(4);
    expect(c.states.walkF.frames.length).toBe(6);
    expect(c.states.crouch.frames.length).toBe(2);
    expect(c.states.block.frames.length).toBe(2);
    expect(c.states.blockCrouch.frames.length).toBe(2);
    expect(c.states.jumpRise.frames.length).toBe(1);
    // attack length == startup + active + recovery
    expect(c.states.attackLight.frames.length).toBe(4 + 3 + 8);
    expect(c.states.attackHeavy.frames.length).toBe(9 + 4 + 18);
    expect(c.states.airLight.frames.length).toBe(6 + 3 + 12);
    expect(c.states.crouchHeavy.frames.length).toBe(8 + 4 + 20);
  });

  // Phase 15: a `repeat` attack lays its active window down `count` times, separated by `gap` idle
  // frames. This is what makes a multi-hit special's hit count AUTHORED rather than emergent.
  it("repeats the active window `count` times, tagged with distinct hit ids", () => {
    const c = assembleCharacter("test", sampleData());
    const f = c.states.special.frames;
    // 8 startup + 5 windows x 3 active + 4 gaps x 4 + 18 recovery
    expect(f.length).toBe(8 + 5 * 3 + 4 * 4 + 18);

    // Every frame that carries a hit box reports which window it belongs to; the ids run 0..count-1
    // in order, and no window is merged with its neighbour (that would dedup two hits into one).
    const windows: number[] = [];
    for (const frame of f) {
      if (frame.hit.length === 0) {
        expect(frame.hitId).toBeUndefined();
        continue;
      }
      expect(typeof frame.hitId).toBe("number");
      if (windows[windows.length - 1] !== frame.hitId) windows.push(frame.hitId!);
    }
    expect(windows).toEqual([0, 1, 2, 3, 4]);

    // startup is still bare, and each window is exactly `active` frames long
    for (let i = 0; i < 8; i++) expect(f[i].hit.length).toBe(0);
    for (let w = 0; w < 5; w++) {
      const start = 8 + w * (3 + 4);
      for (let i = start; i < start + 3; i++) {
        expect(f[i].hit.length).toBe(1);
        expect(f[i].hitId).toBe(w);
      }
    }
  });

  it("leaves an attack without `repeat` exactly as it was (single window, id 0)", () => {
    const c = assembleCharacter("test", sampleData());
    const f = c.states.attackLight.frames;
    expect(f.length).toBe(4 + 3 + 8);
    for (let i = 0; i < 4; i++) expect(f[i].hitId).toBeUndefined();
    for (let i = 4; i < 7; i++) expect(f[i].hitId).toBe(0);
    for (let i = 7; i < 15; i++) expect(f[i].hitId).toBeUndefined();
  });

  it("carries loop flags for locomotion, not for one-shots", () => {
    const c = assembleCharacter("test", sampleData());
    expect(c.states.idle.loop).toBe(true);
    expect(c.states.walkF.loop).toBe(true);
    expect(c.states.crouch.loop).toBe(true);
    expect(c.states.block.loop).toBe(false); // held brace, NOT a loop (popping in/out reads wrong)
    expect(c.states.blockCrouch.loop).toBe(false);
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

  it("copies stats and attack specs", () => {
    const c = assembleCharacter("test", sampleData());
    expect(c.stats.walkSpeed).toBe(220);
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

// Phase 13/13b: guard boxes moved from two character-level arrays into FrameBoxes, so they can vary by
// animation frame. Phase 13b then made the set of frames that CARRY a guard box the dedicated held-
// guard states (block/blockCrouch) plus blockstun — a fighter only ever guards while planted in one
// of those.
describe("per-frame guard boxes", () => {
  const GUARDABLE: StateName[] = ["block", "blockCrouch", "blockstun"];
  const NOT_GUARDABLE: StateName[] = [
    "idle", "walkF", "walkB", "crouch", "jumpRise", "jumpFall", "attackLight", "attackHeavy",
    "airLight", "airHeavy", "crouchLight", "crouchHeavy", "hitstun", "knockdown", "ko",
  ];

  it("isGuardableState names exactly the dedicated block states plus blockstun", () => {
    for (const s of GUARDABLE) expect(isGuardableState(s), s).toBe(true);
    for (const s of NOT_GUARDABLE) expect(isGuardableState(s), s).toBe(false);
  });

  it("seeds every guardable frame from the character-level template", () => {
    const c = assembleCharacter("test", sampleData());
    for (const s of GUARDABLE) {
      for (const f of c.states[s].frames) {
        expect(f.guardStand, s).toEqual([{ x: 15, y: 70, w: 40, h: 105 }]);
        expect(f.guardCrouch, s).toEqual([{ x: 15, y: 0, w: 40, h: 80 }]);
      }
    }
  });

  it("leaves guard EMPTY on every frame that cannot guard", () => {
    const c = assembleCharacter("test", sampleData());
    for (const s of NOT_GUARDABLE) {
      for (const f of c.states[s].frames) {
        expect(f.guardStand, s).toEqual([]);
        expect(f.guardCrouch, s).toEqual([]);
      }
    }
  });

  it("applies a per-frame guard override to that frame only", () => {
    const data = sampleData();
    data.overrides = { blockCrouch: [{ frame: 1, guardCrouch: [{ x: 15, y: 0, w: 40, h: 20 }] }] };
    const c = assembleCharacter("test", data);
    expect(c.states.blockCrouch.frames[1].guardCrouch).toEqual([{ x: 15, y: 0, w: 40, h: 20 }]);
    expect(c.states.blockCrouch.frames[0].guardCrouch).toEqual([{ x: 15, y: 0, w: 40, h: 80 }]);
    // the untouched stance on the same frame keeps the template
    expect(c.states.blockCrouch.frames[1].guardStand).toEqual([{ x: 15, y: 70, w: 40, h: 105 }]);
  });

  it("REFUSES a guard override on a state that cannot guard", () => {
    // `guarding` is derived from box data now, so a guard box on an attack frame would make a
    // fighter blockable mid-punch. The validator rejects this, but config.ts calls assembleCharacter
    // directly with nothing in front of it — so the builder has to be the enforcer too.
    const data = sampleData();
    data.overrides = { attackLight: [{ frame: 4, guardStand: [{ x: 0, y: 0, w: 99, h: 99 }] }] };
    const c = assembleCharacter("test", data);
    expect(c.states.attackLight.frames[4].guardStand).toEqual([]);
  });

  it("scales frame guards by stats.scale exactly once, overrides included", () => {
    const data = sampleData();
    data.overrides = { blockCrouch: [{ frame: 1, guardCrouch: [{ x: 15, y: 0, w: 40, h: 20 }] }] };
    data.stats.scale = 2;
    const c = assembleCharacter("test", data);
    expect(c.states.block.frames[0].guardStand).toEqual([{ x: 30, y: 140, w: 80, h: 210 }]);
    expect(c.states.blockCrouch.frames[0].guardCrouch).toEqual([{ x: 30, y: 0, w: 80, h: 160 }]);
    // authored unscaled, scaled after the override lands — 20 * 2, not 20 or 80
    expect(c.states.blockCrouch.frames[1].guardCrouch).toEqual([{ x: 30, y: 0, w: 80, h: 40 }]);
  });
});
