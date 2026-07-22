# Phase 08 — Stage Runtime & Preview  `[build/tooling]`

**Goal:** Turn the parallax layer PNGs into a **playable** scrolling stage with correct layer
order, parallax factors, foreground occlusion, tiling, and world/camera bounds — plus an
optional Stage Preview scene to tune it. **This phase exists because generated background images
are not a runtime stage, and the sim currently models a fixed single screen.**

**Source:** Derived from README ("group camera that scrolls a wide stage") + PDF step 5 layers +
PDF step 12 camera. Stage Preview is listed as member-only dev tooling in the public README.

**Verbatim source prompt:** *(none — derived phase.)*

**Repo-adapted task:**
- Build a stage renderer that draws far/medium/main/near layers with per-layer parallax factors;
  the **near** layer draws in front of fighters (occlusion).
- Define world width > viewport and camera/world bounds so the group camera (Phase 12) can scroll.
  Note: `src/sim/constants.ts` fixes a single 1280×720 screen — extend the sim's stage width and
  keep the render adapter reading it (preserve the `sim/`-is-pure rule).
  **Read [`concepts/backgrounds/README.md`](../../concepts/backgrounds/README.md) § *Recommended
  Phase 08 config* before picking numbers.** Phase 04 measured the art and worked the arithmetic out:
  `STAGE_WIDTH = 1696` (= the layers' 1697px width at game scale) means **no layer ever tiles**, so
  the measured wrap seams never render. It also flags two traps — `STAGE_WIDTH` currently doubles as
  the Phaser canvas width (`main.ts:8`), so raising it without adding a separate `VIEW_WIDTH` leaves
  nothing to scroll; and the HUD is screen-space but reads the world constant, so the timer and P2's
  health bar drift off-screen the moment world ≠ viewport.
- Support two variants (twilight, sunset) selectable by stage config.
- (Optional tooling) A `StagePreviewScene` to pan/tune parallax factors live.

**Tool / Skill:** `phaserjs/phaser@game-setup-and-config`, `find-docs` (Phaser 4 camera/tilesprite API), `superpowers:test-driven-development` (for sim stage-width changes).

**Deliverables:** a stage runtime module + stage config (`public/configs/stages.json`), optional preview scene.

**Acceptance criteria:**
- Layers scroll at distinct rates; near layer occludes fighters.
- A stage wider than the viewport renders and the camera can pan within bounds.
- Two stage variants load from config.
- Sim tests still green after any stage-width change.

**Depends on:** [04](04-parallax-backgrounds.md), [07](07-ui-prop-atlases.md) (props).

**Current-state delta:** **Missing** — flat single-screen background in `MatchScene.ts`; no parallax, no camera scroll.
