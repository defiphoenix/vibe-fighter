// Records the README demo video (and the README screenshots) by playing the real game in a real
// browser. `npm run demo` -> docs/media/demo.mp4 + docs/media/demo.gif. `npm run demo -- --shots`
// -> docs/media/{title,select,fight,super}.png + public/og.png.
//
// HEADED AND REAL-TIME, deliberately — this is the one place the e2e pump is the WRONG tool:
//
//  1. `e2e/harness.ts` `pump()` runs its whole loop inside one page.evaluate, which blocks the
//     renderer main thread. Playwright's video is a CDP screencast driven by the COMPOSITOR on wall
//     clock, so 500 pumped sim frames collapse into ~2 duplicated video frames.
//  2. Phaser's TweenManager reads Date.now(). Under a pump the sim runs ~1000x wall clock while every
//     menu tween (title hint blink, card scale, lock-in flash) crawls. The demo's first half IS menus.
//
// The rAF-throttle problem that forces the pump on the e2e suite is a HEADLESS problem (the page
// reports hidden -> Phaser loop.pause()). A real window doesn't have it. Determinism buys nothing
// here; a re-run costs 90 seconds.
//
// Runs against the DEV server, not a build: every seam it drives (__flow, __world, __holdP1) is
// import.meta.env.DEV-gated and does not exist in dist/.

import { chromium } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, existsSync, statSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MEDIA = join(ROOT, "docs", "media");
const TMP = join(ROOT, "test-results", "demo"); // already gitignored
const PORT = 5173;
const URL = `http://localhost:${PORT}/`;

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const SHOTS = flag("shots");
const KEEP_SERVER = flag("keep-server");
// normal, not hard: measured, the hard CPU flattens this driver in ~13s and the video ends on
// "P2 WINS" with no super fired. Its 32-tick attack cooldown vs hard's 20 is the whole difference.
const DIFFICULTY = opt("difficulty", "normal");
const STAGE = opt("stage", "twilight");
const GIF_DUR = Number(opt("gif-dur", 14));
const NO_GIF = flag("no-gif");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[demo]", ...a);

// --- dev server -----------------------------------------------------------------------------

let child = null;

async function up() {
  try {
    const r = await fetch(URL, { signal: AbortSignal.timeout(800) });
    if (r.ok) return true;
  } catch { /* not listening */ }
  return false;
}

async function startServer() {
  if (await up()) { log("reusing the dev server already on :" + PORT); return false; }
  log("starting vite…");
  // node + vite's bin directly, NOT `npm run dev`: on Windows the npm shim is a cmd wrapper, and
  // killing it orphans the real vite process — a background server left running is exactly what we
  // must not do.
  child = spawn(process.execPath, [join(ROOT, "node_modules", "vite", "bin", "vite.js"), "--port", String(PORT), "--strictPort"],
    { cwd: ROOT, stdio: "ignore" });
  for (let i = 0; i < 120; i++) { if (await up()) { log("vite up"); return true; } await sleep(500); }
  throw new Error("vite did not come up on :" + PORT);
}

function stopServer() {
  if (child && !KEEP_SERVER) { try { child.kill(); } catch { /* already gone */ } child = null; }
}
process.on("exit", stopServer);
process.on("SIGINT", () => { stopServer(); process.exit(130); });

// --- browser --------------------------------------------------------------------------------

const LAUNCH_ARGS = [
  // THE flag on Windows: without it, any window that covers ours makes Chromium stop compositing —
  // the capture freezes on one frame AND the game's rAF stalls, so the recording silently dies.
  "--disable-features=CalculateNativeWinOcclusion",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-background-timer-throttling",
  // A 125%/150% desktop scale would deliver oversized screencast frames and Playwright pads/crops
  // them to grey bars.
  "--force-device-scale-factor=1",
  "--window-position=0,0",
];

// 1280x720 == VIEW_WIDTH x STAGE_HEIGHT (src/sim/constants.ts), so viewport.ts resolves to exactly
// that width and the frame is pure canvas — no letterbox, no page chrome.
const VIEWPORT = { width: 1280, height: 720 };

async function newPage(context) {
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("[page error]", e.message));
  return page;
}

// --- the menu run ---------------------------------------------------------------------------

// Every key name here is one FlowScene.press() dispatches on (src/scenes/FlowScene.ts). The seam is
// the same door real keys go through — update() calls press() too.
const press = (page, key) => page.evaluate((k) => window.__flow.press(k), key);

/** Hide DEV-only chrome so the capture shows what a player on the live site sees.
 *  Right now that is the title screen's "▶ PLAYGROUND (dev)" entry (FlowScene.build()); the match
 *  legend is handled separately because it is a shipped object with a DEV-only substring. */
const hideDevChrome = (page) => page.evaluate(() => {
  const walk = (list) => list.forEach((o) => {
    if (typeof o.text === "string" && o.text.includes("(dev)")) o.setVisible(false);
    if (o.list) walk(o.list); // containers: the menu lives inside one
  });
  window.__game.scene.getScenes(true).forEach((s) => walk(s.children.list));
});

/** Walk title -> mode -> stage -> chars -> locked, waiting on OBSERVABLE state at every transition.
 *  The sleeps are cosmetic dwells so the video has pacing; none of them is load-bearing. */
async function runMenus(page, { dwell = true } = {}) {
  const pause = (ms) => (dwell ? sleep(ms) : sleep(0));

  await page.goto(URL);
  await page.waitForFunction(() => window.__flow && window.__flow.state().step === "title", null, { timeout: 60_000 });
  await hideDevChrome(page);
  await pause(1600);

  // Pin the CPU's pick so the opponent is the same fighter every take. Without this the demo is
  // right about half the time — the same reason the e2e specs call it.
  await page.evaluate(() => window.__flow.seed(2));

  await press(page, "enter");
  await page.waitForFunction(() => window.__flow.state().step === "mode");
  await pause(600);

  // Walk the selection right so the choice is VISIBLE, rather than teleporting to it.
  const target = await page.evaluate((d) => {
    const label = d === "easy" ? "CPU · EASY" : d === "normal" ? "CPU · NORMAL" : "CPU · HARD";
    return window.__flow.modes().indexOf(label);
  }, DIFFICULTY);
  if (target < 0) throw new Error(`difficulty "${DIFFICULTY}" is not on the mode screen`);
  for (let i = 0; i < target; i++) {
    await press(page, "right");
    await page.waitForFunction((n) => window.__flow.state().modeIndex === n, i + 1);
    await pause(300);
  }
  await pause(500);
  await press(page, "enter");
  await page.waitForFunction(() => window.__flow.state().step === "stage");

  // Peek the other stage, then come back — shows there is more than one.
  const stages = await page.evaluate(() => window.__flow.stages());
  const want = Math.max(0, stages.indexOf(STAGE));
  await pause(600);
  await press(page, "right");
  await pause(700);
  await press(page, "left");
  await page.waitForFunction((n) => window.__flow.state().stageIndex === n, want);
  await pause(500);
  await press(page, "enter");
  await page.waitForFunction(() => window.__flow.state().step === "chars");

  // Browse the roster before settling. Cursors start [0,1]; d/a move P1 and swap on collision.
  for (const k of ["d", "d", "a", "a"]) { await press(page, k); await pause(450); }
  await page.waitForFunction(() => window.__flow.state().cursors[0] === 0);
  await pause(600);
}

/** Lock P1 in and wait out the flash -> CPU-think -> flash -> startMatch beat, then the intro freeze.
 *  There is no observable "the flash ended", so this waits on __world / match.phase, not a sleep. */
async function lockAndFight(page) {
  await press(page, "enter"); // in CPU mode Enter locks P1
  await page.waitForFunction(() => !window.__flow || window.__flow.state().locked[0] === true);
  await page.waitForFunction(() => !!window.__world, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__world.match.phase === "fight", null, { timeout: 30_000 });

  // Hide the control legend for the capture. It IS a shipped feature, but its DEV variant advertises
  // "B hitboxes · 1-4 kinds" — keys that do not exist in a production build — so leaving it in makes
  // the demo look like a dev build. The README carries a proper controls table instead.
  await page.evaluate(() => {
    const s = window.__game.scene.getScene("Match");
    if (s && s.legend) s.legend.setVisible(false);
  });
}

// --- the P1 driver --------------------------------------------------------------------------

/**
 * Install an in-page driver for P1 on game.events "prestep".
 *
 * prestep fires in the SAME frame as MatchScene.update()'s `raw[0] = {...raw[0], ...testHoldP1}`
 * merge, so a decision costs zero round trips and lands exactly once per step. Node-side polling is
 * wrong here: __holdP1 is STICKY, so one dropped clear leaves a key held forever.
 *
 * Every frame writes a FRESH object — a press flag left set re-fires its edge on every single frame.
 */
async function installDriver(page, { grantMeterAfter = 25 }) {
  await page.evaluate(async (grantAfter) => {
    const w = window;
    const marks = [];
    w.__demo = { marks, off: null };

    // Reach is DERIVED from the shipped boxes, never hand-copied: Phase 19's roster-wide trim moved
    // every one of those numbers and the copies went stale (see reachOf's comment in sim/cpu.ts).
    let reachOf = null;
    try { ({ reachOf } = await import("/src/sim/cpu.ts")); } catch { /* fall back below */ }

    const ACT = new Set(["idle", "walkF", "walkB", "crouch", "block", "blockCrouch"]);
    const ATT = new Set(["attackLight", "attackHeavy", "airLight", "airHeavy", "crouchLight", "crouchHeavy", "special"]);

    let i = 0, cool = 0, pokeN = 0, sawAttack = 0, spacingUntil = -1;
    let meterFullAt = -1, nudgedRound = -1;
    let superRange = 100, pokeRange = 100, heavyRange = 110; // conservative fallbacks

    const drive = () => {
      const world = w.__world, hold = w.__holdP1; // re-read: both are deleted on scene SHUTDOWN
      if (!world || !hold) return;
      const m = world.match;
      if (m.phase !== "fight") { hold({}); return; }

      const me = world.fighters[0], foe = world.fighters[1];
      if (reachOf && i === 0) {
        superRange = Math.min(reachOf(me, "special"), 100);
        heavyRange = reachOf(me, "attackHeavy");
        pokeRange = reachOf(me, "attackLight");
      }

      i++;
      if (cool > 0) cool--;

      // demo-only: guarantees the highlight. The super cut-in is the video's payoff, and meter earned
      // purely from damage doesn't reliably fill inside one round. Nothing else here touches sim state.
      if (nudgedRound !== m.round && m.timerTicks < 60 * 60 - grantAfter * 60 && me.meter < 100) {
        me.meter = 100;
        nudgedRound = m.round;
      }
      if (me.meter >= 100) { if (meterFullAt < 0) meterFullAt = i; } else meterFullAt = -1;

      const dist = Math.abs(foe.x - me.x);
      const fwd = me.facing > 0 ? "right" : "left";
      const back = me.facing > 0 ? "left" : "right";
      sawAttack = ATT.has(foe.state) ? sawAttack + 1 : 0;
      const foeStunned = foe.state === "hitstun" || foe.state === "blockstun";
      const next = {};

      if (sawAttack > 6 && dist < 200) {
        // 6, not 12: 12 lands after the last active frame of every normal in the roster, so the guard
        // never connects. 6 puts guard up on frame 7 — beats a 9-frame heavy startup, misses a
        // 4-frame light. Derived in e2e/cpu-difficulty.spec.ts; it SHOULD get hit sometimes.
        next.block = true;
        if (foe.state.startsWith("crouch")) next.down = true; // crouch normals are lows
      } else if (me.meter >= 100 && me.grounded && ACT.has(me.state) && dist <= superRange
                 && (foeStunned || i - meterFullAt > 240)) {
        // Prefer supering into stun — it's guaranteed to connect and reads as intentional. After 4s
        // of holding a full bar, fire anyway rather than never showing it.
        next.special = true;
        next.specialPressed = true;
        marks.push({ tag: "super", t: Date.now(), dist: Math.round(dist) });
      } else if (i < spacingUntil) {
        next[back] = true; // step out after a flurry — this is what separates a player from a masher
      } else if (dist > pokeRange) {
        next[fwd] = true;
      } else if (cool <= 0 && ACT.has(me.state)) {
        const pick = pokeN++ % 3;
        if (pick === 0 && dist <= heavyRange) { next.heavy = true; next.heavyPressed = true; }
        else if (pick === 1) { next.light = true; next.lightPressed = true; }
        else { next.down = true; next.light = true; next.lightPressed = true; }
        cool = 11 + (i % 9); // non-metronomic without needing an RNG
        if (pokeN % 6 === 0) spacingUntil = i + 18;
      }
      hold(next);
    };

    w.__game.events.on("prestep", drive); // game.events outlives scenes
    w.__demo.off = () => { w.__game.events.off("prestep", drive); if (w.__holdP1) w.__holdP1({}); };
  }, grantMeterAfter);
}

// --- ffmpeg ---------------------------------------------------------------------------------

function ff(args) {
  const r = spawnSync("ffmpeg", args, { stdio: ["ignore", "ignore", "inherit"] });
  if (r.status !== 0) throw new Error("ffmpeg failed: " + args.join(" "));
}

function probeDuration(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { encoding: "utf8" });
  return Number(r.stdout.trim()) || 0;
}

/** Seconds of black at the very start — the browser booting and loading 20 MB of art, which is inside
 *  the recording because the context starts capturing the moment the page exists. Measured rather than
 *  guessed at: it moves with disk cache and machine load. */
function blackLead(file) {
  const r = spawnSync("ffmpeg", ["-v", "info", "-i", file, "-vf", "blackdetect=d=0.2:pix_th=0.15", "-an", "-f", "null", "-"], { encoding: "utf8" });
  const m = /black_start:0(?:\.0+)?\s+black_end:([\d.]+)/.exec(r.stderr || "");
  return m ? Number(m[1]) : 0;
}

function probeSize(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { encoding: "utf8" });
  return r.stdout.trim();
}

const mb = (f) => (statSync(f).size / 1024 / 1024).toFixed(1);

function toGif(mp4, gif, { dur, fps, width, colors }) {
  const palette = join(TMP, "palette.png");
  // -sseof: take the tail, i.e. the KO — no need to mark it. stats_mode=diff / diff_mode=rectangle
  // exploit the mostly-static HUD and background; bayer over sierra because sierra roughly doubles
  // the size on photographic, camera-shaking art.
  ff(["-y", "-sseof", `-${dur}`, "-i", mp4,
    "-vf", `fps=${fps},scale=${width}:-2:flags=lanczos,palettegen=max_colors=${colors}:stats_mode=diff`, palette]);
  ff(["-y", "-sseof", `-${dur}`, "-i", mp4, "-i", palette,
    "-lavfi", `fps=${fps},scale=${width}:-2:flags=lanczos[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle:new=0`,
    "-loop", "0", gif]);
}

// --- modes ----------------------------------------------------------------------------------

async function recordVideo(browser) {
  const raw = join(TMP, "raw.webm");
  if (existsSync(raw)) rmSync(raw);

  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: TMP, size: VIEWPORT },
  });
  // Playwright video has no audio track regardless; this just keeps the recording machine quiet.
  await context.addInitScript(() => { try { localStorage.setItem("vf.muted", "1"); } catch { /* private mode */ } });

  const page = await newPage(context);
  const t0 = Date.now();
  let verdict;
  try {
    await runMenus(page);
    // 12s, not 25: a round against the normal CPU can end inside 25s, and a demo whose payoff never
    // fires is a demo that failed.
    await installDriver(page, { grantMeterAfter: 12 });
    await lockAndFight(page);
    log("fight started");

    await page.waitForFunction(
      () => { const m = window.__world && window.__world.match; return !!m && (m.wins[0] + m.wins[1] >= 1 || m.phase === "matchEnd"); },
      null, { timeout: 100_000 });

    // Read health NOW, not after the sleep below: ROUND_END_TICKS is 120 and the sleep is 180, so the
    // next round resets both fighters to full inside it and the numbers become meaningless.
    const scores = await page.evaluate(() => ({
      wins: [...window.__world.match.wins],
      health: window.__world.fighters.map((f) => Math.round(f.health)),
    }));
    await sleep(3000); // KO flash + shake + the round banner

    const marks = await page.evaluate(() => window.__demo.marks);
    verdict = { ...scores, marks };
    await page.evaluate(() => window.__demo.off());
  } finally {
    const elapsed = (Date.now() - t0) / 1000;
    await context.close(); // finalizes the webm
    await page.video().saveAs(raw); // must be AFTER close(); the path isn't final before it

    const dur = probeDuration(raw);
    log(`raw ${probeSize(raw)} ${dur.toFixed(1)}s (${elapsed.toFixed(1)}s wall clock), ${mb(raw)} MB`);
    if (dur < elapsed * 0.8) {
      console.warn(`[demo] WARNING: capture is ${((1 - dur / elapsed) * 100).toFixed(0)}% short of wall clock — the window was probably occluded. Re-run and leave it alone.`);
    }
  }

  const winner = verdict.wins[0] > verdict.wins[1] ? "P1 (brawler)" : "P2 (CPU)";
  const supers = verdict.marks.filter((m) => m.tag === "super").length;
  log(`round won by ${winner} — health ${verdict.health[0]} vs ${verdict.health[1]}, ${supers} super(s) fired`);
  if (!supers) console.warn("[demo] WARNING: no super fired — that is the video's payoff. Consider re-running.");

  mkdirSync(MEDIA, { recursive: true });
  const mp4 = join(MEDIA, "demo.mp4");
  const lead = blackLead(raw);
  if (lead > 0.1) log(`trimming ${lead.toFixed(2)}s of boot black off the head`);
  // fps=25 in the filter chain is what makes it CFR; Playwright's webm is VFR with a 25fps ceiling.
  ff(["-y", ...(lead > 0.1 ? ["-ss", String(lead)] : []), "-i", raw,
    "-vf", "fps=25,scale=1280:720:flags=lanczos,format=yuv420p",
    "-c:v", "libx264", "-preset", "slow", "-crf", "21", "-profile:v", "high", "-level", "4.0",
    "-movflags", "+faststart", "-an", mp4]);
  log(`mp4 ${probeSize(mp4)} ${probeDuration(mp4).toFixed(1)}s, ${mb(mp4)} MB -> docs/media/demo.mp4`);

  if (!NO_GIF) {
    const gif = join(MEDIA, "demo.gif");
    toGif(mp4, gif, { dur: GIF_DUR, fps: 13, width: 640, colors: 160 });
    if (statSync(gif).size > 8 * 1024 * 1024) {
      log(`gif was ${mb(gif)} MB — retrying smaller`);
      toGif(mp4, gif, { dur: GIF_DUR, fps: 10, width: 480, colors: 128 });
      if (statSync(gif).size > 8 * 1024 * 1024) {
        console.warn(`[demo] gif is still ${mb(gif)} MB. Shorten it: npm run demo -- --gif-dur 10`);
      }
    }
    log(`gif ${mb(gif)} MB -> docs/media/demo.gif`);
  }
}

async function captureShots(browser) {
  mkdirSync(MEDIA, { recursive: true });
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await context.addInitScript(() => { try { localStorage.setItem("vf.muted", "1"); } catch { /* private mode */ } });
  const page = await newPage(context);
  const shot = async (name, dir = MEDIA) => {
    const p = join(dir, name);
    await page.locator("#game canvas").screenshot({ path: p });
    log(`shot ${name} (${mb(p)} MB)`);
  };

  try {
    // Title first — runMenus leaves the title behind, so take it inline.
    await page.goto(URL);
    await page.waitForFunction(() => window.__flow && window.__flow.state().step === "title", null, { timeout: 60_000 });
    await hideDevChrome(page); // runMenus does this too, but it reloads and this shot comes first
    await sleep(900);
    await shot("title.png");

    await runMenus(page, { dwell: false });
    await sleep(500);
    await shot("select.png");

    await installDriver(page, { grantMeterAfter: 8 }); // shorter grant: we want the super sooner
    await lockAndFight(page);

    // Mid-round, once they are actually engaged rather than walking in from the corners.
    await page.waitForFunction(() => {
      const w = window.__world;
      return w && Math.abs(w.fighters[0].x - w.fighters[1].x) < 160 && w.fighters[1].health < w.fighters[1].cfg.stats.maxHealth;
    }, null, { timeout: 40_000 });
    await shot("fight.png");

    // The cut-in is a handful of frames. Poll fast and grab the first one.
    await page.waitForFunction(() => window.__world && window.__world.fighters[0].state === "special",
      null, { timeout: 60_000, polling: 30 });
    await shot("super.png");

    await page.evaluate(() => window.__demo.off());
  } finally {
    await context.close();
  }

  // og:image must be 1200x630 and live under public/ so Vercel serves it at /og.png.
  const og = join(ROOT, "public", "og.png");
  ff(["-y", "-i", join(MEDIA, "fight.png"), "-vf", "crop=1280:672:0:24,scale=1200:630:flags=lanczos", og]);
  log(`og ${probeSize(og)} -> public/og.png`);

  // Favicon from the brawler portrait — no new art, and the face is already centred near the top.
  const fav = join(ROOT, "public", "favicon.png");
  ff(["-y", "-i", join(ROOT, "public", "ui", "portraits", "brawler.png"),
    "-vf", "crop=340:340:54:40,scale=256:256:flags=lanczos", fav]);
  log(`favicon ${probeSize(fav)} -> public/favicon.png`);
}

// --- main -----------------------------------------------------------------------------------

let browser;
try {
  mkdirSync(TMP, { recursive: true });
  await startServer();

  // A cold vite pays dep-optimization plus the whole sprite/stage/portrait load on first navigation.
  // Absorb it here so the recording doesn't open on several seconds of black.
  log("warming up…");
  const warm = await chromium.launch({ headless: true });
  const wp = await warm.newPage();
  await wp.goto(URL);
  await wp.waitForFunction(() => !!window.__flow, null, { timeout: 60_000 }).catch(() => {});
  await warm.close();

  browser = await chromium.launch({ headless: false, args: LAUNCH_ARGS });
  if (SHOTS) await captureShots(browser);
  else await recordVideo(browser);
  log("done");
} finally {
  if (browser) await browser.close();
  stopServer();
}
