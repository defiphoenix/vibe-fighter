// `vitest/config` re-exports Vite's defineConfig plus the `test` key — the documented form for a shared
// Vite+Vitest config. NOTE: tsconfig has `include: ["src"]`, so `tsc --noEmit` typechecks NEITHER this file
// NOR vite/gym-save-plugin.ts. What actually exercises them is `vite build` and `vitest run`; a broken
// import fails there, not in the deploy-gating typecheck.
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import { gymSavePlugin } from "./vite/gym-save-plugin";

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
    include: ["src/**/*.test.ts"],
  },
});
