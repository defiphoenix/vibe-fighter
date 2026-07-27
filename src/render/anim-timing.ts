import type { CharacterData, StateName } from "../sim/types";
import { ATTACK_STATE_TO_KEY, attackSimTicks, isAttackState } from "../sim/types";
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
 * Frame rate for one state's animation, for the states whose duration is known when the animation is
 * REGISTERED — i.e. fixed per fighter. See `stunFrameRate` for the ones only known at play time.
 *
 * An animation must span exactly as long as the move it depicts, so derive its rate from the sim
 * rather than trusting the authored `fps`. The authored numbers had drifted badly and it was VISIBLE,
 * not cosmetic: every fighter's `attackLight` needed 0.43s of animation but the move only lasts
 * 0.25-0.27s, so playback was cut off at ~60% — the sprite showed the wind-up and snapped back to idle
 * before it ever struck, which reads as "the light attack does nothing". `crouchHeavy` had the opposite
 * skew (0.40s of art over a 0.53s move), finishing early and then freezing on its last frame — "the
 * move runs too quickly".
 *
 * - ATTACK: startup + active + recovery, all authored.
 * - JUMP: the arc is `jumpVelocity / gravity` seconds to the apex, and the same again back down, so
 *   both halves are one constant per fighter. Every sheet was authored at a flat `fps: 8` = 500ms of
 *   art over a 346-377ms arc, so the last frame — the landing extension on `jumpFall` — never drew.
 *   ponytail: `jumpFall` can be entered mid-arc (an air normal's recovery, a knockback) and is then
 *   shorter than a clean apex-to-ground fall; deriving per-play off `vy` would fix that and is not
 *   worth the coupling for a 4-frame sheet.
 *
 * Looping states (idle/walk) have no duration to match and keep their authored fps.
 */
export function stateFrameRate(state: StateName, meta: SheetTiming, data: CharacterData): number {
  if (state === "jumpRise" || state === "jumpFall") {
    const { jumpVelocity, gravity } = data.stats;
    return gravity > 0 && jumpVelocity > 0 ? meta.frames / (jumpVelocity / gravity) : meta.fps;
  }
  if (!isAttackState(state)) return meta.fps;
  const a = data.attacks[ATTACK_STATE_TO_KEY[state]];
  // attackSimTicks, not startup+active+recovery: a `repeat` special is several windows long and the
  // arithmetic for that lives in ONE place (sim/types.ts), mirrored by the two Python art gates.
  const simTicks = attackSimTicks(a);
  if (simTicks <= 0) return meta.fps; // validator forbids it; don't divide by zero if it ever happens
  return (meta.frames * TICK_HZ) / simTicks;
}

/** States the sim holds for a tick count it only decides when the fighter ENTERS them. */
const STUN_TIMED: ReadonlySet<StateName> = new Set(["hitstun", "blockstun", "knockdown"]);

/**
 * Playback rate override for a stun state, or `null` to keep the registered rate.
 *
 * `stateFrameRate` can't cover these: how long a fighter is stunned is a property of the attack that
 * hit them (`hitstun` 11-18t, `blockstun` 8-14t across the shipped roster) and `knockdown` is set by
 * `Fighter.onLand`, so the number exists only once the state has been entered. Every one of these
 * sheets was authored at a flat `fps: 8` that matched none of those windows, and `knockdown` was the
 * bad one: 750ms of art over a 300ms state, so playback was cut at frame 2 of 6 — and the fall is
 * frames 3-5. The fighter stood upright through his whole knockdown and popped back to idle. Same
 * class as the `attackLight` defect above, in the states that pass never re-checked.
 *
 * `stunTicks` is `Fighter.stunTimer` read on the frame the state changed, and the RENDERABLE window is
 * exactly the right thing to span — not the value the attack nominally assigned. Measured against the
 * live sim: hitstun and blockstun are entered from `resolveCombat`, which sets hitstop, and `tick()`
 * returns at the hitstop check BEFORE `advanceTimers`, so the render pass sees the full window (12
 * assigned → 12 seen → 12 ticks in state; blockstun 9/9/9). A landing `knockdown` is the exception:
 * `onLand` fires inside `integrate`, which runs BEFORE `advanceTimers` in the same tick and has no
 * hitstop to bail on, so the render pass sees 17 of the assigned 18 — and the state also lasts exactly
 * 17 more ticks. Spanning 17 is therefore correct, and "restoring" the assigned 18 would overrun the
 * state and be cut at its exit. Do not add a +1 here.
 */
export function stunFrameRate(state: StateName, meta: SheetTiming, stunTicks: number): number | null {
  if (!STUN_TIMED.has(state)) return null;
  if (!Number.isFinite(stunTicks) || stunTicks <= 0) return null;
  // Only the frames from `stunStartFrame` onward are ever played, so the rate must span THOSE across
  // the window — dividing the whole frame count would run the drawn tail short.
  const drawn = meta.frames - stunStartFrame(state, meta, stunTicks);
  return (drawn * TICK_HZ) / stunTicks;
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
 * Fewest sim ticks a drawn pose may occupy before it stops being a pose and becomes a flicker.
 *
 * One tick is 16.7ms — a single refresh at 60Hz. Traced live, `brawler/attackLight` spent its three
 * wind-up frames on exactly one tick each: the schedule was correct (durations 16.33ms, observed dwell
 * one render frame apiece) and the contact frame still landed on the first active tick, so nothing was
 * arithmetically wrong — the budget simply cannot buy three readable poses. Phase alignment fixes the
 * wind-up segment at `startup - 1` ticks, so the only honest lever is to draw FEWER wind-up poses and
 * give each the time to register.
 */
const MIN_POSE_TICKS_ATTACK = 2;

/**
 * Stuns get a higher floor than attack wind-ups, decided by looking at both.
 *
 * A stun is a pose you are PUT INTO, so the frames that read are the braced/landed ones and the
 * lead-in is dead weight: at 3 ticks `blockstun` snaps straight to the crossed-arm brace instead of
 * spending its first ticks raising the guard, and `knockdown` reaches its fall (frames 3-5) sooner.
 * An attack wind-up is the opposite — it is anticipation the player reads to know what is coming —
 * so it only gets trimmed where it was genuinely sub-perceptual. At 3, `jiujitsu/attackLight` (2
 * poses at 2.0 ticks) and `monk/airLight` (2 at 2.5) collapsed to a single held pose despite being
 * perfectly readable; at 2 they are left alone and only `brawler/attackLight` (3 poses at 1.0 tick)
 * and `brawler/crouchLight` (2 at 1.5) are rescued.
 */
const MIN_POSE_TICKS_STUN = 3;

/** Frames of `n` that a `ticks`-long window can afford at `min` ticks each, at least one. */
const affordablePoses = (ticks: number, n: number, min: number): number =>
  Math.min(n, Math.max(1, Math.floor(ticks / min)));

/**
 * The frame an attack's animation should START on, so no wind-up pose is drawn for less than
 * `MIN_POSE_TICKS`. Returns 0 whenever the whole wind-up already fits, which is the common case.
 *
 * Skipping leading frames — rather than slowing them down — is what keeps the contact frame on the
 * sim's first active tick: the wind-up budget is fixed by `startup`, so buying time for a pose can
 * only come out of another pose, never out of the strike. The frame immediately before contact is
 * always the one kept, because that is the pose the strike reads as departing from.
 */
export function attackStartFrame(state: StateName, meta: SheetTiming, data: CharacterData): number {
  if (!isAttackState(state) || meta.hit === undefined) return 0;
  const hit = meta.hit;
  if (!Number.isInteger(hit) || hit <= 0 || hit >= meta.frames) return 0;
  const a = data.attacks[ATTACK_STATE_TO_KEY[state]];
  if ((a.repeat?.count ?? 1) > 1) return 0; // multi-hit keeps uniform timing; no wind-up segment to trim
  const windUpTicks = a.startup - PLAY_LAG_TICKS;
  if (windUpTicks <= 0) return 0;
  return Math.max(0, hit - affordablePoses(windUpTicks, hit, MIN_POSE_TICKS_ATTACK));
}

/**
 * The frame a STUN's animation should start on, for the same reason as `attackStartFrame`: a window
 * too short to draw every pose should draw fewer, not flash them all.
 *
 * A stun has no contact frame to align to, so the whole sheet is one segment — but the frames that
 * matter are still the LAST ones. `knockdown`'s fall is frames 3-5 (heights 100/98/100/96/60/29), so
 * trimming from the front reaches the ground sooner, which is the same failure the derived rate was
 * introduced to fix. Trimming from the back would cut the fall off again.
 */
export function stunStartFrame(state: StateName, meta: SheetTiming, stunTicks: number): number {
  if (!STUN_TIMED.has(state)) return 0;
  if (!Number.isFinite(stunTicks) || stunTicks <= 0) return 0;
  return Math.max(0, meta.frames - affordablePoses(stunTicks, meta.frames, MIN_POSE_TICKS_STUN));
}

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
  // A multi-hit special has N contact frames but `meta.hit` is ONE measured number — it cannot describe
  // where the other N-1 strikes land, and a two-segment split would phase-align the first window and
  // smear every one after it. Uniform timing spreads the art evenly across the windows instead, which
  // is the same honest answer this module already gives an INDETERMINATE sheet. Never guess here.
  if ((a.repeat?.count ?? 1) > 1) return null;
  const windUpTicks = a.startup - PLAY_LAG_TICKS;
  const strikeTicks = a.active + a.recovery + PLAY_LAG_TICKS;
  if (windUpTicks <= 0 || strikeTicks <= 0) return null;

  // Playback starts at `attackStartFrame`, so the wind-up budget is shared by only the frames that
  // will actually be drawn. Frames before it keep a duration (they are simply never reached) — the
  // count below is what matters.
  const drawnWindUp = hit - attackStartFrame(state, meta, data);
  const msPerTick = 1000 / TICK_HZ;
  // Bias the segment boundary a hair early. Phaser advances a frame when its accumulator reaches
  // the frame's duration, so a boundary landing EXACTLY on a tick resolves on the following update
  // and the contact frame appears one tick late (measured: monk/airLight sat at accumulator ==
  // nextTick on its first active tick). Being a millisecond early is invisible — the sprite is
  // simply extended a hair before the hit box — while being a tick late is the whole defect.
  const windUp = (windUpTicks * msPerTick - BOUNDARY_BIAS_MS) / drawnWindUp;
  const strike = (strikeTicks * msPerTick + BOUNDARY_BIAS_MS) / (n - hit);
  return Array.from({ length: n }, (_, i) => (i < hit ? windUp : strike));
}
