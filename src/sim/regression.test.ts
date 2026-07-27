import { describe, it, expect } from "vitest";
import { World } from "./world";
import { Fighter, METER_MAX } from "./fighter";
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

  // R-13 (Phase 16, found by PLAYING): the tiebreak is the health FRACTION, not raw health.
  //
  // Fighters do not share a health pool — the brawler carries 105 and the other two 100 — so a raw
  // `a.health > b.health` handed the brawler every timeout in which both fighters had taken the same
  // punishment, INCLUDING none at all. Watched live: monk vs brawler, neither ever hit, both bars
  // full, and the match ended 2-0 to the brawler on time. Every unit and browser test passed, because
  // every one of them set both healths from the same implied pool.
  //
  // The bars are what the player reads, and the bars are fractions.
  /** The shipped roster's real asymmetry: the brawler's 105 against the other two fighters' 100. */
  function unevenPools(): World {
    const tanky = { ...FIGHTER_B, stats: { ...FIGHTER_B.stats, maxHealth: 105 } };
    const w = new World(FIGHTER_A, tanky);
    w.match.phase = "fight";
    w.match.introTicks = 0;
    w.fighters[0].reset(640 - 45, 1);
    w.fighters[1].reset(640 + 45, -1);
    return w;
  }

  it("two untouched fighters DRAW on timeout even with different maxHealth", () => {
    const w = unevenPools();
    w.match.timerTicks = 1;
    // Deliberately NOT assigned: whatever each pool is, both fighters are on 100% of it.
    expect(w.fighters[0].health).toBe(100);
    expect(w.fighters[1].health).toBe(105); // the premise: the pools really do differ
    w.tick(NONE);
    expect(w.match.phase).toBe("roundEnd");
    expect(w.match.lastRoundWinner).toBe(null);
    expect(w.match.wins).toEqual([0, 0]);
  });

  it("a smaller absolute health still WINS when it is the larger share of its own pool", () => {
    const w = unevenPools();
    w.match.timerTicks = 1;
    w.fighters[0].health = 60; // 60 of 100 = 60%
    w.fighters[1].health = 63; // 63 of 105 = 60% ... so still a draw
    w.tick(NONE);
    expect(w.match.lastRoundWinner).toBe(null);

    const w2 = unevenPools();
    w2.match.timerTicks = 1;
    w2.fighters[0].health = 90; // 90%
    w2.fighters[1].health = 95; // 95 of 105 = 90.5%, MORE points and a bigger share
    w2.tick(NONE);
    expect(w2.match.lastRoundWinner).toBe(1);

    const w3 = unevenPools();
    w3.match.timerTicks = 1;
    w3.fighters[0].health = 90; // 90% of 100
    w3.fighters[1].health = 94; // 94 of 105 = 89.5% — more points, smaller share, so it LOSES
    w3.tick(NONE);
    expect(w3.match.lastRoundWinner).toBe(0);
  });

  // The comparison is cross-multiplied (integer) rather than divided, because a DRAW is exactly the
  // outcome that a hair of float error would silently convert into a win. 7/100 vs 7.35/105 is the
  // shape that matters; healths are integers, so this sweeps the equal-share pairs that exist.
  it("calls equal SHARES a draw exactly, with no float slop", () => {
    for (const [ha, hb] of [[20, 21], [40, 42], [60, 63], [80, 84], [100, 105], [0, 0]]) {
      const w = unevenPools();
      w.match.timerTicks = 1;
      w.fighters[0].health = ha;
      w.fighters[1].health = hb;
      w.tick(NONE);
      expect(w.match.lastRoundWinner, `${ha}/100 vs ${hb}/105 should be a draw`).toBe(null);
    }
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

// R-9: a special STUFFED on its startup must not freeze the world.
// `think` arms pendingFreeze, but combat runs later on the SAME tick and can put the fighter in
// hitstun. Honouring the freeze anyway stopped the match dead and flashed the interrupted player's
// super portrait for a move that never came out — a full second of cinematic for nothing, and a free
// escape for whoever got hit. Found by the Phase 15 diff review.
describe("an interrupted special does not freeze the world (R-9)", () => {
  it("no freeze and no `special` event when the starter is stuffed on the same tick", () => {
    const w = fightWorld(90);
    const [p1, p2] = w.fighters;
    p1.meter = METER_MAX;

    // P2 swings first so its hit box is live on the tick P1 commits to the special.
    let started = false;
    for (let i = 0; i < 12 && !started; i++) {
      // Press on a tick where P2's hit box is ALREADY live (light is startup 4, so frames 4..6), so
      // the connect lands in the very same tick that starts the special — that is the whole scenario.
      const p1In = p2.state === "attackLight" && p2.stateFrame >= 4
        ? mk({ special: true, specialPressed: true })
        : mk();
      w.tick([p1In, i === 0 ? mk({ light: true, lightPressed: true }) : mk()]);
      started = p1In.specialPressed;
    }

    expect(started).toBe(true);
    expect(p1.state).toBe("hitstun"); // the special was stuffed before it came out
    expect(w.drainEvents().some((e) => e.type === "special")).toBe(false);
    // Only P2's ordinary hitstop may be running — never the 36-tick super freeze.
    expect(w.hitstop).toBeLessThan(FIGHTER_A.attacks.special.freeze!);
  });
});

// R-10: a REFUSED special press must never linger in the buffer.
// The special branch used to sit AFTER the light/heavy branches, which return early. Pressing light
// and special together on a nearly-full bar meant the special edge was never reported consumed, the
// light's own damage topped the meter up, and the buffered special then fired by itself. Found by the
// Phase 15 diff review.
describe("a refused special edge is always consumed (R-10)", () => {
  it("light + special on a short bar reports BOTH edges consumed", () => {
    const short = fightWorld();
    short.fighters[0].meter = METER_MAX - 1;
    short.tick([mk({ light: true, lightPressed: true, special: true, specialPressed: true }), mk()]);
    // The refused special is still spent, so the latch releases it; the light comes out as normal.
    expect(short.fighters[0].consumed.special).toBe(true);
    expect(short.fighters[0].state).toBe("attackLight");

    // ...and on a FULL bar the super wins the frame outright — a super beats a normal pressed together.
    const full = fightWorld();
    full.fighters[0].meter = METER_MAX;
    full.tick([mk({ light: true, lightPressed: true, special: true, specialPressed: true }), mk()]);
    expect(full.fighters[0].state).toBe("special");
  });

});

// R-11: every stun ENTRY is identifiable, including one that re-enters the state it is already in.
// A combo's 2nd+ hit lands while the defender is already in `hitstun`: applyHit resets stateFrame and
// stunTimer, but the STATE NAME does not change — so `FighterSprite.update`, which re-plays only on a
// state change, never restarted the hurt animation. The defender froze on the last hurt frame for the
// rest of the combo. Measured before the fix: before=hitstun/timer12/frame0, after=hitstun/timer12/
// frame0, stateChanged=false.
//
// `stunTimer` rising is NOT a usable substitute: a multi-tick advance batch that takes the timer down
// and a re-hit that restores it to exactly the previously observed value cancel out, and the render
// pass sees no change. Same lesson as the combo counter — identity needs its own counter, never an
// inferred one.
describe("a stun re-entry is identifiable (R-11)", () => {
  it("bumps stunEpoch even when the state name does not change", () => {
    const w = fightWorld();
    const b = w.fighters[1];
    const atk = w.fighters[0].cfg.attacks.light;

    b.applyHit(atk.damage, atk.hitstun, 0, 0, false);
    const first = b.stunEpoch;
    expect(b.state).toBe("hitstun");

    w.tick(NONE);
    w.tick(NONE);
    expect(b.state).toBe("hitstun"); // still stunned: the re-hit lands in the SAME state

    b.applyHit(atk.damage, atk.hitstun, 0, 0, false);
    expect(b.state).toBe("hitstun");
    expect(b.stunEpoch, "a re-hit in the same state must still be a new stun episode").toBeGreaterThan(first);
  });

  it("counts blockstun and a KO as episodes too, and survives a round reset", () => {
    const w = fightWorld();
    const b = w.fighters[1];
    const atk = w.fighters[0].cfg.attacks.light;
    const start = b.stunEpoch;

    b.applyHit(0, atk.blockstun, 0, 0, true);
    expect(b.stunEpoch).toBe(start + 1);
    b.applyHit(b.health, atk.hitstun, 0, 0, false); // fatal — takes the `ko` branch
    expect(b.state).toBe("ko");
    expect(b.stunEpoch, "the KO branch returns early but is still a new episode").toBe(start + 2);

    // Monotonic across a reset: the renderer compares against whatever it last saw, and a counter that
    // restarted at 0 could collide with the value already on screen and skip the re-play.
    const before = b.stunEpoch;
    b.reset(400, -1);
    expect(b.stunEpoch).toBeGreaterThanOrEqual(before);
  });
});

// R-12: the stun window the RENDER pass observes is the window the state actually still lasts.
// `stunFrameRate` spans the animation over `Fighter.stunTimer` as read on the frame the state was
// entered, so if that number ever stopped matching the remaining state length the art would be cut
// off or freeze — the exact defect that class of bug keeps producing. A review flagged the landing
// `knockdown` as reading 17 where the attack assigned 18 and proposed restoring the 18; it is 17
// because `onLand` runs inside `integrate`, which precedes `advanceTimers` in the same tick with no
// hitstop to bail on — and the state also lasts exactly 17 more ticks, so 17 is correct and a +1
// would overrun. hitstun/blockstun are entered from combat, which sets hitstop, and tick() returns
// before advanceTimers — so those see their full window. This pins all three.
describe("the observed stun window equals the remaining state length (R-12)", () => {
  const runOut = (w: World, f: Fighter, state: string) => {
    let ticks = 0;
    while (f.state === state && ticks < 300) { w.tick(NONE); ticks++; }
    return ticks;
  };

  it("hitstun and blockstun are observed at full length", () => {
    for (const [blocked, stun] of [[false, 12], [true, 9]] as const) {
      const w = fightWorld();
      const b = w.fighters[1];
      b.applyHit(blocked ? 0 : 5, stun, 0, 0, blocked);
      const observed = b.stunTimer; // what FighterSprite reads on the entry frame
      expect(observed, `${blocked ? "blockstun" : "hitstun"} observed`).toBe(stun);
      expect(runOut(w, b, b.state), `${blocked ? "blockstun" : "hitstun"} length`).toBe(observed);
    }
  });

  it("a landing knockdown is observed one tick short — and lasts exactly that", () => {
    const w = fightWorld();
    const b = w.fighters[1];
    b.applyHit(10, 18, 200, -260, false); // knocked airborne; onLand converts to knockdown
    let observed = -1;
    for (let i = 0; i < 200 && observed < 0; i++) {
      w.tick(NONE);
      if (b.state === "knockdown") observed = b.stunTimer;
    }
    expect(observed, "onLand assigns 18; advanceTimers runs later in the SAME tick").toBe(17);
    expect(runOut(w, b, "knockdown"), "the animation window must match what is left").toBe(observed);
  });
});
