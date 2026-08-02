import { ACTIONABLE, METER_MAX } from "./fighter";
import { allHitBoxes } from "./character-builder";
import { ATTACK_STATE_TO_KEY, emptyInput, isAttackState } from "./types";
import type { Fighter } from "./fighter";
import type { InputSnapshot, StateName } from "./types";
import type { CpuSeam, World } from "./world";

// A CPU opponent for 1vCPU. It lives in sim/ because it must obey the same two rules the rest of
// sim/ does — NO Phaser and NO wall clock — and because it is exactly the thing the sim already
// eats: an InputSnapshot producer. It is driven once per 60 Hz TICK through World.advance's CpuSeam,
// never once per render frame: advance() runs a variable number of ticks per call, so a frame-
// sampled CPU would act at a rate that depends on the display, which is neither fair nor testable.
//
// Randomness is a seeded xorshift32. Math.random would make a match unreproducible and would break the
// determinism the whole sim is built on.

export type Difficulty = "easy" | "normal" | "hard";

interface Knobs {
  /** ticks between attack attempts */
  attackCooldown: number;
  /** extra random ticks (0..jitter-1) added to the cooldown after each swing, so it isn't a metronome */
  cooldownJitter: number;
  /** ticks the opponent must stand in range before this commits to a swing — its "reaction time".
   *  Without it the CPU swings the exact tick you enter reach, and a 4-frame light is unreactable. */
  reactionTicks: number;
  /** 0..1 chance of guarding a telegraphed attack, rolled once per opponent attack */
  blockChance: number;
  /** 0..1 chance of walking in on a tick where it is neither attacking nor blocking */
  approachBias: number;
  /** 0..1 per-tick chance of a jump-in from mid range */
  jumpChance: number;
  /** 0..1 chance an in-range attack is the slower, longer heavy */
  heavyChance: number;
  /** 0..1 chance a FULL meter is spent on the special when the opponent is in range. Below 1 so the
   *  CPU doesn't fire the instant the bar fills — a super that is perfectly punctual is unreadable. */
  specialChance: number;
  /** 0..1 chance of converting a punish window the opponent has ALREADY committed to — a stun, or the
   *  recovery tail of their own whiffed move. Rolled once per window (see `punished`). This is the
   *  single biggest strength knob: without it the CPU converts a whiffed heavy only when its cooldown
   *  happens to be up, i.e. by luck, and hands back the advantage it earns from every block. */
  punishChance: number;
  /** 0..1 chance of swinging at an opponent who is airborne and DESCENDING. Rolled once per airborne
   *  episode (see `antiAired`). Deliberately keyed on `vy > 0` and not on "is airborne": a jump on the
   *  way up has not committed to where it lands, so hitting it would be a read. Past the apex it has.
   *  ponytail: descent-only is the honest ceiling here. A real anti-air also accounts for the jump
   *  ARC (where they will land vs where the box is); that needs opponent gravity/velocity integration
   *  the controller does not do, and would be worth adding only if jump-ins still beat hard. */
  antiAirChance: number;
  /** 0..1 chance of taking a swing on the first tick it is free after a stun. Rolled once per
   *  wake-up. Without it `knockdown` (not ACTIONABLE) zeroes the reaction timer, so the CPU needs a
   *  full `reactionTicks` after standing up before it can answer — a guaranteed free meaty on every
   *  single knockdown. */
  wakeupChance: number;
  /** 0..1 chance an ELIGIBLE approach episode is spent walking away instead. Eligible means "inside
   *  their reach and outside mine" — the gap where they can hit you and you cannot answer. This is a
   *  CONDITIONAL probability, not a share of a partition: it is rolled first, and `approachBias` still
   *  decides advance-vs-hold on everything it does not claim, so the two need not sum to 1. */
  spacingBias: number;
  /**
   * 0 or 1: does this tier refuse to spend a decision on a tick `Fighter.think()` will discard?
   *
   * Not a behaviour of its own — a bug fix (D11 and its two siblings), gated only because `easy` is
   * frozen byte-for-byte and the fix moves the RNG stream. `easy` is 0 and therefore still carries the
   * bug, deliberately; see the KNOBS docstring.
   */
  lockDiscipline: 0 | 1;
}

/**
 * The whole difficulty system: ONE code path, three parameter rows. Nothing below branches on the
 * difficulty NAME.
 *
 * **`easy` is byte-for-byte the row it has always been.** That is deliberate and it is load-bearing:
 * with every new chance at 0, `lockDiscipline` at 0 and none of their draws taken, `easy` plays exactly
 * the match it played before Phase 22 — pinned by FOUR trace hashes in cpu.test.ts (idle, attacking,
 * jumping, and human-vs-human), all captured against the pre-Phase-22 build. It was already a pushover,
 * it is still the same pushover, and the beatability floor the `cpu-difficulty` pass established lives
 * here untouched. The corollary is that easy still carries D11 and its siblings, on purpose.
 *
 * `hard` is meant to WIN a competent match, which is a knowing supersede of that earlier pass for that
 * tier only. The cadence knobs move DOWN with difficulty and the chance knobs move UP; every one of
 * those directions is asserted per-knob in the tests, because a single blanket inequality gets
 * `attackCooldown` exactly backwards.
 *
 * **The Phase 23 cadence re-tune went UP, and the reason matters.** Phase 22 set hard's cooldown at 35
 * against a scripted opponent that turned out to be unable to block at all (0 entries into `blockstun`
 * in 48 matches). Against a proxy that can, that table scores 30.1%, not 63.2% — so the correction was
 * 35 -> 20 for hard and 39 -> 32 for normal, not the reduction the raw D11 measurement first suggested.
 * Nothing else in the table moved. Swept on seeds 1001-1096; gated on blocks never used for tuning.
 */
const KNOBS: Record<Difficulty, Knobs> = {
  easy: { attackCooldown: 105, cooldownJitter: 50, reactionTicks: 22, blockChance: 0.05, approachBias: 0.3, jumpChance: 0, heavyChance: 0.1, specialChance: 0.15, punishChance: 0, antiAirChance: 0, wakeupChance: 0, spacingBias: 0, lockDiscipline: 0 },
  normal: { attackCooldown: 32, cooldownJitter: 12, reactionTicks: 8, blockChance: 0.6, approachBias: 0.64, jumpChance: 0.002, heavyChance: 0.26, specialChance: 0.66, punishChance: 0.65, antiAirChance: 0.38, wakeupChance: 0.32, spacingBias: 0.25, lockDiscipline: 1 },
  hard: { attackCooldown: 20, cooldownJitter: 7, reactionTicks: 6, blockChance: 0.9, approachBias: 0.66, jumpChance: 0.003, heavyChance: 0.28, specialChance: 0.7, punishChance: 0.97, antiAirChance: 0.45, wakeupChance: 0.38, spacingBias: 0.28, lockDiscipline: 1 },
};

/** Which way each knob moves as difficulty RISES. Exported so the tests assert the real table rather
 *  than a second copy of it, and so "harder" can never silently mean "slower to swing". */
export const KNOB_DIRECTION: Record<keyof Knobs, "up" | "down"> = {
  attackCooldown: "down",
  cooldownJitter: "down",
  reactionTicks: "down",
  blockChance: "up",
  approachBias: "up",
  jumpChance: "up",
  heavyChance: "up",
  specialChance: "up",
  punishChance: "up",
  antiAirChance: "up",
  wakeupChance: "up",
  spacingBias: "up",
  lockDiscipline: "up",
};

/** The live table, for tests only. Readonly so nothing can tune the CPU at runtime. */
export const knobsFor = (d: Difficulty): Readonly<Knobs> => KNOBS[d];

/** Multiplier on the damage the CPU DEALS, applied by the render layer to the CPU fighter.
 *  The behaviour knobs decide how often it touches you; this decides what a touch costs.
 *
 *  `hard` is 1.00: it deals the authored numbers, no handicap and no bonus. It was 0.85, which on top
 *  of a swing every ~56 ticks against a human's 15-tick light left it landing ~22% of the damage
 *  throughput of the player it was supposed to threaten. (Hard's cadence is ~23 ticks since the Phase
 *  23 re-tune, so that particular deficit is closed; the scale stays at 1.00 regardless.)
 *
 *  `normal` is 0.8, raised from 0.7 in Phase 22 — a 14% balance change that no document recorded at the
 *  time and that this comment's "Easy and normal keep a real handicap" used to paper over. They do keep
 *  one; it is just smaller than it was. */
export const DAMAGE_SCALE: Record<Difficulty, number> = { easy: 0.55, normal: 0.8, hard: 1 };

const GUARD_RANGE = 175; // start respecting an opponent's attack from here in
const BLOCK_HOLD = 18; // ticks of guard per committed block decision

/**
 * Ticks of walking — or of standing still — per committed approach decision.
 *
 * `approachBias` used to be rolled fresh on EVERY eligible tick, which made it a per-tick coin flip
 * rather than the hesitation its comment claims. At `normal` (0.45) the conditional expected run of
 * `walkF` is `1/(1-0.45) = 1.8` ticks, ~30ms. The shipped walk sheets are 8 frames at 12fps, i.e.
 * 83ms per frame and ~667ms for a cycle, and `FighterSprite` restarts a looping animation whenever
 * the state changes — so the CPU's walk cycle never got past frame 0 and P2 visibly did not walk on
 * any character. Measured on the shipped roster before the fix: the LONGEST walk run in a whole
 * match averaged 5.4-8.2 ticks across all three difficulties. `vx` is zeroed on every dropped tick
 * too, so the movement shuffled as much as the animation did.
 *
 * 20 ticks is a third of a second — 4 drawn frames of the cycle, enough to read as walking. Both
 * sides of the decision are held for the same count, so the marginal probability of walking on an
 * uninterrupted eligible tick is still `approachBias`. That is NOT the same as unchanged difficulty:
 * the variance per 20-tick window goes from Binomial(20, 0.45)'s 4.95 to ~99, so the CPU closes in
 * committed bursts instead of drifting. Time-to-range and corner pressure were re-measured against
 * the pre-change baseline rather than assumed — see docs/phases/21-*.md.
 *
 * Exported so the e2e cannot hardcode a second copy of the number.
 */
export const WALK_HOLD = 20;

/**
 * One fighter's own attack reaches, plus the two aggregates the range logic needs.
 *
 * `min`/`max` exist rather than "light and heavy" because NEITHER is reliably the longer one, and
 * assuming otherwise is a real bug this file shipped: the old code paired a reaction timer keyed to the
 * heavy with an approach keyed to the light, which only worked while every heavy out-reached every
 * light. After Phase 19's trim the jiujitsu's heavy (110) is SHORTER than its light (113), and that
 * fighter's CPU parked in the 110-113 gap — too close to keep walking, too far to arm the timer — and
 * dealt ZERO damage for a whole round on every difficulty.
 */
interface Reaches {
  light: number;
  heavy: number;
  special: number;
  /** The SHORTER of the two normals — walk to here and either one connects. */
  min: number;
  /** The LONGER of the two — inside this, some attack is live, so the reaction timer should run. */
  max: number;
}

/**
 * How far this fighter's own `state` actually reaches, in px forward of its centre.
 *
 * DERIVED, never mirrored. This used to be `LIGHT_RANGE = 110` / `HEAVY_RANGE = 150`, hand-copied from
 * the brawler's boxes — and Phase 19's roster-wide reach trim moved every one of those numbers without
 * touching the copy. The result was a CPU committing heavies outside its real range and, worse,
 * spending a FULL METER on a super at heavy range, because the code assumed "the special reaches at
 * least as far as the heavy on every fighter". After the trim that was false for all three:
 * brawler 104 vs 120, jiujitsu 108 vs 110, monk 110 vs 122.
 *
 * Deliberately conservative — the box's own far edge, with no allowance for the defender's hurt box
 * extending ~30px back toward us. So the CPU steps a little inside its true range before swinging,
 * which is what the old constants did too, and a whiffed commitment is worse than a short walk.
 */
export function reachOf(f: Fighter, state: StateName): number {
  let far = 0;
  for (const b of allHitBoxes(f.cfg, state)) far = Math.max(far, b.x + b.w);
  return far;
}

/**
 * Is this fighter in a window they cannot act out of — i.e. a real punish?
 *
 * Reads ONLY state the fighter has already committed to: a stun already applied, or a move whose
 * active frames are already behind it. No read-ahead, no input peeking.
 *
 * The recovery boundary is `frames.length - recovery`, and `frames.length` is deliberately the lever
 * rather than `attackSimTicks()`: the builder ALREADY expanded that formula into this state's frame
 * list, so reading the length reuses the number instead of re-deriving it — and it is the only version
 * that typechecks, because `attackSimTicks` takes an authored `AttackData` (with `body`/`hit`) while
 * `CharacterConfig.attacks` holds the assembled `AttackSpec`, which has neither. Because the frame list
 * already accounts for `repeat`, the boundary lands after the LAST repeated active window — a multi-hit
 * special does not read as punishable in the gaps between its hits.
 *
 * Module-level and EXPORTED rather than a private method, because the tuning harness needs the same
 * predicate and the copy it had was wrong in the one way that matters: it counted any attack state as
 * punishable, including startup. A scripted opponent built on that counter-attacks into active frames
 * and loses every trade — measured, 96% of the hits its "competent human" took landed while it was
 * locked in its own heavy, which is why that opponent blocked 0 attacks in 48 matches and every
 * strength number gated against it was measured against someone who never guarded. One definition, so
 * the two cannot drift again.
 */
export function isHelpless(f: Fighter): boolean {
  if (f.state === "hitstun" || f.state === "blockstun" || f.state === "knockdown") return true;
  if (!isAttackState(f.state)) return false;
  const spec = f.cfg.attacks[ATTACK_STATE_TO_KEY[f.state]];
  return f.stateFrame >= f.cfg.states[f.state].frames.length - spec.recovery;
}

export class CpuController implements CpuSeam {
  private rngState: number;
  private cooldown = 0;
  private blockTicks = 0;
  /** true while the opponent's CURRENT attack has already been reacted to (one roll per attack) */
  private reacted = false;
  /** true while the opponent's CURRENT helpless window has already been rolled for. Same one-roll-per-
   *  window discipline as `reacted`, and for the same reason: rolled per TICK, `punishChance` would
   *  round to "always" over a 20-tick recovery. Cleared the moment the window ends — see next(). */
  private punished = false;
  /** true while the opponent's CURRENT airborne episode has already been rolled for. Cleared the tick
   *  they touch the ground, so one jump gets one anti-air decision. */
  private antiAired = false;
  /** Was this fighter in a STUN state on the previous tick? The falling edge of this is a wake-up. */
  private wasStunned = false;
  /** A wake-up option is available and unspent. A LATCH, not a per-tick edge: step 2 (guard) returns
   *  before the swing branch is reached, so a CPU that wakes into a live block hold would otherwise
   *  lose the reversal outright — and it wakes into one often, because `blockTicks` counts down while
   *  knocked down. Cleared when it fires, and whenever a fresh stun starts. */
  private wakeupArmed = false;
  /** consecutive ACTIONABLE ticks with the opponent in reach — the reaction timer */
  private inReachTicks = 0;
  /** ticks left on the committed approach decision; 0 means "roll a fresh one". ONE counter plus a
   *  flag, not two counters: two would admit the state "walking AND hesitating", which is not a
   *  thing, and would need an invariant nobody checks. See WALK_HOLD. */
  private episodeTicks = 0;
  /** What the live episode committed to: -1 retreat, 0 hold, +1 advance. Only meaningful while
   *  `episodeTicks > 0`. ONE field, not three flags — three would admit "retreating AND advancing". */
  private episodeMove: -1 | 0 | 1 = 0;
  /** The OPPONENT's longest normal reach, measured once from their own boxes. Static config, the same
   *  thing `reachFor(me)` does for this fighter — never an input, never a prediction. */
  private oppReach?: number;
  private readonly knobs: Knobs;
  /** This fighter's own reaches, measured once. The controller is constructed before it knows WHICH
   *  fighter it drives, so this fills in on the first tick; the boxes are static after assembly. */
  private reach?: Reaches;

  constructor(readonly index: 0 | 1, readonly difficulty: Difficulty, seed = 0x2f6e2b1) {
    this.knobs = KNOBS[difficulty];
    this.rngState = seed >>> 0 || 1;
  }

  /** Clear per-round state. The controller outlives both the automatic round reset and the Enter
   *  rematch, so without this it walks into a fresh round with its reaction already armed. The RNG
   *  is deliberately NOT re-seeded — that would make every round play out identically. */
  reset(): void {
    this.cooldown = 0;
    this.blockTicks = 0;
    this.reacted = false;
    this.punished = false;
    this.antiAired = false;
    this.wasStunned = false;
    this.wakeupArmed = false;
    this.inReachTicks = 0;
    // Without this a committed walk episode survives the round reset and the Enter rematch, and the
    // CPU opens the next round already mid-decision — the same reason `blockTicks` is cleared here.
    this.cancelEpisode();
  }

  /** This fighter's own reaches, measured on first use and cached — the boxes are static once the
   *  character is assembled, and the controller does not know which fighter it drives until it ticks. */
  private reachFor(me: Fighter): Reaches {
    if (!this.reach) {
      const light = reachOf(me, "attackLight");
      const heavy = reachOf(me, "attackHeavy");
      // `min`/`max` rather than assuming heavy is the longer one. It is not: since the Phase 19 trim
      // the jiujitsu's heavy (110) is SHORTER than its light (113), and hardcoding the old
      // relationship opened a dead zone that stopped that fighter attacking at all — see the comments
      // on the two use sites.
      this.reach = {
        light, heavy,
        special: reachOf(me, "special"),
        min: Math.min(light, heavy),
        max: Math.max(light, heavy),
      };
    }
    return this.reach;
  }

  /**
   * Abandon the live approach decision so the next eligible tick rolls a fresh one.
   *
   * Called from EVERY site that ends an approach: arriving inside `myReach.min`, committing to a
   * guard, and committing to a swing. The last two matter and were missed at first — both branches
   * `return` before step 4 is reached, so a half-spent episode simply waited for them and then
   * resumed with whatever remained. A 3-tick remainder resuming after a block is exactly the
   * sub-animation-frame walk this phase exists to remove, so "pause" is never the right verb here:
   * a decision taken at one distance must not survive an exchange that changed it.
   */
  private cancelEpisode(): void {
    this.episodeTicks = 0;
    this.episodeMove = 0;
  }

  /** The opponent's longest normal reach, measured once from THEIR boxes and cached — same shape and
   *  same reasoning as `reachFor(me)`. `max`, not `min`, because the question this answers is "can
   *  they touch me from here", and either normal touching is enough. */
  private reachForOpponent(opp: Fighter): number {
    if (this.oppReach === undefined) {
      this.oppReach = Math.max(reachOf(opp, "attackLight"), reachOf(opp, "attackHeavy"));
    }
    return this.oppReach;
  }

  /**
   * Emit one attack and pay for it. THE single place a swing is committed, so every entry into an
   * attack — the timed one and every free swing — spends the same cooldown, re-arms the same reaction
   * timer, cancels the same approach episode, and gets the same Phase-19 special-range check. Four
   * copies of this block is how the "the special out-reaches the heavy" assumption survived a
   * roster-wide trim last time.
   */
  private commitAttack(input: InputSnapshot, me: Fighter, opp: Fighter, myReach: Reaches, heavy: boolean): InputSnapshot {
    // Jitter the cooldown so the tempo isn't a metronome, and re-arm the reaction so the delay
    // applies to EVERY commitment, not just the first time you walked into range.
    this.cooldown = this.knobs.attackCooldown + Math.floor(this.rand() * this.knobs.cooldownJitter);
    this.inReachTicks = 0;
    // Committing to a swing ends the approach decision — see cancelEpisode.
    this.cancelEpisode();
    // Spend a full bar first when the roll says so. The special is grounded-only and lands HIGH, so
    // it needs no stance bit — but it DOES need its own range check: since Phase 19's reach trim the
    // special is SHORTER than the heavy on all three fighters, so riding the heavy's range threw a
    // whole meter at thin air. Rolling the dice before testing the distance keeps the RNG stream
    // stable; if the super would whiff we fall through to a normal, which still spends the cooldown
    // and keeps the bar for a better moment.
    if (me.meter >= METER_MAX && this.rand() < this.knobs.specialChance && Math.abs(opp.x - me.x) <= myReach.special) {
      input.special = true;
      input.specialPressed = true;
      return input;
    }
    const low = opp.crouchIntent || opp.state === "crouch";
    if (low) {
      input.down = true;
      input.downAtPress = true;
    }
    if (heavy) {
      input.heavy = true;
      input.heavyPressed = true;
    } else {
      input.light = true;
      input.lightPressed = true;
    }
    return input;
  }

  /** xorshift32 — deterministic, no Math.random, uniform enough for "should I block this". */
  private rand(): number {
    let x = this.rngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x >>> 0;
    return this.rngState / 0x100000000;
  }

  next(world: World): InputSnapshot {
    const me = world.fighters[this.index];
    const opp = world.fighters[this.index === 0 ? 1 : 0];
    const input = emptyInput();
    // Measured from THIS fighter's own boxes, once. Every range decision below reads it, so the
    // controller can never be tuned against another character's reach (see reachOf).
    const myReach = this.reachFor(me);

    if (this.cooldown > 0) this.cooldown--;

    // 0. The two "can this decision go anywhere" predicates, hoisted above every site that spends one.
    //
    //    `Fighter.think()` early-returns on a STUN state, on an attack state and on an airborne tick,
    //    so a press issued on any of those is dropped on the floor. Steps 1, 2b, 3 and 4 already
    //    refuse to spend anything there; the guard hold, the guard ROLL and the two one-shot latches
    //    did not, and that is D11 and its two unnamed siblings. Measured on hard across the shipped
    //    roster: 14.1% of block holds never produced a single guarding tick, 38.4% of guard rolls were
    //    latched on a discarded tick, and 1,515 punish windows were spent by a fighter that could not
    //    convert them.
    //
    //    `blockstun` is a deliberate exception, and getting this wrong is a BUFF rather than a fix.
    //    `think()` records `guardIntent` BEFORE its STUN return, and `GUARDABLE` includes `blockstun`,
    //    so a fighter holding guard through blockstun really is guarding — measured 4063/4063 such
    //    ticks resolve `guarding === true`, against 0/3686 for the CPU's own attack. Spending the hold
    //    there is the hold doing its job across a block-string. Cancelling it would lengthen guard in
    //    exactly the timing Phase 13b was tuned against, which is the reason D11 was deferred at all.
    //
    //    Hoisting is stream-neutral: `ACTIONABLE` is a set lookup and no rand() draw sits between here
    //    and where `canAct` used to be computed.
    const canAct = ACTIONABLE.has(me.state);
    const guardEligible = canAct || me.state === "blockstun";
    // CANCEL, not pause. A guard decision must not survive the exchange that invalidated it — the same
    // rule, and the same verb, cancelEpisode() applies to a walk. Pausing would instead hand the CPU a
    // full-length hold on wake-up and postpone its reversal by up to BLOCK_HOLD ticks.
    if (this.knobs.lockDiscipline && !guardEligible) this.blockTicks = 0;
    else if (this.blockTicks > 0) this.blockTicks--;

    const dx = opp.x - me.x;
    const dist = Math.abs(dx);
    const towardRight = dx >= 0;

    // 1. The reaction timer, updated FIRST so no branch below can leave it stale. It ticks only
    //    while this fighter could actually act on it: letting it charge through its own attack,
    //    hitstun or knockdown means it emerges from a locked state with the reaction banked. It
    //    must also update on guarding ticks — the guard branch returns early, and freezing the
    //    counter there let a block episode carry a stale charge across a trip out of range.
    // `max`, not `heavy`: the timer must run whenever ANY normal could be thrown, or a fighter whose
    // heavy is the shorter of the two never arms it at the distance it stops walking at.
    if (canAct && dist <= myReach.max) this.inReachTicks++;
    else this.inReachTicks = 0;

    // 1b. Arm the wake-up on the stun -> free transition. Computed HERE, in step 1, because step 2
    //     returns early on a guarding tick: reading the edge later would lose it entirely on exactly
    //     the ticks it matters most. Held as a latch until it is spent or a fresh stun replaces it —
    //     firing after a guard hold expires is correct, you cannot reversal while blocking.
    //
    //     Arming is gated on the same knob that consumes it. Without that, a tier with wakeupChance 0
    //     arms the latch and never clears it — the flag's documented invariant ("cleared when it
    //     fires") is simply false on easy, since nothing there ever fires it. No behavioural effect
    //     today because nothing else reads the flag; it becomes one the moment something does.
    const stunned = me.state === "hitstun" || me.state === "blockstun" || me.state === "knockdown";
    if (stunned) this.wakeupArmed = false;
    else if (this.knobs.wakeupChance > 0 && this.wasStunned && canAct) this.wakeupArmed = true;
    this.wasStunned = stunned;

    // Is the opponent stuck in something they cannot act out of? Computed HERE because step 2 needs it
    // too, not just step 3a.
    const helpless = isHelpless(opp);

    // 2. Guard a telegraphed attack. One roll per opponent attack (`reacted`), so blockChance reads
    //    as "how often does it block an attack" rather than "per tick", which would round to always.
    //
    //    Suppressing the guard during the opponent's RECOVERY is what stops guarding from
    //    cannibalising the punish. The guard roll used to fire on ANY attack state, including one
    //    whose active frames are already spent — so the CPU would plant itself in a block against a
    //    move that can no longer hit it, and the early return below meant the punish branch never ran.
    //    That coupling is invisible until blockChance is raised: taking hard from 0.22 to 0.72 cut its
    //    conversion of a whiffed heavy by two thirds, purely by blocking thin air. Block the startup
    //    and the active frames; punish the recovery. There is nothing left to guard by then.
    //
    //    It is gated on `punishChance > 0` for the same reason the draws are: a tier with no punish
    //    has nothing to protect, so it must keep the OLD guard behaviour exactly. Without this gate
    //    the suppression applied to `easy` as well — changing both its decisions and its RNG stream in
    //    every exchange where the player attacks. The byte-identity test missed it because that
    //    fixture's opponent never attacks; it now runs an ATTACKING opponent for precisely this reason.
    const guardSuppressed = this.knobs.punishChance > 0 && helpless;
    const oppAttacking = isAttackState(opp.state) && !guardSuppressed;
    //    The `guardEligible` term is step 0's rule applied to the ROLL, not just to the hold. `reacted`
    //    is one-roll-per-attack, so a roll taken while this fighter is locked does not merely waste a
    //    draw — it LATCHES, and the attack it was for cannot be rolled for again even if the CPU comes
    //    free two ticks later with the active frames still ahead of it. Measured at 38.4% of all guard
    //    rolls on hard. Deferring the roll instead means it happens on the first tick it could be acted
    //    on, against an attack that is still live.
    if (!oppAttacking) this.reacted = false;
    else if (!this.reacted && dist < GUARD_RANGE && (!this.knobs.lockDiscipline || guardEligible)) {
      this.reacted = true;
      if (this.rand() < this.knobs.blockChance) this.blockTicks = BLOCK_HOLD;
    }
    if (this.blockTicks > 0) {
      input.block = true;
      // Crouch-guard a low; stand-guard everything else. The lows are the CROUCH normals — both
      // ground normals land high, and air normals are overheads, so guarding low against either is
      // exactly the wrong answer.
      input.down = opp.state === "crouchLight" || opp.state === "crouchHeavy";
      // Guarding ENDS the approach decision — see cancelEpisode.
      this.cancelEpisode();
      return input;
    }

    // 3a. Punish a window the opponent is ALREADY stuck in — a stun, or the recovery tail of their
    //     own whiffed move. One roll per window (`punished`), for the same reason `reacted` exists:
    //     rolled per tick over a 20-tick recovery, any chance above ~0.1 rounds to "always".
    //     The roll is gated on being in range, so a window across the screen does not BURN the
    //     one shot at it — the CPU can still convert the next one it can actually reach.
    //
    //     The `> 0` guard is not a micro-optimisation, it is the thing that keeps the tiers
    //     independent. A draw taken for a chance of ZERO still advances the shared xorshift stream,
    //     so simply *adding* this roll moved every later decision on `easy` too — and easy, which has
    //     none of these behaviours, started KO'ing the idle player that `difficulty is survivable`
    //     pins as unbeatable-by-easy. A tier whose knob is 0 must come out of this pass playing
    //     exactly as it did before it. Skipping the draw is what makes that true.
    //     (It also gives the mutation pass a stream-EXACT off switch: set the knob to 1e-12 rather
    //     than 0 and the draw is still taken, so only the branch outcome changes.)
    // 2b. Spend the armed wake-up. Reached only once the guard hold (if any) has expired.
    //
    //     The latch is consumed on the first tick this fighter is actually FREE, in range or not.
    //     Gating consumption on range instead let it survive an arbitrary walk across the stage and
    //     then fire on arrival — a "wake-up reversal" seconds after the wake-up, which is a different
    //     and much worse behaviour than the one this knob describes. Out of range the opportunity
    //     simply passes: there was no meaty to reverse.
    // Which normal this tick would actually throw, decided BEFORE the three one-shot latches rather
    // than after them. The latches used to gate on `myReach.max` while the swing below was range-
    // checked against whichever normal this roll picked — so in the annulus between the two reaches a
    // window could be latched, the shot spent, and the swing then refused for range with nothing
    // thrown. Measured at 154 occurrences per 48 matches on hard; on the brawler (light 91, heavy 120)
    // that band is 29px wide and the light comes up 72% of the time.
    //
    // Moving the draw up is stream-safe for `easy` and does not need the knob: the only rand() calls
    // between the two positions live inside the wake-up, punish and anti-air blocks, and all three are
    // `knob > 0` gated with easy at 0, so nothing is drawn in between on that tier. The four trace
    // hashes are what actually prove it.
    const heavy = this.rand() < this.knobs.heavyChance;
    const reach = heavy ? myReach.heavy : myReach.light;

    let freeSwing = false;
    if (this.knobs.wakeupChance > 0 && this.wakeupArmed && canAct) {
      this.wakeupArmed = false;
      if (dist <= reach && this.rand() < this.knobs.wakeupChance) freeSwing = true;
    }

    // `canAct` here, not `guardEligible`: a fighter in blockstun can hold a guard but cannot swing, so
    // spending the one shot at the window from inside blockstun throws it away. Step 3's own `canAct`
    // check refuses the swing — it just runs too late to stop the latch, which is the whole defect.
    if (!helpless) this.punished = false;
    if (this.knobs.punishChance > 0 && helpless && !this.punished && dist <= reach && (!this.knobs.lockDiscipline || canAct)) {
      this.punished = true;
      if (this.rand() < this.knobs.punishChance) freeSwing = true;
    }

    // 3b. Contest a jump-in on the way DOWN. `vy > 0` is descending, so the arc is already committed
    //     and this reads history, not intent — swinging at a RISING jump would be a guess about where
    //     it is going. One roll per airborne episode, cleared when they land.
    if (opp.grounded) this.antiAired = false;
    // Same rule, same reason as the punish latch above: one episode, one decision, and only on a tick
    // that could act on it.
    if (this.knobs.antiAirChance > 0 && !opp.grounded && opp.vy > 0 && !this.antiAired && dist <= reach && (!this.knobs.lockDiscipline || canAct)) {
      this.antiAired = true;
      if (this.rand() < this.knobs.antiAirChance) freeSwing = true;
    }

    // 3. In range and off cooldown: swing — but only once the reaction timer above has run. A free
    //    swing (above) skips the cooldown and the reaction timer; it does NOT skip `canAct`, reach or
    //    `grounded`.
    //
    //    `canAct` is load-bearing and easy to miss. On the timed path it was already implied —
    //    `inReachTicks > reactionTicks` can only be true on an ACTIONABLE tick, because step 1 zeroes
    //    the counter otherwise. A free swing carries no such implication, so without this the CPU
    //    would burn its cooldown AND its one-shot window on a press `Fighter.think` silently discards
    //    while it is stunned or mid-attack. Same rule the reaction timer already follows.
    const timed = this.cooldown === 0 && this.inReachTicks > this.knobs.reactionTicks;
    if ((timed || freeSwing) && canAct && me.grounded && dist <= reach) {
      return this.commitAttack(input, me, opp, myReach, heavy);
    }

    // 4. Otherwise close the gap (or hesitate, which is what makes easy feel easy).
    // `min`, not `light`: walk until BOTH normals are live. Stopping at the longer one left the
    // jiujitsu parked between its heavy (110) and its light (113) -- too close to approach, too far to
    // arm the reaction timer -- so it stood still and dealt zero damage for a whole round.
    //
    // The decision is per EPISODE, not per tick (see WALK_HOLD). Arriving in range cancels it, as do
    // the guard and attack branches above — all three are `cancelEpisode()`, never a pause.
    if (dist <= myReach.min) {
      this.cancelEpisode();
      return input;
    }
    // Only spend the episode on ticks the fighter can actually walk on. `next()` is still called
    // while attacking, stunned, knocked down or airborne (world.ts drives the seam every fight tick),
    // and `Fighter.think` discards movement in all of them — an episode burning there would be spent
    // on nothing, and a 20-tick walk could emerge from a knockdown with 3 ticks left. Same rule the
    // reaction timer above already follows, for the same reason.
    if (!canAct || !me.grounded) return input;

    if (this.episodeTicks === 0) {
      // Three outcomes now, composed as a CONDITIONAL and not as a partition — `approachBias` keeps
      // its exact old meaning, and `spacingBias` only claims episodes from the danger gap, so the two
      // are free to sum past 1. Retreat is eligible only where it is actually a spacing tool: inside
      // THEIR reach and outside MINE. Backing off from across the stage is just running away, and a
      // CPU that does it never closes and times every round out.
      const retreat =
        this.knobs.spacingBias > 0 &&
        dist <= this.reachForOpponent(opp) &&
        this.rand() < this.knobs.spacingBias;
      this.episodeMove = retreat ? -1 : this.rand() < this.knobs.approachBias ? 1 : 0;
      this.episodeTicks = WALK_HOLD;
    }
    this.episodeTicks--;
    if (this.episodeMove === 0) return input;

    // A committed retreat runs its whole episode even if it walks out of eligibility — that is the
    // Phase 21 commitment rule, and the three cancelEpisode() sites are still the only way out.
    // Cornered, this presses into the wall and spatial.ts clamps it; harmless.
    const goRight = this.episodeMove === 1 ? towardRight : !towardRight;
    if (goRight) input.right = true;
    else input.left = true;
    if (this.episodeMove === 1 && dist < GUARD_RANGE * 2 && this.rand() < this.knobs.jumpChance) {
      input.up = true;
      input.upPressed = true;
    }
    return input;
  }
}
