import { test, expect } from "@playwright/test";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { withRegistryLock } from "./registry-lock";
import { driveTo1v1, keys, pump, ready, seedFlow, waitForMatch } from "./harness";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Phase 16 — the integration/parity gate. Everything here covers a README parity item that had NO
// browser proof, only unit tests or a spec that reached its state by writing it directly.
//
// ONE file rather than four, deliberately: Playwright parallelises per FILE at workers=4, and every
// worker cold-boots the whole sprite/stage/portrait set through a single dev server. Four new files
// would claim four scheduler slots and roughly double the concurrent-boot pressure the config comment
// already warns about; one file claims one and runs its cases in sequence inside a single worker.

const REGISTRY = "public/configs/character-gym.json";

test.describe("Phase 16 — integration parity", () => {
  test.slow(); // every case pays its own cold boot

  test("two REAL KOs walk the match through both rounds to matchEnd", async ({ page }) => {
    // The existing round/menu specs all reach `matchEnd` by assigning `world.match.phase`, which
    // skips the entire rule under test. This one plays it: P1 grinds jiujitsu down with lights,
    // twice, and the phases it passes through are OBSERVED and asserted as a sequence.
    await ready(page, "?scene=match"); // ?scene=match defaults to 1v1 brawler vs jiujitsu...

    const r = await page.evaluate(() => {
      const w = window as any, g = w.__game;
      let t = g.loop?.now ?? performance.now(); const d = 1000 / 60;
      const step = (n: number) => { for (let i = 0; i < n; i++) { t += d; g.step(t, d); } };
      const m = () => w.__world.match;

      const phases: string[] = [];
      const note = () => { if (phases[phases.length - 1] !== m().phase) phases.push(m().phase); };

      let ticks = 0;
      const BUDGET = 4000; // well under the 7200 two full clocks would take: a KO has to be what ends it
      let afterRound1: number[] | null = null;
      // Round 2 must be a SECOND, INDEPENDENT KO — not the round-1 corpse banked twice. Without
      // these, a broken resetRound() that never restored P2's health would bank a win on round 2's
      // first fight tick and every other assertion below would still pass.
      let r2Start: number | null = null;
      let r2Low: number | null = null;

      while (m().matchWinner === null && ticks < BUDGET) {
        note();
        if (m().round === 2 && m().phase === "fight") {
          const hp = w.__world.fighters[1].health as number;
          if (r2Start === null) r2Start = hp;
          r2Low = hp;
        }
        if (m().phase !== "fight") { w.__holdP1({}); step(6); ticks += 6; continue; }
        // Fighters START 260px apart and brawler's light reaches 110px forward against a hurt box
        // that comes 30px back — so the first swings whiff and P1 has to walk in. `right` is held
        // through the whole cycle: it does nothing while the attack locks him, and closes the
        // ~9-10px of knockback each connect adds once he recovers.
        // ONE frame of lightPressed = ONE rising edge. The DEV seam FORCES the flag every frame, so
        // holding it two frames would be two edges and a double-fire under the input buffer.
        w.__holdP1({ right: true, light: true, lightPressed: true }); step(1);
        w.__holdP1({ right: true }); step(19);
        ticks += 20;
        if (m().round === 2 && afterRound1 === null) afterRound1 = [...m().wins];
      }
      note();
      w.__holdP1({});
      step(30); // let the end menu open on its own

      return {
        ticks, phases, afterRound1, r2Start, r2Low,
        round: m().round, wins: [...m().wins], winner: m().matchWinner,
        timerLeft: m().timerTicks,
        p2State: w.__world.fighters[1].state as string,
        p2Health: w.__world.fighters[1].health as number,
        p2Max: w.__world.fighters[1].cfg.stats.maxHealth as number,
        endMenu: w.__endMenu(),
      };
    });

    expect(typeof r.winner).toBe("number"); // never let this pass on undefined === undefined
    expect(r.winner).toBe(0);
    expect(r.wins).toEqual([2, 0]);
    expect(r.round).toBe(2);
    expect(r.afterRound1).toEqual([1, 0]); // round 1 really banked a win before round 2 began
    // Round 2 was a second, independent KO: P2 came back on FULL health and was ground down again.
    expect(r.r2Start).toBe(r.p2Max);
    expect(r.r2Low).toBeLessThan(r.r2Start as number);
    // The whole point: this sequence was WATCHED, not written. A forced phase would not produce it.
    expect(r.phases).toEqual(["intro", "fight", "roundEnd", "intro", "fight", "matchEnd"]);
    expect(r.timerLeft).toBeGreaterThan(0); // a KO ended it, not the clock
    expect(r.p2Health).toBe(0);
    expect(r.p2State).toBe("ko"); // isKO reads the STATE, not the health — assert what the sim reads
    expect(r.endMenu.shown).toBe(true);
    expect(r.ticks).toBeLessThan(4000);
  });

  test("the 60-second clock really runs out, and the round resolves on health", async ({ page }) => {
    // Pumped at ~0.22ms/step, a full 3600-tick round costs under a second — so this runs the clock
    // for real rather than fast-forwarding it, and covers both halves at once: that it decrements
    // once per fight tick, and that hitting zero picks the healthier fighter.
    await ready(page, "?scene=match");

    const r = await page.evaluate(() => {
      const w = window as any, g = w.__game;
      let t = g.loop?.now ?? performance.now(); const d = 1000 / 60;
      const step = (n: number) => { for (let i = 0; i < n; i++) { t += d; g.step(t, d); } };
      const m = () => w.__world.match;

      // Step until the fight actually starts rather than assuming INTRO_TICKS: pumping a guessed 95
      // spends 5 ticks of the round clock before the first reading, which is how the first draft of
      // this test managed to measure 3595 and call the sim wrong. Counting also proves the clock does
      // NOT run during the intro, which is worth an assertion of its own.
      let intro = 0;
      while (m().phase === "intro" && intro < 300) { step(1); intro++; }
      const atStart = { phase: m().phase, ticks: m().timerTicks, secs: m().secondsLeft, hitstop: w.__world.hitstop, intro };

      step(180); // three seconds of real clock
      const after3s = { ticks: m().timerTicks, secs: m().secondsLeft };

      // Land a few lights so the two are NOT tied on health when time expires — otherwise the
      // correct outcome is a draw and this would prove nothing about the health comparison.
      for (let i = 0; i < 12; i++) {
        w.__holdP1({ right: true, light: true, lightPressed: true }); step(1);
        w.__holdP1({ right: true }); step(19);
      }
      w.__holdP1({});
      const health = w.__world.fighters.map((f: any) => f.health as number);
      const max = w.__world.fighters.map((f: any) => f.cfg.stats.maxHealth as number);
      const koBefore = w.__world.fighters.map((f: any) => f.state as string);

      // Run the rest of the clock down. +150 covers the roundEnd transition.
      let guard = 0;
      while (m().timerTicks > 0 && guard < 4200) { step(1); guard++; }
      step(5);

      return {
        atStart, after3s, health, max, koBefore, ranFor: guard,
        timerLeft: m().timerTicks,
        phase: m().phase,
        lastWinner: m().lastRoundWinner,
        wins: [...m().wins],
        states: w.__world.fighters.map((f: any) => f.state as string),
      };
    });

    expect(r.atStart.phase).toBe("fight");
    expect(r.atStart.hitstop).toBe(0);
    expect(r.atStart.intro).toBe(90); // INTRO_TICKS
    // Still the full duration after 90 pumped ticks: the clock does not run during the intro.
    expect(r.atStart.ticks).toBe(3600); // ROUND_TIME * TICK_HZ
    expect(r.atStart.secs).toBe(60);
    // It DECREMENTS, exactly once per fight tick — not merely "it is a number that got smaller".
    expect(r.after3s.ticks).toBe(3600 - 180);
    expect(r.after3s.secs).toBe(57);
    // Nobody was KO'd: the clock is what ended this round.
    expect(r.koBefore).not.toContain("ko");
    expect(r.states).not.toContain("ko");
    // Compare SHARES, and prove P2 actually took damage first. Raw health would be a trap here: the
    // default pair starts 105 vs 100, so `health[0] > health[1]` is true before a single hit lands —
    // this test would pass with the lights whiffing AND the R-13 share rule reverted to raw health.
    expect(r.health[1]).toBeLessThan(r.max[1]); // the hits really connected
    expect(r.health[0]).toBe(r.max[0]); // ...and P1 was never touched
    expect(r.health[1]).toBeGreaterThan(0);
    expect(r.health[0] / r.max[0]).toBeGreaterThan(r.health[1] / r.max[1]);
    expect(r.timerLeft).toBeLessThanOrEqual(0);
    expect(r.phase).toBe("roundEnd");
    expect(typeof r.lastWinner).toBe("number");
    expect(r.lastWinner).toBe(0); // the healthier fighter, not a draw and not the attacker by default
    expect(r.wins).toEqual([1, 0]);
  });

  test("all three fighters are selectable, and the monk really boots as a monk", async ({ page }) => {
    await ready(page);
    expect(await page.evaluate(() => (window as any).__flow.roster()))
      .toEqual(["brawler", "jiujitsu", "monk"]);

    const state = await driveTo1v1(page, 2); // P1 walks to card 2; P2 is pushed to card 0
    expect(state.cursors).toEqual([2, 0]);

    const r = await page.evaluate(() => {
      const w = window as any;
      return {
        ids: w.__world.fighters.map((f: any) => f.cfg.id as string),
        sprites: w.__sprites.map((s: any) => s.texture.key as string),
        hudFaces: w.__hud().portraitKeys as string[],
        jump: w.__world.fighters[0].cfg.stats.jumpVelocity as number,
        walk: w.__world.fighters[0].cfg.stats.walkSpeed as number,
        // Boxes are PER-FRAME, so the pushbox comes off a crouch frame, not a config array.
        pushCrouch: w.__world.fighters[0].cfg.states.crouch.frames[0].push.w as number,
      };
    });

    expect(r.ids).toEqual(["monk", "brawler"]);
    // Not just the config id: the ART and the HUD face are his too.
    expect(r.sprites[0]).toBe("monk-idle");
    expect(r.hudFaces[0]).toBe("hud-portrait-monk");
    // ...and his OWN numbers booted, not the default pair's — the monk is the tall jumper and the
    // wide-bodied one, which is the whole premise reach-parity.test.ts compensates for.
    expect(typeof r.jump).toBe("number");
    expect(r.jump).toBe(980);
    expect(r.walk).toBe(200);
    expect(r.pushCrouch).toBe(76);
  });

  test("the CPU can pick the third fighter (seeded, so this is a fact and not a coin flip)", async ({ page }) => {
    await ready(page);
    await seedFlow(page, 1); // seed 1 -> the second free card -> monk
    const state = await keys(page, ["enter", "right", "enter", "enter", "enter"]); // CPU · EASY
    expect(state.locked[0]).toBe(true);
    await waitForMatch(page);
    expect(await page.evaluate(() => (window as any).__world.fighters.map((f: any) => f.cfg.id)))
      .toEqual(["brawler", "monk"]);

    // Contrast: the same walk with a different seed fields the other free card. Together these prove
    // the pick is a real draw — either alone would also pass against a hardcoded constant.
    await ready(page);
    await seedFlow(page, 2);
    await keys(page, ["enter", "right", "enter", "enter", "enter"]);
    await waitForMatch(page);
    expect(await page.evaluate(() => (window as any).__world.fighters.map((f: any) => f.cfg.id)))
      .toEqual(["brawler", "jiujitsu"]);
  });

  test("editing character-gym.json on disk and reloading changes live combat", async ({ page }) => {
    // The Playground spec proves a stat saved through the dev endpoint survives into a fresh match.
    // This proves the other direction the parity list actually asks for: the FILE is the source of
    // truth, so editing the bytes and reloading changes the numbers the sim fights with.
    //
    // MONK only, and every write is ATOMIC (temp + rename, the same reason `vite/gym-save-plugin.ts`
    // does it). `withRegistryLock` serialises WRITERS against each other but not against the readers
    // booting matches on the other three workers, so a plain `writeFileSync` of a ~1MB JSON leaves a
    // window where a concurrent BootScene fetch gets a TRUNCATED file — which would fail some
    // unrelated spec with a baffling parse error. A rename is atomic, so a reader sees either the old
    // file or the new one, never half of one.
    //
    // Which fields are safe is then a directional argument, not luck: the only other spec that touches
    // the monk asserts he MOVED AT LEAST a distance (phase10-playground), so raising walkSpeed can
    // only make that more true, and nothing anywhere asserts his damage.
    await withRegistryLock(async () => {
      const original = readFileSync(REGISTRY);
      const tmp = `${REGISTRY}.phase16.tmp`;
      const swap = (buf: string | Buffer) => { writeFileSync(tmp, buf); renameSync(tmp, REGISTRY); };
      try {
        const j = JSON.parse(original.toString("utf8"));
        expect(j.monk.data.attacks.light.damage).toBe(6); // the shipped value this test moves off
        expect(j.monk.data.stats.walkSpeed).toBe(200);
        j.monk.data.attacks.light.damage = 21;
        j.monk.data.stats.walkSpeed = 300; // FASTER, so the playground's "moved at least N" still holds
        swap(JSON.stringify(j, null, 2));

        // The dev server must be serving the new bytes before the page asks for them.
        const served = await page.request.get("/configs/character-gym.json");
        expect((await served.json()).monk.data.attacks.light.damage).toBe(21);

        await ready(page);
        const state = await driveTo1v1(page, 2); // P1 = monk
        expect(state.cursors).toEqual([2, 0]);

        const r = await page.evaluate(() => {
          const w = window as any, g = w.__game;
          let t = g.loop?.now ?? performance.now(); const d = 1000 / 60;
          const step = (n: number) => { for (let i = 0; i < n; i++) { t += d; g.step(t, d); } };
          step(95); // past the intro gate

          // Walk in and swing until the FIRST connect, then report that single hit's damage.
          let before = w.__world.fighters[1].health as number;
          let dealt = 0;
          for (let i = 0; i < 40 && dealt === 0; i++) {
            w.__holdP1({ right: true, light: true, lightPressed: true }); step(1);
            w.__holdP1({ right: true }); step(19);
            const now = w.__world.fighters[1].health as number;
            if (now < before) dealt = before - now;
            before = now;
          }
          w.__holdP1({});
          return {
            dealt,
            walk: w.__world.fighters[0].cfg.stats.walkSpeed as number,
            hudFace: (w.__hud().portraitKeys as string[])[0],
          };
        });

        expect(r.hudFace).toBe("hud-portrait-monk");
        expect(typeof r.dealt).toBe("number");
        expect(r.dealt).toBe(21); // the FILE's number, not the shipped 6
        expect(r.walk).toBe(300);
      } finally {
        // Byte-for-byte, never a JSON round trip — the restore must not reformat the file. Atomic
        // for the same reason the write is: a half-restored registry would poison every later spec.
        swap(original);
      }
    });
  });

  test("both stage variants build a real match, with different layers", async ({ page }) => {
    const layersFor = async (stageIndex: 0 | 1) => {
      await ready(page);
      const state = await driveTo1v1(page, 0, stageIndex);
      expect(state.stageIndex).toBe(stageIndex);
      return page.evaluate(() => ({
        keys: (window as any).__stage.layers.map((l: any) => l.texture.key as string),
        camW: (window as any).__stage.cam.getBounds().width as number,
      }));
    };

    const twilight = await layersFor(0);
    expect(twilight.keys.length).toBeGreaterThan(0);
    expect(twilight.keys.every((k: string) => k.startsWith("twilight-"))).toBe(true);
    expect(twilight.camW).toBe(1696); // STAGE_WIDTH: the camera really scrolls a world wider than the view

    const sunset = await layersFor(1);
    expect(sunset.keys.every((k: string) => k.startsWith("sunset-"))).toBe(true);
    expect(sunset.keys.length).toBe(twilight.keys.length); // same layer contract...
    expect(sunset.keys).not.toEqual(twilight.keys); // ...different art
    expect(sunset.camW).toBe(twilight.camW);
  });
});
