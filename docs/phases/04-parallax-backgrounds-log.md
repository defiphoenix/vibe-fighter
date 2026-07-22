# Phase 04 — Parallax Backgrounds Log (gate result)

Evidence that Phase 04 passed. Recorded 2026-07-17. Phase 04 is an **`[art]`** phase — no `src/**`
changes. Deliverables live in [`concepts/backgrounds/`](../../concepts/backgrounds/): eight layer
PNGs across two stages, each with its exact prompt, its generator job record, its pre-key raw, and a
composited preview. This certifies the 3 acceptance criteria in
[04-parallax-backgrounds.md](04-parallax-backgrounds.md) lines 28–31.

Two new files outside `concepts/`: [`scripts/key-layers.py`](../../scripts/key-layers.py) (the
chroma-key + validator) and a `key:layers` line in `package.json`.

## What differed from the recipe

| Recipe says | What actually happened |
|---|---|
| Use Codex `$imagegen` | **Not wired** — re-verified: `codex-cli 0.144.1` has no image subcommand (same finding as [03-concept-mockups-log.md:9](03-concept-mockups-log.md)). Generated with the **Higgsfield CLI**, `nano_banana_pro`. |
| "Split it into separate PNGs **with transparency**" | **No Higgsfield image model can emit alpha.** All 30 image job types inspected via `higgsfield model get`: `gpt_image_2` exposes only `aspect_ratio/prompt/quality/resolution/image_references` (OpenAI's native `background:"transparent"` is not plumbed through); `nano_banana_flash`, `flux_2`, `seedream_v5_pro`, `z_image` have no alpha param; `recraft_v4_1` has `background_color` but its constraint reads *"#RRGGBB … **no alpha**"*. So every layer is painted over a flat `#FF00FF` void and keyed locally. This matches the processing the manifest already chose for the Phase 07 prop atlas ([asset-manifest.md:51](../asset-manifest.md)). |
| (implied) match the mockup's 16:9 canvas | **21:9 instead.** Higgsfield's `16:9` returns 2752×1536 = 1.7917:1, which at the sim's 720 height is 1290×720 — **10px of scroll room** against the 1280 viewport. [Phase 08](08-stage-runtime-and-preview.md) requires a world wider than the viewport, so 16:9 masters would have forced an art regen inside the build phase. `21:9` → 3168×1344 → **1697×720**, **+417px**. |

Alternative generators were closed by evidence, not assumption: ChatGPT was tried with the real
`medium` prompt and produced a different, more modern pixel style at 1536×1024 (3:2 → 1080×720 at sim
height, i.e. **narrower than the screen**); `recraft_v4_1` has no `image_references` param at all, so
it could not have done the sunset reference-edit, and caps at 16:9.

## Acceptance criteria

### 1. Four independent transparent layers per stage; main layer is full-width — PASS

`npm run key:layers` reopens and asserts every emitted file (structural checks mirroring
[`gen-placeholder-sheet.mjs:122-152`](../../scripts/gen-placeholder-sheet.mjs), not just content
heuristics). Exit 0.

| Stage | Layers | Mode | Dimensions | Transparent (final) |
|---|---|---|---|---|
| rooftop-dusk | far / medium / main / near | all RGBA | all 3168×1344 | 0.00% / 47.03% / 59.29% / 87.42% |
| rooftop-sunset | far / medium / main / near | all RGBA | all 3168×1344 | 0.00% / 47.03% / 59.37% / 87.54% |

`far` is asserted **uniformly opaque** — it is backmost, so transparency there would show the
`#10131a` clear colour. The other three are asserted to retain both transparency and opaque art.

**Magenta leakage is checked end-to-end, not by construction.** Asserting "no near-void pixel
survived" *on a keyed layer* is vacuous — `alpha>128` implies the key distance was already >80, so it
cannot fire. The real question is whether any magenta is **visible once the four layers are
stacked**, which the composite answers without reference to how alpha was computed: **0 magenta px**
in both stacks.

A partial run cannot report success: the script hard-fails if any stage's raws are missing (verified:
exit 1). Re-running is idempotent — all 18 outputs reproduce byte-identical.

**Full-width `main`** is the spec's verbatim complaint (*"not end-to-end to the edge of the canvas,
so it will tile with gaps … Regenerate it full-width"*), so it is machine-checked rather than
eyeballed: every column below the feet line (y=1157) must be ≥90% opaque. Measured **weakest column
= 100.0% opaque**, both stages. No gaps to tile.

### 2. Layers stack visually into the chosen mockup's composition — PASS

Evidence is stored, not just asserted:
[rooftop-dusk/_mockup-comparison.png](../../concepts/backgrounds/rooftop-dusk/_mockup-comparison.png)
is the locked mockup above the composited stack, with the real sim fighter box (`HURT_STAND` 60×185)
drawn at both `STAGE_MARGIN` corners and centre. Previews:
[dusk](../../concepts/backgrounds/rooftop-dusk/_preview.png),
[sunset](../../concepts/backgrounds/rooftop-sunset/_preview.png).

Every element of the locked direction is present and in the right order: orange-to-purple dusk sky,
silhouetted skyscrapers with lit windows, a hero rooftop water tower, satellite dish, TV antenna,
HVAC units, chain-link fence, cracked concrete floor — background only, no fighters.

Band structure now lands on the mockup's:

| Band | Mockup | Phase 04 stack |
|---|---|---|
| Skyline top edge | ~47% | **49.9%** |
| Roof floor top edge | ~75% | **74.6%** |
| Sky palette distance | — | **74** (was 214) |
| HVAC height vs a fighter | ~0.5× | **~0.5×** |

**Three rejections, each driven by a measurement:**

1. **`far` read as purple night, not warm dusk.** At 40% height it was `#A7478F` against the mockup's
   `#FD9146` — it never reached orange at all. Regenerated against the mockup's **sampled hex ramp**
   instead of a verbal description: palette distance **214 → 74**.
2. **Props were ~1.8× oversized relative to fighters.** Fresh gens have no scale anchor when the
   prompt forbids figures (the Phase 03 gotcha, in a new costume). Fixed by anchoring to the sim:
   *"a grown adult on this roof is one quarter of the image height; the AC units are waist-high on
   them; the water tower is twice their height."* HVAC now matches the mockup's ratio.
3. **`main` was a solid wall from 60.9%, burying the skyline.** The mockup shows buildings down to
   ~75%; the stack showed a 12% sliver, because `main` occluded `medium`.

**The third one is the reusable lesson.** Three prompt rewrites asking for a thinner floor band
(22%→39%, 8%→40%) moved it *not at all* — the percentage was never the problem. The model was drawing
a camera **angled down** at the roof, which makes the floor a deep receding plane no matter what
fraction you ask for. One sentence fixed it:

> *the camera sits LOW, at the height of a fighter standing on the roof, looking flat ACROSS the
> rooftop at eye level — NOT looking down at it … the floor is FORESHORTENED into a THIN horizontal
> band … Do NOT tilt the camera down.*

Floor top **60.9% → 74.3%** in a single generation. When a diffusion model ignores a dimension three
times, the instruction is probably naming the wrong variable — describe the **camera**, not the
percentage.

### 3. At least two stages (twilight + sunset) produced for parity — PASS

"Twilight" (Phases 07/08/11) and "dusk" (mockup, manifest) are the same stage; the alias is mapped in
[concepts/backgrounds/README.md](../../concepts/backgrounds/README.md) so Phase 08 does not have to
guess. `rooftop-sunset` is a reference-edit recolour of the dusk raws — same rooftop, different time
of day, matching `prompts.txt:125` (*"Level selection -> [rooftop twilight, rooftop sunset]"*).

The recolour preserving geometry was treated as an assumption to be measured, not trusted:

| Layer | Raw IoU vs dusk | Added (clamped away) | Interior loss (max 0.5%) |
|---|---|---|---|
| **medium** | **0.678** | **47.50%** | 0.000% |
| main | 0.982 | 1.34% | 0.057% |
| near | 0.925 | 6.77% | 0.156% |

**The drift check fired on every layer**, and it caught a real defect: told to recolour only, the
model **paints the magenta void full of scenery it invents**. On `medium` it filled essentially the
whole void (+47.5%); on an earlier `main` it invented a distant skyline along the roofline (raw IoU
0.881, +13.3%). It reads the scene and completes it, no matter how emphatically the prompt says the
magenta is a key.

Interior loss is ~0 in every case: the model **adds**, it does not redraw. Since the two stages are
*required* to share geometry, `align_to_reference()` clamps the edited alpha to the reference's
(`np.minimum`, so the reference's own soft matte edges survive rather than being thresholded away).
Raw pre-alignment IoU stays printed so the drift is visible rather than papered over.

**Loss is gated on the reference's *interior*, and that distinction is load-bearing.** A first cut
gated on raw mask loss and reported `near` at 1.21% — apparently a failure. Investigation: **88.1% of
that loss sits within 1px of a dusk edge**. The Higgsfield API JPEG-compresses and resizes a
reference image, and `near` is chain-link mesh whose perimeter dwarfs its area, so 1px of edge wobble
scores over 1% of "geometry" while being pure resampling noise. Only 734px (0.14%) was genuine
interior redraw. Gating the interior measures what the check actually claims to measure — *did the
model redraw the art* — instead of penalising a mesh for having a long perimeter.

## Downstream consistency (what Phase 08 is handed)

- **Geometry contract is vertical and normalized** (feet line `620/720 = 0.861111`), so it survives
  any horizontal scaling. Scale to **height** (1344→720); scaling to width would move the feet line
  off `GROUND_Y` and fighters would float or sink.
- **Parallax reach table** and **measured wrap-seam deltas** are in the README. `medium` at f=0.3
  needs 2048px for a 3840 world and only has 1697 — it must tile or drop to f≤0.16. `main`/`near`
  scroll at ≥1.0 and must tile regardless; `main` is verified gapless, which is what makes that safe.
- **Seams are reported, not enforced.** The spec asks for full-width, not seam-perfect, and diffusion
  does not give a seamless wrap for free. Phase 08 owns the `public/` copy, scaling and `stages.json`.

## No-regression check

Art-only phase — no `src/**` changed, so the green baseline holds by construction. Run anyway
because `package.json` gained a script: `npx tsc --noEmit` → **No errors found**; `npx vitest run` →
**PASS (26) FAIL (0)**.

Per [03-concept-mockups-log.md:60-62](03-concept-mockups-log.md), typecheck/tests **are not the
verifier for an art gate** — visual inspection plus `scripts/key-layers.py`'s assertions are.

## Gate status: PASSED

Eight transparent layers across two stages; `main` verified gapless full-width at 100%; `near`
covers 11% of a standing fighter; both stages hold to the same geometry to within 0.16% interior
drift; zero magenta visible in either stack.

Defects caught and fixed rather than shipped — each by a measurement, none by eye:

| Defect | Caught by | Before → after |
|---|---|---|
| Sky read as purple night, not the mockup's warm dusk | Sampling the mockup's hex ramp | palette distance 214 → 74 |
| Foreground buried the fighters | Pixel coverage over the real `HURT_STAND` box | 76.8% → 11.0% occluded |
| `main` was a solid wall hiding the skyline | Band structure vs the mockup | floor top 60.9% → 74.6% (mockup ~75%) |
| Props oversized relative to fighters | HVAC height ÷ `HURT_STAND` | ~0.9× → ~0.5× (mockup ~0.5×) |
| Recolour invented scenery in the void | Mask IoU vs dusk | up to +47.5% added → clamped away |

**Two measurement bugs were themselves caught and fixed** (Codex output review) — worth recording,
because a wrong metric is more dangerous than no metric:

- The first occlusion metric took the topmost opaque pixel per column and reported 98%. It scores a
  90%-open chain-link mesh as a solid wall. Real pixel coverage was 76.8%. The `near` redesign only
  became visible once the metric was right.
- The first loss gate divided by canvas area while its own message claimed "% of the reference's
  geometry". It let `sunset/near` pass at what was really 1.21%. Fixed, then re-diagnosed: the honest
  figure is interior loss (0.156%), because the raw figure was 88% edge-resampling noise.

Vacuous checks were removed rather than left as decoration: the magenta-residue assert (couldn't fire
by construction) is now an end-to-end check on the composited stack, and `near`'s occlusion — which
the mask *guarantees* — is now reported as a property while the assertions cover what the mask
cannot guarantee (that a real, full-width strip survived it).

Codex's output review initially judged criterion 2 **not closed** (prop scale, roof depth, the water
tower demoted from hero prop to distant silhouette). That call was correct, and the deviation was
**fixed rather than accepted**: `main` and `medium` were regenerated with a sim-derived scale anchor
and the camera clause above, which closed the band structure to within ~2% of the mockup on both
edges. Proceed to [Phase 05 — Character References](05-character-references.md).
