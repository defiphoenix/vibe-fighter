import type { CharacterData } from "./types";
import { assembleCharacter } from "./character-builder";

// The three SHIPPED fighters (brawler/jiujitsu/monk) live in public/configs/character-gym.json and
// are loaded at the render edge (src/render/characters.ts). This file keeps only the symmetric
// TEST_DUMMY that the sim unit tests build a World from — FIGHTER_A/B are one shared definition
// assembled twice, so there is no A/B data duplication, and both stay byte-identical to the values
// combat.test.ts / regression.test.ts encode. High/low blocking is decided by box GEOMETRY, not
// labels: light hits high (overlaps stand guard), heavy sweeps low (overlaps crouch guard).
// NOTE the dummy's heavy is deliberately kept LOW so the sim tests still exercise the low path from
// a ground normal. The SHIPPED roster's ground heavy is a HIGH — its art is a standing punch — so
// don't read this fixture as the game's move list. The shipped high/low matrix lives in
// registry.test.ts, which runs against character-gym.json rather than this dummy.
// Exported so a test can assemble a VARIANT of the shared fixture (e.g. with a per-frame guard
// override) without re-authoring 40 boxes that would then drift from the numbers below.
export const TEST_DUMMY: CharacterData = {
  stats: { walkSpeed: 220, jumpVelocity: 900, gravity: 2600, maxHealth: 100, scale: 1 },
  boxes: {
    pushStand: { x: -28, y: 0, w: 56, h: 175 },
    pushCrouch: { x: -30, y: 0, w: 60, h: 110 },
    hurtStand: [{ x: -30, y: 0, w: 60, h: 185 }],
    hurtCrouch: [{ x: -32, y: 0, w: 64, h: 110 }],
    hurtAir: [{ x: -28, y: 0, w: 56, h: 150 }],
    knockdown: { hurt: [{ x: -40, y: 0, w: 80, h: 60 }], push: { x: -40, y: 0, w: 80, h: 40 } },
    ko: { hurt: [{ x: -40, y: 0, w: 80, h: 50 }], push: { x: -40, y: 0, w: 80, h: 40 } },
    // Guard boxes sit OVER the body (x -32 .. 58), not as a thin forward slab: high/low is decided by
    // the y band alone, and a forward-only slab left point-blank unblockable bands at the separations
    // where pushboxes touch. Mirrors public/configs/character-gym.json — keep the two in step.
    guardStand: [{ x: -32, y: 70, w: 90, h: 105 }],
    guardCrouch: [{ x: -32, y: 0, w: 90, h: 80 }],
  },
  attacks: {
    light: { body: "stand", startup: 4, active: 3, recovery: 8, hit: { x: 40, y: 100, w: 70, h: 45 }, damage: 6, hitstun: 12, blockstun: 9, hitstop: 6, knockback: { x: 130, y: 0 }, chip: 1 },
    heavy: { body: "crouch", startup: 9, active: 4, recovery: 18, hit: { x: 45, y: 8, w: 95, h: 48 }, damage: 14, hitstun: 18, blockstun: 14, hitstop: 10, knockback: { x: 240, y: -260 }, chip: 3 },
    // Air normals: independent timing from ground (slower startup/recovery), hit box aimed downward.
    airLight: { body: "air", startup: 6, active: 3, recovery: 12, hit: { x: 40, y: 80, w: 70, h: 50 }, damage: 6, hitstun: 12, blockstun: 9, hitstop: 6, knockback: { x: 120, y: 0 }, chip: 1 },
    airHeavy: { body: "air", startup: 8, active: 4, recovery: 16, hit: { x: 45, y: 40, w: 90, h: 60 }, damage: 12, hitstun: 16, blockstun: 12, hitstop: 9, knockback: { x: 180, y: 0 }, chip: 3 },
    // Crouch normals: LOW hit boxes (overlap guardCrouch y0-80, miss guardStand y70-175) => true lows.
    crouchLight: { body: "crouch", startup: 4, active: 3, recovery: 9, hit: { x: 38, y: 18, w: 66, h: 40 }, damage: 5, hitstun: 11, blockstun: 8, hitstop: 6, knockback: { x: 110, y: 0 }, chip: 1 },
    crouchHeavy: { body: "crouch", startup: 8, active: 4, recovery: 20, hit: { x: 48, y: 6, w: 100, h: 42 }, damage: 13, hitstun: 18, blockstun: 14, hitstop: 10, knockback: { x: 220, y: -240 }, chip: 3 },
  },
  frames: { idle: 4, walkF: 6, walkB: 6, crouch: 2, block: 2, blockCrouch: 2, jumpRise: 1, jumpFall: 1, hitstun: 1, blockstun: 1, knockdown: 1, ko: 1 },
};

export const FIGHTER_A = assembleCharacter("fighter-a", TEST_DUMMY);
export const FIGHTER_B = assembleCharacter("fighter-b", TEST_DUMMY);
