import { describe, expect, it } from "vitest";
import { World } from "./world";
import type { CpuSeam } from "./world";
import { CpuController, DAMAGE_SCALE } from "./cpu";
import type { Difficulty } from "./cpu";
import { FIGHTER_A, FIGHTER_B } from "./config";
import { ACTIONABLE } from "./fighter";
import { emptyInput, isAttackState } from "./types";
import type { InputSnapshot } from "./types";
import { DT } from "./constants";

const NONE: [InputSnapshot, InputSnapshot] = [emptyInput(), emptyInput()];

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
