#!/usr/bin/env python3
"""Phase 09 sprite gate. Validates every public/sprites/<id>/<state>.png against the frame counts
declared in public/configs/character-gym.json, by MEASUREMENT (not eyeballing): cell size, frame
count, transparent background, a figure present + feet-anchored, per-fighter height consistency
across upright states, and — the user's hard requirement — NO purple/magenta hue anywhere.

Runs its own synthetic fixtures first (a wrong metric is worse than no metric — Phase 04 rule), then
judges the real files. Works on the placeholder sheets today and the real Higgsfield strips later.

Deps: Pillow + numpy. Reuses key-layers.py thresholds via the same importlib shim art_gate.py uses.
Run: `python scripts/check-sprites.py`  (npm run check:sprites)
"""
from __future__ import annotations
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("key_layers", ROOT / "scripts" / "key-layers.py")
key_layers = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(key_layers)
KEY_RGB, KEY_HI = key_layers.KEY_RGB, key_layers.KEY_HI  # magenta ref + soft-matte upper bound

CELL_W, CELL_H = 320, 256
UPRIGHT = ("idle", "walkF", "walkB", "blockstun", "hitstun")  # bodies that should share a height
HEIGHT_TOL = 30  # px spread allowed among a fighter's upright states

# An ATTACK sheet is a claim that a strike happens. Nothing checked that until 2026-07-22, and a
# sheet shipped where all four frames were the same squat: the sim ran `crouchLight` with a live hit
# box for 16 ticks and the sprite never moved, which reads to a player as "this character can't do
# the move". Measured as the peak symmetric pixel difference against frame 0, as a fraction of the
# figure's own area — scale-free, so it doesn't care how big the fighter is.
ATTACK_STATES = ("attackLight", "attackHeavy", "airLight", "airHeavy", "crouchLight", "crouchHeavy")
MOTION_MIN = 0.20
# Threshold placement, measured rather than guessed. The sheet that triggered this check was a still
# image at 0.14. With it regenerated, the roster runs 0.22 -> 1.27 and every sheet in that range has a
# visible strike. So the real boundary between "the strike is missing" and "the strike is subtle" sits
# between 0.14 and 0.22, and 0.20 is the honest place for it. The margin over the weakest real sheet
# (monk/crouchLight, 0.22 — an arm-only jab from a wide stance, which changes little AREA) is thin;
# widen it only with evidence, and prefer looking at the contact sheet over nudging this number.


def cells(arr: np.ndarray, frames: int) -> list[np.ndarray]:
    return [arr[:, i * CELL_W:(i + 1) * CELL_W, :] for i in range(frames)]


def opaque_mask(cell: np.ndarray) -> np.ndarray:
    return cell[:, :, 3] > 32


def check_cell(cell: np.ndarray, where: str, errs: list[str]) -> tuple[int, int]:
    """Returns (figure_height, feet_row_count). Appends any violations to errs."""
    a = cell[:, :, 3]
    rgb = cell[:, :, :3].astype(np.int32)
    op = a > 32

    if not op.any():
        errs.append(f"{where}: empty cell (no figure)")
        return (0, 0)
    if a.min() != 0:
        errs.append(f"{where}: no transparent background (alpha min {int(a.min())})")

    ys = np.where(op.any(axis=1))[0]
    fig_h = int(ys.max() - ys.min() + 1)
    feet = int(op[CELL_H - 1, :].sum())  # opaque pixels on the very bottom row (feet-anchored)
    if feet == 0:
        errs.append(f"{where}: not feet-anchored (bottom row empty)")

    # NO purple/magenta hue (user requirement): three checks —
    #  (a) opaque pixels within the soft-matte radius of pure magenta (residual void),
    #  (b) opaque magenta-FAMILY pixels (high R+B, low G) — catches e.g. (128,0,128) that a pure
    #      #FF00FF distance test misses, and
    #  (c) magenta-dominant fringe on semi-transparent edge pixels.
    r, g, bl = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    d = np.abs(rgb - KEY_RGB.astype(np.int32)).sum(axis=2)
    near = op & (d < KEY_HI)
    if near.any():
        errs.append(f"{where}: magenta/purple hue present ({int(near.sum())} px near #FF00FF)")
    family = op & (r > 120) & (bl > 120) & (g < 60)
    if family.any():
        errs.append(f"{where}: magenta-family hue present ({int(family.sum())} opaque px, high R+B low G)")
    edge = (a > 0) & (a < 255)
    fringe = edge & (r > 200) & (bl > 200) & (g < 80)
    if fringe.any():
        errs.append(f"{where}: magenta fringe on {int(fringe.sum())} semi-transparent edge px")
    return (fig_h, feet)


def motion_amplitude(frame_cells: list[np.ndarray]) -> float:
    """How much the silhouette actually MOVES: peak symmetric difference vs frame 0, over frame 0's
    own opaque area. 0 = every frame identical to the first (a still image dressed as an animation)."""
    if len(frame_cells) < 2:
        return 0.0
    base = opaque_mask(frame_cells[0])
    area = int(base.sum())
    if area == 0:
        return 0.0
    return max(float((opaque_mask(c) ^ base).sum()) / area for c in frame_cells[1:])


def check_registry(errs: list[str]) -> None:
    reg = json.loads((ROOT / "public" / "configs" / "character-gym.json").read_text())
    for fid, entry in reg.items():
        if fid.startswith("_"):
            continue
        sheets = entry["render"]["sheets"]
        upright_heights: list[int] = []
        for state, meta in sheets.items():
            path = ROOT / "public" / meta["path"]
            if not path.exists():
                errs.append(f"{fid}/{state}: missing {meta['path']}")
                continue
            arr = np.asarray(Image.open(path).convert("RGBA"))
            frames = meta["frames"]
            if arr.shape[0] != CELL_H or arr.shape[1] != CELL_W * frames:
                errs.append(f"{fid}/{state}: size {arr.shape[1]}x{arr.shape[0]} != {CELL_W * frames}x{CELL_H} ({frames} frames)")
                continue
            frame_cells = cells(arr, frames)
            for i, cell in enumerate(frame_cells):
                fig_h, _ = check_cell(cell, f"{fid}/{state}#{i}", errs)
                if state in UPRIGHT and i == 0:
                    upright_heights.append(fig_h)
            if state in ATTACK_STATES:
                amp = motion_amplitude(frame_cells)
                if amp < MOTION_MIN:
                    errs.append(
                        f"{fid}/{state}: the animation barely moves ({amp:.0%} peak silhouette change, "
                        f"need {MOTION_MIN:.0%}): the strike is not in the art, so the move looks like "
                        f"nothing happens. Regenerate the clip (scripts/gen-sprite-videos.sh {fid} {state})."
                    )
        if len(upright_heights) >= 2:
            spread = max(upright_heights) - min(upright_heights)
            if spread > HEIGHT_TOL:
                errs.append(f"{fid}: upright figure heights vary {spread}px > {HEIGHT_TOL} (scale drift): {upright_heights}")


def selftest() -> None:
    """Fixtures on our own metrics — a good cell passes; a magenta cell + a floating figure fail."""
    good = np.zeros((CELL_H, CELL_W, 4), np.uint8)
    good[CELL_H - 140:CELL_H, 150:170] = [200, 60, 60, 255]  # feet reach bottom row
    e: list[str] = []
    check_cell(good, "good", e)
    assert e == [], f"selftest: good cell rejected: {e}"

    magenta = good.copy()
    magenta[10, 10] = [254, 1, 254, 255]  # a stray opaque near-magenta pixel
    e = []
    check_cell(magenta, "magenta", e)
    assert any("magenta" in m for m in e), "selftest: purple hue not caught"

    purple = good.copy()
    purple[12, 12] = [128, 0, 128, 255]  # dark purple, far from #FF00FF but still a purple hue
    e = []
    check_cell(purple, "purple", e)
    assert any("magenta-family" in m for m in e), "selftest: dark-purple hue not caught"

    # motion amplitude: identical frames score 0, a moved limb scores well above the threshold
    still = np.zeros((CELL_H, CELL_W, 4), np.uint8)
    still[CELL_H - 140:CELL_H, 150:170] = [200, 60, 60, 255]
    assert motion_amplitude([still, still.copy()]) == 0.0, "selftest: identical frames must score 0"
    punch = still.copy()
    punch[CELL_H - 130:CELL_H - 110, 170:260] = [200, 60, 60, 255]  # an arm extends
    amp = motion_amplitude([still, punch])
    assert amp > MOTION_MIN, f"selftest: a real strike must clear the threshold, got {amp:.2f}"
    # and the peak is taken across ALL frames, not just the last (a jab returns to guard)
    assert motion_amplitude([still, punch, still.copy()]) == amp, "selftest: must take the PEAK frame"
    assert motion_amplitude([still]) == 0.0, "selftest: a single frame cannot animate"
    # the defect this gate exists for: a sheet whose frames are the same pose with a 1px jitter
    jitter = still.copy()
    jitter[CELL_H - 140:CELL_H, 151:171] = [200, 60, 60, 255]
    jitter[CELL_H - 140:CELL_H, 150:151] = 0
    assert motion_amplitude([still, jitter]) < MOTION_MIN, "selftest: a still image must FAIL the gate"

    floating = np.zeros((CELL_H, CELL_W, 4), np.uint8)
    floating[40:80, 150:170] = [200, 60, 60, 255]  # opaque but not touching the bottom row
    e = []
    check_cell(floating, "float", e)
    assert any("feet-anchored" in m for m in e), "selftest: floating figure not caught"


def main() -> int:
    selftest()
    errs: list[str] = []
    check_registry(errs)
    if errs:
        print("check-sprites: FAIL")
        for m in errs:
            print("  -", m)
        return 1
    print("check-sprites: OK (self-tests + all registry sheets)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
