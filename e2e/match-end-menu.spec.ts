import { test, expect, type Page } from "@playwright/test";

// Phase 12 acceptance: the match-end screen offers a real choice instead of two undiscoverable keys.
//
// The behaviour that matters beyond "a menu appears": Enter still means the old thing everywhere
// except matchEnd (the Phase 11 quit-prompt spec presses it during intro), the selection resets to
// REMATCH on every ENTRY into matchEnd rather than once at scene init, and a rematch clears the
// input latch — Arrow-Up doubles as P2's jump, so navigating this menu latches a jump edge that
// matchEnd ticks never consume and which would otherwise fire into the new match.

/* eslint-disable @typescript-eslint/no-explicit-any */
async function ready(page: Page): Promise<void> {
  await page.goto("/?scene=match");
  await page.waitForFunction(
    () => {
      const w = window as any;
      return w.__world != null && w.__game != null && w.__endMenu != null;
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

async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await pump(page, 4);
  await page.keyboard.up(key);
  await pump(page, 4);
}

/** Win the match for real: P1 already has a round, P2 is one hit from dead, P1 throws a light. */
async function koTheMatch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    w.__world.match.phase = "fight";
    w.__world.match.introTicks = 0;
    w.__world.match.wins = [1, 0]; // match point
    w.__world.fighters[0].reset(700, 1);
    w.__world.fighters[1].reset(760, -1);
    w.__world.fighters[1].health = 1;
  });
  await page.evaluate(() => (window as any).__holdP1({ light: true, lightPressed: true }));
  await pump(page, 30);
  await page.evaluate(() => (window as any).__holdP1({}));
  await pump(page, 10);
}

const menu = (page: Page) => page.evaluate(() => (window as any).__endMenu());
const phase = (page: Page) => page.evaluate(() => (window as any).__world.match.phase as string);
/* eslint-enable @typescript-eslint/no-explicit-any */

test("a real KO opens the menu, arrows move the selection", async ({ page }) => {
  await ready(page);
  expect((await menu(page)).shown).toBe(false);

  await koTheMatch(page);
  expect(await phase(page)).toBe("matchEnd");
  const open = await menu(page);
  expect(open.shown).toBe(true);
  expect(open.sel).toBe(0); // defaults to REMATCH, so the old Enter reflex still does the old thing

  await press(page, "ArrowDown");
  expect((await menu(page)).sel).toBe(1);
  await press(page, "ArrowDown"); // wraps
  expect((await menu(page)).sel).toBe(0);
  await press(page, "ArrowUp");
  expect((await menu(page)).sel).toBe(1);
  await press(page, "KeyW"); // the winner should not have to reach across the keyboard
  expect((await menu(page)).sel).toBe(0);
});

test("Enter on REMATCH restarts the match and closes the menu", async ({ page }) => {
  await ready(page);
  await koTheMatch(page);
  expect((await menu(page)).sel).toBe(0);

  await press(page, "Enter");
  await pump(page, 4);
  expect(await phase(page)).toBe("intro");
  expect((await menu(page)).shown).toBe(false);
  const wins = await page.evaluate(() => (window as any).__world.match.wins as number[]); // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(wins).toEqual([0, 0]);
});

test("navigating the menu does not leak a latched jump into the next match", async ({ page }) => {
  // ArrowUp is P2's jump. matchEnd ticks consume nothing, so without latch.clear() on rematch the
  // edge survives and P2 jumps on the first actionable tick of the new round.
  await ready(page);
  await koTheMatch(page);
  await press(page, "ArrowUp");
  await press(page, "ArrowDown"); // back to REMATCH
  expect((await menu(page)).sel).toBe(0);

  await press(page, "Enter");
  await page.evaluate(() => { (window as any).__world.match.introTicks = 0; }); // eslint-disable-line @typescript-eslint/no-explicit-any
  await pump(page, 12);
  const p2 = await page.evaluate(() => {
    const f = (window as any).__world.fighters[1]; // eslint-disable-line @typescript-eslint/no-explicit-any
    return { state: f.state as string, grounded: f.grounded as boolean };
  });
  expect(p2.grounded).toBe(true);
  expect(p2.state).not.toBe("jumpRise");
});

test("Enter on MAIN MENU leaves for the flow", async ({ page }) => {
  await ready(page);
  await koTheMatch(page);
  await press(page, "ArrowDown");
  expect((await menu(page)).sel).toBe(1);

  await press(page, "Enter");
  await pump(page, 20);
  expect(await page.evaluate(() => (window as any).__flow != null)).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
});

test("Enter outside matchEnd is still the plain restart", async ({ page }) => {
  // Phase 11's quit-prompt spec relies on this during intro; the menu must not have stolen the key.
  await ready(page);
  await pump(page, 2);
  expect(await phase(page)).toBe("intro");
  await page.evaluate(() => { (window as any).__world.match.wins = [1, 0]; }); // eslint-disable-line @typescript-eslint/no-explicit-any
  await press(page, "Enter");
  const wins = await page.evaluate(() => (window as any).__world.match.wins as number[]); // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(wins).toEqual([0, 0]); // restart() ran
  expect((await menu(page)).shown).toBe(false);
});

test("a key already held when the KO lands does not move the selection", async ({ page }) => {
  // Phaser's Key._justDown is set on keydown and cleared only when a JustDown() read consumes it or
  // the key comes up — it is not frame-scoped. Down is also crouch, so dying while low-blocking is
  // an ordinary thing to do; if the menu only polls JustDown once it is open, that stale edge fires
  // immediately and the highlight is on MAIN MENU before the player has touched anything. A reflex
  // Enter then quits the match instead of rematching.
  await ready(page);
  await page.evaluate(() => {
    const w = window as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    w.__world.match.phase = "fight";
    w.__world.match.introTicks = 0;
  });
  await pump(page, 4);

  await page.keyboard.down("ArrowDown"); // crouching...
  await pump(page, 40);
  await koTheMatch(page); // ...and the finishing blow lands while it is still held
  const held = await menu(page);
  await page.keyboard.up("ArrowDown");

  expect(held.shown).toBe(true);
  expect(held.sel, "the menu must open on REMATCH even with a nav key held").toBe(0);

  // and a real press after release still works
  await press(page, "ArrowDown");
  expect((await menu(page)).sel).toBe(1);
});
