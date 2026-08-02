# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Vibe Fighter** — a local two-player Street Fighter–style game. Vite + TypeScript + Phaser 4 (`^4.2.1`).
The gameplay is a deterministic 60 Hz simulation; Phaser is only a rendering/input adapter on top of it.
Rendering uses **default LINEAR antialiasing — no `pixelArt`** — because the art is photographic
(video-derived sprites + painted backgrounds).

Art direction is **rooftop-dusk**, locked in Phase 03. Roster is **brawler / jiujitsu / monk** — those ids
are canonical from `concepts/characters/` through to `public/sprites/<id>/`.

Built in phases. **Phases 00–21 are shipped**, including the fix passes between them. **Phases 22 (CPU
strength) and 23 (CPU lock discipline + the Phase 22 QA remediation) are written and green but NOT
deployed.** Phase 23 ran the independent QA Phase 22 never had; its verdict was "do not deploy" and it
found two blockers, so read [`docs/phases/23-cpu-lock-discipline.md`](docs/phases/23-cpu-lock-discipline.md)
before [`22-cpu-strength.md`](docs/phases/22-cpu-strength.md), which now carries inline corrections.
Two known limitations are measured and deliberately unfixed there: a masher sweeps every tier (frame
data, out of scope), and the anti-air branch is inert in match play. Specs and gate results are in
[`docs/phases/`](docs/phases/) and the narrative is [`docs/history.md`](docs/history.md).
`prompts.pdf` holds the original spec.

## Commands

```bash
npm run dev        # Vite dev server (hot reload)
npm run build      # BOTH typechecks (browser + tooling), then vite build
npm run typecheck  # tsc --noEmit — the BROWSER program (src/) only
npm run typecheck:tooling  # tsc -p tsconfig.tooling.json — vite.config.ts + vite/, Node types
npm test           # vitest run — `include` is src/**/*.test.ts + vite/**/*.test.ts, node env
npm run test:e2e   # Playwright browser acceptance for the render layer (e2e/, headed)
npm run preview    # serve the BUILT bundle — the only place the production CSP is testable
```

Run one test file: `npx vitest run src/sim/combat.test.ts` · filter by name: `npx vitest run -t "corner"` ·
watch: `npx vitest` (no `run`). One e2e file: `npx playwright test e2e/phase16-parity.spec.ts`; by name:
`-g "timeout"`.

Asset, art and audio scripts — none run in CI or on Vercel, and all but `--pad` need the gitignored
`concepts/` masters:

```bash
npm run build:sprites    # pack raw frames -> public/sprites/<id>/<state>.png
npm run check:sprites    # gate: cell size, frame count, feet-anchored, height, NO-PURPLE hue, MOTION_MIN
npm run check:sync       # gate: measured CONTACT frame vs render.sheets.<state>.hit; --write records it
npm run audit:boxes      # HARD GATE: hurt height, hit band, and horizontal reach gap vs the art
npm run audit:anim       # roster-wide animation REPORT (advisory, always exit 0)
npm run gen:placeholder  # 19 states x 3 fighters of placeholders — WITHOUT `-- --state <name>` this
                         # OVERWRITES the real art
npm run build:audio      # masters -> public/audio/*.mp3
npm run check:audio      # HARD gate: per-cue duration/peak/crest/bytes, 1.2 MB budget, worst-case mix
npm run key:layers       # re-key + validate the Phase 04 parallax layers
npm run copy:stages      # pre-bake keyed layers to runtime 1697x720 into public/backgrounds
npm run copy:portraits   # Phase 06 masters -> select cards at 448x600 AND hud/<id>.png at 192x294
npm run build:atlases    # key + measure + pack the Phase 07 UI/prop atlases into public/
npm run check:characters # validate the Phase 05 character refs
npm run check:portraits  # validate the Phase 06 select portraits
python scripts/build-atlases.py --pad       # ONLY the Phase 19 touch pad: procedural, runs on a fresh clone
bash scripts/gen-audio.sh                   # regenerate audio masters (SPENDS CREDITS)
python scripts/art_gate.py                  # the shared art gate's own fixtures
python scripts/build-audio.py --selftest    # the audio gate's own fixtures
python scripts/build-atlases.py --selftest  # the atlas gate's fixtures, without needing the art
```

Rebuild order, gate internals and the `art_gate.py` chaining live in
[`docs/art-pipeline.md`](docs/art-pipeline.md#the-build-and-gate-scripts). Python deps: `requirements.txt`.

## Where everything is documented

Read the relevant one before editing that area — each holds reasoning you cannot recover from the code.

| File | What it is |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | the sim/render boundary, consolidated |
| [`docs/sim-invariants.md`](docs/sim-invariants.md) | tick order, boxes, attacks, meter, CPU, rounds — read before touching `src/sim/` |
| [`docs/render-notes.md`](docs/render-notes.md) | Phaser adapter: cameras, viewport, HUD, touch, audio, tint, timing |
| [`docs/testing-and-e2e.md`](docs/testing-and-e2e.md) | vitest rules, the Playwright pump harness, tooling gotchas |
| [`docs/lessons.md`](docs/lessons.md) | the measurement rules, the worked defects behind them, and Balance |
| [`docs/art-pipeline.md`](docs/art-pipeline.md) | generating sprites/backgrounds/audio, and what it costs to get wrong |
| [`docs/history.md`](docs/history.md) | what shipped when, including the fix passes between phases |
| [`docs/PRD.md`](docs/PRD.md) | the product spec the phases were cut from |
| [`docs/traceability.md`](docs/traceability.md) | PRD requirement → phase → test mapping |
| [`docs/asset-manifest.md`](docs/asset-manifest.md) | provenance/licensing for everything under `public/` |
| [`docs/skills-map.md`](docs/skills-map.md) | which Claude skill each phase expects |
| [`docs/phases/`](docs/phases/) | per-phase spec + gate log |
| [`docs/reviews/`](docs/reviews/) | cross-phase senior/QA review write-ups |

Layout is discoverable — `world.ts` owns the sim, `fighter.ts` is one fighter, `MatchScene.ts` is the
bridge. The docs above deliberately contain only what opening the file will not tell you.

## The rules that must not be broken

- **`src/sim/` is pure and imports NO Phaser**, and is deterministic — no `Date.now`, no `Math.random`.
  That is why vitest runs it in the `node` environment. Everything else follows from this.
- **All boxes are fighter-local**: `+x` = forward (facing), `+y` = up from the feet. Timing is in **ticks**
  (integers at 60 Hz), never wall-clock seconds; space is in pixels.
- **`world.ts` `tick()`'s numbered step order is authoritative** — the tests encode ordering guarantees
  inside it (clamp-before-measure; no clock tick on a hitstop frame).
- **Measure the claim against the thing it claims about.** A test comparing code to other code cannot see a
  box that disagrees with its sprite, an animation that outlives its move, or an absolute stat compared
  across fighters who do not share a scale. Rules and worked cases:
  [`docs/lessons.md`](docs/lessons.md#the-rules-distilled).
- **A regression test you haven't watched FAIL is decoration.** Re-introduce the bug, confirm red, restore
  — including for a test you wrote five minutes ago in good faith.
- **A push to `main` IS a production deploy.** See below.
- **`convert` on PATH is Windows NTFS `convert.exe`, not ImageMagick** — never call it.

TypeScript is strict with `noUnusedLocals`/`noUnusedParameters`/`noImplicitReturns` — an unused import or
param fails the build. There are **two programs, deliberately**: `tsconfig.json` is the BROWSER one
(`include: ["src"]`, `types: ["vite/client"]`, no Node globals — so a `node:fs` import cannot drift into
shipped code), and [`tsconfig.tooling.json`](tsconfig.tooling.json) covers `vite.config.ts` + `vite/` with
`types: ["node"]`. `npm run build` chains both, so a type error in either fails the deploy gate.
Before the security pass those tooling files were typechecked by **nothing**; that was tolerable while
`vite/` held plumbing and stopped being tolerable once `gym-save-plugin.ts` owned an authorization
decision.

Comments tagged `ponytail:` mark deliberate simplifications with their upgrade path. Intent markers, not
TODO noise.

## Assets

`public/` is the Vite static root: `sprites/<id>/<state>.png` (per-state sheets, 320×256 cells),
`configs/character-gym.json` (fighter registry, each `{ render, data }`), `ui/portraits/<id>.png` (448×600
— **downscale from the Phase 06 masters, never regenerate**), `ui/portraits/hud/<id>.png` (192×294, the
HUD's own bake), plus `ui/` `props/` `backgrounds/` `audio/`. Schema in
[`public/configs/sprite-schema.md`](public/configs/sprite-schema.md); provenance in
[`docs/asset-manifest.md`](docs/asset-manifest.md). `tsconfig` has `resolveJsonModule` so sim tests import
the registry JSON directly.

`concepts/` is **authoring** art, not shipped — nothing loads from there. Read
[`concepts/backgrounds/README.md`](concepts/backgrounds/README.md) for the full stage geometry contract and
the worked `STAGE_WIDTH = 1696` config. **`.gitignore` excludes `concepts/**/*.png|gif`**, so 483 MB of art
authoring exists ONLY on this machine — a deleted sprite source is not recoverable from git, only
re-generatable at credit cost. The prompts and `*.job.json` records ARE committed.

## Deploying (GitHub + Vercel)

GitHub `roiizchak/vibe-fighter` (**private**) → Vercel project `vibe-fighter` (org
`rois-projects-f9d9895d`), wired by Vercel's git integration. Live at
**https://vibe-fighter-dusky.vercel.app**.

- **A push to `main` IS a production deploy.** No staging step, no approval gate. Commit and push normally,
  but **say what you are deploying** — a push is a release, not a save.
- Still in force: **do not make the repo public and do not announce or share the game anywhere until the
  user says it's finished.**
- Vercel runs **`npm run build`** on Node 24.x, output `dist/`. **A red typecheck fails the deploy**, so
  `npm run build` green locally is the pre-push check that matters — remembering it does not cover
  `vite.config.ts` or `vite/`. Python art scripts never run there; only what's committed under `public/`
  ships.
- `vercel --prod` deploys the working directory manually (skipping anything `.gitignore`d) — useful to test
  a change without pushing. `vercel logs <url>` / `vercel inspect <url>` debug a deployment;
  `vercel rollback <url>` reverts one.
- **Prod is a real build, so `import.meta.env.DEV` is false**: `?scene=gym|playground|preview` do not exist
  there (BootScene routes to `Flow`), and `window.__game`/`__world`/`__flow` are absent. Any e2e/debug seam
  you add is dev-only by construction; don't reach for one to diagnose production. Two exceptions are
  deliberate: **`?touch=1|0` and `?diag=1` are NOT dev-gated**, because device classification cannot be
  reproduced from this machine — reach for `?diag=1` first on any "it doesn't work on my phone" report.
- **A Vercel PREVIEW deploy can't gate a CSP** — Deployment Protection 302s every route to SSO. Mirror
  `vercel.json` onto `vite preview.headers` instead.
