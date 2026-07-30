import { test, expect, devices, type Page } from "@playwright/test";
import { MATCH, keys, pump, pumpUntil, ready as harnessReady } from "./harness";
import { touchLayout, type TouchButton } from "../src/render/touch";
import { STAGE_HEIGHT, STAGE_WIDTH, VIEW_WIDTH } from "../src/sim/constants";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Phase 18 acceptance: the game is playable on a phone.
//
// Everything here runs on a REAL device profile (`devices["Pixel 5 landscape"]` — isMobile + hasTouch
// + a phone viewport), not a bare `hasTouch: true` context. The classification is "has touch AND no
// fine pointer", and only full mobile emulation changes pointer fineness; a hasTouch flag on a desktop
// context would still report `any-pointer: fine` and the whole phase would switch off underneath the
// spec while it passed for the wrong reason.
//
// Input goes through REAL touch events (`page.touchscreen` / CDP `Input.dispatchTouchEvent`), never
// the `__holdP1` seam: that seam injects AFTER InputReader, so a spec using it would prove nothing
// about the touch wiring — which is the entire phase.

// `defaultBrowserType` cannot be set inside a describe (it forces a new worker), so the device
// profile is spread minus that one key. Everything that matters here — the phone viewport, the mobile
// user agent, `isMobile` (which is what makes Chromium report a coarse-only pointer) and `hasTouch` —
// comes straight from Playwright's own Pixel 5 definition.
const { defaultBrowserType: _ignored, ...PHONE } = devices["Pixel 5 landscape"];
const flowReady = (page: Page): Promise<void> => harnessReady(page, { needs: ["__game", "__flow"] });

/** A pad button's position in CSS pixels. `displayScale` is base÷displayed, so it DIVIDES.
 *
 *  The layout MUST be computed from the live game width. Phase 19 reshapes the game to the device's
 *  aspect, so on this profile it is ~1559 wide and the right-hand cluster sits at x≈1399 — a
 *  `touchLayout()` with no argument would put it at 1120 and every action tap would land on empty
 *  stage. That reads as "the button does nothing", not as a broken helper. */
async function buttonXY(page: Page, id: TouchButton): Promise<{ x: number; y: number }> {
  const gameW = await page.evaluate(() => (window as any).__game.scale.gameSize.width as number);
  const b = touchLayout(Math.round(gameW), STAGE_HEIGHT).find((x) => x.id === id)!;
  return page.evaluate(({ gx, gy }) => {
    const s = (window as any).__game.scale;
    return {
      x: s.canvasBounds.left + gx / s.displayScale.x,
      y: s.canvasBounds.top + gy / s.displayScale.y,
    };
  }, { gx: b.x, gy: b.y });
}

/** Park the pair in poking range with the intro over — the same world poke camera-group.spec.ts uses.
 *  The INPUT still has to come from a finger; only the staging is scripted. */
async function stageFight(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = (window as any).__world;
    w.match.phase = "fight";
    w.match.introTicks = 0;
    w.fighters[0].reset(800, 1);
    w.fighters[1].reset(895, -1);
  });
  await pump(page, 2);
}

const health = (page: Page): Promise<number[]> =>
  page.evaluate(() => (window as any).__world.fighters.map((f: any) => f.health));

test.describe("phone (touch profile)", () => {
  test.use({ ...PHONE });

  test("the device is classified as touch-primary, not just touch-capable", async ({ page }) => {
    await flowReady(page);
    const env = await page.evaluate(() => ({
      maxTouchPoints: navigator.maxTouchPoints,
      pointerCoarse: window.matchMedia("(pointer: coarse)").matches,
      htmlHasTouchClass: document.documentElement.classList.contains("touch"),
    }));
    // If this ever flips, every other assertion in this file passes for the wrong reason.
    expect(env.maxTouchPoints).toBeGreaterThan(0);
    expect(env.pointerCoarse).toBe(true);
    expect(env.htmlHasTouchClass).toBe(true);
    // The emulator agreed with the PREVIOUS predicate too, and a real Samsung S23+ did not: Android
    // reports `any-pointer: fine` TRUE for stylus/DeX capability, which switched the entire phase off
    // on the one device it was built for. Recorded here so nobody re-derives that discriminator from
    // an emulation that cannot show the difference.
    expect(
      await page.evaluate(() => window.matchMedia("(any-pointer: fine)").matches),
      "emulation cannot prove anything about any-pointer: fine on real hardware",
    ).toBe(false);
  });

  // --- Phase 19: the game fills the phone, and is centred on it ---------------------------------
  //
  // This case exists because NOTHING ELSE CAN CATCH THE FAILURE IT GUARDS. The width decision itself
  // is pure and unit-tested, but the bug it replaced was that the decision was never APPLIED: Phaser
  // refreshes the scale during boot and again on READY, both before main.ts can subscribe, and its
  // 500ms poll only refreshes when the parent size actually CHANGES. A phone that opens in landscape
  // and is then left alone emits no further RESIZE — so the game would sit at 1280 forever with a
  // fully green unit suite. Only measuring the real thing on a real profile says otherwise.
  test("the game is reshaped to the phone's aspect, centred, with both cameras following", async ({ page }) => {
    await harnessReady(page, { route: MATCH, needs: ["__game", "__world"] });
    const m = await page.evaluate(() => {
      const g = (window as any).__game;
      const s = g.scale;
      const scene = g.scene.getScene("Match");
      const [main, ui] = scene.cameras.cameras as any[];
      const canvas = g.canvas.getBoundingClientRect();
      return {
        gameW: s.gameSize.width,
        gameH: s.gameSize.height,
        parentW: s.parentSize.width,
        parentH: s.parentSize.height,
        canvas: { left: canvas.left, right: canvas.right, width: canvas.width },
        innerW: window.innerWidth,
        mainW: main.width,
        uiW: ui.width,
      };
    });

    // 1. The game took the DEVICE's aspect, not the authored one — clamped to the world, because a
    //    camera cannot show stage that does not exist. This emulated profile reports a 2.74:1 parent,
    //    which is wider than the world's own 2.36:1, so it lands ON the ceiling.
    expect(m.gameH, "the stage art is exactly this tall; height must never move").toBe(STAGE_HEIGHT);
    expect(m.gameW, "still at the authored width = applyViewport never ran").toBeGreaterThan(VIEW_WIDTH);
    const want = Math.min(STAGE_WIDTH, Math.max(VIEW_WIDTH, Math.round((STAGE_HEIGHT * m.parentW) / m.parentH)));
    expect(m.gameW).toBe(want);

    // 2. It is CENTRED. Half the original complaint: the canvas sat off to the right because
    //    index.html centred it as a grid item AND Phaser centred it with a margin, and the two
    //    stacked. Whenever bars DO exist they must be the same size on both sides.
    //    Tolerance is 2px, and that is the floor of what is achievable rather than slack: Phaser
    //    centres with `marginLeft = Math.floor((parentW - displayW) / 2)` while the display width is
    //    fractional (690.17 here), so up to ~2px of asymmetry is baked into the integer margin. The
    //    defect this guards was a quarter of the whole gap — ~28px on this profile.
    const leftBar = m.canvas.left;
    const rightBar = m.innerW - m.canvas.right;
    expect(Math.abs(leftBar - rightBar), `bars L${leftBar} R${rightBar}`).toBeLessThanOrEqual(2);

    // 3. Whatever bar is left is strictly less than the authored width would have given. This is the
    //    honest form of "fills the screen" on a viewport too wide for the world: FIT is height-bound
    //    here, so a 1280-wide game would draw 521px into an 802px viewport (281px of bar) where 1696
    //    draws ~690 (112px). Asserting the improvement rather than perfection keeps the case true.
    const barsNow = m.innerW - m.canvas.width;
    const barsAtAuthoredWidth = m.innerW - VIEW_WIDTH * (m.canvas.width / m.gameW);
    expect(barsNow).toBeLessThan(barsAtAuthoredWidth);

    // 4. BOTH cameras followed. `CameraManager.onResize` only auto-resizes a camera whose size
    //    equalled the previous game size, so the UI camera — created explicitly — is the one that
    //    silently stays 1280 and crops P2's plate off the screen.
    expect(m.mainW, "main camera").toBe(m.gameW);
    expect(m.uiW, "UI camera — P2's HUD plate lives out here").toBe(m.gameW);
  });

  test("P2's HUD plate and the pad's right cluster are on screen at the phone's width", async ({ page }) => {
    await harnessReady(page, { route: MATCH, needs: ["__game", "__world"] });
    await pump(page, 2);
    const m = await page.evaluate(() => {
      const g = (window as any).__game;
      const scene = g.scene.getScene("Match");
      const w = g.scale.gameSize.width;
      // Every screen-space object's right edge, so a plate hanging off the side is a number.
      const rights = (scene.children.list as any[])
        .filter((o) => o.scrollFactorX === 0 && o.visible && typeof o.getBounds === "function")
        .map((o) => ({ depth: o.depth, right: o.getBounds().right, left: o.getBounds().left }));
      return { w, maxRight: Math.max(...rights.map((r) => r.right)), minLeft: Math.min(...rights.map((r) => r.left)) };
    });
    expect(m.maxRight, "something screen-space hangs off the right edge").toBeLessThanOrEqual(m.w + 1);
    expect(m.minLeft, "something screen-space hangs off the left edge").toBeGreaterThanOrEqual(-1);
    // ...and it genuinely reaches the right edge rather than stopping at the old 1280 anchor.
    expect(m.maxRight, "the HUD did not follow the widened viewport").toBeGreaterThan(VIEW_WIDTH);
  });

  /** `?diag=1` is the only instrument that works on hardware nobody here is holding. If it silently
   *  stopped rendering, the next device bug would be back to guesswork. */
  test("?diag=1 prints what the device actually reports", async ({ page }) => {
    await harnessReady(page, { route: "?diag=1", needs: ["__game", "__flow"] });
    const texts = await page.evaluate(() => {
      const scene = (window as any).__game.scene.getScene("Flow");
      const out: string[] = [];
      const walk = (list: any[]): void => {
        for (const o of list) {
          if (typeof o.text === "string") out.push(o.text);
          if (Array.isArray(o.list)) walk(o.list);
        }
      };
      walk(scene.children.list);
      return out;
    });
    const diag = texts.find((t) => t.includes("maxTouchPoints"));
    expect(diag, "the diagnostic line is on the title screen").toBeTruthy();
    for (const key of ["touch=", "pointer:coarse=", "any-pointer:fine=", "vp="]) {
      expect(diag, `reports ${key}`).toContain(key);
    }
  });

  test("the mode screen offers CPU only — two people cannot share one handset", async ({ page }) => {
    await flowReady(page);
    await keys(page, ["enter"]); // title -> mode
    const modes = await page.evaluate(() => (window as any).__flow.modes());
    expect(modes).toHaveLength(3);
    expect(modes.some((m: string) => m.includes("1 vs 1"))).toBe(false);
    expect(modes).toEqual(["CPU · EASY", "CPU · NORMAL", "CPU · HARD"]);
  });

  test("portrait raises the rotate overlay and blocks the game; landscape clears it", async ({ page }) => {
    // Deliberately NOT harnessReady: this case is about the LIVE loop, which `ready` stops.
    await page.goto("/");
    await page.waitForFunction(() => (window as any).__game?.isRunning, null, { timeout: 30_000 });

    const rotate = page.locator("#rotate");
    await expect(rotate).toBeHidden();
    expect(await page.evaluate(() => (window as any).__game.input.enabled)).toBe(true);

    await page.setViewportSize({ width: PHONE.viewport.height, height: PHONE.viewport.width });
    await expect(rotate).toBeVisible();
    // The overlay is the visible half; this is the half that matters. Phaser's TouchManager listens
    // on WINDOW and forwards any touch whose target is not the canvas, so CSS stacking alone would
    // let a tap on the overlay reach the menu underneath.
    await expect.poll(() => page.evaluate(() => (window as any).__game.input.enabled)).toBe(false);
    await expect.poll(() => page.evaluate(() => (window as any).__game.loop.running)).toBe(false);

    await page.setViewportSize({ width: PHONE.viewport.width, height: PHONE.viewport.height });
    await expect(rotate).toBeHidden();
    await expect.poll(() => page.evaluate(() => (window as any).__game.input.enabled)).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as any).__game.loop.running)).toBe(true);
  });

  test("a tap on the rotate overlay cannot advance the menu behind it", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => (window as any).__flow != null, null, { timeout: 30_000 });
    await page.setViewportSize({ width: PHONE.viewport.height, height: PHONE.viewport.width });
    await expect(page.locator("#rotate")).toBeVisible();

    const before = await page.evaluate(() => (window as any).__flow.state());
    expect(before.step).toBe("title");
    // Tap the CANVAS's own centre, not the viewport's. The ScaleManager polls its parent every 500ms,
    // so wait past that first: with stale bounds the tap transforms to a point off the canvas, hits
    // nothing, and the case passes without exercising the gate at all (measured — that is exactly how
    // the first version of this spec passed with the input gate deleted).
    await page.waitForTimeout(700);
    const c = await page.evaluate(() => {
      const b = (window as any).__game.scale.canvasBounds;
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await page.touchscreen.tap(c.x, c.y);
    await page.touchscreen.tap(c.x, c.y);
    // The taps MUST be stepped, or this case proves nothing: the rotate gate also puts the loop to
    // sleep, and a spec that only waits on the wall clock passes even with the input gate deleted —
    // measured, by deleting it. Stepping the game by hand separates "input was refused" from
    // "nothing ran at all".
    await pump(page, 10);
    expect(await page.evaluate(() => (window as any).__flow.state())).toEqual(before);
  });

  test("a TAP on the LIGHT button lands a hit — no __holdP1, real touch events", async ({ page }) => {
    await harnessReady(page, { route: MATCH, needs: ["__sprites", "__world", "__game"] });
    await stageFight(page);
    const before = await health(page);

    const light = await buttonXY(page, "light");
    await page.touchscreen.tap(light.x, light.y);
    // Phaser dispatches touch synchronously from its DOM listener rather than queuing it for the next
    // game step, so BOTH the down and the up have already landed by the time we pump. The pad's press
    // queue is what preserves the tap across that gap.
    await pump(page, 40);

    const after = await health(page);
    expect(after[1], "P2 took damage from a touch-driven light").toBeLessThan(before[1]);
    expect(after[0], "P1 was not hurt by their own button").toBe(before[0]);
  });

  // Phase 19: the pad is atlas art. Two things could go wrong invisibly — every button could be
  // wearing the same frame (a `frameFor` that ignores its arguments, or `Texture.get`'s silent
  // fallback to the first frame), and the pressed state could never be applied. Both would look like
  // a pad that simply does not react, which is what the vector version was replaced FOR.
  test("the pad wears atlas art, and a held button visibly swaps to its pressed frame", async ({ page }) => {
    await harnessReady(page, { route: MATCH, needs: ["__sprites", "__world", "__game"] });
    await stageFight(page);

    const frames = (): Promise<Record<string, string>> => page.evaluate(() => {
      const scene = (window as any).__game.scene.getScene("Match");
      const out: Record<string, string> = {};
      for (const o of scene.children.list as any[]) {
        if (o.depth === 96 && o.type === "Image") out[`${Math.round(o.x)},${Math.round(o.y)}`] = o.frame.name;
      }
      return out;
    });

    const idle = await frames();
    expect(Object.keys(idle), "8 pad buttons").toHaveLength(8);
    // Movement and action buttons must NOT be wearing the same frame — that is the colour affordance,
    // and it is also what a first-frame fallback would destroy.
    const distinct = new Set(Object.values(idle));
    expect([...distinct].sort(), "idle frames").toEqual(["pad-action", "pad-move"]);

    // Hold LIGHT down with a real touch and read the frame back off the Game Object.
    const light = await buttonXY(page, "light");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: light.x, y: light.y }],
    });
    await pump(page, 2);
    const held = await frames();
    expect(Object.values(held), "the pressed frame never appeared").toContain("pad-action-down");
    expect(Object.values(held).filter((f) => f === "pad-action-down"), "only the held button presses")
      .toHaveLength(1);

    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await pump(page, 3);
    expect(Object.values(await frames()), "the button stayed pressed after release")
      .not.toContain("pad-action-down");
  });

  test("one tap is one hit — a held button does not re-fire", async ({ page }) => {
    await harnessReady(page, { route: MATCH, needs: ["__sprites", "__world", "__game"] });
    await stageFight(page);
    const light = await buttonXY(page, "light");
    const cdp = await page.context().newCDPSession(page);

    const before = await health(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: light.x, y: light.y }] });
    await pump(page, 120); // held for two full seconds of sim — plenty for several attacks to re-fire
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await pump(page, 20);
    const after = await health(page);

    const dmg = before[1] - after[1];
    const oneLight = await page.evaluate(() => (window as any).__world.fighters[0].cfg.attacks.light.damage);
    expect(dmg, "a held LIGHT button fired exactly once").toBe(oneLight);
  });

  test("a touch released OFF the canvas does not leave the button held", async ({ page }) => {
    await harnessReady(page, { route: MATCH, needs: ["__sprites", "__world", "__game"] });
    await stageFight(page);
    const right = await buttonXY(page, "right");
    const cdp = await page.context().newCDPSession(page);
    const v = page.viewportSize()!;

    const start = await page.evaluate(() => (window as any).__world.fighters[0].x);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: right.x, y: right.y }] });
    await pump(page, 10);
    const walking = await page.evaluate(() => (window as any).__world.fighters[0].x);
    // Drag into the letterbox strip — which is outside the CANVAS element, so Phaser emits
    // pointerupoutside rather than pointerup — and release there.
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: v.width - 1, y: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await pump(page, 30);
    const settled = await page.evaluate(() => (window as any).__world.fighters[0].x);
    await pump(page, 30);
    const later = await page.evaluate(() => (window as any).__world.fighters[0].x);

    // Without the first assertion the second is vacuous: a button that never engaged also never sticks.
    expect(walking, "RIGHT actually walked P1 while the finger was down").toBeGreaterThan(start);
    expect(later, "still walking 30 frames after the finger left the canvas").toBe(settled);
  });

  /**
   * The `pointerupoutside` subscription, tested directly.
   *
   * Chromium's emulation reports the CANVAS as `upElement` even for a release in the letterbox bar, so
   * the drag-and-release case above cannot tell that handler apart from the plain `pointerup` one — it
   * stays green with the outside handler deleted. Phaser's branch is real
   * (`InputPlugin.js:2064-2075` picks one or the other on `pointer.upElement === game.canvas`), so
   * this drives the event the way Phaser would and asserts the button lets go. Removing the
   * subscription turns it red.
   */
  test("a POINTER_UP_OUTSIDE release lets go of the button", async ({ page }) => {
    await harnessReady(page, { route: MATCH, needs: ["__sprites", "__world", "__game"] });
    await stageFight(page);
    const right = await buttonXY(page, "right");
    const cdp = await page.context().newCDPSession(page);

    const start = await page.evaluate(() => (window as any).__world.fighters[0].x);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: right.x, y: right.y }] });
    await pump(page, 10);
    const walking = await page.evaluate(() => (window as any).__world.fighters[0].x);
    expect(walking, "RIGHT walked P1 while held").toBeGreaterThan(start);

    // Emit ONLY the outside variant, on the live pointer, with reconciliation defeated by leaving the
    // real contact down — so the plain pointerup handler and reconcile cannot be what releases it.
    await page.evaluate(() => {
      const w = (window as any);
      const scene = w.__game.scene.getScene("Match");
      // `game.input` IS the InputManager (a Scene's `input` is the plugin that wraps it).
      const p = w.__game.input.pointers.find((q: any) => q.isDown) ?? w.__game.input.activePointer;
      scene.input.emit("pointerupoutside", p);
    });
    await pump(page, 6);
    const a = await page.evaluate(() => (window as any).__world.fighters[0].x);
    await pump(page, 20);
    const b = await page.evaluate(() => (window as any).__world.fighters[0].x);
    expect(b, "the button released on POINTER_UP_OUTSIDE alone").toBe(a);

    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  });

  test("every game object still renders on exactly one camera, pad included", async ({ page }) => {
    await harnessReady(page, { route: MATCH, needs: ["__sprites", "__world", "__game"] });
    await page.evaluate(() => { (window as any).__world.match.phase = "matchEnd"; });
    await pump(page, 4);

    const audit = await page.evaluate(() => {
      const scene = (window as any).__game.scene.getScene("Match");
      const [main, ui] = scene.cameras.cameras as any[];
      return (scene.children.list as any[]).map((o) => ({
        type: o.type,
        depth: o.depth,
        onMain: (o.cameraFilter & main.id) === 0,
        onUi: (o.cameraFilter & ui.id) === 0,
      }));
    });

    expect(audit.length).toBeGreaterThan(5);
    for (const o of audit) {
      expect(Number(o.onMain) + Number(o.onUi), `${o.type}@${o.depth} camera assignment`).toBe(1);
    }
    // ...and the pad is actually in there, on the UI side. Phase 19 replaced the single Graphics that
    // stroked eight circles with eight atlas IMAGES, so depth 96 is now a count, not a presence check
    // — which is the stronger assertion: a pad that lost buttons on a resize would show up here.
    const padArt = audit.filter((o) => o.onUi && o.depth === 96);
    expect(padArt, "8 pad buttons at depth 96").toHaveLength(8);
    expect(padArt.every((o) => o.type === "Image"), "pad buttons are atlas Images now").toBe(true);
    // depth 97 = the 8 pad labels + the ⎋ MENU button.
    expect(audit.filter((o) => o.onUi && o.depth === 97).length).toBeGreaterThanOrEqual(9);
  });

  /**
   * The phase, expressed as one runnable test: from the title screen to damage in a live match and
   * back out, with nothing but touch. No key press, no `__hold*` seam. Every hop is asserted, so a
   * failure names the step that broke rather than "the phone cannot play".
   */
  test("the whole journey: title -> CPU -> stage -> fighter -> a hit -> back to the menu", async ({ page }) => {
    test.slow();
    await flowReady(page);
    const v = page.viewportSize()!;
    const state = () => page.evaluate(() => (window as any).__flow.state());
    // A REAL touch at the card's real screen position. Calling the tap handler through a DEV seam
    // would pass with the cards' `setInteractive` registration, hit areas or coordinate transform
    // completely broken — the same objection that keeps `__holdP1` out of this file.
    const tapCard = async (i: number): Promise<void> => {
      // Cards fade IN from alpha 0, and an alpha-0 object fails `willRender` and is therefore NOT
      // hit-testable — tapping one is a silent no-op that looks exactly like a broken hit area.
      // The entry tween needs BOTH things and neither alone: its delta comes from the wall clock
      // (Phaser's TweenManager reads Date.now), but the TweenManager only runs inside a game step,
      // which the harness has stopped. So pump AND let real time pass, alternately, until it settles.
      await expect
        .poll(async () => {
          await pump(page, 2);
          return page.evaluate((n) => (window as any).__flow.cards()[n]?.alpha, i);
        }, { timeout: 10_000 })
        .toBe(1);
      const p = await page.evaluate((n) => {
        const w = (window as any);
        const c = w.__flow.cards()[n];
        const s = w.__game.scale;
        return { x: s.canvasBounds.left + c.x / s.displayScale.x, y: s.canvasBounds.top + c.y / s.displayScale.y };
      }, i);
      await page.touchscreen.tap(p.x, p.y);
      // `setInteractive` defers insertion into the input list until the next scene pre-update, so a
      // frame is pumped after every rebuild before the next tap.
      await pump(page, 3);
    };

    // 1. Title: a real tap anywhere starts the flow (and asks for fullscreen).
    expect((await state()).step).toBe("title");
    await page.touchscreen.tap(v.width / 2, v.height / 2);
    await pump(page, 3);
    expect((await state()).step, "a tap on the title screen enters the flow").toBe("mode");

    // 2. Mode: pick CPU · NORMAL (index 1 of the touch list), then confirm with a second tap.
    await tapCard(1);
    expect((await state()).modeIndex).toBe(1);
    await tapCard(1);
    expect((await state()).step, "second tap on the selected card confirms").toBe("stage");

    // 3. Stage.
    await tapCard(0);
    expect((await state()).step).toBe("chars");

    // 4. Fighter: move P1 onto card 2, then lock. In CPU mode the opponent is drawn for us.
    await tapCard(2);
    expect((await state()).cursors[0]).toBe(2);
    await tapCard(2);
    await pumpUntil(page, "__world");
    expect(await page.evaluate(() => (window as any).__world.fighters.map((f: any) => f.cfg.id)))
      .toHaveLength(2);

    // 5. A hit, driven by the pad.
    await stageFight(page);
    const before = await health(page);
    const heavy = await buttonXY(page, "heavy");
    await page.touchscreen.tap(heavy.x, heavy.y);
    await pump(page, 45);
    expect((await health(page))[1], "the pad damaged the CPU in a real match").toBeLessThan(before[1]);

    // 6. Out again: MENU arms, MENU confirms — the same two-step Esc takes.
    const menu = await page.evaluate(() => {
      const s = (window as any).__game.scale;
      const t = (window as any).__game.scene.getScene("Match").children.list
        .find((o: any) => typeof o.text === "string" && o.text.includes("MENU"));
      // getBounds(), not x/y: those are anchored by the object's ORIGIN, so a spec doing its own
      // origin arithmetic silently taps empty stage the moment the button is repositioned.
      const b = t.getBounds();
      return {
        x: s.canvasBounds.left + (b.x + b.width / 2) / s.displayScale.x,
        y: s.canvasBounds.top + (b.y + b.height / 2) / s.displayScale.y,
      };
    });
    await page.touchscreen.tap(menu.x, menu.y);
    await pump(page, 3);
    expect(await page.evaluate(() => (window as any).__quitArmed()), "first tap arms the prompt").toBe(true);
    await page.touchscreen.tap(menu.x, menu.y);
    await pumpUntil(page, "__flow");
    expect((await state()).step, "and the second tap lands back on the menu").toBe("title");
  });
});

// The Pixel 5 profile above emulates a 2.74:1 page viewport, which is wider than the world itself —
// so it can only ever prove the CLAMP. This profile is shaped like the device the phase was actually
// reported broken on: a Samsung S23+ in landscape is ~2.17:1, comfortably inside the band, and there
// the game is supposed to fill the screen exactly. Without this case "fills the width" is never
// tested anywhere, only "fills it better than before".
test.describe("a phone whose aspect fits inside the world (S23+ shaped)", () => {
  test.use({ viewport: { width: 900, height: 415 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test("the canvas fills the screen edge to edge, with no bars at all", async ({ page }) => {
    await harnessReady(page, { route: MATCH, needs: ["__game", "__world"] });
    const m = await page.evaluate(() => {
      const g = (window as any).__game;
      const r = g.canvas.getBoundingClientRect();
      return {
        gameW: g.scale.gameSize.width,
        parentW: g.scale.parentSize.width,
        parentH: g.scale.parentSize.height,
        left: r.left, right: r.right, width: r.width,
        innerW: window.innerWidth,
      };
    });
    // Guard the fixture itself: if this viewport ever stops being inside the band, the case below
    // would pass for the wrong reason (a clamped width that happens to fit).
    const aspect = m.parentW / m.parentH;
    expect(aspect, "fixture drift: this profile must sit INSIDE the world's aspect").toBeLessThan(STAGE_WIDTH / STAGE_HEIGHT);
    expect(aspect).toBeGreaterThan(VIEW_WIDTH / STAGE_HEIGHT);

    expect(m.gameW).toBe(Math.round(STAGE_HEIGHT * aspect));
    expect(m.width, "the canvas does not span the viewport").toBeCloseTo(m.innerW, 0);
    expect(m.left, "left bar").toBeCloseTo(0, 0);
    expect(m.innerW - m.right, "right bar").toBeCloseTo(0, 0);
  });
});

test.describe("desktop is unchanged", () => {
  test("local 1v1 is still on the mode screen, and there is no pad", async ({ page }) => {
    await flowReady(page);
    await keys(page, ["enter"]);
    const modes = await page.evaluate(() => (window as any).__flow.modes());
    expect(modes).toHaveLength(4);
    expect(modes[0]).toBe("1 vs 1");
    expect(await page.evaluate(() => document.documentElement.classList.contains("touch"))).toBe(false);
    await expect(page.locator("#rotate")).toBeHidden();
  });

  test("no touch pad is built in a desktop match", async ({ page }) => {
    await harnessReady(page, { route: MATCH, needs: ["__sprites", "__world", "__game"] });
    const depths = await page.evaluate(() => {
      const scene = (window as any).__game.scene.getScene("Match");
      return (scene.children.list as any[]).map((o) => o.depth);
    });
    expect(depths.filter((d) => d === 96 || d === 97)).toHaveLength(0);
  });
});
