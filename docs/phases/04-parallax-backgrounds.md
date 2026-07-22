# Phase 04 — Parallax Backgrounds  `[art]`

**Goal:** Split the chosen stage into layered, transparent parallax PNGs the game can scroll independently.

**Source:** PDF recipe step 5 (`prompts.txt:39-49`); Video Step 3 (04:01).

**Verbatim source prompt:**
> The rooftop-dusk background is the one. Split it into separate PNGs with transparency so they
> can be layered on each other: a far (sky), a medium (buildings), a main (the roof / main
> fighting area), and a near layer (drawn in front of the main area and the fighters). Use
> $imagegen to create each one individually and place them in concepts/backgrounds/rooftop-dusk/.
>
> The main rooftop layer is not end-to-end to the edge of the canvas, so it will tile with gaps
> and look weird. Regenerate it full-width.

**Repo-adapted task:** Generate with the **Higgsfield CLI** (`higgsfield generate create
nano_banana_pro …` — Codex `$imagegen` isn't wired; see the [Phase 03 log](03-concept-mockups-log.md)
for the workflow and gotchas). Match the locked `rooftop-dusk.png` mockup's composition, but the
layers are **background only** (the mockup has fighters in it — the parallax art must not). Generate
four transparent PNG layers (far/medium/main/near) individually; ensure the **main** layer spans full
canvas width so it tiles seamlessly. These are consumed by the stage runtime in
[Phase 08](08-stage-runtime-and-preview.md). Repeat for the second stage variant (sunset) for parity.

**Tool / Skill:** **Higgsfield CLI** for generation; **Codex** (`codex:rescue`) for plan/output review.

**Deliverables:** `far/medium/main/near.png` (transparent) per stage under `concepts/backgrounds/<stage>/`; see [asset-manifest.md](../asset-manifest.md).

**Acceptance criteria:**
- Four independent transparent layers per stage; main layer is full-width (no tiling gaps).
- Layers stack visually into the chosen mockup's composition.
- At least two stages (twilight + sunset) produced for parity.

**Depends on:** [03](03-concept-mockups.md) (locked direction).

**Current-state delta:** **Done** — gate passed 2026-07-17, see
[04-parallax-backgrounds-log.md](04-parallax-backgrounds-log.md). Eight layers across
`concepts/backgrounds/rooftop-dusk/` + `rooftop-sunset/`, all RGBA 3168×1344 (**21:9**, not 16:9 —
Higgsfield's 16:9 leaves Phase 08 only 10px of scroll room). No Higgsfield image model emits alpha,
so layers are painted over a flat `#ff00ff` void and keyed by `npm run key:layers`, which also
asserts the full-width `main`. Phase 08 still owns the `public/` copy, scaling and `stages.json`.
