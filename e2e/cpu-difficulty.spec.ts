import { test, expect, type Page } from "@playwright/test";

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

async function ready(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__flow != null && (window as any).__game != null, null, {
    timeout: 30_000,
  });
  await page.evaluate(() => (window as any).__game.loop.stop());
}

async function pump(page: Page, frames: number, deltaMs = 1000 / 60): Promise<void> {
  await page.evaluate(({ n, d }) => {
    const g = (window as any).__game;
    let t = g.loop?.now ?? performance.now();
    for (let i = 0; i < n; i++) { t += d; g.step(t, d); }
  }, { n: frames, d: deltaMs });
}

async function keys(page: Page, seq: string[]): Promise<any> {
  return page.evaluate((names) => {
    const w = window as any;
    let t = w.__game.loop?.now ?? performance.now();
    const step = () => { t += 1000 / 60; w.__game.step(t, 1000 / 60); };
    for (const name of names) { w.__flow.press(name); step(); }
    return w.__flow.state();
  }, seq);
}

async function waitForMatch(page: Page, maxFrames = 240): Promise<void> {
  for (let i = 0; i < maxFrames; i += 20) {
    await pump(page, 20);
    if (await page.evaluate(() => (window as any).__world != null)) return;
  }
  throw new Error("match never started");
}

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
    await restartAs(page, "hard", 0.85);
    const hard = await idle(page);

    // 1. The mode card's difficulty reached the CPU fighter at all.
    expect(easy.scale).toBeCloseTo(0.55, 5);
    expect(hard.scale).toBeCloseTo(0.85, 5);

    // 2. Hard is live and its scaled damage really reaches the player's health.
    expect(hard.health).toBeLessThan(hard.max);

    // 3. The player never pressed a key in either run and easy had the same window: it must not
    //    have taken more punishment than hard. (How MUCH easier over a full round is a balance
    //    question, and sim/cpu.test.ts owns it — this only proves the difficulty is plumbed.)
    expect(easy.health).toBeGreaterThanOrEqual(hard.health);
  });
});
