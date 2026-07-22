import { ACTIONABLE } from "./fighter";
import { emptyInput, isAttackState } from "./types";
import type { InputSnapshot } from "./types";
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
}

const KNOBS: Record<Difficulty, Knobs> = {
  easy: { attackCooldown: 105, cooldownJitter: 50, reactionTicks: 22, blockChance: 0.05, approachBias: 0.3, jumpChance: 0, heavyChance: 0.1 },
  normal: { attackCooldown: 66, cooldownJitter: 30, reactionTicks: 14, blockChance: 0.12, approachBias: 0.45, jumpChance: 0.001, heavyChance: 0.2 },
  hard: { attackCooldown: 48, cooldownJitter: 18, reactionTicks: 8, blockChance: 0.22, approachBias: 0.55, jumpChance: 0.003, heavyChance: 0.28 },
};

/** Multiplier on the damage the CPU DEALS, applied by the render layer to the CPU fighter.
 *  The behaviour knobs decide how often it touches you; this decides what a touch costs. */
export const DAMAGE_SCALE: Record<Difficulty, number> = { easy: 0.55, normal: 0.7, hard: 0.85 };

// Distances in px between fighter centers, read off the shipped boxes (brawler light reaches
// x+w = 110 forward, heavy 155; the pushboxes are 56 wide so the pair can never be closer than ~56).
const LIGHT_RANGE = 110;
const HEAVY_RANGE = 150;
const GUARD_RANGE = 175; // start respecting an opponent's attack from here in
const BLOCK_HOLD = 18; // ticks of guard per committed block decision

export class CpuController implements CpuSeam {
  private rngState: number;
  private cooldown = 0;
  private blockTicks = 0;
  /** true while the opponent's CURRENT attack has already been reacted to (one roll per attack) */
  private reacted = false;
  /** consecutive ACTIONABLE ticks with the opponent in reach — the reaction timer */
  private inReachTicks = 0;
  private readonly knobs: Knobs;

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
    this.inReachTicks = 0;
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

    if (this.cooldown > 0) this.cooldown--;
    if (this.blockTicks > 0) this.blockTicks--;

    const dx = opp.x - me.x;
    const dist = Math.abs(dx);
    const towardRight = dx >= 0;

    // 1. The reaction timer, updated FIRST so no branch below can leave it stale. It ticks only
    //    while this fighter could actually act on it: letting it charge through its own attack,
    //    hitstun or knockdown means it emerges from a locked state with the reaction banked. It
    //    must also update on guarding ticks — the guard branch returns early, and freezing the
    //    counter there let a block episode carry a stale charge across a trip out of range.
    const canAct = ACTIONABLE.has(me.state);
    if (canAct && dist <= HEAVY_RANGE) this.inReachTicks++;
    else this.inReachTicks = 0;

    // 2. Guard a telegraphed attack. One roll per opponent attack (`reacted`), so blockChance reads
    //    as "how often does it block an attack" rather than "per tick", which would round to always.
    const oppAttacking = isAttackState(opp.state);
    if (!oppAttacking) this.reacted = false;
    else if (!this.reacted && dist < GUARD_RANGE) {
      this.reacted = true;
      if (this.rand() < this.knobs.blockChance) this.blockTicks = BLOCK_HOLD;
    }
    if (this.blockTicks > 0) {
      input.block = true;
      // Crouch-guard a low; stand-guard everything else. The lows are the CROUCH normals — both
      // ground normals land high, and air normals are overheads, so guarding low against either is
      // exactly the wrong answer.
      input.down = opp.state === "crouchLight" || opp.state === "crouchHeavy";
      return input;
    }

    // 3. In range and off cooldown: swing — but only once the reaction timer above has run.
    const heavy = this.rand() < this.knobs.heavyChance;
    const reach = heavy ? HEAVY_RANGE : LIGHT_RANGE;
    if (this.cooldown === 0 && this.inReachTicks > this.knobs.reactionTicks && dist <= reach && me.grounded) {
      // Jitter the cooldown so the tempo isn't a metronome, and re-arm the reaction so the delay
      // applies to EVERY commitment, not just the first time you walked into range.
      this.cooldown = this.knobs.attackCooldown + Math.floor(this.rand() * this.knobs.cooldownJitter);
      this.inReachTicks = 0;
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

    // 4. Otherwise close the gap (or hesitate, which is what makes easy feel easy).
    if (dist > LIGHT_RANGE && this.rand() < this.knobs.approachBias) {
      if (towardRight) input.right = true;
      else input.left = true;
      if (me.grounded && dist < GUARD_RANGE * 2 && this.rand() < this.knobs.jumpChance) {
        input.up = true;
        input.upPressed = true;
      }
    }
    return input;
  }
}
