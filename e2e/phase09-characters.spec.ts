import { test, expect, type Page } from "@playwright/test";
import { MATCH, pump, ready as harnessReady } from "./harness";
// anim-timing is deliberately Phaser-free, so the spec can import the real rule instead of
// re-deriving it by hand — a hand-copied formula in a test only ever pins the copy.
import { attackStartFrame, stunStartFrame } from "../src/render/anim-timing";

/** Boot straight into a match. The globals below are what THIS spec drives; waiting on
 *  the wrong set is how a spec ends up poking a half-built scene. */
const ready = (page: Page): Promise<void> =>
  harnessReady(page, { route: MATCH, needs: ["__sprites", "__world", "__game"] });

// Phase 09 acceptance: BOTH fighters render as per-state sprites driven by sim state (idle → walk →
// attack), stay feet-anchored/mirrored/depth-ordered, an attack switches the opponent to hitstun,
// and hitstop freezes visual playback. Reads the DEV hooks (__world, __sprites, __game).
// The sim only advances inside Phaser's step, which headless Chromium throttles via RAF, so the spec
// pumps game.step() itself — deterministic, no wall-clock waits.

/* eslint-disable @typescript-eslint/no-explicit-any */
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

// Phase 12: the measured contact frame must actually reach Phaser. anim-timing.test.ts proves the
// arithmetic, but it would stay green if FighterSprite stopped applying the durations — this asserts
// the wiring, on the real AnimationManager, after a real boot.
test("attack animations carry per-frame durations that put the strike on the active window", async ({ page }) => {
  await ready(page);

  const checked = await page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const w = window as any;
    const reg = w.__game.cache.json.get("characters");
    const out: {
      key: string; id: string; state: string; durations: number[]; hit: number;
      startupMs: number; moveMs: number;
    }[] = [];
    const STATE_TO_KEY: Record<string, string> = {
      attackLight: "light", attackHeavy: "heavy", airLight: "airLight",
      airHeavy: "airHeavy", crouchLight: "crouchLight", crouchHeavy: "crouchHeavy",
    };
    for (const id of ["brawler", "jiujitsu"]) { // the two fighters this match built
      for (const [state, key] of Object.entries(STATE_TO_KEY)) {
        const sheet = reg[id].render.sheets[state];
        if (sheet.hit === undefined) continue; // no measurement -> uniform timing, nothing to assert
        const anim = w.__game.anims.get(`${id}-${state}`);
        const d = anim.frames.map((f: any) => f.duration);
        const a = reg[id].data.attacks[key];
        out.push({
          key: `${id}.${state}`,
          id, state,
          durations: d as number[],
          hit: sheet.hit as number,
          startupMs: ((a.startup - 1) * 1000) / 60 - 1, // -1 tick = play() lag, -1ms = boundary bias
          moveMs: ((a.startup + a.active + a.recovery) * 1000) / 60,
        });
      }
    }
    return out;
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });

  expect(checked.length, "expected measured contact frames in the shipped registry").toBeGreaterThan(0);
  const registry = await page.evaluate(() => (window as any).__game.cache.json.get("characters"));
  const sum = (xs: number[]) => xs.reduce((t, x) => t + x, 0);
  for (const c of checked) {
    // Playback starts at `attackStartFrame` when the wind-up budget cannot afford every drawn pose,
    // so the frames before it are inert padding — measure the DRAWN span, which is what is on screen.
    const meta = registry[c.id].render.sheets[c.state];
    const s = attackStartFrame(c.state as never, meta, registry[c.id].data);
    // the frame the sprite strikes on begins exactly when the hit box does...
    expect(sum(c.durations.slice(s, c.hit)), `${c.key} wind-up`).toBeCloseTo(c.startupMs, 6);
    // ...and re-timing did not change how long the move takes
    expect(sum(c.durations.slice(s)), `${c.key} total`).toBeCloseTo(c.moveMs, 6);
  }
});

// The acceptance criterion itself, measured on the running game rather than on the numbers that
// feed it: on the sim tick the hit box first goes live, the sprite must be showing the frame the art
// actually strikes on. This is what caught the play() lag — the durations were arithmetically
// perfect and the contact frame still landed one tick late, because the animation clock starts at
// the END of the tick that entered the state.
test("the strike frame is on screen on the tick the hit box goes live", async ({ page }) => {
  test.slow();
  await ready(page);

  const results = await page.evaluate(async () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const w = window as any;
    const reg = w.__game.cache.json.get("characters");
    const step = () => { const g = w.__game; g.step((g.loop?.now ?? 0) + 1000 / 60, 1000 / 60); };
    const out: { key: string; shown: number; hit: number }[] = [];

    for (const [state, key, input] of [
      ["attackLight", "light", { light: true, lightPressed: true }],
      ["attackHeavy", "heavy", { heavy: true, heavyPressed: true }],
      ["crouchHeavy", "crouchHeavy", { down: true, downAtPress: true, heavy: true, heavyPressed: true }],
    ] as const) {
      const sheet = reg.brawler.render.sheets[state];
      if (sheet.hit === undefined) continue;
      const startup = reg.brawler.data.attacks[key].startup;
      w.__world.match.phase = "fight";
      w.__world.match.introTicks = 0;
      w.__world.fighters[0].reset(700, 1);
      w.__world.fighters[1].reset(900, -1); // out of range: measure the animation, not the hit
      w.__holdP1(input);
      let shown = -1;
      for (let i = 0; i < 60; i++) {
        step();
        const f = w.__world.fighters[0];
        if (f.state === state && f.stateFrame >= startup) {
          shown = (w.__sprites[0].anims.currentFrame?.index ?? 0) - 1; // Phaser's index is 1-based
          break;
        }
      }
      w.__holdP1({});
      for (let i = 0; i < 60; i++) step(); // return to idle before the next one
      out.push({ key: `brawler.${state}`, shown, hit: sheet.hit });
    }
    return out;
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });

  expect(results.length).toBeGreaterThan(0);
  for (const r of results) {
    expect(r.shown, `${r.key}: frame on screen at the first active tick`).toBe(r.hit);
  }
});

// ...and the same acceptance under a FRAME HITCH. `World.advance` runs a whole batch of fixed ticks
// before the scene renders (up to 15 at MAX_FRAME), but `play()` only happens at render — so on a
// long frame an attack can enter its state and run clean past its active window before its animation
// has started, drawing the wind-up while the hit box is already live. Every other pump in this suite
// is exactly one tick, so none of them can see it. This one steps 5 ticks at a time.
test("the strike frame is still correct when one render frame spans several sim ticks", async ({ page }) => {
  await ready(page);

  const r = await page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const w = window as any;
    const reg = w.__game.cache.json.get("characters");
    const sheet = reg.brawler.render.sheets.attackLight;
    const a = reg.brawler.data.attacks.light;
    const TICKS = 5; // one long frame ~= 83ms, well past this move's 4-tick startup
    const step = () => { const g = w.__game; g.step((g.loop?.now ?? 0) + (1000 / 60) * TICKS, (1000 / 60) * TICKS); };

    w.__world.match.phase = "fight";
    w.__world.match.introTicks = 0;
    w.__world.fighters[0].reset(700, 1);
    w.__world.fighters[1].reset(900, -1);
    w.__holdP1({ light: true, lightPressed: true });
    const seen: { stateFrame: number; shown: number }[] = [];
    for (let i = 0; i < 12; i++) {
      step();
      const f = w.__world.fighters[0];
      if (f.state === "attackLight") {
        seen.push({ stateFrame: f.stateFrame, shown: (w.__sprites[0].anims.currentFrame?.index ?? 0) - 1 });
      }
    }
    w.__holdP1({});
    return { seen, hit: sheet.hit, startup: a.startup, active: a.active };
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });

  expect(r.hit, "this test needs a measured contact frame").toBeGreaterThan(0);
  // Find the first observation at or after the hit box going live. Under a 5-tick frame we may not
  // land exactly on `startup`, so take the first sample inside or past the active window.
  const atContact = r.seen.find((s) => s.stateFrame >= r.startup);
  expect(atContact, "never observed the active window").toBeDefined();
  // The animation must have caught up: at least the contact frame, never still on the wind-up.
  expect(atContact!.shown, `stateFrame ${atContact!.stateFrame} showed a wind-up frame`).toBeGreaterThanOrEqual(r.hit);
});

// A stun's length is decided by the attack that caused it, so its playback rate is set on the play()
// call rather than baked into the registered animation. The arithmetic is unit-tested; what only a
// browser can prove is that the override actually reaches Phaser's animation clock. It nearly didn't
// matter and then did: every non-attack sheet shipped at a flat `fps: 8`, giving knockdown 750ms of
// art for a 300ms state, so playback was cut at frame 2 of 6 — and the fall is frames 3-5. The
// fighter stood bolt upright through his entire knockdown and popped back to idle.
test("a stun animation is retimed to the stun the sim actually gave it", async ({ page }) => {
  await ready(page);
  const r = await page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const w = window as any;
    const g = w.__game;
    let t = g.loop?.now ?? performance.now();
    const step = () => { t += 1000 / 60; g.step(t, 1000 / 60); };

    w.__world.match.phase = "fight";
    w.__world.match.introTicks = 0;
    const victim = w.__world.fighters[1];

    // Drive the victim into hitstun with a stun window the sim chose, then read the animation clock.
    // applyHit(damage, stun, kbx, kby, blocked) — 14 ticks is mid-range for the shipped roster.
    victim.applyHit(1, 14, 0, 0, false);
    const givenTicks = victim.stunTimer;
    step();
    const anims = w.__sprites[1].anims;
    return {
      state: victim.state,
      givenTicks,
      // What the sprite could actually see. In real play `applyHit` runs at tick step 7 and the
      // render pass reads it in the same tick, so this equals `givenTicks`; here the hit is injected
      // by hand BEFORE the step, so that step's `advanceTimers` (step 3b) burns one tick first.
      remainingTicks: victim.stunTimer as number,
      key: anims.currentAnim?.key as string,
      frames: anims.currentAnim?.frames.length as number,
      playRate: anims.frameRate as number,      // the AnimationState's rate — the override lands here
      registered: anims.currentAnim?.frameRate as number, // the animation's own registered rate
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });

  expect(r.state).toBe("hitstun");
  expect(r.givenTicks, "the sim must have set a real stun window").toBe(14);
  expect(r.remainingTicks, "one tick of the injected stun is spent by the pumped step").toBe(13);
  // The animation spans exactly the stun the sprite can still display, to within float noise —
  // measured over the DRAWN frames, since a window too short to show every pose at a readable rate
  // starts partway in (stunStartFrame). hitstun at 13 ticks affords all 4, so nothing is dropped here.
  const drawn = r.frames - stunStartFrame("hitstun", { frames: r.frames, fps: 8 }, r.remainingTicks);
  expect(drawn / r.playRate).toBeCloseTo(r.remainingTicks / 60, 4);
  // And it is NOT the authored rate — that is the defect this pins. 4 frames over 13 ticks is
  // ~18.5fps against the 8fps every non-attack sheet ships with.
  expect(r.registered).toBe(8);
  expect(r.playRate).toBeGreaterThan(r.registered * 2);
});

// ...and the same override must be re-applied when a COMBO re-hits a fighter who is already stunned.
// `applyHit` resets stateFrame and stunTimer, but the STATE NAME stays `hitstun`, so a render layer
// keying off the state alone never calls play() again: the hurt animation keeps the first hit's rate,
// keeps counting from wherever it had reached, and — since the sheet is a 4-frame one-shot — simply
// sits on its last frame for the rest of the combo. The sim was already correct; only the screen was
// wrong, which is why no sim test could see it. Fighter.stunEpoch is what makes the re-entry visible.
test("a combo's second hit restarts the hurt animation", async ({ page }) => {
  await ready(page);
  const r = await page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const w = window as any;
    const g = w.__game;
    let t = g.loop?.now ?? performance.now();
    const step = () => { t += 1000 / 60; g.step(t, 1000 / 60); };

    w.__world.match.phase = "fight";
    w.__world.match.introTicks = 0;
    const victim = w.__world.fighters[1];
    const anims = () => w.__sprites[1].anims;

    // First hit: a long window so the 4-frame sheet has time to run to its end before the re-hit.
    victim.applyHit(1, 24, 0, 0, false);
    step();
    const firstRate = anims().frameRate as number;
    for (let i = 0; i < 22; i++) step(); // let it play out to the last frame
    const beforeIndex = anims().currentFrame?.index as number;
    const beforeEpoch = victim.stunEpoch as number;

    // Second hit of the combo — same state, shorter window.
    victim.applyHit(1, 10, 0, 0, false);
    step();
    return {
      state: victim.state as string,
      stateUnchanged: victim.state === "hitstun",
      beforeIndex,
      afterIndex: anims().currentFrame?.index as number,
      beforeEpoch,
      afterEpoch: victim.stunEpoch as number,
      remainingTicks: victim.stunTimer as number,
      frames: anims().currentAnim?.frames.length as number,
      firstRate,
      afterRate: anims().frameRate as number,
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });

  // The premise: the sim really does re-enter WITHOUT a state change, so nothing else could catch it.
  expect(r.state).toBe("hitstun");
  expect(r.stateUnchanged).toBe(true);
  expect(r.afterEpoch, "the sim must mark the re-hit as a new episode").toBeGreaterThan(r.beforeEpoch);

  // The defect: the first hit had run the one-shot sheet to its final frame.
  expect(r.beforeIndex, "the sheet should have played out before the re-hit").toBe(r.frames);
  // The fix: the animation restarted from the top rather than staying parked on the last frame.
  expect(r.afterIndex, "the hurt animation did not restart on the second hit").toBeLessThan(r.beforeIndex);
  // ...and was re-timed to the NEW, shorter window — not left on the first hit's rate.
  const drawn2 = r.frames - stunStartFrame("hitstun", { frames: r.frames, fps: 8 }, r.remainingTicks);
  expect(drawn2 / r.afterRate).toBeCloseTo(r.remainingTicks / 60, 4);
  expect(r.afterRate).toBeGreaterThan(r.firstRate);
});
