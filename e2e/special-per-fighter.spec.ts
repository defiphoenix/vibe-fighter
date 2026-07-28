import { test, expect } from "@playwright/test";
import { ready, pump, toFlow, driveTo1v1 } from "./harness";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Why this exists, when `phase15-special.spec.ts` already covers the special:
//
//  1. That spec boots `?scene=match`, whose DEFAULT_CONFIG is `["brawler","jiujitsu"]`, so **P1 is
//     always the brawler**. The special was reported dead for jiujitsu and monk and no browser test
//     could have seen it, because no browser test had ever run one.
//  2. That spec drives the DEV seam, which injects `specialPressed` AFTER InputReader. Its own header
//     says trusted keys never reach Phaser headless — measured here, they DO: `page.keyboard` fires
//     the super. So this presses the physical `E`, which is what the player presses, and is the only
//     thing that covers the binding table itself.
//
// What was actually wrong is neither: meter is paid as `+damage` and the ground heavy pays the
// brawler 15 but jiujitsu and monk 14, so seven clean heavies leave those two on 98/100 with a bar
// that drew 98% of its slot and read as full. The refusal is silent, so it read as a broken move.
// The boundary below is that defect.

const ROSTER = [
  { card: 0 as const, id: "brawler" },
  { card: 1 as const, id: "jiujitsu" },
  { card: 2 as const, id: "monk" },
];

// One boot, three matches via `toFlow` — `page.goto` re-pulls the whole asset set and is by far the
// most expensive thing here.
test.slow();

test("every fighter's super fires on the real E key, and only on a full bar", async ({ page }) => {
  await ready(page, { route: "", needs: ["__game", "__flow"] });

  for (const { card, id } of ROSTER) {
    if (card > 0) await toFlow(page);
    await driveTo1v1(page, card);
    await pump(page, 120); // clear the intro gate (INTRO_TICKS = 90)

    expect(await page.evaluate(() => (window as any).__world.fighters[0].cfg.id), "P1 card").toBe(id);

    /** Put P1 on `meter`, wipe any leftover freeze, press the PHYSICAL E, and report. */
    const pressE = async (meter: number) => {
      await page.evaluate((n) => {
        const w = (window as any).__world;
        w.fighters[0].meter = n;
        w.fighters[0].state = "idle";
        w.hitstop = 0; // a super freeze still counting down gates ALL input consumption
      }, meter);
      await pump(page, 2);
      const hud = await page.evaluate(() => (window as any).__hud());
      await page.keyboard.down("e");
      await pump(page, 4);
      await page.keyboard.up("e");
      await pump(page, 4);
      return {
        hud,
        after: await page.evaluate(() => {
          const w = (window as any);
          return {
            state: w.__world.fighters[0].state as string,
            meter: w.__world.fighters[0].meter as number,
            hitstop: w.__world.hitstop as number,
            cutIn: w.__cutIn() as { playing: boolean; key: string },
          };
        }),
      };
    };

    // ONE point short: refused, silently, and the bar must NOT be claiming to be ready.
    const short = await pressE(99);
    expect(short.after.state, `${id} fired a super on a 99 bar`).not.toBe("special");
    expect(short.after.meter, `${id} spent meter it did not have`).toBe(99);
    expect(short.after.hitstop, `${id} froze on a refused super`).toBe(0);
    expect(short.hud.meterReady[0], `${id} advertised MAX at 99`).toBe(false);
    // ...and the drawn bar must be visibly short of the slot, not the 1% that started all this.
    expect(short.hud.meter[0].w).toBeLessThan(short.hud.meter[0].max * 0.97);

    // Exactly full: comes out, spends the whole bar, freezes, and shows this fighter's own cut-in.
    const full = await pressE(100);
    expect(full.hud.meterReady[0], `${id} hid MAX on a full bar`).toBe(true);
    // The string, not just visibility — an empty label is visible and unreadable.
    expect(full.hud.meterLabel[0], `${id} showed an unreadable MAX cue`).toBe("MAX");
    expect(full.hud.meter[0].w, `${id} drew a full bar short`).toBeCloseTo(full.hud.meter[0].max, 5);
    expect(full.after.state, `${id} refused a super on a full bar`).toBe("special");
    expect(full.after.meter, `${id} did not spend the bar`).toBe(0);
    expect(full.after.hitstop, `${id} did not start the super freeze`).toBeGreaterThan(0);
    expect(full.after.cutIn.playing, `${id} played no cut-in`).toBe(true);
    expect(full.after.cutIn.key, `${id} cut-in showed the wrong portrait`).toBe(`portrait-${id}`);
  }
});
