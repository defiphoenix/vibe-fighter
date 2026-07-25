"""Bake the Phase 06 select portraits into runtime card assets for Phase 11.

The masters are 1792x2400 (~3 MB each) with the dusk backdrop BAKED IN -- there is no magenta void
here and nothing to key (concepts/portraits/2026-07-17/README.md measured 0 px of surviving magenta),
so this is a resize, not an art gate: no key-layers.py, no art_gate.check_job. Shipping the masters
would push ~9 MB through the loader for cards drawn at ~300x400, so we downscale ONCE here (Pillow
LANCZOS) to 2x the card size and ship those.

All three fighters are baked even though Phase 11 only makes brawler + jiujitsu selectable -- monk
costs ~40 KB and keeps Phase 16's roster restore a config change.

Phase 14 took the --hud flag this file's ponytail note asked for, for a measured reason: the HUD draws
the face at ~96x147, and the 448x600 card into that is a 4.7x GPU downscale. Phaser only builds
mipmaps for POWER-OF-TWO textures (WebGLTextureWrapper checks IsSizePowerOfTwo), and 448x600 is not
one, so that reduction is a raw bilinear squeeze that samples 4 texels out of every ~22 -- which is
what "the portraits look low-res" actually is. Resampling properly here (LANCZOS, all the pixels)
fixes it; enlarging the HUD only reduces it.

The HUD variant is cover-cropped to the ARCH's aspect, not the card's: the atlas window is 300x460
(0.652:1) against the master's 0.747:1, so the sides come off and the full height stays -- the bust's
bottom bleed is the Phase 06 contract and must survive. That also makes the runtime cover-crop an
exact fit rather than another resize.

Reads  concepts/portraits/2026-07-17/{brawler,jiujitsu,monk}.png  (1792x2400, opaque)
Writes public/ui/portraits/{brawler,jiujitsu,monk}.png            (448x600, opaque)  -- select cards
Writes public/ui/portraits/hud/{brawler,jiujitsu,monk}.png        (192x294, opaque)  -- HUD faces

Run: `npm run copy:portraits` (or `python scripts/copy-portraits.py`). Idempotent.
`--selftest` runs the assertions against synthetic images without touching the real art.
"""

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "concepts" / "portraits" / "2026-07-17"
OUT_DIR = ROOT / "public" / "ui" / "portraits"
IDS = ["brawler", "jiujitsu", "monk"]

MASTER_SIZE = (1792, 2400)
# 2x the ~300x400 card: Scale.FIT can letterbox the 1280x720 canvas UP on a large display, and a
# card upscaled past its native size is the one place this photographic art visibly softens.
CARD_SIZE = (448, 600)
ASPECT_TOL = 0.005  # 0.5% -- the card is a clean 4/15 of the master, so this is slack, not a fudge

HUD_OUT_DIR = OUT_DIR / "hud"
# Mirrored from the shipped art + the consumer, each with its source, the same discipline
# build-atlases.py uses. If either moves, re-run this script.
HUD_SLOT = (300, 460)  # public/ui/hud-atlas.json, `portrait-slot` (w, h)
HUD_SCALE = 0.32       # src/render/hud.ts PORTRAIT_SCALE
# 2x the on-screen size: Scale.FIT can letterbox the 1280x720 canvas UP on a large display, so the
# face is often drawn ABOVE its nominal size. Baking at 1x would just move the softness.
HUD_SUPERSAMPLE = 2
HUD_SIZE = (round(HUD_SLOT[0] * HUD_SCALE * HUD_SUPERSAMPLE), round(HUD_SLOT[1] * HUD_SCALE * HUD_SUPERSAMPLE))


def bake(img: Image.Image) -> Image.Image:
    """Downscale one master to the card size. Checks its input; the caller checks the output."""
    if img.size != MASTER_SIZE:
        raise SystemExit(f"expected a {MASTER_SIZE[0]}x{MASTER_SIZE[1]} master, got {img.size[0]}x{img.size[1]}")
    return img.convert("RGB").resize(CARD_SIZE, Image.LANCZOS)


def bake_hud(img: Image.Image) -> Image.Image:
    """Cover-crop one master to the arch window's aspect, then resample to the HUD's own size.

    Cover, never letterbox: an aspect-FIT into this window is what left Phase 11's cards with a black
    band. The window is narrower than the master, so the crop takes the sides and keeps the full
    height -- the bust bleeds off the bottom edge by design and a vertical crop would break the seam.
    """
    if img.size != MASTER_SIZE:
        raise SystemExit(f"expected a {MASTER_SIZE[0]}x{MASTER_SIZE[1]} master, got {img.size[0]}x{img.size[1]}")
    w, h = img.size
    slot_aspect = HUD_SLOT[0] / HUD_SLOT[1]
    if slot_aspect <= w / h:
        crop_w, crop_h = round(h * slot_aspect), h
    else:
        crop_w, crop_h = w, round(w / slot_aspect)
    left, top = (w - crop_w) // 2, 0  # horizontally centred, bottom-anchored (top=0 with full height)
    return img.convert("RGB").crop((left, top, left + crop_w, top + crop_h)).resize(HUD_SIZE, Image.LANCZOS)


def check_hud(out: Image.Image, where: str) -> None:
    """Assert the baked HUD face is the right size and matches the ARCH's aspect, not the card's."""
    if out.size != HUD_SIZE:
        raise SystemExit(f"{where}: expected {HUD_SIZE[0]}x{HUD_SIZE[1]}, got {out.size[0]}x{out.size[1]}")
    slot_aspect = HUD_SLOT[0] / HUD_SLOT[1]
    drift = abs(out.size[0] / out.size[1] - slot_aspect) / slot_aspect
    if drift > ASPECT_TOL:
        raise SystemExit(f"{where}: aspect drifted {drift:.3%} from the atlas window (max {ASPECT_TOL:.1%})")
    if "A" in out.getbands():
        lo, _hi = out.getchannel("A").getextrema()
        if lo != 255:
            raise SystemExit(f"{where}: not fully opaque (min alpha {lo}) -- these backdrops are baked")


def check(out: Image.Image, where: str) -> None:
    """Assert the baked card is the right size, the right shape, and fully opaque.

    Opacity is read from the ALPHA CHANNEL, never from the mode string: Phase 06 got `RGBA` on two of
    three masters and `RGB` on the third from identical model params, with alpha 255 everywhere.
    """
    if out.size != CARD_SIZE:
        raise SystemExit(f"{where}: expected {CARD_SIZE[0]}x{CARD_SIZE[1]}, got {out.size[0]}x{out.size[1]}")
    master_aspect = MASTER_SIZE[0] / MASTER_SIZE[1]
    card_aspect = out.size[0] / out.size[1]
    drift = abs(card_aspect - master_aspect) / master_aspect
    if drift > ASPECT_TOL:
        raise SystemExit(f"{where}: aspect drifted {drift:.3%} from the master (max {ASPECT_TOL:.1%})")
    if "A" in out.getbands():
        lo, _hi = out.getchannel("A").getextrema()
        if lo != 255:
            raise SystemExit(f"{where}: not fully opaque (min alpha {lo}) -- these backdrops are baked")


def run() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    HUD_OUT_DIR.mkdir(parents=True, exist_ok=True)
    for fighter_id in IDS:
        src = SRC_DIR / f"{fighter_id}.png"
        if not src.exists():
            raise SystemExit(f"missing master: {src}")
        master = Image.open(src)

        out = bake(master)
        check(out, fighter_id)
        dst = OUT_DIR / f"{fighter_id}.png"
        out.save(dst, "PNG", optimize=True)
        print(f"{fighter_id}: {MASTER_SIZE[0]}x{MASTER_SIZE[1]} -> {out.size[0]}x{out.size[1]}  {dst.relative_to(ROOT)} ({dst.stat().st_size // 1024} KB)")

        hud = bake_hud(master)
        check_hud(hud, f"{fighter_id}/hud")
        hud_dst = HUD_OUT_DIR / f"{fighter_id}.png"
        hud.save(hud_dst, "PNG", optimize=True)
        print(f"{fighter_id}: {MASTER_SIZE[0]}x{MASTER_SIZE[1]} -> {hud.size[0]}x{hud.size[1]}  {hud_dst.relative_to(ROOT)} ({hud_dst.stat().st_size // 1024} KB)")


def selftest() -> None:
    """Prove the checks actually fail on bad input before they are trusted on the real art."""
    good = bake(Image.new("RGB", MASTER_SIZE, (94, 60, 116)))
    check(good, "selftest/good")

    try:
        bake(Image.new("RGB", (1024, 1024)))
    except SystemExit:
        pass
    else:
        raise SystemExit("selftest: a wrong-sized master was accepted")

    try:
        check(Image.new("RGB", (300, 400)), "selftest/wrong-size")
    except SystemExit:
        pass
    else:
        raise SystemExit("selftest: a wrong-sized output was accepted")

    transparent = Image.new("RGBA", CARD_SIZE, (0, 0, 0, 0))
    try:
        check(transparent, "selftest/transparent")
    except SystemExit:
        pass
    else:
        raise SystemExit("selftest: a transparent output was accepted")

    # An RGBA container with alpha 255 everywhere is what Phase 06 actually produced -- it must pass.
    check(Image.new("RGBA", CARD_SIZE, (94, 60, 116, 255)), "selftest/opaque-rgba")

    # --- HUD variant ---
    hud = bake_hud(Image.new("RGB", MASTER_SIZE, (94, 60, 116)))
    check_hud(hud, "selftest/hud-good")

    # It must be a COVER crop, not a squash: prove the source rect kept the master's full height and
    # lost width, by checking a marker row survives. A letterboxed bake would keep the width instead.
    marked = Image.new("RGB", MASTER_SIZE, (0, 0, 0))
    for y in range(MASTER_SIZE[1] - 20, MASTER_SIZE[1]):  # bottom band = the bust's bleed edge
        for x in range(MASTER_SIZE[0]):
            marked.putpixel((x, y), (255, 0, 0))
    baked = bake_hud(marked)
    if baked.getpixel((HUD_SIZE[0] // 2, HUD_SIZE[1] - 1))[0] < 200:
        raise SystemExit("selftest: the HUD bake lost the master's bottom edge -- the bust bleed must survive")

    try:
        check_hud(Image.new("RGB", (HUD_SIZE[0], HUD_SIZE[1] + 40)), "selftest/hud-wrong-aspect")
    except SystemExit:
        pass
    else:
        raise SystemExit("selftest: a wrong-aspect HUD face was accepted")

    print("selftest: 8 checks passed")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        selftest()
        run()
