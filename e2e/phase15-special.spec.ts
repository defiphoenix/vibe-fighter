import { test, expect, type Page } from "@playwright/test";

// Acceptance for Phase 15 — meter, the multi-hit special and the super cut-in, measured through the
// REAL running game (real input seams -> real World -> real sprites/HUD), not the sim in isolation.
// The sim tests already pin the hit COUNT arithmetic; what only the browser can prove is that the
// meter reaches the HUD, that `E` reaches the fighter through the whole adapter path, and that the
// cut-in is on screen while the world is frozen.
//
// Same Phaser gotchas as every other spec: stop the RAF loop and pump `game.step` as the sole clock,
// drive input through the DEV seam (trusted keys don't reach Phaser headless), and feed a 1-frame
// edge per press because `__holdP1` FORCES the pressed flag true every frame while the real reader
// emits a rising edge. The scripted sequences run inside ONE page.evaluate — a spec that alternates
// hold/pump/read dozens of times grazes the timeout and goes flaky.

/* eslint-disable @typescript-eslint/no-explicit-any */
async function ready(page: Page): Promise<void> {
  await page.goto("/?scene=match");
  await page.waitForFunction(
    () => {
      const w = window as any;
      return w.__sprites?.length === 2 && w.__world != null && w.__game != null && w.__holdP1 != null && w.__cutIn != null;
    },
    null,
    { timeout: 30_000 },
  );
  await page.evaluate(() => (window as any).__game.loop.stop());
}

test.slow(); // boot pulls the whole asset set; each case re-boots

test.describe("Phase 15 — meter, multi-hit special, cut-in", () => {
  test("the meter fills from real combat and reaches the HUD", async ({ page }) => {
    await ready(page);
    const r = await page.evaluate(() => {
      const w = window as any;
      const g = w.__game;
      let t = g.loop?.now ?? performance.now();
      const d = 1000 / 60;
      const step = (n: number) => { for (let i = 0; i < n; i++) { t += d; g.step(t, d); } };

      step(100); // clear the intro gate (INTRO_TICKS = 90)
      w.__world.fighters[0].reset(700 - 45, 1);
      w.__world.fighters[1].reset(700 + 45, -1);
      step(1);
      const before = { meter: w.__world.fighters[0].meter, hud: w.__hud().meter[0].w };

      // ONE frame of the pressed flag = one rising edge = one light.
      w.__holdP1({ light: true, lightPressed: true });
      step(1);
      w.__holdP1({});
      step(40);

      const f = w.__world.fighters;
      return {
        before,
        attacker: f[0].meter as number,
        defender: f[1].meter as number,
        hud: w.__hud().meter as { w: number; max: number }[],
      };
    });

    expect(r.before.meter).toBe(0);
    expect(r.before.hud).toBe(0);
    // Attacker banks the damage it dealt; being hit pays nothing (a BLOCK is what pays the defender).
    expect(r.attacker).toBeGreaterThan(0);
    expect(r.defender).toBe(0);
    // ...and the HUD is actually DRAWING it: `lastMeter` is recorded only after the fillRect runs, so
    // deleting the draw takes this to 0 rather than leaving a green test over an invisible bar.
    expect(r.hud[0].w).toBeGreaterThan(0);
    expect(r.hud[0].w).toBeLessThan(r.hud[0].max);
  });

  // NOTE: this drives the DEV seam, which injects `specialPressed` AFTER InputReader — so it proves the
  // latch -> sim plumbing and the meter gate, NOT that P1's key is physically `E`. Trusted keyboard
  // events do not reach Phaser headless, which is why every spec in this repo works this way; the
  // binding table itself is only guarded by review.
  test("the special edge fires only on a full bar, and spends it", async ({ page }) => {
    await ready(page);
    const r = await page.evaluate(() => {
      const w = window as any;
      const g = w.__game;
      let t = g.loop?.now ?? performance.now();
      const d = 1000 / 60;
      const step = (n: number) => { for (let i = 0; i < n; i++) { t += d; g.step(t, d); } };
      const pressSpecial = () => { w.__holdP1({ special: true, specialPressed: true }); step(1); w.__holdP1({}); };

      step(100);
      // Empty bar: the press must do nothing AND must not stay latched (a buffered press would fire
      // itself the instant the meter filled, which reads as the special going off on its own).
      w.__world.fighters[0].meter = 0;
      pressSpecial();
      step(5);
      const empty = w.__world.fighters[0].state as string;

      w.__world.fighters[0].meter = 100;
      step(30); // let the latch settle; if the refused edge were still buffered it fires HERE
      const beforeFull = w.__world.fighters[0].state as string;

      pressSpecial();
      step(2);
      return {
        empty,
        beforeFull,
        state: w.__world.fighters[0].state as string,
        meter: w.__world.fighters[0].meter as number,
      };
    });

    expect(r.empty).not.toBe("special");
    expect(r.beforeFull).not.toBe("special"); // the refused edge did NOT linger
    expect(r.state).toBe("special");
    expect(r.meter).toBe(0); // spends the whole bar
  });

  test("the special freezes the world and plays the cut-in over it", async ({ page }) => {
    await ready(page);
    const r = await page.evaluate(() => {
      const w = window as any;
      const g = w.__game;
      let t = g.loop?.now ?? performance.now();
      const d = 1000 / 60;
      const step = (n: number) => { for (let i = 0; i < n; i++) { t += d; g.step(t, d); } };

      step(100);
      w.__world.fighters[0].meter = 100;
      w.__holdP1({ special: true, specialPressed: true });
      step(1);
      w.__holdP1({});
      step(1);

      const frozen = w.__world.hitstop as number;
      const armed = w.__cutIn();
      const id = w.__world.fighters[0].cfg.id as string;
      // Mid-freeze the portrait should be parked on screen at full opacity...
      step(Math.floor(frozen / 2));
      const mid = w.__cutIn();
      const stillFrozen = w.__world.hitstop as number;
      // ...and gone once the world is moving again.
      step(frozen);
      return { frozen, armed, mid, stillFrozen, after: w.__cutIn(), id };
    });

    expect(r.frozen).toBeGreaterThan(0); // the super freeze really stopped the fight
    expect(r.armed.key).toBe(`portrait-${r.id}`); // the Phase 06 select portrait, per the source video
    expect(r.mid.playing).toBe(true);
    expect(r.mid.alpha).toBeGreaterThan(0.8);
    expect(r.stillFrozen).toBeGreaterThan(0);
    expect(r.after.playing).toBe(false); // self-clearing: it cannot outlive its freeze
  });

  // `MatchScene.rematch()` is the one path that stops the cut-in, and everything else about the
  // meter/cut-in lifecycle was only ever proved at the sim level. A cut-in that survived a rematch
  // would sit over the fresh round's intro.
  test("a rematch clears the cut-in and zeroes both meters", async ({ page }) => {
    await ready(page);
    const r = await page.evaluate(() => {
      const w = window as any;
      const g = w.__game;
      let t = g.loop?.now ?? performance.now();
      const d = 1000 / 60;
      const step = (n: number) => { for (let i = 0; i < n; i++) { t += d; g.step(t, d); } };

      step(100);
      w.__world.fighters[0].meter = 100;
      w.__world.fighters[1].meter = 60;
      w.__holdP1({ special: true, specialPressed: true });
      step(1);
      w.__holdP1({});
      step(2);
      const during = w.__cutIn();

      // Restart mid-freeze — the harshest moment for a self-clearing animation.
      w.__world.restart();
      (w.__game.scene.getScene("Match") as any).rematch?.();
      step(3);
      return {
        during,
        after: w.__cutIn(),
        meters: [w.__world.fighters[0].meter, w.__world.fighters[1].meter] as number[],
        hitstop: w.__world.hitstop as number,
      };
    });

    expect(r.during.playing).toBe(true);
    expect(r.after.playing).toBe(false); // no portrait left hanging over the new round
    expect(r.meters).toEqual([0, 0]); // a fresh match starts on an empty bar
    expect(r.hitstop).toBe(0);
  });

  test("one special animation lands several hits on a live opponent", async ({ page }) => {
    await ready(page);
    const r = await page.evaluate(() => {
      const w = window as any;
      const g = w.__game;
      let t = g.loop?.now ?? performance.now();
      const d = 1000 / 60;
      const step = (n: number) => { for (let i = 0; i < n; i++) { t += d; g.step(t, d); } };

      step(100);
      w.__world.fighters[0].reset(700 - 45, 1);
      w.__world.fighters[1].reset(700 + 45, -1);
      w.__world.fighters[0].meter = 100;
      step(1);
      const startHealth = w.__world.fighters[1].health as number;

      w.__holdP1({ special: true, specialPressed: true });
      step(1);
      w.__holdP1({});

      // Count `hit` events as they are drained by the scene — reading them back off the combo tally,
      // which is the persistent per-defender counter the HUD-side code keeps.
      let peakCombo = 0;
      for (let i = 0; i < 240; i++) {
        step(1);
        peakCombo = Math.max(peakCombo, w.__combo()[1] as number);
      }
      return {
        peakCombo,
        damage: startHealth - (w.__world.fighters[1].health as number),
        windows: w.__world.fighters[0].cfg.attacks.special.repeat.count as number,
      };
    });

    // THE acceptance criterion: a single animation, a deterministic N > 1.
    expect(r.windows).toBeGreaterThan(1);
    expect(r.peakCombo).toBe(r.windows);
    expect(r.damage).toBeGreaterThan(0);
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
