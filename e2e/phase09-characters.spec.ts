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
