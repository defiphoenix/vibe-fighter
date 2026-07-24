import { describe, it, expect } from "vitest";
import { validateFighterEntry, STATE_NAMES } from "./validate-character";
import type { CharacterData } from "./types";

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
      light: { body: "stand", startup: 4, active: 3, recovery: 8, hit: { x: 40, y: 100, w: 70, h: 45 }, damage: 6, hitstun: 12, blockstun: 9, hitstop: 6, knockback: { x: 130, y: 0 }, chip: 1 },
      heavy: { body: "crouch", startup: 9, active: 4, recovery: 18, hit: { x: 45, y: 8, w: 95, h: 48 }, damage: 14, hitstun: 18, blockstun: 14, hitstop: 10, knockback: { x: 240, y: -260 }, chip: 3 },
      airLight: { body: "air", startup: 6, active: 3, recovery: 12, hit: { x: 40, y: 80, w: 70, h: 50 }, damage: 6, hitstun: 12, blockstun: 9, hitstop: 6, knockback: { x: 120, y: 0 }, chip: 1 },
      airHeavy: { body: "air", startup: 8, active: 4, recovery: 16, hit: { x: 45, y: 40, w: 90, h: 60 }, damage: 12, hitstun: 16, blockstun: 12, hitstop: 9, knockback: { x: 180, y: 0 }, chip: 3 },
      crouchLight: { body: "crouch", startup: 4, active: 3, recovery: 9, hit: { x: 38, y: 18, w: 66, h: 40 }, damage: 5, hitstun: 11, blockstun: 8, hitstop: 6, knockback: { x: 110, y: 0 }, chip: 1 },
      crouchHeavy: { body: "crouch", startup: 8, active: 4, recovery: 20, hit: { x: 48, y: 6, w: 100, h: 42 }, damage: 13, hitstun: 18, blockstun: 14, hitstop: 10, knockback: { x: 220, y: -240 }, chip: 3 },
    },
    frames: { idle: 4, walkF: 6, walkB: 6, crouch: 2, block: 2, blockCrouch: 2, jumpRise: 1, jumpFall: 1, hitstun: 1, blockstun: 1, knockdown: 1, ko: 1 },
  };
}

function sampleRender() {
  const sheets: Record<string, unknown> = {};
  for (const s of STATE_NAMES) sheets[s] = { path: `sprites/x/${s}.png`, frames: 4, fps: 10, loop: true };
  return { frameWidth: 320, frameHeight: 256, anchor: [0.5, 1.0], sheets };
}

function sampleEntry(): { render: unknown; data: CharacterData } {
  return { render: sampleRender(), data: sampleData() };
}

describe("validateFighterEntry", () => {
  it("accepts a well-formed entry", () => {
    expect(validateFighterEntry("brawler", sampleEntry())).toEqual([]);
  });

  // scale multiplies every collision box in character-builder: 0 collapses them all (and divides by
  // zero in the Gym's inverse), negative flips w/h, which toWorld does not normalise vertically.
  it.each([0, -1, Number.NaN])("rejects stats.scale = %s", (scale) => {
    const e = sampleEntry();
    e.data.stats.scale = scale;
    expect(validateFighterEntry("brawler", e)).toContain("[brawler] stats.scale: must be > 0");
  });

  it("accepts a fractional scale", () => {
    const e = sampleEntry();
    e.data.stats.scale = 1.3;
    expect(validateFighterEntry("brawler", e)).toEqual([]);
  });

  it("rejects a missing render sheet state", () => {
    const e = sampleEntry();
    delete (e.render as { sheets: Record<string, unknown> }).sheets.ko;
    const errs = validateFighterEntry("brawler", e);
    expect(errs.some((m) => m.includes("ko"))).toBe(true);
  });

  it("rejects non-positive maxHealth", () => {
    const e = sampleEntry();
    e.data.stats.maxHealth = 0;
    expect(validateFighterEntry("brawler", e).some((m) => m.includes("maxHealth"))).toBe(true);
  });

  it("rejects a negative box dimension", () => {
    const e = sampleEntry();
    e.data.boxes.hurtStand[0].w = -5;
    expect(validateFighterEntry("brawler", e).length).toBeGreaterThan(0);
  });

  it("rejects an override frame out of bounds", () => {
    const e = sampleEntry();
    e.data.overrides = { idle: [{ frame: 99, hurt: [{ x: 0, y: 0, w: 1, h: 1 }] }] };
    expect(validateFighterEntry("brawler", e).some((m) => m.includes("out of range"))).toBe(true);
  });

  it("rejects duplicate override frames on one state", () => {
    const e = sampleEntry();
    e.data.overrides = { idle: [{ frame: 0, push: { x: 0, y: 0, w: 1, h: 1 } }, { frame: 0, push: { x: 0, y: 0, w: 2, h: 2 } }] };
    expect(validateFighterEntry("brawler", e).some((m) => m.includes("duplicate"))).toBe(true);
  });

  it("rejects a hit override outside the attack active window", () => {
    const e = sampleEntry();
    // attackLight active window is [4,7); frame 0 (startup) may not carry a hit box
    e.data.overrides = { attackLight: [{ frame: 0, hit: [{ x: 0, y: 0, w: 10, h: 10 }] }] };
    expect(validateFighterEntry("brawler", e).some((m) => m.includes("active window"))).toBe(true);
  });

  it("rejects a fractional override frame", () => {
    const e = sampleEntry();
    e.data.overrides = { idle: [{ frame: 0.5, push: { x: 0, y: 0, w: 1, h: 1 } }] };
    expect(validateFighterEntry("brawler", e).some((m) => m.includes("integer"))).toBe(true);
  });

  it("rejects negative attack damage (would heal the victim)", () => {
    const e = sampleEntry();
    e.data.attacks.light.damage = -5;
    expect(validateFighterEntry("brawler", e).some((m) => m.includes("damage"))).toBe(true);
  });

  it("rejects a non-numeric anchor element", () => {
    const e = sampleEntry();
    (e.render as { anchor: unknown[] }).anchor = [0.5, null];
    expect(validateFighterEntry("brawler", e).some((m) => m.includes("anchor"))).toBe(true);
  });

  it("rejects a hit override on a non-attack state", () => {
    const e = sampleEntry();
    e.data.overrides = { idle: [{ frame: 0, hit: [{ x: 0, y: 0, w: 10, h: 10 }] }] };
    expect(validateFighterEntry("brawler", e).some((m) => m.includes("active window") || m.includes("non-attack"))).toBe(true);
  });

  // Phase 13: guard overrides used to be parsed by nothing at all — authored, stored, and silently
  // ignored by both the builder and this validator.
  it("accepts a guard override on a state that can guard", () => {
    const e = sampleEntry();
    e.data.overrides = { blockCrouch: [{ frame: 1, guardCrouch: [{ x: -32, y: 0, w: 90, h: 40 }] }] };
    expect(validateFighterEntry("brawler", e)).toEqual([]);
  });

  it("rejects a guard override on a state that cannot guard", () => {
    const e = sampleEntry();
    e.data.overrides = { attackLight: [{ frame: 4, guardStand: [{ x: 0, y: 0, w: 10, h: 10 }] }] };
    expect(validateFighterEntry("brawler", e).some((m) => m.includes("cannot guard"))).toBe(true);
  });

  it("rejects a malformed guard override box", () => {
    const e = sampleEntry();
    e.data.overrides = { block: [{ frame: 0, guardStand: [{ x: 0, y: 0, w: 0, h: 10 }] }] };
    expect(validateFighterEntry("brawler", e).some((m) => m.includes("guardStand[0].w"))).toBe(true);
  });
});

describe("render.sheets.<state>.hit — the measured contact frame", () => {
  const withHit = (state: string, hit: unknown, startupOverride?: number) => {
    const e = sampleEntry() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    e.render.sheets[state].hit = hit;
    if (startupOverride !== undefined) e.data.attacks.light.startup = startupOverride;
    return validateFighterEntry("x", e);
  };

  it("accepts a sane contact frame on an attack sheet", () => {
    expect(withHit("attackLight", 1)).toEqual([]);
  });

  it("rejects it on a non-attack sheet — there is no active window to align to", () => {
    expect(withHit("idle", 1).join()).toMatch(/only attack sheets/);
  });

  it("rejects a non-integer, a zero, and an out-of-range frame", () => {
    expect(withHit("attackLight", 1.5).join()).toMatch(/integer required/);
    expect(withHit("attackLight", 0).join()).toMatch(/must be in/);   // empty wind-up segment
    expect(withHit("attackLight", 99).join()).toMatch(/must be in/);
  });

  it("rejects a startup the renderer cannot spend on a wind-up (must exceed the play lag)", () => {
    // anim-timing budgets the wind-up `startup - PLAY_LAG_TICKS` ticks, so startup 1 would declare a
    // contact frame that the renderer then silently ignores. The two contracts must agree.
    expect(withHit("attackLight", 1, 1).join()).toMatch(/needs startup >/);
    expect(withHit("attackLight", 1, 0).join()).toMatch(/needs startup >/);
    expect(withHit("attackLight", 1, 2)).toEqual([]);
  });
});
