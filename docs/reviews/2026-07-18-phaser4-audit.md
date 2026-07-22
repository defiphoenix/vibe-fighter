# Phaser 4 Audit & Modernization — 2026-07-18

Cross-cutting audit of the render adapter (`src/scenes/`, `src/render/`, `src/main.ts`), build
config, and docs against the official `phaserjs/phaser` Phaser 4 skills. Not a numbered phase.

## Headline

The render adapter was already correct and idiomatic Phaser 4 — **no deprecated-API usage and no
render correctness bugs.** Verified sound: numeric-depth sort (fighters 9/11, near 20, debug 50,
HUD 100/101), `setScrollFactor(0)` on all screen-space HUD, two-phase fail-fast boot
(`FILE_LOAD_ERROR` + `textures.exists()` sweep), idempotent `anims.exists()`-guarded creation,
`anims.pause()`/`resume()` on hitstop, stage texture/atlas-frame validation before object creation,
feet-anchored origin `(0.5,1)` + `setFlipX(facing<0)`, keyboard via `addKey(KeyCodes.*)` + `isDown`
with manual rising-edge.

### Phaser 4.2 features — honest scope

Most 4.2 additions do not fit a two-fighter baked-art game and were **not** adopted:
`SpriteGPULayer` / `TilemapGPULayer`, `Noise` / `Gradient` game objects, the Filters system, the
`Lighting` component. The one applicable feature — camera `shake`/`flash` for hit feedback — was
adopted (A1).

## Changes shipped

| # | Type | Change | Files |
|---|---|---|---|
| F1 | FIX | Removed `pixelArt: true`. The art is photographic (video-derived sprites + painted backgrounds), not pixel art; `pixelArt` forced NEAREST filtering (`setFilter(1)`) which shimmers under `Scale.FIT`. Default LINEAR (`scaleMode=0`) is correct. | `src/main.ts`; assertion in `e2e/phase09-characters.spec.ts` |
| A1 | ADD | Camera shake on `hit` / flash + forced shake on `ko`, driven off the previously-unused `world.drainEvents()` hook. Aggregates each drained batch to one effect (KO wins via if/else). Both shakes pass `force=true` so a shake started in an *earlier* update — still running, since its window spans several frames — is restarted rather than dropped by `Shake.start`'s `if (!force && isRunning)` guard. (Within a single batch the KO branch already precludes a hit shake, so the override matters cross-tick, not same-batch.) Render-only; sim untouched. | `src/scenes/MatchScene.ts`; new `e2e/camera-juice.spec.ts` |
| I1 | IMPROVE | Raised the `phaser` floor `^4.1.0` → `^4.2.1` (minimum-floor bump, i.e. `>=4.2.1 <5.0.0`; not a pin). Regenerated `package-lock.json` (root range was still `^4.1.0`). | `package.json`, `package-lock.json` |
| D1–D6 | DOC | Fixed stale statements: CLAUDE.md MatchScene bullet (fighter-B-as-box, `__aSprite`/`__boxFills` → `__sprites`, "VFX unused" → used); backgrounds README "two traps" (resolved in Phase 08); architecture.md gap table (Phase 08 scrolling + Phase 09 registry shipped); skills-map/CLAUDE version strings → `^4.2.1`. `sprite-schema.md` placeholder note verified already-correct (no edit). Phase gate logs left intact (historical record). | `CLAUDE.md`, `docs/architecture.md`, `docs/skills-map.md`, `concepts/backgrounds/README.md` |

## Constraints honored

This pass changed no file under `src/sim/**` (the sim only produces the `hit`/`ko` events A1 reads),
and the current source preserves the sim/render boundary and `tick()` step order; no `git push`/PR;
gamepad support declined this pass. (History/remote state isn't independently verifiable here — the
repo's `.git` is an empty directory, as CLAUDE.md notes — so this is a present-state claim.)

## Filter-mode note (Phaser 4 gotcha)

Phaser 4 `ScaleModes`: **`LINEAR = 0` (default), `NEAREST = 1`** — reversed from Phaser 3's naming
intuition. `pixelArt`/`antialias:false` calls `TextureSource.setFilter(1)`; without it, sources
keep the default `scaleMode = 0`. The F1 e2e assertion checks `source[0].scaleMode === 0`.
