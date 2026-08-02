// `vitest/config` re-exports Vite's defineConfig plus the `test` key — the documented form for a shared
// Vite+Vitest config. This file and vite/ are typechecked by tsconfig.tooling.json (Node types), NOT by
// the browser program in tsconfig.json; `npm run build` chains both, so a break here fails the deploy
// gate. It did not use to — they were typechecked by nothing until gym-save-plugin.ts started owning an
// authorization decision.
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import { gymSavePlugin } from "./vite/gym-save-plugin.js";

// Mirror production's security headers onto `vite preview` so the CSP is testable against the REAL built
// bundle before a deploy. Read straight out of vercel.json — one source of truth, so the two can't drift.
// Only `preview` gets these: `dev` is unbundled and would trip script-src on Vite's injected client.
// Vercel's own preview deployments sit behind Deployment Protection (every route 302s to SSO), so this is
// the only place a strict CSP can actually be exercised pre-release.
const vercelHeaders: Record<string, string> = Object.fromEntries(
  (JSON.parse(readFileSync(new URL("./vercel.json", import.meta.url), "utf8")) as {
    headers: { headers: { key: string; value: string }[] }[];
  }).headers[0].headers.map((h) => [h.key, h.value]),
);

export default defineConfig({
  // ponytail: default root/public are fine; only test config is non-default.
  // gymSavePlugin is dev-server-only (apply:"serve") — the /__gym/save write-back never ships.
  plugins: [gymSavePlugin()],
  preview: { headers: vercelHeaders },
  test: {
    // ponytail: no `globals` — it defaults to false in Vitest 4 and every *.test.ts imports
    // { describe, it, expect } from "vitest" explicitly, so injecting them was dead config.
    environment: "node", // sim core is pure — no DOM needed
    // `vite/` is in here for ONE reason: gym-save-plugin.ts is the only code in this repo that makes an
    // authorization decision, and a decision that nothing can run is a decision nothing can check. It is
    // Node-side middleware, so the node env already suits it. `probe/` stays OUT by design — it is the
    // manual ticks-to-KO balance probe, not a test (see docs/testing-and-e2e.md).
    include: ["src/**/*.test.ts", "vite/**/*.test.ts"],
  },
});
