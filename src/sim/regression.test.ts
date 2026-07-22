import { describe, it, expect } from "vitest";
import { World } from "./world";
import { Fighter } from "./fighter";
import { resolveSpatial } from "./spatial";
import { FIGHTER_A, FIGHTER_B } from "./config";
import { emptyInput, type InputSnapshot } from "./types";
import { DT, STAGE_MARGIN, STAGE_WIDTH, START_GAP, ROUND_TIME, TICK_HZ } from "./constants";

function mk(over: Partial<InputSnapshot> = {}): InputSnapshot {
  return { ...emptyInput(), ...over };
}
const NONE: [InputSnapshot, InputSnapshot] = [mk(), mk()];

function fightWorld(gap = 90): World {
  const w = new World(FIGHTER_A, FIGHTER_B);
  w.match.phase = "fight";
  w.match.introTicks = 0;
  w.fighters[0].reset(640 - gap / 2, 1);
  w.fighters[1].reset(640 + gap / 2, -1);
  return w;
}

// P1-1: corner clamp-before-measure
describe("spatial corner (P1-1)", () => {
  it("leaves no pushbox overlap and no out-of-bounds at the wall", () => {
    const a = new Fighter(FIGHTER_A, 0);
    const b = new Fighter(FIGHTER_B, 1);
    a.reset(STAGE_MARGIN, 1); // pinned to the left wall
    b.reset(STAGE_MARGIN + 30, -1); // overlapping into it
    resolveSpatial(a, b);
    expect(a.x).toBeGreaterThanOrEqual(STAGE_MARGIN - 1e-6);
    expect(b.x).toBeGreaterThanOrEqual(STAGE_MARGIN - 1e-6);
    expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(55); // combined pushbox width
  });
});

// P1-2: advance() reports ticks so the adapter can latch a press across a 0-tick frame
describe("input latch contract (P1-2)", () => {
  it("advance returns 0 ticks for a sub-tick dt, then consumes a latched press", () => {
    const w = fightWorld();
    w.fighters[0].x = 600;
    w.fighters[1].x = 690;
    const press = mk({ light: true, lightPressed: true });
    const n1 = w.advance(DT * 0.4, [press, mk()]); // not enough time → 0 ticks
    expect(n1).toBe(0);
    expect(w.fighters[0].state).toBe("idle"); // nothing consumed yet
    // next frame completes a tick; adapter keeps lightPressed latched (key already released)
    const n2 = w.advance(DT * 0.7, [mk({ lightPressed: true }), mk()]);
    expect(n2).toBe(1);
    expect(w.fighters[0].state).toBe("attackLight"); // press survived
  });
});

// P1-3: airborne KO body keeps falling during the frozen roundEnd phase
describe("airborne KO settles (P1-3)", () => {
  it("integrates the KO body during roundEnd", () => {
    const w = fightWorld();
    const b = w.fighters[1];
    b.y = 480;
    b.grounded = false;
    b.vy = 0;
    b.health = 0;
    (b as unknown as { state: string }).state = "ko";
    w.tick(NONE); // KO detected → roundEnd
    expect(w.match.phase).toBe("roundEnd");
    const before = b.y;
    w.tick(NONE); // settle
    expect(b.y).toBeGreaterThan(before); // fell under gravity while frozen
  });
});

// P2-1: the round clock must not tick on the hitstop connecting frame
describe("clock skips the hitstop tick (P2-1)", () => {
  it("timerTicks is unchanged on the frame a hit starts hitstop", () => {
    const w = fightWorld();
    let checked = false;
    for (let i = 0; i < 20 && !checked; i++) {
      const before = w.match.timerTicks;
      w.tick([i === 0 ? mk({ light: true, lightPressed: true }) : mk(), mk()]);
      if (w.hitstop > 0) {
        expect(w.match.timerTicks).toBe(before);
        checked = true;
      }
    }
    expect(checked).toBe(true);
  });
});

// R-1: right-wall corner — mirror of the left-wall P1-1 (only MIN_X was covered before)
describe("spatial right-wall corner (R-1)", () => {
  it("leaves no pushbox overlap and no out-of-bounds at the right wall", () => {
    const MAX_X = STAGE_WIDTH - STAGE_MARGIN;
    const a = new Fighter(FIGHTER_A, 0);
    const b = new Fighter(FIGHTER_B, 1);
    a.reset(MAX_X, -1); // pinned to the right wall
    b.reset(MAX_X - 30, 1); // overlapping into it
    resolveSpatial(a, b);
    expect(a.x).toBeLessThanOrEqual(MAX_X + 1e-6);
    expect(b.x).toBeLessThanOrEqual(MAX_X + 1e-6);
    expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(55); // combined pushbox width
  });
});

// R-2: settleBodies must keep frozen-phase bodies on-stage and keep facing/depth tracking
describe("settleBodies clamps + orients during frozen phases (R-2)", () => {
  const MAX_X = STAGE_WIDTH - STAGE_MARGIN;

  it("clamps a KO body sliding off-stage during roundEnd, and updates the winner's facing", () => {
    const w = fightWorld();
    const [a, b] = w.fighters;
    b.health = 0;
    (b as unknown as { state: string }).state = "ko";
    w.tick(NONE); // b KO → roundEnd
    expect(w.match.phase).toBe("roundEnd");

    b.x = MAX_X + 50; // shoved past the wall...
    b.vx = 240; // ...and still moving outward
    b.grounded = true;
    a.facing = -1 as 1 | -1; // wrong-way; settle should re-point it at b (to the right)
    w.tick(NONE); // roundEnd → settleBodies: integrate then clamp/face

    expect(b.x).toBeLessThanOrEqual(MAX_X + 1e-6);
    expect(b.x).toBeGreaterThanOrEqual(STAGE_MARGIN - 1e-6);
    expect(a.facing).toBe(1); // updateFacing ran during settle
  });

  it("also clamps and orients during matchEnd (same settleBodies path)", () => {
    const w = fightWorld();
    w.match.wins = [1, 0]; // fighter 0 is one round from the match
    const [a, b] = w.fighters;
    b.health = 0;
    (b as unknown as { state: string }).state = "ko";
    w.tick(NONE); // b KO → wins[0]=2 → matchEnd
    expect(w.match.phase).toBe("matchEnd");

    b.x = MAX_X + 50;
    b.vx = 240;
    b.grounded = true;
    a.facing = -1 as 1 | -1; // wrong-way; settle should re-point it at b
    w.tick(NONE); // matchEnd → settleBodies
    expect(b.x).toBeLessThanOrEqual(MAX_X + 1e-6);
    expect(a.facing).toBe(1); // updateFacing ran during settle
  });
});

// R-3: timeout resolution (decrementClock) — win by health, draw on equal
describe("timeout resolution (R-3)", () => {
  it("higher health wins the round on timeout", () => {
    const w = fightWorld();
    w.match.timerTicks = 1;
    w.fighters[0].health = 80;
    w.fighters[1].health = 40;
    w.tick(NONE); // fight tick → clock hits 0 → finishRound(0)
    expect(w.match.phase).toBe("roundEnd");
    expect(w.match.lastRoundWinner).toBe(0);
    expect(w.match.wins[0]).toBe(1);
    expect(w.drainEvents().some((e) => e.type === "roundEnd")).toBe(true);
  });

  it("equal health is a draw — no win recorded", () => {
    const w = fightWorld();
    w.match.timerTicks = 1;
    w.fighters[0].health = 50;
    w.fighters[1].health = 50;
    w.tick(NONE);
    expect(w.match.phase).toBe("roundEnd");
    expect(w.match.lastRoundWinner).toBe(null);
    expect(w.match.wins).toEqual([0, 0]); // proves the draw path, not the default
  });
});

// R-4: double-KO on the same tick is a draw (checkRoundOver, winner=null)
describe("double-KO draw (R-4)", () => {
  it("both fighters KO'd → draw, no win recorded", () => {
    const w = fightWorld();
    const [a, b] = w.fighters;
    a.health = 0;
    (a as unknown as { state: string }).state = "ko";
    b.health = 0;
    (b as unknown as { state: string }).state = "ko";
    w.tick(NONE); // checkRoundOver: both KO → finishRound(null)
    expect(w.match.phase).toBe("roundEnd");
    expect(w.match.lastRoundWinner).toBe(null);
    expect(w.match.wins).toEqual([0, 0]);
  });
});

// R-5: restart() is a full reset — match counters AND fighter/round state
describe("restart full reset (R-5)", () => {
  it("resets wins/round/winner, phase, hitstop, timer, and both fighters", () => {
    const w = fightWorld();
    const [a, b] = w.fighters;
    // dirty everything restart is supposed to clear
    w.match.wins = [1, 1];
    w.match.round = 3;
    w.match.matchWinner = 1;
    w.match.timerTicks = 5;
    w.hitstop = 4;
    a.health = 10;
    a.x = 200;
    b.health = 20;
    b.x = 1000;

    w.restart();

    expect(w.match.wins).toEqual([0, 0]);
    expect(w.match.round).toBe(1);
    expect(w.match.matchWinner).toBe(null);
    expect(w.match.phase).toBe("intro");
    expect(w.hitstop).toBe(0);
    expect(w.match.timerTicks).toBe(ROUND_TIME * TICK_HZ); // beginRound refilled it
    expect(a.health).toBe(FIGHTER_A.stats.maxHealth);
    expect(b.health).toBe(FIGHTER_B.stats.maxHealth);
    const CENTER = STAGE_WIDTH / 2;
    expect(a.x).toBe(CENTER - START_GAP / 2); // resetRound start positions
    expect(b.x).toBe(CENTER + START_GAP / 2);
  });
});

// R-6: tick() reports whether it consumed input — connecting hit true, frozen hitstop tick false
describe("tick() actionable-return contract (R-6)", () => {
  it("returns true on the connecting hit, false on the following hitstop-freeze tick", () => {
    const w = fightWorld();
    w.fighters[0].x = 600;
    w.fighters[1].x = 660; // in light-jab range, pushboxes clear
    let hitTickConsumed: boolean | undefined;
    for (let i = 0; i < 20; i++) {
      const consumed = w.tick([i === 0 ? mk({ light: true, lightPressed: true }) : mk(), mk()]);
      if (w.hitstop > 0) {
        hitTickConsumed = consumed;
        break;
      }
    }
    expect(hitTickConsumed).toBe(true); // input WAS consumed on the connecting tick
    const frozen = w.tick(NONE); // next tick is a hitstop freeze
    expect(w.hitstop).toBeGreaterThan(0); // still frozen
    expect(frozen).toBe(false); // frozen tick consumes nothing
  });
});

// R-7: a press buffered on the intro→fight tick survives (the finding-4 fix)
describe("input buffered across the intro boundary (R-7)", () => {
  it("advance reports 0 on the intro-transition tick, then the replayed edge fires", () => {
    const w = new World(FIGHTER_A, FIGHTER_B); // fresh → intro phase
    w.match.introTicks = 1; // one tick from fight
    const n1 = w.advance(DT, [mk({ light: true, lightPressed: true }), mk()]);
    expect(n1).toBe(0); // intro-transition tick is non-actionable
    expect(w.match.phase).toBe("fight");
    expect(w.fighters[0].state).toBe("idle"); // press NOT consumed yet
    // adapter keeps the edge latched and replays it next frame
    const n2 = w.advance(DT, [mk({ lightPressed: true }), mk()]);
    expect(n2).toBe(1);
    expect(w.fighters[0].state).toBe("attackLight"); // buffered press survived
  });
});

// R-8: z-order follows the most recent mover, not just the attacker.
// Before Phase 12 `updateDepth` only reacted to attacks, so two fighters that merely walked never
// swapped and P1 was drawn behind P2 for the whole match. The signal is the LOCOMOTION STATE that
// `think` assigns — not a position delta, because `resolveSpatial` moves both bodies when a walker
// pushes an idle opponent, the MAX_SEPARATION cap rewrites both, and retained knockback moves a
// fighter who never acted (including a KO body sliding through roundEnd).
describe("depth follows the mover (R-8)", () => {
  const walkRight = mk({ right: true });
  const walkLeft = mk({ left: true });

  it("a lone walker is drawn in front", () => {
    const w = fightWorld(400);
    w.frontIndex = 1; // the constructor default: P2 in front
    w.tick([walkRight, mk()]); // only P1 moves
    expect(w.fighters[0].state).toBe("walkF");
    expect(w.frontIndex).toBe(0);
    // ...and the other way round
    w.tick([mk(), walkLeft]);
    expect(w.fighters[1].state).toBe("walkF");
    expect(w.frontIndex).toBe(1);
  });

  it("both walking is a tie and keeps the current front", () => {
    const w = fightWorld(400);
    w.tick([walkRight, mk()]); // P1 takes the front alone
    expect(w.frontIndex).toBe(0);
    w.tick([walkRight, walkLeft]); // both walking now
    expect(w.fighters[0].state).toBe("walkF");
    expect(w.fighters[1].state).toBe("walkF");
    expect(w.frontIndex).toBe(0); // unchanged — no flicker
  });

  it("an attacker outranks a walker", () => {
    const w = fightWorld(400);
    w.tick([walkRight, mk()]);
    expect(w.frontIndex).toBe(0);
    w.tick([walkRight, mk({ light: true, lightPressed: true })]); // P1 walks, P2 attacks
    expect(w.fighters[1].state).toBe("attackLight");
    expect(w.frontIndex).toBe(1);
  });

  it("a walker pushing an idle opponent still takes the front", () => {
    // Touching pushboxes: resolveSpatial moves BOTH bodies, so a position-delta rule would read
    // this as "both moved" and refuse to swap. The state rule still sees exactly one walker.
    const w = fightWorld(40);
    w.frontIndex = 1;
    const before = w.fighters[1].x;
    w.tick([walkRight, mk()]);
    expect(w.fighters[1].x).not.toBe(before); // the idle fighter really was pushed
    expect(w.fighters[1].state).toBe("idle");
    expect(w.frontIndex).toBe(0);
  });

  it("a KO body sliding through roundEnd never takes the front", () => {
    const w = fightWorld(400);
    w.tick([walkRight, mk()]); // P1 (the eventual winner) is in front
    expect(w.frontIndex).toBe(0);
    const loser = w.fighters[1];
    loser.health = 0;
    loser.state = "ko"; // `state` is public; setState is private (it also resets stateFrame)
    loser.vx = -300; // still sliding
    w.match.phase = "roundEnd";
    w.match.endTicks = 30;
    for (let i = 0; i < 10; i++) w.tick(NONE); // settleBodies integrates + updates depth
    expect(w.frontIndex).toBe(0); // the loser did not pop in front while sliding
  });
});
