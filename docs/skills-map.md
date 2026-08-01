# Skills Map

Which skill/tool builds each phase. Three tiers:
- **In this repo** — the 28 Phaser 4 skills, committed under [`.claude/skills/`](../.claude/skills/).
  They travel with a clone; nothing to install.
- **Installed here** — available in this environment but NOT in the repo (invoke directly).
- **Ecosystem** — discovered via `npx skills find`; install with the command shown.

Skills discovered on [skills.sh](https://skills.sh/) on 2026-07-15 via `/find-skills`.

## By capability

### 1. Architecture / planning (Phase 01, 16 gates)
- **Installed:** `superpowers:brainstorming`, `superpowers:writing-plans`, `superpowers:verification-before-completion`.
- Use brainstorming before any creative phase; writing-plans to turn a phase into a task list.

### 2. TypeScript + Phaser 4 build (Phases 08–15)
- **Installed:** `superpowers:test-driven-development` (the sim is TDD-first — keep it that way), `find-docs` (Phaser 4 API lookups).
- **Phaser skills — official `phaserjs/phaser` ONLY** (swapped in 2026-07-18; the unofficial Phaser 3
  skills `gamedev-skills@phaser-core`, `@phaser-arcade-physics`, and `opusgamelabs@phaser` were
  removed — wrong major version for a `phaser: ^4.2.1` project). **All 28 now live in
  [`.claude/skills/`](../.claude/skills/) and are committed** — invoke by bare name (`animations`,
  `cameras`, …), no install step. See "Install status" for what that changed.
  The ones the phases actually lean on:
  - `game-setup-and-config` · `game-object-components` · `sprites-and-images` (the original three)
  - `animations` ← Phase 09 state→animation switching
  - `scenes` · `loading-assets` · `cameras` (core/bootstrap)
  - `tweens` · `input-keyboard-mouse-touch` · `text-and-bitmaptext`
  - `v4-new-features` (guards against v3 idioms; Beam renderer/new APIs) · `v3-to-v4-migration`
  - `audio-and-sound` (Phase 20) · `scale-and-responsive` (Phases 12/18/19 viewport work)
  - `physics-arcade` / `physics-matter` are present for completeness only — the sim is custom and
    Phaser-free, so engine physics is not used.

### 3. Frontend / UI — menus, character select, HUD (Phases 11, 14)
- **Installed:** `frontend-design`, `ui-ux-pro-max`, `impeccable`, `motion-design` (match-start entrance, lock-in flash).
- These target web UIs; for in-canvas Phaser UI, use them for layout/visual-hierarchy guidance and pair with the Phaser skills above.

### 4. AI image / sprite generation for art (Phases 02–07)
- **Chosen:** **Higgsfield CLI**, model `nano_banana_pro` — `higgsfield generate create nano_banana_pro --prompt "…" --aspect_ratio 21:9 --wait --json`. Carry each art phase's verbatim prompt and save it beside the PNG with its `*.job.json`.
  - ⚠️ **Codex `$imagegen` was the original choice and is NOT usable** — re-verified in Phase 04: `codex-cli 0.144.1` has no image-generation subcommand at all. It appears in the PDF recipe as prose only. Phases 03 and 04 both generated with Higgsfield instead.
  - Read `phase-03-done` + `phase-04-done` in the memory index before any art phase — the generator gotchas (no model emits alpha; aspect labels lie; `--image` invents scenery in a chroma void; describe the camera not the percentage; anchor scale to a person) each cost credits to discover.
  - Chroma-keying is a solved problem here: reuse [`scripts/key-layers.py`](../scripts/key-layers.py) (`npm run key:layers`) rather than writing a new keyer.
- **Ecosystem (sprite/animation alternatives):**
  - `npx skills add spritecook/skills@spritecook-generate-sprites` (493 installs)
  - `npx skills add dkyazzentwatwa/chatgpt-skills@sprite-sheet-generator`
  - `npx skills add phaserjs/phaser@sprites-and-images` (loading/atlas side)
  - `npx skills add jwynia/agent-skills@godot-asset-generator` (general asset gen)
  - Original tool: **Spriterrific** (https://aiod.dev/c5h) — the creator's animation tool; not required if using Codex + the free asset pack.
- **Also installed here:** `design` / `banner-design` / higgsfield MCP `generate_image` — alternative front-ends to the same Higgsfield backend. The CLI is what Phases 03/04 actually used; prefer it for reproducibility (it writes a `*.job.json` provenance record).

### 5. Browser end-to-end / acceptance testing (Phase 16, and per-phase smoke tests)
- **Installed:** `playwright-cli` (the DEV `window.__world` hook in `MatchScene.ts` already anticipates Playwright), `superpowers:test-driven-development`.
- **Ecosystem:** `npx skills add bobmatnyc/claude-mpm-skills@playwright-e2e-testing` (2.7K installs) · `npx skills add fugazi/test-automation-skills-agents@playwright-e2e-testing`.

### 6. Phaser 4 API documentation lookup (all build phases)
- **Installed:** `find-docs` (use for Phaser 4 API, config, migration questions — do not rely on training data for API details).

## Per-phase quick reference

| Phase | Primary skill(s) |
|-------|------------------|
| 00 Source research | `watch`, `find-docs` |
| 01 Architecture | `superpowers:brainstorming`, `superpowers:writing-plans` |
| 02 Asset pipeline | `sprites-and-images`, `loading-assets`, `find-docs` |
| 03–07 Art gen | **Higgsfield CLI** (`nano_banana_pro`) + `scripts/key-layers.py` for chroma; **Codex** (`codex:rescue`) for plan/output review only — it cannot generate images |
| 08 Stage runtime | `game-setup-and-config`, `find-docs` |
| 09 Character art / state→anim | `animations`, `game-object-components`, `superpowers:test-driven-development` |
| 10 Playground | `game-object-components`, `input-keyboard-mouse-touch`, `frontend-design` |
| 11 Menus/modes/CPU | `frontend-design`, `ui-ux-pro-max`, `motion-design`, `scenes` |
| 12 Core combat/camera | `cameras`, `scale-and-responsive`, `superpowers:test-driven-development`, `find-docs` |
| 13 Guard migration | `superpowers:test-driven-development` |
| 14 HUD skin | `text-and-bitmaptext`, `tweens`, `frontend-design`, `motion-design` |
| 15 Specials/meter | `tweens`, `audio-and-sound`, `superpowers:test-driven-development` |
| 16 Integration/QA | `playwright-cli`, `superpowers:verification-before-completion` |

The Phaser names above are bare because they resolve from [`.claude/skills/`](../.claude/skills/) in
this repo — the `phaserjs/phaser@…` install form they used to carry no longer applies.

## Install status

Everything except the Phaser skills still lives in the global store: `~/.agents/skills/`, activated
into Claude Code under `~/.claude/skills/` (lock: `~/.agents/.skill-lock.json`).
Skills CLI = `npx skills add|remove|list`.

**Phaser 4 — all 28, IN THIS REPO under [`.claude/skills/`](../.claude/skills/) (moved 2026-08-01):**

Previously global (`~/.agents/skills/`, symlinked into `~/.claude/skills/`), which meant a fresh clone
had none of them and nothing pinned their version. They were **moved, not copied** — the global
folders, the `~/.claude/skills/` symlinks, and the 28 `phaserjs/phaser` entries in
`.skill-lock.json` are all gone, so each name resolves to exactly one copy. The full set, matching
`phaserjs/phaser@master` 1:1:

```
actions-and-utilities  animations             audio-and-sound        cameras
curves-and-paths       data-manager           events-system          filters-and-postfx
game-object-components game-setup-and-config  geometry-and-math      graphics-and-shapes
groups-and-containers  input-keyboard-mouse-touch                    loading-assets
particles              physics-arcade         physics-matter         render-textures
scale-and-responsive   scenes                 sprites-and-images     text-and-bitmaptext
tilemaps               time-and-timers        tweens                 v3-to-v4-migration
v4-new-features
```

Eight also carry a `references/REFERENCE.md`: `cameras`, `game-object-components`,
`input-keyboard-mouse-touch`, `loading-assets`, `particles`, `scenes`, `sprites-and-images`,
`v4-new-features`.

**To refresh them**, do NOT `npx skills add` — that would reinstate the global copy and give you two
skills with the same name. Pull the directory from `phaserjs/phaser@master` and overwrite
`.claude/skills/<name>/` in place, then commit.

- ❌ Removed 2026-07-18 (Phaser 3, wrong major): `opusgamelabs/game-creator@phaser`,
  `gamedev-skills/awesome-gamedev-agent-skills@phaser-core`, `@phaser-arcade-physics`.

**Art/sprite gen (kept — but real art path is Higgsfield CLI, see §4):**
- ✅ `spritecook/skills@spritecook-generate-sprites`
- ✅ `omer-metin/skills-for-antigravity@pixel-art-sprites`
- ✅ `eachlabs/skills@game-asset-generation`

**E2E testing:**
- ✅ `fugazi/test-automation-skills-agents@playwright-e2e-testing`
- ✅ `asyrafhussin/agent-skills@e2e-playwright-testing`

The **installed here** tier remains active in this environment. Official Phaser skills are not a
plugin/marketplace — no auto-update either way; the repo copy is now the pinned version, refreshed
only by overwriting `.claude/skills/<name>/` as described above.
