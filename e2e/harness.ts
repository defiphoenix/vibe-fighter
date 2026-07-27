import { expect, type Page } from "@playwright/test";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Shared driving helpers for the browser specs.
//
// Every spec used to re-declare its own `ready`/`pump`/`keys`, which is 14 copies of the same four
// constraints — and 14 places to get them wrong. The constraints (all from CLAUDE.md, all learned
// expensively):
//
//  - headless Chromium throttles RAF and reports the page hidden, so a spec stops Phaser's loop and
//    pumps `game.step` itself as the sole clock;
//  - `game.loop.now` FREEZES after `loop.stop()`, so anything timing-sensitive must keep its own
//    accumulating `t` inside ONE page.evaluate rather than re-reading it per call;
//  - trusted key events never reach Phaser headless, so input goes through the DEV seams;
//  - `scene.start` is QUEUED, so "wait for the scene" is a bounded pump loop, never one more frame.
//    Note what does NOT happen: the lock-in flash is a TWEEN, and tweens run on the wall clock
//    (`TweenManager.getDelta()` reads `Date.now()`), so it does not advance under the pump at all.
//    `waitForMatch` works because FlowScene sequences the CPU beat and the match start off
//    `time.delayedCall`, which IS delta-driven — not because the flash finishes.

/** DEV-only routes. `/` boots the MENU; a spec that wants a match must ask for one. */
export const MATCH = "?scene=match";
export const PLAYGROUND = "?scene=playground";
export const GYM = "?scene=gym";
export const PREVIEW = "?scene=preview";

export interface ReadyOpts {
  /** Query string, e.g. `MATCH`. Empty boots the flow. */
  route?: string;
  /**
   * DEV globals that must exist before the spec may drive anything. Each scene publishes its own set
   * and publishes them at different points in `create()`, so waiting on the wrong one is how a spec
   * ends up driving a half-built scene. `__sprites` additionally has to have BOTH fighters.
   */
  needs?: string[];
}

/**
 * Boot the page and hand back a stopped loop.
 *
 * The 30s timeout is a BOOT budget, not an assertion budget: a cold boot pulls the whole
 * sprite/stage/portrait set through one dev server, and up to 4 workers contend for it. A failure
 * inside here means boot cost, not a broken assertion.
 */
export async function ready(page: Page, opts: ReadyOpts = {}): Promise<void> {
  const { route = "", needs = ["__game", "__world"] } = opts;
  await page.goto(`/${route}`);
  await page.waitForFunction(
    (names: string[]) => {
      const w = window as any;
      return names.every((n) => (n === "__sprites" ? w.__sprites?.length === 2 : w[n] != null));
    },
    needs,
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

/** A real key press: down, a few frames so update() sees the rising edge, then up. */
export async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await pump(page, 4);
  await page.keyboard.up(key);
  await pump(page, 4);
}

/**
 * Pump until a DEV global appears (covers a queued `scene.start` + its `delayedCall` beats).
 *
 * Checks BEFORE each step and runs the whole loop inside ONE page.evaluate, so it spends the minimum
 * number of frames and one round trip. Both matter: the 20-frame-chunk version this replaces
 * routinely overshot by ~20 ticks, which is invisible until a spec tries to measure something the
 * overshoot has already consumed — it made a test that counts INTRO_TICKS read 70 instead of 90.
 */
export async function pumpUntil(page: Page, name: string, maxFrames = 240): Promise<number> {
  const spent = await page.evaluate(({ n, max }) => {
    const w = window as any, g = w.__game;
    let t = g.loop?.now ?? performance.now();
    for (let i = 0; i < max; i++) {
      if (w[n] != null) return i;
      t += 1000 / 60;
      g.step(t, 1000 / 60);
    }
    return w[n] != null ? max : -1;
  }, { n: name, max: maxFrames });
  if (spent < 0) throw new Error(`${name} never appeared after ${maxFrames} pumped frames`);
  return spent;
}

export const waitForMatch = async (page: Page, maxFrames = 240): Promise<void> => {
  await pumpUntil(page, "__world", maxFrames);
};

// --- scene transitions on an ALREADY-BOOTED page ------------------------------------------------
//
// `page.goto` re-boots the entire asset set. Under 4 workers sharing one dev server that is by far
// the most expensive thing a spec does — the same measurement `cpu-difficulty.spec.ts` records for
// its own second match. These restart the scene INSIDE the live game instead, which costs a few
// pumped frames, and are what let one spec file run many cases off a single boot.

/** Return to the character-select flow without reloading the page. */
export async function toFlow(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    w.__world = null; // MatchScene deletes its own on SHUTDOWN, but be explicit about the handover
    w.__game.scene.start("Flow");
  });
  await pumpUntil(page, "__flow");
}

/** Pin the CPU's character pick. Seed 1 -> monk, seed 2 -> jiujitsu (see src/scenes/roll.test.ts). */
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

