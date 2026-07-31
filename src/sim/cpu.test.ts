import { describe, expect, it } from "vitest";
import { World } from "./world";
import type { CpuSeam } from "./world";
import { CpuController, DAMAGE_SCALE, WALK_HOLD, reachOf } from "./cpu";
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

/** Attacks STARTED by the CPU over a 600-tick window at poking range. */
function countAttacks(diff: Difficulty, seed: number): number {
  const w = fightWorld(90);
  const cpu = new CpuController(1, diff, seed);
  let attacks = 0;
  let wasAttacking = false;
  for (let i = 0; i < 600; i++) {
    // Keep the punching bag alive: a KO ends the round and then the match, which caps EVERY
    // difficulty at the same number of attacks and hides the difference being measured.
    w.fighters[0].health = 9999;
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
    const a = runCpu("normal", 240, 7);
    const b = runCpu("normal", 240, 99);
    const same = a.fighters[1].x === b.fighters[1].x && a.fighters[0].health === b.fighters[0].health;
    expect(same).toBe(false);
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
    for (const diff of ["easy", "normal", "hard"] as Difficulty[]) {
      expect(firstAttackTick(diff)).toBeGreaterThanOrEqual(6);
    }
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
