import { describe, expect, it } from "vitest";
import { World } from "./world";
import type { CpuSeam } from "./world";
import { CpuController, DAMAGE_SCALE, KNOB_DIRECTION, WALK_HOLD, isHelpless, knobsFor, reachOf } from "./cpu";
import type { Difficulty } from "./cpu";
import { FIGHTER_A, FIGHTER_B } from "./config";
import { ACTIONABLE, Fighter, METER_MAX } from "./fighter";
import { assembleCharacter } from "./character-builder";
import shippedRegistry from "../../public/configs/character-gym.json";
import type { CharacterData } from "./types";
import { emptyInput, isAttackState } from "./types";
import type { InputSnapshot } from "./types";
import { DT } from "./constants";

const NONE: [InputSnapshot, InputSnapshot] = [emptyInput(), emptyInput()];

/** The REAL roster, not config.ts's fixture — the reach drift this file now guards only exists here. */
const SHIPPED = shippedRegistry as unknown as Record<string, { data: CharacterData }>;

/** fresh world in the fight phase with the pair `gap` px apart (same helper shape as combat.test). */
function fightWorld(gap = 400): World {
  const w = new World(FIGHTER_A, FIGHTER_B);
  w.match.phase = "fight";
  w.match.introTicks = 0;
  const cx = 848;
  w.fighters[0].reset(cx - gap / 2, 1);
  w.fighters[1].reset(cx + gap / 2, -1);
  return w;
}

/** Run `ticks` sim ticks with the CPU on player 1 and nothing on player 0. */
function runCpu(diff: Difficulty, ticks: number, seed = 7, gap = 400): World {
  const w = fightWorld(gap);
  const cpu = new CpuController(1, diff, seed);
  for (let i = 0; i < ticks; i++) w.advance(DT, NONE, cpu);
  return w;
}

/**
 * Attacks STARTED by the CPU over a fixed window at poking range.
 *
 * The window was 600 ticks, which yielded 5-9 attacks per tier — small enough that `cooldownJitter`
 * (0-29 on normal, 0-17 on hard) could put normal and hard on the SAME count and red the monotonicity
 * assertion below on one seed in three. The counts are what is noisy, not the ordering, so the fix is
 * a longer window rather than a looser comparison: 1800 ticks triples the sample and the jitter
 * averages out. Widening `<` to `<=` would have hidden a real inversion if one ever appeared.
 *
 * The bag is pinned in PLACE as well as alive, and that is load-bearing rather than tidy. Every hit
 * carries `knockback.x` 130, so an unpinned bag is shoved out of reach and the CPU has to walk back —
 * which means the count saturates at "how fast can it re-close the gap" instead of "how often does it
 * swing". A FASTER tier knocks the bag away more often, so the confound grows with exactly the thing
 * being measured: at hard's re-tuned cadence normal out-counted hard 35 to 33, an inversion that was
 * entirely walk-back time. Pinned, this measures cadence, which is what the assertion claims.
 */
function countAttacks(diff: Difficulty, seed: number): number {
  const w = fightWorld(90);
  const cpu = new CpuController(1, diff, seed);
  const bagX = w.fighters[0].x;
  let attacks = 0;
  let wasAttacking = false;
  for (let i = 0; i < 1800; i++) {
    // Keep the punching bag alive: a KO ends the round and then the match, which caps EVERY
    // difficulty at the same number of attacks and hides the difference being measured.
    w.fighters[0].health = 9999;
    // ...and at poking range, so the measurement is cadence and not knockback recovery (see above).
    w.fighters[0].x = bagX;
    w.fighters[0].vx = 0;
    w.advance(DT, NONE, cpu);
    const now = isAttackState(w.fighters[1].state);
    if (now && !wasAttacking) attacks++;
    wasAttacking = now;
  }
  return attacks;
}

describe("CpuSeam is sampled once per TICK, not once per advance() call", () => {
  it("a 3-tick batch asks the controller three times", () => {
    // The regression this pins: a CPU sampled once per render frame acts at the DISPLAY's rate.
    // Re-introduce that by hoisting the cpu.next() call out of world.ts's while loop and this fails
    // with 1 instead of 3.
    let calls = 0;
    const spy: CpuSeam = {
      index: 1,
      next: () => {
        calls++;
        return emptyInput();
      },
    };
    const w = fightWorld();
    const ticks = w.advance(DT * 3, NONE, spy);
    expect(ticks).toBe(3);
    expect(calls).toBe(3);
  });

  it("is NOT asked on ticks that consume no input (intro, round end, hitstop)", () => {
    // The controller carries cooldown/reaction counters, so deciding on a tick that then early-
    // returns burns a cooldown and throws the attack away — it would leave hitstop with its timers
    // silently wound forward. Remove the consumesInput() gate in world.advance and this goes red.
    let calls = 0;
    const spy: CpuSeam = { index: 1, next: () => { calls++; return emptyInput(); } };

    const intro = fightWorld();
    intro.match.phase = "intro";
    intro.match.introTicks = 30;
    intro.advance(DT * 5, NONE, spy);
    expect(calls).toBe(0);

    const stopped = fightWorld();
    stopped.hitstop = 5;
    stopped.advance(DT * 4, NONE, spy);
    expect(calls).toBe(0);

    const ended = fightWorld();
    ended.match.phase = "matchEnd";
    ended.advance(DT * 4, NONE, spy);
    expect(calls).toBe(0);

    // ...and it IS asked once the round is actually being fought.
    fightWorld().advance(DT * 2, NONE, spy);
    expect(calls).toBe(2);
  });

  it("a frame too short to run a tick asks it zero times", () => {
    let calls = 0;
    const spy: CpuSeam = { index: 1, next: () => { calls++; return emptyInput(); } };
    fightWorld().advance(DT / 2, NONE, spy);
    expect(calls).toBe(0);
  });

  it("leaves the OTHER player's input untouched", () => {
    const w = fightWorld(90);
    const seen: InputSnapshot[] = [];
    const spy: CpuSeam = { index: 1, next: () => { seen.push(emptyInput()); return emptyInput(); } };
    const held: [InputSnapshot, InputSnapshot] = [{ ...emptyInput(), right: true }, emptyInput()];
    const before = w.fighters[0].x;
    w.advance(DT * 5, held, spy);
    expect(seen.length).toBe(5);
    expect(w.fighters[0].x).toBeGreaterThan(before); // P0 still walked on its own held input
  });
});

describe("CpuController is deterministic", () => {
  it("same seed + same tick sequence => identical world state", () => {
    const a = runCpu("hard", 240);
    const b = runCpu("hard", 240);
    expect(b.fighters[1].x).toBe(a.fighters[1].x);
    expect(b.fighters[0].health).toBe(a.fighters[0].health);
    expect(b.fighters[1].state).toBe(a.fighters[1].state);
  });

  it("a different seed gives a different match (the rolls really are consulted)", () => {
    // Compared over the WHOLE match, not on two end-state scalars. Final `x` and `health` converge:
    // the CPU walks in, stops at `myReach.min` and pokes on cadence, so after a few hundred ticks two
    // different seeds sit at the identical resting position with the identical damage dealt while
    // having played visibly different matches. That is not determinism failing, it is the observable
    // being too coarse — this version diverges at tick 40 and the old one read "same" at tick 240.
    const trace = (seed: number): string => {
      const w = fightWorld(400);
      const cpu = new CpuController(1, "normal", seed);
      const parts: string[] = [];
      for (let i = 0; i < 240; i++) {
        w.advance(DT, NONE, cpu);
        parts.push(`${w.fighters[1].x.toFixed(3)}|${w.fighters[1].state}|${w.fighters[0].health}`);
      }
      return parts.join(";");
    };
    expect(trace(7)).not.toBe(trace(99));
  });

});

describe("CpuController behaviour", () => {
  it("closes the distance from across the stage", () => {
    const w = fightWorld(600);
    const cpu = new CpuController(1, "normal", 3);
    const gapBefore = w.fighters[1].x - w.fighters[0].x;
    for (let i = 0; i < 120; i++) w.advance(DT, NONE, cpu);
    expect(w.fighters[1].x - w.fighters[0].x).toBeLessThan(gapBefore - 100);
  });

  it("attacks once it is in range", () => {
    const w = fightWorld(90);
    const cpu = new CpuController(1, "hard", 5);
    let attacked = false;
    for (let i = 0; i < 120 && !attacked; i++) {
      w.advance(DT, NONE, cpu);
      if (isAttackState(w.fighters[1].state)) attacked = true;
    }
    expect(attacked).toBe(true);
  });

  it("guards a telegraphed attack on hard", () => {
    const w = fightWorld(90);
    const cpu = new CpuController(1, "hard", 11);
    // Hold P0 attacking; the CPU should be guarding on some tick while that attack is live.
    const swing: [InputSnapshot, InputSnapshot] = [
      { ...emptyInput(), heavy: true, heavyPressed: true },
      emptyInput(),
    ];
    let guarded = false;
    for (let i = 0; i < 300 && !guarded; i++) {
      w.fighters[1].health = 9999; // it must survive long enough to be seen guarding
      w.advance(DT, swing, cpu);
      if (w.fighters[1].guarding) guarded = true;
    }
    expect(guarded).toBe(true);
  });

  it("hard is more aggressive than easy over the same window", () => {
    const easy = countAttacks("easy", 21);
    const hard = countAttacks("hard", 21);
    expect(hard).toBeGreaterThan(easy);
    expect(easy).toBeGreaterThan(0);
  });

  it("aggression is monotonic easy < normal < hard on every seed", () => {
    // One seed proves nothing: the RNG stream diverges between difficulties (different rolls are
    // consumed on different ticks), so monotonicity has to hold across several fixed seeds.
    for (const seed of [21, 4242, 900001]) {
      const easy = countAttacks("easy", seed);
      const normal = countAttacks("normal", seed);
      const hard = countAttacks("hard", seed);
      expect(easy).toBeLessThan(normal);
      expect(normal).toBeLessThan(hard);
    }
  });
});

describe("the CPU cannot swing frame-perfectly (reaction delay)", () => {
  /** First tick index on which the CPU entered an attack state, or -1. */
  function firstAttackTick(diff: Difficulty, ticks = 240, seed = 5, gap = 100): number {
    const w = fightWorld(gap);
    const cpu = new CpuController(1, diff, seed);
    for (let i = 0; i < ticks; i++) {
      w.fighters[0].health = 9999;
      w.advance(DT, NONE, cpu);
      if (isAttackState(w.fighters[1].state)) return i;
    }
    return -1;
  }

  it("does not attack on the first ticks the player is already in range", () => {
    // Easy has the longest reaction window; it must not be swinging inside it.
    const first = firstAttackTick("easy");
    expect(first).toBeGreaterThanOrEqual(20);
  });

  it("every difficulty leaves the player at least a few ticks to react", () => {
    // Anchored to the KNOB, not to a literal. This used to assert a flat `>= 6`, which was really the
    // old hard `reactionTicks` of 8 wearing a margin — so re-tuning hard to 5 reddened it for no
    // behavioural reason. Reading the knob is strictly stronger: it now checks that each tier
    // actually honours its OWN declared reaction time, which the flat number never did.
    for (const diff of ["easy", "normal", "hard"] as Difficulty[]) {
      expect(firstAttackTick(diff), `${diff} swung sooner than its own reactionTicks`)
        .toBeGreaterThanOrEqual(knobsFor(diff).reactionTicks);
    }
    // ...plus an absolute floor no future tuning may cross. Below ~4 ticks (67ms) a swing is inside
    // human reaction time and the CPU is reading you, not reacting to you.
    expect(knobsFor("hard").reactionTicks, "hard is close to frame-perfect").toBeGreaterThanOrEqual(4);
  });

  it("re-arms the delay after each swing, so it cannot chain at contact range", () => {
    // Count the tick gaps between the starts of consecutive attacks: none may be shorter than the
    // reaction window, or the CPU is machine-gunning once the cooldown lapses.
    const w = fightWorld(100);
    const cpu = new CpuController(1, "easy", 5);
    const starts: number[] = [];
    let wasAttacking = false;
    for (let i = 0; i < 900; i++) {
      w.fighters[0].health = 9999;
      w.advance(DT, NONE, cpu);
      const now = isAttackState(w.fighters[1].state);
      if (now && !wasAttacking) starts.push(i);
      wasAttacking = now;
    }
    // Easy's floor is attackCooldown (105) + the reaction window on top, so anything near 20 would
    // mean the tuned cooldown isn't actually being applied.
    expect(starts.length).toBeGreaterThan(2);
    const gaps: number[] = [];
    for (let i = 1; i < starts.length; i++) gaps.push(starts[i] - starts[i - 1]);
    for (const gap of gaps) expect(gap).toBeGreaterThan(105);
    // ...and the gaps are not all the same: zero cooldownJitter makes the CPU a metronome you can
    // set your watch by, which is exactly the tell that made the old one feel unfair.
    expect(new Set(gaps).size).toBeGreaterThan(1);
  });

  it("never asks for an attack while locked in hitstun", () => {
    // The counter must only run on ticks the CPU could actually act on. If it charges through
    // hitstun/knockdown, the CPU emerges from a stun with its reaction already full and swings on
    // the first actionable frame — remove the ACTIONABLE gate in cpu.ts and this goes red.
    const w = fightWorld(100);
    const cpu = new CpuController(1, "easy", 5);
    // Pin it in hitstun, in range, for far longer than its reaction window, and ask it every tick.
    // It must never ask for an attack it cannot start: think() would swallow the press and the
    // cooldown/reaction bookkeeping would be spent on a swing that never happened.
    // The world is advanced WITHOUT the seam so cpu.next() is asked exactly once per tick, here,
    // where the answer can be inspected — otherwise the controller is driven down two paths per
    // iteration and only one of them is checked.
    let pressedWhileLocked = 0;
    for (let i = 0; i < 90; i++) {
      w.fighters[1].applyHit(0, 30, 0, 0, false);
      expect(ACTIONABLE.has(w.fighters[1].state)).toBe(false);
      const decision = cpu.next(w);
      if (decision.lightPressed || decision.heavyPressed) pressedWhileLocked++;
      w.advance(DT, NONE);
    }
    expect(pressedWhileLocked).toBe(0);
  });

  it("the world resets the controller on EVERY round, not just on a rematch", () => {
    // A round that ends on its own (KO or timeout) resets the fighters but the controller outlives
    // it, so without this the CPU walks into round 2 with its reaction already armed. The scene
    // cannot do it — the transition happens inside world.tick — so the seam owns it.
    let resets = 0;
    const spy: CpuSeam = { index: 1, next: () => emptyInput(), reset: () => { resets++; } };
    const w = fightWorld(200);
    w.advance(DT, NONE, spy);
    expect(resets).toBe(0); // a plain fight tick must not reset anything

    w.match.timerTicks = 1; // let the clock run out -> roundEnd -> the pause -> the next round
    w.advance(DT, NONE, spy);
    expect(w.match.phase).toBe("roundEnd");
    w.match.endTicks = 1;
    w.advance(DT, NONE, spy);
    expect(resets).toBe(1);
  });

  it("reset() clears the armed reaction so a rematch does not start with a free hit", () => {
    const w = fightWorld(100);
    const cpu = new CpuController(1, "easy", 5);
    // Charge the reaction up without letting it swing yet.
    for (let i = 0; i < 18; i++) w.advance(DT, NONE, cpu);
    cpu.reset();
    w.restart();
    w.match.phase = "fight";
    w.match.introTicks = 0;
    w.fighters[0].reset(798, 1);
    w.fighters[1].reset(898, -1);
    let attacked = false;
    for (let i = 0; i < 6 && !attacked; i++) {
      w.advance(DT, NONE, cpu);
      if (isAttackState(w.fighters[1].state)) attacked = true;
    }
    expect(attacked).toBe(false);
  });
});

describe("difficulty is survivable", () => {
  it("an idle player is not KO'd by the easy CPU inside one round", () => {
    const w = fightWorld(260);
    const cpu = new CpuController(1, "easy", 7);
    w.fighters[1].damageScale = DAMAGE_SCALE.easy; // the handicap MatchScene applies in cpu mode
    // Run until the round actually ends. Ticks are NOT game seconds — hitstop suppresses the clock
    // decrement — so the exit condition is the phase change, not a tick count.
    let ticks = 0;
    while (w.match.phase === "fight" && ticks < 20000) {
      w.advance(DT, NONE, cpu);
      ticks++;
    }
    expect(w.match.phase).not.toBe("fight");
    expect(w.fighters[0].isKO).toBe(false); // ended on the timer, not on a KO
  });

  it("...but hard still finishes that same idle player", () => {
    // The other end of the ladder. Without this, every knob could drift toward harmless and only
    // the easy-side assertion above would still pass.
    const w = fightWorld(260);
    const cpu = new CpuController(1, "hard", 7);
    w.fighters[1].damageScale = DAMAGE_SCALE.hard;
    let ticks = 0;
    while (w.match.phase === "fight" && ticks < 20000) {
      w.advance(DT, NONE, cpu);
      ticks++;
    }
    expect(w.fighters[0].isKO).toBe(true);
  });
});

// Phase 19. The CPU's attack ranges used to be two hand-copied constants (LIGHT_RANGE 110 /
// HEAVY_RANGE 150) taken from the brawler's boxes. The roster-wide reach trim moved every one of
// those numbers and left the copy behind, so the CPU committed heavies outside its real range and
// threw full-meter supers at thin air. These pin the derivation, on the SHIPPED roster — the fixture
// in config.ts was never trimmed and cannot see this class of drift.
describe("CPU ranges are measured from the fighter's own boxes, not mirrored", () => {
  // Filter on the SHAPE, not the name: the registry carries doc/meta keys and a `_`-prefix convention
  // is not enforced anywhere.
  const ids = Object.keys(SHIPPED).filter((k) => SHIPPED[k]?.data?.attacks != null);

  it("reads each state's reach off the shipped config", () => {
    expect(ids.length).toBeGreaterThanOrEqual(3);
    for (const id of ids) {
      const data = SHIPPED[id].data;
      const f = new Fighter(assembleCharacter(id, data), 0);
      for (const [state, key] of [["attackLight", "light"], ["attackHeavy", "heavy"], ["special", "special"]] as const) {
        const box = data.attacks[key].hit;
        expect(reachOf(f, state), `${id}/${state}`).toBe(box.x + box.w);
      }
    }
  });

  it("knows the special is SHORTER than the heavy on every shipped fighter", () => {
    // This is the assumption the old code got wrong, stated as a fact so a future reach change that
    // invalidates it again shows up here rather than as a wasted super in a live match.
    for (const id of ids) {
      const f = new Fighter(assembleCharacter(id, SHIPPED[id].data), 0);
      expect(reachOf(f, "special"), `${id}: special vs heavy`)
        .toBeLessThan(reachOf(f, "attackHeavy"));
    }
  });

  // The defect this pins was found by an independent QA pass, not by me: a jiujitsu CPU dealt ZERO
  // damage to an idle player for a whole round, on every difficulty. Cause was an invariant I broke
  // when I derived the ranges — the reaction timer used the heavy's reach while the approach used the
  // light's, which is only safe while every heavy out-reaches its own light. It does not: jiujitsu's
  // heavy is 110 and its light 113, so the CPU parked in the 3px gap between them, too close to keep
  // walking and too far to arm the timer, and simply stood there.
  it("every fighter's CPU actually damages an idle opponent (no approach/reaction dead zone)", () => {
    for (const id of ids) {
      const cfg = assembleCharacter(id, SHIPPED[id].data);
      const w = new World(cfg, cfg);
      w.match.phase = "fight";
      w.match.introTicks = 0;
      const cpu = new CpuController(1, "normal", 7);
      const startHp = w.fighters[0].health;
      // 20s of fight — long enough for `normal`'s 66-tick cooldown to land several attacks from any
      // starting distance, short enough to stay a unit test.
      for (let i = 0; i < 1200 && !w.fighters[0].isKO; i++) w.advance(DT, NONE, cpu);
      expect(w.fighters[0].health, `${id}: its CPU never landed a hit in 20s`).toBeLessThan(startHp);
    }
  });

  it("never spends a full meter on a super the fighter cannot reach with", () => {
    for (const id of ids) {
      const cfg = assembleCharacter(id, SHIPPED[id].data);
      const probe = new Fighter(cfg, 0);
      const special = reachOf(probe, "special");
      const heavy = reachOf(probe, "attackHeavy");
      // A gap the HEAVY covers but the SUPER does not — exactly where riding the heavy's range threw
      // the bar away. Sits strictly between the two, so the CPU is in "swing now" territory.
      const gap = Math.floor((special + heavy) / 2) + 1;
      expect(gap, `${id}: fixture needs a gap between the two reaches`).toBeGreaterThan(special);
      expect(gap).toBeLessThanOrEqual(heavy);

      const w = new World(cfg, cfg);
      w.match.phase = "fight";
      w.match.introTicks = 0;
      // hard has the highest specialChance (0.7), so a broken gate shows up fastest here.
      const cpu = new CpuController(1, "hard", 12345);
      let sawSpecial = false;
      for (let i = 0; i < 900; i++) {
        // Pin the pair at `gap` every tick: pushback and knockback would otherwise drift them out of
        // the window under test, and a drifting fixture proves nothing.
        w.fighters[0].reset(848 - gap / 2, 1);
        w.fighters[1].reset(848 + gap / 2, -1);
        w.fighters[1].meter = METER_MAX;
        w.advance(DT, NONE, cpu);
        if (w.fighters[1].state === "special") sawSpecial = true;
      }
      expect(sawSpecial, `${id}: fired a super at ${gap}px, which its own box cannot reach`).toBe(false);
    }
  });
});

// The approach decision is committed for WALK_HOLD ticks instead of re-rolled every tick. The defect
// that forced it was visual and player-reported: P2 "doesn't look like he's walking" on every
// character. `approachBias` was a per-tick coin flip, so at `normal` the expected run of `walkF` was
// 1/(1-0.45) = 1.8 ticks against an 83ms animation frame, the sim state flickered walkF<->idle at
// 60Hz, and FighterSprite restarts a looping animation on every state change — so the walk cycle
// never left frame 0. Measured on the shipped roster before the change, the LONGEST walk run in a
// whole match averaged 5.4-8.2 ticks across all three difficulties; after, ~30.
//
// These pin the EXACT episode semantics, not just "longer than before". An `at least N` assertion
// would stay green against an off-by-one, and 19/20/21 are all reachable from a sloppy reading of
// "set it, then decrement it".
describe("the CPU commits to an approach decision for a whole episode", () => {
  const ids = Object.keys(SHIPPED).filter((k) => SHIPPED[k]?.data?.attacks != null);

  /** Walk the controller by hand at a fixed distance, pinning the pair each tick so pushback cannot
   *  drift them out of the window under test. Returns the per-tick "did it press a direction" trace. */
  function approachTrace(id: string, ticks: number, gap: number, seed = 7): boolean[] {
    const cfg = assembleCharacter(id, SHIPPED[id].data);
    const w = new World(cfg, cfg);
    w.match.phase = "fight";
    w.match.introTicks = 0;
    const cpu = new CpuController(1, "normal", seed);
    const out: boolean[] = [];
    for (let i = 0; i < ticks; i++) {
      w.fighters[0].reset(848 - gap / 2, 1);
      w.fighters[1].reset(848 + gap / 2, -1);
      const d = cpu.next(w);
      out.push(d.left || d.right);
      w.advance(DT, NONE);
    }
    return out;
  }

  /**
   * After an interruption, assert the FIRST run of the resumed approach is a whole number of
   * episodes.
   *
   * Deliberately NOT "the next WALK_HOLD ticks are uniform": a cancelled episode rolls afresh, and
   * that fresh roll lands on the same decision about half the time, so the uniform assertion passed
   * against a live mutation roughly every other run. Run LENGTH is the property that actually
   * differs — 20 or 40 when the episode was cancelled, 10 (the remainder) when it merely paused.
   */
  function expectWholeEpisodes(cpu: CpuController, w: World, pin: () => void, msg: string): void {
    const trace: boolean[] = [];
    for (let i = 0; i < WALK_HOLD * 6; i++) {
      pin();
      const me = w.fighters[1];
      const eligible = ACTIONABLE.has(me.state) && me.grounded;
      const d = cpu.next(w);
      // Record ONLY the ticks the episode actually spends. A tick where the fighter is recovering, or
      // where the block hold is still running, consumes no episode and emits no direction — counting
      // it merges into the leading run and makes every length meaningless. (Measured: including them
      // reported a "37-tick" first run made of blockstun plus a hesitation.)
      if (eligible && !d.block) trace.push(dirOf(d));
      w.advance(DT, NONE);
    }
    expect(trace.length, "not enough eligible ticks to measure an episode").toBeGreaterThan(WALK_HOLD * 2);
    const first = runs(trace)[0];
    expect(first % WALK_HOLD, `${msg} (first run was ${first} eligible ticks)`).toBe(0);
  }

  /** Did this decision ask for a direction at all? */
  const dirOf = (d: InputSnapshot): boolean => d.left || d.right;

  /** Lengths of the maximal runs of equal values — the thing WALK_HOLD is supposed to control. */
  const runs = (xs: boolean[]): number[] =>
    xs.reduce<number[]>((acc, v, i) => (i > 0 && v === xs[i - 1] ? (acc[acc.length - 1]++, acc) : (acc.push(1), acc)), []);

  it("walks, and hesitates, in blocks of exactly WALK_HOLD ticks", () => {
    for (const id of ids) {
      // Far enough out that `dist > myReach.min` holds for every tick, so nothing cancels the episode.
      const trace = approachTrace(id, WALK_HOLD * 10, 600);
      // Drop the first and last runs: the trace starts mid-nothing and is cut off at the end, so only
      // the interior runs are complete episodes.
      const interior = runs(trace).slice(1, -1);
      expect(interior.length, `${id}: not enough complete episodes to measure`).toBeGreaterThan(2);
      for (const r of interior) {
        expect(r % WALK_HOLD, `${id}: run of ${r} ticks is not a whole number of ${WALK_HOLD}-tick episodes`).toBe(0);
      }
      // Both decisions must actually occur, or "commits for 20 ticks" is vacuously true because it
      // always walks. This is the assertion that fails if approachBias is ignored entirely.
      expect(new Set(trace).size, `${id}: never hesitated in ${WALK_HOLD * 10} ticks`).toBe(2);
    }
  });

  it("does not walk once it is already in range (the episode cancels, it does not resume)", () => {
    for (const id of ids) {
      const cfg = assembleCharacter(id, SHIPPED[id].data);
      const probe = new Fighter(cfg, 0);
      const min = Math.min(reachOf(probe, "attackLight"), reachOf(probe, "attackHeavy"));
      // Strictly inside `myReach.min`, where step 4 must not press a direction at all.
      const trace = approachTrace(id, WALK_HOLD * 3, Math.floor(min) - 10);
      expect(trace.some(Boolean), `${id}: kept walking while already in range`).toBe(false);
    }
  });

  it("arriving in range CANCELS the episode — it does not resume where it left off", () => {
    // The assertion above is not enough on its own, and mutation testing is how that was found:
    // deleting the `episodeTicks = 0` on the in-range branch left the whole suite green, because
    // that branch returns before pressing anything either way. What the clear actually buys is this:
    // a decision taken at 600px apart must not carry over to a fight that has since closed and
    // re-opened. Without it the first episode after re-entering range is the leftover REMAINDER of
    // the old one, which is both shorter than WALK_HOLD and not the roll the new distance deserves.
    const cfg = assembleCharacter("brawler", SHIPPED.brawler.data);
    const probe = new Fighter(cfg, 0);
    const min = Math.min(reachOf(probe, "attackLight"), reachOf(probe, "attackHeavy"));
    const inRange = Math.floor(min) - 10;

    const w = new World(cfg, cfg);
    w.match.phase = "fight";
    w.match.introTicks = 0;
    const cpu = new CpuController(1, "normal", 7);
    const pin = (gap: number): void => {
      w.fighters[0].reset(848 - gap / 2, 1);
      w.fighters[1].reset(848 + gap / 2, -1);
    };
    const step = (gap: number): boolean => { pin(gap); const d = cpu.next(w); w.advance(DT, NONE); return d.left || d.right; };

    // Spend PART of an episode out of range...
    const partial = Math.floor(WALK_HOLD / 2);
    for (let i = 0; i < partial; i++) step(600);
    // ...walk into range, which must throw that decision away...
    for (let i = 0; i < 3; i++) step(inRange);
    // ...and back out: the run that follows must be a WHOLE episode, never `WALK_HOLD - partial`.
    const after: boolean[] = [];
    for (let i = 0; i < WALK_HOLD; i++) after.push(step(600));
    expect(new Set(after).size, `the post-range episode split after ${WALK_HOLD - partial} ticks — the old decision resumed`).toBe(1);
  });

  it("reset() drops a committed episode so the next round does not start mid-decision", () => {
    // The controller outlives both the automatic round transition and the Enter rematch. Without the
    // clear in reset(), round 2 opens partway through a decision made in round 1 — the same reason
    // `blockTicks` and the reaction timer are cleared there.
    const cfg = assembleCharacter("brawler", SHIPPED.brawler.data);
    const mk = (): World => {
      const w = new World(cfg, cfg);
      w.match.phase = "fight";
      w.match.introTicks = 0;
      w.fighters[0].reset(848 - 300, 1);
      w.fighters[1].reset(848 + 300, -1);
      return w;
    };
    const cpu = new CpuController(1, "normal", 7);
    const fresh: boolean[] = [];
    let w = mk();
    for (let i = 0; i < WALK_HOLD; i++) { const d = cpu.next(w); fresh.push(d.left || d.right); w.advance(DT, NONE); }

    // Half-spend an episode, then reset: the NEXT episode must be a full one, not the remainder.
    const cpu2 = new CpuController(1, "normal", 7);
    w = mk();
    for (let i = 0; i < WALK_HOLD / 2; i++) { cpu2.next(w); w.advance(DT, NONE); }
    cpu2.reset();
    const after: boolean[] = [];
    w = mk();
    for (let i = 0; i < WALK_HOLD; i++) { const d = cpu2.next(w); after.push(d.left || d.right); w.advance(DT, NONE); }
    // A full episode is uniform. Without the reset the first half carries the old decision's tail and
    // the run splits, so this is exactly the assertion the missing clear turns red.
    expect(new Set(after).size, "the episode after reset() was not a single whole decision").toBe(1);
    // The control run matters, and only as a COMPARISON: `fresh.length === WALK_HOLD` on its own is
    // tautological (it is the loop bound). What it is here to establish is that a controller on this
    // seed produces a uniform first episode at all, so "uniform after reset" is not uniform for some
    // unrelated reason — e.g. because this distance never walks.
    expect(new Set(fresh).size, "the control episode was not uniform either, so the assertion above proves nothing").toBe(1);
  });

  it("guarding or swinging CANCELS the approach episode too, it does not park it", () => {
    // Found by review, not by me: the in-range branch cleared the episode but the guard and attack
    // branches above it `return` before ever reaching step 4, so a half-spent decision simply waited
    // for the exchange to finish and then resumed with its remainder. A 3-tick remainder resuming
    // after a block is precisely the sub-animation-frame walk this whole phase removes.
    const cfg = assembleCharacter("brawler", SHIPPED.brawler.data);
    const w = new World(cfg, cfg);
    w.match.phase = "fight";
    w.match.introTicks = 0;
    const cpu = new CpuController(1, "hard", 11); // hard has the highest blockChance
    const far = (): void => { w.fighters[0].reset(848 - 300, 1); w.fighters[1].reset(848 + 300, -1); };

    // Spend part of an episode at a distance where it can only walk or hesitate.
    const spent = Math.floor(WALK_HOLD / 2);
    for (let i = 0; i < spent; i++) { far(); cpu.next(w); w.advance(DT, NONE); }

    // Force a guard episode: hold P0 swinging at close range until the CPU commits to a block.
    // Positions are NOT re-`reset()` inside this loop — that would drop P0 back to idle every tick,
    // so it would never stay in an attack state and the CPU would have nothing to react to. (That is
    // exactly how the first version of this fixture failed, which is why it is spelled out.)
    w.fighters[0].reset(848 - 45, 1);
    w.fighters[1].reset(848 + 45, -1);
    const swing: [InputSnapshot, InputSnapshot] = [{ ...emptyInput(), heavy: true, heavyPressed: true }, emptyInput()];
    let guarded = false;
    for (let i = 0; i < 400 && !guarded; i++) {
      w.fighters[1].health = 9999; // it has to survive long enough to be seen guarding
      if (cpu.next(w).block) guarded = true;
      w.advance(DT, swing);
    }
    expect(guarded, "fixture never got the CPU to guard, so it proves nothing").toBe(true);

    // Back out to walking range: the next run must be a WHOLE episode, not the pre-guard remainder.
    expectWholeEpisodes(cpu, w, far, `the pre-guard episode resumed with its ${WALK_HOLD - spent}-tick remainder`);
  });

  it("...and the same for committing to a SWING, which is a separate early return", () => {
    // Two distinct `return`s bypass step 4, and covering only one of them is how the first version of
    // this pair let the attack site regress silently: the guard test above stayed green with the
    // attack-site cancel removed. One test per exit.
    const cfg = assembleCharacter("brawler", SHIPPED.brawler.data);
    const w = new World(cfg, cfg);
    w.match.phase = "fight";
    w.match.introTicks = 0;
    const cpu = new CpuController(1, "hard", 5); // hard has the shortest reaction + cooldown
    const far = (): void => { w.fighters[0].reset(848 - 300, 1); w.fighters[1].reset(848 + 300, -1); };

    const spent = Math.floor(WALK_HOLD / 2);
    for (let i = 0; i < spent; i++) { far(); cpu.next(w); w.advance(DT, NONE); }

    // The swing has to happen at a distance where step 4 WOULD otherwise have run, or the in-range
    // cancellation fires first and this test passes for the wrong reason — which is exactly what the
    // first version did, at 45px, where `dist <= myReach.min` cancelled the episode before the CPU
    // ever swung. The window that isolates the attack site is `min < dist <= heavy`: the heavy
    // reaches, the shorter normal does not, so the approach branch is still live.
    const probe = new Fighter(cfg, 0);
    const light = reachOf(probe, "attackLight"), heavy = reachOf(probe, "attackHeavy");
    const min = Math.min(light, heavy);
    expect(heavy, "fixture needs a heavy that out-reaches the shorter normal").toBeGreaterThan(min);
    const gap = Math.floor((min + heavy) / 2);
    expect(gap).toBeGreaterThan(min);
    expect(gap).toBeLessThanOrEqual(heavy);

    let swung = false;
    for (let i = 0; i < 600 && !swung; i++) {
      w.fighters[0].reset(848 - gap / 2, 1);
      w.fighters[1].reset(848 + gap / 2, -1);
      w.fighters[0].health = 9999;
      const d = cpu.next(w);
      if (d.heavyPressed || d.specialPressed) swung = true;
      w.advance(DT, NONE);
    }
    expect(swung, "fixture never got the CPU to swing outside its shorter normal, so it proves nothing").toBe(true);

    expectWholeEpisodes(cpu, w, far, `the pre-swing episode resumed with its ${WALK_HOLD - spent}-tick remainder`);
  });

  it("does not burn episode ticks while the fighter cannot walk anyway", () => {
    // next() is still called while attacking/stunned/airborne — world.ts drives the seam on every
    // fight tick — and Fighter.think discards movement in all of them. An episode spent there would
    // emerge from a knockdown with a few ticks left and stutter exactly as before.
    //
    // The obvious version of this test — lock the fighter, assert it never presses a direction —
    // does NOT measure that, and a review caught it: it locks the fighter before any episode exists,
    // so it passes against a mutation that decrements a live counter while still suppressing the
    // press. What it has to do is spend part of an episode, lock, unlock, and count what is LEFT.
    const cfg = assembleCharacter("brawler", SHIPPED.brawler.data);
    const w = new World(cfg, cfg);
    w.match.phase = "fight";
    w.match.introTicks = 0;
    const cpu = new CpuController(1, "normal", 7);
    const pin = (): void => { w.fighters[0].reset(848 - 300, 1); w.fighters[1].reset(848 + 300, -1); };

    // Spend a few ticks of a live episode while ACTIONABLE...
    const spent = 4;
    const before: boolean[] = [];
    for (let i = 0; i < spent; i++) { pin(); before.push(dirOf(cpu.next(w))); w.advance(DT, NONE); }

    // ...lock the fighter for longer than a whole episode. These ticks must cost the episode nothing.
    let pressedWhileLocked = 0;
    for (let i = 0; i < WALK_HOLD * 2; i++) {
      pin();
      w.fighters[1].applyHit(0, 30, 0, 0, false);
      expect(ACTIONABLE.has(w.fighters[1].state)).toBe(false);
      if (dirOf(cpu.next(w))) pressedWhileLocked++;
      w.advance(DT, NONE);
    }
    expect(pressedWhileLocked, "asked to walk while locked in a non-actionable state").toBe(0);

    // ...and on release the episode must have EXACTLY its remainder left, unchanged by the lock.
    const after: boolean[] = [];
    for (let i = 0; i < WALK_HOLD - spent; i++) { pin(); after.push(dirOf(cpu.next(w))); w.advance(DT, NONE); }
    expect(
      new Set([...before, ...after]).size,
      `the episode changed decision across the lock — ${WALK_HOLD - spent} ticks should have survived it`,
    ).toBe(1);
    // And the tick after that is a NEW roll, so the run really was WALK_HOLD long and not longer.
    pin();
    const total = [...before, ...after];
    expect(total.length).toBe(WALK_HOLD);
  });
});

// ---------------------------------------------------------------------------------------------
// The four new behaviours. Each one has the SAME false-green risk: the ordinary swing branch is
// blind to opponent state, so "the CPU attacked while you were recovering" and "the CPU attacked a
// descending opponent" both happen ANYWAY, by coincidence, whenever its cooldown happens to be up.
// A test that only looks for the attack passes with the new code deleted.
//
// So every test below pins the swing to a tick where the ordinary branch PROVABLY cannot fire —
// `inReachTicks <= reactionTicks`, which only a free swing can reach — and cross-checks against
// `easy`, where all four knobs are 0 and the behaviour must be entirely absent.
// ---------------------------------------------------------------------------------------------

/** A fight world on a mirrored SHIPPED fighter, positions pinned by the caller. */
function mirrorWorld(id = "brawler"): World {
  const w = new World(assembleCharacter(id, SHIPPED[id].data), assembleCharacter(id, SHIPPED[id].data));
  w.match.phase = "fight";
  w.match.introTicks = 0;
  return w;
}

const pressed = (d: InputSnapshot): boolean => d.lightPressed || d.heavyPressed || d.specialPressed;

/**
 * A spread seed set. NEVER feed the controller 1, 2, 3… — `cpu.ts` runs RAW xorshift32 with no
 * warm-up, and on a tiny seed the FIRST output is ~0.00006 (the trap `scenes/roll.ts` was written to
 * document). Every small seed therefore passes the very first chance the controller happens to roll:
 * on the sequential seeds this file started with, the CPU blocked on 20/20 and the punish branch
 * behind that early return was never reached at all — a fixture artefact that reads exactly like a
 * dead feature. Production never sees it (MatchScene's default seed is 0x2f6e2b1), but a test picking
 * its own seeds does. Knuth-mixed, same constant `roll.ts` uses for the same reason.
 */
const seeds = (count: number, from = 1): number[] =>
  Array.from({ length: count }, (_, i) => (Math.imul(from + i, 2654435761) >>> 1) || 1);

/**
 * A ~4-sigma lower bound on `n` trials at probability `p`, floored at 1.
 *
 * Derived from the KNOB rather than written as a literal, because a hand-picked literal is a number
 * about one particular tuning pass. These floors were first written against the pre-tuning knobs
 * (punishChance 0.85, wakeupChance 0.6); tuning hard down to 0.54/0.38 to hit the 60-70% target then
 * reddened three behaviour tests that were measuring nothing wrong. Reading the live knob keeps the
 * assertion pinned to "this behaviour happens about as often as its knob says" — which is the actual
 * claim — instead of to a snapshot of one afternoon's numbers.
 *
 * Still nowhere near the real discrimination: every one of these tests reads 0 with its branch
 * removed, and 4 sigma above 0 is the only thing the floor has to clear.
 */
function chanceFloor(n: number, p: number): number {
  return Math.max(1, Math.floor(n * p - 4 * Math.sqrt(n * p * (1 - p))));
}

/**
 * The matching UPPER bound, and it is not decoration.
 *
 * A floor alone only says "this happens at least sometimes" — an implementation that fires on EVERY
 * eligible trial sails through it. That is a real failure mode here, not a hypothetical: dropping the
 * `!this.punished` / `!this.antiAired` one-roll latch, or comparing against the wrong knob, turns a
 * 0.5 chance into a certainty and the behaviour stops being a *chance* at all. Two-sided, the pair
 * asserts what the knob actually claims: this fires about as often as its number says.
 */
function chanceCeiling(n: number, p: number): number {
  return Math.min(n, Math.ceil(n * p + 4 * Math.sqrt(n * p * (1 - p))));
}

describe("difficulty is one parameter table, and it points the right way", () => {
  it("every knob moves monotonically in its DECLARED direction", () => {
    // Not one blanket `easy <= normal <= hard`. Three knobs — attackCooldown, cooldownJitter,
    // reactionTicks — get FASTER as difficulty rises, so a single inequality asserts the exact
    // opposite of the intent for them and would go green on a CPU tuned backwards.
    const tiers = ["easy", "normal", "hard"] as const;
    for (const knob of Object.keys(KNOB_DIRECTION) as (keyof typeof KNOB_DIRECTION)[]) {
      const [e, n, h] = tiers.map((t) => knobsFor(t)[knob]);
      if (KNOB_DIRECTION[knob] === "up") {
        expect(e, `${knob} easy->normal`).toBeLessThanOrEqual(n);
        expect(n, `${knob} normal->hard`).toBeLessThanOrEqual(h);
        expect(e, `${knob} is flat across all three tiers`).toBeLessThan(h);
      } else {
        expect(e, `${knob} easy->normal`).toBeGreaterThanOrEqual(n);
        expect(n, `${knob} normal->hard`).toBeGreaterThanOrEqual(h);
        expect(e, `${knob} is flat across all three tiers`).toBeGreaterThan(h);
      }
    }
  });

  it("DAMAGE_SCALE rises with difficulty and never exceeds the authored damage", () => {
    expect(DAMAGE_SCALE.easy).toBeLessThan(DAMAGE_SCALE.normal);
    expect(DAMAGE_SCALE.normal).toBeLessThan(DAMAGE_SCALE.hard);
    // A CPU that hits HARDER than the authored numbers is not difficulty, it is a different fighter —
    // and the scope of this pass is explicitly the CPU, not the balance table.
    expect(DAMAGE_SCALE.hard).toBeLessThanOrEqual(1);
  });

  it("EASY keeps every new behaviour switched off, by parameter and not by branch", () => {
    const e = knobsFor("easy");
    expect([e.punishChance, e.antiAirChance, e.wakeupChance, e.spacingBias]).toEqual([0, 0, 0, 0]);
  });
});

describe("the CPU punishes a recovery window it can see", () => {
  /**
   * Ask the CPU for ONE decision with the opponent helpless and the CPU freshly in range.
   * The single `next()` call leaves `inReachTicks` at 1 — far below every tier's `reactionTicks` —
   * so the ordinary cooldown+reaction branch cannot be what answers. Returns whether it swung.
   */
  function punishesOnFirstTick(diff: Difficulty, seed: number, makeHelpless: (w: World) => void): boolean {
    const w = mirrorWorld();
    w.fighters[0].reset(848 - 40, 1);
    w.fighters[1].reset(848 + 40, -1); // 80px apart: inside the brawler's 91px light reach
    makeHelpless(w);
    return pressed(new CpuController(1, diff, seed).next(w));
  }

  const stunned = (w: World): void => { w.fighters[0].applyHit(0, 40, 0, 0, false); };
  /** Drive P0 into its own heavy and run it out to the recovery tail — no private API touched. */
  const recovering = (w: World): void => {
    w.fighters[0].think({ ...emptyInput(), heavy: true, heavyPressed: true });
    expect(w.fighters[0].state).toBe("attackHeavy");
    // brawler heavy is 9/4/20 = 33 ticks; frame 30 is deep in the 20-tick recovery tail.
    for (let i = 0; i < 30; i++) w.fighters[0].advanceTimers();
    expect(w.fighters[0].state).toBe("attackHeavy"); // still locked, still whiffing
  };

  const SEEDS = seeds(60);
  // Both cases run at the full `punishChance` — derived, never a literal (see chanceFloor).
  //
  // They did NOT always, and the history is the point: a recovering opponent is also an ATTACKING one,
  // so step 2's guard roll used to fire first and eat `blockChance` of the sample before step 3a was
  // reached. Raising hard's blockChance therefore cut this measurement by two thirds without touching
  // a single line of punish code — the CPU was planting itself in a block against a move whose active
  // frames were already over. `oppAttacking && !helpless` in cpu.ts is the fix; if that guard is ever
  // removed, this floor is what catches it.
  const PUNISH_FLOOR = chanceFloor(SEEDS.length, knobsFor("hard").punishChance);

  it("takes a stun window on hard, and never on easy", () => {
    // REPRODUCTION. Before the punish branch existed this was 0 on every tier.
    const hard = SEEDS.filter((s) => punishesOnFirstTick("hard", s, stunned)).length;
    const easy = SEEDS.filter((s) => punishesOnFirstTick("easy", s, stunned)).length;
    expect(hard, "hard did not convert a free stun window").toBeGreaterThanOrEqual(PUNISH_FLOOR);
    expect(hard, "hard punished EVERY window — punishChance is not being consulted")
      .toBeLessThanOrEqual(chanceCeiling(SEEDS.length, knobsFor("hard").punishChance));
    expect(easy, "easy has punishChance 0 and must never free-swing").toBe(0);
  });

  it("takes an attack-RECOVERY window, not just a stun", () => {
    // REPRODUCTION. This is the one that needs oppHelpless() to read the opponent's own frame data:
    // a whiffed heavy leaves 20 recovery ticks and the old CPU converted them only by luck.
    const hard = SEEDS.filter((s) => punishesOnFirstTick("hard", s, recovering)).length;
    const easy = SEEDS.filter((s) => punishesOnFirstTick("easy", s, recovering)).length;
    expect(hard, "hard did not convert a whiffed heavy").toBeGreaterThanOrEqual(PUNISH_FLOOR);
    expect(hard, "hard punished EVERY whiff — punishChance is not being consulted")
      .toBeLessThanOrEqual(chanceCeiling(SEEDS.length, knobsFor("hard").punishChance));
    expect(easy).toBe(0);
  });

  it("does NOT free-swing at an opponent who is not helpless", () => {
    // The coincidence exclusion, and the reason the two tests above mean anything: on the identical
    // fixture with P0 simply standing there, NO tier may swing on the first tick — the reaction timer
    // has not run. If this ever goes green-with-swings, the tests above prove nothing.
    for (const diff of ["easy", "normal", "hard"] as Difficulty[]) {
      const swings = SEEDS.filter((s) => punishesOnFirstTick(diff, s, () => {})).length;
      expect(swings, `${diff} swung with no window and no reaction charge`).toBe(0);
    }
  });

  it("still refuses to swing from outside its own measured reach", () => {
    // GUARD. A free swing bypasses cooldown and reaction — it must never bypass RANGE, or the CPU
    // hits you from across the screen. 300px is far outside every shipped normal.
    const far = (diff: Difficulty, seed: number): boolean => {
      const w = mirrorWorld();
      w.fighters[0].reset(848 - 150, 1);
      w.fighters[1].reset(848 + 150, -1);
      stunned(w);
      return pressed(new CpuController(1, diff, seed).next(w));
    };
    expect(SEEDS.filter((s) => far("hard", s)).length).toBe(0);
  });

  /**
   * The same window, held open for the whole of the CPU's reaction delay, asking whether it EVER swung.
   *
   * The one-tick fixtures above cannot see the `!this.punished` latch at all — a per-window flag is
   * invisible to a fixture that only ever offers one tick, so deleting the latch outright leaves every
   * one of them green. That is a false green in the assertion `chanceCeiling`'s own docstring claims to
   * be making, and it is the thing that has to be measured here instead.
   *
   * The window is `reactionTicks` long, derived and not a literal, because that is the longest run for
   * which the ORDINARY cooldown+reaction path provably cannot answer: `timed` needs
   * `inReachTicks > reactionTicks`, so a window of exactly that length keeps the timed branch shut and
   * every swing observed is a free swing. Latched, the CPU rolls once and converts at `punishChance`.
   * Unlatched it would roll every tick, and 7 rolls at 0.54 converts 99.6% of the time — far above the
   * ceiling.
   */
  function punishesWithinWindow(diff: Difficulty, seed: number, makeHelpless: (w: World) => void): boolean {
    const w = mirrorWorld();
    w.fighters[0].reset(848 - 40, 1);
    w.fighters[1].reset(848 + 40, -1);
    makeHelpless(w);
    const cpu = new CpuController(1, diff, seed);
    for (let i = 0; i < knobsFor(diff).reactionTicks; i++) {
      if (pressed(cpu.next(w))) return true;
      // Hold the opponent in the SAME window rather than letting it tick out, so every iteration is
      // another chance at one window — which is exactly what the latch is supposed to refuse.
      makeHelpless(w);
    }
    return false;
  }

  it("rolls ONCE per window, not once per tick it can see it", () => {
    // REPRODUCTION for the latch itself. Remove `!this.punished` and this goes to ~100%: the ceiling
    // is what separates "a chance" from "a certainty", and until this test existed nothing did.
    const hard = SEEDS.filter((s) => punishesWithinWindow("hard", s, stunned)).length;
    expect(hard, "hard never converted across a whole window")
      .toBeGreaterThanOrEqual(chanceFloor(SEEDS.length, knobsFor("hard").punishChance));
    expect(hard, "hard converted nearly every window — the one-roll latch is gone, so punishChance is being rolled per TICK")
      .toBeLessThanOrEqual(chanceCeiling(SEEDS.length, knobsFor("hard").punishChance));
  });
});

describe("the CPU contests a jump-in it can see coming down", () => {
  /**
   * Put the opponent airborne at `vy`, in reach, and ask for ONE decision.
   * Positive `vy` is DESCENDING (`integrate` adds gravity to vy, and `jumpFall` is the vy > 0 half of
   * the arc) — so the jump is already past its apex and fully committed. Reading it is not prediction.
   */
  function contests(diff: Difficulty, seed: number, vy: number): boolean {
    const w = mirrorWorld();
    w.fighters[0].reset(848 - 40, 1);
    w.fighters[1].reset(848 + 40, -1);
    const opp = w.fighters[0];
    opp.grounded = false;
    opp.vy = vy;
    opp.state = vy > 0 ? "jumpFall" : "jumpRise";
    return pressed(new CpuController(1, diff, seed).next(w));
  }

  const SEEDS = seeds(60, 500);

  it("swings at a DESCENDING opponent on hard, and never on easy", () => {
    // REPRODUCTION. `opp.grounded` and `opp.vy` were read nowhere in the old controller, so a jump-in
    // was contested only when the ordinary cooldown happened to be up — i.e. by luck.
    // Floor from p = antiAirChance 0.70, n = 60 → mean 42, sd 3.5; ~4 sd low and unreachable at 0.
    const hard = SEEDS.filter((s) => contests("hard", s, 300)).length;
    const easy = SEEDS.filter((s) => contests("easy", s, 300)).length;
    expect(hard, "hard never contested a descending jump-in")
      .toBeGreaterThanOrEqual(chanceFloor(SEEDS.length, knobsFor("hard").antiAirChance));
    expect(hard, "hard contested EVERY jump-in — antiAirChance is not being consulted")
      .toBeLessThanOrEqual(chanceCeiling(SEEDS.length, knobsFor("hard").antiAirChance));
    expect(easy, "easy has antiAirChance 0 and must never anti-air").toBe(0);
  });

  it("does NOT swing at a RISING opponent — that is a read, not a reaction", () => {
    // GUARD, and the honesty check on the whole behaviour. Swinging at someone on the way UP means
    // committing before the jump's arc is decided. Only the descent is already-committed information.
    for (const diff of ["easy", "normal", "hard"] as Difficulty[]) {
      expect(SEEDS.filter((s) => contests(diff, s, -300)).length, `${diff} swung at a rising jump`).toBe(0);
    }
  });

  it("still refuses to anti-air from outside its own measured reach", () => {
    // GUARD. Same rule as the punish free swing: cooldown and reaction may be skipped, range may not.
    const far = (seed: number): boolean => {
      const w = mirrorWorld();
      w.fighters[0].reset(848 - 150, 1);
      w.fighters[1].reset(848 + 150, -1);
      w.fighters[0].grounded = false;
      w.fighters[0].vy = 300;
      w.fighters[0].state = "jumpFall";
      return pressed(new CpuController(1, "hard", seed).next(w));
    };
    expect(SEEDS.filter(far).length).toBe(0);
  });

  it("rolls ONCE per airborne episode, not once per tick of the descent", () => {
    // REPRODUCTION for `antiAired`, and the same hole the punish latch had: a one-tick fixture cannot
    // observe a per-episode flag, so deleting the latch left every anti-air test green. A descent is
    // many ticks long, which is precisely why the latch exists.
    const contestsAcrossDescent = (diff: Difficulty, seed: number): boolean => {
      const w = mirrorWorld();
      w.fighters[0].reset(848 - 40, 1);
      w.fighters[1].reset(848 + 40, -1);
      const cpu = new CpuController(1, diff, seed);
      for (let i = 0; i < knobsFor(diff).reactionTicks; i++) {
        const opp = w.fighters[0];
        opp.grounded = false;
        opp.vy = 300;
        opp.state = "jumpFall";
        if (pressed(cpu.next(w))) return true;
      }
      return false;
    };
    const hard = SEEDS.filter((s) => contestsAcrossDescent("hard", s)).length;
    expect(hard, "hard never contested across a whole descent")
      .toBeGreaterThanOrEqual(chanceFloor(SEEDS.length, knobsFor("hard").antiAirChance));
    expect(hard, "hard contested nearly every descent — the one-roll latch is gone, so antiAirChance is being rolled per TICK")
      .toBeLessThanOrEqual(chanceCeiling(SEEDS.length, knobsFor("hard").antiAirChance));
  });
});

describe("the CPU has a wake-up option instead of eating pressure forever", () => {
  /**
   * Knock the CPU down, run until it is ACTIONABLE again, then report how many ticks after waking it
   * first swung (or -1).
   *
   * `knockdown` is not ACTIONABLE, so the reaction timer is 0 the moment it stands up and the ordinary
   * branch needs `reactionTicks` MORE ticks before it can answer. Anything inside that window is a
   * free swing by construction — which is the whole discriminator, and also exactly the free meaty the
   * old CPU handed over on every single knockdown.
   */
  function ticksFromWakeToSwing(diff: Difficulty, seed: number, maxTicks = 400): number {
    const w = mirrorWorld();
    w.fighters[0].reset(848 - 40, 1);
    w.fighters[1].reset(848 + 40, -1);
    const cpu = new CpuController(1, diff, seed);
    // Launch the CPU: a stun that ends in the AIR lands as a knockdown (Fighter.onLand).
    w.fighters[1].applyHit(0, 20, 0, -400, false);
    expect(w.fighters[1].grounded).toBe(false);

    let woke = -1;
    for (let i = 0; i < maxTicks; i++) {
      const live = w.match.phase === "fight" && w.hitstop === 0;
      const d = live ? cpu.next(w) : emptyInput();
      // Keep the opponent alive and still: this measures the CPU's wake-up, not a trade.
      w.fighters[0].health = 9999;
      if (woke >= 0 && pressed(d)) return i - woke;
      w.tick([emptyInput(), d]);
      if (woke < 0 && ACTIONABLE.has(w.fighters[1].state)) woke = i;
    }
    return -1;
  }

  const SEEDS = seeds(60, 900);
  /** Inside hard's reactionTicks, so the ordinary cooldown+reaction branch provably cannot answer. */
  const FREE_WINDOW = 6;

  it("swings on wake-up inside its own reaction window on hard, and never on easy", () => {
    // REPRODUCTION. Old behaviour: knockdown zeroes the reaction timer, so the CPU needed 9 more
    // actionable ticks before it could do anything — a guaranteed free meaty, every knockdown.
    const inWindow = (diff: Difficulty): number =>
      SEEDS.filter((s) => {
        const t = ticksFromWakeToSwing(diff, s);
        return t >= 0 && t <= FREE_WINDOW;
      }).length;
    expect(inWindow("hard"), "hard never reversalled out of a knockdown").toBeGreaterThanOrEqual(chanceFloor(SEEDS.length, knobsFor("hard").wakeupChance));
    expect(inWindow("easy"), "easy has wakeupChance 0 and must never reversal").toBe(0);
  });
});

describe("the CPU does not spend a decision on a tick think() will discard", () => {
  /**
   * The rule step 4 already states for movement — "an episode burning there would be spent on nothing"
   * — applied to the three decision sites that skipped it. `Fighter.think()` early-returns on a STUN
   * state, on an attack state and on an airborne tick, so a press issued there is dropped; but the
   * guard hold, the guard ROLL and the two one-shot latches were all being spent on exactly those
   * ticks. Measured on hard over the held-out seeds before the fix: 14.1% of block holds never produced
   * a single guarding tick, and 1,515 punish windows were latched by a fighter that could not convert.
   *
   * `blockstun` is deliberately NOT one of those ticks. `think()` records `guardIntent` before its STUN
   * return and `GUARDABLE` includes `blockstun`, so a hold spent there is the hold doing its job —
   * measured 4063/4063 blockstun ticks with the intent held resolve to `guarding === true`. Cancelling
   * it would lengthen guard rather than stop waste, which is the Phase 13b timing this must not touch.
   */

  /** No contact in either direction (both normals reach ≤ 120) but inside GUARD_RANGE's 175. */
  const NO_CONTACT_GAP = 150;
  /**
   * Inside BOTH of the brawler's normals (light 91, heavy 120).
   *
   * Not 100. The latches gate on `myReach.max` but the swing is range-checked against whichever normal
   * the per-tick `heavyChance` roll picked, so at 91–120 px a converted window is still refused 72% of
   * the time with the one shot already spent. That is a real inconsistency (and a separate finding),
   * but a fixture sitting in that band measures it instead of the latch, which is what this is for.
   */
  const IN_REACH_GAP = 80;

  /** Put the pair at `gap`, hand the CPU to a controller, and return both. */
  function facingPair(diff: Difficulty, seed: number, gap: number): { w: World; cpu: CpuController } {
    const w = mirrorWorld();
    w.fighters[0].reset(848 - gap / 2, 1);
    w.fighters[1].reset(848 + gap / 2, -1);
    return { w, cpu: new CpuController(1, diff, seed) };
  }

  /**
   * Run a real exchange against an opponent who attacks on a fixed cadence, and count the ticks the CPU
   * asked to guard on a tick `Fighter.think()` throws the press away.
   *
   * This is the defect stated directly rather than through a proxy for it. A press is discarded unless
   * the fighter is ACTIONABLE (it can enter `block`) or already in `blockstun` (it is guarding, and
   * holding the intent is what carries the guard into the next hit of a string). Every other tick —
   * mid-attack, hitstun, knockdown, airborne — the hold is counting down against nothing.
   *
   * Deliberately NOT a one-tick fixture: a hold is an 18-tick object, and the whole failure is what
   * happens to it over its lifetime. `chanceCeiling`'s docstring makes the same point about latches.
   */
  function discardedGuardPresses(diff: Difficulty, seed: number, ticks = 900): number {
    const w = fightWorld(NO_CONTACT_GAP);
    const cpu = new CpuController(1, diff, seed);
    let discarded = 0;
    for (let i = 0; i < ticks; i++) {
      const p0 = emptyInput();
      if (i % 17 === 0) { p0.heavy = true; p0.heavyPressed = true; }
      if (i % 29 === 0) { p0.light = true; p0.lightPressed = true; }
      // Keep both alive so the exchange runs for the whole window rather than ending in round one.
      w.fighters[0].health = 9999;
      w.fighters[1].health = 9999;
      const me = w.fighters[1];
      const d = cpu.next(w);
      if (d.block && !ACTIONABLE.has(me.state) && me.state !== "blockstun") discarded++;
      w.tick([p0, d]);
    }
    return discarded;
  }

  /**
   * The CPU is airborne — locked, but not stunned — while the opponent sits in a hitstun that outlasts
   * the jump. The punish window is therefore open, in range and unconvertible for the whole arc, then
   * open, in range and convertible the moment it lands. Returns ticks from "the CPU can act" to its
   * first swing, or -1.
   *
   * A JUMP is the lock, not the CPU's own attack, and that is deliberate on two counts. Airborne is not
   * a STUN state, so `wasStunned` never rises and the wake-up latch cannot fire — this isolates the
   * punish latch. And the CPU throws no hitbox on the way up, so nothing touches the opponent and the
   * measured window is not distorted by hitstop.
   */
  function ticksFromFreeToPunish(diff: Difficulty, seed: number): number {
    const { w, cpu } = facingPair(diff, seed, IN_REACH_GAP);
    w.fighters[0].applyHit(0, 90, 0, 0, false); // long hitstun: helpless throughout, and cannot hit back
    w.fighters[1].think({ ...emptyInput(), up: true, upPressed: true });
    expect(w.fighters[1].grounded).toBe(false);
    let free = -1;
    for (let i = 0; i < 120; i++) {
      const d = cpu.next(w);
      if (free >= 0 && pressed(d)) return i - free;
      w.tick([emptyInput(), d]);
      if (free < 0 && ACTIONABLE.has(w.fighters[1].state) && w.fighters[1].grounded) free = i;
    }
    return -1;
  }

  const SEEDS = seeds(60, 1300);
  /** Inside hard's reactionTicks, so the ordinary cooldown+reaction branch provably cannot answer. */
  const FREE_WINDOW = 6;

  it("never asks to guard on a tick that cannot guard", () => {
    // REPRODUCTION. Old behaviour: the hold counts down unconditionally and the guard branch returns
    // `block: true` regardless of the CPU's own state, so the press is issued into an attack lock, a
    // hitstun or a knockdown and dropped. Measured across the shipped roster before the fix: 63.6% of
    // hold-ticks landed on a tick think() discards, and 14.1% of holds never produced one guarding
    // tick at all.
    for (const seed of seeds(8, 1300)) {
      expect(discardedGuardPresses("hard", seed), `hard, seed ${seed}`).toBe(0);
      expect(discardedGuardPresses("normal", seed), `normal, seed ${seed}`).toBe(0);
    }
  });

  it("...but EASY still does, because easy is frozen", () => {
    // The other half of the claim, and the thing that makes the knob honest rather than decorative.
    // Easy is byte-identical to the pre-change build by construction, so it must still exhibit the
    // bug. If this ever reads 0, the gate has leaked and both easy trace hashes are about to move.
    const leaked = seeds(8, 1300).map((s) => discardedGuardPresses("easy", s)).reduce((a, b) => a + b, 0);
    expect(leaked, "easy stopped discarding guard presses — lockDiscipline has leaked into it")
      .toBeGreaterThan(0);
  });

  it("converts a punish window it could only see while locked, once it is free", () => {
    // REPRODUCTION. Old behaviour: `punished` latches on a tick the CPU is mid-attack, the one shot is
    // spent, and the window — still open, still in range — cannot be rolled for again.
    const inWindow = (diff: Difficulty): number =>
      SEEDS.filter((s) => {
        const t = ticksFromFreeToPunish(diff, s);
        return t >= 0 && t <= FREE_WINDOW;
      }).length;
    expect(inWindow("hard"), "hard never converted a window it had to wait out")
      .toBeGreaterThanOrEqual(chanceFloor(SEEDS.length, knobsFor("hard").punishChance));
    expect(inWindow("easy"), "easy has punishChance 0 and must never free-swing").toBe(0);
  });

  /**
   * Drive the CPU into blockstun with the opponent's attack still live, and report whether the
   * controller keeps asking to guard on those ticks.
   *
   * This has to go through `CpuController`, not through `Fighter`. The first version of this test set
   * `guardIntent` by hand and asserted `Fighter.guarding` — which is a fact about the box data, true
   * with or without the exemption, so it passed either way and proved nothing about the code it named.
   */
  function guardsThroughBlockstun(diff: Difficulty, seed: number): { blockstunTicks: number; pressed: number } {
    const w = fightWorld(NO_CONTACT_GAP);
    const cpu = new CpuController(1, diff, seed);
    let blockstunTicks = 0;
    let pressedInBlockstun = 0;
    for (let i = 0; i < 900; i++) {
      const p0 = emptyInput();
      if (i % 11 === 0) { p0.light = true; p0.lightPressed = true; }
      w.fighters[0].health = 9999;
      w.fighters[1].health = 9999;
      const d = cpu.next(w);
      if (w.fighters[1].state === "blockstun") {
        blockstunTicks++;
        if (d.block) pressedInBlockstun++;
      }
      w.tick([p0, d]);
    }
    return { blockstunTicks, pressed: pressedInBlockstun };
  }

  it("keeps holding guard through BLOCKSTUN, where the guard is real", () => {
    // GUARD, and the boundary that keeps this a bug fix rather than a buff. `think()` records
    // `guardIntent` before its STUN return and `GUARDABLE` includes `blockstun`, so a fighter holding
    // guard there IS protected — 4063/4063 such ticks resolve `guarding === true` on the shipped
    // roster, against 0/3686 for the CPU's own attack. Those ticks are the hold working across a
    // block-string, not the hold leaking.
    //
    // If `blockstun` were folded into the cancel with everything else, the CPU would drop guard mid
    // string and this reads 0. That mistake measured 94.6% against 80.7% for the correct version —
    // fourteen points of win rate arriving disguised as a bug fix, in exactly the Phase 13b guard
    // timing D11 was deferred to avoid.
    // A high RATE rather than "every tick": an 18-tick hold can legitimately expire part-way through a
    // long string, and `guardSuppressed` stops a fresh roll once the attack reaches its recovery, so a
    // few unguarded blockstun ticks are correct behaviour. What cannot happen is the hold being ZEROED
    // on entry to blockstun, which takes this to nothing at all — verified by mutation, not assumed:
    // deleting the `|| me.state === "blockstun"` term takes it from 93% to 0/990.
    let ticks = 0;
    let pressed = 0;
    for (const seed of seeds(6, 1500)) {
      const r = guardsThroughBlockstun("hard", seed);
      expect(r.blockstunTicks, `hard, seed ${seed}: the fixture never reached blockstun`).toBeGreaterThan(0);
      ticks += r.blockstunTicks;
      pressed += r.pressed;
    }
    expect(pressed / ticks, `held guard on only ${pressed}/${ticks} blockstun ticks — blockstun is being treated as a discarded tick and the hold is cancelled on entry`)
      .toBeGreaterThan(0.75);
  });

  it("an attack whose whole startup happens during blockstun still gets a guard roll", () => {
    // Codex Gate 1's specific objection to gating the ROLL: if `blockstun` were excluded, a chained
    // attack that begins and finishes its startup while the CPU is still in blockstun would never be
    // rolled for, and by the time the CPU is free the attack is already over — so the "it rolls on the
    // first tick it can act" promise never fires and the CPU eats the string.
    //
    // `guardEligible` is what answers it. Blockstun is eligible, so `reacted` latches on the new
    // attack at its real start and the hold is live before the active frames land.
    // Measured across seeds, not on one: `blockChance` is 0.47, so a single seed rolling "no" is a
    // legitimate outcome and would make a one-seed assertion a coin flip. What the knob claims is a
    // RATE, so the rate is what gets asserted — the same two-sided shape `chanceFloor`/`chanceCeiling`
    // use everywhere else in this file.
    const guardedTheChainedAttack = (seed: number): boolean => {
      const w = mirrorWorld();
      w.fighters[0].reset(848 - NO_CONTACT_GAP / 2, 1);
      w.fighters[1].reset(848 + NO_CONTACT_GAP / 2, -1);
      const cpu = new CpuController(1, "hard", seed);
      // A blockstun long enough to cover a whole heavy startup (9 ticks), then a fresh heavy whose
      // startup therefore runs entirely inside it.
      w.fighters[1].applyHit(0, 20, 0, 0, true);
      expect(w.fighters[1].state).toBe("blockstun");
      w.fighters[0].think({ ...emptyInput(), heavy: true, heavyPressed: true });
      expect(w.fighters[0].state).toBe("attackHeavy");
      let guarded = false;
      for (let i = 0; i < 9; i++) {
        const d = cpu.next(w);
        if (d.block) guarded = true;
        w.tick([emptyInput(), d]);
      }
      // The attack must still be live, or the fixture proved nothing about reacting in time.
      expect(isAttackState(w.fighters[0].state), "the fixture's attack ended before the startup did").toBe(true);
      return guarded;
    };

    const SEEDS2 = seeds(60, 1600);
    const guarded = SEEDS2.filter(guardedTheChainedAttack).length;
    expect(guarded, "the CPU never rolled for an attack that started while it was in blockstun — the roll is being skipped and the string is free")
      .toBeGreaterThanOrEqual(chanceFloor(SEEDS2.length, knobsFor("hard").blockChance));
    expect(guarded, "the CPU guarded on EVERY seed — blockChance is not being consulted")
      .toBeLessThanOrEqual(chanceCeiling(SEEDS2.length, knobsFor("hard").blockChance));
  });
});

describe("the CPU can give ground, not just take it", () => {
  /**
   * Hold the pair at `gap` and read the CPU's direction each tick. The CPU is fighter 1, i.e. on the
   * RIGHT, so `right` is away and `left` is toward — the old controller could only ever press toward,
   * which is what makes any away-press red-proof.
   */
  function dirRun(diff: Difficulty, seed: number, gap: number, ticks = 200, oppId = "brawler"): ("away" | "in" | "hold")[] {
    const w = new World(
      assembleCharacter(oppId, SHIPPED[oppId].data),
      assembleCharacter("brawler", SHIPPED.brawler.data), // the CPU is always the brawler
    );
    w.match.phase = "fight";
    w.match.introTicks = 0;
    const cpu = new CpuController(1, diff, seed);
    const out: ("away" | "in" | "hold")[] = [];
    for (let i = 0; i < ticks; i++) {
      w.fighters[0].reset(848 - gap / 2, 1);
      w.fighters[1].reset(848 + gap / 2, -1);
      const d = cpu.next(w);
      out.push(d.right ? "away" : d.left ? "in" : "hold");
      w.advance(DT, NONE);
    }
    return out;
  }

  /** Longest uninterrupted run of `want` in the sequence. */
  const longestRun = (xs: string[], want: string): number => {
    let best = 0;
    let n = 0;
    for (const x of xs) {
      n = x === want ? n + 1 : 0;
      if (n > best) best = n;
    }
    return best;
  };

  // Brawler: own min reach 91, opponent max reach 120. 110px is inside THEIR range and outside
  // MINE — the footsie gap the old CPU had no answer to except walking further in.
  const DANGER_GAP = 110;
  const SEEDS = seeds(24, 1300);

  it("retreats out of the opponent's range on hard, and never on easy", () => {
    // REPRODUCTION. The old movement branch pressed toward the opponent or not at all; `away` was
    // literally unreachable, on every tier and every seed.
    const hard = SEEDS.filter((s) => dirRun("hard", s, DANGER_GAP).includes("away")).length;
    const easy = SEEDS.filter((s) => dirRun("easy", s, DANGER_GAP).includes("away")).length;
    expect(hard, "hard never gave ground in the danger gap").toBeGreaterThanOrEqual(8);
    expect(easy, "easy has spacingBias 0 and must never retreat").toBe(0);
  });

  it("commits a retreat for a WHOLE episode, like every other approach decision", () => {
    // GUARD. Phase 21's whole point: a movement decision re-rolled per tick is noise, not behaviour,
    // and the walk animation never leaves frame 0. A retreat is a movement decision like any other,
    // so it has to be held for WALK_HOLD too — asserting the RUN LENGTH, not the direction, because
    // a re-rolled decision lands on the same choice about half the time.
    //
    // The fixture is asymmetric ON PURPOSE, and this is the trap `lessons.md` names: "a cancellation
    // test must run where the other cancellation cannot". On a MIRRORED brawler every eligible retreat
    // distance is also inside its own heavy reach, so the swing branch cancels episodes mid-run and
    // the observed runs are partial — 10, 14, 42 — with nothing wrong. Brawler (max reach 120) against
    // MONK (max reach 122) has a 2px band at 121 where the monk can touch it and it cannot touch back:
    // retreat is eligible, every swing path is out of range, and the episode is the only thing moving.
    const gap = 121;
    const runs = SEEDS.map((s) => longestRun(dirRun("hard", s, gap, 200, "monk"), "away")).filter((n) => n > 0);
    expect(runs.length, "no seed retreated at all — the fixture proves nothing").toBeGreaterThan(0);
    for (const r of runs) expect(r % WALK_HOLD, `a retreat run of ${r} is not a whole number of episodes`).toBe(0);
  });

  it("does NOT retreat from outside the opponent's reach — that is just running away", () => {
    // GUARD. Retreat is a spacing tool for the gap where they can hit you and you cannot hit them.
    // From across the stage there is nothing to give ground to, and a CPU that backs off there never
    // closes and the round times out every time.
    for (const diff of ["easy", "normal", "hard"] as Difficulty[]) {
      const backed = SEEDS.filter((s) => dirRun(diff, s, 600).includes("away")).length;
      expect(backed, `${diff} retreated from 600px away`).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The CPU-vs-CPU ladder harness.
//
// World.advance() takes ONE seam, so a two-controller match has to drive world.tick() directly — and
// that loses three things advance() does for free. A harness missing any of them still produces
// plausible win rates, which is exactly what makes it dangerous as a tuning gate:
//
//   1. the input GATE. advance() only samples a controller when `phase === "fight" && hitstop === 0`
//      (its private consumesInput()). Without it both controllers' cooldown and reaction counters
//      wind forward on intro/roundEnd/hitstop ticks that then discard the decision.
//   2. reset() ON EVERY ROUND. tick() never registers a cpuSeam, so resetRound()'s `cpuSeam?.reset?.()`
//      calls NOTHING here. Cooldowns, block holds, reaction charge, episodes and the per-window flags
//      would leak straight across the round boundary.
//   3. DAMAGE_SCALE. The controller never writes `damageScale` — MatchScene does. Forget it and the
//      ladder measures the behaviour knobs ALONE, silently dropping the largest tier lever and
//      mis-tuning everything downstream of it.
//
// Edge semantics need no masking: advance()'s working copy exists to stop one HELD human press firing
// twice inside a batch, and every producer here re-derives its snapshot each tick.
// ---------------------------------------------------------------------------------------------

interface MatchResult {
  /** 0, 1, or null for a draw. */
  winner: 0 | 1 | null;
  /** Rounds won by each side (draws count for neither). */
  wins: [number, number];
  /** Rounds that ended in a KO rather than on the clock — the non-degeneracy signal. */
  koRounds: number;
  roundsPlayed: number;
  /** Attacks STARTED by each side across the whole match. */
  attacks: [number, number];
  /** Attacks each side successfully GUARDED, counted as entries into blockstun. */
  blocks: [number, number];
}

/** A per-tick input producer. Must return a FRESH snapshot every call (see the header). */
type Driver = { next(w: World): InputSnapshot; reset?(): void };

/**
 * Run one full best-of-3 between two drivers on a mirrored roster entry.
 * `scales` is applied to `damageScale` on both fighters, re-applied after every round because
 * `Fighter.reset()` deliberately leaves it alone but a fresh World would not.
 */
function runMatch(
  id: string,
  a: Driver,
  b: Driver,
  scales: [number, number],
  maxTicks = 60000,
): MatchResult {
  const cfg = assembleCharacter(id, SHIPPED[id].data);
  const w = new World(cfg, assembleCharacter(id, SHIPPED[id].data));
  w.fighters[0].damageScale = scales[0];
  w.fighters[1].damageScale = scales[1];

  let round = w.match.round;
  let koRounds = 0;
  let roundsPlayed = 0;
  const attacks: [number, number] = [0, 0];
  const wasAttacking = [false, false];
  // Guards that actually CONNECTED, counted as entries into blockstun. A driver can hold block all
  // match and register zero here, which is precisely how the scripted human's guard went unnoticed.
  const blocks: [number, number] = [0, 0];
  const wasBlockstun = [false, false];
  let ticks = 0;

  // A round can be DRAWN (equal health share on the clock), and a draw advances nobody's win count —
  // two evenly-matched drivers can therefore draw forever. The round cap is what makes that terminate.
  while (w.match.phase !== "matchEnd" && ticks < maxTicks && roundsPlayed < 12) {
    // (1) the gate — mirrors World.consumesInput() exactly.
    const live = w.match.phase === "fight" && w.hitstop === 0;
    const koBefore = w.fighters.map((f) => f.isKO);
    w.tick(live ? [a.next(w), b.next(w)] : [emptyInput(), emptyInput()]);

    for (let i = 0; i < 2; i++) {
      const now = isAttackState(w.fighters[i].state);
      if (now && !wasAttacking[i]) attacks[i]++;
      wasAttacking[i] = now;
      const guarding = w.fighters[i].state === "blockstun";
      if (guarding && !wasBlockstun[i]) blocks[i]++;
      wasBlockstun[i] = guarding;
    }
    if (!koBefore[0] && w.fighters[0].isKO) koRounds++;
    if (!koBefore[1] && w.fighters[1].isKO) koRounds++;
    // (2) reset BOTH controllers whenever the world rolls into a new round.
    if (w.match.round !== round) {
      round = w.match.round;
      roundsPlayed++;
      a.reset?.();
      b.reset?.();
      // (3) damageScale survives Fighter.reset(), but re-assert it so a future reset() change cannot
      //     silently drop the tier lever mid-match.
      w.fighters[0].damageScale = scales[0];
      w.fighters[1].damageScale = scales[1];
    }
    ticks++;
  }
  return {
    winner: w.match.matchWinner ?? null,
    wins: [w.match.wins[0], w.match.wins[1]],
    koRounds,
    // The rounds actually PLAYED, counted off the round counter — not `wins[0]+wins[1]`, which omits
    // every drawn round and reads 0 for a match that ran its full length with neither side scoring.
    roundsPlayed,
    attacks,
    blocks,
  };
}

/** One tier-vs-tier pairing over a seed set, sides SWAPPED each seed so position is never the variable. */
function ladder(
  hi: Difficulty,
  lo: Difficulty,
  seeds: number[],
): { hiWins: number; total: number; koRounds: number; hiAttacks: number; loAttacks: number } {
  const ids = ["brawler", "jiujitsu", "monk"];
  let hiWins = 0;
  let koRounds = 0;
  let hiAttacks = 0;
  let loAttacks = 0;
  seeds.forEach((seed, n) => {
    const id = ids[n % ids.length];
    const hiFirst = n % 2 === 0;
    const hiIdx: 0 | 1 = hiFirst ? 0 : 1;
    const loIdx: 0 | 1 = hiFirst ? 1 : 0;
    const A = new CpuController(hiIdx, hi, seed);
    const B = new CpuController(loIdx, lo, seed + 5000);
    const scales: [number, number] = [0, 0] as unknown as [number, number];
    scales[hiIdx] = DAMAGE_SCALE[hi];
    scales[loIdx] = DAMAGE_SCALE[lo];
    const r = runMatch(id, hiFirst ? A : B, hiFirst ? B : A, scales);
    if (r.winner === hiIdx) hiWins++;
    koRounds += r.koRounds;
    hiAttacks += r.attacks[hiIdx];
    loAttacks += r.attacks[loIdx];
  });
  return { hiWins, total: seeds.length, koRounds, hiAttacks, loAttacks };
}

/**
 * A deterministic, RNG-FREE stand-in for a competent human. No rolls at all — its whole behaviour is
 * a function of what it can see this tick, which is what makes a win rate against it reproducible.
 *
 * It plays the things a competent player actually does, and specifically the four things the old CPU
 * had no answer to:
 *   - walks to its own poke range and pokes from there;
 *   - GUARDS the CPU's attacks after a fixed reaction delay. 6 ticks is derived from the roster's own
 *     frame data, not picked: guard is therefore up on tick 7, which beats every heavy's 9-frame
 *     startup and misses every light's 4-frame one. That is what a competent player actually does —
 *     block the telegraph, eat the fast poke. It blocks 17% of what hard throws. The value used to be
 *     12, which lands after the LAST active frame of every normal in the roster, so the guard was
 *     decorative: this opponent reached `blockstun` zero times in 48 matches and its win rate was
 *     identical at 6/12/18/30 because the branch never once mattered;
 *   - whiff-punishes: swings the moment the CPU is helpless and in range;
 *   - jumps in occasionally, on a fixed period rather than a roll.
 *
 * It returns a FRESH snapshot every tick. That is required, not stylistic: `World.advance()` masks a
 * consumed edge out of the rest of its batch precisely so one HELD human press cannot fire twice, and
 * the ladder harness drives `world.tick()` directly with no such masking. A driver that handed back
 * the same object, or kept `lightPressed` latched across ticks, would attack every single frame here
 * and nowhere else.
 */
class ScriptedHuman implements Driver {
  private tick = 0;
  /** Ticks the CPU has been attacking for — the human's reaction clock, not a roll. */
  private seenAttackFor = 0;
  /** The same clock for the opponent's HELPLESS window, so offence and defence share one reaction. */
  private seenHelplessFor = 0;
  constructor(readonly index: 0 | 1, private readonly reactionDelay = 6) {}

  reset(): void {
    this.tick = 0;
    this.seenAttackFor = 0;
    this.seenHelplessFor = 0;
  }

  next(w: World): InputSnapshot {
    const me = w.fighters[this.index];
    const foe = w.fighters[this.index === 0 ? 1 : 0];
    const input = emptyInput();
    this.tick++;

    const dx = foe.x - me.x;
    const dist = Math.abs(dx);
    const myLight = reachOf(me, "attackLight");
    const myHeavy = reachOf(me, "attackHeavy");
    const canAct = ACTIONABLE.has(me.state);

    // React to the CPU's attack after a human-plausible delay, and hold the guard while it is live —
    // but ONLY while it is live. `!isHelpless(foe)` is the same rule the CPU applies to itself
    // (`guardSuppressed`), and for the same reason: there is nothing left to block once the active
    // frames are spent, and guarding through them cannibalises the punish.
    //
    // Without that term this branch returns before the whiff-punish below can ever run. The numbers
    // are not marginal: for the brawler light, recovery begins at frame 7 (4 startup + 3 active) and
    // `seenAttackFor > 6` becomes true on frame 7 — the guard branch takes over at the exact tick the
    // punish window opens, and every punishable distance is inside the 200px guard radius. Measured
    // over 24 matches, the shipped ordering returned guard during recovery 6,971 times and reached
    // the whiff-punish 92 times; with this term it is 0 and 240. The docstring above has claimed
    // whiff-punishing since Phase 22 while the branch was unreachable.
    if (isAttackState(foe.state)) this.seenAttackFor++;
    else this.seenAttackFor = 0;
    if (isHelpless(foe)) this.seenHelplessFor++;
    else this.seenHelplessFor = 0;
    if (this.seenAttackFor > this.reactionDelay && dist < 200 && !isHelpless(foe)) {
      input.block = true;
      input.down = foe.state === "crouchLight" || foe.state === "crouchHeavy";
      return input;
    }
    if (!canAct || !me.grounded) return input;

    // Whiff-punish: the CPU is stuck and in range, so take it.
    //
    // `isHelpless`, imported from cpu.ts, NOT a second definition of "stuck". The copy that used to
    // live here counted ANY attack state, startup included — so this "competent human" answered the
    // first frame of every CPU attack with a 33-tick heavy, was still locked in it when the active
    // frames arrived, and ate the hit. Measured: 96% of the hits it took landed while it was in its own
    // `attackHeavy`, it reached `blockstun` ZERO times across 48 matches, and its win rate was
    // identical at reaction delays 6/12/18/30 because the guard branch never mattered. Every Phase 22
    // strength number was gated against an opponent that could not block.
    //
    // The punish carries the SAME reaction delay as the guard, and that symmetry is the point. A human
    // has one reaction time, not a slow one on defence and an instant one on offence. Punishing every
    // recovery window on frame 0 is exactly as superhuman as blocking a 4-frame light, and it is the
    // mirror of the bug above: repairing only the predicate produced an opponent that punished 100% of
    // windows with zero delay, which pushed hard to 38% and would have driven the cadence re-tune into
    // the floor chasing an opponent no person can play like. The brawler heavy leaves 20 recovery
    // ticks, so a 6-tick delay still leaves 14 to convert in — it punishes what is punishable on
    // reaction, and lets the 8-tick light recovery mostly go.
    if (isHelpless(foe) && this.seenHelplessFor > this.reactionDelay && dist <= myHeavy) {
      input.heavy = true;
      input.heavyPressed = true;
      return input;
    }
    // Poke on a fixed cadence once in range.
    if (dist <= myLight && this.tick % 20 === 0) {
      input.light = true;
      input.lightPressed = true;
      return input;
    }
    // Occasional jump-in from mid range.
    if (dist > myHeavy && dist < 320 && this.tick % 150 === 0) {
      input.up = true;
      input.upPressed = true;
      return input;
    }
    if (dist > myLight * 0.9) {
      if (dx >= 0) input.right = true;
      else input.left = true;
    }
    return input;
  }
}

/**
 * The least competent strategy there is: walk in, press light whenever free and in range, never block,
 * never read anything.
 *
 * It is in the gate set because it is the first thing an unskilled player does and because nothing else
 * in the suite measures raw cadence. A CPU can look strong against a scripted opponent that throttles
 * its own offence and still lose every round to someone simply pressing the fast button — which is
 * exactly what hard did: 0 of 96 rounds. That is a cadence deficit, not a behaviour one, and no
 * behaviour knob can win it.
 */
class Masher implements Driver {
  constructor(readonly index: 0 | 1) {}
  next(w: World): InputSnapshot {
    const me = w.fighters[this.index];
    const foe = w.fighters[this.index === 0 ? 1 : 0];
    const input = emptyInput();
    if (!ACTIONABLE.has(me.state) || !me.grounded) return input;
    const dx = foe.x - me.x;
    if (Math.abs(dx) <= reachOf(me, "attackLight")) {
      input.light = true;
      input.lightPressed = true;
      return input;
    }
    if (dx >= 0) input.right = true;
    else input.left = true;
    return input;
  }
}

/** Rounds won by the CPU / total rounds decided, against the scripted human, over a seed set. */
function vsOpponent(
  diff: Difficulty,
  seedSet: number[],
  makeOpponent: (index: 0 | 1) => Driver,
): { cpuRounds: number; decided: number; koRounds: number; oppBlocks: number; cpuAttacks: number; blockRate: number; pct: number } {
  const ids = ["brawler", "jiujitsu", "monk"];
  let cpuRounds = 0;
  let decided = 0;
  let koRounds = 0;
  let oppBlocks = 0;
  let cpuAttacks = 0;
  seedSet.forEach((seed, n) => {
    const id = ids[n % ids.length];
    const cpuFirst = n % 2 === 0; // swap sides so position is never the variable
    const cpuIdx: 0 | 1 = cpuFirst ? 0 : 1;
    const humanIdx: 0 | 1 = cpuFirst ? 1 : 0;
    const cpu = new CpuController(cpuIdx, diff, seed);
    const human = makeOpponent(humanIdx);
    const scales: [number, number] = [1, 1];
    scales[cpuIdx] = DAMAGE_SCALE[diff];
    const r = runMatch(id, cpuFirst ? cpu : human, cpuFirst ? human : cpu, scales);
    cpuRounds += r.wins[cpuIdx];
    decided += r.wins[0] + r.wins[1];
    koRounds += r.koRounds;
    oppBlocks += r.blocks[humanIdx];
    cpuAttacks += r.attacks[cpuIdx];
  });
  return {
    cpuRounds,
    decided,
    koRounds,
    oppBlocks,
    cpuAttacks,
    // The rate, not the count — a raw count above zero is satisfied by a single lucky guard in 48
    // matches, which is what the broken proxy actually produced.
    blockRate: cpuAttacks ? oppBlocks / cpuAttacks : 0,
    pct: decided ? (100 * cpuRounds) / decided : 0,
  };
}

/** Rounds won by the CPU against the scripted human — the headline gate's opponent. */
const vsHuman = (diff: Difficulty, seedSet: number[], reactionDelay?: number) =>
  vsOpponent(diff, seedSet, (i) => new ScriptedHuman(i, reactionDelay));

describe("the ladder harness itself is sound", () => {
  // A harness that leaks controller state across rounds, or forgets a damage scale, still returns
  // plausible-looking win rates. These pin the things that make it lie — three about `runMatch`, and
  // two about the OPPONENT, which is the half nothing used to check. Every strength number in this
  // file is a statement about the CPU *relative to this opponent*, so an opponent that silently cannot
  // use one of its four behaviours makes all of them wrong in the flattering direction.

  it("the scripted human's guard actually connects, and is not a wall either", () => {
    // REPRODUCTION. This opponent reached blockstun ZERO times across 48 matches while taking 1,169
    // hits: its whiff-punish counted attack STARTUP as punishable, so it answered the first frame of
    // every CPU attack with a 33-tick heavy and was still locked in it when the active frames landed.
    // 96% of the hits it took arrived while it was in its own `attackHeavy`. The guard branch ran and
    // the block was pressed — it was simply never the thing the fighter was doing when a hit arrived.
    // A RATE, not a count. `> 0` is not an assertion here: the broken proxy still managed 2 guards in
    // 1,154 attacks across 48 matches, so a bare count passes on a single lucky block. The fixed proxy
    // guards ~17% of what hard throws, which is what "blocks the telegraphed heavy, eats the 4-frame
    // light" looks like on this roster.
    const r = vsOpponent("hard", seeds(12, 101), (i) => new ScriptedHuman(i));
    expect(r.blockRate, `the scripted human guarded ${r.oppBlocks} of ${r.cpuAttacks} attacks — it is not a competent opponent`)
      .toBeGreaterThan(0.05);
    // The other side of it: an opponent that blocks EVERYTHING is a turtle, and a turtle beats all
    // three tiers 100% of the time, which measures nothing either.
    expect(r.blockRate, "the proxy guards nearly everything — it is a wall, not a player").toBeLessThan(0.6);
    expect(r.pct, "hard cannot win a round — the proxy has become a wall").toBeGreaterThan(0);
  });

  it("the scripted human actually whiff-punishes, which its docstring has always claimed", () => {
    // The other half of the proxy nobody measured. Its guard branch returned before the punish branch
    // and kept returning through the opponent's recovery, so for the brawler light — recovery at frame
    // 7, guard from frame 7 — the punish was unreachable by exactly one tick. 6,971 guard returns
    // during recovery against 92 punishes over 24 matches. A proxy that only blocks is a different
    // incompetence from one that only trades, and it tunes the CPU to a different wrong answer:
    // repairing this moved hard from 66.7% to 41.1% at an unchanged knob table.
    let punishes = 0;
    const counting = (index: 0 | 1): Driver => {
      const inner = new ScriptedHuman(index);
      return {
        reset: () => inner.reset(),
        next(w) {
          const d = inner.next(w);
          if (d.heavyPressed && isHelpless(w.fighters[index === 0 ? 1 : 0])) punishes++;
          return d;
        },
      };
    };
    vsOpponent("hard", seeds(12, 101), counting);
    expect(punishes, "the scripted human never punished a recovery window — its guard branch is eating them")
      .toBeGreaterThan(20);
  });

  it("the scripted human's reaction delay is load-bearing", () => {
    // The tell that caught it: hard's win rate was byte-identical at reaction delays 6, 12, 18 and 30.
    // A parameter that changes nothing is a parameter whose branch never fires. A delay long enough to
    // land after every normal's last active frame must block strictly less than one that beats a
    // heavy's 9-frame startup.
    const SET = seeds(12, 101);
    const sharp = vsOpponent("hard", SET, (i) => new ScriptedHuman(i, 6));
    const late = vsOpponent("hard", SET, (i) => new ScriptedHuman(i, 30));
    // An absolute margin, not "greater than" and not a ratio. The broken proxy scored 1 against 0 on
    // exactly this comparison — which satisfies a strict inequality AND any multiple of zero while
    // being completely inert. Only a real gap in counts distinguishes a live branch from a dead one.
    expect(sharp.oppBlocks - late.oppBlocks, `delay 6 guarded ${sharp.oppBlocks}, delay 30 guarded ${late.oppBlocks} — the guard branch is inert`)
      .toBeGreaterThanOrEqual(10);
  });
  it("two IDENTICAL controllers on a mirrored fighter split the ladder near evenly", () => {
    // Not exactly 50% — the two controllers carry different seeds, which is the point (identical
    // seeds would make both sides press the same buttons and the match a fixed point). But a harness
    // that leaks state across rounds or drops one side's damage scale skews this hard.
    //
    // seeds(), never raw 1..48: side A would otherwise always draw the near-zero first sample that raw
    // xorshift32 emits on a small seed, and pass the first chance it rolls on every single match — a
    // systematic bias that reads exactly like a broken harness.
    //
    // n and the band are BOTH derived, because the first cut of this test was n=24 with hand-picked
    // bounds and drifted to 18/24 on an unrelated fix. Measured at n=96 the same matchup gives 50/96
    // and 38/96 on two different seed blocks — no side bias, just a sample too small to say so. At
    // n=48 a fair split is 24 with sd = sqrt(48 * 0.25) = 3.46; the band below is ±3.5 sd, which a
    // genuinely broken harness (state leaking across rounds, or one damage scale dropped) blows past.
    const n = 48;
    const r = ladder("hard", "hard", seeds(n, 700));
    const half = n / 2;
    const sd = Math.sqrt(n * 0.25);
    expect(r.total).toBe(n);
    expect(r.hiWins, `${r.hiWins}/${n} is not a fair split`).toBeGreaterThan(half - 3.5 * sd);
    expect(r.hiWins, `${r.hiWins}/${n} is not a fair split`).toBeLessThan(half + 3.5 * sd);
  });

  it("applies DAMAGE_SCALE to BOTH fighters, not just the nominal CPU", () => {
    // The scale is applied by MatchScene, never by the controller. Drop it from runMatch and the
    // ladder measures behaviour knobs alone.
    const cfg = assembleCharacter("brawler", SHIPPED.brawler.data);
    const w = new World(cfg, cfg);
    w.fighters[0].damageScale = 0.55;
    w.fighters[1].damageScale = 1;
    expect(w.fighters[0].damageScale).not.toBe(w.fighters[1].damageScale);
    // ...and the harness really does set both: run a match and read them back.
    const idle: Driver = { next: () => emptyInput() };
    const seen: number[] = [];
    const probe: Driver = {
      next: (world) => { seen.push(world.fighters[0].damageScale, world.fighters[1].damageScale); return emptyInput(); },
    };
    runMatch("brawler", idle, probe, [0.55, 1], 300);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toBe(0.55);
    expect(seen[1]).toBe(1);
  });

  it("resets BOTH controllers on a round boundary, which world.tick() cannot do for it", () => {
    // world.tick() never registers a cpuSeam, so resetRound()'s cpuSeam?.reset?.() calls nothing.
    // Delete the `a.reset?.(); b.reset?.()` pair in runMatch and this goes red.
    let resetsA = 0;
    let resetsB = 0;
    const a: Driver = { next: () => emptyInput(), reset: () => { resetsA++; } };
    const b: Driver = { next: () => emptyInput(), reset: () => { resetsB++; } };
    // Two idle fighters time out every round, so the match runs the full best-of-3 on the clock.
    const r = runMatch("brawler", a, b, [1, 1]);
    expect(r.roundsPlayed).toBeGreaterThanOrEqual(2);
    expect(resetsA).toBeGreaterThanOrEqual(1);
    expect(resetsB).toBe(resetsA);
  });

  it("samples the drivers ONLY on ticks the world would consume input", () => {
    // Mirrors World.consumesInput(). Without the gate both controllers' timers wind forward through
    // the intro and every hitstop frame, and spend decisions the sim throws away.
    let asked = 0;
    const spy: Driver = { next: () => { asked++; return emptyInput(); } };
    const cfg = assembleCharacter("brawler", SHIPPED.brawler.data);
    const w = new World(cfg, cfg);
    expect(w.match.phase).toBe("intro"); // a fresh world opens on the intro gate
    const introTicks = w.match.introTicks;
    for (let i = 0; i < introTicks; i++) {
      const live = w.match.phase === "fight" && w.hitstop === 0;
      w.tick(live ? [spy.next(w), spy.next(w)] : [emptyInput(), emptyInput()]);
    }
    expect(asked).toBe(0); // never asked during the intro
  });
});

// ---------------------------------------------------------------------------------------------
// The gates. THE objective, binary check on this whole pass.
//
// Seeds are HELD OUT. The Phase 23 re-tune was swept against seeds 1001-1096 ONLY; everything below
// runs 101-148, which were not looked at once while tuning. Tuning against the same seeds a gate
// asserts on is tuning to the exam — it produces a table that passes its own test and generalises to
// nothing.
//
// The evidence that it did not happen is not one number, because one 48-seed block cannot carry it:
// at ~105 decided rounds the 95% binomial half-width is ≈ ±9 points, half the width of the band. So
// the claim rests on SEVEN never-swept blocks, not on this one:
//
//   GATE 101-148 59.4%   fresh 201-248 61.5%   301-348 61.2%   401-448 61.2%
//   501-548 63.3%        601-648 62.4%         BIG 2001-2200 (200 seeds) 61.4% [56.7, 65.9]
//   pooled over the six 48-seed blocks: 61.5% (378/615), Wilson 95% [57.6, 65.2]
//
// The band below is 55-75 and the point estimate is 61.5% — inside the 60-70% design target with the
// interval fully inside the band. Phase 22's equivalent numbers spanned 53.0-65.8% across blocks
// (sd 4.8) and one fresh block fell THROUGH the 55% floor; they were also measured against a proxy
// that could not block at all, which is the finding that forced this re-tune. See the harness
// soundness describe above.
// ---------------------------------------------------------------------------------------------
describe("the difficulty ladder, on held-out seeds", () => {
  const GATE = seeds(48, 101);

  it("hard beats normal, normal beats easy, hard beats easy", () => {
    const hn = ladder("hard", "normal", GATE);
    const ne = ladder("normal", "easy", GATE);
    const he = ladder("hard", "easy", GATE);
    // Thresholds stated before the run: 32/48 (67%) for adjacent tiers, 41/48 (85%) across two.
    // Measured at these knobs: 48/48, 48/48, 48/48.
    expect(hn.hiWins, `hard beat normal only ${hn.hiWins}/48`).toBeGreaterThanOrEqual(32);
    expect(ne.hiWins, `normal beat easy only ${ne.hiWins}/48`).toBeGreaterThanOrEqual(32);
    expect(he.hiWins, `hard beat easy only ${he.hiWins}/48`).toBeGreaterThanOrEqual(41);
  });

  it("hard wins 55-75% of rounds against a competent scripted human", () => {
    // The headline requirement is 60-70%. The GATE is wider on purpose: at ~105 decided rounds the
    // 95% binomial half-width at p≈0.61 is ≈ ±9 points, so a gate pinned to the target itself would be
    // flaky by construction rather than by regression. The 60-70% claim is the POOLED estimate over
    // seven never-swept blocks (61.5%, [57.6, 65.2] — see the header); this single block reads 59.4%
    // and is one noisy sample of it, which is exactly why the band and not the block is the gate.
    const r = vsHuman("hard", GATE);
    const rate = (100 * r.cpuRounds) / r.decided;
    expect(r.decided, "not enough decided rounds to estimate anything").toBeGreaterThan(80);
    expect(rate, `hard won ${rate.toFixed(1)}% of rounds`).toBeGreaterThanOrEqual(55);
    expect(rate, `hard won ${rate.toFixed(1)}% of rounds`).toBeLessThanOrEqual(75);
  });

  it("easy stays a pushover and normal sits clearly between", () => {
    const easy = vsHuman("easy", GATE);
    const normal = vsHuman("normal", GATE);
    const hard = vsHuman("hard", GATE);
    const pct = (r: { cpuRounds: number; decided: number }): number => (100 * r.cpuRounds) / r.decided;
    expect(pct(easy), "easy is not a pushover any more").toBeLessThan(25);
    expect(pct(normal)).toBeGreaterThan(pct(easy));
    expect(pct(hard)).toBeGreaterThan(pct(normal) + 20); // "clearly" between, not a rounding apart
  });

  it("KNOWN LIMITATION: the light is plus-on-hit at point blank, so a masher sweeps every tier", () => {
    // A Masher — walk in, press light, never block, read nothing — takes 100% of rounds off all three
    // tiers. That is the first thing an unskilled player does, so it matters.
    //
    // It asserts the CAUSE, not the symptom, and that choice is deliberate. Pinning the win rate
    // (`< 25`) would be an ANTI-IMPROVEMENT GATE: any future CPU work that beat a masher would red the
    // suite for succeeding. The frame relationship below is the actual defect, it is one line, and it
    // goes red exactly when someone fixes the thing worth fixing.
    //
    // The arithmetic, per fighter: contact lands on the first ACTIVE frame, so the attacker has
    // `frames.length - startup` ticks left to run while the defender is stuck for `hitstun`. When
    // hitstun is the larger, the attacker recovers FIRST; when the two are equal it recovers at the
    // same moment. Measured on the shipped roster: brawler +1 (11 vs 12), jiujitsu +1, monk exactly
    // NEUTRAL (12 vs 12).
    //
    // Neutral is already enough, which is why the bound below is `>=` rather than `>`. The defender
    // needs `reactionTicks + 1` consecutive free, in-range ticks before the timed branch can answer —
    // 7 on hard. At best neutral it gets zero. So "not losing frame advantage" and "able to take a
    // turn" are different bars, and the light clears neither on any fighter.
    //
    // Is it really unfixable from `cpu.ts`? Nearly. Swept: cooldown 18-35, `blockChance` to 1.0,
    // `reactionTicks` to 4, `punishChance` to 0.8 — the masher's rate stayed at exactly 0.0% in every
    // cell, including one that took hard to 92.7% against the scripted human. The single configuration
    // that does dent it is `attackCooldown: 1` with every chance maxed, i.e. mashing back, which
    // reaches 32.7% against the masher and collapses hard to 21.1% against a competent player. So the
    // honest statement is not "impossible" but "only by abandoning the tier's actual goal". Frame data
    // is out of scope for this phase, which is why it stays recorded rather than fixed.
    for (const id of ["brawler", "jiujitsu", "monk"]) {
      const cfg = assembleCharacter(id, SHIPPED[id].data);
      const light = cfg.attacks.light;
      const total = cfg.states.attackLight.frames.length;
      const attackerRemaining = total - light.startup;
      expect(light.hitstun, `${id}: the light now leaves the DEFENDER ahead (attacker ${attackerRemaining} ticks vs ${light.hitstun} hitstun) — the masher loop may be FIXED. Re-measure Masher and promote it to a real gate.`)
        .toBeGreaterThanOrEqual(attackerRemaining);
    }
  });

  it("...and the Masher opponent stays in the suite so the day it changes is visible", () => {
    // Kept as a live measurement rather than deleted, because the frame-data test above proves the
    // mechanism exists and this proves it still BITES. Asserted loosely and one-sided: the only thing
    // that would be a genuine regression is the harness silently ceasing to produce decided rounds.
    const r = vsOpponent("hard", GATE, (i) => new Masher(i));
    expect(r.decided, "the masher pairing stopped producing decided rounds — the measurement is dead")
      .toBeGreaterThan(80);
  });

  it("hard wins by FIGHTING, not by running the clock down", () => {
    // Win rate alone is satisfiable by a turtle: blocking plants the fighter, the round still ends on
    // the timer, and the timeout goes to whoever chipped more. "Stronger" and "more passive" would be
    // the same number. These two separate them.
    const r = vsHuman("hard", GATE);
    expect(r.koRounds / r.decided, "most of hard's rounds ended on the clock, not on a KO")
      .toBeGreaterThanOrEqual(0.7);
    // Within ONE pairing, so the two counts come from the SAME matches: same opponents, same rounds,
    // same durations. Comparing hard's attacks in hard-vs-normal against normal's attacks in a
    // separate normal-vs-easy run (which is what this did first) can swing on match length or on who
    // the opponent was, and passes for reasons that have nothing to do with aggression.
    const hn = ladder("hard", "normal", GATE);
    expect(hn.hiAttacks, `hard started ${hn.hiAttacks} attacks vs normal's ${hn.loAttacks} in the same matches`)
      .toBeGreaterThan(hn.loAttacks);
  });
});

// ---------------------------------------------------------------------------------------------
// Human-vs-human bit identity.
//
// A CPU pass must not move 1v1 play by a single tick. `git diff --stat` showing only cpu.ts is a
// STRUCTURAL argument, not a measurement — it cannot see a shared helper whose behaviour changed, and
// this repo's own lessons file is a list of structural arguments that turned out to be false.
//
// So: run a scripted two-human match with NO cpu seam, hash the full observable state of every tick,
// and pin the hash. The literal below was captured on the pre-change tree; if a CPU edit ever moves
// it, 1v1 play changed and the scope lock was broken.
//
// This one is deliberately NOT a red-first test — it is a CHARACTERISATION test and must pass the
// moment it is written, which is the whole point of capturing it before the change. It earns its
// keep by being red LATER, if anyone reaches outside cpu.ts.
// ---------------------------------------------------------------------------------------------
describe("human-vs-human play is untouched by CPU work", () => {
  /** FNV-1a, 32-bit. No dependency, and a single flipped field changes it. */
  function hash(s: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  }

  /** EVERY observable field, not a convenient subset: a four-field trace stays equal while the sim
   *  diverges underneath it (velocities, stateFrame, hitstop and the event stream all move first). */
  function traceTick(w: World): string {
    const f = w.fighters.map((x) =>
      [
        x.x.toFixed(4), x.y.toFixed(4), x.vx.toFixed(4), x.vy.toFixed(4),
        x.facing, x.grounded ? 1 : 0, x.state, x.stateFrame, x.stunTimer, x.stunEpoch,
        x.health, x.meter, x.lastHitId, x.pendingFreeze,
        x.guardIntent ? 1 : 0, x.crouchIntent ? 1 : 0, x.guarding ? 1 : 0,
        x.consumed.up ? 1 : 0, x.consumed.light ? 1 : 0, x.consumed.heavy ? 1 : 0, x.consumed.special ? 1 : 0,
        x.interruptedSpecial ? 1 : 0, x.damageScale,
      ].join(","),
    );
    const m = w.match;
    const world = [
      w.hitstop, w.frontIndex, m.phase, m.round, m.timerTicks, m.introTicks, m.endTicks,
      m.wins[0], m.wins[1], m.matchWinner ?? "-",
      w.consumedInputs.map((c) => `${+c.up}${+c.light}${+c.heavy}${+c.special}`).join(""),
      w.interruptedSpecials.map((b) => +b).join(""),
    ].join(",");
    const events = w.drainEvents().map((e) => `${e.type}:${e.player ?? "-"}`).join(";");
    return `${f[0]}|${f[1]}|${world}|${events}`;
  }

  /** Two humans on fixed, mutually-desynced patterns. Coprime periods so they drift against each
   *  other and the match exercises walking, crouching, guarding, jumping, both normals and the super
   *  rather than one repeated poke. */
  function humanPair(i: number): [InputSnapshot, InputSnapshot] {
    const p0 = emptyInput();
    const p1 = emptyInput();
    if (i % 7 < 3) p0.right = true;
    if (i % 11 === 0) { p0.lightPressed = true; p0.light = true; }
    if (i % 23 === 0) { p0.heavyPressed = true; p0.heavy = true; }
    if (i % 31 < 4) { p0.down = true; }
    if (i % 53 === 0) { p0.upPressed = true; p0.up = true; }
    if (i % 13 < 5) p1.left = true;
    if (i % 17 === 0) { p1.lightPressed = true; p1.light = true; }
    if (i % 29 === 0) { p1.heavyPressed = true; p1.heavy = true; }
    if (i % 19 < 6) p1.block = true;
    if (i % 61 === 0) { p1.specialPressed = true; p1.special = true; }
    return [p0, p1];
  }

  // The same instrument, pointed at EASY. Easy holds every new knob at 0, so it must come out of this
  // pass playing exactly as it did going in.
  //
  // This is not theoretical: the first cut of the punish branch took its RNG draw unconditionally, and
  // a draw taken for a chance of ZERO still advances the shared xorshift stream. Every later decision
  // on easy moved, and easy started KO'ing the idle player that `difficulty is survivable` pins as
  // exactly what easy must never do. The `knobs.x > 0` guards in cpu.ts are what this hash protects;
  // remove one and this goes red long before the tier ladder notices.
  it("EASY is byte-identical to the pre-change build (all new knobs are 0)", () => {
    const w = fightWorld(260);
    const cpu = new CpuController(1, "easy", 7);
    w.fighters[1].damageScale = DAMAGE_SCALE.easy;
    const parts: string[] = [];
    for (let i = 0; i < 900; i++) {
      w.advance(DT, NONE, cpu);
      parts.push(traceTick(w));
    }
    // Captured with cpu.ts stashed back to bd8c0e6 — this literal IS the old easy CPU.
    expect(hash(parts.join("|"))).toBe("bd99b475");
  });

  it("...and stays byte-identical against an opponent who ATTACKS", () => {
    // The test above runs against an idle player, and that is a hole a review found: with nobody ever
    // attacking, `isAttackState(opp.state)` is never true, so the whole guard branch — and the
    // recovery-suppression added to it — is never executed. Easy's guard behaviour and RNG stream
    // could therefore change completely with that hash still green.
    //
    // This fixture attacks on a fixed cadence, so the guard branch runs, `reacted` cycles, and the
    // suppression predicate is evaluated on every exchange.
    const w = fightWorld(150);
    const cpu = new CpuController(1, "easy", 7);
    w.fighters[1].damageScale = DAMAGE_SCALE.easy;
    const parts: string[] = [];
    for (let i = 0; i < 900; i++) {
      const p0 = emptyInput();
      if (i % 17 === 0) { p0.heavy = true; p0.heavyPressed = true; }
      if (i % 29 === 0) { p0.light = true; p0.lightPressed = true; }
      w.fighters[0].health = 9999; // keep the exchange going for the whole window
      w.advance(DT, [p0, emptyInput()], cpu);
      parts.push(traceTick(w));
    }
    expect(hash(parts.join("|"))).toBe("477eba3b");
  });

  it("...and against an opponent who JUMPS, which is the only fixture that reaches the anti-air branch", () => {
    // The third fixture, and the hole the other two left. Instrumented, fixture 1 reaches the anti-air
    // predicate twice and fixture 2 never — so an ungated RNG draw added to that branch changed easy's
    // draw count from 949 to 950 with the hash UNMOVED, and removing `antiAirChance > 0` was invisible
    // to the entire suite. `punishChance` and `spacingBias` are caught by both hashes and `wakeupChance`
    // by fixture 2; anti-air was protected by nothing at all.
    //
    // This opponent jumps on a fixed period, so the descent — `vy > 0`, in range — is entered many
    // times over the window and the branch is genuinely executed.
    const w = fightWorld(200);
    const cpu = new CpuController(1, "easy", 7);
    w.fighters[1].damageScale = DAMAGE_SCALE.easy;
    const parts: string[] = [];
    for (let i = 0; i < 900; i++) {
      const p0 = emptyInput();
      if (i % 37 === 0) { p0.up = true; p0.upPressed = true; }
      if (i % 23 === 0) { p0.light = true; p0.lightPressed = true; }
      w.fighters[0].health = 9999;
      w.fighters[1].health = 9999;
      w.advance(DT, [p0, emptyInput()], cpu);
      parts.push(traceTick(w));
    }
    // Captured with cpu.ts stashed back to bd8c0e6, exactly like the two above — this literal IS the
    // old easy CPU, not a re-baseline against the new one. Coverage, measured on the same fixture:
    // 798/900 fight ticks and the anti-air predicate site reached 20 times, against 2 for fixture 1
    // and 0 for fixture 2.
    expect(hash(parts.join("|"))).toBe("7b22e5ac");
  });

  it("a scripted 1v1 produces a byte-identical trace to the pre-change build", () => {
    const w = fightWorld(300);
    const parts: string[] = [];
    for (let i = 0; i < 900; i++) {
      w.advance(DT, humanPair(i)); // NO cpu seam — this is the human path, end to end
      parts.push(traceTick(w));
    }
    // Captured on the pre-change tree (bd8c0e6, before any CPU edit). Moving it means 1v1 changed.
    expect(hash(parts.join("|"))).toBe("d9d977af");
  });
});
