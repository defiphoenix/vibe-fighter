// Second, independent QA pass -- Phase 20 (game audio). Deliberately does NOT re-run
// e2e/qa20-audio.spec.ts, whose 40 cases already pass. This file goes at what that pass own
// acceptance-criteria mapping left thin: file-content integrity (not just HTTP presence), the boot
// gate edges beyond a plain 404 and garbage bytes (including the branch that must NOT fire -- a
// device with no audio hardware at all), the actual determinism claim in criterion 6 (no test in the
// first pass drives an identical script twice and diffs the resulting sim state), the mute control
// under the three states most likely to occlude or intercept it, and a real-wall-clock check that
// one-shot sounds actually self-clean.
import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { ready as harnessReady, pump, press, toFlow, driveTo1v1, MATCH } from "./harness";
import { AUDIO_KEYS } from "../src/render/audio-cues";

/* eslint-disable @typescript-eslint/no-explicit-any */

test.slow();

const __filenameQA = fileURLToPath(import.meta.url);
const __dirnameQA = path.dirname(__filenameQA);
const repoRoot = path.resolve(__dirnameQA, "..");
const audioDir = path.join(repoRoot, "public", "audio");

const readyMatch = (page: Page, extra: string[] = []): Promise<void> =>
  harnessReady(page, { route: MATCH, needs: ["__sprites", "__world", "__game", "__holdP1", "__holdP2", "__audio", ...extra] });

async function evalGame<T>(page: Page, fn: (w: any, step: (n: number, d?: number) => void) => T): Promise<T> {
  return page.evaluate((fnStr) => {
    const f = eval(`(${fnStr})`);
    const w = window as any;
    const g = w.__game;
    let t = g.loop?.now ?? performance.now();
    const step = (n: number, d = 1000 / 60) => { for (let i = 0; i < n; i++) { t += d; g.step(t, d); } };
    return f(w, step);
  }, fn.toString());
}

const muteClickCoords = (page: Page): Promise<{ x: number; y: number }> =>
  page.evaluate(() => {
    const b = (window as any).__audio.button();
    const s = (window as any).__game.scale;
    return {
      x: s.canvasBounds.left + (b.x + b.width / 2) / s.displayScale.x,
      y: s.canvasBounds.top + (b.y + b.height / 2) / s.displayScale.y,
    };
  });

test.describe("criterion 1 (deep) -- every shipped file actually decodes to real, non-silent audio", () => {
  test("all 14 files decode via the real Web Audio decoder and contain audible signal", async ({ page }) => {
    await page.goto("/");
    const results = await page.evaluate(async (keys: string[]) => {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctx();
      const out: Record<string, { ok: boolean; err?: string; duration?: number; peak?: number }> = {};
      for (const key of keys) {
        try {
          const res = await fetch(`/audio/${key}.mp3`);
          const buf = await res.arrayBuffer();
          const decoded: AudioBuffer = await new Promise((resolve, reject) => {
            const p = ctx.decodeAudioData(buf.slice(0), resolve, reject);
            if (p && typeof p.then === "function") p.then(resolve, reject);
          });
          let peak = 0;
          for (let c = 0; c < decoded.numberOfChannels; c++) {
            const data = decoded.getChannelData(c);
            for (let i = 0; i < data.length; i += 37) {
              const v = Math.abs(data[i]);
              if (v > peak) peak = v;
            }
          }
          out[key] = { ok: true, duration: decoded.duration, peak };
        } catch (e) {
          out[key] = { ok: false, err: String(e) };
        }
      }
      return out;
    }, [...AUDIO_KEYS]);

    for (const key of AUDIO_KEYS) {
      const r = results[key];
      expect(r?.ok, `${key}.mp3 failed to decode: ${r?.err}`).toBe(true);
      expect(r!.duration!, `${key}.mp3 decoded to zero/near-zero duration`).toBeGreaterThan(0.03);
      expect(r!.peak!, `${key}.mp3 decoded but is silent (peak sample ${r!.peak})`).toBeGreaterThan(0.01);
    }
  });
});

test.describe("criterion 3 (deep) -- boot gate edges beyond a plain 404 / garbage bytes", () => {
  test("an empty HTTP-200 (0 bytes) audio file blocks routing", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    await page.route("**/audio/block.mp3", (route) => route.fulfill({ status: 200, contentType: "audio/mpeg", body: Buffer.alloc(0) }));
    await page.goto("/?scene=match");
    let routed = false;
    try {
      await page.waitForFunction(() => (window as any).__world != null || (window as any).__flow != null, null, { timeout: 8000 });
      routed = true;
    } catch { /* expected */ }
    expect(routed, "the game routed despite an empty 200 audio file").toBe(false);
    expect(pageErrors.some((e) => /boot: assets failed to load/.test(e)), JSON.stringify(pageErrors)).toBe(true);
  });

  test("wrong Content-Type on an otherwise-valid audio file does NOT block boot (decode ignores the header)", async ({ page }) => {
    const real = fs.readFileSync(path.join(audioDir, "menuMove.mp3"));
    await page.route("**/audio/menuMove.mp3", (route) => route.fulfill({ status: 200, contentType: "text/plain", body: real }));
    await harnessReady(page, { needs: ["__game", "__flow", "__audio"] });
    expect(await page.evaluate(() => (window as any).__flow?.state()?.step)).toBe("title");
  });
});

test.describe("criterion 3 (deep continued) -- a truncated real file", () => {
  test("a REAL file truncated to its first 300 bytes: the boot gate verdict matches what the browser decoder actually does with it", async ({ page }) => {
    const real = fs.readFileSync(path.join(audioDir, "hitLight.mp3"));
    const fullDurationCtl = await page.evaluate(async (bytes: number[]) => {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctx();
      const buf = new Uint8Array(bytes).buffer;
      try {
        const d: AudioBuffer = await ctx.decodeAudioData(buf);
        return d.duration;
      } catch { return null; }
    }, Array.from(real));
    expect(fullDurationCtl, "control: the real file must itself decode for this test to mean anything").not.toBeNull();

    const truncated = real.subarray(0, 300);
    const truncDecodes = await page.evaluate(async (bytes: number[]) => {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctx();
      const buf = new Uint8Array(bytes).buffer;
      try {
        const d: AudioBuffer = await ctx.decodeAudioData(buf);
        return { ok: true, duration: d.duration };
      } catch (e) { return { ok: false, err: String(e) }; }
    }, Array.from(truncated));

    const p2 = await page.context().newPage();
    const pageErrors: string[] = [];
    p2.on("pageerror", (e) => pageErrors.push(String(e)));
    await p2.route("**/audio/hitLight.mp3", (route) => route.fulfill({ status: 200, contentType: "audio/mpeg", body: truncated }));
    await p2.goto("/?scene=match");
    let routed = false;
    try {
      await p2.waitForFunction(() => (window as any).__world != null || (window as any).__flow != null, null, { timeout: 8000 });
      routed = true;
    } catch { /* only expected if the decoder also rejected it */ }
    await p2.close();

    if (truncDecodes.ok) {
      expect(routed, `browser decoded the truncated file (duration ${truncDecodes.duration}) but the game still refused to boot`).toBe(true);
      expect((truncDecodes.duration as number)).toBeLessThan(fullDurationCtl as number);
    } else {
      expect(routed, `browser rejected the truncated file (${truncDecodes.err}) but the game booted anyway -- undecodable audio slipped past the gate`).toBe(false);
      expect(pageErrors.some((e) => /boot: assets failed to load/.test(e)), JSON.stringify(pageErrors)).toBe(true);
    }
  });
});

test.describe("criterion 3 (deep continued) -- no audio hardware, and a hanging request", () => {
  test("a device with NO audio capability at all still boots, plays fine, and never throws", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "AudioContext", { value: undefined, configurable: true });
      Object.defineProperty(window, "webkitAudioContext", { value: undefined, configurable: true });
      Object.defineProperty(window, "Audio", { value: undefined, configurable: true });
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    await readyMatch(page);

    const dev = await page.evaluate(() => (window as any).__game.device.audio);
    expect(dev.webAudio, "fixture failed to remove webAudio capability").toBe(false);
    expect(dev.audioData, "fixture failed to remove audioData capability").toBe(false);

    const r = await evalGame(page, (w, step) => {
      step(100);
      w.__world.fighters[0].reset(700, 1);
      w.__world.fighters[1].reset(760, -1);
      step(1);
      const before = w.__world.fighters[1].health;
      w.__holdP1({ light: true, lightPressed: true });
      step(1);
      w.__holdP1({});
      step(20);
      return { before, after: w.__world.fighters[1].health as number, muted: w.__audio.muted(), locked: w.__audio.locked() };
    });
    expect(r.after, "combat must still work on a device with no audio hardware").toBeLessThan(r.before);
    expect(pageErrors, `unexpected page errors on a no-audio-hardware device: ${JSON.stringify(pageErrors)}`).toEqual([]);
  });

  test("a request that never resolves hangs the boot rather than failing fast or booting silently (observed, not asserted as a defect)", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    let release: (() => void) | undefined;
    const held = new Promise<void>((res) => { release = res; });
    await page.route("**/audio/roundStart.mp3", async (route) => {
      await held;
      await route.fulfill({ status: 200, contentType: "audio/mpeg", body: fs.readFileSync(path.join(audioDir, "roundStart.mp3")) });
    });
    await page.goto("/?scene=match");
    await page.waitForTimeout(4000);
    const routed = await page.evaluate(() => (window as any).__world != null || (window as any).__flow != null);
    expect(routed, "a hanging request should not have let the game route yet").toBe(false);
    expect(pageErrors, "a hang must not itself throw into the page").toEqual([]);
    release?.();
    await page.waitForTimeout(500);
  });
});

test.describe("criterion 6 (determinism) -- identical inputs produce a bit-identical sim trajectory regardless of audio state", () => {
  test("muted-from-the-start vs. unlocked-and-unmuted: same script, same world trajectory, including a simultaneous hit+ko+roundEnd frame", async ({ page }) => {
    const runOnce = async (muted: boolean): Promise<any[]> => {
      await readyMatch(page, ["__endMenu"]);
      if (muted) {
        await page.evaluate(() => (window as any).__audio.toggle());
      } else {
        // A raw DOM event on document.body, NOT the harness `press()` helper: `press()` pumps 8 sim
        // frames (down + 4 + up + 4), which would offset this branch by 8 ticks versus the muted
        // branch (which pumps none to establish its own gesture) and make the trajectories diverge
        // for a reason that has nothing to do with audio. Phaser installs its unlock listeners on
        // document.body for keydown among others (see audio-view.ts startBed doc), so this unlocks
        // the AudioContext without moving the game loop at all.
        await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true })));
      }
      const trace = await evalGame(page, (w, step) => {
        const snap = (): any => {
          const f = w.__world.fighters;
          return [f[0].x, f[0].y, f[0].health, f[0].meter, f[0].state, f[0].grounded,
                  f[1].x, f[1].y, f[1].health, f[1].meter, f[1].state, f[1].grounded,
                  w.__world.match.phase, w.__world.match.timerTicks, w.__world.match.wins[0], w.__world.match.wins[1]];
        };
        const out: any[] = [];
        step(100);
        w.__world.fighters[0].reset(700, 1);
        w.__world.fighters[1].reset(760, -1);
        step(1);
        w.__holdP1({ light: true, lightPressed: true }); step(1); w.__holdP1({}); step(15);
        out.push(snap());
        w.__holdP2({ block: true }); step(2);
        w.__holdP1({ heavy: true, heavyPressed: true }); step(1); w.__holdP1({}); step(20);
        w.__holdP2({});
        out.push(snap());
        w.__holdP1({ up: true, upPressed: true }); step(1); w.__holdP1({}); step(10);
        out.push(snap());
        step(40);
        out.push(snap());
        w.__world.match.wins = [1, 0]; // one win already banked -- this KO must decide the match
        w.__world.fighters[0].reset(700, 1);
        w.__world.fighters[1].reset(760, -1);
        w.__world.fighters[1].health = 1;
        step(1);
        w.__holdP1({ heavy: true, heavyPressed: true }); step(1); w.__holdP1({});
        step(30);
        out.push(snap());
        return out;
      });
      await page.evaluate(() => { (window as any).__world = null; (window as any).__game.scene.start("Flow"); });
      await page.waitForFunction(() => (window as any).__flow != null);
      return trace;
    };

    const muted = await runOnce(true);
    const unmuted = await runOnce(false);

    expect(muted.length).toBe(unmuted.length);
    for (let i = 0; i < muted.length; i++) {
      expect(unmuted[i], `sim state diverged at checkpoint ${i} between muted and unmuted runs`).toEqual(muted[i]);
    }
    expect(muted[muted.length - 1][12]).toBe("matchEnd");
  });
});

test.describe("criterion 7 (adversarial) -- the mute control stays reachable during a super freeze, the end menu, and the quit prompt", () => {
  test("mute toggles correctly WHILE a super freeze / cut-in is on screen", async ({ page }) => {
    await readyMatch(page);
    await press(page, "ArrowLeft");
    await pump(page, 100); // clear the intro -- a press during intro is gated and consumed silently
    expect(await page.evaluate(() => (window as any).__audio.muted())).toBe(false);

    await page.evaluate(() => {
      const w = window as any;
      w.__world.fighters[0].reset(700, 1);
      w.__world.fighters[1].reset(760, -1);
      w.__world.fighters[0].meter = 100;
    });
    await pump(page, 1);
    await page.evaluate(() => (window as any).__holdP1({ special: true, specialPressed: true }));
    await pump(page, 1);
    await page.evaluate(() => (window as any).__holdP1({}));
    await pump(page, 2);
    const frozen = await page.evaluate(() => (window as any).__world.hitstop as number);
    expect(frozen, "the special did not actually freeze the game -- this case does not exercise a real cut-in").toBeGreaterThan(0);

    const c = await muteClickCoords(page);
    await page.mouse.click(c.x, c.y);
    await pump(page, 2);
    expect(await page.evaluate(() => (window as any).__audio.muted()), "mute did not toggle while frozen by a super cut-in").toBe(true);
    expect(await page.evaluate(() => (window as any).__world.hitstop as number)).toBeGreaterThan(0);
  });

  test("mute toggles correctly WHILE the match-end menu (and its scrim) is on screen", async ({ page }) => {
    await readyMatch(page, ["__endMenu"]);
    await page.evaluate(() => {
      const w = window as any;
      w.__world.match.phase = "fight";
      w.__world.match.introTicks = 0;
      w.__world.match.wins = [1, 0]; // one win already banked -- THIS KO must decide the match
      w.__world.fighters[0].reset(700, 1);
      w.__world.fighters[1].reset(760, -1);
      w.__world.fighters[1].health = 1;
      w.__holdP1({ light: true, lightPressed: true });
    });
    await pump(page, 30);
    await page.evaluate(() => (window as any).__holdP1({}));
    await pump(page, 10);
    expect(await page.evaluate(() => (window as any).__world.match.phase)).toBe("matchEnd");
    expect(await page.evaluate(() => (window as any).__endMenu().shown), "the end menu is not actually up -- this case proves nothing").toBe(true);

    const selBefore = await page.evaluate(() => (window as any).__endMenu().sel);
    const c = await muteClickCoords(page);
    await page.mouse.click(c.x, c.y);
    await pump(page, 2);
    expect(await page.evaluate(() => (window as any).__audio.muted()), "mute did not toggle behind the end-menu scrim").toBe(true);
    expect(await page.evaluate(() => (window as any).__world.match.phase), "the mute tap changed match phase -- it hit something behind it").toBe("matchEnd");
    expect(await page.evaluate(() => (window as any).__endMenu().sel), "the mute tap changed the end-menu selection").toBe(selBefore);
  });

  test("mute toggles correctly WHILE the mid-fight quit-confirmation prompt is armed", async ({ page }) => {
    await readyMatch(page);
    await press(page, "ArrowLeft");
    await pump(page, 3);
    await press(page, "Escape");
    expect(await page.evaluate(() => (window as any).__quitArmed()), "Escape did not arm the quit prompt -- this case proves nothing").toBe(true);

    const c = await muteClickCoords(page);
    await page.mouse.click(c.x, c.y);
    await pump(page, 2);
    expect(await page.evaluate(() => (window as any).__audio.muted()), "mute did not toggle while the quit prompt was up").toBe(true);
    expect(await page.evaluate(() => (window as any).__world != null), "the mute tap quit the match").toBe(true);
    expect(await page.evaluate(() => (window as any).__quitArmed()), "the mute tap disarmed the quit prompt").toBe(true);
  });
});

test.describe("criterion 6 (leakage, real time) -- one-shot cue sounds actually self-destruct in real time", () => {
  test("after a burst of cues finishes playing (real wall clock, not pumped frames), game.sound.sounds returns to baseline", async ({ page }) => {
    await readyMatch(page);
    await press(page, "ArrowLeft");
    await pump(page, 3);
    // Wait for the BED before baselining. `startBed` defers behind the browser's autoplay lock and
    // starts on the UNLOCKED event, which lands a few stepped frames after the key press above --
    // so a baseline taken here could be captured with the bed still pending and then compared
    // against a later count that includes it. That off-by-one was always latent; it only started
    // failing when the retained `super` shifted both numbers.
    await expect.poll(async () => {
      await pump(page, 1);
      return page.evaluate(() => (window as any).__audio.bedPlaying() as boolean);
    }).toBe(true);
    const baseline = await page.evaluate(() => (window as any).__game.sound.sounds.length as number);

    await page.evaluate(() => {
      const w = window as any;
      // Every cue, menu ones included: those fire on repeated select-screen navigation, so a leak
      // there would accumulate across exactly the flow a player uses most.
      for (const cue of ["hitLight", "hitHeavy", "block", "whiff", "jump", "land", "ko", "super",
        "roundStart", "roundEnd", "menuMove", "menuConfirm"]) {
        w.__audio.play(cue);
      }
    });
    const midBurst = await page.evaluate(() => (window as any).__game.sound.sounds.length as number);
    expect(midBurst, "the burst did not actually start any real sound instances").toBeGreaterThan(baseline);

    // Poll rather than a single fixed sleep: `super.mp3` alone is 3.6s (measured via ffprobe), the
    // longest shipped one-shot, so a flat 3s wait undershoots it. Bounded well above that margin.
    // Pumped frames are interleaved with the real-time wait deliberately -- see the comment above
    // this test's fixture history: cleanup is reconciled on the next STEPPED frame, not purely by
    // real time elapsing, and continuous foreground play always has frames stepping.
    //
    // `super` is in the burst above but is NOT one of the instances being waited on: it is the one
    // retained cue, so the burst replays the existing instance instead of adding a new one, and it
    // is already inside `baseline`. That is exactly why it is built eagerly in the constructor.
    let after = midBurst;
    for (let i = 0; i < 20 && after > baseline; i++) {
      await page.waitForTimeout(500);
      await pump(page, 2);
      after = await page.evaluate(() => (window as any).__game.sound.sounds.length as number);
    }
    expect(after, `sound instances did not clean up after playing out within 10s: baseline=${baseline} midBurst=${midBurst} after=${after}`).toBeLessThanOrEqual(baseline);
  });
});

test.describe("criterion 5/6 (stress) -- rapid mute toggling never throws and always lands correctly", () => {
  test("100 toggles in one frame: no throw, correct final parity, gain matches the final intent", async ({ page }) => {
    const pageErrors: string[] = [];
    await readyMatch(page);
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    await press(page, "ArrowLeft");
    await pump(page, 3);

    await page.evaluate(() => {
      const w = window as any;
      for (let i = 0; i < 100; i++) w.__audio.toggle();
    });
    await pump(page, 3);
    expect(pageErrors, `toggling threw: ${JSON.stringify(pageErrors)}`).toEqual([]);
    expect(await page.evaluate(() => (window as any).__audio.muted())).toBe(false);
    await expect.poll(async () => { await pump(page, 1); return page.evaluate(() => (window as any).__audio.gain()); }).toBeCloseTo(1, 3);

    await page.reload();
    await harnessReady(page, { route: MATCH, needs: ["__game", "__world", "__audio"] });
    expect(await page.evaluate(() => (window as any).__audio.muted())).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------------
// The interrupted super (post-Phase-20 defect): the ~3.6 s `super` sting outlived the ~1.5 s move it
// announced, so being stuffed mid-super left the sound ringing over a move that had stopped.
//
// The observable that matters is `__audio.superPlaying()`, which reads Phaser's own `isPlaying` off
// the retained instance. A `plays` counter cannot prove a STOP -- it only ever counts up.
// -------------------------------------------------------------------------------------------------

test.describe("interrupted super -- the sting is cut when the move it announced stops", () => {
  test("a REAL hit landing inside the special cuts the sting", async ({ page }) => {
    await readyMatch(page);
    const r = await evalGame(page, (w: any, step: any) => {
      step(100);                                    // clear the intro gate (INTRO_TICKS = 90)
      w.__world.fighters[0].reset(700 - 45, 1);
      w.__world.fighters[1].reset(700 + 45, -1);
      w.__audio.clear();
      w.__world.fighters[0].meter = 100;
      w.__holdP1({ special: true, specialPressed: true });
      step(1);
      w.__holdP1({});
      while (w.__world.hitstop > 0) step(1);        // the 36-tick super freeze
      const armed = {
        state: w.__world.fighters[0].state as string,
        playing: w.__audio.superPlaying() as boolean,
        stops: w.__audio.stops() as number,
      };
      // P2's light is startup 4-5 on every fighter in the roster and the special's startup is 9-10,
      // so the light lands while P1 is still winding up -- through the sim, with nothing poked in
      // from outside. That matters: the interruption flag is PER TICK, so a state set between ticks
      // would be cleared by the next tick before advance() could ever accumulate it.
      w.__holdP2({ light: true, lightPressed: true });
      for (let i = 0; i < 12 && w.__world.fighters[0].state === "special"; i++) step(1);
      w.__holdP2({});
      step(1);
      return {
        armed,
        after: {
          state: w.__world.fighters[0].state as string,
          playing: w.__audio.superPlaying() as boolean,
          stops: w.__audio.stops() as number,
        },
      };
    });
    expect(r.armed.state, "the super never started").toBe("special");
    expect(r.armed.playing, "the super sting never started playing").toBe(true);
    expect(r.armed.stops).toBe(0);
    expect(r.after.state, "the sim did not actually stun P1 out of the special").toBe("hitstun");
    expect(r.after.playing, "the sting is STILL playing over an interrupted super").toBe(false);
    expect(r.after.stops).toBe(1);
  });

  test("the same holds with the roles reversed -- not a P1-only path", async ({ page }) => {
    await readyMatch(page);
    const r = await evalGame(page, (w: any, step: any) => {
      step(100);
      w.__world.fighters[0].reset(700 - 45, 1);
      w.__world.fighters[1].reset(700 + 45, -1);
      w.__audio.clear();
      w.__world.fighters[1].meter = 100;
      w.__holdP2({ special: true, specialPressed: true });
      step(1);
      w.__holdP2({});
      while (w.__world.hitstop > 0) step(1);
      const armed = {
        state: w.__world.fighters[1].state as string,
        playing: w.__audio.superPlaying() as boolean,
      };
      w.__holdP1({ light: true, lightPressed: true });
      for (let i = 0; i < 12 && w.__world.fighters[1].state === "special"; i++) step(1);
      w.__holdP1({});
      step(1);
      return {
        armed,
        after: {
          state: w.__world.fighters[1].state as string,
          playing: w.__audio.superPlaying() as boolean,
          stops: w.__audio.stops() as number,
        },
      };
    });
    expect(r.armed.state).toBe("special");
    expect(r.armed.playing).toBe(true);
    expect(r.after.state).toBe("hitstun");
    expect(r.after.playing, "the sting is still playing over P2's interrupted super").toBe(false);
    expect(r.after.stops).toBe(1);
  });

  test("a super that COMPLETES is not cut -- proving it reached idle first", async ({ page }) => {
    await readyMatch(page);
    const r = await evalGame(page, (w: any, step: any) => {
      step(100);
      w.__world.fighters[0].reset(700 - 45, 1);
      w.__world.fighters[1].reset(700 + 45, -1);
      w.__audio.clear();
      w.__world.fighters[0].meter = 100;
      w.__holdP1({ special: true, specialPressed: true });
      step(1);
      w.__holdP1({});
      // Run the move right out. The 36 freeze ticks do NOT advance timers, so the 53-tick move needs
      // 53 FURTHER advances on top of them: pumping 53 total would leave the fighter still in
      // `special`, the "it finished" branch would never run, and the assertion below would pass
      // without testing anything. Hence the explicit state check, not a fixed tick count.
      for (let i = 0; i < 400 && w.__world.fighters[0].state === "special"; i++) step(1);
      return {
        state: w.__world.fighters[0].state as string,
        stops: w.__audio.stops() as number,
        playing: w.__audio.superPlaying() as boolean,
      };
    });
    // `=== "idle"`, not `!== "special"`. The looser form is satisfied by hitstun, knockdown or KO —
    // i.e. by the move being INTERRUPTED, which is the opposite of what this test claims to cover.
    expect(r.state, "the special did not complete cleanly, so this test asserts nothing").toBe("idle");
    expect(r.stops, "a COMPLETED super was cut").toBe(0);
    expect(r.playing, "the sting should still be ringing after a clean super").toBe(true);
  });

  test("a mid-match restart cuts a still-ringing super", async ({ page }) => {
    // `World.restart()` resets both fighters WITHOUT routing through applyHit, so the sim reports no
    // interruption. The render layer catches this one off the `intro` phase instead.
    //
    // Driven through `world.restart()` inside ONE evaluate, which is exactly what `MatchScene`'s
    // Enter handler calls (`rematch()`), and deliberately NOT through a real `Enter` press. The key
    // binding is already covered by the Phase 11 specs; what a real press adds here is a round trip
    // of WALL-CLOCK time, and the audio clock keeps running through it while the pumped game clock
    // does not. `super.mp3` is 3.6 s, so on a loaded worker the sting can finish on its own before
    // the restart lands — `stop()` then correctly returns false, `stops` stays 0, and the test fails
    // for a reason that has nothing to do with the code under test. Measured: it passes alone and
    // fails in the full file.
    await readyMatch(page);
    const r = await evalGame(page, (w: any, step: any) => {
      step(100);
      w.__audio.clear();
      w.__world.fighters[0].meter = 100;
      w.__holdP1({ special: true, specialPressed: true });
      step(1);
      w.__holdP1({});
      const before = {
        playing: w.__audio.superPlaying() as boolean,
        stops: w.__audio.stops() as number,
        phase: w.__world.match.phase as string,
      };
      w.__world.restart();
      step(2);
      return {
        before,
        after: {
          phase: w.__world.match.phase as string,
          playing: w.__audio.superPlaying() as boolean,
          stops: w.__audio.stops() as number,
        },
      };
    });
    expect(r.before.phase).toBe("fight");
    expect(r.before.playing, "the super sting never started, so the cut proves nothing").toBe(true);
    expect(r.before.stops).toBe(0);
    expect(r.after.phase, "the restart did not begin a new round").toBe("intro");
    expect(r.after.playing, "the previous match's super rings on over a fresh round").toBe(false);
    expect(r.after.stops).toBe(1);
  });

  test("the retained super instance does not accumulate across Flow -> match", async ({ page }) => {
    // The tracked super is one more thing that can survive a round trip, and unlike a one-shot it has
    // no COMPLETE handler to destroy it — only `GameAudio.destroy()` removes it.
    //
    // Counts `super` instances SPECIFICALLY rather than `sounds.length`. The total is not a stable
    // baseline here: `driveTo1v1` walks the select screen with real key presses, each firing a
    // menuMove/menuConfirm one-shot, and those self-destruct on COMPLETE — i.e. on real wall-clock
    // audio time, which the pumped game clock does not control. Measured: the total reads 1 alone and
    // 3 under load, purely from menu cues still ringing. The invariant that actually matters is that
    // exactly one tracked super exists no matter how many times the scene is rebuilt.
    const countSupers = () =>
      page.evaluate(() =>
        ((window as any).__game.sound.sounds as any[]).filter((s) => s.key === "super").length);

    await readyMatch(page);
    await pump(page, 3);
    expect(await countSupers(), "the match should hold exactly one tracked super").toBe(1);

    await evalGame(page, (w: any, step: any) => {
      step(100);
      w.__world.fighters[0].meter = 100;
      w.__holdP1({ special: true, specialPressed: true });
      step(1);
      w.__holdP1({});
      step(5);
    });
    await toFlow(page);
    await driveTo1v1(page, 0);
    await pump(page, 5);
    expect(
      await countSupers(),
      "a tracked super survived the scene round trip — GameAudio.destroy() is not removing it",
    ).toBe(1);
  });

  test("MEASUREMENT: stopByKey leaks, which is why the super keeps a retained handle", async ({ page }) => {
    // Not a product assertion -- the evidence for a design choice that would otherwise look like
    // over-engineering. `stop()` tears down the buffer source, so `onended` -> `hasEnded` ->
    // `COMPLETE` never fires; `COMPLETE` is the ONLY thing wired to `destroy()` on a fire-and-forget
    // instance, so `pendingRemove` stays false and `BaseSoundManager.update()` never splices it.
    //
    // If this test ever fails, the rationale in `audio-view.ts` is wrong and the simpler
    // `sound.stopByKey("super")` should replace the retained handle.
    await readyMatch(page);
    await pump(page, 3);
    const r = await evalGame(page, (w: any, step: any) => {
      const g = w.__game;
      const before = g.sound.sounds.length as number;
      g.sound.play("ko");                            // an untracked one-shot: the fire-and-forget path
      const during = g.sound.sounds.length as number;
      g.sound.stopByKey("ko");
      step(3);                                       // cleanup is reconciled on a stepped frame
      return { before, during, afterStop: g.sound.sounds.length as number };
    });
    expect(r.during, "the one-shot never started").toBeGreaterThan(r.before);
    expect(
      r.afterStop,
      "stopByKey DID clean up -- the retained-handle rationale is wrong and should be revisited",
    ).toBeGreaterThan(r.before);
  });
});
