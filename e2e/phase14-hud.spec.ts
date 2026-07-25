import { test, expect, type Page } from "@playwright/test";

// Phase 14 acceptance: the HUD is skinned with the Phase 07 atlas, the portraits are wired, and the
// match-start entrance runs at a readable pace.
//
// The entrance is derived from the sim's intro countdown rather than a tween (a Phaser 4 tween takes
// its delta from Date.now() and does not advance under the pumped game.step), which is exactly what
// makes it observable here: writing `__world.match.introTicks` scrubs the whole animation.
//
// The other assertion worth having is the boring one: every HUD object is screen-space. Nothing else
// in the suite pins that for an Image — stage.spec.ts covers Texts and depth->=100 Graphics only —
// so a plate that quietly scrolled with the world would ship.

/* eslint-disable @typescript-eslint/no-explicit-any */
async function ready(page: Page): Promise<void> {
  await page.goto("/?scene=match");
  await page.waitForFunction(
    () => {
      const w = window as any;
      return w.__world != null && w.__game != null && w.__hud != null;
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

const hud = (page: Page) => page.evaluate(() => (window as any).__hud());

/** Park the match in the fight phase with full health — the settled HUD state. */
async function fight(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = (window as any).__world;
    w.match.phase = "fight";
    w.match.introTicks = 0;
  });
  await pump(page, 2);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

test("the entrance slides the band down and fills the bars, then parks exactly", async ({ page }) => {
  await ready(page);
  // One scripted sweep in a single evaluate: the sim is deterministic, and 40 round-trips is what
  // made an earlier spec flaky.
  const samples = await page.evaluate(() => {
    const w = window as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const g = w.__game;
    let t = g.loop?.now ?? performance.now();
    const d = 1000 / 60;
    const out: { tick: number; slideY: number; fillFrac: number; fillW: number; faceY: number; cmds: number; color: number; bandBottom: number }[] = [];
    w.__world.match.phase = "intro";
    w.__world.match.introTicks = 90;
    for (let i = 0; i <= 90; i++) {
      t += d;
      g.step(t, d);
      const h = w.__hud();
      out.push({ tick: i, slideY: h.slideY, fillFrac: h.fillFrac, fillW: h.fill[0].w, faceY: h.faceY[0], cmds: h.drawCommands, color: h.fill[0].color, bandBottom: h.bandBottom });
    }
    return { out, slotW: w.__hud().slotW };
  });
  const { out, slotW } = samples;

  // Starts above its parked position with nothing drawn...
  expect(out[0].slideY).toBeLessThan(-100);
  expect(out[0].fillFrac).toBe(0);
  expect(out[0].fillW).toBe(0);
  // ...and ENTIRELY off the top of the screen. SLIDE_DROP_PX is a hand-set number in a Phaser-free
  // module that cannot measure the art, so this is where the two are held together: if the band's
  // art ever grows past the drop, the HUD starts half-visible and the slide reads as a twitch.
  expect(out[0].bandBottom, "the whole band starts above y=0").toBeLessThanOrEqual(0);

  // ...and is monotone all the way in — no bounce, no overshoot past the parked y.
  for (let i = 1; i < out.length; i++) {
    expect(out[i].slideY, `tick ${i}`).toBeGreaterThanOrEqual(out[i - 1].slideY - 1e-9);
    expect(out[i].fillFrac, `tick ${i}`).toBeGreaterThanOrEqual(out[i - 1].fillFrac - 1e-9);
    expect(out[i].slideY, `tick ${i}`).toBeLessThanOrEqual(0);
  }

  // Lands exactly parked and exactly full, with the fill filling the whole measured slot.
  const last = out[out.length - 1];
  expect(last.slideY).toBe(0);
  expect(last.fillFrac).toBe(1);
  expect(last.fillW).toBeCloseTo(slotW, 5);

  // The tempo the source prompt asked for: at ~0.2 s ("too rapid" territory) it is still going, and
  // it is finished before the 1.5 s intro is over.
  const rapid = out[12];
  expect(rapid.slideY).toBeLessThan(0);
  expect(rapid.fillFrac).toBe(0);
  const settled = out.findIndex((s) => s.slideY === 0 && s.fillFrac === 1);
  expect(settled).toBeGreaterThan(60); // slower than a snap
  expect(settled).toBeLessThan(90); // ...but done before FIGHT!

  // A full-health fighter stays GREEN for the whole entrance. Keying the colour tier off the
  // animated fill fraction instead of real health made the bar open red and sweep red->yellow->green
  // every single round — the QA pass caught it on screen, and nothing else here would.
  expect(new Set(out.map((s) => s.color))).toEqual(new Set([0x44dd44]));

  // The numbers above are the HUD's own bookkeeping; these two are read back off the real objects,
  // so deleting the y assignment or the fill draw fails the test instead of quietly passing it.
  expect(out[0].faceY).toBeLessThan(out[out.length - 1].faceY); // the portrait physically moved
  expect(out[out.length - 1].faceY - out[0].faceY).toBeCloseTo(-out[0].slideY, 5);
  for (const s of out) expect(s.cmds, `tick ${s.tick}`).toBeGreaterThan(0); // something was drawn every frame
});

test("the fill tracks health and changes colour tier, and blinks when low", async ({ page }) => {
  await ready(page);
  await fight(page);

  const full = await hud(page);
  expect(full.fill[0].w).toBeCloseTo(full.slotW, 5);
  expect(full.fill[0].color).toBe(0x44dd44);

  // Half health -> half the slot, mid tier.
  await page.evaluate(() => {
    const f = (window as any).__world.fighters[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    f.health = f.cfg.stats.maxHealth * 0.4;
  });
  await pump(page, 1);
  const mid = await hud(page);
  expect(mid.fill[0].w).toBeCloseTo(mid.slotW * 0.4, 3);
  expect(mid.fill[0].color).toBe(0xdddd33);

  // Low health -> red tier, and the fill pulses dim/bright. The blink phase comes
  // from absolute render time in fixed buckets, so it can only be observed by a run of frames whose
  // clock actually advances — one `pump()` per sample re-reads `loop.now`, which is frozen once the
  // loop is stopped, so every sample would land in the same bucket and see the same state.
  const blink = await page.evaluate(() => {
    const w = window as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const f = w.__world.fighters[0];
    f.health = f.cfg.stats.maxHealth * 0.1;
    const g = w.__game;
    let t = g.loop?.now ?? performance.now();
    const d = 1000 / 60;
    const widths: number[] = [];
    const colors: number[] = [];
    const alphas: number[] = [];
    for (let i = 0; i < 60; i++) {
      t += d;
      g.step(t, d);
      const h = w.__hud();
      widths.push(h.fill[0].w);
      colors.push(h.fill[0].color);
      alphas.push(h.fill[0].alpha);
    }
    return { widths, colors, alphas };
  });
  expect(new Set(blink.colors)).toEqual(new Set([0xdd3333]));
  expect(blink.alphas.some((a) => a < 1), "blink dims the fill on some frame").toBe(true);
  expect(blink.alphas.some((a) => a === 1), "blink restores the fill on some frame").toBe(true);
  // It is a PULSE, not a strobe: the bar never vanishes outright (QA measured the old full-off cut at
  // ~4.3 Hz on the new 62 px art and it read as flashing), and the dim phase stays readable.
  expect(blink.widths.every((w) => w > 0), "the bar is never blanked").toBe(true);
  expect(Math.min(...blink.alphas)).toBeGreaterThan(0.2);
  // Cadence: at 250 ms buckets a 60-frame (1 s) run sees ~4 phase changes, not ~8.
  const flips = blink.alphas.filter((a, i) => i > 0 && a !== blink.alphas[i - 1]).length;
  expect(flips).toBeGreaterThan(1);
  expect(flips).toBeLessThanOrEqual(5);
});

test("both portraits show the fighters actually in the match", async ({ page }) => {
  await ready(page);
  await fight(page);
  const [ids, h] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    page.evaluate(() => (window as any).__world.fighters.map((f: any) => f.cfg.id)),
    hud(page),
  ]);
  // The HUD-sized bake, not the select card: `npm run copy:portraits` LANCZOS-resamples each bust to
  // HUD size, because the 448x600 card squeezed into a ~96x147 slot with no mipmaps is what "the
  // portraits look low-res" was. If the bake is ever dropped, this fails rather than silently
  // falling back to the soft card.
  expect(h.portraitKeys).toEqual(ids.map((id: string) => `hud-portrait-${id}`));
});

test("every HUD object is screen-space — no plate scrolls with the world", async ({ page }) => {
  await ready(page);
  await fight(page);
  const band = await page.evaluate(() => {
    const scene = (window as any).__game.scene.getScene("Match"); // eslint-disable-line @typescript-eslint/no-explicit-any
    return scene.children.list
      .filter((o: { depth: number }) => o.depth >= 100 && o.depth < 102)
      .map((o: { type: string; depth: number; scrollFactorX: number; scrollFactorY: number }) => ({
        type: o.type, depth: o.depth, sx: o.scrollFactorX, sy: o.scrollFactorY,
      }));
  });
  // The HUD owns 6 Images (2 faces + 2 portrait plates + 2 bar plates) and 1 Graphics in this band;
  // the Texts in it are the HUD's four plus the scene's own legend, so only the art is counted.
  expect(band.filter((o: { type: string }) => o.type === "Image").length).toBe(6);
  expect(band.filter((o: { type: string }) => o.type === "Graphics").length).toBe(1);
  for (const o of band) {
    expect(o.sx, `${o.type}@${o.depth}`).toBe(0);
    expect(o.sy, `${o.type}@${o.depth}`).toBe(0);
  }
});
