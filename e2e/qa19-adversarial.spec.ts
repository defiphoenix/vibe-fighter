import { test, expect, devices, type Page } from "@playwright/test";
import { MATCH, pump, ready as harnessReady } from "./harness";
import { touchLayout, type TouchButton, TOUCH_BUTTONS } from "../src/render/touch";
import { STAGE_HEIGHT, STAGE_WIDTH, VIEW_WIDTH } from "../src/sim/constants";

/* eslint-disable @typescript-eslint/no-explicit-any */

// INDEPENDENT QA for the Phase 19 acceptance criteria, written from the criteria alone.
// Deliberately aimed at the gaps in the committed suite: it only ever taps LIGHT and RIGHT, never
// exercises a rotation or a fullscreen transition with a contact HELD, never uses iPhone 13, and
// asserts nothing about a match being winnable.
//
// PROVENANCE: written by an independent QA agent that was given the acceptance criteria and nothing
// else — not the diff, not the implementer's conclusions. KEPT deliberately rather than deleted,
// because it earned it: it found a REAL defect the committed suite could not see (a jiujitsu CPU
// dealing zero damage for an entire round, because deriving the CPU's ranges from the boxes had left a
// dead zone between its heavy at 110px and its light at 113px — see cpu.ts `Reaches`). Two fixes were
// applied to the file itself before promotion: its round-clock reset (see `setup` below) and this note.
// Every case here passes; the CPU fix is pinned independently in src/sim/cpu.test.ts.

const { defaultBrowserType: _p5, ...PIXEL } = devices["Pixel 5 landscape"];
const { defaultBrowserType: _i13, ...IPHONE } = devices["iPhone 13 landscape"];

const gameW = (page: Page): Promise<number> =>
  page.evaluate(() => (window as any).__game.scale.gameSize.width as number);

/** CSS-pixel centre of a pad button, from the LIVE game width and the canvas rect Phaser currently
 *  believes in. A tap computed from the viewport, or from `touchLayout()` with no argument, lands on
 *  empty stage — which reads as "the button does nothing" rather than as a broken helper. */
async function buttonXY(page: Page, id: TouchButton): Promise<{ x: number; y: number }> {
  const w = await gameW(page);
  const b = touchLayout(Math.round(w), STAGE_HEIGHT).find((x) => x.id === id)!;
  return page.evaluate(({ gx, gy }) => {
    const s = (window as any).__game.scale;
    return { x: s.canvasBounds.left + gx / s.displayScale.x, y: s.canvasBounds.top + gy / s.displayScale.y };
  }, { gx: b.x, gy: b.y });
}

async function stageFight(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = (window as any).__world;
    w.match.phase = "fight";
    w.match.introTicks = 0;
    w.fighters[0].reset(760, 1);
    w.fighters[1].reset(1000, -1);
    w.fighters[0].meter = 100; // METER_MAX — the SUPER button is refused (silently) without it
  });
  await pump(page, 2);
}

const p1 = (page: Page): Promise<any> =>
  page.evaluate(() => {
    const f = (window as any).__world.fighters[0];
    return { state: f.state, x: f.x, y: f.y, grounded: f.grounded };
  });

// Which sim state each button must produce. State names are the sim's own (walkF/walkB, jumpRise).
const EXPECT: Record<TouchButton, (s: any, base: any) => boolean> = {
  left: (s, b) => s.x < b.x && s.state === "walkB",
  right: (s, b) => s.x > b.x && s.state === "walkF",
  up: (s) => s.state === "jumpRise" || s.grounded === false,
  down: (s) => s.state === "crouch",
  light: (s) => s.state === "attackLight",
  heavy: (s) => s.state === "attackHeavy",
  block: (s) => s.state === "block",
  special: (s) => s.state === "special",
};

/** Criterion 4 + 1 + 2 + 3, run on three different device profiles. */
function padSuite(label: string): void {
  test(`[${label}] all 8 pad buttons produce their own input at the drawn centre`, async ({ page }) => {
    test.slow();
    await harnessReady(page, { route: MATCH, needs: ["__sprites", "__world", "__game"] });
    const w = await gameW(page);
    // Fixture guard: without a widened game this only re-tests the 1280 layout, and the criterion
    // ("not just at 1280") would be unproven while every assertion passed.
    expect(w, "the game never widened — this case would pass for the wrong reason").toBeGreaterThan(VIEW_WIDTH);

    const cdp = await page.context().newCDPSession(page);
    const results: Record<string, any> = {};
    for (const id of TOUCH_BUTTONS) {
      await stageFight(page);
      const base = await p1(page);
      const xy = await buttonXY(page, id);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: xy.x, y: xy.y }] });
      await pump(page, 8);
      const seen = await p1(page);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await pump(page, 30);
      results[id] = { ok: EXPECT[id](seen, base), state: seen.state, dx: Math.round(seen.x - base.x), at: xy };
    }
    for (const id of TOUCH_BUTTONS) {
      expect(results[id].ok, `${id}: ${JSON.stringify(results[id])}`).toBe(true);
    }
  });

  test(`[${label}] the game takes the device aspect, is centred, both cameras follow, nothing hangs off`, async ({ page }) => {
    await harnessReady(page, { route: MATCH, needs: ["__game", "__world"] });
    await page.evaluate(() => { (window as any).__world.match.introTicks = 0; });
    await pump(page, 8);
    const m = await page.evaluate(() => {
      const g = (window as any).__game;
      const s = g.scale;
      const scene = g.scene.getScene("Match");
      const [main, ui] = scene.cameras.cameras as any[];
      const r = g.canvas.getBoundingClientRect();
      // Phaser's Rectangle exposes right/bottom as prototype GETTERS, so a spread silently drops them
      // and every comparison below would read `undefined`. Copy the numbers explicitly.
      const objs = (scene.children.list as any[])
        .filter((o) => o.scrollFactorX === 0 && o.visible && typeof o.getBounds === "function")
        .map((o) => { const b = o.getBounds(); return { d: o.depth, t: o.type, left: b.left, right: b.right }; });
      return {
        gameW: s.gameSize.width, gameH: s.gameSize.height,
        parentW: s.parentSize.width, parentH: s.parentSize.height,
        left: r.left, right: r.right, innerW: window.innerWidth,
        mainW: main.width, uiW: ui.width,
        worst: objs.reduce((a, b) => (b.right > a.right ? b : a), objs[0]),
        minLeft: Math.min(...objs.map((o) => o.left)),
      };
    });
    expect(m.gameH, "the stage art is exactly this tall").toBe(STAGE_HEIGHT);
    expect(m.gameW).toBe(Math.min(STAGE_WIDTH, Math.max(VIEW_WIDTH, Math.round((STAGE_HEIGHT * m.parentW) / m.parentH))));
    const L = m.left, R = m.innerW - m.right;
    expect(Math.abs(L - R), `bars L${L} R${R}`).toBeLessThanOrEqual(2);
    expect(m.mainW, "main camera").toBe(m.gameW);
    expect(m.uiW, "ui camera — P2's HUD lives out here").toBe(m.gameW);
    expect(m.worst.right, `${m.worst.t}@${m.worst.d} hangs off the right edge`).toBeLessThanOrEqual(m.gameW + 1);
    expect(m.minLeft, "something screen-space hangs off the left edge").toBeGreaterThanOrEqual(-1);
  });
}

test.describe("pixel 5 landscape", () => {
  test.use({ ...PIXEL });
  padSuite("pixel5");

  /** Criterion 3 as a player sees it: P2's three HUD pieces are whole on screen. */
  test("P2's portrait plate, health bar and meter are all fully on screen", async ({ page }) => {
    await harnessReady(page, { route: MATCH, needs: ["__game", "__world"] });
    await page.evaluate(() => { (window as any).__world.match.introTicks = 0; });
    await pump(page, 8);
    const m = await page.evaluate(() => {
      const g = (window as any).__game;
      const scene = g.scene.getScene("Match");
      const W = g.scale.gameSize.width;
      const hud = (scene.children.list as any[])
        .filter((o) => (o.depth === 100 || o.depth === 101) && o.visible && typeof o.getBounds === "function")
        .map((o) => { const b = o.getBounds(); return { t: o.type, f: String(o.frame?.name ?? ""), l: Math.round(b.left), r: Math.round(b.right) }; })
        .filter((o) => o.l > W / 2); // P2's side — the one a stale 1280 UI camera cropped
      return { W, hud };
    });
    expect(m.hud.length, "nothing of the HUD is on P2's half at all").toBeGreaterThanOrEqual(3);
    for (const o of m.hud) expect(o.r, `${o.t}/${o.f} right edge ${o.r} vs game width ${m.W}`).toBeLessThanOrEqual(m.W + 1);
    expect(Math.max(...m.hud.map((o) => o.r)), "P2's HUD is still anchored to 1280").toBeGreaterThan(VIEW_WIDTH);
  });

  /**
   * Criterion 5a: a finger PHYSICALLY DOWN on RIGHT across portrait -> landscape.
   *
   * Two silent failure modes: while `game.input.enabled` is false Phaser discards the touchend, so the
   * Pointer keeps reporting isDown and the pad's reconcile believes it (a permanently held button);
   * and `TouchPadState` keeps its OWN copy of the layout, so a relayout that moves only the drawn art
   * leaves the hit test behind.
   */
  test("rotate to portrait and back with a button HELD: no stuck input, pad re-anchored", async ({ page }) => {
    test.slow();
    await harnessReady(page, { route: MATCH, needs: ["__sprites", "__world", "__game"] });
    await stageFight(page);
    const cdp = await page.context().newCDPSession(page);
    const right = await buttonXY(page, "right");

    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: right.x, y: right.y }] });
    await pump(page, 10);
    expect((await p1(page)).state, "RIGHT never engaged — everything below would be vacuous").toBe("walkF");

    const v = page.viewportSize()!;
    await page.setViewportSize({ width: v.height, height: v.width }); // portrait; contact NOT lifted
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("rotate"))).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as any).__game.input.enabled)).toBe(false);

    await page.setViewportSize(v); // back to landscape
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("rotate"))).toBe(false);
    await expect.poll(() => page.evaluate(() => (window as any).__game.input.enabled)).toBe(true);
    // applyOrientation() only wakes a loop IT slept, but re-stop defensively so the pump is the clock.
    await page.evaluate(() => (window as any).__game.loop.stop());

    const a = await page.evaluate(() => (window as any).__world.fighters[0].x as number);
    await pump(page, 40);
    const b = await page.evaluate(() => (window as any).__world.fighters[0].x as number);
    expect(b, `P1 kept walking after the rotation (${a} -> ${b}) = the contact stuck`).toBe(a);

    // Both copies of the layout followed: a fresh tap at the NEW drawn centre still works.
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await pump(page, 4);
    const right2 = await buttonXY(page, "right");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: right2.x, y: right2.y }] });
    await pump(page, 10);
    expect((await p1(page)).state, "the pad's hit test did not follow the relayout").toBe("walkF");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  });

  /**
   * Criterion 5b: a fullscreen enter/leave with a contact held. Phaser's fullscreen needs user
   * activation, which `page.evaluate` has not got, so this drives what a fullscreen transition DOES to
   * the game — a differently-sized parent plus Phaser's ENTER/LEAVE_FULLSCREEN events — and checks the
   * layout is consistent afterwards and the held button did not stick.
   */
  test("a fullscreen enter/leave with a button HELD leaves no stuck input and no stale layout", async ({ page }) => {
    test.slow();
    await harnessReady(page, { route: MATCH, needs: ["__sprites", "__world", "__game"] });
    await stageFight(page);
    const cdp = await page.context().newCDPSession(page);
    const light = await buttonXY(page, "light");
    const v = page.viewportSize()!;

    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: light.x, y: light.y }] });
    await pump(page, 6);
    expect((await p1(page)).state, "LIGHT never came out").toBe("attackLight");

    await page.setViewportSize({ width: 1000, height: 420 });
    await page.evaluate(() => { const g = (window as any).__game; g.scale.emit("enterfullscreen"); g.scale.refresh(); });
    await pump(page, 6);
    await page.setViewportSize(v);
    await page.evaluate(() => { const g = (window as any).__game; g.scale.emit("leavefullscreen"); g.scale.refresh(); });
    await pump(page, 6);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await pump(page, 40);

    const after = await page.evaluate(() => {
      const g = (window as any).__game;
      const scene = g.scene.getScene("Match");
      const [main, ui] = scene.cameras.cameras as any[];
      return {
        W: g.scale.gameSize.width, mainW: main.width, uiW: ui.width,
        btns: (scene.children.list as any[]).filter((o) => o.depth === 96).map((o) => ({ x: Math.round(o.x), y: Math.round(o.y) })),
        state: (window as any).__world.fighters[0].state,
      };
    });
    // Art vs hit test: the DRAWN positions must be the layout for the live width, or taps miss.
    expect(after.btns, `pad art stale at width ${after.W}`).toEqual(touchLayout(after.W, STAGE_HEIGHT).map((b) => ({ x: b.x, y: b.y })));
    expect(after.uiW, "ui camera stale").toBe(after.W);
    expect(after.mainW, "main camera stale").toBe(after.W);
    expect(["idle", "walkF", "walkB", "hitstun", "blockstun", "crouch"], `stuck in ${after.state}`).toContain(after.state);
  });

  /** Criterion 8: a pressed state PER button, and art that is actually different — a frame NAME
   *  assertion is satisfied by two identical pictures. */
  test("every button has its own pressed frame, and the pressed art is measurably different", async ({ page }) => {
    test.slow();
    await harnessReady(page, { route: MATCH, needs: ["__sprites", "__world", "__game"] });
    await stageFight(page);
    const cdp = await page.context().newCDPSession(page);
    const framesNow = (): Promise<string[]> => page.evaluate(() => {
      const scene = (window as any).__game.scene.getScene("Match");
      return (scene.children.list as any[]).filter((o) => o.depth === 96).map((o) => o.frame.name);
    });

    for (const id of TOUCH_BUTTONS) {
      const xy = await buttonXY(page, id);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: xy.x, y: xy.y }] });
      await pump(page, 2);
      expect((await framesNow()).filter((f) => f.endsWith("-down")), `${id}: exactly one pressed frame`).toHaveLength(1);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await pump(page, 4);
      expect((await framesNow()).filter((f) => f.endsWith("-down")), `${id}: stayed pressed after release`).toHaveLength(0);
    }

    const delta = await page.evaluate(() => {
      const tex = (window as any).__game.textures.get("pad-atlas");
      const src: any = tex.getSourceImage();
      const c = document.createElement("canvas");
      c.width = src.width; c.height = src.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(src, 0, 0);
      const read = (name: string): Uint8ClampedArray => {
        const f = tex.get(name);
        return ctx.getImageData(f.cutX, f.cutY, f.width, f.height).data;
      };
      const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
        let n = 0;
        for (let i = 0; i < a.length; i += 4) {
          if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) + Math.abs(a[i + 3] - b[i + 3]) > 24) n++;
        }
        return n / (a.length / 4);
      };
      return {
        move: diff(read("pad-move"), read("pad-move-down")),
        action: diff(read("pad-action"), read("pad-action-down")),
        families: diff(read("pad-move"), read("pad-action")),
        opaque: (() => { const d = read("pad-move"); let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++; return n / (d.length / 4); })(),
      };
    });
    // Fixture guard: an all-transparent frame would score 0 on every diff and read as "no difference".
    expect(delta.opaque, "the idle frame is blank — the atlas did not draw").toBeGreaterThan(0.3);
    expect(delta.move, `movement pressed art differs by ${(delta.move * 100).toFixed(1)}%`).toBeGreaterThan(0.05);
    expect(delta.action, `action pressed art differs by ${(delta.action * 100).toFixed(1)}%`).toBeGreaterThan(0.05);
    expect(delta.families, "movement and action buttons are the same picture").toBeGreaterThan(0.02);
  });
});

test.describe("iphone 13 landscape", () => {
  test.use({ ...IPHONE });
  padSuite("iphone13");
});

test.describe("a phone whose aspect fits inside the world (900x415)", () => {
  test.use({ viewport: { width: 900, height: 415 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  padSuite("900x415");
});

// Criterion 2 at the aspects a phone profile cannot reach.
test.describe("centring at aspects where bars exist", () => {
  const cases: [number, number, string][] = [
    [1000, 800, "narrower than 16:9 -> clamped up to VIEW_WIDTH, bars top/bottom"],
    [2000, 600, "wider than the world -> clamped down to STAGE_WIDTH, bars left/right"],
    [1400, 700, "inside the band -> no bars at all"],
  ];
  for (const [w, h, why] of cases) {
    test(`${w}x${h}: ${why}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await harnessReady(page, { route: MATCH, needs: ["__game", "__world"] });
      await pump(page, 2);
      const m = await page.evaluate(() => {
        const g = (window as any).__game;
        const r = g.canvas.getBoundingClientRect();
        return {
          gameW: g.scale.gameSize.width,
          parentW: g.scale.parentSize.width, parentH: g.scale.parentSize.height,
          L: r.left, R: window.innerWidth - r.right, T: r.top, B: window.innerHeight - r.bottom,
        };
      });
      expect(m.gameW).toBe(Math.min(STAGE_WIDTH, Math.max(VIEW_WIDTH, Math.round((STAGE_HEIGHT * m.parentW) / m.parentH))));
      expect(Math.abs(m.L - m.R), `horizontal bars L${m.L} R${m.R}`).toBeLessThanOrEqual(2);
      expect(Math.abs(m.T - m.B), `vertical bars T${m.T} B${m.B}`).toBeLessThanOrEqual(2);
      const aspect = w / h;
      if (aspect > VIEW_WIDTH / STAGE_HEIGHT && aspect < STAGE_WIDTH / STAGE_HEIGHT) {
        expect(m.L, "an in-band aspect must leave no horizontal bar").toBeLessThanOrEqual(2);
        expect(m.T, "an in-band aspect must leave no vertical bar").toBeLessThanOrEqual(2);
      }
    });
  }
});

// ---------------------------------------------------------------------------------------------
// Criterion 7.
test.describe("reach and winnability", () => {
  /** Measures the largest separation at which the ground heavy still connects, and compares it with the
   *  separation at which the two bodies (pushboxes) are actually touching. Then WIDENS the hit box in
   *  memory by the amount Phase 19 removed and re-measures: that is the mutation this assertion is
   *  written against, run inside the case so the threshold cannot be decoration. */
  test("a heavy connects body-to-body and does not reach across a large gap", async ({ page }) => {
    await harnessReady(page, { route: MATCH, needs: ["__world", "__game"] });
    const r = await page.evaluate(() => {
      const w = (window as any).__world;
      const EMPTY: any = { left: false, right: false, up: false, down: false, light: false, heavy: false, block: false, special: false, upPressed: false, lightPressed: false, heavyPressed: false, specialPressed: false };
      const HEAVY: any = { ...EMPTY, heavy: true, heavyPressed: true };
      // `Fighter.reset()` deliberately keeps health (it is the ROUND reset), so a sweep of ~90 landed
      // heavies drains P2 to 0 and every later "did health drop" read is false — which silently
      // returned null from the second sweep and made the fixture guard below look like a real failure.
      // `Fighter.reset()` deliberately keeps health (it is the ROUND reset), and `wins`/`hitstop`
      // accumulate across ~90 scripted KOs — left alone, the second sweep runs in a match that is
      // already over and reports zero connects, which looks exactly like a real regression.
      const setup = (sep: number): void => {
        w.match.phase = "fight"; w.match.matchWinner = null; w.match.wins = [0, 0];
        w.match.introTicks = 0; w.hitstop = 0;
        // The ROUND CLOCK, and it is load-bearing. Each sweep burns ~6000 ticks of game time, so by
        // the second one the 60s timer is long expired: `phase` was being set back to "fight" only for
        // the timeout to fire again on the very next tick, ending the round before the heavy's 9-tick
        // startup could finish. Every separation then reported "no connect" and the widened control
        // sweep came back null — which reads exactly like the box mutation having no effect.
        w.match.timerTicks = 60 * 60;
        w.fighters[0].reset(700, 1); w.fighters[1].reset(700 + sep, -1);
        for (const f of w.fighters) f.health = f.cfg.stats.maxHealth;
      };
      // Bodies touching: drop them on top of each other and let spatial.ts push them apart.
      setup(0);
      for (let i = 0; i < 10; i++) w.tick([EMPTY, EMPTY]);
      const contact = Math.abs(w.fighters[1].x - w.fighters[0].x);

      const maxConnect = (): number | null => {
        let best: number | null = null;
        for (let sep = Math.floor(contact); sep <= 400; sep += 2) {
          setup(sep);
          const h0 = w.fighters[1].health;
          w.tick([HEAVY, EMPTY]);
          for (let i = 0; i < 40; i++) w.tick([EMPTY, EMPTY]);
          if (w.fighters[1].health < h0) best = sep;
        }
        return best;
      };
      const shipped = maxConnect();
      // MUTATION, in memory: put back the 30px of reach Phase 19 trimmed off the ground heavy. Only
      // fighter 0 attacks, so only its boxes matter, and touching one state keeps the mutation legible.
      const seen = new Set<any>();
      for (const fr of w.fighters[0].cfg.states.attackHeavy.frames as any[]) {
        for (const hb of fr.hit ?? []) { if (seen.has(hb)) continue; seen.add(hb); hb.w += 30; }
      }
      const widened = maxConnect();
      return { contact: Math.round(contact), shipped, widened };
    });
    expect(r.shipped, "a heavy does not connect with the bodies touching").not.toBeNull();
    const air = r.shipped! - r.contact;
    // Fixture guard: the threshold below is only meaningful if the measurement responds to reach.
    expect(r.widened!, "widening the hit box changed nothing — this case measures nothing")
      .toBeGreaterThan(r.shipped!);
    // Shipped numbers measure 92px past body contact; the pre-trim box measured 122px, so 100 is a
    // threshold the OLD geometry fails and the new one clears — not a number fitted to whatever passes.
    expect(air, `heavy reaches ${air}px past body contact (contact ${r.contact}, max connect ${r.shipped}); the +30px box reaches ${r.widened! - r.contact}px`)
      .toBeLessThanOrEqual(100);
  });

  /** Winnability, per difficulty, driven through the REAL `CpuController` on `World.advance` — the same
   *  seam MatchScene uses — inside one page.evaluate so a whole best-of-3 costs milliseconds instead of
   *  20 000 rendered frames. The player is a script: close the gap, then alternate heavy. */
  for (const [difficulty, scale] of [["easy", 0.55], ["normal", 0.7], ["hard", 0.85]] as [string, number][]) {
    test(`a full match is winnable on ${difficulty}`, async ({ page }) => {
      test.slow();
      await harnessReady(page, { route: MATCH, needs: ["__world", "__game"] });
      await page.evaluate((d) => {
        (window as any).__world = null;
        (window as any).__game.scene.start("Match", { mode: "cpu", difficulty: d, stageId: "twilight", fighters: ["brawler", "jiujitsu"] });
      }, difficulty);
      for (let i = 0; i < 20 && !(await page.evaluate(() => (window as any).__world != null)); i++) await pump(page, 20);
      await page.evaluate(() => (window as any).__game.loop.stop());
      expect(await page.evaluate(() => (window as any).__world.fighters[1].damageScale)).toBeCloseTo(scale, 5);

      const out = await page.evaluate(() => {
        const w = (window as any).__world;
        const cpu = (window as any).__game.scene.getScene("Match").cpu;
        if (!cpu) throw new Error("no CpuController on the scene — this case would test nothing");
        const EMPTY: any = { left: false, right: false, up: false, down: false, light: false, heavy: false, block: false, special: false, upPressed: false, lightPressed: false, heavyPressed: false, specialPressed: false };
        let edge = false;
        for (let t = 0; t < 25_000 && w.match.matchWinner == null; t++) {
          const a = w.fighters[0], b = w.fighters[1];
          const gap = Math.abs(b.x - a.x);
          let inp: any;
          if (gap > 110) inp = { ...EMPTY, [b.x > a.x ? "right" : "left"]: true };
          else { edge = !edge; inp = edge ? { ...EMPTY, heavy: true, heavyPressed: true } : EMPTY; }
          w.advance(1 / 60, [inp, EMPTY], cpu);
        }
        return { winner: w.match.matchWinner, wins: [...w.match.wins], health: w.fighters.map((f: any) => f.health) };
      });
      expect(out.winner, `no result after 25 000 ticks on ${difficulty}: ${JSON.stringify(out)}`).not.toBeNull();
      expect(out.winner, `the player cannot win on ${difficulty}: ${JSON.stringify(out)}`).toBe(0);
    });
  }

  test("the hard CPU can still beat a player who never moves", async ({ page }) => {
    test.slow();
    await harnessReady(page, { route: MATCH, needs: ["__world", "__game"] });
    await page.evaluate(() => {
      (window as any).__world = null;
      (window as any).__game.scene.start("Match", { mode: "cpu", difficulty: "hard", stageId: "twilight", fighters: ["brawler", "jiujitsu"] });
    });
    for (let i = 0; i < 20 && !(await page.evaluate(() => (window as any).__world != null)); i++) await pump(page, 20);
    await page.evaluate(() => (window as any).__game.loop.stop());
    const out = await page.evaluate(() => {
      const w = (window as any).__world;
      const cpu = (window as any).__game.scene.getScene("Match").cpu;
      const EMPTY: any = { left: false, right: false, up: false, down: false, light: false, heavy: false, block: false, special: false, upPressed: false, lightPressed: false, heavyPressed: false, specialPressed: false };
      for (let t = 0; t < 25_000 && w.match.matchWinner == null; t++) w.advance(1 / 60, [EMPTY, EMPTY], cpu);
      return { winner: w.match.matchWinner, wins: [...w.match.wins] };
    });
    expect(out.winner, `the hard CPU cannot beat a statue: ${JSON.stringify(out)}`).toBe(1);
  });
});

test.describe("desktop is not regressed", () => {
  test("no pad, keyboard legend visible, cameras match the game width", async ({ page }) => {
    await harnessReady(page, { route: MATCH, needs: ["__game", "__world"] });
    const m = await page.evaluate(() => {
      const g = (window as any).__game;
      const scene = g.scene.getScene("Match");
      const [main, ui] = scene.cameras.cameras as any[];
      return {
        gameW: g.scale.gameSize.width,
        pad: (scene.children.list as any[]).filter((o) => o.depth === 96).length,
        mainW: main.width, uiW: ui.width,
        touch: document.documentElement.classList.contains("touch"),
        legend: (scene.children.list as any[]).filter((o) => o.type === "Text" && o.depth === 101 && o.visible).length,
      };
    });
    expect(m.touch, "a desktop context must not classify as touch").toBe(false);
    expect(m.pad, "a pad was built on desktop").toBe(0);
    expect(m.mainW).toBe(m.gameW);
    expect(m.uiW).toBe(m.gameW);
    expect(m.legend, "the keyboard legend vanished on desktop").toBeGreaterThan(0);
  });
});
