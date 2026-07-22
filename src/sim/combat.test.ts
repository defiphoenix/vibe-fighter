import { describe, it, expect } from "vitest";
import { World } from "./world";
import { FIGHTER_A, FIGHTER_B } from "./config";
import { emptyInput, type InputSnapshot } from "./types";
import { DT, GROUND_Y } from "./constants";

function mk(over: Partial<InputSnapshot> = {}): InputSnapshot {
  return { ...emptyInput(), ...over };
}
const NONE: [InputSnapshot, InputSnapshot] = [mk(), mk()];

/** fresh world already in the fight phase, fighters placed `gap` px apart, both grounded. */
function fightWorld(gap = 90): World {
  const w = new World(FIGHTER_A, FIGHTER_B);
  w.match.phase = "fight";
  w.match.introTicks = 0;
  const cx = 640;
  w.fighters[0].reset(cx - gap / 2, 1);
  w.fighters[1].reset(cx + gap / 2, -1);
  return w;
}

const lightPress = mk({ light: true, lightPressed: true });
const heavyPress = mk({ heavy: true, heavyPressed: true });

describe("determinism / rate independence", () => {
  it("advance(dt) in fixed steps matches direct tick() calls", () => {
    const a = fightWorld();
    const b = fightWorld();
    for (let i = 0; i < 60; i++) {
      a.tick([lightPress, mk()]);
      b.advance(DT, [lightPress, mk()]);
    }
    expect(b.fighters[0].x).toBeCloseTo(a.fighters[0].x, 6);
    expect(b.fighters[1].health).toBe(a.fighters[1].health);
  });

  it("clamps a huge dt so it cannot spiral (MAX_FRAME)", () => {
    const w = fightWorld();
    const before = w.fighters[1].health;
    w.advance(100, NONE); // clamped to 0.25s → 15 ticks, not 6000
    // nothing hit, but sim advanced a bounded amount; no throw / no runaway
    expect(w.fighters[1].health).toBe(before);
  });
});

describe("hit resolution", () => {
  it("a light attack deals damage exactly once (active-window dedup)", () => {
    const w = fightWorld();
    const start = w.fighters[1].health;
    let dmgApplied = start;
    for (let i = 0; i < 20; i++) {
      w.tick([i === 0 ? lightPress : mk(), mk()]);
      dmgApplied = Math.min(dmgApplied, w.fighters[1].health);
    }
    // one light = 6 damage, not 3×6 from the 3 active frames
    expect(start - w.fighters[1].health).toBe(6);
  });

  it("puts the defender into hitstun and knocks them back (away from attacker)", () => {
    const w = fightWorld();
    const bx0 = w.fighters[1].x;
    let sawHitstun = false;
    for (let i = 0; i < 20; i++) {
      w.tick([i === 0 ? lightPress : mk(), mk()]);
      if (w.fighters[1].state === "hitstun") sawHitstun = true;
    }
    expect(sawHitstun).toBe(true);
    expect(w.fighters[1].x).toBeGreaterThan(bx0); // pushed to the right (away)
  });
});

describe("geometric blocking (dedicated block key)", () => {
  it("standing block stops a high light: chip only AND enters blockstun", () => {
    const w = fightWorld();
    const start = w.fighters[1].health;
    const block = mk({ block: true }); // explicit guard key, no direction
    let sawBlockstun = false;
    for (let i = 0; i < 20; i++) {
      w.tick([i === 0 ? lightPress : mk(), block]);
      if (w.fighters[1].state === "blockstun") sawBlockstun = true; // 9-tick stun; catch it live
    }
    expect(start - w.fighters[1].health).toBe(1); // chip
    expect(sawBlockstun).toBe(true); // real state assertion, not the old tautology
  });

  // TEST_DUMMY's heavy is authored low on purpose (see config.ts) — this pins the MECHANISM.
  // The shipped roster's ground heavy is a high; registry.test.ts owns that matrix.
  it("standing block FAILS against a low heavy (full damage, high/low preserved)", () => {
    const w = fightWorld();
    const start = w.fighters[1].health;
    const block = mk({ block: true }); // standing guard sits high
    let sawHitstun = false;
    for (let i = 0; i < 34; i++) {
      w.tick([i === 0 ? heavyPress : mk(), block]);
      if (w.fighters[1].state === "hitstun") sawHitstun = true;
    }
    expect(start - w.fighters[1].health).toBe(14); // low hit beats a high guard
    expect(sawHitstun).toBe(true);
  });

  it("crouch block (block + down) stops a low heavy (chip only)", () => {
    const w = fightWorld();
    const start = w.fighters[1].health;
    const blockLow = mk({ block: true, down: true });
    for (let i = 0; i < 34; i++) w.tick([i === 0 ? heavyPress : mk(), blockLow]);
    expect(start - w.fighters[1].health).toBe(3); // heavy chip
  });

  it("hold-back alone NO LONGER guards (block is a dedicated key now)", () => {
    const w = fightWorld();
    const start = w.fighters[1].health;
    const holdBack = mk({ right: true }); // P2 faces left → right = away, but no block key
    for (let i = 0; i < 20; i++) w.tick([i === 0 ? lightPress : mk(), holdBack]);
    expect(start - w.fighters[1].health).toBe(6); // full damage: away-hold does not block
  });

  it("block is disabled while airborne", () => {
    const w = fightWorld();
    const p2 = w.fighters[1];
    p2.grounded = false; // airborne
    p2.think(mk({ block: true }));
    expect(p2.activeBoxes().guard.length).toBe(0); // no guard box while airborne
    expect(p2.guarding).toBe(false);
  });

  it("holding block during hitstun does NOT guard (guarding cue must match reality)", () => {
    const w = fightWorld();
    const p2 = w.fighters[1];
    // force a stun state, then hold block
    p2.applyHit(6, 12, 0, 0, false); // -> hitstun
    p2.think(mk({ block: true }));
    expect(p2.state).toBe("hitstun");
    expect(p2.guarding).toBe(false); // intent is set, but no guard box is active
    expect(p2.activeBoxes().guard.length).toBe(0);
  });

  it("blocks at POINT-BLANK range (pushboxes touching), not just at spacing distance", () => {
    // Regression: guard boxes used to be a thin forward slab (local x 15, w 40), so at the separations
    // where the pushboxes actually touch the hit box started BEHIND the guard box and the attack went
    // through unblocked — i.e. block failed exactly where fighters spend the match.
    for (const gap of [56, 58, 60, 64]) {
      const wl = fightWorld(gap);
      const l0 = wl.fighters[1].health;
      for (let i = 0; i < 20; i++) wl.tick([i === 0 ? lightPress : mk(), mk({ block: true })]);
      expect(l0 - wl.fighters[1].health, `light @${gap}`).toBe(1); // chip only

      const wh = fightWorld(gap);
      const h0 = wh.fighters[1].health;
      for (let i = 0; i < 34; i++) wh.tick([i === 0 ? heavyPress : mk(), mk({ block: true, down: true })]);
      expect(h0 - wh.fighters[1].health, `heavy @${gap}`).toBe(3); // chip only
    }
  });

  it("a chip KO through a block still emits a ko event (not just block)", () => {
    const w = fightWorld();
    w.fighters[1].health = 2; // heavy chip is 3
    w.drainEvents();
    for (let i = 0; i < 34; i++) w.tick([i === 0 ? heavyPress : mk(), mk({ block: true, down: true })]);
    const types = w.drainEvents().map((e) => e.type);
    expect(types).toContain("block");
    expect(types).toContain("ko"); // without it the render layer never flashes the KO
    expect(w.fighters[1].isKO).toBe(true);
  });

  it("block + forward plants the fighter (no advancing block) with guard active", () => {
    const w = fightWorld();
    const p2 = w.fighters[1]; // faces left after the first solve
    w.tick(NONE);
    const forwardForP2 = p2.facing > 0 ? { right: true } : { left: true };
    w.tick([mk(), mk({ block: true, ...forwardForP2 })]);
    expect(p2.state).toBe("idle"); // planted, not walkF
    expect(p2.vx).toBe(0);
    expect(p2.activeBoxes().guard.length).toBeGreaterThan(0); // guard still up
  });
});

describe("hitstop", () => {
  it("freezes both fighters for the hitstop window on contact", () => {
    const w = fightWorld();
    // advance until the hit lands
    let landed = -1;
    for (let i = 0; i < 20 && landed < 0; i++) {
      w.tick([i === 0 ? lightPress : mk(), mk()]);
      if (w.hitstop > 0) landed = i;
    }
    expect(landed).toBeGreaterThan(0);
    const ax = w.fighters[0].x;
    const bh = w.fighters[1].health;
    // during hitstop, positions & health are frozen
    w.tick(NONE);
    expect(w.fighters[0].x).toBe(ax);
    expect(w.fighters[1].health).toBe(bh);
  });
});

describe("spacing", () => {
  it("pushboxes never overlap after resolution", () => {
    const w = fightWorld(10); // start almost on top of each other
    for (let i = 0; i < 5; i++) w.tick(NONE);
    const gap = Math.abs(w.fighters[0].x - w.fighters[1].x);
    expect(gap).toBeGreaterThanOrEqual(55); // ~ combined pushbox half-widths
  });

  it("fighters face each other and flip on crossover", () => {
    const w = fightWorld(120);
    w.tick(NONE);
    expect(w.fighters[0].facing).toBe(1);
    expect(w.fighters[1].facing).toBe(-1);
    // teleport P1 to the right of P2 → next solve flips facings
    w.fighters[0].x = w.fighters[1].x + 200;
    w.tick(NONE);
    expect(w.fighters[0].facing).toBe(-1);
    expect(w.fighters[1].facing).toBe(1);
  });
});

describe("air attacks", () => {
  it("airborne light is a distinct air state (airLight) and keeps air momentum", () => {
    const w = fightWorld(90);
    const p1 = w.fighters[0];
    // jump forward: hold right for momentum, press up
    w.tick([mk({ right: true, up: true, upPressed: true }), mk()]);
    expect(p1.grounded).toBe(false);
    const vx0 = p1.vx;
    // swing light mid-air → the dedicated air normal, not the ground one
    w.tick([lightPress, mk()]);
    expect(p1.state).toBe("airLight");
    expect(p1.vx).toBe(vx0); // not zeroed like a grounded attack
    expect(p1.grounded).toBe(false);
  });

  it("airborne heavy routes to airHeavy", () => {
    const w = fightWorld(90);
    const p1 = w.fighters[0];
    w.tick([mk({ up: true, upPressed: true }), mk()]);
    w.tick([heavyPress, mk()]);
    expect(p1.state).toBe("airHeavy");
  });

  it("a descending air heavy is an OVERHEAD: standing guard stops it, crouch guard does not", () => {
    // The control legend used to say "heavies are lows", which is only true of the GROUND heavy —
    // the air normals come down from above and beat a crouching guard. Pinned so the legend and the
    // geometry can't drift apart again.
    const run = (height: number, guard: InputSnapshot): number => {
      const w = fightWorld(70);
      const p1 = w.fighters[0];
      p1.grounded = false;
      p1.y = GROUND_Y - height;
      const start = w.fighters[1].health;
      let lowest = start;
      for (let i = 0; i < 25; i++) {
        w.tick([i === 0 ? heavyPress : mk(), guard]);
        lowest = Math.min(lowest, w.fighters[1].health);
      }
      return start - lowest;
    };
    // Measured across the reachable jump arc (apex ~155px for jumpVelocity 900 / gravity 2600):
    // a standing guard covers the whole range, a crouching one stops covering it from ~80px up.
    for (const h of [50, 80, 110, 140]) {
      expect(run(h, mk()), `unguarded @${h}`).toBe(12); // it really connects at this height...
      expect(run(h, mk({ block: true })), `stand guard @${h}`).toBe(3); // ...and standing guard chips it
    }
    expect(run(110, mk({ block: true, down: true }))).toBe(12); // crouch guard eats the overhead
    expect(run(110, mk())).toBe(12); // and it does connect unguarded, so the above isn't a whiff
  });

  it("air timing is independent of the ground attack (separate frame windows)", () => {
    // airLight = 6+3+12 = 21 ticks; attackLight = 4+3+8 = 15 ticks
    expect(FIGHTER_A.states.airLight.frames.length).not.toBe(FIGHTER_A.states.attackLight.frames.length);
  });

  it("an air attack can damage a grounded opponent (jump-in)", () => {
    const w = fightWorld(70);
    const p1 = w.fighters[0];
    // airborne and rising, in range, so the active frames land before P1 touches down
    p1.grounded = false;
    p1.y = GROUND_Y - 50;
    p1.vy = -100;
    const start = w.fighters[1].health;
    let lowest = start;
    for (let i = 0; i < 20; i++) {
      w.tick([i === 0 ? lightPress : mk(), mk()]);
      lowest = Math.min(lowest, w.fighters[1].health);
    }
    expect(lowest).toBeLessThan(start);
  });
});

describe("crouch attacks (low moves)", () => {
  it("grounded + down + light is a distinct crouch attack state", () => {
    const w = fightWorld(90);
    const p1 = w.fighters[0];
    w.tick([mk({ down: true, light: true, lightPressed: true }), mk()]);
    expect(p1.state).toBe("crouchLight");
  });

  it("a BUFFERED crouch press still comes out low after down is released (downAtPress)", () => {
    // The render adapter latches the attack edge until an actionable tick eats it; by then the player
    // may have let go of down. Without the press-time stance the low came out as a standing normal.
    const w = fightWorld(90);
    const p1 = w.fighters[0];
    w.tick([mk({ light: true, lightPressed: true, down: false, downAtPress: true }), mk()]);
    expect(p1.state).toBe("crouchLight");
  });

  it("downAtPress does NOT leak into the guard stance", () => {
    const w = fightWorld(90);
    const p2 = w.fighters[1];
    w.tick([mk(), mk({ block: true, down: false, downAtPress: true })]);
    expect(p2.crouchIntent).toBe(false);
    expect(p2.activeBoxes().guard[0].y).toBe(p2.cfg.guardStand[0].y); // standing guard, not crouch
  });

  it("grounded WITHOUT down stays the standing attack", () => {
    const w = fightWorld(90);
    const p1 = w.fighters[0];
    w.tick([lightPress, mk()]);
    expect(p1.state).toBe("attackLight");
  });

  it("crouch light is a true low: crouch block stops it, standing block does not", () => {
    // standing block (block, no down) eats the low crouchLight
    const ws = fightWorld();
    const s0 = ws.fighters[1].health;
    for (let i = 0; i < 20; i++) {
      ws.tick([i === 0 ? mk({ down: true, light: true, lightPressed: true }) : mk({ down: true }), mk({ block: true })]);
    }
    expect(ws.fighters[1].health).toBeLessThan(s0); // high guard misses the low

    // crouch block (block + down) chips only
    const wc = fightWorld();
    const c0 = wc.fighters[1].health;
    for (let i = 0; i < 20; i++) {
      wc.tick([i === 0 ? mk({ down: true, light: true, lightPressed: true }) : mk({ down: true }), mk({ block: true, down: true })]);
    }
    expect(c0 - wc.fighters[1].health).toBe(1); // crouchLight chip only
  });
});

describe("match flow", () => {
  it("a KO ends the round and best-of-3 ends the match", () => {
    const w = fightWorld();
    // drain P2 health directly, then let the clock notice the KO
    for (let r = 0; r < 2; r++) {
      w.fighters[1].health = 0;
      w.fighters[1].applyHit(0, 1, 0, 0, false); // force KO state
      w.fighters[1].health = 0;
      // ensure KO state
      (w.fighters[1] as unknown as { state: string }).state = "ko";
      w.match.phase = "fight";
      w.tick(NONE); // clock sees KO → endRound
      if ((w.match.phase as string) === "roundEnd") {
        // fast-forward the between-round pause
        w.match.endTicks = 1;
        w.tick(NONE);
      }
    }
    expect(w.match.wins[0]).toBeGreaterThanOrEqual(2);
    expect(w.match.matchWinner).toBe(0);
    expect(w.match.phase).toBe("matchEnd");
  });
});

describe("Fighter.damageScale — the CPU difficulty handicap", () => {
  /** Land P1's light on an idle P2 and report the damage dealt + the hit event's payload. */
  function landLight(scale: number): { dealt: number; reported: number } {
    const w = fightWorld(90);
    w.fighters[0].damageScale = scale;
    const before = w.fighters[1].health;
    const swing: [InputSnapshot, InputSnapshot] = [mk({ light: true, lightPressed: true }), mk()];
    for (let i = 0; i < 20; i++) {
      w.advance(DT, i === 0 ? swing : NONE);
      const hit = w.events.find((e) => e.type === "hit");
      if (hit) {
        return {
          dealt: before - w.fighters[1].health,
          reported: (hit.data as { damage: number }).damage,
        };
      }
    }
    throw new Error("the light never connected");
  }

  it("defaults to 1 and leaves damage untouched", () => {
    expect(new World(FIGHTER_A, FIGHTER_B).fighters[0].damageScale).toBe(1);
    expect(landLight(1).dealt).toBe(FIGHTER_A.attacks.light.damage);
  });

  it("scales the damage the fighter DEALS", () => {
    const full = FIGHTER_A.attacks.light.damage;
    expect(landLight(0.5).dealt).toBe(Math.round(full * 0.5));
  });

  it("floors a scaled hit at 1 so a connect always registers", () => {
    expect(landLight(0.01).dealt).toBe(1);
  });

  it("reports the SCALED damage in the hit event (the camera shake reads it)", () => {
    const r = landLight(0.5);
    expect(r.reported).toBe(r.dealt);
  });

  it("survives a full rematch — it is a match-long handicap, not per-round state", () => {
    // MatchScene sets this ONCE in create(); the Enter rematch goes through world.restart(), which
    // resets the fighters. If reset() ever started clearing it, the CPU would quietly go back to
    // full damage on round 2 of a rematch and nothing else would notice.
    const w = fightWorld(90);
    w.fighters[1].damageScale = 0.5;
    w.restart();
    expect(w.fighters[1].damageScale).toBe(0.5);
    expect(w.fighters[1].health).toBe(FIGHTER_B.stats.maxHealth); // the round DID reset
  });

  it("scales chip damage on block, which may floor at 0", () => {
    const w = fightWorld(90);
    w.fighters[0].damageScale = 0.1; // light chip is 1 → rounds to 0
    const before = w.fighters[1].health;
    const guard: [InputSnapshot, InputSnapshot] = [mk(), mk({ block: true })];
    const swing: [InputSnapshot, InputSnapshot] = [mk({ light: true, lightPressed: true }), mk({ block: true })];
    let blocked = false;
    for (let i = 0; i < 20 && !blocked; i++) {
      w.advance(DT, i === 0 ? swing : guard);
      blocked = w.events.some((e) => e.type === "block");
    }
    expect(blocked).toBe(true);
    expect(before - w.fighters[1].health).toBe(0);
  });
});
