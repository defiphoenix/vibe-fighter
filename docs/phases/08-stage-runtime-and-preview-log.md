# Phase 08 — Stage Runtime & Preview Log (gate result)

**Recorded** 2026-07-18 · `[build/tooling]` · Turned the Phase 04 parallax PNGs into a playable
scrolling stage with a follow-camera, animated props, two config-selectable variants, and a dev
preview scene. Plan and implementation both Codex-reviewed.

## Deliverables

- A world wider than the viewport (`STAGE_WIDTH` 1280 → **1696**), split from the camera/canvas
  width (new **`VIEW_WIDTH` = 1280**). The 416px of slack is the camera's scroll room.
- A stage renderer (`src/render/stage.ts`) that draws four parallax layers at distinct scroll rates,
  with the `near` layer occluding fighters, plus animated roof props from the Phase 07 atlas.
- Stage config `public/configs/stages.json` (twilight + sunset), consumed at runtime.
- A midpoint follow-camera in `MatchScene`, bounded to the world.
- A dev-only `StagePreviewScene` (`?scene=preview`) to pan and switch stages live.
- `scripts/copy-stage-layers.py` (`npm run copy:stages`) — pre-bakes the 3168×1344 authoring layers
  to the 1697×720 runtime size (Pillow LANCZOS, alpha preserved).

### New files
- `src/render/stage.ts`, `src/scenes/StagePreviewScene.ts`
- `public/configs/stages.json`, `public/backgrounds/{twilight,sunset}/{far,medium,main,near}.png` (baked)
- `scripts/copy-stage-layers.py`
- `src/sim/stage.test.ts`, `e2e/stage.spec.ts`

### Modified files
- `src/sim/constants.ts` (world/view split — **the only `src/sim/` change; still Phaser-free**)
- `src/main.ts`, `src/scenes/MatchScene.ts`, `src/scenes/BootScene.ts`, `src/render/hud.ts`
- `package.json` (`copy:stages` script)

## What differed from the recipe / plan

| Plan said | What actually happened |
|---|---|
| Scale layers by height at runtime (`displayHeight=720`) | **Pre-baked** to 1697×720 in the copy step instead — Codex flagged that Phaser's `displayHeight` setter changes only `scaleY` (would squash the layer to 3168px wide). Runtime places at `setScale(1)`; also kills the ~130 MiB raw-texture memory + nearest-neighbour judder. |
| `buildStage` validates prop frame `-0` | Validates **all four** frames of every prop and every layer texture **before creating any object** — Phaser silently skips a missing later anim frame, and mid-build validation would orphan earlier objects on throw. |
| Preview reachable via `?scene=preview` | Preview scene registration **and** routing are `import.meta.env.DEV`-guarded, so it's unreachable (and the routing is dead) in a production build. |
| Plain LANCZOS resize in the bake | **Premultiplied-alpha** resize + residual-fringe flood in `copy-stage-layers.py`. The Phase 04 keyed sources carry a faint magenta edge fringe (~1005 px in `main`) that sits just past the keyer's `KEY_HI=120`; a non-premultiplied resize would also bleed the transparent void colour into edges. The bake now floods the magenta rim inward from the void, stopping at real palette (L1 to void >300), dropping the rendered-frame fringe **108→18 px** with zero change to the dusk/sunset colours. Phase 04 art untouched. |

## Acceptance criteria

### 1. "Layers scroll at distinct rates; near layer occludes fighters." — PASS
`e2e/stage.spec.ts` asserts each layer's `scrollFactorX` matches config (far 0.1 / medium 0.3 /
main 1.0 / near 1.0), `far < main`, and `near` depth (20) > fighter sprite depth. Visual walkthrough
(`e2e/__artifacts__/pcli-match-*.png`) shows the near fence + beacon passing in front of a fighter as
the camera pans.

### 2. "A stage wider than the viewport renders and the camera can pan within bounds." — PASS
Camera `getBounds().width === 1696`, canvas `1280`. Driving both fighters to the left wall pins
`scrollX === 0`; to the right wall pins `scrollX === 416` (exact clamp endpoints, not just "increased").

### 3. "Two stage variants load from config." — PASS
Both `twilight` and `sunset` build without throwing; all 8 layer textures + all 12 prop frames exist.
Preview switch twilight↔sunset↔twilight leaves the scene child count constant (destroy handle works).
Visual: `pcli-preview-sunset.png`.

### 4. "Sim tests still green after any stage-width change." — PASS
28/28 (26 prior + 2 new). Existing corner/wall/restart tests derive bounds from `STAGE_WIDTH` and
auto-tracked to 1696; new `stage.test.ts` pins `VIEW_WIDTH < STAGE_WIDTH` and that a fighter can walk
past one viewport's right edge.

## Visual checklist (primary instrument)

| check | verdict |
|---|---|
| Twilight stage renders all 4 layers (sky, skyline+water tower, roof+HVAC, foreground fence) | ✅ |
| Props animate on the roof (vents/steam/beacon) | ✅ |
| Camera follows fighters; new content scrolls into view walking right | ✅ |
| `near` fence draws in front of fighters | ✅ |
| HUD (bars, timer, pips, help) stays pinned while camera pans | ✅ |
| Sunset variant renders + preview switch is clean (no stacking) | ✅ |

## Codex review — implementation

No blocking findings. Fixed this phase: full-range prop-frame validation + validate-before-build
(Codex #2), DEV-guarded preview scene (#3), delta-based + pre-clamped preview pan (#4), source-size
assertion in the bake script (#5).

## What the gate does NOT cover

- **A fighter can leave the viewport at extreme separation.** Max legal wall-to-wall spacing (~1516px)
  exceeds the 1280 viewport; a single follow-camera without zoom cannot frame both, so a fighter can
  briefly go fully off-screen (~118px past the edge). Midpoint is already the optimal single-camera
  position — the real fix is zoom. **Deferred to Phase 12 (group camera)**, marked `ponytail:` at the
  follow site. Not covered by a test.
- **Occlusion is asserted by depth, not pixels.** The e2e proves `near` depth > fighter depth, not that
  opaque near-layer pixels actually cover a fighter at an overlap point. The visual walkthrough is the
  real evidence here.
- **Wrap seams** — not exercised: at W=1696 no layer tiles (README), so no seam renders. Untouched.

## No-regression check

```
npm run typecheck            -> clean
npm test                     -> 28 passed (3 files)
npx playwright test          -> 8 passed (2 stage + 4 atlas + 2 sprite)
npm run build                -> built (chunk-size warning is the pre-existing Phaser bundle)
python scripts/copy-stage-layers.py --selftest -> OK
```

## Gate status: PASSED

Next: **Phase 09 (character art + state→animation switching)**. Phase 12 inherits the documented
camera-zoom gap.
