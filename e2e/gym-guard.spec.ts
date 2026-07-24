import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { withRegistryLock } from "./registry-lock";

// Phase 13 acceptance for the AUTHORING path: editing a guard box in the Gym writes the stance
// template (all frames), not a per-frame override, and the edit survives a save to the registry.
// That a saved guard box then changes a live block OUTCOME is proven deterministically in
// src/sim/combat.test.ts ("a guard box stripped from the live blockCrouch contact frame lets the SAME
// low through");
// re-proving it here would mean booting a match against the mutated shared registry file, which
// races every other match-booting spec (workers=4). So this spec edits MONK — never a default-match
// fighter — and asserts the file, keeping its write window benign to the rest of the suite.
//
// Phaser gotcha (as elsewhere): trusted key events never reach headless Phaser, so guard selection
// goes through the DEV __gym.selectKind seam rather than Tab.

/* eslint-disable @typescript-eslint/no-explicit-any */
const REGISTRY = "public/configs/character-gym.json";

test("editing a guard box in the Gym writes the stance template and saves it", async ({ page }) => {
  // The dev endpoint writes the ONE real registry file; the lock keeps this critical section from
  // overlapping the other file-mutating spec (phase11-flow saved-stats) under parallel workers.
  await withRegistryLock(async () => {
  const original = readFileSync(REGISTRY);
  try {
    await page.goto("/?scene=gym");
    await page.waitForFunction(() => (window as any).__gym != null, null, { timeout: 30_000 });
    await page.locator("#gym-panel select").first().selectOption("monk");
    expect(await page.evaluate(() => (window as any).__gym.current().id)).toBe("monk");

    // a block state can guard; an attack state cannot and must offer no guard box to select at all.
    await page.evaluate(() => (window as any).__gym.setState("block"));
    expect(await page.evaluate(() => (window as any).__gym.selectKind("guardStand"))).toBe(true);
    await page.evaluate(() => (window as any).__gym.setState("attackHeavy"));
    expect(await page.evaluate(() => (window as any).__gym.selectKind("guardStand"))).toBe(false);

    const before = await page.evaluate(() =>
      (window as any).__gym.frameGuard("block", 0).guardStand[0].y as number);

    await page.evaluate(() => {
      const g = (window as any).__gym;
      g.setState("block");
      g.selectKind("guardStand");
      g.edit(0, -400); // drag the high guard far up (world y-down → box y up)
    });

    const after = await page.evaluate(() => {
      const g = (window as any).__gym;
      return {
        template: g.data().boxes.guardStand[0],
        overrides: g.data().overrides,
        frame0: g.frameGuard("block", 0).guardStand[0],
        frame3: g.frameGuard("block", 3).guardStand[0],
        blockCrouchFrame0: g.frameGuard("blockCrouch", 0).guardStand[0], // a DIFFERENT guardable state
      };
    });
    expect(after.frame0.y).toBe(before + 400); // the edit landed
    expect(after.overrides).toBeUndefined();    // a STANCE edit, never a per-frame override
    expect(after.frame3).toEqual(after.frame0); // reached every frame of the state, not just the drawn one
    expect(after.blockCrouchFrame0).toEqual(after.frame0); // …and every guardable state, since it's the template

    await page.locator("#gym-panel button").click();
    await expect(page.locator("#gym-panel span").last()).toHaveText("saved ✓");

    // The save reached the real file: monk's template moved, and no override was introduced.
    const saved = JSON.parse(readFileSync(REGISTRY, "utf8"));
    expect(saved.monk.data.boxes.guardStand[0]).toEqual(after.template);
    expect(saved.monk.data.overrides).toBeUndefined();
  } finally {
    writeFileSync(REGISTRY, original);
  }
  });
});
