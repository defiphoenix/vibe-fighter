import { test, expect, type Page } from "@playwright/test";

// Acceptance for the crouch / block / low-attack fix pass, measured through the REAL running game
// (real input seams → real World → real sprites), not through the sim in isolation:
//  1. holding down keeps the fighter crouched AND the crouch animation settles instead of looping
//     back through its standing wind-up frames (that loop was the whole "I can't stay crouched" bug);
//  2. blocking in the correct stance actually reduces damage to chip, at point-blank range;
//  3. high/low is still real: the CROUCH heavy beats a standing guard, and the ground heavy
//     (a standing punch) beats a crouching one.
// Same Phaser gotchas as the other specs: headless Chromium throttles RAF, so we stop the loop and
// pump game.step() ourselves, and drive input through the DEV __holdP1/__holdP2 seams.

/* eslint-disable @typescript-eslint/no-explicit-any */
async function ready(page: Page): Promise<void> {
  await page.goto("/?scene=match");
  await page.waitForFunction(
    () => {
      const w = window as any;
      return w.__sprites?.length === 2 && w.__world != null && w.__game != null && w.__holdP2 != null;
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

/** Drop straight into the fight phase with the fighters `gap` px apart. */
async function fight(page: Page, gap: number): Promise<void> {
  await page.evaluate((g) => {
    const w = window as any;
    w.__world.match.phase = "fight";
    w.__world.match.introTicks = 0;
    w.__world.fighters[0].reset(700 - g / 2, 1);
    w.__world.fighters[1].reset(700 + g / 2, -1);
    w.__holdP1({});
    w.__holdP2({});
  }, gap);
}

/** P1 throws one normal; P2 holds `guard` throughout. Returns damage dealt to P2. */
async function exchange(
  page: Page,
  attack: "light" | "heavy",
  low: boolean,
  guard: Record<string, boolean>,
  gap = 60,
): Promise<number> {
  await fight(page, gap);
  await page.evaluate((g) => (window as any).__holdP2(g), guard);
  const before = await page.evaluate(() => (window as any).__world.fighters[1].health);

  const press = attack === "light"
    ? { light: true, lightPressed: true, down: low }
    : { heavy: true, heavyPressed: true, down: low };
  // Hold the pressed EDGE for exactly ONE tick — that is what the real InputReader emits (a rising
  // edge, light && !wasDown). Holding it two ticks feeds a second edge, which the input buffer now
  // (correctly) turns into a second attack; real input never does.
  await page.evaluate((p) => (window as any).__holdP1(p), press);
  await pump(page, 1);
  await page.evaluate((l) => (window as any).__holdP1({ down: l }), low);
  await pump(page, 45); // longest normal is 32 ticks + 10 hitstop

  const after = await page.evaluate(() => (window as any).__world.fighters[1].health);
  await page.evaluate(() => { (window as any).__holdP1({}); (window as any).__holdP2({}); });
  return before - after;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

test("holding down keeps the fighter crouched and the crouch animation settles", async ({ page }) => {
  await ready(page);
  await pump(page, 100); // clear the intro gate (INTRO_TICKS = 90)

  await page.evaluate(() => (window as any).__holdP1({ down: true })); // eslint-disable-line @typescript-eslint/no-explicit-any
  await pump(page, 20);

  // sim side: the state must stay "crouch" for as long as down is held
  for (let i = 0; i < 6; i++) {
    await pump(page, 20);
    const state = await page.evaluate(() => (window as any).__world.fighters[0].state); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(state, `tick batch ${i}`).toBe("crouch");
  }

  // render side: the sheet's first frames are the fighter STANDING, so a looping crouch animation
  // visibly pops back up. Non-looping means it reaches the last frame and stops there.
  const anim = await page.evaluate(() => {
    const s = (window as any).__sprites[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    return {
      key: s.anims.currentAnim?.key as string,
      playing: s.anims.isPlaying as boolean,
      progress: s.anims.getProgress() as number,
      frameIndex: s.anims.currentFrame?.index as number,
      total: s.anims.getTotalFrames() as number,
    };
  });
  expect(anim.key).toBe("brawler-crouch");
  expect(anim.playing).toBe(false);
  expect(anim.progress).toBe(1);
  expect(anim.frameIndex).toBe(anim.total); // AnimationFrame.index is 1-based

  await page.evaluate(() => (window as any).__holdP1({})); // eslint-disable-line @typescript-eslint/no-explicit-any
});

test("standing block reduces a high to chip at point-blank range", async ({ page }) => {
  await ready(page);
  const raw = await exchange(page, "light", false, {});
  const blocked = await exchange(page, "light", false, { block: true });
  expect(raw).toBe(6); // brawler light damage
  expect(blocked).toBe(1); // chip only
});

test("the GROUND heavy is a high: standing guard chips it, crouching eats it", async ({ page }) => {
  // It used to be a low. The art is a standing straight punch (fist 113-126px above the feet on the
  // impact frame), so the sweep-height hit box that made it a low never matched the animation.
  await ready(page);
  const raw = await exchange(page, "heavy", false, {});
  const standBlocked = await exchange(page, "heavy", false, { block: true });
  const crouchBlocked = await exchange(page, "heavy", false, { block: true, down: true });
  expect(raw).toBe(15); // brawler heavy damage
  expect(standBlocked).toBe(3); // chip only
  expect(crouchBlocked).toBe(raw); // low guard loses to a high
});

test("a CROUCH heavy is the low: crouch guard chips it, standing eats it", async ({ page }) => {
  await ready(page);
  const raw = await exchange(page, "heavy", true, {});
  const crouchBlocked = await exchange(page, "heavy", true, { block: true, down: true });
  const standBlocked = await exchange(page, "heavy", true, { block: true });
  expect(raw).toBe(13); // brawler crouchHeavy damage
  expect(crouchBlocked).toBe(3); // chip only
  expect(standBlocked).toBe(raw); // high guard loses to a low
});

test("a buffered low still comes out low after down is released", async ({ page }) => {
  await ready(page);
  await fight(page, 90);
  // press down+light on a frozen (hitstop) frame so the edge has to be buffered, then let go of down
  await page.evaluate(() => {
    const w = window as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    w.__world.hitstop = 3;
    w.__holdP1({ down: true, light: true, lightPressed: true });
  });
  await pump(page, 1);
  await page.evaluate(() => (window as any).__holdP1({ down: false })); // eslint-disable-line @typescript-eslint/no-explicit-any
  await pump(page, 6);

  const state = await page.evaluate(() => (window as any).__world.fighters[0].state); // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(state).toBe("crouchLight");
  await page.evaluate(() => (window as any).__holdP1({})); // eslint-disable-line @typescript-eslint/no-explicit-any
});
