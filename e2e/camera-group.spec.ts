import { test, expect, type Page } from "@playwright/test";
import { MATCH, pump, ready as harnessReady } from "./harness";

/** Boot straight into a match. The globals below are what THIS spec drives; waiting on
 *  the wrong set is how a spec ends up poking a half-built scene. */
const ready = (page: Page): Promise<void> =>
  harnessReady(page, { route: MATCH, needs: ["__sprites", "__world", "__game", "__stage"] });

// Phase 12 acceptance: the group camera frames BOTH fighters, and the world/UI camera split is
// exhaustive.
//
// The zoom is IN-only (never below 1.0) because the stage art is exactly viewport-height — a zoom
// under 1 would show empty bands above and below it. That means the interesting assertions are:
// the zoom curve hits its endpoints, the view never leaves the stage, both fighters stay inside it,
// and — the bug this split can silently introduce — every Game Object is rendered by exactly one
// camera. Phaser starts objects at cameraFilter 0 ("draw on every camera"), so an object missed by
// both ignore() lists draws twice, once zoomed and once not, which reads as a ghost/double image.

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Park the fighters `sep` apart around a world x, then let the eased zoom settle. */
async function separate(page: Page, sep: number, mid = 848): Promise<void> {
  await page.evaluate(({ sep, mid }) => {
    const w = window as any;
    w.__world.match.phase = "fight";
    w.__world.match.introTicks = 0;
    w.__world.fighters[0].reset(mid - sep / 2, 1);
    w.__world.fighters[1].reset(mid + sep / 2, -1);
  }, { sep, mid });
  await pump(page, 90); // the zoom lerp is per-frame; 90 frames is well past its snap epsilon
}

const camState = (page: Page) =>
  page.evaluate(() => {
    const c = (window as any).__stage.cam;
    const [a, b] = (window as any).__world.fighters;
    return {
      zoom: c.zoomX,
      view: { left: c.worldView.left, right: c.worldView.right, top: c.worldView.top, bottom: c.worldView.bottom },
      ax: a.x, bx: b.x,
    };
  });
/* eslint-enable @typescript-eslint/no-explicit-any */

test("zoom stays in [1, 1.25] and frames both fighters at every separation", async ({ page }) => {
  test.slow(); // many pumped frames per separation — each one is a real render
  await ready(page);

  // At the sim's cap (MAX_SEPARATION 1040) the camera is exactly 1:1 — the curve is built to meet
  // the un-zoomed camera there with no step.
  await separate(page, 1040);
  const wide = await camState(page);
  expect(wide.zoom).toBeCloseTo(1, 3);

  // Nose to nose it is at the cap.
  await separate(page, 120);
  const close = await camState(page);
  expect(close.zoom).toBeCloseTo(1.25, 3);

  // ...and in between it never zooms OUT, never leaves the stage, and always frames both fighters.
  for (const sep of [1040, 800, 600, 400, 260, 120]) {
    await separate(page, sep);
    const s = await camState(page);
    expect(s.zoom, `sep ${sep}`).toBeGreaterThanOrEqual(1);
    expect(s.zoom, `sep ${sep}`).toBeLessThanOrEqual(1.25 + 1e-6);
    expect(s.view.left, `sep ${sep} left edge`).toBeGreaterThanOrEqual(-1e-6);
    expect(s.view.right, `sep ${sep} right edge`).toBeLessThanOrEqual(1696 + 1e-6);
    // bottom-aligned: the foreground strip below the feet line is always the bottom of the screen
    expect(s.view.bottom, `sep ${sep} bottom`).toBeCloseTo(720, 3);
    for (const x of [s.ax, s.bx]) {
      expect(x, `sep ${sep} fighter on screen`).toBeGreaterThan(s.view.left);
      expect(x, `sep ${sep} fighter on screen`).toBeLessThan(s.view.right);
    }
  }
});

test("a cornered body is framed whole, not cropped by the stage bound", async ({ page }) => {
  // The camera can never scroll past the world edge, so a fighter parked at STAGE_MARGIN is only
  // fully visible if the margin is at least as wide as the art. It was 90 against a 116px jiujitsu
  // KO silhouette, so a wall KO lost 26 world px — cropped at 1:1 and more obviously at 1.25x.
  // Assert the geometric invariant rather than the constant, so re-measured art fails here.
  await ready(page);
  const WIDEST = 116; // jiujitsu `ko` frames 3-5, measured off the sheets
  for (const wall of ["left", "right"] as const) {
    await page.evaluate((wall) => {
      const w = window as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      const x = wall === "left" ? 0 : 1696;
      w.__world.match.phase = "fight";
      w.__world.match.introTicks = 0;
      w.__world.fighters[0].reset(x, 1);
      w.__world.fighters[1].reset(x, -1); // both shoved into the same corner
    }, wall);
    await pump(page, 90);
    const s = await camState(page);
    for (const x of [s.ax, s.bx]) {
      expect(x - WIDEST, `${wall} wall: body clipped off the left of the view`).toBeGreaterThanOrEqual(s.view.left - 1e-6);
      expect(x + WIDEST, `${wall} wall: body clipped off the right of the view`).toBeLessThanOrEqual(s.view.right + 1e-6);
    }
  }
});

test("the camera holds still until a fighter gives ground", async ({ page }) => {
  await ready(page);
  await separate(page, 400);
  const before = await camState(page);
  await pump(page, 30); // nobody moves
  const idle = await camState(page);
  expect(idle.view.left).toBeCloseTo(before.view.left, 6);

  // one fighter walks: the camera follows the midpoint, so it moves by half the walked distance
  await page.evaluate(() => (window as any).__holdP1({ right: true })); // eslint-disable-line @typescript-eslint/no-explicit-any
  await pump(page, 30);
  await page.evaluate(() => (window as any).__holdP1({})); // eslint-disable-line @typescript-eslint/no-explicit-any
  const moved = await camState(page);
  expect(Math.abs(moved.view.left - idle.view.left)).toBeGreaterThan(1);
});

test("every game object renders on exactly one camera", async ({ page }) => {
  await ready(page);
  // Force the end menu to exist and be visible, so its objects are included in the audit.
  await page.evaluate(() => { (window as any).__world.match.phase = "matchEnd"; }); // eslint-disable-line @typescript-eslint/no-explicit-any
  await pump(page, 4);

  const audit = await page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const scene = (window as any).__game.scene.getScene("Match");
    const [main, ui] = scene.cameras.cameras as any[];
    return (scene.children.list as any[]).map((o) => ({
      type: o.type,
      depth: o.depth,
      onMain: (o.cameraFilter & main.id) === 0,
      onUi: (o.cameraFilter & ui.id) === 0,
    }));
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });

  expect(audit.length).toBeGreaterThan(5);
  for (const o of audit) {
    // Exactly one: on both = a doubled ghost (one zoomed, one not); on neither = invisible.
    expect(Number(o.onMain) + Number(o.onUi), `${o.type}@${o.depth} camera assignment`).toBe(1);
  }
  // and the split is the intended one: HUD/menu depths on the UI camera, world depths on main
  expect(audit.some((o) => o.onUi && o.depth >= 99)).toBe(true);
  expect(audit.some((o) => o.onMain && o.depth < 99)).toBe(true);
});

test("the UI camera does not zoom with the world", async ({ page }) => {
  await ready(page);
  await separate(page, 120); // world camera at max zoom
  const zooms = await page.evaluate(() => {
    const scene = (window as any).__game.scene.getScene("Match"); // eslint-disable-line @typescript-eslint/no-explicit-any
    const [main, ui] = scene.cameras.cameras as { zoomX: number }[];
    return { main: main.zoomX, ui: ui.zoomX };
  });
  expect(zooms.main).toBeCloseTo(1.25, 3);
  expect(zooms.ui).toBe(1); // the HUD must not grow with the zoom — that is why it has its own camera
});
