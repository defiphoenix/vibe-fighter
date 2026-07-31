import { test, expect, type Page } from "@playwright/test";
import { MATCH, pump, ready as harnessReady } from "./harness";
import { WALK_HOLD } from "../src/sim/cpu";

// Phase 21. Two player-reported animation defects, and the two things only a browser can answer.
//
// The report was "player 2 isn't animating correctly for all characters", and the user was not sure
// which mode they were in. That splits into two very different questions:
//
//   1. Is the RENDER layer asymmetric between the two slots? It is not — `FighterSprite` reads
//      `f.facing` for flipX and nothing else, and MatchScene builds and updates both identically —
//      so the parity case here is expected to be GREEN on the day it is written. It is a regression
//      guard against a future asymmetry, NOT a reproduction. Writing it down as "red today" would
//      have been wrong, and saying so matters: a test whose failure mode you have not established is
//      decoration (CLAUDE.md), and so is a test whose PASS you have misattributed to a fix.
//   2. Does the CPU actually walk? That one WAS red: `cpu.ts` re-rolled `approachBias` every tick,
//      so P2's state flickered walkF<->idle at 60Hz and the 8-frame walk cycle never left frame 0.
//      `sim/cpu.test.ts` owns the episode arithmetic; what only the browser proves is that the sim
//      state actually survives long enough for Phaser's AnimationState to advance through it.
//
// `WALK_HOLD` is IMPORTED rather than retyped: the constant is exported from sim/cpu.ts precisely so
// this file cannot hold a second copy that drifts.
//
// Phaser's `currentFrame.index` is ONE-based, so every index here is normalised to a 0-based cell.
// Left alone, "reached index 3" silently means "reached cell 2" and the assertion is a cell weaker
// than it reads.

/* eslint-disable @typescript-eslint/no-explicit-any */

const ready = (page: Page): Promise<void> =>
  harnessReady(page, { route: MATCH, needs: ["__sprites", "__world", "__game", "__holdP1", "__holdP2"] });

const IDS = ["brawler", "jiujitsu", "monk"] as const;

/** Start a MIRROR match directly. `driveTo1v1` cannot do this — the select screen pushes the two
 *  cursors onto DIFFERENT cards by design, and comparing two slots holding two different characters
 *  would compare their art, not the slots. */
async function mirrorMatch(page: Page, id: string): Promise<void> {
  await page.evaluate((fid) => {
    (window as any).__world = null;
    (window as any).__game.scene.start("Match", {
      mode: "1v1", stageId: "twilight", fighters: [fid, fid],
    });
  }, id);
  for (let i = 0; i < 300; i += 20) {
    await pump(page, 20);
    const ok = await page.evaluate(() => (window as any).__world != null && (window as any).__holdP2 != null);
    if (ok) return;
  }
  throw new Error(`the ${id} mirror match never started`);
}

/**
 * Drive both slots through the same scripted move and return each one's (state, cell) trace.
 *
 * P2 faces LEFT, so "forward" for him is `left` — the whole point of the exercise is that the two
 * fighters do the SAME thing, which means mirroring the direction keys, not copying them. Everything
 * runs inside ONE page.evaluate keeping its own accumulating `t`: `pump()` re-reads a `loop.now` that
 * FREEZES after `loop.stop()`, and a per-frame round trip is what made an earlier spec flaky.
 */
async function trace(page: Page, script: { hold: Record<string, boolean>; frames: number }[]): Promise<{
  p1: { state: string; cell: number }[];
  p2: { state: string; cell: number }[];
}> {
  return page.evaluate((steps) => {
    const w = window as any, g = w.__game;
    let t = g.loop?.now ?? performance.now();
    const out: any = { p1: [], p2: [] };
    // `right`/`left` are the only keys that must be mirrored; everything else is stance-relative
    // already and is passed through untouched.
    const mirror = (h: Record<string, boolean>): Record<string, boolean> => {
      const m: Record<string, boolean> = { ...h };
      if ("right" in h || "left" in h) { m.left = !!h.right; m.right = !!h.left; }
      return m;
    };
    for (const step of steps) {
      w.__holdP1(step.hold);
      w.__holdP2(mirror(step.hold));
      for (let i = 0; i < step.frames; i++) {
        t += 1000 / 60;
        g.step(t, 1000 / 60);
        for (const [k, idx] of [["p1", 0], ["p2", 1]] as const) {
          const a = w.__sprites[idx].anims;
          out[k].push({
            // strip the `<id>-` prefix: a mirror match shares the id, but keeping the raw key would
            // make this spec unusable for a non-mirror pairing later.
            state: String(a.currentAnim?.key ?? "").replace(/^[^-]+-/, ""),
            cell: (a.currentFrame?.index ?? 1) - 1, // Phaser is 1-based
          });
        }
      }
    }
    w.__holdP1({}); w.__holdP2({});
    return out;
  }, script);
}

test.describe("P1/P2 slot parity", () => {
  for (const id of IDS) {
    test(`${id} animates identically in both player slots`, async ({ page }) => {
      // A mirror match per character on top of the cold boot; the body is ~900 pumped frames of real
      // rendering, which is not the ~free body the suite-wide 60s budget assumes.
      test.slow();
      await ready(page);
      await mirrorMatch(page, id);
      await pump(page, 120); // clear the intro gate (INTRO_TICKS = 90), which gates input

      const { p1, p2 } = await trace(page, [
        { hold: {}, frames: 20 },                                  // idle
        { hold: { right: true }, frames: 60 },                      // walkF (forward)
        { hold: { left: true }, frames: 60 },                       // walkB (backward)
        { hold: { down: true }, frames: 20 },                       // crouch
        { hold: { block: true }, frames: 20 },                      // block
        { hold: { block: true, down: true }, frames: 20 },          // blockCrouch
        { hold: {}, frames: 4 },
        { hold: { lightPressed: true }, frames: 1 },                // a 1-frame EDGE, never held
        { hold: {}, frames: 30 },                                   // attackLight through to recovery
        { hold: { heavyPressed: true }, frames: 1 },
        { hold: {}, frames: 40 },                                   // attackHeavy
        { hold: { down: true, lightPressed: true, downAtPress: true }, frames: 1 },
        { hold: { down: true }, frames: 24 },                       // crouchLight
        { hold: { down: true, heavyPressed: true, downAtPress: true }, frames: 1 },
        { hold: { down: true }, frames: 40 },                       // crouchHeavy
        { hold: {}, frames: 4 },
        { hold: { upPressed: true }, frames: 1 },
        { hold: {}, frames: 12 },                                   // jumpRise
        { hold: { lightPressed: true }, frames: 1 },
        { hold: {}, frames: 40 },                                   // airLight, then the landing
      ]);

      expect(p1.length).toBe(p2.length);
      expect(p1.length).toBe(400); // the scripted frame counts, summed — pins that every step ran
      // Compared as whole traces, not sampled: a per-frame divergence anywhere — a state that never
      // starts, a one-shot that stops short, a loop that restarts on one side only — shows up as a
      // mismatched pair and names the frame it happened on.
      const diverged = p1.findIndex((v, i) => v.state !== p2[i].state || v.cell !== p2[i].cell);
      expect(
        diverged,
        diverged < 0 ? "" : `frame ${diverged}: P1 ${JSON.stringify(p1[diverged])} vs P2 ${JSON.stringify(p2[diverged])}`,
      ).toBe(-1);

      // ...and the trace has to be worth comparing. Two fighters that both stood in `idle` for 400
      // frames would satisfy the equality above perfectly, which is exactly the vacuous pass this
      // guards against.
      const seen = new Set(p1.map((v) => v.state));
      // Every state the script ATTEMPTS is listed. Leaving one off is not a smaller assertion, it is
      // a silent hole: if both slots ignored the air normal's edge, the equality above would still
      // pass and the spec would claim coverage it never had. `airLight` was exactly that hole until a
      // review pointed at it.
      for (const s of ["idle", "walkF", "walkB", "crouch", "block", "blockCrouch", "attackLight", "attackHeavy", "crouchLight", "crouchHeavy", "jumpRise", "jumpFall", "airLight"]) {
        expect(seen.has(s), `the script never reached ${s}, so parity on it proves nothing`).toBe(true);
      }
    });
  }
});

test.describe("the CPU opponent visibly walks", () => {
  // The report was "for all characters", so the CPU slot varies with the difficulty rather than
  // fixing one fighter across all three runs — the walk sheets, `walkSpeed` and (since Phase 19) the
  // derived reaches all differ per fighter, and it is the reaches that decide when the CPU stops
  // walking at all. Fixing the CPU to one character would have tested one third of the report.
  const CPU_SIDE = { easy: "brawler", normal: "jiujitsu", hard: "monk" } as const;
  for (const difficulty of ["easy", "normal", "hard"] as const) {
    test(`P2's walk cycle actually advances on ${difficulty} (CPU = ${CPU_SIDE[difficulty]})`, async ({ page }) => {
      test.slow();
      await ready(page);
      await page.evaluate(({ d, cpuId }) => {
        (window as any).__world = null;
        (window as any).__game.scene.start("Match", {
          mode: "cpu", difficulty: d, stageId: "twilight", fighters: ["brawler", cpuId],
        });
      }, { d: difficulty, cpuId: CPU_SIDE[difficulty] });
      for (let i = 0; i < 300 && !(await page.evaluate(() => (window as any).__world != null)); i += 20) await pump(page, 20);
      await pump(page, 120); // past the intro gate

      // No player input at all — the CPU is the only thing moving. One evaluate, own clock.
      const seen = await page.evaluate(() => {
        const w = window as any, g = w.__game;
        let t = g.loop?.now ?? performance.now();
        let run = 0, longestRun = 0, maxCell = -1, last = "";
        for (let i = 0; i < 900; i++) {
          t += 1000 / 60;
          g.step(t, 1000 / 60);
          const st = w.__world.fighters[1].state as string;
          const isWalk = st === "walkF" || st === "walkB";
          if (isWalk) {
            run = st === last ? run + 1 : 1;
            longestRun = Math.max(longestRun, run);
            const a = w.__sprites[1].anims;
            if (String(a.currentAnim?.key ?? "").endsWith(st)) {
              maxCell = Math.max(maxCell, (a.currentFrame?.index ?? 1) - 1);
            }
          } else { run = 0; }
          last = isWalk ? st : "";
        }
        return { longestRun, maxCell };
      });

      // Before the fix these measured ~6 and 0: the sim state never survived one 83ms animation
      // frame, so the cycle was pinned to cell 0 no matter how long the match ran.
      expect(seen.longestRun, "the CPU never held a walk state long enough to animate")
        .toBeGreaterThanOrEqual(WALK_HOLD);
      expect(seen.maxCell, "the walk animation never left its first cell").toBeGreaterThanOrEqual(3);
    });
  }
});
