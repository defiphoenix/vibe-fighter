# Phase 10 — Fighter Playground  `[tooling]`

**Goal:** A sandbox to test how a fighter feels — move and act on a fixed axis, tune
per-character stats live, and visualise the debug bounds. Optional dev tooling.

**Source:** PDF recipe step 10 (`prompts.txt:102-120`); Video Step 7 (11:59).

**Verbatim source prompt:**
> Add a Playground scene: take the existing fighter and the rooftop-twilight stage and let the
> player move left and right on a fixed axis and perform all their actions.
>
> Make the fighters selectable in the playground and the Character Gym. In the playground, expose
> per-character stats in the debug panel that can be persisted to a config — walk speed, jump,
> gravity, scale — so we can balance each fighter and have it apply in the main game.
>
> While typing in the debug panel, input must not accidentally move or affect the player in the
> game. And after I tweak a value and click on the canvas, keyboard control of the game must come
> back.
>
> Add toggles to visualise all the debug bounds — hit box, attack box, collision — each in a
> different colour, easily toggleable with a toggle-all. For bounds that are only active on
> certain frames, render them faint when inactive but still perceivable, and solid when active.

**Repo-adapted task:** Build a `PlaygroundScene` on the Phase 08 stage. Reuse the existing debug
box overlay (`src/render/boxes.ts`, `B` toggle) and extend it: per-bound colour toggles + toggle-all,
faint-when-inactive/solid-when-active for frame-gated boxes. Expose walk speed / jump / gravity /
scale in a debug panel persisted to `public/configs/character-gym.json` (same file as Phase 09).
Guard focus so typing in the panel doesn't drive the fighter, and clicking the canvas restores control.

**Tool / Skill:** `phaserjs/phaser@game-object-components`, `frontend-design` (debug panel), `find-docs`.

**Deliverables:** `PlaygroundScene`, extended debug-bounds overlay, persisted per-character stats.

**Acceptance criteria:**
- Fighter moves on a fixed axis and performs all actions on the stage.
- Stat edits persist to config and apply in the main match.
- Typing in the panel never moves the fighter; canvas click restores keyboard control.
- Frame-gated boxes render faint (inactive) vs solid (active); per-bound + toggle-all work.

**Depends on:** [08](08-stage-runtime-and-preview.md), [09](09-fighter-registry-gym-config.md).

**Current-state delta:** **Extend** — debug box overlay exists (`boxes.ts`), but there's no Playground scene, no live stat tuning, no active/inactive rendering.
