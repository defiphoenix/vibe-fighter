# Phase 03 — Concept Mockups Log (gate result)

Evidence that Phase 03 passed. Recorded 2026-07-16. Phase 03 is an **`[art]`** phase — no `src/**`
changes. Its deliverables (4 SNES-style mockups + exact prompts + one locked direction) live in
[`concepts/mockups/2026-07-16/`](../../concepts/mockups/2026-07-16/); this log certifies the three
acceptance criteria in [03-concept-mockups.md](03-concept-mockups.md) lines 24–27.

## What differed from the recipe
The recipe names Codex `$imagegen`, which is **not wired** in this repo (`$imagegen` appears only as
prose; Codex CLI has no image generation). Per user decision the **Higgsfield CLI**
(`higgsfield generate create`, model `nano_banana_pro`, `--aspect_ratio 16:9`, 2 credits/image) was
the generator. Provenance corrected in [asset-manifest.md](../asset-manifest.md) line 42.

## Acceptance criteria

### 1. 4 distinct SNES-pixel-art mockups, each recognizably a fighting game — PASS
Four 2752×1536 PNGs, all validated as real non-empty PNGs (`file` magic-byte check), each showing
two fighters squaring off on a distinct stage:

| File | Stage | Verified reads as |
|---|---|---|
| [`dojo.png`](../../concepts/mockups/2026-07-16/dojo.png) | dojo interior | Shaolin monk (left) vs. older navy-gi sensei |
| [`neon-alley.png`](../../concepts/mockups/2026-07-16/neon-alley.png) | rain-slick neon alley at night | Muay Thai kickboxer vs. white-gi jiu-jitsu fighter (right) |
| [`warehouse-docks.png`](../../concepts/mockups/2026-07-16/warehouse-docks.png) | dockside warehouse | hulking wrestler vs. agile female martial artist, harbor cranes/ships behind |
| [`rooftop-dusk.png`](../../concepts/mockups/2026-07-16/rooftop-dusk.png) | rooftop at dusk | street brawler (left, matches Phase 05 spec) vs. bald rival fighter, dusk skyline |

All are SNES 16-bit pixel art with dithering and limited palette — not hi-res comic/3D.

**Revisions (user feedback):** the mockups were iterated with **image-reference edits**
(`--image <mockup>.png`) that hold each scene's composition while upgrading the art. The final pass
raised every fighter to high arcade-sprite detail (warehouse-docks was the quality benchmark) and
enriched all four backgrounds. On this pass the **dojo left fighter was changed from a boxer to a
Shaolin monk and the green boxer was dropped from the roster**. Kept: the neon-alley white-gi
jiu-jitsu fighter (right) and the rooftop brawler (left, per the Phase 05 spec). The `.prompt.txt`
sidecars hold these exact edit prompts.

### 2. Exact prompts saved alongside each image — PASS
Four `.prompt.txt` sidecars, one per PNG, each the single source passed verbatim to `--prompt`
(no separate copy that could drift): `dojo.prompt.txt`, `subway.prompt.txt`,
`warehouse-docks.prompt.txt`, `rooftop-dusk.prompt.txt`.

### 3. One direction explicitly locked — PASS
**rooftop-dusk** is locked. Recorded in the folder
[`README.md`](../../concepts/mockups/2026-07-16/README.md) ("Chosen direction: rooftop-dusk") and in
[asset-manifest.md](../asset-manifest.md) line 42 (status ☐ → ✅). Consistent with Phase 04, which
already hardcodes `concepts/backgrounds/rooftop-dusk/` ([04-parallax-backgrounds.md](04-parallax-backgrounds.md) line 11).

## Downstream consistency (why these 4 stages)
The set mirrors the baseline reference build ([00-baseline-log.md](00-baseline-log.md) lines 41–47)
so later phases' callouts resolve. Phase 05 ([05-character-references.md](05-character-references.md)
lines 9–17) sources three fighters; after user-driven revisions the mapping is:
- **brawler** — `rooftop-dusk.png` (left), matches the Phase 05 spec (spiky brown hair, red cropped
  jacket, red sneakers, fingerless gloves).
- **jiu-jitsu fighter** — `neon-alley.png` (right, white gi). The `subway` mockup named in Phase
  05's verbatim prompt was scrapped and replaced by `neon-alley`, so that line resolves here.
- **green boxer** — **dropped from the roster** on user feedback; the dojo left fighter is now a
  **Shaolin monk**. Phase 05's "green boxer from the dojo mockup" line should source the Shaolin
  monk in `dojo.png` instead.

## No-regression check
Art-only phase — no `src/**` changed, so the green baseline holds by construction. Build/tests
untouched and are not the verifier here; visual inspection of the 4 PNGs is.

## Gate status: PASSED
Four distinct SNES fighting-game mockups produced with exact prompts saved alongside; rooftop-dusk
locked and consistent with the downstream art phases. Proceed to
[Phase 04 — Parallax backgrounds](04-parallax-backgrounds.md).
