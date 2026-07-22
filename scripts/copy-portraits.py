"""Bake the Phase 06 select portraits into runtime card assets for Phase 11.

The masters are 1792x2400 (~3 MB each) with the dusk backdrop BAKED IN -- there is no magenta void
here and nothing to key (concepts/portraits/2026-07-17/README.md measured 0 px of surviving magenta),
so this is a resize, not an art gate: no key-layers.py, no art_gate.check_job. Shipping the masters
would push ~9 MB through the loader for cards drawn at ~300x400, so we downscale ONCE here (Pillow
LANCZOS) to 2x the card size and ship those.

All three fighters are baked even though Phase 11 only makes brawler + jiujitsu selectable -- monk
costs ~40 KB and keeps Phase 16's roster restore a config change.

The Phase 14 HUD variant (a top-anchored square crop) is deliberately NOT emitted here: the HUD slot
does not exist yet. ponytail: add a --hud flag in Phase 14 rather than shipping an unused asset now.

Reads  concepts/portraits/2026-07-17/{brawler,jiujitsu,monk}.png  (1792x2400, opaque)
Writes public/ui/portraits/{brawler,jiujitsu,monk}.png            (448x600, opaque)

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


def bake(img: Image.Image) -> Image.Image:
    """Downscale one master to the card size. Checks its input; the caller checks the output."""
    if img.size != MASTER_SIZE:
        raise SystemExit(f"expected a {MASTER_SIZE[0]}x{MASTER_SIZE[1]} master, got {img.size[0]}x{img.size[1]}")
    return img.convert("RGB").resize(CARD_SIZE, Image.LANCZOS)


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
    for fighter_id in IDS:
        src = SRC_DIR / f"{fighter_id}.png"
        if not src.exists():
            raise SystemExit(f"missing master: {src}")
        out = bake(Image.open(src))
        check(out, fighter_id)
        dst = OUT_DIR / f"{fighter_id}.png"
        out.save(dst, "PNG", optimize=True)
        print(f"{fighter_id}: {MASTER_SIZE[0]}x{MASTER_SIZE[1]} -> {out.size[0]}x{out.size[1]}  {dst.relative_to(ROOT)} ({dst.stat().st_size // 1024} KB)")


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
    print("selftest: 5 checks passed")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        selftest()
        run()
