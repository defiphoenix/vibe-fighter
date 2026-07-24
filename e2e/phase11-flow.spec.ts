import { test, expect, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { withRegistryLock } from "./registry-lock";

// Phase 11 acceptance for the Play flow (title -> mode -> stage -> characters -> match), the CPU
// opponent, and the Playground's save-to-config round trip.
//
// Same Phaser constraints as the other specs: headless Chromium throttles RAF and trusted key events
// never reach Phaser, so the spec stops the loop and pumps game.step() itself, driving the flow
// through the DEV __flow.press seam — which calls the SAME handler the real keyboard does.
//
// Two flow-specific ones:
//  - scene.start() is QUEUED, and the lock-in flash is a ~320ms tween that advances on pumped time,
//    so "wait for the match" means pumping in a bounded loop, not pumping one extra frame.
//  - keypresses are batched into a single page.evaluate (Phase 10's lesson: ~45 round-trips grazed
//    the test timeout and went flaky).

/* eslint-disable @typescript-eslint/no-explicit-any */
const REGISTRY = "public/configs/character-gym.json";

async function ready(page: Page, query = ""): Promise<void> {
  await page.goto(`/${query}`);
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

/** Send a whole key sequence in ONE round trip, pumping a frame between presses. */
async function keys(page: Page, seq: string[]): Promise<any> {
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
async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await pump(page, 4);
  await page.keyboard.up(key);
  await pump(page, 4);
}

/** Pump until the match scene has published its world (covers the flash tween + queued start). */
async function waitForMatch(page: Page, maxFrames = 240): Promise<void> {
  for (let i = 0; i < maxFrames; i += 20) {
    await pump(page, 20);
    if (await page.evaluate(() => (window as any).__world != null)) return;
  }
  throw new Error("match never started");
}

const matchInfo = (page: Page) =>
  page.evaluate(() => {
    const w = (window as any).__world;
    return {
      fighters: w.fighters.map((f: any) => f.cfg.id as string),
      phase: w.match.phase as string,
      p2x: w.fighters[1].x as number,
    };
  });

test.describe("Phase 11 — menus, modes, versus flow", () => {
  test("1v1: title -> mode -> stage -> characters -> match with the chosen pair and stage", async ({ page }) => {
    await ready(page);
    expect((await page.evaluate(() => (window as any).__flow.state())).step).toBe("title");

    // ENTER title; ENTER mode (1v1); RIGHT then ENTER on stage (second stage); P1 lock, P2 lock.
    const state = await keys(page, ["enter", "enter", "right", "enter", "f", "comma"]);
    expect(state.step).toBe("chars");
    expect(state.locked).toEqual([true, true]);
    expect(state.stageIndex).toBe(1);

    await waitForMatch(page);
    const info = await matchInfo(page);
    expect(info.fighters).toEqual(["brawler", "jiujitsu"]);

    // The second stage really built: its own layer textures are on screen.
    const stageIds = await page.evaluate(() => (window as any).__flow?.stages?.() ?? null);
    expect(stageIds).toBeNull(); // Flow is gone — the match replaced it
    const layerKeys = await page.evaluate(() =>
      (window as any).__stage.layers.map((l: any) => l.texture.key as string));
    expect(layerKeys.every((k: string) => k.startsWith("sunset-"))).toBe(true);
  });

  test("moving the selection swaps the two players (no same-character pick)", async ({ page }) => {
    await ready(page);
    const before = await keys(page, ["enter", "enter", "enter"]);
    expect(before.cursors).toEqual([0, 1]);
    const after = await keys(page, ["d"]);
    expect(after.cursors).toEqual([1, 0]);
    // P2 locks their card, then P1 has nowhere to move: the pair can never collide.
    const locked = await keys(page, ["comma", "d", "a"]);
    expect(locked.cursors).toEqual([1, 0]);
  });

  test("1vCPU: the player picks, the CPU locks the other card, and then fights back", async ({ page }) => {
    await ready(page);
    // ENTER title; RIGHT x2 -> "CPU · HARD"; ENTER; ENTER stage; ENTER locks P1 (CPU mode only).
    const state = await keys(page, ["enter", "right", "right", "right", "enter", "enter", "enter"]);
    expect(state.modeIndex).toBe(3);
    expect(state.locked[0]).toBe(true);

    await waitForMatch(page);
    const start = await matchInfo(page);
    expect(start.fighters).toEqual(["brawler", "jiujitsu"]);

    // No human input at all: P2 must still act (the CPU walks in / attacks).
    await pump(page, 200);
    const after = await page.evaluate(() => {
      const w = (window as any).__world;
      return { p2x: w.fighters[1].x as number, p1health: w.fighters[0].health as number };
    });
    expect(Math.abs(after.p2x - start.p2x)).toBeGreaterThan(20);
  });

  test("Esc at match end returns to the flow instead of dead-ending", async ({ page }) => {
    await page.goto("/?scene=match"); // straight to a match; this one is not testing the flow
    await page.waitForFunction(() => (window as any).__world != null, null, { timeout: 30_000 });
    await page.evaluate(() => (window as any).__game.loop.stop());
    // Force the decided state the Esc handler keys off, then press Esc for real.
    await page.evaluate(() => {
      const m = (window as any).__world.match;
      m.phase = "matchEnd";
      m.matchWinner = 0;
    });
    await pump(page, 2);
    await page.keyboard.down("Escape");
    await pump(page, 4);
    await page.keyboard.up("Escape");
    await pump(page, 20);
    expect(await page.evaluate(() => (window as any).__flow != null)).toBe(true);
  });

  test("Esc mid-fight asks first, and the second press quits", async ({ page }) => {
    // Esc used to work ONLY at matchEnd, so mid-fight it silently did nothing. Now it always works,
    // but a match in progress costs two presses so a stray key can't throw the match away.
    await page.goto("/?scene=match");
    await page.waitForFunction(() => (window as any).__world != null, null, { timeout: 30_000 });
    await page.evaluate(() => (window as any).__game.loop.stop());
    await pump(page, 2);
    expect(await page.evaluate(() => (window as any).__world.match.phase as string)).not.toBe("matchEnd");

    // First press: still in the match, and the prompt is up.
    await press(page, "Escape");
    expect(await page.evaluate(() => (window as any).__world != null)).toBe(true);
    expect(await page.evaluate(() => (window as any).__quitArmed())).toBe(true);

    // Second press: gone to the menu.
    await press(page, "Escape");
    await pump(page, 20);
    expect(await page.evaluate(() => (window as any).__flow != null)).toBe(true);
  });

  test("an armed quit prompt does not survive a rematch or a round change", async ({ page }) => {
    // Arm the prompt, then rematch. The window must close with the old match — otherwise the first
    // Esc of the NEW match quits instantly, because the confirmation it is answering is stale.
    await page.goto("/?scene=match");
    await page.waitForFunction(() => (window as any).__world != null, null, { timeout: 30_000 });
    await page.evaluate(() => (window as any).__game.loop.stop());
    await pump(page, 2);

    await press(page, "Escape");
    expect(await page.evaluate(() => (window as any).__quitArmed())).toBe(true);
    await press(page, "Enter"); // rematch
    expect(await page.evaluate(() => (window as any).__quitArmed())).toBe(false);
    expect(await page.evaluate(() => (window as any).__world != null)).toBe(true);

    // Same for a round ending underneath an armed prompt. Get into the fight phase FIRST: the round
    // clock only runs there, and the intro->fight change would itself disarm the prompt.
    await page.evaluate(() => { (window as any).__world.match.introTicks = 0; });
    await pump(page, 4);
    expect(await page.evaluate(() => (window as any).__world.match.phase as string)).toBe("fight");

    await press(page, "Escape");
    expect(await page.evaluate(() => (window as any).__quitArmed())).toBe(true);
    await page.evaluate(() => { (window as any).__world.match.timerTicks = 1; });
    await pump(page, 6);
    expect(await page.evaluate(() => (window as any).__world.match.phase as string)).not.toBe("fight");
    expect(await page.evaluate(() => (window as any).__quitArmed())).toBe(false);
  });

  test("DEV: pressing P on the title opens the Fighter Playground", async ({ page }) => {
    await ready(page);
    expect((await page.evaluate(() => (window as any).__flow.state())).step).toBe("title");
    // The same door the on-screen "PLAYGROUND (dev)" button uses (its pointerdown calls scene.start).
    await page.evaluate(() => (window as any).__flow.press("p"));
    for (let i = 0; i < 12; i++) {
      await pump(page, 20);
      if (await page.evaluate(() => (window as any).__playground != null)) break;
    }
    expect(await page.evaluate(() => (window as any).__game.scene.isActive("Playground"))).toBe(true);
    expect(await page.evaluate(() => (window as any).__flow == null)).toBe(true); // Flow shut down
  });

  test("Playground stats saved to the config apply in the main game", async ({ page }) => {
    // The dev endpoint writes to the ONE real registry file and this repo has no VCS safety net,
    // so snapshot the bytes and put them back whatever happens. The lock serializes this against the
    // other file-mutating spec (gym-guard) so parallel workers can't clobber each other's mutation.
    await withRegistryLock(async () => {
    const original = readFileSync(REGISTRY);
    try {
      await page.goto("/?scene=playground");
      await page.waitForFunction(() => (window as any).__playground != null, null, { timeout: 30_000 });
      await page.locator("#playground-panel select").first().selectOption("jiujitsu");
      await page.locator("#playground-panel input[type=number]").nth(4).fill("1.15"); // scale
      await page.locator("#playground-panel button").click();
      await expect(page.locator("#playground-panel span").last()).toHaveText("saved ✓");

      expect(JSON.parse(readFileSync(REGISTRY, "utf8")).jiujitsu.data.stats.scale).toBe(1.15);

      // ...and a fresh boot of the real match picks it up.
      await page.goto("/?scene=match");
      await page.waitForFunction(() => (window as any).__world != null, null, { timeout: 30_000 });
      const scale = await page.evaluate(() =>
        (window as any).__world.fighters[1].cfg.stats.scale as number);
      expect(scale).toBe(1.15);
    } finally {
      writeFileSync(REGISTRY, original);
    }
    });
  });
});
