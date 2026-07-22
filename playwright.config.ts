import { defineConfig, devices } from "@playwright/test";

// ponytail: single chromium project + dev webServer. The spec reads DEV-only window hooks
// (__world, __aSprite, __game) that only exist in the dev build, and pumps game.step() itself, so
// it runs against `vite` and is independent of RAF/headless throttling. Preview parity is a
// manual smoke (see the phase plan's verification).
export default defineConfig({
  testDir: "./e2e",
  reporter: "list",
  // ponytail: 60s, not the 30s default. Boot is the slow part — every spec does a real page.goto that
  // loads the whole sprite/stage asset set through the dev server, and as the suite grew a cold boot
  // started grazing 30s and flaking a test whose BODY takes milliseconds. Raise it if boot gets
  // slower again; the real fix is a shared warm page, which isn't worth it yet.
  timeout: 60_000,
  // ponytail: 4 workers, not the default (half the cores). Boot, not the test body, is what costs
  // here, and every worker cold-boots the whole sprite/stage/portrait set through one dev server.
  // Past ~4 concurrent boots they starve each other and specs whose bodies take milliseconds start
  // timing out at random — which reads as flakiness in whichever spec lost the race. Raise it only
  // alongside a shared warm page.
  workers: 4,
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
