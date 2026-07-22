import { test, expect, type Page } from "@playwright/test";

// Phase 09 acceptance: BOTH fighters render as per-state sprites driven by sim state (idle → walk →
// attack), stay feet-anchored/mirrored/depth-ordered, an attack switches the opponent to hitstun,
// and hitstop freezes visual playback. Reads the DEV hooks (__world, __sprites, __game).
// The sim only advances inside Phaser's step, which headless Chromium throttles via RAF, so the spec
// pumps game.step() itself — deterministic, no wall-clock waits.

/* eslint-disable @typescript-eslint/no-explicit-any */
async function ready(page: Page): Promise<void> {
  await page.goto("/?scene=match");
  await page.waitForFunction(
    () => {
      const w = window as any;
      return w.__sprites?.length === 2 && w.__world != null && w.__game != null;
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

function readSprite(page: Page, i: number) {
  return page.evaluate((idx) => {
    const w = window as any;
    const s = w.__sprites[idx];
    const f = w.__world.fighters[idx];
    return {
      animKey: s.anims.currentAnim?.key as string | undefined,
      playing: s.anims.isPlaying as boolean,
      frameIndex: s.anims.currentFrame?.index as number | undefined,
      sx: s.x, sy: s.y, originX: s.originX, originY: s.originY, flipX: s.flipX, depth: s.depth,
      fx: f.x, fy: f.y, facing: f.facing, state: f.state, health: f.health,
      frontIndex: w.__world.frontIndex,
    };
  }, i);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

test("both fighters load as per-state sprites anchored to the sim", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("PAGEERR: " + e.message));
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`${r.status()} ${r.url()}`); });
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("Failed to load resource")) errors.push(m.text()); });

  await ready(page);
  await pump(page, 4);

  for (const [i, id] of [[0, "brawler"], [1, "jiujitsu"]] as const) {
    const s = await readSprite(page, i);
    expect(s.animKey).toBe(`${id}-idle`);
    expect(s.playing).toBe(true);
    expect(s.originX).toBeCloseTo(0.5, 5);
    expect(s.originY).toBeCloseTo(1, 5);
    expect(s.sx).toBeCloseTo(s.fx, 3);
    expect(s.sy).toBeCloseTo(s.fy, 3);
    expect(s.flipX).toBe(s.facing < 0);
    expect(s.depth).toBe(s.frontIndex === i ? 11 : 9);
  }

  await page.screenshot({ path: "e2e/__artifacts__/phase09-idle.png" });
  expect(errors, `console/page errors: ${errors.join(" | ")}`).toEqual([]);
});

test("fighter textures use LINEAR filtering (pixelArt removed)", async ({ page }) => {
  await ready(page);
  // Phaser 4 ScaleModes: LINEAR = 0 (default), NEAREST = 1. pixelArt:true would force 1 via
  // TextureSource.setFilter(1) (antialias off). Photographic art wants LINEAR = 0.
  const scaleMode = await page.evaluate(
    () => (window as any).__game.textures.get("brawler-idle").source[0].scaleMode, // eslint-disable-line @typescript-eslint/no-explicit-any
  );
  expect(scaleMode).toBe(0);
});

test("walking switches P1 to walkF and tracks the feet anchor", async ({ page }) => {
  await ready(page);
  await pump(page, 100); // clear intro (INTRO_TICKS=90)
  const start = await readSprite(page, 0);

  await page.evaluate(() => (window as any).__holdP1({ right: true })); // eslint-disable-line @typescript-eslint/no-explicit-any
  await pump(page, 20);
  const moving = await readSprite(page, 0);
  await page.evaluate(() => (window as any).__holdP1({})); // eslint-disable-line @typescript-eslint/no-explicit-any

  expect(moving.fx).toBeGreaterThan(start.fx);
  expect(moving.animKey).toBe("brawler-walkF");
  expect(moving.sx).toBeCloseTo(moving.fx, 3);
});

test("a light attack plays attackLight and puts the opponent in hitstun; hitstop freezes playback", async ({ page }) => {
  await ready(page);
  // place them in light range and enter fight directly
  await page.evaluate(() => {
    const w = window as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    w.__world.match.phase = "fight";
    w.__world.match.introTicks = 0;
    w.__world.fighters[0].reset(700, 1);
    w.__world.fighters[1].reset(760, -1);
  });

  await page.evaluate(() => (window as any).__holdP1({ light: true, lightPressed: true })); // eslint-disable-line @typescript-eslint/no-explicit-any
  await pump(page, 2);
  const atk = await readSprite(page, 0);
  expect(atk.animKey).toBe("brawler-attackLight");
  await page.evaluate(() => (window as any).__holdP1({})); // eslint-disable-line @typescript-eslint/no-explicit-any

  // pump through the active window; the opponent should take a hit
  let sawHitstun = false;
  let frozeDuringHitstop = false;
  for (let i = 0; i < 12; i++) {
    await pump(page, 1);
    const [d, hitstop, fi0] = await page.evaluate(() => {
      const w = window as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      return [w.__world.fighters[1].state, w.__world.hitstop, w.__sprites[0].anims.currentFrame?.index];
    });
    if (d === "hitstun") sawHitstun = true;
    if (hitstop > 0) {
      const fiBefore = fi0;
      await pump(page, 1);
      const fiAfter = await page.evaluate(() => (window as any).__sprites[0].anims.currentFrame?.index); // eslint-disable-line @typescript-eslint/no-explicit-any
      if (fiAfter === fiBefore) frozeDuringHitstop = true;
    }
  }
  expect(sawHitstun).toBe(true);
  const opp = await readSprite(page, 1);
  expect(opp.health).toBeLessThan(100);
  expect(frozeDuringHitstop).toBe(true);
});

// Phase 12: the measured contact frame must actually reach Phaser. anim-timing.test.ts proves the
// arithmetic, but it would stay green if FighterSprite stopped applying the durations — this asserts
// the wiring, on the real AnimationManager, after a real boot.
test("attack animations carry per-frame durations that put the strike on the active window", async ({ page }) => {
  await ready(page);

  const checked = await page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const w = window as any;
    const reg = w.__game.cache.json.get("characters");
    const out: { key: string; windUpMs: number; startupMs: number; totalMs: number; moveMs: number }[] = [];
    const STATE_TO_KEY: Record<string, string> = {
      attackLight: "light", attackHeavy: "heavy", airLight: "airLight",
      airHeavy: "airHeavy", crouchLight: "crouchLight", crouchHeavy: "crouchHeavy",
    };
    for (const id of ["brawler", "jiujitsu"]) { // the two fighters this match built
      for (const [state, key] of Object.entries(STATE_TO_KEY)) {
        const sheet = reg[id].render.sheets[state];
        if (sheet.hit === undefined) continue; // no measurement -> uniform timing, nothing to assert
        const anim = w.__game.anims.get(`${id}-${state}`);
        const d = anim.frames.map((f: any) => f.duration);
        const a = reg[id].data.attacks[key];
        out.push({
          key: `${id}.${state}`,
          windUpMs: d.slice(0, sheet.hit).reduce((t: number, x: number) => t + x, 0),
          startupMs: ((a.startup - 1) * 1000) / 60 - 1, // -1 tick = play() lag, -1ms = boundary bias
          totalMs: d.reduce((t: number, x: number) => t + x, 0),
          moveMs: ((a.startup + a.active + a.recovery) * 1000) / 60,
        });
      }
    }
    return out;
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });

  expect(checked.length, "expected measured contact frames in the shipped registry").toBeGreaterThan(0);
  for (const c of checked) {
    // the frame the sprite strikes on begins exactly when the hit box does...
    expect(c.windUpMs, `${c.key} wind-up`).toBeCloseTo(c.startupMs, 6);
    // ...and re-timing did not change how long the move takes
    expect(c.totalMs, `${c.key} total`).toBeCloseTo(c.moveMs, 6);
  }
});

// The acceptance criterion itself, measured on the running game rather than on the numbers that
// feed it: on the sim tick the hit box first goes live, the sprite must be showing the frame the art
// actually strikes on. This is what caught the play() lag — the durations were arithmetically
// perfect and the contact frame still landed one tick late, because the animation clock starts at
// the END of the tick that entered the state.
test("the strike frame is on screen on the tick the hit box goes live", async ({ page }) => {
  test.slow();
  await ready(page);

  const results = await page.evaluate(async () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const w = window as any;
    const reg = w.__game.cache.json.get("characters");
    const step = () => { const g = w.__game; g.step((g.loop?.now ?? 0) + 1000 / 60, 1000 / 60); };
    const out: { key: string; shown: number; hit: number }[] = [];

    for (const [state, key, input] of [
      ["attackLight", "light", { light: true, lightPressed: true }],
      ["attackHeavy", "heavy", { heavy: true, heavyPressed: true }],
      ["crouchHeavy", "crouchHeavy", { down: true, downAtPress: true, heavy: true, heavyPressed: true }],
    ] as const) {
      const sheet = reg.brawler.render.sheets[state];
      if (sheet.hit === undefined) continue;
      const startup = reg.brawler.data.attacks[key].startup;
      w.__world.match.phase = "fight";
      w.__world.match.introTicks = 0;
      w.__world.fighters[0].reset(700, 1);
      w.__world.fighters[1].reset(900, -1); // out of range: measure the animation, not the hit
      w.__holdP1(input);
      let shown = -1;
      for (let i = 0; i < 60; i++) {
        step();
        const f = w.__world.fighters[0];
        if (f.state === state && f.stateFrame >= startup) {
          shown = (w.__sprites[0].anims.currentFrame?.index ?? 0) - 1; // Phaser's index is 1-based
          break;
        }
      }
      w.__holdP1({});
      for (let i = 0; i < 60; i++) step(); // return to idle before the next one
      out.push({ key: `brawler.${state}`, shown, hit: sheet.hit });
    }
    return out;
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });

  expect(results.length).toBeGreaterThan(0);
  for (const r of results) {
    expect(r.shown, `${r.key}: frame on screen at the first active tick`).toBe(r.hit);
  }
});

// ...and the same acceptance under a FRAME HITCH. `World.advance` runs a whole batch of fixed ticks
// before the scene renders (up to 15 at MAX_FRAME), but `play()` only happens at render — so on a
// long frame an attack can enter its state and run clean past its active window before its animation
// has started, drawing the wind-up while the hit box is already live. Every other pump in this suite
// is exactly one tick, so none of them can see it. This one steps 5 ticks at a time.
test("the strike frame is still correct when one render frame spans several sim ticks", async ({ page }) => {
  await ready(page);

  const r = await page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const w = window as any;
    const reg = w.__game.cache.json.get("characters");
    const sheet = reg.brawler.render.sheets.attackLight;
    const a = reg.brawler.data.attacks.light;
    const TICKS = 5; // one long frame ~= 83ms, well past this move's 4-tick startup
    const step = () => { const g = w.__game; g.step((g.loop?.now ?? 0) + (1000 / 60) * TICKS, (1000 / 60) * TICKS); };

    w.__world.match.phase = "fight";
    w.__world.match.introTicks = 0;
    w.__world.fighters[0].reset(700, 1);
    w.__world.fighters[1].reset(900, -1);
    w.__holdP1({ light: true, lightPressed: true });
    const seen: { stateFrame: number; shown: number }[] = [];
    for (let i = 0; i < 12; i++) {
      step();
      const f = w.__world.fighters[0];
      if (f.state === "attackLight") {
        seen.push({ stateFrame: f.stateFrame, shown: (w.__sprites[0].anims.currentFrame?.index ?? 0) - 1 });
      }
    }
    w.__holdP1({});
    return { seen, hit: sheet.hit, startup: a.startup, active: a.active };
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });

  expect(r.hit, "this test needs a measured contact frame").toBeGreaterThan(0);
  // Find the first observation at or after the hit box going live. Under a 5-tick frame we may not
  // land exactly on `startup`, so take the first sample inside or past the active window.
  const atContact = r.seen.find((s) => s.stateFrame >= r.startup);
  expect(atContact, "never observed the active window").toBeDefined();
  // The animation must have caught up: at least the contact frame, never still on the wind-up.
  expect(atContact!.shown, `stateFrame ${atContact!.stateFrame} showed a wind-up frame`).toBeGreaterThanOrEqual(r.hit);
});
