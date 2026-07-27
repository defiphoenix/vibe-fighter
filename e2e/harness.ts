import { expect, type Page } from "@playwright/test";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Shared driving helpers for the Phase 16 parity spec.
//
// Every older spec re-declares its own copies of these. That duplication is not worth unpicking
// inside a QA gate — a refactor touching all 14 specs is exactly the change most likely to produce a
// "new spec broke three unrelated ones" result — so this module is imported ONLY by the new spec, and
// retrofitting the rest is left as follow-up work.
//
// The constraints they encode (all from CLAUDE.md, all learned the expensive way):
//  - headless Chromium throttles RAF, so the spec stops Phaser's loop and pumps `game.step` itself;
//  - `game.loop.now` FREEZES after `loop.stop()`, so anything timing-sensitive must keep its own
//    accumulating `t` inside ONE page.evaluate rather than re-reading it per call;
//  - trusted key events never reach Phaser headless, so input goes through the DEV seams;
//  - `scene.start` is QUEUED, so "wait for the match" is a bounded pump loop, never one more frame.
//    Note what does NOT happen here: the lock-in flash is a TWEEN, and tweens run on the wall clock
//    (`TweenManager.getDelta()` reads `Date.now()`), so it does not advance under the pump at all.
//    `waitForMatch` works because FlowScene sequences the CPU beat and the match start off
//    `time.delayedCall`, which IS delta-driven — not because the flash finishes.

export async function ready(page: Page, query = ""): Promise<void> {
  await page.goto(`/${query}`);
  await page.waitForFunction(
    () => (window as any).__game != null && ((window as any).__flow != null || (window as any).__world != null),
    null,
    { timeout: 30_000 },
  );
  await page.evaluate(() => (window as any).__game.loop.stop());
}

export async function pump(page: Page, frames: number, deltaMs = 1000 / 60): Promise<void> {
  await page.evaluate(({ n, d }) => {
    const g = (window as any).__game;
    let t = g.loop?.now ?? performance.now();
    for (let i = 0; i < n; i++) { t += d; g.step(t, d); }
  }, { n: frames, d: deltaMs });
}

/** Send a whole key sequence in ONE round trip, pumping a frame between presses. */
export async function keys(page: Page, seq: string[]): Promise<any> {
  return page.evaluate((names) => {
    const w = window as any;
    let t = w.__game.loop?.now ?? performance.now();
    const step = () => { t += 1000 / 60; w.__game.step(t, 1000 / 60); };
    for (const name of names) {
      w.__flow.press(name);
      step();
    }
    return w.__flow.state();
  }, seq);
}

/** Pump until the match scene has published its world (covers the flash tween + queued start). */
export async function waitForMatch(page: Page, maxFrames = 240): Promise<void> {
  for (let i = 0; i < maxFrames; i += 20) {
    await pump(page, 20);
    if (await page.evaluate(() => (window as any).__world != null)) return;
  }
  throw new Error("match never started");
}

/** Pin the CPU's character pick. Seed 1 -> monk, seed 2 -> jiujitsu (see roll.test.ts). */
export async function seedFlow(page: Page, seed: number): Promise<void> {
  await page.evaluate((n) => (window as any).__flow.seed(n), seed);
}

/**
 * Walk the real select screen to a match: 1v1, the given stage, and P1 parked on `p1Card`.
 *
 * Cursors start [0, 1], so stepping P1 right once SWAPS onto card 1 and pushes P2 to card 0; a second
 * step takes the (now free) card 2. That is the roster rule, not an accident of this helper.
 */
export async function driveTo1v1(page: Page, p1Card: 0 | 1 | 2, stageIndex: 0 | 1 = 0): Promise<any> {
  const seq = [
    "enter", "enter",                                    // title, mode (1v1 is card 0)
    ...(stageIndex === 1 ? ["right"] : []), "enter",      // stage
    ...Array.from({ length: p1Card }, () => "d"),         // P1 to its card
    "f", "comma",                                        // both lock
  ];
  const state = await keys(page, seq);
  expect(state.locked).toEqual([true, true]);
  await waitForMatch(page);
  return state;
}
