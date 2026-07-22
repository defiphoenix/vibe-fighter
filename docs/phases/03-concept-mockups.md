# Phase 03 — Concept Mockups  `[art]`

**Goal:** Create the visual target for the whole game — four SNES-style mockups that read as a
Street Fighter–type game — then lock one art direction.

**Source:** PDF recipe step 4 (`prompts.txt:26-37`); Video Step 2 (03:16).

**Verbatim source prompt:**
> $imagegen — create 4 concept mockups for this 2D fighting game. Place the art in
> concepts/mockups/<timestamp>/ and save the exact prompts you used alongside them.
>
> Focus on art style and overall feel — nothing too complex, this is a technical demo. They should
> be easily recognisable as a Street Fighter type game, leaning SNES pixel art rather than high-
> resolution comic style. 4 different versions.

**Repo-adapted task:** Delegate image generation to **Codex `$imagegen`** (per user). Carry the
prompt verbatim. Save outputs + exact prompts under `concepts/mockups/<timestamp>/`. Review the
4 and pick one direction (the reference build chose a rooftop-dusk stage) — record the choice.

**Tool / Skill:** **Codex `$imagegen`** via `codex:rescue`. Fallback: `design` skill / higgsfield `generate_image`.

**Deliverables:** 4 mockup PNGs + prompt sidecars in `concepts/mockups/<timestamp>/`; a one-line "chosen direction" note.

**Acceptance criteria:**
- 4 distinct SNES-pixel-art mockups exist, each recognizably a fighting game.
- Exact prompts saved alongside each image.
- One direction is explicitly locked (drives Phases 04–07).

**Depends on:** [01](01-architecture-and-delta-plan.md). (Can run just-in-time.)

**Current-state delta:** **Missing** — no art of any kind in the repo.
