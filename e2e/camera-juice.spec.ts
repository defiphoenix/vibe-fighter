import { test, expect, type Page } from "@playwright/test";

// A1 acceptance: the sim's drained hit/ko events drive camera juice (render-only, no sim coupling).
// A `hit` shakes the camera; a `ko` flashes AND forces a stronger shake that overrides the
// same-batch hit shake (Shake.start bails while running unless force=true). We pump game.step()
// ourselves — deterministic, no wall-clock waits — and read the effect state off __stage.cam.

/* eslint-disable @typescript-eslint/no-explicit-any */
async function ready(page: Page): Promise<void> {
  await page.goto("/?scene=match");
  await page.waitForFunction(
    () => {
      const w = window as any;
      return w.__sprites?.length === 2 && w.__world != null && w.__game != null && w.__stage != null;
    },
    null,
    { timeout: 30_000 }, // boot pulls the whole sprite+stage+portrait set; workers contend on a cold dev server
  );
  await page.evaluate(() => (window as any).__game.loop.stop());
}

async function pump(page: Page, frames: number): Promise<void> {
  await page.evaluate((n) => {
    const g = (window as any).__game;
    let t = g.loop?.now ?? performance.now();
    const d = 1000 / 60;
    for (let i = 0; i < n; i++) { t += d; g.step(t, d); }
  }, frames);
}

// Put both fighters in light-attack range and drop into the fight phase immediately.
async function engage(page: Page, oppHealth?: number): Promise<void> {
  await page.evaluate((hp) => {
    const w = window as any;
    w.__world.match.phase = "fight";
    w.__world.match.introTicks = 0;
    w.__world.fighters[0].reset(700, 1);
    w.__world.fighters[1].reset(760, -1);
    if (hp !== undefined) w.__world.fighters[1].health = hp;
  }, oppHealth);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

test("a hit triggers a camera shake (hit-tier, not KO)", async ({ page }) => {
  await ready(page);
  await engage(page);
  await page.evaluate(() => (window as any).__holdP1({ light: true, lightPressed: true })); // eslint-disable-line @typescript-eslint/no-explicit-any

  let shake: { dur: number; ix: number } | null = null;
  for (let i = 0; i < 16; i++) {
    await pump(page, 1);
    const st = await page.evaluate(() => {
      const c = (window as any).__stage.cam; // eslint-disable-line @typescript-eslint/no-explicit-any
      return { running: c.shakeEffect.isRunning as boolean, dur: c.shakeEffect.duration as number, ix: c.shakeEffect.intensity.x as number };
    });
    if (st.running) { shake = { dur: st.dur, ix: st.ix }; break; }
  }
  await page.evaluate(() => (window as any).__holdP1({})); // eslint-disable-line @typescript-eslint/no-explicit-any

  expect(shake, "expected a camera shake after the hit connected").not.toBeNull();
  expect(shake!.dur).toBe(120); // HIT_SHAKE_MS — the hit-tier shake, not the 320ms KO shake
});

test("a KO flashes and FORCES its shake over one already running", async ({ page }) => {
  // The load-bearing case for force=true: a hit shake (120ms) started in an earlier update is still
  // running when the KO lands. Without force, Shake.start's `!force && isRunning` guard would drop
  // the KO shake. We keep a 120ms shake alive on the camera each frame (standing in for that earlier
  // hit) until the KO connects, then assert the running shake flips to the KO tier (320ms / 0.02).
  // Falsification check: delete the `true` at MatchScene.ts applyHitFeedback's KO shake → this fails
  // (dur stays 120) while the hit-tier test above still passes.
  await ready(page);
  await engage(page, 1); // 1 HP: the next light hit KOs
  await page.evaluate(() => (window as any).__holdP1({ light: true, lightPressed: true })); // eslint-disable-line @typescript-eslint/no-explicit-any

  let ko: { flash: boolean; dur: number; ix: number } | null = null;
  for (let i = 0; i < 16; i++) {
    // keep a non-KO shake running (no force → never restarts the KO shake once it wins)
    await page.evaluate(() => {
      const c = (window as any).__stage.cam; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!c.shakeEffect.isRunning) c.shake(120, 0.005);
    });
    await pump(page, 1);
    const st = await page.evaluate(() => {
      const c = (window as any).__stage.cam; // eslint-disable-line @typescript-eslint/no-explicit-any
      return { flash: c.flashEffect.isRunning as boolean, dur: c.shakeEffect.duration as number, ix: c.shakeEffect.intensity.x as number };
    });
    if (st.flash) { ko = st; break; }
  }
  await page.evaluate(() => (window as any).__holdP1({})); // eslint-disable-line @typescript-eslint/no-explicit-any

  expect(ko, "expected KO camera feedback").not.toBeNull();
  expect(ko!.flash).toBe(true);
  expect(ko!.dur).toBe(320); // KO_SHAKE_MS — forced over the 120ms shake that was still running
  expect(ko!.ix).toBeCloseTo(0.02, 6); // KO_SHAKE_INTENSITY
});
