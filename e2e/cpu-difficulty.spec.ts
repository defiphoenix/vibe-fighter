import { test, expect, type Page } from "@playwright/test";
import { keys, pump, ready as harnessReady, waitForMatch } from "./harness";
// The REAL table, not a second copy of it. This spec used to hardcode `0.85` for hard, and re-tuning
// the CPU moved that number — a spec asserting a stale literal fails for the wrong reason and teaches
// you to edit the number rather than ask why it moved. `src/sim/` is Phaser-free, so importing it here
// costs nothing (phase09-characters.spec.ts imports the anim-timing rule for the same reason).
import { DAMAGE_SCALE } from "../src/sim/cpu";

/** Enters through the real select screen, so it waits on the FLOW, not on a world. */
const ready = (page: Page): Promise<void> =>
  harnessReady(page, { needs: ["__game", "__flow"] });

// The CPU difficulty handicap, checked through the REAL menu flow rather than the sim.
// sim/cpu.test.ts already proves the knobs and the damageScale arithmetic; what only a browser can
// prove is that MatchScene actually applies DAMAGE_SCALE to the CPU fighter and picks the difficulty
// the mode card selected. Two runs, same fighters, same seed, no human input at all — only the
// difficulty differs, so any health gap is the handicap plus the behaviour knobs doing their job.
//
// Same Phaser constraints as every other spec: headless Chromium throttles RAF and trusted keys
// never reach Phaser, so the spec stops the loop, pumps game.step() itself and drives the menu
// through the DEV __flow.press seam. Presses are batched into one page.evaluate.

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Outcome { scale: number; health: number; max: number }

const outcome = (page: Page): Promise<Outcome> =>
  page.evaluate(() => {
    const w = (window as any).__world;
    return {
      scale: w.fighters[1].damageScale as number,
      health: w.fighters[0].health as number,
      max: w.fighters[0].cfg.stats.maxHealth as number,
    };
  });

/** Pump with NO player input: past the intro gate (INTRO_TICKS=90) and ~3 s of standing still.
 *  Deliberately short — every pumped frame is a real render, and sim/cpu.test.ts already owns the
 *  long-run balance questions. What only the browser can show is the wiring. */
async function idle(page: Page): Promise<Outcome> {
  await pump(page, 280);
  return outcome(page);
}

/** Re-enter the match with a different difficulty WITHOUT a second page load. A cold boot pulls the
 *  whole sprite/stage/portrait set; doing that twice in one spec starved the other parallel workers
 *  and timed them out. MatchScene.init merges this over its default, which is the same door the
 *  flow uses. */
async function restartAs(page: Page, difficulty: string, expectScale: number): Promise<void> {
  await page.evaluate((d) => {
    (window as any).__world = null;
    (window as any).__game.scene.start("Match", {
      mode: "cpu",
      difficulty: d,
      stageId: "twilight",
      fighters: ["brawler", "jiujitsu"],
    });
  }, difficulty);
  for (let i = 0; i < 240; i += 20) {
    await pump(page, 20);
    const w = await page.evaluate(() => (window as any).__world?.fighters[1].damageScale ?? null);
    if (w === expectScale) return;
  }
  throw new Error(`the ${difficulty} match never started`);
}

test.describe("CPU difficulty handicap", () => {
  test("the mode card's difficulty reaches the CPU fighter, and hard hits harder", async ({ page }) => {
    // Two matches and ~560 pumped frames on top of the usual cold boot: ~30 s alone, and the
    // suite-wide 60 s is a boot-cost budget that assumes a spec BODY is ~free. This one isn't —
    // every pumped frame is a real render — so it gets the 3x slow budget rather than stealing
    // headroom the other specs need under parallel workers.
    test.slow();
    await ready(page);
    // This spec compares two runs, so both must use the SAME PAIR — but only the hard run boots an
    // explicit pair (restartAs). The easy run comes through the real select screen, where Phase 16's
    // CPU now draws uniformly over the untaken cards, so unseeded it would sometimes field the monk
    // against the hard run's jiujitsu and compare two different fighters' health. Seed 2 -> card 1.
    await page.evaluate(() => (window as any).__flow.seed(2));
    // ENTER title; RIGHT picks the "CPU · EASY" card; ENTER mode; ENTER stage; ENTER locks P1 —
    // in CPU mode the opponent card locks itself.
    const state = await keys(page, ["enter", "right", "enter", "enter", "enter"]);
    expect(state.modeIndex).toBe(1);
    await waitForMatch(page);
    // Assert the premise rather than trusting it: if the seed ever stops landing here, this fails
    // loudly instead of quietly comparing a monk run against a jiujitsu one.
    expect(await page.evaluate(() => (window as any).__world.fighters.map((f: any) => f.cfg.id)))
      .toEqual(["brawler", "jiujitsu"]);

    const easy = await idle(page);
    await restartAs(page, "hard", DAMAGE_SCALE.hard);
    const hard = await idle(page);

    // 1. The mode card's difficulty reached the CPU fighter at all.
    expect(easy.scale).toBeCloseTo(DAMAGE_SCALE.easy, 5);
    expect(hard.scale).toBeCloseTo(DAMAGE_SCALE.hard, 5);

    // 2. Hard is live and its scaled damage really reaches the player's health.
    expect(hard.health).toBeLessThan(hard.max);

    // 3. The player never pressed a key in either run and easy had the same window: it must not
    //    have taken more punishment than hard. (How MUCH easier over a full round is a balance
    //    question, and sim/cpu.test.ts owns it — this only proves the difficulty is plumbed.)
    expect(easy.health).toBeGreaterThanOrEqual(hard.health);
  });

  // The tier ordering, measured in a REAL browser against a player who actually fights back.
  //
  // Deliberately NOT a liveness check. "The match did not stall" passes for a CPU that does nothing at
  // all — the round timer ends every round regardless — so the assertions here are behavioural: how
  // much of the player's health each tier takes, and how many attacks each one starts.
  test("a competent player takes more punishment as the difficulty rises", async ({ page }) => {
    test.slow();
    await ready(page);

    /**
     * Drive P1 with a competent pattern for `frames` and report what the CPU did to them.
     *
     * The pattern mirrors sim/cpu.test.ts's ScriptedHuman: walk in, poke on a cadence, and guard the
     * CPU's attacks after a reaction delay. The delay is 6, not 12, and it is DERIVED: 12 lands after
     * the last active frame of every normal in the roster, so the guard never connected once — the
     * sim-side twin of this driver reached `blockstun` ZERO times in 48 matches and its win rate was
     * identical at 6/12/18/30. 6 puts guard up on frame 7, which beats every heavy's 9-frame startup
     * and misses every light's 4-frame one. `blocked` is returned so the assertions can check the
     * guard actually CONNECTS rather than trusting that it was pressed; pressing was never the problem. Everything runs inside ONE page.evaluate because
     * `game.loop.now` freezes after `loop.stop()`, so the pumping clock has to be a local accumulator.
     *
     * `__holdP1` is shallow-MERGED over the real reader output every frame, so a press flag left set
     * would re-fire its edge on every single frame. Each frame therefore writes a fresh object and the
     * press frames are one frame long — the same rule phase15-special.spec.ts follows.
     */
    const drive = (frames: number): Promise<{ playerLost: number; cpuAttacks: number; blocked: number }> =>
      page.evaluate((n) => {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const win = window as any;
        const g = win.__game;
        const w = win.__world;
        const d = 1000 / 60;
        let t = g.loop.now;
        const startHealth = w.fighters[0].health;
        const ATTACKS = new Set([
          "attackLight", "attackHeavy", "airLight", "airHeavy", "crouchLight", "crouchHeavy", "special",
        ]);
        let cpuAttacks = 0;
        let wasAttacking = false;
        let sawAttackFor = 0;
        let blocked = 0;
        let wasBlockstun = false;

        for (let i = 0; i < n; i++) {
          const me = w.fighters[0];
          const foe = w.fighters[1];
          const dist = Math.abs(foe.x - me.x);
          const foeAttacking = ATTACKS.has(foe.state);
          sawAttackFor = foeAttacking ? sawAttackFor + 1 : 0;

          const hold: Record<string, boolean> = {};
          if (sawAttackFor > 6 && dist < 200) {
            hold.block = true; // 6 => guard up on frame 7: beats a 9-frame heavy startup, not a 4-frame light
          } else if (dist > 110) {
            hold.right = true;
          } else if (i % 20 === 0) {
            hold.light = true;
            hold.lightPressed = true;
          }
          win.__holdP1(hold);
          t += d;
          g.step(t, d);

          const now = ATTACKS.has(w.fighters[1].state);
          if (now && !wasAttacking) cpuAttacks++;
          wasAttacking = now;
          const bs = w.fighters[0].state === "blockstun";
          if (bs && !wasBlockstun) blocked++;
          wasBlockstun = bs;
        }
        win.__holdP1({});
        return { playerLost: startHealth - w.fighters[0].health, cpuAttacks, blocked };
      }, frames);

    await page.evaluate(() => (window as any).__flow.seed(2));
    await keys(page, ["enter", "right", "enter", "enter", "enter"]);
    await waitForMatch(page);
    await pump(page, 100); // clear the intro gate
    const easy = await drive(500);

    await restartAs(page, "normal", DAMAGE_SCALE.normal);
    await pump(page, 100);
    const normal = await drive(500);

    await restartAs(page, "hard", DAMAGE_SCALE.hard);
    await pump(page, 100);
    const hard = await drive(500);

    // Ordering, not absolute numbers — the balance question belongs to sim/cpu.test.ts, which measures
    // it over 48 held-out seeds. What only the browser can answer is whether the whole chain (mode
    // card -> MatchScene -> CpuController -> InputReader merge -> sim) really produces a harder
    // opponent when you ask for one.
    expect(hard.playerLost, `easy took ${easy.playerLost}, hard took ${hard.playerLost}`)
      .toBeGreaterThan(easy.playerLost);
    expect(normal.playerLost).toBeGreaterThanOrEqual(easy.playerLost);
    // The driver's guard has to actually connect, or "a competent player" is a walking punching bag and
    // every ordering above is measured against the wrong opponent. This is the browser-side twin of the
    // harness-soundness check in sim/cpu.test.ts, and it is the assertion whose absence let the sim
    // proxy ship with a purely decorative block for a whole phase.
    expect(hard.blocked, `the player guarded ${hard.blocked} of hard's ${hard.cpuAttacks} attacks`)
      .toBeGreaterThan(0);
    // ...and it is doing it by ATTACKING more, not by standing still and winning on the clock.
    expect(hard.cpuAttacks, `easy started ${easy.cpuAttacks} attacks, hard ${hard.cpuAttacks}`)
      .toBeGreaterThan(easy.cpuAttacks);
  });
});
