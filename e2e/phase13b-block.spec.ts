import { test, expect, type Page } from "@playwright/test";

// Acceptance for Phase 13b — the dedicated held-guard states, measured through the REAL running game
// (real input seams -> real World -> real sprites), not the sim in isolation:
//  1. holding block (no down) plants the fighter in `block` and the block sheet settles into its braced
//     hold instead of looping back through a wind-up (loop:false, like crouch);
//  2. holding block + down plants it in `blockCrouch` with the low guard;
//  3. releasing block returns to idle.
// The render assertions are the point Codex flagged: a passing sim state does not prove the block ART
// is on screen. Same Phaser gotchas as the other specs (stop the RAF loop, pump game.step, drive the
// DEV __holdP1 seam).

/* eslint-disable @typescript-eslint/no-explicit-any */
async function ready(page: Page): Promise<void> {
  await page.goto("/?scene=match");
  await page.waitForFunction(
    () => {
      const w = window as any;
      return w.__sprites?.length === 2 && w.__world != null && w.__game != null && w.__holdP1 != null;
    },
    null,
    { timeout: 30_000 },
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

/** Hold `input` on P1 through the intro gate, let the held-guard animation settle, and report both the
 *  sim state (+ whether a guard box is live) and the P1 sprite's animation. */
async function guardSnapshot(page: Page, input: Record<string, boolean>): Promise<{
  state: string; guardBoxes: number; key: string; playing: boolean; progress: number;
  frameIndex: number; total: number;
}> {
  await ready(page);
  await pump(page, 100); // clear the intro gate (INTRO_TICKS = 90)
  await page.evaluate((i) => (window as any).__holdP1(i), input);
  await pump(page, 40); // block sheet is 4 frames @ 8fps = 0.5s (~30 ticks) then holds

  return page.evaluate(() => {
    const w = window as any;
    const f = w.__world.fighters[0];
    const s = w.__sprites[0];
    return {
      state: f.state as string,
      guardBoxes: (f.activeBoxes().guard.length as number),
      key: s.anims.currentAnim?.key as string,
      playing: s.anims.isPlaying as boolean,
      progress: s.anims.getProgress() as number,
      frameIndex: s.anims.currentFrame?.index as number,
      total: s.anims.getTotalFrames() as number,
    };
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

test.slow(); // boot pulls the whole asset set; each case re-boots

test("holding block plants in `block` and the block art holds its braced pose", async ({ page }) => {
  const s = await guardSnapshot(page, { block: true });
  // sim: high guard state with a live guard box
  expect(s.state).toBe("block");
  expect(s.guardBoxes).toBeGreaterThan(0);
  // render: the block sheet is actually on screen and, being loop:false, has settled on its last frame
  expect(s.key).toBe("brawler-block");
  expect(s.playing).toBe(false);
  expect(s.progress).toBe(1);
  expect(s.frameIndex).toBe(s.total); // AnimationFrame.index is 1-based
});

test("holding block + down plants in `blockCrouch` and the low-block art holds", async ({ page }) => {
  const s = await guardSnapshot(page, { block: true, down: true });
  expect(s.state).toBe("blockCrouch");
  expect(s.guardBoxes).toBeGreaterThan(0);
  expect(s.key).toBe("brawler-blockCrouch");
  expect(s.playing).toBe(false);
  expect(s.progress).toBe(1);
  expect(s.frameIndex).toBe(s.total);
});

test("releasing block returns to idle", async ({ page }) => {
  await ready(page);
  await pump(page, 100);
  await page.evaluate(() => (window as any).__holdP1({ block: true })); // eslint-disable-line @typescript-eslint/no-explicit-any
  await pump(page, 20);
  await page.evaluate(() => (window as any).__holdP1({})); // eslint-disable-line @typescript-eslint/no-explicit-any
  await pump(page, 5);
  const state = await page.evaluate(() => (window as any).__world.fighters[0].state); // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(state).toBe("idle");
});
