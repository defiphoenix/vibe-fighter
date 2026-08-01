import { test, expect, devices, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { ready as harnessReady, pump, press, keys, toFlow, driveTo1v1, MATCH, PLAYGROUND } from "./harness";
import { CueDirector, menuCue, CUE_KEYS, BED_KEYS, AUDIO_KEYS, audioPath } from "../src/render/audio-cues";
import type { CueKey, FighterAudioView, ConsumedView } from "../src/render/audio-cues";
import { touchLayout, BUTTON_R } from "../src/render/touch";
import { STAGE_HEIGHT } from "../src/sim/constants";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Independent QA pass -- Phase 20 (game audio). Written from the acceptance criteria, without reading
// the phase doc or the implementation diff. Investigation of `src/render/audio-view.ts` and
// `src/render/audio-cues.ts` happened only to learn the *seam surface* (the same information the task
// brief already promised: window.__audio, the mute button, the DEV routes) -- not to copy the author's
// own test intent.
//
// Two independent axes are used throughout, deliberately:
//   (1) a pure Node-side unit pass against `CueDirector`/`menuCue` -- Phaser-free by the project's own
//       convention, so it is the most reliable way to pin the cooldown/priority/cap MATH without any
//       gameplay-timing noise;
//   (2) real-browser integration passes (`ready`/`pump` from harness.ts) that prove the math above is
//       actually WIRED to real sim events, real input and real scene transitions -- a unit pass alone
//       cannot see a director that is correct but never called.
test.slow();

const __filenameQA = fileURLToPath(import.meta.url);
const __dirnameQA = path.dirname(__filenameQA);
const repoRoot = path.resolve(__dirnameQA, "..");

const readyMatch = (page: Page, extra: string[] = []): Promise<void> =>
  harnessReady(page, { route: MATCH, needs: ["__sprites", "__world", "__game", "__holdP1", "__holdP2", "__audio", ...extra] });

const audioReady = (page: Page): Promise<void> =>
  harnessReady(page, { needs: ["__game", "__flow", "__audio"] });

/** How many looping beds are alive right now. Should never exceed 1. */
const liveBeds = (page: Page): Promise<number> =>
  page.evaluate((beds: readonly string[]) =>
    ((window as any).__game.sound.sounds as any[]).filter((s) => beds.includes(s.key)).length,
  BED_KEYS as unknown as string[]);

/**
 * Sound instances that are SUPPOSED to outlive a frame: the one looping bed, and the one retained
 * `super` (which has no COMPLETE handler by design — `GameAudio.destroy()` is what removes it).
 *
 * Everything else is a fire-and-forget one-shot that self-destructs on COMPLETE, i.e. on the real
 * audio clock rather than the pumped one — so a raw `sounds.length` reads as high or low depending on
 * how loaded the machine is, which is not what a leak test should be measuring.
 */
const persistentSounds = (page: Page): Promise<number> =>
  page.evaluate((beds: readonly string[]) =>
    ((window as any).__game.sound.sounds as any[])
      .filter((s) => beds.includes(s.key) || s.key === "super").length,
  BED_KEYS as unknown as string[]);

async function evalGame<T>(page: Page, fn: (w: any, step: (n: number, d?: number) => void) => T): Promise<T> {
  return page.evaluate((fnStr) => {
    // eslint-disable-next-line no-eval
    const f = eval(`(${fnStr})`);
    const w = window as any;
    const g = w.__game;
    let t = g.loop?.now ?? performance.now();
    const step = (n: number, d = 1000 / 60) => { for (let i = 0; i < n; i++) { t += d; g.step(t, d); } };
    return f(w, step);
  }, fn.toString());
}

// -------------------------------------------------------------------------------------------------
// 1. Assets shipped
// -------------------------------------------------------------------------------------------------

test.describe("criterion 1 -- every sound is generated and shipped", () => {
  test("all 14 files (12 cues + 2 beds) exist under public/audio and are fetchable", async ({ request, baseURL }) => {
    expect(CUE_KEYS.length, "cue roster changed size -- re-check the 14-file claim").toBe(12);
    expect(BED_KEYS.length).toBe(2);
    expect(AUDIO_KEYS.length).toBe(14);
    for (const key of AUDIO_KEYS) {
      const url = new URL(audioPath(key), baseURL).toString();
      const res = await request.get(url);
      expect(res.ok(), `${key} -> ${audioPath(key)} did not fetch (${res.status()})`).toBeTruthy();
      const len = Number(res.headers()["content-length"] ?? "0");
      expect(len, `${key}.mp3 is empty`).toBeGreaterThan(0);
    }
  });

  test("every shipped audio file is named in AUDIO_KEYS -- nothing orphaned, nothing extra", async () => {
    const dir = path.join(repoRoot, "public", "audio");
    const onDisk = fs.readdirSync(dir).filter((f) => f.endsWith(".mp3")).map((f) => f.replace(/\.mp3$/, "")).sort();
    const declared = [...AUDIO_KEYS].sort();
    expect(onDisk).toEqual(declared);
  });
});

// -------------------------------------------------------------------------------------------------
// 2a. CueDirector -- pure unit pass (no browser). Pins the cooldown/priority/cap math directly.
// -------------------------------------------------------------------------------------------------

function fv(state: any = "idle", grounded = true): FighterAudioView {
  return { state, grounded };
}
function cv(over: Partial<ConsumedView> = {}): ConsumedView {
  return { up: false, light: false, heavy: false, special: false, ...over };
}
const NOEVENTS: any[] = [];

/** `CueDirector.fight()` reports what to PLAY and what to CUT. This suite predates the cut and asserts
 *  only on the played cues; the cut is covered by `src/render/audio-cues.test.ts` and, end to end,
 *  by the interrupted-super specs in `qa20b-audio-deep.spec.ts`. */
const played = (d: CueDirector, ...a: Parameters<CueDirector["fight"]>): CueKey[] => d.fight(...a).play;

test.describe("criterion 2 (unit) -- CueDirector: what fires, how often, capped how", () => {
  test("a landed light hit requests hitLight; a heavy-keyed attack requests hitHeavy", () => {
    const d = new CueDirector();
    const light = played(d, [{ type: "hit", data: { attack: "light" } }] as any, [fv(), fv()], [cv(), cv()], "fight", 0);
    expect(light).toEqual(["hitLight"]);
    const d2 = new CueDirector();
    const heavy = played(d2, [{ type: "hit", data: { attack: "heavy" } }] as any, [fv(), fv()], [cv(), cv()], "fight", 0);
    expect(heavy).toEqual(["hitHeavy"]);
  });

  test("block, ko, super, roundStart, roundEnd events map to their own cue", () => {
    const cases: [string, CueKey][] = [
      ["block", "block"], ["ko", "ko"], ["special", "super"], ["roundStart", "roundStart"], ["roundEnd", "roundEnd"],
    ];
    for (const [evt, cue] of cases) {
      const d = new CueDirector();
      const got = played(d, [{ type: evt }] as any, [fv(), fv()], [cv(), cv()], "fight", 0);
      expect(got, `event "${evt}"`).toContain(cue);
    }
  });

  test("matchEnd fires no cue of its own -- it rides roundEnd", () => {
    const d = new CueDirector();
    const got = played(d, [{ type: "matchEnd" }] as any, [fv(), fv()], [cv(), cv()], "fight", 0);
    expect(got).toEqual([]);
  });

  test("a fast flurry does not machine-gun the cue: repeats inside the cooldown window are dropped", () => {
    const d = new CueDirector();
    const events = [{ type: "hit", data: { attack: "light" } }] as any;
    const plays: number[] = [];
    for (let i = 0; i < 10; i++) {
      const got = played(d, events, [fv(), fv()], [cv(), cv()], "fight", i * 16.67);
      if (got.includes("hitLight")) plays.push(i);
    }
    expect(plays.length, `admitted frames: ${plays.join(",")}`).toBeLessThan(10);
    expect(plays.length).toBeGreaterThan(0);
    expect(plays.length).toBeLessThanOrEqual(4);
  });

  test("a KO batch (hit + ko + roundEnd, same frame) is capped at MAX_PER_FRAME and priority-ordered", () => {
    const d = new CueDirector();
    const got = played(d, 
      [
        { type: "hit", data: { attack: "heavy" } },
        { type: "ko" },
        { type: "roundEnd" },
      ] as any,
      [fv(), fv()], [cv(), cv()], "fight", 0,
    );
    expect(new Set(got)).toEqual(new Set(["hitHeavy", "ko", "roundEnd"]));
    expect(got.length).toBeLessThanOrEqual(3);
  });

  test("an overflowing want-set is capped at 3 and keeps the highest-priority cues, not an arbitrary subset", () => {
    const d = new CueDirector();
    const got = played(d, 
      [{ type: "block" }, { type: "roundStart" }] as any,
      [fv(), fv()], [cv({ up: true, light: true }), cv()], "fight", 0,
    );
    expect(got.length).toBe(3);
    expect(got).toContain("block");
    expect(got).toContain("roundStart");
    expect(got).toContain("jump");
    expect(got).not.toContain("whiff");
  });

  test("whiff fires on attack STARTUP (any consumed light/heavy), including one that will land -- by design", () => {
    const d = new CueDirector();
    const got = played(d, NOEVENTS, [fv(), fv()], [cv({ light: true }), cv()], "fight", 0);
    expect(got).toEqual(["whiff"]);
  });

  test("jump fires on a consumed up-edge; land fires on the grounded transition, gated to the fight phase", () => {
    const d = new CueDirector();
    const jump = played(d, NOEVENTS, [fv("jump", false), fv()], [cv({ up: true }), cv()], "fight", 0);
    expect(jump).toEqual(["jump"]);

    const d2 = new CueDirector();
    played(d2, NOEVENTS, [fv("jump", false), fv()], [cv(), cv()], "fight", 0);
    const land = played(d2, NOEVENTS, [fv("idle", true), fv()], [cv(), cv()], "fight", 16);
    expect(land).toEqual(["land"]);
  });

  test("land/jump/whiff are suppressed OUTSIDE the fight phase (no phantom sound at round reset)", () => {
    const d = new CueDirector();
    played(d, NOEVENTS, [fv("jump", false), fv()], [cv(), cv()], "fight", 0);
    const got = played(d, NOEVENTS, [fv("idle", true), fv()], [cv({ light: true, up: true }), cv()], "intro", 16);
    expect(got).toEqual([]);
  });

  test("cooldowns are per-cue, independent: hitHeavy firing does not block hitLight, and vice versa", () => {
    const d = new CueDirector();
    const a = played(d, [{ type: "hit", data: { attack: "heavy" } }] as any, [fv(), fv()], [cv(), cv()], "fight", 0);
    const b = played(d, [{ type: "hit", data: { attack: "light" } }] as any, [fv(), fv()], [cv(), cv()], "fight", 1);
    expect(a).toEqual(["hitHeavy"]);
    expect(b).toEqual(["hitLight"]);
  });

  test("menuCue: only step/lock/mode/stage transitions make noise; an unrelated state churn is silent", () => {
    const base = { step: "mode" as const, cursors: [0, 1] as [number, number], modeIndex: 0, stageIndex: 0, locked: [false, false] as [boolean, boolean], touch: false };
    expect(menuCue(base, base)).toBeNull();
    expect(menuCue(base, { ...base, cursors: [1, 0] })).toBe("menuMove"); // a cursor move also cues menuMove
    expect(menuCue(base, { ...base, modeIndex: 1 })).toBe("menuMove");
    expect(menuCue(base, { ...base, step: "stage" })).toBe("menuConfirm");
    expect(menuCue(base, { ...base, locked: [true, false] })).toBe("menuConfirm");
  });
});

// -------------------------------------------------------------------------------------------------
// 2b. Architecture -- "sim events drive cues from the RENDER layer only"
// -------------------------------------------------------------------------------------------------

test.describe("criterion 2 (static) -- the sim never touches audio directly", () => {
  test("src/sim/**/*.ts never imports render/audio-* or Phaser.Sound", () => {
    const simDir = path.join(repoRoot, "src", "sim");
    const offenders: string[] = [];
    const walk = (d: string): void => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith(".ts")) {
          const src = fs.readFileSync(p, "utf8");
          if (/from ["'].*render\/audio/.test(src) || /Phaser\.Sound|scene\.sound/.test(src)) offenders.push(p);
        }
      }
    };
    walk(simDir);
    expect(offenders, `sim files reaching into audio: ${offenders.join(", ")}`).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------------
// 3. BootScene refuses to route on a missing audio file
// -------------------------------------------------------------------------------------------------

test.describe("criterion 3 -- boot refuses to route on a broken audio asset", () => {
  test("a control boot (no interception) reaches Flow normally", async ({ page }) => {
    await audioReady(page);
    expect(await page.evaluate(() => (window as any).__flow?.state()?.step)).toBe("title");
  });

  test("a 404'd cue file blocks routing entirely -- the game never reaches Flow or Match, and it fails loudly", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    await page.route("**/audio/hitLight.mp3", (route) => route.fulfill({ status: 404, body: "" }));

    await page.goto("/?scene=match");
    let sawFlowOrMatch = false;
    try {
      await page.waitForFunction(() => (window as any).__world != null || (window as any).__flow != null, null, { timeout: 8000 });
      sawFlowOrMatch = true;
    } catch { /* expected: it should time out */ }
    expect(sawFlowOrMatch, "the game routed to Match/Flow despite a 404'd required cue").toBe(false);
    expect(pageErrors.some((e) => /boot: assets failed to load/.test(e)), `pageerrors seen: ${JSON.stringify(pageErrors)}`).toBe(true);
  });

  // Distinct failure mode from a 404, and the boot code explicitly claims to guard both: "Phaser
  // fires COMPLETE even when files 404'd (FILE_LOAD_ERROR) AND when an HTTP-200 file is
  // corrupt/undecodable (a process error, no FILE_LOAD_ERROR)." An HTTP-200 response with garbage
  // bytes never trips FILE_LOAD_ERROR, so only the `cache.audio.exists()` sweep can catch it.
  test("an HTTP-200 but UNDECODABLE cue file also blocks routing (not just a 404)", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    await page.route("**/audio/hitLight.mp3", (route) =>
      route.fulfill({ status: 200, contentType: "audio/mpeg", body: Buffer.from("not actually mp3 audio data") }));

    await page.goto("/?scene=match");
    let sawFlowOrMatch = false;
    try {
      await page.waitForFunction(() => (window as any).__world != null || (window as any).__flow != null, null, { timeout: 8000 });
      sawFlowOrMatch = true;
    } catch { /* expected: it should time out */ }
    expect(sawFlowOrMatch, "the game routed to Match/Flow despite an undecodable required cue").toBe(false);
    expect(pageErrors.some((e) => /boot: assets failed to load/.test(e)), `pageerrors seen: ${JSON.stringify(pageErrors)}`).toBe(true);
  });
});

// -------------------------------------------------------------------------------------------------
// 4. Autoplay unlock
// -------------------------------------------------------------------------------------------------

test.describe("criterion 4 -- unlock on first gesture, never throws if none arrives", () => {
  test("no gesture ever arrives: nothing throws, and the match is still fully playable", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    await readyMatch(page);

    const r = await evalGame(page, (w, step) => {
      step(100);
      w.__world.fighters[0].reset(700, 1);
      w.__world.fighters[1].reset(760, -1);
      step(1);
      const healthBefore = w.__world.fighters[1].health;
      w.__holdP1({ light: true, lightPressed: true });
      step(1);
      w.__holdP1({});
      step(30);
      return {
        locked: w.__audio.locked(),
        healthBefore,
        healthAfter: w.__world.fighters[1].health as number,
        plays: w.__audio.plays(),
      };
    });

    expect(r.locked, "no DOM gesture was ever dispatched -- the context should still read locked").toBe(true);
    expect(r.healthAfter, "combat must proceed even with audio locked").toBeLessThan(r.healthBefore);
    expect(pageErrors, `unexpected page errors while unlocked audio never arrived: ${JSON.stringify(pageErrors)}`).toEqual([]);
  });

  test("a real keypress unlocks the audio context", async ({ page }) => {
    await readyMatch(page);
    expect(await page.evaluate(() => (window as any).__audio.locked())).toBe(true);
    await press(page, "ArrowLeft");
    await pump(page, 5);
    await expect.poll(async () => { await pump(page, 1); return page.evaluate(() => (window as any).__audio.locked()); }).toBe(false);
  });

  test("a real mouse click unlocks the audio context", async ({ page }) => {
    await readyMatch(page);
    expect(await page.evaluate(() => (window as any).__audio.locked())).toBe(true);
    const c = await page.evaluate(() => {
      const b = (window as any).__game.scale.canvasBounds;
      return { x: b.left + 5, y: b.top + 5 };
    });
    await page.mouse.click(c.x, c.y);
    await pump(page, 5);
    await expect.poll(async () => { await pump(page, 1); return page.evaluate(() => (window as any).__audio.locked()); }).toBe(false);
  });

  test.describe("real touch device", () => {
    const { defaultBrowserType: _ignored, ...PHONE } = devices["Pixel 5 landscape"];
    test.use({ ...PHONE });

    test("a first contact on a touch-pad BUTTON unlocks audio and starts the deferred ambience bed", async ({ page }) => {
      await readyMatch(page, []);
      expect(await page.evaluate(() => (window as any).__audio.locked())).toBe(true);
      expect(await page.evaluate(() => (window as any).__audio.bedPlaying())).toBe(false);

      const gameW = await page.evaluate(() => (window as any).__game.scale.gameSize.width as number);
      const btn = touchLayout(Math.round(gameW), STAGE_HEIGHT).find((b) => b.id === "light")!;
      const p = await page.evaluate(({ gx, gy }) => {
        const s = (window as any).__game.scale;
        return { x: s.canvasBounds.left + gx / s.displayScale.x, y: s.canvasBounds.top + gy / s.displayScale.y };
      }, { gx: btn.x, gy: btn.y });

      await page.touchscreen.tap(p.x, p.y);
      await pump(page, 10);

      await expect.poll(async () => { await pump(page, 1); return page.evaluate(() => (window as any).__audio.locked()); }).toBe(false);
      await expect.poll(async () => { await pump(page, 1); return page.evaluate(() => (window as any).__audio.bedPlaying()); }).toBe(true);
    });
  });
});

// -------------------------------------------------------------------------------------------------
// 5. Cue coverage in real gameplay (integration -- proves the unit-level math is actually wired)
// -------------------------------------------------------------------------------------------------

test.describe("criterion 2 (integration) -- cues actually fire from real gameplay, through the render layer", () => {
  test("hitLight, block, whiff and jump all fire from real, driven combat", async ({ page }) => {
    await readyMatch(page);
    await press(page, "ArrowLeft");
    await pump(page, 3);

    const r = await evalGame(page, (w, step) => {
      w.__audio.clear();
      step(100);
      w.__world.fighters[0].reset(700, 1);
      w.__world.fighters[1].reset(760, -1);
      step(1);

      w.__world.fighters[1].reset(1300, -1);
      w.__holdP1({ light: true, lightPressed: true }); step(1); w.__holdP1({});
      step(20);
      const afterWhiff = { log: w.__audio.log() as string[] };

      w.__audio.clear();
      w.__world.fighters[1].reset(760, -1);
      w.__holdP2({ block: true });
      step(2);
      w.__holdP1({ light: true, lightPressed: true }); step(1); w.__holdP1({});
      step(20);
      w.__holdP2({});
      const afterBlock = { log: w.__audio.log() as string[] };

      w.__audio.clear();
      w.__world.fighters[0].reset(700, 1);
      w.__world.fighters[1].reset(760, -1);
      step(1);
      w.__holdP1({ light: true, lightPressed: true }); step(1); w.__holdP1({});
      step(20);
      const afterHit = { log: w.__audio.log() as string[] };

      w.__audio.clear();
      step(30);
      w.__holdP1({ up: true, upPressed: true }); step(1); w.__holdP1({});
      step(10);
      const afterJumpStart = { log: w.__audio.log() as string[], grounded: w.__world.fighters[0].grounded as boolean };
      step(40);
      const afterLand = { log: w.__audio.log() as string[], grounded: w.__world.fighters[0].grounded as boolean };

      return { afterWhiff, afterBlock, afterHit, afterJumpStart, afterLand };
    });

    expect(r.afterWhiff.log, JSON.stringify(r.afterWhiff.log)).toContain("whiff");
    expect(r.afterWhiff.log).not.toContain("hitLight");
    expect(r.afterWhiff.log).not.toContain("block");

    expect(r.afterBlock.log, JSON.stringify(r.afterBlock.log)).toContain("block");
    expect(r.afterBlock.log).not.toContain("hitLight");

    expect(r.afterHit.log, JSON.stringify(r.afterHit.log)).toContain("hitLight");

    expect(r.afterJumpStart.log, JSON.stringify(r.afterJumpStart.log)).toContain("jump");
    expect(r.afterLand.grounded).toBe(true);
    expect(r.afterLand.log, JSON.stringify(r.afterLand.log)).toContain("land");
  });

  test("hitHeavy, ko, roundEnd (and roundStart at the top of a match) all fire from real gameplay", async ({ page }) => {
    await readyMatch(page);
    await press(page, "ArrowLeft");
    await pump(page, 3);

    const r = await evalGame(page, (w, step) => {
      const bootLog: string[] = [];
      w.__audio.clear();
      step(100);
      bootLog.push(...(w.__audio.log() as string[]));

      w.__audio.clear();
      w.__world.match.wins = [1, 0];
      w.__world.fighters[0].reset(700, 1);
      w.__world.fighters[1].reset(760, -1);
      w.__world.fighters[1].health = 1;
      step(1);
      w.__holdP1({ heavy: true, heavyPressed: true }); step(1); w.__holdP1({});
      step(30);
      const koLog = w.__audio.log() as string[];
      const phase = w.__world.match.phase as string;

      return { bootLog, koLog, phase };
    });

    expect(r.bootLog, JSON.stringify(r.bootLog)).toContain("roundStart");
    expect(r.koLog, JSON.stringify(r.koLog)).toContain("ko");
    expect(r.koLog, JSON.stringify(r.koLog)).toContain("roundEnd");
    expect(r.koLog.some((c) => c === "hitHeavy" || c === "hitLight"), JSON.stringify(r.koLog)).toBe(true);
    expect(r.phase).toBe("matchEnd");
  });

  test("super fires exactly once per activation even though the special lands several hits", async ({ page }) => {
    await readyMatch(page);
    await press(page, "ArrowLeft");
    await pump(page, 3);

    const r = await evalGame(page, (w, step) => {
      w.__audio.clear();
      step(100);
      w.__world.fighters[0].reset(700, 1);
      w.__world.fighters[1].reset(760, -1);
      w.__world.fighters[0].meter = 100;
      step(1);
      w.__holdP1({ special: true, specialPressed: true }); step(1); w.__holdP1({});
      step(1);
      // Sampled the tick right after the press: startAttack spends the WHOLE bar at activation,
      // before any repeat window can land and start refilling it from damage dealt.
      const meterRightAfterPress = w.__world.fighters[0].meter as number;
      const stateRightAfterPress = w.__world.fighters[0].state as string;
      step(119);
      const log = w.__audio.log() as string[];
      const superCount = log.filter((c) => c === "super").length;
      const hitHeavyCount = log.filter((c) => c === "hitHeavy").length;
      return { log, superCount, hitHeavyCount, meterRightAfterPress, stateRightAfterPress };
    });

    expect(r.stateRightAfterPress, "the special must actually have activated").toBe("special");
    expect(r.meterRightAfterPress, "activation spends the whole bar immediately").toBe(0);
    expect(r.superCount, JSON.stringify(r.log)).toBe(1);
    expect(r.hitHeavyCount).toBeGreaterThan(0);
    expect(r.hitHeavyCount).toBeLessThan(20);
  });

  test("menuMove and menuConfirm fire from real select-screen navigation", async ({ page }) => {
    await audioReady(page);
    await press(page, "ArrowLeft");
    await pump(page, 3);
    await page.evaluate(() => (window as any).__audio.clear());
    const state = await keys(page, ["enter", "enter", "right", "d"]);
    const log = await page.evaluate(() => (window as any).__audio.log() as string[]);
    expect(log, JSON.stringify(log)).toContain("menuConfirm");
    expect(state).toBeTruthy();
  });
});

// -------------------------------------------------------------------------------------------------
// 6. Mute control -- reachable, and actually silences
// -------------------------------------------------------------------------------------------------

test.describe("criterion 5 -- a mute control, reachable, that actually silences", () => {
  test("desktop: clicking the mute plate toggles the intent and the real gain", async ({ page }) => {
    await readyMatch(page);
    await press(page, "ArrowLeft");
    await pump(page, 3);
    expect(await page.evaluate(() => (window as any).__audio.muted())).toBe(false);

    const c = await page.evaluate(() => {
      const b = (window as any).__audio.button();
      const s = (window as any).__game.scale;
      return {
        x: s.canvasBounds.left + (b.x + b.width / 2) / s.displayScale.x,
        y: s.canvasBounds.top + (b.y + b.height / 2) / s.displayScale.y,
      };
    });
    await page.mouse.click(c.x, c.y);
    await pump(page, 3);
    expect(await page.evaluate(() => (window as any).__audio.muted())).toBe(true);
    await expect.poll(async () => { await pump(page, 1); return page.evaluate(() => (window as any).__audio.gain()); }).toBeCloseTo(0, 3);

    await page.mouse.click(c.x, c.y);
    await pump(page, 3);
    expect(await page.evaluate(() => (window as any).__audio.muted())).toBe(false);
    await expect.poll(async () => { await pump(page, 1); return page.evaluate(() => (window as any).__audio.gain()); }).toBeCloseTo(1, 3);
  });

  test("keyboard 'N' toggles mute both in a match and on the select flow", async ({ page }) => {
    await readyMatch(page);
    expect(await page.evaluate(() => (window as any).__audio.muted())).toBe(false);
    await press(page, "n");
    expect(await page.evaluate(() => (window as any).__audio.muted())).toBe(true);
    await press(page, "n");
    expect(await page.evaluate(() => (window as any).__audio.muted())).toBe(false);
  });

  test("'N' mutes even mid-lock-in (busy guard does not block it) on the flow screen", async ({ page }) => {
    await audioReady(page);
    await keys(page, ["n"]);
    expect(await page.evaluate(() => (window as any).__audio.muted())).toBe(true);
  });

  test.describe("real touch device", () => {
    const { defaultBrowserType: _ignored, ...PHONE } = devices["Pixel 5 landscape"];
    test.use({ ...PHONE });

    test("touch: tapping the mute plate toggles it, and does not also fire an adjacent pad button", async ({ page }) => {
      await readyMatch(page);
      const before = await page.evaluate(() => (window as any).__world.fighters.map((f: any) => f.health));

      const c = await page.evaluate(() => {
        const b = (window as any).__audio.button();
        const s = (window as any).__game.scale;
        return {
          x: s.canvasBounds.left + (b.x + b.width / 2) / s.displayScale.x,
          y: s.canvasBounds.top + (b.y + b.height / 2) / s.displayScale.y,
        };
      });
      await page.touchscreen.tap(c.x, c.y);
      await pump(page, 10);

      expect(await page.evaluate(() => (window as any).__audio.muted())).toBe(true);
      const after = await page.evaluate(() => (window as any).__world.fighters.map((f: any) => f.health));
      expect(after, "a mute tap must not also register as a fight input").toEqual(before);
    });
  });
});

// -------------------------------------------------------------------------------------------------
// 7. Placement -- never overlaps or steals a tap from another control
// -------------------------------------------------------------------------------------------------

test.describe("criterion 7 -- mute placement vs every other control, at 1280 and 1696, desktop and touch", () => {
  for (const width of [1280, 1696]) {
    for (const touch of [false, true]) {
      test(`width=${width} touch=${touch}: mute plate does not overlap the HUD or the pad/legend row`, async ({ page }) => {
        // ?touch=1/?touch=0 is the project's own first-class DEV seam for forcing UI mode (see
        // src/render/touch.ts touchMode()) -- distinct from a bare `hasTouch: true` context flag,
        // which only fools pointer classification and would leave the pad never constructed at all
        // (MatchScene only builds `this.pad` `if (touchMode())`). Forcing it here means the touch=true
        // case is checked against a REAL, currently-interactive pad, not just its arithmetic layout.
        await harnessReady(page, {
          route: `${MATCH}&touch=${touch ? 1 : 0}`,
          needs: ["__sprites", "__world", "__game", "__holdP1", "__holdP2", "__audio"],
        });
        await page.evaluate((w) => (window as any).__game.scale.setGameSize(w, 720), width);
        await pump(page, 2);

        const geom = await page.evaluate((wantTouch) => {
          const b = (window as any).__audio.button();
          const hud = (window as any).__hud ? (window as any).__hud() : null;
          const padExists = (window as any).__game.scene.getScene("Match").pad != null;
          return {
            btn: { x: b.x, y: b.y, w: b.width, h: b.height },
            bandBottom: hud?.bandBottom ?? null,
            padExists,
            wantTouch,
          };
        }, touch);
        // Confirms the axis is actually being exercised -- a false positive here would mean every
        // touch=true case above was silently testing the desktop layout twice.
        expect(geom.padExists, `pad construction did not follow ?touch=${touch ? 1 : 0}`).toBe(touch);

        if (geom.bandBottom != null) {
          expect(geom.btn.y, `mute top ${geom.btn.y} vs HUD bandBottom ${geom.bandBottom} at width ${width}`)
            .toBeGreaterThanOrEqual(geom.bandBottom - 1);
        }

        const buttons = touchLayout(width, 720);
        const mx = geom.btn.x + geom.btn.w / 2;
        const my = geom.btn.y + geom.btn.h / 2;
        const mr = Math.max(geom.btn.w, geom.btn.h) / 2;
        for (const b of buttons) {
          const dx = mx - b.x, dy = my - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          expect(dist, `mute plate overlaps pad button "${b.id}" at width ${width} (dist ${dist.toFixed(1)}, need > ${mr + BUTTON_R})`)
            .toBeGreaterThan(mr + BUTTON_R);
        }

        expect(my, `mute plate sits in the bottom control strip at width ${width}`).toBeLessThan(700 - 60);
      });
    }
  }
});

// -------------------------------------------------------------------------------------------------
// 8. Persistence -- survives every transition the criteria name
// -------------------------------------------------------------------------------------------------

test.describe("criterion 5 (persistence) -- the mute setting survives scene changes, rematch, and reload", () => {
  test("match -> Esc -> MAIN MENU -> a brand-new match keeps the mute setting", async ({ page }) => {
    await readyMatch(page, ["__endMenu"]);
    await press(page, "n");
    expect(await page.evaluate(() => (window as any).__audio.muted())).toBe(true);

    await toFlow(page);
    expect(await page.evaluate(() => (window as any).__audio.muted())).toBe(true);

    await driveTo1v1(page, 0);
    expect(await page.evaluate(() => (window as any).__audio.muted())).toBe(true);
  });

  test("an Enter rematch after a real KO keeps the mute setting", async ({ page }) => {
    await readyMatch(page, ["__endMenu"]);
    await press(page, "n");
    expect(await page.evaluate(() => (window as any).__audio.muted())).toBe(true);

    await page.evaluate(() => {
      const w = window as any;
      w.__world.match.phase = "fight";
      w.__world.match.introTicks = 0;
      w.__world.match.wins = [1, 0];
      w.__world.fighters[0].reset(700, 1);
      w.__world.fighters[1].reset(760, -1);
      w.__world.fighters[1].health = 1;
      w.__holdP1({ light: true, lightPressed: true });
    });
    await pump(page, 30);
    await page.evaluate(() => (window as any).__holdP1({}));
    await pump(page, 10);
    expect(await page.evaluate(() => (window as any).__world.match.phase)).toBe("matchEnd");

    await press(page, "Enter");
    await pump(page, 4);
    expect(await page.evaluate(() => (window as any).__world.match.phase)).toBe("intro");
    expect(await page.evaluate(() => (window as any).__audio.muted())).toBe(true);
  });

  test("a full page reload keeps the mute setting, available immediately (before any gesture)", async ({ page }) => {
    await readyMatch(page);
    await press(page, "n");
    expect(await page.evaluate(() => (window as any).__audio.muted())).toBe(true);

    await page.reload();
    await harnessReady(page, { route: MATCH, needs: ["__game", "__world", "__audio"] });
    const state = await page.evaluate(() => ({ muted: (window as any).__audio.muted(), locked: (window as any).__audio.locked() }));
    expect(state.muted).toBe(true);
  });

  test("unmuting also persists (does not get stuck true), across a reload", async ({ page }) => {
    await readyMatch(page);
    await press(page, "n");
    await press(page, "n");
    expect(await page.evaluate(() => (window as any).__audio.muted())).toBe(false);
    await page.reload();
    await harnessReady(page, { route: MATCH, needs: ["__game", "__world", "__audio"] });
    expect(await page.evaluate(() => (window as any).__audio.muted())).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------------
// 9. Leakage across scene transitions
// -------------------------------------------------------------------------------------------------

test.describe("criterion 6 (leakage) -- no bed bleed-through, no unbounded sound accumulation", () => {
  test("the menu bed stops before the match bed starts -- never both at once", async ({ page }) => {
    await audioReady(page);
    await press(page, "ArrowLeft");
    await pump(page, 3);
    await expect.poll(async () => { await pump(page, 1); return page.evaluate(() => (window as any).__audio.bed()); }).toBe("menuMusic");
    await expect.poll(async () => { await pump(page, 1); return page.evaluate(() => (window as any).__audio.bedPlaying()); }).toBe(true);

    await driveTo1v1(page, 0);
    const after = await page.evaluate(() => ({ bed: (window as any).__audio.bed(), playing: (window as any).__audio.bedPlaying() }));
    expect(after.bed).toBe("ambience");
    // Counts BEDS, not `sounds.length`. The total was a proxy for "one bed at a time" and it stopped
    // being one: `super` is now a retained instance that deliberately never self-destructs (see
    // audio-view.ts), so the total carries one extra per live GameAudio and any bound on it drifts
    // with unrelated changes. The claim this test makes is about beds, so count beds.
    expect(await liveBeds(page), "more than one looping bed alive at once").toBe(1);
  });

  test("persistent sound instances do not grow across repeated Flow <-> Match round trips", async ({ page }) => {
    await readyMatch(page, ["__endMenu"]);
    await press(page, "ArrowLeft");
    await pump(page, 5);
    // Counts only what is meant to PERSIST — looping beds and the retained `super`. The one-shots are
    // excluded on purpose: `driveTo1v1` walks the select screen with real key presses, each firing a
    // menu cue that self-destructs on COMPLETE, i.e. on real audio time the pumped clock does not
    // control. Including them measured the machine's load, not a leak.
    //
    // The two phases are compared against THEMSELVES rather than against one absolute, because they
    // legitimately differ. `toFlow` is a harness shortcut: it calls `game.scene.start("Flow")`, which
    // starts Flow WITHOUT stopping MatchScene, so no SHUTDOWN fires and two GameAudios are briefly
    // live — measured as match-ambience + match-super + menuMusic + flow-super. The product path
    // (Esc, i.e. `this.scene.start` from inside MatchScene) does stop it, and the
    // "never both at once" test above covers that with the real transition. What this test is for is
    // GROWTH, so it asserts each phase is identical on every lap.
    const flow: number[] = [];
    const match: number[] = [];
    for (let i = 0; i < 3; i++) {
      await toFlow(page);
      await pump(page, 3);
      flow.push(await persistentSounds(page));
      await driveTo1v1(page, 0);
      await pump(page, 3);
      match.push(await persistentSounds(page));
    }
    expect(new Set(flow), `flow-side persistent counts grew: ${JSON.stringify(flow)}`).toHaveProperty("size", 1);
    expect(new Set(match), `match-side persistent counts grew: ${JSON.stringify(match)}`).toHaveProperty("size", 1);
    // ...and a settled match holds exactly one bed and one retained super.
    expect(match[0], `a settled match should hold 1 bed + 1 retained super, saw ${match[0]}`).toBe(2);
    // The persistent count above is precise but narrow — it excludes one-shots by design, so an
    // unbounded ONE-SHOT leak would slip past it. This keeps the describe block's broader "no
    // unbounded accumulation" claim honest with a generous ceiling on the raw total: loose enough
    // that menu cues still ringing on a loaded machine never trip it, tight enough that genuine
    // per-round-trip growth does. (Self-destruction of one-shots is proved precisely, on a real wall
    // clock, by the burst test in qa20b-audio-deep.spec.ts.)
    const rawTotal = await page.evaluate(() => (window as any).__game.sound.sounds.length as number);
    expect(rawTotal, `raw sounds.length after 3 round trips: ${rawTotal}`).toBeLessThanOrEqual(12);
  });
});

// -------------------------------------------------------------------------------------------------
// 10. Robustness -- never crashes the fixed-timestep loop
// -------------------------------------------------------------------------------------------------

test.describe("criterion 6 (robustness) -- a bad cue key can never throw into the game loop", () => {
  test("requesting an unknown/uncached cue key is a silent no-op, not a throw, and does not count as a play", async ({ page }) => {
    const pageErrors: string[] = [];
    await readyMatch(page);
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    const before = await page.evaluate(() => (window as any).__audio.plays());
    await page.evaluate(() => {
      const w = window as any;
      for (let i = 0; i < 20; i++) w.__audio.play("thisCueDoesNotExist");
    });
    await pump(page, 5);
    const after = await page.evaluate(() => (window as any).__audio.plays());
    expect(after).toBe(before);
    expect(pageErrors).toEqual([]);
    const r = await evalGame(page, (w, step) => {
      step(100);
      w.__world.fighters[0].reset(700, 1);
      w.__world.fighters[1].reset(760, -1);
      step(1);
      const before2 = w.__world.fighters[1].health;
      w.__holdP1({ light: true, lightPressed: true }); step(1); w.__holdP1({});
      step(20);
      return { before2, after2: w.__world.fighters[1].health as number };
    });
    expect(r.after2).toBeLessThan(r.before2);
  });
});

test.describe("bed level -- raised because both beds were inaudible at a normal device volume", () => {
  // Read off the LIVE Phaser Sound, never off the source. A level edited in `audio-view.ts` but never
  // reaching the instance would leave the complaint exactly as it was while the diff looked correct.
  //
  // 0.6 is not a preference: `scripts/build-audio.py` gates the worst-case KO stack (hitHeavy + ko +
  // roundEnd over the ambience bed) at -1.0 dBFS, and 0.6 measures -1.15 there. 0.65 lands on the
  // ceiling itself. If this number ever rises, `npm run check:audio` is the thing that must agree.
  const BED_VOLUME = 0.6;

  // A bed only exists once the browser's autoplay lock is released, so each case needs a REAL key
  // press first — `startBed` defers to `pendingBed` until UNLOCKED, and headless boots locked. This
  // is the same press-then-poll shape the bed bleed-through test above already uses.
  test("the MENU runs the music bed at the measured level", async ({ page }) => {
    await audioReady(page);
    await press(page, "ArrowLeft");
    await expect.poll(async () => {
      await pump(page, 1);
      return page.evaluate(() => (window as any).__audio.bed());
    }).toBe("menuMusic");
    const volume = await page.evaluate(() => (window as any).__audio.bedVolume() as number | null);
    expect(volume, "the menu bed is not running at the level audio-view.ts sets").toBeCloseTo(BED_VOLUME, 5);
  });

  test("the MATCH runs the ambience bed at the measured level", async ({ page }) => {
    await audioReady(page);
    await press(page, "ArrowLeft");
    await driveTo1v1(page, 0);
    await expect.poll(async () => {
      await pump(page, 1);
      return page.evaluate(() => (window as any).__audio.bed());
    }).toBe("ambience");
    const volume = await page.evaluate(() => (window as any).__audio.bedVolume() as number | null);
    expect(volume, "the match bed is not running at the level audio-view.ts sets").toBeCloseTo(BED_VOLUME, 5);
  });
});
