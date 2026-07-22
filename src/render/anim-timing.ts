import type { CharacterData, StateName } from "../sim/types";
import { ATTACK_STATE_TO_KEY, isAttackState } from "../sim/types";
import { TICK_HZ } from "../sim/constants";

/** Just the two fields of a sheet's render meta that timing cares about. Kept structural so this
 *  module needs nothing from `characters.ts` (which imports Phaser) and can run in the node test env
 *  — same trick as `edge-latch.ts` / `flow-state.ts`. */
export interface SheetTiming {
  frames: number;
  fps: number;
}

/**
 * Frame rate for one state's animation.
 *
 * An ATTACK animation must span exactly as long as the move itself, so derive its rate from the sim
 * duration (startup + active + recovery ticks) rather than trusting the authored `fps`. The authored
 * numbers had drifted badly and it was VISIBLE, not cosmetic: every fighter's `attackLight` needed
 * 0.43s of animation but the move only lasts 0.25-0.27s, so playback was cut off at ~60% — the sprite
 * showed the wind-up and snapped back to idle before it ever struck, which reads as "the light attack
 * does nothing". `crouchHeavy` had the opposite skew (0.40s of art over a 0.53s move), finishing early
 * and then freezing on its last frame — "the move runs too quickly".
 *
 * Only attacks are derived: their duration is fixed and authored. Looping states (idle/walk) have no
 * duration to match, and the physics/stun-driven ones (jump, hitstun, knockdown) have no fixed tick
 * count either, so both keep their authored fps.
 */
export function attackFrameRate(state: StateName, meta: SheetTiming, data: CharacterData): number {
  if (!isAttackState(state)) return meta.fps;
  const a = data.attacks[ATTACK_STATE_TO_KEY[state]];
  const simTicks = a.startup + a.active + a.recovery;
  if (simTicks <= 0) return meta.fps; // validator forbids it; don't divide by zero if it ever happens
  return (meta.frames * TICK_HZ) / simTicks;
}
