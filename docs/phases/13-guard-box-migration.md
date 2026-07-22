# Phase 13 — Guard-Box Migration (Per-Frame)  `[build]`

**Goal:** Make high/low blocking emerge from **per-frame** box geometry, not from labels — the
decision rule already exists, but guard boxes must move from character-level data to per-frame
data and sync with block animations. **This is a migrate/extend, not a validate.**

**Source:** PDF recipe step 13 (`prompts.txt:156-165`).

**Verbatim source prompt:**
> Let's model blocking with geometry, not height labels. Give block animations a `guard` box. A
> hit is BLOCKED when the attacker's hitbox overlaps the defender's guard box; high vs low is just
> where the boxes sit. Resolve a hit as two independent checks: (1) geometry — did the hitbox
> overlap the hurtbox at all, else it whiffs; and (2) guard — was the right stance up, else it
> connects. And pipe the gym's saved boxes into live combat so tuning a box in the gym changes the
> match.

**Repo-adapted task:** The two-check resolution is **already implemented** in `src/sim/combat.ts`
(overlap-then-guard) — do **not** rebuild it. What's missing:
- `FrameBoxes` in `src/sim/types.ts` carries only hurt/push/hit; guard boxes are
  **character-level arrays** (standing/crouch), not per-frame. Migrate `guard` into `FrameBoxes`
  so it can vary by animation frame and sync to block animations.
- Update `fighter.ts` `activeBoxes()` and the config/JSON (Phase 09) to source per-frame guards.
- Pipe Gym-saved guard boxes into live combat (same JSON path as Phase 09).
- Keep the existing geometric-block tests green and add frame-transition/facing/crouch cases.

**Tool / Skill:** `superpowers:test-driven-development` (the block tests in `combat.test.ts` are the safety net).

**Deliverables:** per-frame `guard` in `FrameBoxes`, updated `activeBoxes()`, JSON guard authoring, new tests.

**Acceptance criteria:**
- Guard boxes vary per animation frame and sync with block anims.
- Existing block tests pass: high light blocked standing, low heavy beats stand guard, crouch blocks low.
- New tests cover guard active only on block frames + facing/crouch transitions.
- Editing a guard box in JSON/Gym changes block outcomes in a match.

**Depends on:** [09](09-fighter-registry-gym-config.md), [12](12-core-combat-camera-integration.md).

**Current-state delta:** **Extend** — decision rule Present (`combat.ts`); per-frame guard data + block-anim sync Missing (`types.ts` `FrameBoxes` has no guard).
