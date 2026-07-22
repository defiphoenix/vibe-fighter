# Phase 03 — Concept Mockups (2026-07-16)

Four SNES-style concept mockups for Vibe Fighter. Each reads as a Street Fighter II–type
2D fighting stage: two fighters squaring off, parallax background, no HUD.

## Chosen direction: **rooftop-dusk**

`rooftop-dusk.png` is the locked art direction — it drives Phases 04–07 (Phase 04 renders its
parallax layers into `concepts/backgrounds/rooftop-dusk/`).

## Files

| Mockup | Stage | Notable fighter (sourced later in Phase 05) |
|--------|-------|---------------------------------------------|
| `dojo.png` | Japanese dojo interior | **Shaolin monk** (left) vs. older sensei |
| `neon-alley.png` | Rain-slick neon alley at night | **jiu-jitsu gi fighter** (right) |
| `warehouse-docks.png` | Dockside warehouse at the waterfront | wrestler vs. female martial artist |
| `rooftop-dusk.png` ★ | City rooftop at dusk | **street brawler** (left) — ★ chosen |

Each `.png` has a matching `.prompt.txt` holding the **exact** prompt passed to the generator.

**Note for Phase 05 (source mapping):**
- The **rooftop-dusk brawler (left)** matches Phase 05's brawler spec (spiky brown hair, red cropped
  jacket, red sneakers, fingerless gloves) — its primary source.
- The **jiu-jitsu fighter source is `neon-alley.png` (right)**. The `subway` mockup was scrapped and
  replaced by `neon-alley`, so Phase 05's verbatim line "the jiu-jitsu fighter on the right from the
  **subway** mockup" resolves to **neon-alley.png**.
- The **green boxer was dropped** on user feedback — the dojo left fighter is now a **Shaolin monk**.
  Phase 05's verbatim line "the green boxer from the **dojo** mockup" should source the **Shaolin
  monk in `dojo.png`** instead (green boxer is no longer in the roster).

## Generation

- **Tool:** Higgsfield CLI (`higgsfield generate create`), model `nano_banana_pro`.
- **Params:** `--aspect_ratio 16:9`, resolution 2k → 2752×1536 PNG. ~2 credits/image.
- **Revisions:** the mockups were iterated to raise fighter/background quality. Note: image-
  reference edits (`--image <mockup>.png`) barely change the fighters because `nano_banana_pro` has
  no reference-strength knob, so the reference dominates the prompt. `neon-alley` and `rooftop-dusk`
  were therefore regenerated **fresh (no reference)** with rich prompts to reach the target
  fighter detail; `dojo` (Shaolin monk swap) and `warehouse-docks` (kept fighters, richer bg) came
  from reference edits. Sidecars hold the exact final prompt used per image.

## Verbatim source prompt (PDF recipe step 4 / `docs/phases/03-concept-mockups.md:9-14`)

> $imagegen — create 4 concept mockups for this 2D fighting game. Place the art in
> concepts/mockups/<timestamp>/ and save the exact prompts you used alongside them.
>
> Focus on art style and overall feel — nothing too complex, this is a technical demo. They should
> be easily recognisable as a Street Fighter type game, leaning SNES pixel art rather than high-
> resolution comic style. 4 different versions.

`$imagegen` is not wired in this repo; per project decision the Higgsfield CLI stood in as the
generator. The per-stage prompts (in the `.prompt.txt` sidecars) expand this brief with a shared
SNES-pixel-art style spine plus stage- and fighter-specific detail.
