# Prop atlas — authoring art (Phase 07)

The four animated stage props that `public/props/twilight-atlas.png` is packed from.
Locked direction: **rooftop-dusk** (Phase 03), palette sampled from
[`../../backgrounds/rooftop-dusk/main.png`](../../backgrounds/rooftop-dusk/main.png).

**Nothing loads from here.** `concepts/` is authoring art. The runtime files are
`public/props/twilight-atlas.png` + `.json`, written by `npm run build:atlases` — idempotent, re-keyed
and re-packed from the `*-raw.png` masters every run. Change the art, re-run; never hand-edit the JSON.

**Naming:** the deliverable is `twilight-atlas`, the stage art lives in `backgrounds/rooftop-dusk/`.
Same stage — Phases 07/08/11 say "twilight", the mockup and manifest say "dusk"
([backgrounds README](../../backgrounds/README.md)).

## Files

Four props × four frames, `<prop>-0..3`, looping `0→1→2→3→0`. Each frame carries `<id>.prompt.txt`,
`<id>.job.json`, `<id>-raw.png` (**durable provenance, not a temp file**) and `<id>.png` (keyed).

| prop | aspect (label → real) | silhouette | the motion, frame 0 → 3 |
|------|----------------------|------------|------------------------|
| `crowd` | `16:9` → 2752×1536 (1.7917:1) | 2.99:1 bumpy dark band | arms down → head-high → straight overhead → chest-high |
| `vents` | `1:1` → 2048×2048 | 1.03:1 boxy cube, round cap | turbine blades at 12/4/8 → 1/5/9 → 2/6/10 → 3/7/11 o'clock |
| `beacon` | `1:1` → 2048×2048 | 0.35:1 thin vertical needle | lamp dark → ember → full blaze → fading |
| `steam` | `2:3` → 1696×2528 (0.6709:1) | 0.58:1 vertical wisp | stub → column → mushroom cap → torn blobs + gap |

Frame 0 of each prop is generated fresh (`refs=0`); **frames 1–3 are `--image`-chained from frame 0**,
never from the previous frame, so drift cannot compound.

## The contract Phase 08 must honour

- **Anchor is bottom-center**: `this.add.sprite(x, y, "twilight-atlas", "vents-0").setOrigin(0.5, 1)`.
  Props sit *on* the roof; this is the same feet-anchor convention as
  [`sprite-schema.md`](../../../public/configs/sprite-schema.md).
- **`beacon`'s mast runs off the bottom edge by design.** The cut *is* the roofline — bottom-anchor it
  and the mast base lands at the placement point. The gate allows a bottom clip for exactly this
  reason and fails a top/left/right clip, which would silently lose art.
- **Cells are per-prop, not uniform** — that is why this is an atlas and not a spritesheet. All four
  frames of one prop share a single union crop, so they stay registered against each other.
- **The 4 frames are designed to loop**, so `frameRate` is a free visual choice (12 is a sane start);
  nothing in the sim reads it.

## Regenerating

```bash
higgsfield generate create nano_banana_pro --prompt "$(cat vents-0.prompt.txt)" \
  --aspect_ratio 1:1 --resolution 2k --wait --json > vents-0.job.json
# chained frames add: --image vents-0-raw.png    (and carry refs=1, which the gate checks)
# result_url from the JSON -> vents-0-raw.png, then: npm run build:atlases
```

Redirect **stdout only** — `2>&1` merges the CLI's `Error:` line into the JSON and corrupts it.
If you change the shared block you must regenerate **all 16**: the gate requires it byte-identical
across every prop prompt. Fixes belong in the per-frame head.

## Gotchas worth knowing before touching these

- **Never ask for translucency over a chroma void.** This cost 12 credits. The first steam and beacon
  heads asked for a "soft translucent cloud" and a "wide soft halo" — while the shared STYLE block
  those same prompts carry says "flat blocks of colour, hard cel edges, no airbrush gradient". That is
  a self-contradiction, and CLAUDE.md's rule is that the model resolves one by **maximising**: it drew
  glows so large they ran off the canvas (`beacon-2` put **906 px — 44% of the canvas width — on the
  top row**; `steam-1` 438 px) and dragged the void's colour into the art. It is also the one thing a
  chroma key physically cannot do: a translucent pixel over magenta is indistinguishable from the
  void. The fix is **opaque, solid colour, hard cel edges**, which is what the style block wanted all
  along.
- **A palette list does not forbid a colour; naming it does.** The block lists the allowed dusk ramp,
  and `beacon-3` still came back with a glow that is **1.725% pink and survives the key** (it sits
  beyond `KEY_HI`, so it is real art, not a keying artifact). Same shape as the Phase 05 flag patch: a
  generic clause failed twice, naming the thing explicitly worked. The heads now say "never pink,
  never magenta, never purple".
- **Chaining from frame 0 really does hold position.** Measured, not hoped: `vents` moves
  `d_bbox (0,0,0,0)` and `<1px` of centroid across all four frames — only the blades turn. `crowd`,
  `steam` and `beacon` all keep their bottom edge within 3px. But this is *not* free registration —
  the API JPEG-ises and resizes every `--image` reference, so the numbers are **measured and reported
  by the gate, never enforced**. No threshold could be honest: a plume is *supposed* to change shape,
  so nothing in the pixels separates "the plume grew" from "the vent slid".
- **Count the blades before designing the loop.** `vents` is a **3-blade** turbine on purpose: 3 blades
  give 120° symmetry, so four frames at 30° steps are all distinct and frame 3 → frame 0 is seamless.
  A 4-blade turbine has 90° symmetry — the fourth frame would be identical to the first, i.e. one
  credit for nothing.
- **The model drew the vent from a downward camera** even though the shared block asks for eye level.
  Checked against the locked stage rather than assumed to be wrong: `rooftop-dusk/main.png` draws its
  roof deck as a receding plane seen from slightly above, so the vent **matches the stage**. Not a
  defect; not regenerated.
- **The void is not perfectly flat, and "any alpha > 0" is a wrong bbox.** Every gen keys to a handful
  of stray dither specks (`crowd-3`: 68 px). Taking the crop over `alpha > 0` reads them as art and
  returns the whole canvas. The crop uses connected components ≥256 px instead, and reports what it
  dropped — Phase 05's speck problem in a new place.

See also [`../../backgrounds/README.md`](../../backgrounds/README.md) for the stage-side gotchas and
the sampled dusk palette these prompts quote.
