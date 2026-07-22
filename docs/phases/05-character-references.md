# Phase 05 — Character References  `[art]`

**Goal:** Pull a clean, full-body fighter reference out of each mockup — the source art the
animation spritesheets are made from. Three fighters for full parity.

**Source:** PDF recipe step 6 (`prompts.txt:50-65`); Video Step 4 (05:09).

**Verbatim source prompt:**
> Create a clean full-body reference image for an original SNES-era pixel-art fighting-game
> character inspired by the left fighter in the rooftop mockup: an athletic young street brawler,
> spiky brown hair, red cropped jacket over a light shirt, dark pants, red sneakers, fingerless
> gloves, confident martial-arts stance. Isolated full-body, 3/4 side-facing fighting stance,
> centered with generous padding, no stage, no HUD, no opponent. Original character only, no
> logos, no text. Save to concepts/characters/<timestamp>/ with its prompt.
>
> Using sub-agents, generate two more character references with $imagegen: the green boxer from
> the dojo mockup, and the jiu-jitsu fighter on the right from the subway mockup. Same SNES style,
> isolated full-body. Save them under concepts/characters/<timestamp>/ with both the draft and
> final prompts.

**Repo-adapted task:** Generate with the **Higgsfield CLI** (`higgsfield generate create
nano_banana_pro …` — Codex `$imagegen` isn't wired; see the [Phase 03 log](03-concept-mockups-log.md)).
Produce 3 isolated full-body references, each centered with generous padding, no stage/HUD/opponent.
These feed the spritesheet generation in [Phase 02](02-asset-provenance-and-pipeline.md)/[09](09-fighter-registry-gym-config.md).

> **Source mapping (Phase 03 roster changed — the verbatim prompt above is stale):** the three
> fighters are **brawler** = left fighter in [`rooftop-dusk.png`](../../concepts/mockups/2026-07-16/rooftop-dusk.png);
> **jiu-jitsu** = right white-gi fighter in [`neon-alley.png`](../../concepts/mockups/2026-07-16/neon-alley.png)
> (the "subway mockup" was scrapped for neon-alley); **Shaolin monk** = left fighter in
> [`dojo.png`](../../concepts/mockups/2026-07-16/dojo.png) (the "green boxer" was dropped from the
> roster). See the [Phase 03 log](03-concept-mockups-log.md) downstream-consistency section.

**Tool / Skill:** **Higgsfield CLI** for generation; **Codex** (`codex:rescue`) for review.

**Deliverables:** 3 reference PNGs + draft & final prompts under `concepts/characters/<timestamp>/`.

**Acceptance criteria:**
- 3 distinct, isolated full-body references, consistent SNES style.
- No stage, HUD, opponent, logos, or text; generous padding (crop-safe for sheet extraction).
- Prompts saved alongside each.

**Depends on:** [03](03-concept-mockups.md).

**Current-state delta:** **Done** — gate passed 2026-07-17, see
[05-character-references-log.md](05-character-references-log.md). Three references —
`brawler` / `jiujitsu` / `monk` — in `concepts/characters/2026-07-17/`, all 1792×2400 (**3:4**,
really 0.7467:1 — the label lies), each on a nominally `#ff00ff` void. **Not keyed**: the manifest
specifies `Processing = none (reference)` and Phase 09 owns the alpha sheets — which must key by
**tolerance, not `== #ff00ff`** (only 0.004% of pixels are exactly magenta; the void sits at
~`(252,1,252)`). Saved the **final
prompt only**, not the draft-and-final the prompt above asks for — Phase 03 ruled a second copy a
drift risk, and each `job.json`'s `params.prompt` is an independent record the gate asserts against.
`npm run check:characters` is the gate. The refs carry **design, not scale**: Phase 09 hand-authors
boxes against `HURT_STAND.h` = 185 and must not scale from them.

Two fighters being one duplicated archetype in `src/sim/config.ts` is unchanged — that is Phase 09's
registry work, not this `[art]` phase's.
