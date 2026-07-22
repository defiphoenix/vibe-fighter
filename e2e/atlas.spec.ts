import { test, expect, type Page } from "@playwright/test";

// Phase 07 acceptance: the two generated atlases are actually loadable by Phaser and every frame the
// JSON declares resolves by name. See docs/phases/07-ui-prop-atlases.md.
//
// Why this exists at all: Phase 07 is the first phase to emit atlas JSON, on a repo that had never
// called `this.load.atlas`. `npm run build:atlases` proves the RECTS are right (it measured them),
// `npm run typecheck` and `npm test` never touch public/, and `vite build` only copies the files.
// So without this spec nothing anywhere proves Phaser accepts the format — a plan review called that
// out, and a one-off by-eye load in a scratch page is not a regression check. This is the smallest
// thing that fails if the JSON drifts out of Phaser's JSON-Hash shape.
//
// No src/** change: the loader is driven through the DEV `__game` hook, exactly like the Phase 02
// spec pumps `__game.step`. BootScene still loads only the placeholder sheet — wiring these atlases
// into the real boot is Phase 08's (props) and Phase 14's (HUD) job, not this phase's.

/* eslint-disable @typescript-eslint/no-explicit-any */

type Loaded = { ok: boolean; error?: string; frames: string[] };

/** Load an atlas at runtime through Phaser's own loader and report the frame names it resolved. */
async function loadAtlas(page: Page, key: string, png: string, json: string): Promise<Loaded> {
  return await page.evaluate(
    ([k, p, j]) =>
      new Promise<Loaded>((resolve) => {
        const game = (window as any).__game;
        const scene = game.scene.getScenes(true)[0];
        const done = () => {
          if (!game.textures.exists(k)) return resolve({ ok: false, error: `texture '${k}' missing after load`, frames: [] });
          // '__BASE' is Phaser's own whole-image frame, present on every texture. Drop it: it is not
          // something the atlas JSON declared, so counting it would flatter the result.
          const frames = game.textures.get(k).getFrameNames().filter((n: string) => n !== "__BASE");
          resolve({ ok: true, frames });
        };
        scene.load.once("complete", done);
        scene.load.once("loaderror", (f: any) => resolve({ ok: false, error: `loaderror on ${f?.key ?? k}`, frames: [] }));
        scene.load.atlas(k, p, j);
        scene.load.start();
      }),
    [key, png, json] as const,
  );
}

/** Every declared frame's rect must lie inside the sheet — a rect that does not is a packer bug. */
async function rectsInsideSheet(page: Page, key: string): Promise<string[]> {
  return await page.evaluate((k) => {
    const tex = (window as any).__game.textures.get(k);
    const src = tex.getSourceImage();
    const bad: string[] = [];
    for (const name of tex.getFrameNames()) {
      const f = tex.get(name);
      if (f.cutX < 0 || f.cutY < 0 || f.cutX + f.cutWidth > src.width || f.cutY + f.cutHeight > src.height) {
        bad.push(`${name}: ${f.cutX},${f.cutY} ${f.cutWidth}x${f.cutHeight} outside ${src.width}x${src.height}`);
      }
      if (f.cutWidth <= 0 || f.cutHeight <= 0) bad.push(`${name}: zero-area frame`);
    }
    return bad;
  }, key);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/?scene=match");
  // Wait for __world, not just __game — the same readiness condition phase02-sprite.spec.ts uses.
  // __game is set at module eval (main.ts:22) and appears almost instantly; __world only exists once
  // MatchScene.create() has run (MatchScene.ts:47), i.e. after BootScene's preload. Waiting on the
  // early hook raced Vite's dep-prebundle reload on a cold dev server: the page navigated out from
  // under page.evaluate and it failed with "Execution context was destroyed". Waiting on the later
  // hook lets that reload land first, and also guarantees getScenes(true)[0] is MatchScene rather
  // than a BootScene that is about to stop.
  await page.waitForFunction(
    () => (window as any).__game != null && (window as any).__world != null,
    null,
    { timeout: 30_000 }, // boot pulls the whole sprite+stage+portrait set; workers contend on a cold dev server
  );
});

test("hud-atlas loads in Phaser and every declared frame resolves", async ({ page }) => {
  const r = await loadAtlas(page, "hud-atlas", "ui/hud-atlas.png", "ui/hud-atlas.json");
  expect(r.error ?? "").toBe("");
  expect(r.ok).toBe(true);

  // The plates, and the slots Phase 14 composites the dynamic fill / the portrait into. Slots are
  // frames because a rect is a rect — no schema Phaser does not already have.
  expect(r.frames.sort()).toEqual(
    ["health-bar", "health-bar-slot", "portrait-base", "portrait-slot"].sort(),
  );
  expect(await rectsInsideSheet(page, "hud-atlas")).toEqual([]);
});

test("the fill slot sits inside the bar, which is what makes it composite-able", async ({ page }) => {
  await loadAtlas(page, "hud-atlas", "ui/hud-atlas.png", "ui/hud-atlas.json");
  const geom = await page.evaluate(() => {
    const t = (window as any).__game.textures.get("hud-atlas");
    const r = (n: string) => { const f = t.get(n); return { x: f.cutX, y: f.cutY, w: f.cutWidth, h: f.cutHeight }; };
    return { bar: r("health-bar"), slot: r("health-bar-slot"), base: r("portrait-base"), pslot: r("portrait-slot") };
  });

  // Phase 14 reads the bar's height from here rather than hardcoding it — the art defines it.
  expect(geom.bar.w).toBe(460); // src/render/hud.ts:5 BAR_W, the one number the packer holds fixed
  for (const [inner, outer, label] of [
    [geom.slot, geom.bar, "fill slot in bar"],
    [geom.pslot, geom.base, "portrait slot in base"],
  ] as const) {
    expect(inner.x, label).toBeGreaterThanOrEqual(outer.x);
    expect(inner.y, label).toBeGreaterThanOrEqual(outer.y);
    expect(inner.x + inner.w, label).toBeLessThanOrEqual(outer.x + outer.w);
    expect(inner.y + inner.h, label).toBeLessThanOrEqual(outer.y + outer.h);
  }
});

test("twilight-atlas loads and carries 4 animatable frames for each prop", async ({ page }) => {
  const r = await loadAtlas(page, "twilight-atlas", "props/twilight-atlas.png", "props/twilight-atlas.json");
  expect(r.error ?? "").toBe("");
  expect(r.ok).toBe(true);

  const expected = ["crowd", "vents", "beacon", "steam"].flatMap((p) => [0, 1, 2, 3].map((n) => `${p}-${n}`));
  expect(r.frames.sort()).toEqual(expected.sort());
  expect(await rectsInsideSheet(page, "twilight-atlas")).toEqual([]);
});

test("a prop's frames drive a Phaser animation — 'can animate' is the acceptance criterion", async ({ page }) => {
  await loadAtlas(page, "twilight-atlas", "props/twilight-atlas.png", "props/twilight-atlas.json");
  const played = await page.evaluate(() => {
    const game = (window as any).__game;
    const scene = game.scene.getScenes(true)[0];
    scene.anims.create({
      key: "vents-spin",
      frames: scene.anims.generateFrameNames("twilight-atlas", { prefix: "vents-", start: 0, end: 3 }),
      frameRate: 12,
      repeat: -1,
    });
    // Bottom-center origin: props sit ON the roof, per public/configs/sprite-schema.md's feet anchor.
    const s = scene.add.sprite(100, 100, "twilight-atlas", "vents-0").setOrigin(0.5, 1);
    s.play("vents-spin");
    const first = s.frame.name;
    // Pump Phaser's own clock rather than waiting on RAF — headless throttles it (see phase02 spec).
    game.loop.stop();
    let t = game.loop?.now ?? performance.now();
    const seen = new Set<string>([first]);
    for (let i = 0; i < 40; i++) { t += 1000 / 60; game.step(t, 1000 / 60); seen.add(s.frame.name); }
    return { count: scene.anims.get("vents-spin").frames.length, seen: [...seen].sort() };
  });

  expect(played.count).toBe(4);
  // If the animation is really running, more than one distinct frame is shown over 40 ticks at 12fps.
  expect(played.seen.length).toBeGreaterThan(1);
});
