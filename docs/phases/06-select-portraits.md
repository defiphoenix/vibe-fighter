# Phase 06 — Character-Select Portraits  `[art]`

**Goal:** Create a stylised portrait for each fighter for the big character-select cards.

**Source:** PDF recipe step 7 (`prompts.txt:67-74`); Video Step 8 (14:02).

**Verbatim source prompt:**
> Generate a stylised portrait of each character based on their reference images. Frame the upper
> body to head in distinctive poses suited for characters — these will be used in a character-
> selection screen. $imagegen. Keep the SNES pixel-art style, just higher fidelity for a portrait
> while maintaining the vibe.

**Repo-adapted task:** Generate with the **Higgsfield CLI** (`higgsfield generate create
nano_banana_pro …` — Codex `$imagegen` isn't wired; see the [Phase 03 log](03-concept-mockups-log.md)),
using the Phase 05 references as input (pass them via `--image`). One upper-body portrait per fighter
(brawler, jiu-jitsu, Shaolin monk), higher fidelity but same vibe. Consumed by the character-select
cards in [Phase 11](11-menus-modes-versus-cpu.md) and the HUD portrait base in [Phase 14](14-hud-skin.md).

**Tool / Skill:** **Higgsfield CLI** for generation; **Codex** (`codex:rescue`) for review.

> **`--image` behaviour, measured in Phase 04** (this phase leans on it, so know what it does):
> reference-dominance is *strong* — geometry survives a recolour at IoU 0.99 — which is exactly what
> you want here (keep the character, raise the fidelity). But: (a) the API **JPEG-compresses and
> resizes** the reference before the model sees it (`..._resize.jpg` in the job JSON), so ~1px of
> edge jitter comes back and fine pixel detail in the Phase 05 refs will not survive verbatim;
> (b) the model **invents content in empty areas** rather than leaving them alone — if the portrait
> needs a keyable background, state the flat `#FF00FF` void explicitly and verify it, because on a
> reference-edit it filled up to 47% of a void with scenery it made up; (c) reference-edit jobs fail
> transiently — check `status` in the JSON and just retry.

**Deliverables:** 3 portrait PNGs under `concepts/portraits/<timestamp>/`; see [asset-manifest.md](../asset-manifest.md).

**Acceptance criteria:**
- One distinctive upper-body portrait per fighter, consistent with its reference.
- Higher fidelity than the in-game sprite but recognizably the same character.

**Depends on:** [05](05-character-references.md).

**Current-state delta:** **Done** — gate passed 2026-07-17, see
[06-select-portraits-log.md](06-select-portraits-log.md). Three portraits — `brawler` / `jiujitsu` /
`monk` — in `concepts/portraits/2026-07-17/`, all 1792×2400 (**3:4**, really 0.7467:1), upper body
bleeding off the bottom edge on a **baked** dusk backdrop (nothing to key). Kept 3/3 first try.
The framing/backdrop/bleed decisions were the user's and are recorded in the log; the
**contract Phase 07 must honour** is in the log's downstream section and the
[deliverable README](../../concepts/portraits/2026-07-17/README.md).
