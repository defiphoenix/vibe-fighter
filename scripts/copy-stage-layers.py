"""Bake the Phase 04 parallax layers into runtime-sized stage assets for Phase 08.

The keyed authoring layers are 3168x1344 (concepts/backgrounds/<dir>/<layer>.png). At runtime the
stage scales them by HEIGHT to 720 (concepts/backgrounds/README.md), which lands the width at 1697px
and gives the 1280 camera 416px of scroll room. Downscaling 8 of these at load time would cost
~130 MiB of RGBA and shimmer under pixelArt nearest-neighbour, so we pre-scale ONCE here (Pillow
LANCZOS, alpha preserved) and ship 1697x720 copies. The renderer then places them at setScale(1) --
no aspect footgun, no runtime resample.

Reads  concepts/backgrounds/<dir>/{far,medium,main,near}.png   (3168x1344 RGBA)
Writes public/backgrounds/<runtimeId>/{far,medium,main,near}.png (1697x720 RGBA)

Run: `npm run copy:stages` (or `python scripts/copy-stage-layers.py`). Idempotent.
`--selftest` runs the size/alpha assertions on a synthetic layer without touching the real art.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "concepts" / "backgrounds"
DST = ROOT / "public" / "backgrounds"

# authoring directory -> runtime stage id (README § Stage -> directory map)
STAGE_MAP = {"rooftop-dusk": "twilight", "rooftop-sunset": "sunset"}
LAYERS = ["far", "medium", "main", "near"]

# Authoring size (all Phase 04 layers) and runtime size: height 1344 -> 720 (factor 0.5357),
# width 3168 -> 1697 (README locked).
SRC_W, SRC_H = 3168, 1344
OUT_W, OUT_H = 1697, 720

# Residual chroma-key cleanup (Phase 08 bake only — the Phase 04 keyed sources are untouched). The
# keyed sources carry a faint magenta fringe: edge-antialiasing pixels that sit ~139 in L1 from pure
# #FF00FF, just past key-layers.py's KEY_HI=120, so the keyer kept them as "art". Legit dusk purple /
# sunset orange are >300 away, so a tight radius removes the fringe without touching real palette.
KEY_RGB = np.array([255, 0, 255])
FRINGE_L1 = 200.0  # a magenta-ish pixel within this L1 of the void is fringe, not art (gap to art >300)
DESPILL_MIN_ALPHA = 0.05


def l1_to_void(rgb: np.ndarray) -> np.ndarray:
    """Per-pixel L1 distance to the #FF00FF void colour."""
    return np.abs(rgb.astype(np.int32) - KEY_RGB).sum(2).astype(np.float32)


def dilate(mask: np.ndarray) -> np.ndarray:
    """1px 3x3 dilation (OR over the neighbourhood) — no scipy dependency."""
    H, W = mask.shape
    pad = np.pad(mask, 1, constant_values=False)
    out = np.zeros_like(mask)
    for dy in range(3):
        for dx in range(3):
            out |= pad[dy : dy + H, dx : dx + W]
    return out


def premultiplied_resize(rgba: np.ndarray) -> np.ndarray:
    """LANCZOS downscale in PREMULTIPLIED alpha, so the magenta RGB hiding under transparent pixels
    (~2.5M px in a keyed layer) can't bleed into the edges. Returns float RGBA at the runtime size."""
    a = rgba[..., 3:4].astype(np.float32) / 255.0
    prgb = np.clip(rgba[..., :3].astype(np.float32) * a, 0, 255).astype(np.uint8)
    pr = np.asarray(Image.fromarray(prgb).resize((OUT_W, OUT_H), Image.LANCZOS)).astype(np.float32)
    ar = np.asarray(
        Image.fromarray(rgba[..., 3]).resize((OUT_W, OUT_H), Image.LANCZOS)
    ).astype(np.float32) / 255.0
    rgb = np.where(ar[..., None] > 1e-4, pr / np.maximum(ar[..., None], 1e-4), 0.0)
    out = np.zeros((OUT_H, OUT_W, 4), np.float32)
    out[..., :3] = np.clip(rgb, 0, 255)
    out[..., 3] = ar * 255.0
    return out


def clean_fringe(rgba: np.ndarray) -> np.ndarray:
    """Drop the thin magenta rim around transparent holes and unmix soft-matte edge pixels. Touches
    ONLY the 1px rim adjacent to existing transparency, so interior art is never punched through."""
    rgb, alpha = rgba[..., :3], rgba[..., 3]
    d = l1_to_void(rgb)
    magenta = d < FRINGE_L1
    # Flood the magenta fringe inward from the transparent void: repeatedly drop the rim of magenta
    # pixels touching transparency. Stops at real art (L1 to void >300), so a multi-px fringe clears
    # while genuine dusk/sunset palette is never reached. Bounded iterations = safety cap.
    for _ in range(12):
        trans = alpha < 128
        kill = dilate(trans) & ~trans & magenta
        if not kill.any():
            break
        alpha[kill] = 0.0
    # despill the remaining soft-matte edges: unmix observed = a*art + (1-a)*void  ->  art
    a = alpha / 255.0
    edge = (a > DESPILL_MIN_ALPHA) & (a < 1.0) & (d < FRINGE_L1)
    if edge.any():
        av = a[edge][:, None]
        rgb[edge] = np.clip((rgb[edge] - (1.0 - av) * KEY_RGB) / av, 0, 255)
    return rgba


def interior_fringe_mask(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Opaque magenta-fringe pixels around interior structure (antennas, the front layer's
    silhouette) where the fringe is walled off from the transparent void, so clean_fringe's rim flood
    never reaches it. Two gates, both measured on the real bake:
      (1) colour — magenta is green-starved with near-balanced R/B: g < 0.45*max(r,b) AND
          |r-b| < 0.12*max(r,b). Sampled fringe sits at g/max ~0.26 across all brightnesses
          ((103,8,104), (143,4,145), …); genuine dusk purple is >0.6 and the pure-sky layer scores
          ZERO, so real palette is never touched. (An earlier bright-only floor of 130 missed the
          dark fringe, which then contaminated the inpaint — hence the low floor + tight balance.)
      (2) proximity — within ~6px of a transparent pixel. True keyed fringe hugs the alpha edge;
          this spares any genuinely balanced-magenta pixel in a layer's interior."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.maximum(np.maximum(r, b), 1.0)
    magenta = (alpha > 128) & (g < 0.45 * mx) & (np.abs(r - b) < 0.12 * mx)  # green-starved, balanced R/B
    # Two tiers by brightness. BRIGHT saturated magenta (min channel > 130) is never real dusk/sunset
    # palette (the pure-sky layer scores 0), so strip it ANYWHERE. DARKER magenta overlaps the deepest
    # real purple, so only strip it in the keyed-edge zone (within ~6px of transparency), where true
    # fringe lives — this protects genuinely deep-purple interior art (skyline buildings).
    bright = magenta & (np.minimum(r, b) > 130)
    near_void = alpha < 128
    for _ in range(6):
        near_void = dilate(near_void)
    dark = magenta & (np.minimum(r, b) > 50) & near_void
    return bright | dark


def clean_interior_fringe(rgba: np.ndarray) -> np.ndarray:
    """Inpaint interior magenta fringe by growing neighbouring real colour over it. Iterative 3x3
    mean of non-fringe opaque neighbours — fills thin fringe lines (antenna rims) without a scipy
    dependency. Leaves alpha untouched; only rewrites the flagged fringe pixels' RGB."""
    rgb = rgba[..., :3]
    alpha = rgba[..., 3]
    fringe = interior_fringe_mask(rgb, alpha)
    if not fringe.any():
        return rgba
    valid = (alpha > 128) & ~fringe
    todo = fringe.copy()
    H, W = alpha.shape
    for _ in range(30):
        if not todo.any():
            break
        vp = np.pad(valid, 1)
        rp = np.pad(rgb, ((1, 1), (1, 1), (0, 0)))
        sums = np.zeros((H, W, 3), np.float32)
        cnt = np.zeros((H, W), np.float32)
        for dy in range(3):
            for dx in range(3):
                vv = vp[dy : dy + H, dx : dx + W].astype(np.float32)
                sums += rp[dy : dy + H, dx : dx + W] * vv[..., None]
                cnt += vv
        fillable = todo & (cnt > 0)
        if not fillable.any():
            break
        rgb[fillable] = sums[fillable] / cnt[fillable][..., None]
        valid |= fillable
        todo &= ~fillable
    if todo.any():
        # residual fringe walled off from any real colour (silhouette rim against the void): no
        # neighbour to inpaint from, so desaturate to neutral — kills the magenta cast without
        # punching an alpha hole in the layer.
        g = rgb[..., 1]
        rgb[..., 0] = np.where(todo, g, rgb[..., 0])
        rgb[..., 2] = np.where(todo, g, rgb[..., 2])
    return rgba


def bake(img: Image.Image) -> Image.Image:
    """Resample one authoring layer to the runtime size (premultiplied), strip the residual magenta
    fringe at the void rim, then inpaint any interior magenta fringe (antenna rims / front-layer
    silhouette). Keeps alpha; never desaturates genuine dusk/sunset palette (L1 gap to void >300)."""
    assert img.size == (SRC_W, SRC_H), f"source is {img.size}, expected {(SRC_W, SRC_H)}"
    rgba = np.asarray(img.convert("RGBA"))
    out = clean_interior_fringe(clean_fringe(premultiplied_resize(rgba)))
    return Image.fromarray(out.astype(np.uint8), "RGBA")


def run() -> None:
    total = 0
    for src_dir, stage_id in STAGE_MAP.items():
        out_dir = DST / stage_id
        out_dir.mkdir(parents=True, exist_ok=True)
        for layer in LAYERS:
            src = SRC / src_dir / f"{layer}.png"
            if not src.exists():
                sys.exit(f"missing source layer: {src}")
            out = bake(Image.open(src))
            assert out.size == (OUT_W, OUT_H), f"{src} baked to {out.size}, expected {(OUT_W, OUT_H)}"
            assert out.mode == "RGBA", f"{src} baked to mode {out.mode}, expected RGBA"
            dst = out_dir / f"{layer}.png"
            out.save(dst)
            print(f"{src.relative_to(ROOT)} -> {dst.relative_to(ROOT)}  {out.size}")
            total += 1
    print(f"baked {total} layers into {DST.relative_to(ROOT)}")


def selftest() -> None:
    src = Image.new("RGBA", (3168, 1344), (12, 28, 43, 255))
    out = bake(src)
    assert out.size == (OUT_W, OUT_H), out.size
    assert out.mode == "RGBA", out.mode
    # a fully-opaque source stays fully opaque after resample (LANCZOS on a flat field)
    assert out.getpixel((OUT_W // 2, OUT_H // 2))[3] == 255

    # interior-fringe removal: a magenta fringe strip hugging a transparent void must be inpainted
    # away, while genuine dusk purple further from the edge is untouched.
    px = np.full((64, 64, 4), (150, 110, 170, 255), np.uint8)  # genuine dusk purple (g/max ~0.65)
    px[:, :20, 3] = 0                                          # left 20 cols = transparent void
    px[:, 20:23, :3] = (175, 40, 170)                         # magenta fringe strip on the void edge
    before = interior_fringe_mask(px[..., :3].astype(np.float32), px[..., 3].astype(np.float32)).sum()
    cleaned = clean_interior_fringe(px.copy().astype(np.float32))
    after = interior_fringe_mask(cleaned[..., :3], cleaned[..., 3]).sum()
    assert before > 0 and after == 0, f"interior fringe not cleared: {before} -> {after}"
    # genuine purple away from the edge was left alone; transparency preserved
    assert tuple(cleaned[0, 40, :3].astype(int)) == (150, 110, 170), cleaned[0, 40]
    assert cleaned[0, 0, 3] == 0, "void must stay transparent"
    print("selftest OK")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        run()
