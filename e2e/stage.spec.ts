import { test, expect, type Page } from "@playwright/test";

// Phase 08 acceptance: parallax layers load at distinct scroll rates, the near layer occludes
// fighters, the world is wider than the viewport and the follow-camera pans within bounds, the HUD
// stays pinned to the screen, and both stage variants build. Reads DEV hooks __game/__world/__stage
// (Match) and __preview (StagePreview). Same deterministic game.step() pump as phase02-sprite.spec.
//
// Locked geometry (concepts/backgrounds/README.md): world 1696, viewport 1280, travel 416, layer
// factors far 0.1 / medium 0.3 / main 1.0 / near 1.0, depths 0/1/2/20, runtime layer size 1697x720.

/* eslint-disable @typescript-eslint/no-explicit-any */

async function pump(page: Page, frames: number): Promise<void> {
  await page.evaluate((n) => {
    const g = (window as any).__game;
    let t = g.loop?.now ?? performance.now();
    const d = 1000 / 60;
    for (let i = 0; i < n; i++) { t += d; g.step(t, d); }
  }, frames);
}

async function readyMatch(page: Page): Promise<void> {
  await page.goto("/?scene=match");
  await page.waitForFunction(
    () => (window as any).__world != null && (window as any).__game != null && (window as any).__stage != null,
    null,
    { timeout: 30_000 }, // boot pulls the whole sprite+stage+portrait set; workers contend on a cold dev server
  );
  await page.evaluate(() => (window as any).__game.loop.stop());
}

test("parallax layers, occlusion, and camera bounds", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("PAGEERR: " + e.message));
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`${r.status()} ${r.url()}`);
  });
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("Failed to load resource")) errors.push(m.text());
  });

  await readyMatch(page);
  await pump(page, 4);

  // camera world bounds == 1696 wide (world), viewport is 1280 (canvas).
  const bounds = await page.evaluate(() => {
    const cam = (window as any).__stage.cam;
    const b = cam.getBounds();
    return { w: b.width, h: b.height, view: cam.width };
  });
  expect(bounds.w).toBe(1696);
  expect(bounds.view).toBe(1280);

  // per-layer contract: no squash (scaleX==scaleY), runtime width ~1697, origin (0,0), factor + depth.
  const layers = await page.evaluate(() =>
    ((window as any).__stage.layers as any[]).map((l) => ({
      key: l.texture.key,
      scaleX: l.scaleX, scaleY: l.scaleY,
      displayWidth: l.displayWidth,
      originX: l.originX, originY: l.originY,
      factor: l.scrollFactorX, depth: l.depth,
    })),
  );
  // near (front occluder) was dropped from stages.json in the resolution pass (its dusk-palette edge
  // read as residual purple), so the stage is three parallax layers now.
  expect(layers.length).toBe(3);
  const want = [
    { key: "twilight-far", factor: 0.1, depth: 0 },
    { key: "twilight-medium", factor: 0.3, depth: 1 },
    { key: "twilight-main", factor: 1.0, depth: 2 },
  ];
  layers.forEach((l, i) => {
    expect(l.scaleX).toBeCloseTo(l.scaleY, 6); // no aspect squash
    expect(l.displayWidth).toBeGreaterThanOrEqual(1696);
    expect(l.displayWidth).toBeLessThanOrEqual(1698);
    expect(l.originX).toBe(0);
    expect(l.originY).toBe(0);
    expect(l.key).toBe(want[i].key);
    expect(l.factor).toBeCloseTo(want[i].factor, 6);
    expect(l.depth).toBe(want[i].depth);
  });

  // distinct rates: far scrolls slower than main (0.1 < 1.0).
  expect(layers[0].factor).toBeLessThan(layers[2].factor);

  // no foreground occluder any more: every built layer sits behind the fighter sprites (9/11).
  const spriteDepth = await page.evaluate(() => (window as any).__sprites[0].depth);
  layers.forEach((l) => expect(l.depth).toBeLessThan(spriteDepth));

  // exact camera clamps: shove both fighters to a wall, pump, read scrollX.
  const clampLeft = await page.evaluate(() => {
    const w = window as any;
    for (const f of w.__world.fighters) f.x = 90; // STAGE_MARGIN (left wall)
    return 0;
  });
  void clampLeft;
  await pump(page, 2);
  const scrollLeft = await page.evaluate(() => (window as any).__stage.cam.scrollX);
  expect(scrollLeft).toBe(0);

  await page.evaluate(() => {
    const w = window as any;
    for (const f of w.__world.fighters) f.x = 1606; // STAGE_WIDTH - STAGE_MARGIN (right wall)
  });
  await pump(page, 2);
  const scrollRight = await page.evaluate(() => (window as any).__stage.cam.scrollX);
  expect(scrollRight).toBe(416); // world 1696 - viewport 1280

  // HUD is screen-space: every Text + the HUD graphics keep scrollFactorX 0 while the camera pans.
  const hudPinned = await page.evaluate(() => {
    const scene = (window as any).__game.scene.getScene("Match");
    const list = scene.children.list as any[];
    const texts = list.filter((o) => o.type === "Text");
    const gfx = list.filter((o) => o.type === "Graphics" && o.depth >= 100);
    return { texts: texts.map((t) => t.scrollFactorX), gfx: gfx.map((g) => g.scrollFactorX) };
  });
  for (const f of hudPinned.texts) expect(f).toBe(0);
  for (const f of hudPinned.gfx) expect(f).toBe(0);

  // every configured texture key + atlas prop frame exists (fail-fast would have thrown otherwise).
  const assets = await page.evaluate(() => {
    const tex = (window as any).__game.textures;
    const atlas = tex.get("twilight-atlas");
    // all 4 loop frames of every configured prop must exist (not just frame -0) — buildStage now
    // validates the full range, so a missing later frame would throw at build, not skip silently.
    const frames: boolean[] = [];
    for (const p of ["vents", "steam", "beacon"]) for (let i = 0; i < 4; i++) frames.push(atlas.has(`${p}-${i}`));
    return {
      keys: ["twilight-far", "twilight-medium", "twilight-main", "twilight-near",
             "sunset-far", "sunset-medium", "sunset-main", "sunset-near"].map((k) => tex.exists(k)),
      frames,
    };
  });
  expect(assets.keys.every(Boolean)).toBe(true);
  expect(assets.frames.length).toBe(12);
  expect(assets.frames.every(Boolean)).toBe(true);

  await page.screenshot({ path: "e2e/__artifacts__/phase08-stage.png" });
  expect(errors, `console/page errors: ${errors.join(" | ")}`).toEqual([]);
});

test("preview scene switches stages with constant object count", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("PAGEERR: " + e.message));

  await page.goto("/?scene=preview");
  await page.waitForFunction(
    () => (window as any).__preview != null && (window as any).__game != null,
    null,
    { timeout: 30_000 }, // boot pulls the whole sprite+stage+portrait set; workers contend on a cold dev server
  );
  await page.evaluate(() => (window as any).__game.loop.stop());
  await pump(page, 2);

  const count0 = await page.evaluate(() => (window as any).__preview.childCount());
  const id0 = await page.evaluate(() => (window as any).__preview.stageId());
  expect(id0).toBe("twilight");

  // switch twilight -> sunset -> twilight; object count must not grow (destroy handle works).
  await page.evaluate(() => (window as any).__preview.switchStage(1));
  await pump(page, 2);
  const id1 = await page.evaluate(() => (window as any).__preview.stageId());
  expect(id1).toBe("sunset");
  const count1 = await page.evaluate(() => (window as any).__preview.childCount());

  await page.evaluate(() => (window as any).__preview.switchStage(0));
  await pump(page, 2);
  const count2 = await page.evaluate(() => (window as any).__preview.childCount());

  expect(count1).toBe(count0); // same layer+prop count per stage
  expect(count2).toBe(count0); // switching back leaves nothing stacked
  expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
});
/* eslint-enable @typescript-eslint/no-explicit-any */
