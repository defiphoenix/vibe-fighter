"""Chroma-keys the Phase 04 parallax layers and validates them against the sim's geometry.

The generator (Higgsfield `nano_banana_pro`) cannot emit alpha -- no image job type it exposes has a
transparency param, so every layer is painted over a flat #FF00FF void and keyed here instead.

Reads  concepts/backgrounds/<stage>/<layer>-raw.png   (opaque, magenta void)
Writes concepts/backgrounds/<stage>/<layer>.png       (RGBA)
       concepts/backgrounds/<stage>/_preview.png      (the four layers composited)

Run: `npm run key:layers` (or `python scripts/key-layers.py`). Idempotent -- re-keys from the raws
every time, so a rerun reproduces byte-identical outputs. Exits non-zero on any failed assertion.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BACKGROUNDS = ROOT / "concepts" / "backgrounds"

STAGES = ["rooftop-dusk", "rooftop-sunset"]  # STAGES[1] is a reference-edit recolour of STAGES[0]
LAYERS = ["far", "medium", "main", "near"]
KEYED = ["medium", "main", "near"]  # far is the backmost layer -- nothing shows behind it

KEY_RGB = np.array([255, 0, 255])  # the void colour every layer prompt asks for

# ponytail: fixed thresholds, not a tuned knob. Measured on the probe, the void sits at std 1.6 with
# 99.93% of pixels within 30 of pure magenta, while the nearest real art colour is ~324 away (sunset
# orange) / ~358 (dusk purple) -- a ~3x margin either side of HI. That the void is tight is not
# trusted, it is asserted in `key()`: a gen that paints a gradient fails loudly rather than
# mis-keying silently.
KEY_LO = 40.0  # L1 distance below which a pixel is fully void
KEY_HI = 120.0  # ...and above which it is fully art. Between the two: soft matte.
VOID_PREFILTER = 200.0  # generous "might be void" radius -- flatness is judged over ALL of this,
VOID_SPREAD_MAX = 60.0  # ...not just over pixels already inside KEY_LO, which would self-select.
DESPILL_MIN_ALPHA = 0.05  # below this a pixel is invisible; unpremultiplying it just amplifies noise

# A recoloured stage must not redraw the reference's art. Edge jitter is not a redraw: the API
# JPEG-compresses and resizes the reference, and `near` is chain-link mesh whose perimeter dwarfs its
# area, so 1px of edge wobble scores ~1.2% of "geometry" while being pure resampling noise (measured:
# 88.1% of near's loss sits within 1px of a dusk edge). So the gate counts loss in the reference's
# INTERIOR only, which is what "the model redrew the art" actually looks like.
INTERIOR_LOSS_MAX = 0.005  # max of the reference's interior a recoloured stage may drop

GROUND_ANCHOR = 620 / 720  # src/sim/constants.ts: GROUND_Y / STAGE_HEIGHT -- the feet line
FIGHTER_FRAC = 185 / 720  # src/sim/config.ts: HURT_STAND.h -- a standing fighter's height

# `near` draws in front of the fighters. Its opaque top edge sits at NEAR_TOP_FRAC of the canvas
# height; because feet are the sprite's bottom-most pixels (at GROUND_ANCHOR), any top edge ABOVE the
# feet line covers the feet. So the lever is a signed clearance measured from the feet line, in units
# of a fighter's height:
#   ponytail: positive -> top edge sits BELOW the feet line (feet fully visible, near is a pure
#   foreground ground strip); zero -> top edge exactly at the feet line; negative -> top edge above
#   the feet line, occluding the ankles for a depth cue (the old behaviour, which buried the feet).
#   Single lever; the sign chooses reveal-vs-occlude. Feet-clearance is asserted in validate().
NEAR_FEET_CLEARANCE = 0.04  # ~7px below the feet line at 720p -- feet clear, thin foreground strip
NEAR_TOP_FRAC = GROUND_ANCHOR + NEAR_FEET_CLEARANCE * FIGHTER_FRAC

# ponytail: nano_banana_pro will not draw a thin foreground strip -- its prior for "foreground
# clutter" is a solid bottom third and it does not budge. Asked for the bottom 12% it drew 40%;
# reworded emphatically for the bottom 5% ("a sliver", "one twentieth", "only the bottom row") it
# drew 32%, burying 75% of a standing fighter. Each retry cost credits and moved the line ~7%, so the
# strip is generated at whatever height the model likes and the excess is masked off here instead.
# The cut lands on the parapet, whose own top edge is already a flat horizontal line across the full
# width, so it reads as a lower ledge rather than a slice. Upgrade path: if a future model honours
# the band spec, drop the mask in `key_stage`.


def l1(rgb: np.ndarray, ref: np.ndarray) -> np.ndarray:
    """Per-pixel L1 distance to a reference colour. int16 -> int64 promotion, so no overflow."""
    return np.abs(rgb.astype(np.int16) - ref).sum(2).astype(np.float32)


def interior(mask: np.ndarray) -> np.ndarray:
    """Pixels of `mask` whose whole 3x3 neighbourhood is also `mask` (a 1px erosion)."""
    H, W = mask.shape
    pad = np.pad(mask, 1, constant_values=False)
    out = np.ones_like(mask)
    for dy in range(3):
        for dx in range(3):
            out &= pad[dy : dy + H, dx : dx + W]
    return out


def key(rgb: np.ndarray, name: str) -> np.ndarray:
    """Flat-void chroma key -> float alpha in [0,1]. Soft matte between KEY_LO and KEY_HI."""
    d = l1(rgb, KEY_RGB)

    maybe_void = d < VOID_PREFILTER
    if not (d < KEY_LO).any():
        raise AssertionError(f"{name}: no #FF00FF void found -- did the gen paint a background?")
    # Judged over the whole generous radius, so a gradient cannot hide behind a small pure patch.
    spread = float(rgb[maybe_void].astype(np.float32).std(0).sum())
    assert spread <= VOID_SPREAD_MAX, (
        f"{name}: void is not flat (L1 std {spread:.1f} > {VOID_SPREAD_MAX}); the generator painted "
        "a gradient, not a void -- regenerate or key by hand"
    )
    return np.clip((d - KEY_LO) / (KEY_HI - KEY_LO), 0.0, 1.0)


def despill(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Recover the true art colour on soft-matte edge pixels.

    A partly-transparent pixel is approximately `alpha*art + (1-alpha)*key`, so the art colour is
    `(observed - (1-alpha)*key) / alpha`. Attenuating toward green instead (the obvious cheap trick)
    only *reduces* the magenta -- it leaves every edge pixel still biased toward the key, which is
    exactly the halo this is meant to remove. Fully-opaque pixels are untouched, so the genuine
    purples in the dusk palette and reds in sunset are never drained.
    """
    out = rgb.astype(np.float32)
    edge = (alpha > DESPILL_MIN_ALPHA) & (alpha < 1.0)
    if not edge.any():
        return out.astype(np.uint8)
    a = alpha[edge][:, None]
    out[edge] = np.clip((out[edge] - (1.0 - a) * KEY_RGB) / a, 0, 255)
    return out.astype(np.uint8)


def seam_delta(rgba: np.ndarray) -> float:
    """Mean per-pixel difference between the left and right edge columns.

    ponytail: measured and reported, never enforced. The acceptance criterion is that `main` be
    full-width so it tiles without *gaps*; a seamless *wrap* is not something diffusion gives for
    free. Phase 08 decides what to do with the number when it wires the TileSprite scroll.
    """
    return float(np.abs(rgba[:, 0].astype(np.int16) - rgba[:, -1].astype(np.int16)).mean())


def key_stage(stage: str) -> None:
    d = BACKGROUNDS / stage
    for layer in LAYERS:
        rgb = np.asarray(Image.open(d / f"{layer}-raw.png").convert("RGB"))
        if layer in KEYED:
            a = key(rgb, f"{stage}/{layer}")
            rgb = despill(rgb, a)
            if layer == "near":
                a[: int(round(NEAR_TOP_FRAC * a.shape[0]))] = 0.0  # see NEAR_TOP_FRAC note above
            alpha = (a * 255).round().astype(np.uint8)
        else:
            alpha = np.full(rgb.shape[:2], 255, np.uint8)
        Image.fromarray(np.dstack([rgb, alpha]), "RGBA").save(d / f"{layer}.png")


def align_to_reference(ref: str, edited: str) -> list[str]:
    """Hold a reference-edited stage to its source's geometry, and prove it is entitled to.

    `rooftop-sunset` is a reference-edit recolour of `rooftop-dusk`: the palette moves, the geometry
    must not. Two things can go wrong and they are not equally recoverable.

    ADDITION (edit opaque where the reference is void) means the model painted into the magenta. It
    does this reliably: told to recolour only, it invented a distant skyline along `main`'s roofline
    (+6.4% of canvas, raw IoU 0.881) because it reads the scene and completes it. Those are exactly
    the pixels the reference calls void, so clamping the edit's alpha to the reference's removes them
    and nothing else. `minimum` is used rather than a binary intersect so the reference's own soft
    matte edges survive instead of being thresholded away.

    LOSS (reference opaque where the edit is not) would mean the model genuinely redrew a silhouette.
    Nothing here can reconstruct that, so it fails -- see INTERIOR_LOSS_MAX for why it is measured on
    the interior rather than the raw mask.

    ponytail: clamp rather than re-roll the generator. The stages are *required* to share geometry,
    so enforcing it beats paying for retries and hoping. Raw pre-alignment numbers stay reported so
    the drift is visible rather than papered over.
    """
    out = []
    for layer in KEYED:
        pr, pe = BACKGROUNDS / ref / f"{layer}.png", BACKGROUNDS / edited / f"{layer}.png"
        ra = np.asarray(Image.open(pr))[..., 3]
        img = np.asarray(Image.open(pe)).copy()
        ea = img[..., 3]

        mr, me = ra > 128, ea > 128
        iou = float((mr & me).sum()) / float((mr | me).sum())
        added = float((me & ~mr).sum()) / float(mr.sum())
        core = interior(mr)
        lost_i = float((core & ~me).sum()) / float(core.sum())

        assert lost_i <= INTERIOR_LOSS_MAX, (
            f"{edited}/{layer}.png: dropped {lost_i:.2%} of {ref}'s interior geometry (max "
            f"{INTERIOR_LOSS_MAX:.1%}) -- the recolour redrew the art, it did not just repaint it. "
            "Not patchable here; regenerate this layer."
        )

        img[..., 3] = np.minimum(ea, ra)  # additions -> void, per the reference; soft edges survive
        Image.fromarray(img, "RGBA").save(pe)
        out.append(
            f"  {layer}: raw IoU {iou:.3f} vs {ref} | added {added:.2%} (clamped away) | "
            f"interior loss {lost_i:.3%} (max {INTERIOR_LOSS_MAX:.1%})"
        )
    return out


def composite(stage: str) -> Image.Image:
    d = BACKGROUNDS / stage
    base = Image.open(d / "far.png").convert("RGBA")
    for layer in LAYERS[1:]:
        base.alpha_composite(Image.open(d / f"{layer}.png").convert("RGBA"))
    out = base.convert("RGB")
    out.save(d / "_preview.png")
    return out


def validate(stage: str) -> list[str]:
    """Reopen every emitted file and assert it, mirroring gen-placeholder-sheet.mjs's self-check."""
    d = BACKGROUNDS / stage
    out: list[str] = []
    imgs = {}
    for layer in LAYERS:
        p = d / f"{layer}.png"
        assert p.exists(), f"{stage}: missing {layer}.png"
        im = Image.open(p)
        im.load()  # force decode -- a truncated PNG must fail here, not downstream
        assert im.mode == "RGBA", f"{stage}/{layer}.png: mode {im.mode}, expected RGBA"
        imgs[layer] = np.asarray(im)

    sizes = {l: (a.shape[1], a.shape[0]) for l, a in imgs.items()}
    assert len(set(sizes.values())) == 1, f"{stage}: layers disagree on size: {sizes}"
    W, H = next(iter(sizes.values()))
    out.append(f"  {stage}: 4 layers, all RGBA, all {W}x{H}")

    # far is backmost: any transparency there shows main.ts's #10131a clear colour.
    assert (imgs["far"][..., 3] == 255).all(), f"{stage}/far.png: has transparency, must be opaque"
    for layer in KEYED:
        alpha = imgs[layer][..., 3]
        assert (alpha == 0).mean() > 0.01, f"{stage}/{layer}.png: no transparency -- key failed?"
        assert (alpha == 255).mean() > 0.01, f"{stage}/{layer}.png: no opaque art left"

    # `main` must span the canvas edge to edge. This is the machine-checkable form of the spec's
    # verbatim complaint: "The main rooftop layer is not end-to-end to the edge of the canvas, so it
    # will tile with gaps and look weird. Regenerate it full-width."
    feet = int(round(GROUND_ANCHOR * H))
    per_col = (imgs["main"][feet:, :, 3] > 128).mean(0)
    worst = float(per_col.min())
    assert worst >= 0.99, (
        f"{stage}/main.png: floor gaps below the feet line -- weakest column only {worst:.1%} "
        f"opaque ({int((per_col < 0.99).sum())} of {W} columns). Regenerate full-width."
    )
    out.append(f"  {stage}: main floor full-width (weakest column {worst:.1%} opaque, feet y={feet})")

    # `near` draws in front of the fighters. Its coverage is a *property of NEAR_TOP_FRAC*, not a
    # test (the mask guarantees it), so it is reported, not asserted. What IS asserted is what the
    # mask cannot guarantee: that a real, full-width strip actually survived it.
    head = int(round((GROUND_ANCHOR - FIGHTER_FRAC) * H))
    na = imgs["near"][..., 3]
    cover = float((na[head:feet, :] > 128).mean())
    # The feet must be uncovered: `near` may not have any opaque pixel at or above the feet line, or
    # it buries the standing fighter's feet (the whole point of NEAR_FEET_CLEARANCE >= 0). This is the
    # machine gate that replaces "eyeball the screenshot".
    assert (na[:feet, :] == 0).all(), (
        f"{stage}/near.png: {int((na[:feet, :] > 0).sum())} opaque px at/above the feet line "
        f"(y={feet}) -- near is covering the fighters' feet. Raise NEAR_FEET_CLEARANCE (must be >= 0)."
    )
    strip_cols = (na[int(round(NEAR_TOP_FRAC * H)) :, :] > 128).mean(0)
    assert strip_cols.min() > 0.05, (
        f"{stage}/near.png: foreground strip has a hole -- {int((strip_cols <= 0.05).sum())} of {W} "
        "columns are empty below the strip top; it will not read as a continuous ledge"
    )
    out.append(
        f"  {stage}: near feet-clearance {NEAR_FEET_CLEARANCE:+.0%} (feet uncovered, covers "
        f"{cover:.1%} of the standing box); strip full-width, thinnest column {strip_cols.min():.0%}"
    )

    for layer in ("main", "near"):
        out.append(f"  {stage}: {layer} wrap-seam delta {seam_delta(imgs[layer]):.1f} (reported, not enforced)")
    return out


def check_no_magenta(stage: str, preview: Image.Image) -> str:
    """End-to-end fringe check, independent of the key formula.

    Asserting "no near-void pixel survived" on a keyed layer is vacuous -- alpha>128 implies the key
    distance was already >80, so the condition cannot fire by construction. The honest question is
    whether any magenta is *visible* once the four layers are stacked, which the composite answers
    without reference to how alpha was computed.
    """
    a = np.asarray(preview)
    n = int((l1(a, KEY_RGB) < 60).sum())
    assert n == 0, f"{stage}/_preview.png: {n} magenta px visible in the stack -- key/despill leaked"
    return f"  {stage}: 0 magenta px visible in the composited stack"


def main() -> int:
    missing = [
        s for s in STAGES if not all((BACKGROUNDS / s / f"{l}-raw.png").exists() for l in LAYERS)
    ]
    assert not missing, (
        f"missing raws for {', '.join(missing)} -- Phase 04 requires all of {', '.join(STAGES)}; "
        "a partial run must not report success"
    )

    for stage in STAGES:
        key_stage(stage)

    # Must run before composite/validate: the edited stage's invented pixels have to be clamped off
    # before they can be baked into a preview or measured as if they were real.
    print(f"reference-edit drift ({STAGES[1]} vs {STAGES[0]}):")
    for line in align_to_reference(*STAGES):
        print(line)

    print()
    for stage in STAGES:
        for line in validate(stage):
            print(line)
        print(check_no_magenta(stage, composite(stage)))

    print(f"\nOK: {len(STAGES)} stages keyed and validated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
