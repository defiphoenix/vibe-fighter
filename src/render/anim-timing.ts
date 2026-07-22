import type { CharacterData, StateName } from "../sim/types";
import { ATTACK_STATE_TO_KEY, isAttackState } from "../sim/types";
import { TICK_HZ } from "../sim/constants";

/** Just the two fields of a sheet's render meta that timing cares about. Kept structural so this
 *  module needs nothing from `characters.ts` (which imports Phaser) and can run in the node test env
 *  — same trick as `edge-latch.ts` / `flow-state.ts`. */
export interface SheetTiming {
  frames: number;
  fps: number;
  /** measured contact frame, see attackFrameDurations */
  hit?: number;
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

/**
 * The animation clock starts one tick behind the state.
 *
 * `FighterSprite.update` calls `play()` during the render pass that FOLLOWS the tick which entered
 * the attack state, and Phaser's AnimationState only begins accumulating delta on the next frame.
 * Measured live: at `stateFrame === 4` the animation had elapsed exactly 3 ticks. Ignoring that puts
 * the contact frame one tick late — for a 3-tick active window it lands on the LAST active tick
 * instead of the first, which is most of the defect this module exists to remove. So the wind-up
 * segment is budgeted one tick short, and that tick is handed to the strike segment; the total is
 * unchanged. ponytail: exact at 60 Hz (one render frame == one tick); it drifts by a fraction of a
 * frame if the display rate ever diverges, which is far inside a single animation frame.
 */
export const PLAY_LAG_TICKS = 1;

/** Nudge (ms) that keeps a segment boundary off an exact tick. See the use site. */
const BOUNDARY_BIAS_MS = 1;

/**
 * Per-frame playback durations (ms) for one attack, or `null` to keep the uniform `attackFrameRate`.
 *
 * `attackFrameRate` fixed the animation's LENGTH but not its PHASE. Measured across the shipped
 * sheets, 13 of 18 attacks had the hit box go live roughly one render frame before the sprite
 * reached full extension — the strike landed on a wind-up pose. Stretching the whole animation
 * can't fix that; only redistributing time within it can.
 *
 * So: spend the `startup` ticks on the wind-up frames (0..hit-1) and the `active + recovery` ticks
 * on the rest (hit..n-1). Frame `hit` — the frame the fist is actually out on — then begins exactly
 * on the first active tick, and the total is unchanged. Uniform within each segment; no attempt at
 * a per-frame curve, which the art doesn't justify.
 *
 * The alternative was retuning `startup` in the registry, which was rejected: startup builds real
 * hitbox-less SIM frames, so moving it changes responsiveness, first-contact timing and total move
 * length. Render metadata never reaches the sim, which makes it the right home for an art fact.
 *
 * ponytail: `hit` is measured, so `null` (fall back to uniform) is the honest answer for a sheet
 * whose contact frame the measurement can't call — see scripts/check-attack-sync.py.
 */
export function attackFrameDurations(state: StateName, meta: SheetTiming, data: CharacterData): number[] | null {
  if (!isAttackState(state) || meta.hit === undefined) return null;
  const hit = meta.hit;
  const n = meta.frames;
  if (!Number.isInteger(hit) || hit <= 0 || hit >= n) return null; // validator rejects these too
  const a = data.attacks[ATTACK_STATE_TO_KEY[state]];
  const windUpTicks = a.startup - PLAY_LAG_TICKS;
  const strikeTicks = a.active + a.recovery + PLAY_LAG_TICKS;
  if (windUpTicks <= 0 || strikeTicks <= 0) return null;

  const msPerTick = 1000 / TICK_HZ;
  // Bias the segment boundary a hair early. Phaser advances a frame when its accumulator reaches
  // the frame's duration, so a boundary landing EXACTLY on a tick resolves on the following update
  // and the contact frame appears one tick late (measured: monk/airLight sat at accumulator ==
  // nextTick on its first active tick). Being a millisecond early is invisible — the sprite is
  // simply extended a hair before the hit box — while being a tick late is the whole defect.
  const windUp = (windUpTicks * msPerTick - BOUNDARY_BIAS_MS) / hit;
  const strike = (strikeTicks * msPerTick + BOUNDARY_BIAS_MS) / (n - hit);
  return Array.from({ length: n }, (_, i) => (i < hit ? windUp : strike));
}
