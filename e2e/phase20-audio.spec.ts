import { test, expect, devices, type Page } from "@playwright/test";
import { MATCH, pump, pumpUntil, ready as boot } from "./harness";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Phase 20 — game audio.
//
// Everything here is built on `e2e/harness.ts`; the notes that matter for THIS file:
//
//  * `game.loop.now` freezes after `loop.stop()`, so a sequence whose behaviour depends on elapsed
//    wall-clock time — which the cue COOLDOWNS do — must run inside ONE page.evaluate carrying its own
//    accumulating `t`. Separate `pump()` calls all replay the same frozen instant.
//  * `__audio.plays` counts SUCCESSFUL `sound.play()` calls, not cue requests. A counter bumped on
//    request would keep rising even when every call bailed on the missing-key guard, which is exactly
//    the failure it exists to detect.

const ready = (page: Page, route = MATCH) =>
  boot(page, { route, needs: route === MATCH ? ["__game", "__world", "__audio"] : ["__game", "__flow", "__audio"] });

/**
 * Unlock the AudioContext with a REAL gesture, and prove it was locked first.
 *
 * Headless Chromium genuinely locks: measured at boot, `sound.locked === true` and
 * `context.state === "suspended"`. That matters twice over. It means this project CAN test the unlock
 * path rather than assuming it (the phase plan hedged that it might not be testable), and it means any
 * assertion about the mute GAIN has to happen after this — a suspended context silently discards
 * `gain.setValueAtTime`, so `sound.mute` neither applies nor reads back.
 *
 * Phaser listens for the unlock on `document.body` (touchstart/touchend/mousedown/mouseup/keydown), so
 * a plain keypress is enough. `UNLOCKED` is then emitted from a later SoundManager update, which is
 * why this pumps rather than returning immediately.
 */
async function unlockAudio(page: Page): Promise<{ wasLocked: boolean }> {
  const wasLocked = await page.evaluate(() => (window as any).__game.sound.locked);
  await page.keyboard.press("Space");
  for (let i = 0; i < 60; i++) {
    await pump(page, 2);
    if (await page.evaluate(() => !(window as any).__game.sound.locked)) break;
  }
  return { wasLocked };
}

test.describe("Phase 20 — audio", () => {
  test.setTimeout(60_000);

  test("BootScene refuses to route when an audio asset 404s", async ({ page }) => {
    // The key net this exercises is the `cache.audio.exists` check, NOT `failed[]`: audio is queued in
    // preload(), which finishes before create() attaches the FILE_LOAD_ERROR listener, so a 404 here
    // never reaches `failed[]` at all. Deleting that cache check turns this case red.
    let intercepted = 0;
    await page.route("**/audio/hitHeavy.mp3", (r) => {
      intercepted++;
      return r.fulfill({ status: 404, body: "" });
    });

    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`/${MATCH}`);
    // Bounded wait: boot either throws or publishes __world. Neither is instant on a cold asset set.
    await page.waitForFunction(
      () => (window as any).__world != null || (window as any).__bootFailed === true,
      undefined, { timeout: 20_000 },
    ).catch(() => { /* the throw path never publishes either flag; fall through to the assertions */ });

    // The route must actually have fired — a pattern that matched nothing would pass this case free.
    expect(intercepted, "the 404 route never matched; the assertion below would be vacuous").toBeGreaterThan(0);

    const joined = errors.join(" | ");
    expect(joined, `expected a boot refusal, saw: ${joined}`).toContain("boot:");
    // ...and it must NAME the asset, so the message is diagnostic rather than decorative.
    expect(joined).toContain("hitHeavy");
    expect(await page.evaluate(() => (window as any).__world ?? null)).toBeNull();
  });

  test("a landed hit, a block and a KO each request their cue", async ({ page }) => {
    await ready(page);

    const seen = await page.evaluate(() => {
      const w = window as any, g = w.__game, world = w.__world;
      // ONE evaluate, own accumulating clock — see the header note about `loop.now`.
      let t = g.loop?.now ?? performance.now();
      const step = (n = 1) => { for (let i = 0; i < n; i++) { t += 1000 / 60; g.step(t, 1000 / 60); } };

      world.match.phase = "fight";
      world.match.introTicks = 0;
      step(2);
      w.__audio.clear();

      const out: Record<string, unknown> = {};
      const place = (gap: number) => {
        world.fighters[0].reset(640 - gap / 2, 1);
        world.fighters[1].reset(640 + gap / 2, -1);
      };

      // (1) a clean hit on an idle opponent
      place(70);
      w.__holdP1({ heavy: true, heavyPressed: true });
      step(1);
      w.__holdP1({});
      step(30);
      out.afterHit = [...w.__audio.log()];

      // (2) the same attack into a held guard
      w.__audio.clear();
      place(70);
      world.fighters[1].health = world.fighters[1].maxHealth;
      w.__holdP2?.({ block: true });
      w.__holdP1({ heavy: true, heavyPressed: true });
      step(1);
      w.__holdP1({});
      step(30);
      out.afterBlock = [...w.__audio.log()];

      // (3) a KO, forced by draining the defender to a sliver first
      w.__audio.clear();
      w.__holdP2?.({});
      place(70);
      world.fighters[1].health = 1;
      w.__holdP1({ heavy: true, heavyPressed: true });
      step(1);
      w.__holdP1({});
      step(40);
      out.afterKo = [...w.__audio.log()];

      out.plays = w.__audio.plays();
      return out;
    });

    expect(seen.afterHit as string[]).toContain("hitHeavy");
    expect(seen.afterBlock as string[]).toContain("block");
    expect(seen.afterKo as string[]).toContain("ko");
    // A real value, never `undefined === undefined`.
    expect(typeof seen.plays).toBe("number");
    expect(seen.plays as number).toBeGreaterThan(0);
  });

  test("a cue with no audio in the cache is a silent no-op, not a crash and not a play", async ({ page }) => {
    // Two claims in one case, because two mutations proved BOTH were untested: dropping `play()`'s
    // `cache.audio.exists` guard, and making `plays` count requests instead of successful
    // `sound.play()` calls. Either left the whole suite green.
    await ready(page);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    const r = await page.evaluate(() => {
      const w = window as any, g = w.__game;
      w.__audio.clear();
      g.cache.audio.remove("ko");           // simulate a decode that failed after boot
      let threw = "";
      try { w.__audio.play("ko"); } catch (e) { threw = String(e); }
      const afterMissing = w.__audio.plays();
      w.__audio.play("hitHeavy");           // a key that IS present, for contrast
      return { threw, afterMissing, afterPresent: w.__audio.plays(), alive: !!w.__world };
    });

    expect(r.threw, "a missing cue must never throw into the game loop").toBe("");
    expect(r.afterMissing, "a cue with no audio must not count as a play").toBe(0);
    expect(r.afterPresent, "a cue that IS cached must count").toBeGreaterThan(0);
    expect(r.alive).toBe(true);
    expect(errors).toEqual([]);
  });

  test("mute intent survives a locked context (the graph cannot store it)", async ({ page }) => {
    // Pre-gesture, `sound.mute = true` is silently DISCARDED: the setter schedules on a suspended
    // AudioParam and the getter reads it straight back. So the intent has to live in GameAudio, or a
    // player who mutes on the title screen before touching anything loses the setting and sees a
    // button labelled with the state it never reached.
    await ready(page);
    const r = await page.evaluate(() => {
      const w = window as any, mgr = w.__game.sound;
      if (!mgr.locked) return { skipped: true };
      w.__audio.toggle();
      return {
        skipped: false,
        intent: w.__audio.muted(),          // GameAudio's own flag — must be true
        graph: mgr.mute,                    // Phaser's live read of a suspended gain — will be false
        gain: mgr.masterMuteNode?.gain.value,
      };
    });
    // A `return` here would make this case pass without asserting anything. Headless Chromium locks
    // (measured), so if it stops, this must be looked at rather than skipped.
    expect(r.skipped, "context was already unlocked — this case cannot test the locked path").toBe(false);
    expect(r.intent).toBe(true);
    expect(r.graph).toBe(false);   // documents WHY the flag exists; if this ever becomes true, drop it
    // ...and once a gesture arrives, the intent is applied for real.
    await unlockAudio(page);
    await pump(page, 4);
    expect(await page.evaluate(() => (window as any).__game.sound.masterMuteNode.gain.value)).toBe(0);
    await page.evaluate(() => (window as any).__audio.toggle());
  });

  test("muting silences the graph while sounds are still playing", async ({ page }) => {
    await ready(page);
    const { wasLocked } = await unlockAudio(page);
    expect(wasLocked, "headless is expected to lock audio; if it stops, this case proves less").toBe(true);

    await page.evaluate(() => {
      const w = window as any;
      if (!w.__audio.muted()) w.__audio.toggle();
    });

    // The gain is NOT readable synchronously after the toggle. `mute` schedules
    // `gain.setValueAtTime(0, 0)`, which lands on the next audio render quantum on the audio thread —
    // wall-clock time, not a pumped frame. Poll for it rather than assume one `evaluate` is enough.
    await expect.poll(
      () => page.evaluate(() => (window as any).__game.sound.masterMuteNode.gain.value),
      { timeout: 3_000, message: "mute never reached the gain node" },
    ).toBe(0);

    const r = await page.evaluate(() => {
      const w = window as any, g = w.__game, world = w.__world, mgr = g.sound;
      let t = g.loop?.now ?? performance.now();
      const step = (n = 1) => { for (let i = 0; i < n; i++) { t += 1000 / 60; g.step(t, 1000 / 60); } };
      world.match.phase = "fight"; world.match.introTicks = 0; step(2);
      w.__audio.clear();

      // Land a hit WHILE muted. "the gain is still 0" passes trivially if nothing was ever requested,
      // so the play count rising is the half of this assertion that carries the weight.
      world.fighters[0].reset(605, 1); world.fighters[1].reset(675, -1);
      w.__holdP1({ heavy: true, heavyPressed: true });
      step(1);
      w.__holdP1({});
      step(20);
      return {
        playsWhileMuted: w.__audio.plays(),
        gainStill: mgr.masterMuteNode.gain.value,
        // The BED is always playing, so a bare `getAllPlaying().length > 0` proves nothing about the
        // cue. Count only non-bed sounds.
        cuesPlayingWhileMuted: mgr.getAllPlaying().filter((x: any) => x.key !== "ambience" && x.key !== "menuMusic").length,
        cues: [...w.__audio.log()],
      };
    });

    expect(r.playsWhileMuted, `no cue was requested; cues=${r.cues}`).toBeGreaterThan(0);
    expect(r.gainStill).toBe(0);
    // ...and a CUE is still playing. That is what makes this "silenced" rather than "stopped", and it
    // has to exclude the looping bed, which is playing either way.
    expect(r.cuesPlayingWhileMuted).toBeGreaterThan(0);

    await page.evaluate(() => (window as any).__audio.toggle());
    await expect.poll(() => page.evaluate(() => (window as any).__game.sound.masterMuteNode.gain.value)).toBe(1);
    expect(await page.evaluate(() => (window as any).__audio.muted())).toBe(false);
  });

  test("the mute setting survives a real scene change and a reload", async ({ page }) => {
    await ready(page);
    await page.evaluate(() => { const w = window as any; if (!w.__audio.muted()) w.__audio.toggle(); });
    expect(await page.evaluate(() => (window as any).__audio.muted())).toBe(true);

    // A REAL scene transition first, through the scene plugin the game itself uses (`scene.start`
    // from inside the scene queues stop-current then start-target). The previous version of this case
    // only reloaded the page, so it never crossed a GameAudio handover at all.
    await page.evaluate(() => {
      const w = window as any;
      w.__world = null;
      (w.__game.scene.getScene("Match") as any).scene.start("Flow");
    });
    await pumpUntil(page, "__flow");
    expect(await page.evaluate(() => (window as any).__audio.muted()),
      "mute was lost handing over from Match to Flow").toBe(true);

    // Then a full reload: the setting lives in localStorage, and GameAudio applies it in its ctor.
    await ready(page);
    expect(await page.evaluate(() => (window as any).__audio.muted())).toBe(true);
    // ...and it reaches the actual graph once a gesture unlocks it.
    await unlockAudio(page);
    await pump(page, 4);
    expect(await page.evaluate(() => (window as any).__game.sound.masterMuteNode.gain.value)).toBe(0);
    await page.evaluate(() => (window as any).__audio.toggle());
  });

  test("leaving the match takes its bed with it", async ({ page }) => {
    await ready(page);
    // Unlock FIRST. Without a gesture the bed never starts, so there is nothing to leak and this case
    // passes for the wrong reason — measured: `destroy()` downgraded to `stop()` stayed green.
    const { wasLocked } = await unlockAudio(page);
    expect(wasLocked).toBe(true);
    await pump(page, 4);
    expect(await page.evaluate(() => (window as any).__audio.bedPlaying()),
      "no bed is playing, so a leak cannot be observed").toBe(true);
    // The SoundManager is game-global, so nothing here is automatic: a bed that is only `stop()`ped
    // stays in `sound.sounds` forever, and a pending unlock callback can start a bed for a scene that
    // no longer exists.
    const before = await page.evaluate(() => (window as any).__game.sound.sounds.length);
    for (let i = 0; i < 3; i++) {
      // Through the SCENE PLUGIN, like production. `game.scene.start(...)` on the global manager
      // starts the target WITHOUT stopping the current one, so both scenes stay live and no SHUTDOWN
      // ever fires — which is why this case previously stayed green with `destroy()` downgraded to a
      // bare `stop()`.
      await page.evaluate(() => {
        const w = window as any;
        w.__world = null;
        (w.__game.scene.getScene("Match") as any).scene.start("Flow");
      });
      await pumpUntil(page, "__flow");
      await page.evaluate(() => (window as any).__game.scene.getScene("Flow").scene.start("Match"));
      await pumpUntil(page, "__world");
    }
    const after = await page.evaluate(() => (window as any).__game.sound.sounds.length);
    // Not "equal": a live bed legitimately occupies a slot. What must not happen is GROWTH per visit.
    expect(after, `sound instances leaked across 3 round trips: ${before} -> ${after}`).toBeLessThanOrEqual(before + 1);
  });

  test("mute holds across a scene change even when localStorage is dead", async ({ page }) => {
    // Private-mode Safari and blocked third-party storage both throw from `setItem`. GameAudio is
    // per-SCENE while the setting is per-GAME, so with the write failing and no in-memory fallback the
    // next scene's GameAudio reads `false`, writes that to the game-global manager, and the sound
    // comes back on its own after the player deliberately turned it off.
    await page.addInitScript(() => {
      const die = () => { throw new Error("QuotaExceededError: storage disabled"); };
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get: () => ({ getItem: die, setItem: die, removeItem: die, clear: die, key: die, length: 0 }),
      });
    });
    await ready(page);
    expect(await page.evaluate(() => {
      try { localStorage.setItem("x", "1"); return "storage still works"; } catch { return "throws"; }
    }), "localStorage was not actually broken, so this case proves nothing").toBe("throws");

    await page.evaluate(() => { const w = window as any; if (!w.__audio.muted()) w.__audio.toggle(); });
    await page.evaluate(() => {
      const w = window as any;
      w.__world = null;
      (w.__game.scene.getScene("Match") as any).scene.start("Flow");
    });
    await pumpUntil(page, "__flow");
    expect(await page.evaluate(() => (window as any).__audio.muted()),
      "mute silently reverted when storage was unavailable").toBe(true);
  });

  test("the menu itself makes a sound", async ({ page }) => {
    // The unit tests only prove `menuCue(before, after)`. Deleting FlowScene's actual `audio.menu(...)`
    // call left every one of them green while silencing the entire select screen, keyboard and touch
    // alike — so the seam needs a case that crosses it.
    await boot(page, { route: "", needs: ["__game", "__flow", "__audio"] });
    await pump(page, 2);
    const seen = await page.evaluate(() => {
      const w = window as any, g = w.__game;
      let t = g.loop?.now ?? performance.now();
      const step = () => { t += 1000 / 60; g.step(t, 1000 / 60); };
      w.__audio.clear();
      w.__flow.press("enter");            // title -> mode: a step change, so a CONFIRM
      step();
      const afterConfirm = [...w.__audio.log()];
      w.__audio.clear();
      w.__flow.press("d");                // move the cursor along the mode row: a MOVE
      step();
      return { afterConfirm, afterMove: [...w.__audio.log()] };
    });
    expect(seen.afterConfirm).toContain("menuConfirm");
    expect(seen.afterMove).toContain("menuMove");
  });
});

test.describe("Phase 20 — the mute button's placement", () => {
  test.setTimeout(60_000);

  // The anchor was chosen from the code (HUD bottom 208, centre banner ~270, pad top row 428) and this
  // is what makes that a MEASUREMENT rather than a claim. The first draft of the phase plan put this
  // button bottom-centre "because the pad leaves the middle clear" — where the desktop legend and the
  // touch MENU button both live.
  const overlaps = async (page: Page) => page.evaluate(() => {
    const w = window as any;
    const scene = w.__game.scene.getScene("Match") as any;
    const btn = w.__audio.button();
    const rect = (o: any) => (o?.getBounds ? o.getBounds() : null);
    const others: [string, any][] = [
      ["legend", scene.legend], ["menuBtn", scene.menuBtn], ["quitPrompt", scene.quitPrompt],
      ...scene.hud.objects.map((o: any, i: number) => [`hud[${i}]`, o] as [string, any]),
      ...((scene.pad?.objects ?? []).map((o: any, i: number) => [`pad[${i}]`, o] as [string, any])),
    ];
    const hits: string[] = [];
    for (const [name, o] of others) {
      if (!o || o.visible === false) continue;
      const r = rect(o);
      if (!r || !r.width || !r.height) continue;
      const sep = btn.right <= r.left || btn.left >= r.right || btn.bottom <= r.top || btn.top >= r.bottom;
      if (!sep) hits.push(`${name} ${JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height })}`);
    }
    return { btn: { x: btn.x, y: btn.y, w: btn.width, h: btn.height }, hits, width: w.__game.scale.gameSize.width };
  });

  for (const width of [1280, 1696]) {
    test(`overlaps nothing on desktop at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: Math.round(width * 720 / 1280) });
      await boot(page, { route: MATCH, needs: ["__game", "__world", "__audio"] });
      await pump(page, 2);
      const r = await overlaps(page);
      expect(r.hits, `mute button ${JSON.stringify(r.btn)} overlaps: ${r.hits.join("; ")}`).toEqual([]);
      expect(r.btn.w).toBeGreaterThan(0);   // a zero-size button overlaps nothing, vacuously
    });
  }

  test.describe("touch", () => {
    // A full device profile, never a bare `hasTouch`: on a desktop context `pointer: coarse` stays
    // false, the whole touch mode switches itself off, and every case passes for the wrong reason.
    const { defaultBrowserType, ...s23 } = devices["Pixel 5 landscape"];
    void defaultBrowserType;
    test.use({ ...s23, viewport: { width: 900, height: 415 }, hasTouch: true, isMobile: true });

    test("overlaps nothing with the pad and the MENU button up", async ({ page }) => {
      await boot(page, { route: MATCH, needs: ["__game", "__world", "__audio"] });
      await pump(page, 2);
      expect(await page.evaluate(() => (window as any).__game.scene.getScene("Match").pad != null),
        "the pad is absent, so this case would not be testing touch at all").toBe(true);
      const r = await overlaps(page);
      expect(r.hits, `mute button ${JSON.stringify(r.btn)} overlaps: ${r.hits.join("; ")}`).toEqual([]);
    });

    test("a tap on it toggles mute", async ({ page }) => {
      await boot(page, { route: MATCH, needs: ["__game", "__world", "__audio"] });
      // A frame after creation: `setInteractive()` defers insertion into the input list until the next
      // scene pre-update, so tapping sooner hits nothing and passes for the wrong reason.
      await pump(page, 2);

      const before = await page.evaluate(() => (window as any).__audio.muted());
      const target = await page.evaluate(() => {
        const w = window as any;
        // Canvas bounds, read AFTER the 500 ms poll has refreshed them, and derived from getBounds()
        // rather than x/y (which are anchored by the object's ORIGIN).
        const b = w.__audio.button();
        const cb = w.__game.scale.canvasBounds, sz = w.__game.scale.gameSize;
        return { x: cb.x + (b.centerX / sz.width) * cb.width, y: cb.y + (b.centerY / sz.height) * cb.height };
      });
      await page.touchscreen.tap(target.x, target.y);
      await pump(page, 2);
      expect(await page.evaluate(() => (window as any).__audio.muted())).toBe(!before);
    });
  });
});
