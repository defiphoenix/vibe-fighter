# Phase 12 — Core Combat, Camera & Integration  `[build]`

**Goal:** Make hits land from the authored boxes, ensure best-of-3 rounds + round timer + correct
z-order/facing, add a **group camera** that scrolls a wide stage, and load per-character combat
config. Much of the combat core already exists in the sim — this phase is a **capability delta**,
not a rebuild.

**Source:** PDF recipe step 12 (`prompts.txt:139-154`); Video Step 9 "Core combat loop" (14:55).

**Verbatim source prompt:**
> How do we deal with z-ordering of the sprites? Right now P1 is perpetually behind P2. Is it
> whoever moves most recently is drawn in front? And when the players are on the other side of
> each other, their sprites + colliders should flip to face the other way.
>
> Now let's implement the core of the game: taking damage, hit detection, knockdown. We should
> have some configurability per character — e.g. attack low and attack high can differ — written
> to config and adjustable. Let's have 3 rounds before the match goes game over, then it's rematch
> or main menu.
>
> How do Street-Fighter-like games deal with scrolling on stages larger than the viewport — the
> camera stays locked until one of them gives way, right? Add that. And add a round timer.

**Repo-adapted task:** Per-requirement delta (build only what's Missing/Extend):

| Requirement | State | Action |
|-------------|-------|--------|
| Hit detection / damage / knockdown | **Present** (`combat.ts`, `fighter.ts`) | Validate against sprite frames |
| Best-of-3 rounds + rematch/menu | **Present** (`match.ts`) | Wire rematch/menu buttons in render |
| Round timer (60s) | **Present** (`match.ts`, `constants.ts`) | Surface in HUD (Phase 14) |
| Z-order (recent mover in front) + facing flip | **Present** (world facing/depth) | Bind sprite depth + flip to sim facing |
| Per-character combat config (high/low differ) | **Missing** | Load from `character-gym.json` (Phase 09) |
| Group camera scrolling wide stage | **Missing** | Add camera that holds until a fighter gives ground (needs Phase 08) |
| Sprite-frame ↔ sim-frame sync | **Missing** | Map animation frame to active-box frame |

**Tool / Skill:** `superpowers:test-driven-development` (extend `combat.test.ts`), `find-docs` (Phaser 4 camera), `phaserjs/phaser@game-object-components`.

**Deliverables:** group camera, sprite depth/flip bound to sim, config-driven per-character combat, rematch/menu wiring.

**Acceptance criteria:**
- Recent mover draws in front; sprites + boxes flip on crossover (extend `regression.test.ts`).
- Camera holds centred until a fighter gives ground on a stage wider than the viewport.
- Per-character high/low attack differences come from config, not hardcode.
- Best-of-3 + timer expiry resolve rounds (existing tests stay green).

**Depends on:** [08](08-stage-runtime-and-preview.md), [09](09-fighter-registry-gym-config.md), [11](11-menus-modes-versus-cpu.md).

**Current-state delta:** **Extend** — damage/rounds/timer/z-order/facing Present; group camera, config-driven combat, and frame-sync Missing.
