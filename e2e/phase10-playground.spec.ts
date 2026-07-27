import { test, expect, type Page } from "@playwright/test";
import { PLAYGROUND, pump, ready as harnessReady } from "./harness";

/**
 * The playground zeroes `introTicks`, but the intro EXIT still costs one non-actionable tick
 * (`world.tick` returns false on it). Burn it here so a test can assert on a single pumped tick.
 */
async function ready(page: Page): Promise<void> {
  await harnessReady(page, { route: PLAYGROUND, needs: ["__game", "__playground"] });
  await pump(page, 2);
}

// Phase 10 acceptance for the Fighter Playground (?scene=playground): the fighter moves on the
// fixed ground axis and reaches all six attack states, live stat edits really change the sim,
// typing in the debug panel cannot drive the fighter (and a canvas click gives control back), and
// the debug-bound toggles work per-bound and all-at-once.
//
// Same Phaser constraints as the other specs: headless Chromium throttles RAF and trusted key
// events never reach Phaser, so the spec stops the loop, pumps game.step() itself, and drives input
// through the DEV __playground.hold seam — which routes through the real latch -> world.advance path.

/* eslint-disable @typescript-eslint/no-explicit-any */
const hold = (page: Page, v: Record<string, boolean>) =>
  page.evaluate((val) => (window as any).__playground.hold(val), v);

const player = (page: Page) =>
  page.evaluate(() => {
    const f = (window as any).__playground.world().fighters[0];
    return { x: f.x, y: f.y, state: f.state as string, grounded: f.grounded as boolean };
  });

test.describe("Phase 10 — fighter playground", () => {
  test("moves on the ground axis and stays grounded while walking", async ({ page }) => {
    await ready(page);
    const start = await player(page);
    await hold(page, { left: true });
    await pump(page, 30);
    const after = await player(page);
    expect(after.x).toBeLessThan(start.x - 50);
    expect(after.y).toBe(start.y); // fixed axis: walking never changes the feet line
    expect(after.state).toBe("walkB");
    expect(after.grounded).toBe(true);
  });

  test("performs all six attack states plus jump and crouch", async ({ page }) => {
    await ready(page);
    // Run the whole script inside ONE evaluate: ~45 sequential round-trips grazed the 30s timeout,
    // and the sim is deterministic anyway, so batching costs no coverage.
    const seen = await page.evaluate(() => {
      const w = window as any;
      const g = w.__game;
      const pg = w.__playground;
      let t = g.loop?.now ?? performance.now();
      const d = 1000 / 60;
      const step = (n: number, input: Record<string, boolean>) => {
        pg.hold(input);
        for (let i = 0; i < n; i++) { t += d; g.step(t, d); }
        const f = pg.world().fighters[0];
        return { state: f.state as string, grounded: f.grounded as boolean };
      };
      const out: Record<string, { state: string; grounded: boolean }> = {};

      out.attackLight = step(1, { light: true, lightPressed: true });
      step(40, {});
      out.attackHeavy = step(1, { heavy: true, heavyPressed: true });
      step(60, {});

      out.crouch = step(2, { down: true });
      out.crouchLight = step(1, { down: true, light: true, lightPressed: true });
      step(40, {});
      out.crouchHeavy = step(1, { down: true, heavy: true, heavyPressed: true });
      step(60, {});

      out.airborne = step(2, { up: true, upPressed: true });
      out.airLight = step(1, { light: true, lightPressed: true });
      step(120, {}); // land
      step(2, { up: true, upPressed: true });
      out.airHeavy = step(1, { heavy: true, heavyPressed: true });
      out.landed = step(120, {});
      return out;
    });

    expect(seen.attackLight.state).toBe("attackLight");
    expect(seen.attackHeavy.state).toBe("attackHeavy");
    expect(seen.crouch.state).toBe("crouch");
    expect(seen.crouchLight.state).toBe("crouchLight");
    expect(seen.crouchHeavy.state).toBe("crouchHeavy");
    expect(seen.airborne.grounded).toBe(false);
    expect(seen.airLight.state).toBe("airLight");
    expect(seen.airHeavy.state).toBe("airHeavy");
    expect(seen.landed.grounded).toBe(true);
  });

  test("a walkSpeed edit applies live to the running sim", async ({ page }) => {
    await ready(page);
    const base = await page.evaluate(() => (window as any).__playground.stats().walkSpeed);

    const travel = async (): Promise<number> => {
      const before = (await player(page)).x;
      await hold(page, { left: true });
      await pump(page, 30);
      await hold(page, {});
      await pump(page, 2);
      return before - (await player(page)).x;
    };

    const slow = await travel();
    await page.evaluate((v) => (window as any).__playground.setStat("walkSpeed", v), base * 2);
    const fast = await travel();

    expect(await page.evaluate(() => (window as any).__playground.world().fighters[0].cfg.stats.walkSpeed)).toBe(base * 2);
    expect(fast).toBeGreaterThan(slow * 1.6); // ~2x, with a tick of slack at either end
  });

  test("typing in the panel cannot move the fighter; a canvas click restores control", async ({ page }) => {
    await ready(page);
    await page.evaluate(() => (window as any).__playground.focusPanel());
    expect(await page.evaluate(() => (window as any).__playground.keyboardEnabled())).toBe(false);

    const before = (await player(page)).x;
    await hold(page, { left: true });
    await pump(page, 30);
    expect((await player(page)).x).toBe(before); // input seam is gated by the guard too

    const box = (await page.locator("canvas").boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await pump(page, 1);
    expect(await page.evaluate(() => (window as any).__playground.keyboardEnabled())).toBe(true);

    await pump(page, 30);
    expect((await player(page)).x).toBeLessThan(before - 50); // same held input now moves it
  });

  test("picking a fighter from the dropdown hands keyboard control back to the game", async ({ page }) => {
    // Regression: selecting a fighter focuses the <select>, which the focus guard treats as "typing"
    // and disables the keyboard. A <select> is not blurred by changing its value, so the keyboard
    // stayed dead until a canvas click — the just-picked fighter (e.g. the monk, since the brawler is
    // the default and needs no dropdown) looked like it "couldn't do any moves". The select now blurs
    // on change, firing focusout so the guard restores control.
    await ready(page);
    await page.evaluate(() => {
      const sel = document.querySelectorAll("#playground-panel select")[0] as HTMLSelectElement;
      sel.focus(); // the guard disables the keyboard here (focusin)
      sel.value = "monk";
      sel.dispatchEvent(new Event("change", { bubbles: true })); // a real dropdown pick
    });
    await pump(page, 1);
    expect(await page.evaluate(() => (window as any).__playground.keyboardEnabled())).toBe(true);
    expect(await page.evaluate(() => (window as any).__playground.world().fighters[0].cfg.id)).toBe("monk");

    // ...and the freshly-picked fighter actually responds to held input (it did not, before the fix).
    const before = (await player(page)).x;
    await hold(page, { left: true });
    await pump(page, 30);
    expect((await player(page)).x).toBeLessThan(before - 20);
  });

  // Regression: a frame shorter than one tick runs ZERO sim ticks, so the match phase still reads
  // "intro" right after a reset. A round-over check written as `phase !== "fight"` restarts the
  // world on every such frame — the fighter snaps back to spawn and the input latch is cleared,
  // silently eating whatever was pressed. Sub-tick frames are routine at 120 Hz.
  test("short (sub-tick) frames after a reset do not re-reset the world or eat input", async ({ page }) => {
    await ready(page);
    const resets = () => page.evaluate(() => (window as any).__playground.resets());

    // R leaves the world in "intro". A frame that advances no time runs zero sim ticks, so the
    // phase is STILL "intro" when the round-over check runs — the window the bug lived in. Written
    // as `phase !== "fight"` it restarts once per such frame (measured: 1 reset vs 5 for 3 frames),
    // teleporting the fighter to spawn and clearing the input latch every time.
    await page.evaluate(() => (window as any).__playground.reset());
    const after = await resets();
    expect(typeof after).toBe("number"); // guard against a vacuous undefined === undefined pass
    await pump(page, 3, 0);
    expect(await resets()).toBe(after);

    // control is intact once real frames resume
    await hold(page, { light: true, lightPressed: true });
    await pump(page, 2);
    expect((await player(page)).state).toBe("attackLight");
  });

  test("real typing lands in the panel and never reaches the fighter", async ({ page }) => {
    await ready(page);
    // Types with trusted key events, so this exercises Phaser's ACTUAL key state and its global
    // captures — InputReader's addKey() captures by default and KeyboardManager preventDefaults
    // captured codes on window regardless of target, which would otherwise swallow these digits.
    const field = page.locator("#playground-panel input[type=number]").first();
    const before = (await player(page)).x;
    await field.click();
    await field.fill("");
    await field.type("315");
    await page.keyboard.press("ArrowLeft"); // caret move inside the field, not a game input
    await pump(page, 20);

    expect(await field.inputValue()).toBe("315");
    expect((await player(page)).x).toBe(before);
    expect(await page.evaluate(() => (window as any).__playground.stats().walkSpeed)).toBe(315);
  });

  test("a scale edit grows the sprite and the collision boxes together", async ({ page }) => {
    await ready(page);
    const hurtW = () =>
      page.evaluate(() => (window as any).__playground.world().fighters[0].cfg.states.idle.frames[0].hurt[0].w);
    const spriteScale = () => page.evaluate(() => (window as any).__playground.spriteScale());

    const w0 = await hurtW();
    expect(await spriteScale()).toBeCloseTo(1, 5);

    await page.evaluate(() => (window as any).__playground.setStat("scale", 1.5));
    await pump(page, 2);
    expect(await spriteScale()).toBeCloseTo(1.5, 5);
    expect(await hurtW()).toBeCloseTo(w0 * 1.5, 5); // art and boxes must move together
  });

  test("bound toggles work per-bound and all at once", async ({ page }) => {
    await ready(page);
    const bounds = () => page.evaluate(() => (window as any).__playground.bounds());
    expect(await bounds()).toEqual({ hurt: true, hit: true, push: true, guard: true });

    await page.evaluate(() => (window as any).__playground.toggleBound("hit"));
    expect(await bounds()).toEqual({ hurt: true, hit: false, push: true, guard: true });

    await page.evaluate(() => (window as any).__playground.toggleBound("all"));
    expect(await bounds()).toEqual({ hurt: true, hit: true, push: true, guard: true });

    await page.evaluate(() => (window as any).__playground.toggleBound("all"));
    expect(await bounds()).toEqual({ hurt: false, hit: false, push: false, guard: false });
  });

  // The Playground has to `world.restart()` after a KO (forcing the phase back to "fight" would
  // re-bank the same win every tick), and restart() zeroes the meter — correct for a fresh match,
  // wrong for a training scene. A super you must FARM meter for is untestable if every KO
  // confiscates the bar, which is exactly how it played: build meter on the dummy, KO it, start over.
  test("the meter survives a KO reset and an explicit R reset", async ({ page }) => {
    await ready(page);
    const meter = () => page.evaluate(() => (window as any).__playground.world().fighters[0].meter as number);

    await page.evaluate(() => { (window as any).__playground.world().fighters[0].meter = 60; });
    expect(await meter()).toBe(60);

    // The KO path: resetIfRoundOver() reacts to a DECIDED phase, so bank one and pump a frame.
    await page.evaluate(() => { (window as any).__playground.world().match.phase = "roundEnd"; });
    await pump(page, 2);
    expect(await page.evaluate(() => (window as any).__playground.world().match.phase as string)).toBe("fight");
    expect(await meter()).toBe(60);

    // ...and the R key / __playground.reset() path, which goes through the same resetWorld().
    await page.evaluate(() => (window as any).__playground.reset());
    await pump(page, 2);
    expect(await meter()).toBe(60);
  });
});
