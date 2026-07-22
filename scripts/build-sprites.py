#!/usr/bin/env python3
"""Phase 09 real-sprite builder. Turns raw Higgsfield poses (painted over a #FF00FF void, one PNG
per frame) into the shipped public/sprites/<id>/<state>.png strips.

Pipeline per fighter (mirrors build-atlases.py):
  1. Derive ONE scale factor from an UPRIGHT NEUTRAL reference (idle frame 0): scale = 185 / figure
     height, anchoring to the sim's HURT_STAND.h = 25.7% figure. The SAME factor is applied to every
     frame of every state — never rescale each pose's bbox independently (that grows crouch/wide
     poses and makes body scale change by state).
  2. Per frame: key the magenta void to alpha (L1 tolerance, never ==#FF00FF), despill, clear any
     residual magenta fringe from the transparent edge inward (the user's NO-PURPLE requirement),
     premultiplied-alpha resize by the fighter's scale, pin the lowest opaque row to the cell bottom
     (feet-anchored) and center x, into a 320x256 cell.
  3. Pack the cells into one horizontal strip per state.

Raw layout expected: concepts/characters/sprites/<id>/<state>/<NN>.png (frame count must match
public/configs/character-gym.json render.sheets[state].frames). If no raw art exists yet, this
no-ops (the placeholder sheets from gen-placeholder-sheet.mjs stay in place) — real art is the
last Phase 09 step. Always validate the result with `python scripts/check-sprites.py`.

Deps: Pillow + numpy. Reuses key-layers.py key()/despill() via importlib.
Run: `python scripts/build-sprites.py [--selftest]`  (npm run build:sprites)
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
KEY_RGB, KEY_HI = key_layers.KEY_RGB, key_layers.KEY_HI

CELL_W, CELL_H = 320, 256
TARGET_H = 185.0  # HURT_STAND.h — the sim's upright figure height in world px
RAW = ROOT / "concepts" / "characters" / "sprites"
OUT = ROOT / "public" / "sprites"


KEY_LO, KEY_HI2 = 45.0, 150.0  # soft-matte L1 band around the SAMPLED background colour


def key_rgb(rgb: np.ndarray) -> np.ndarray:
    """Chroma-key by the actual border background colour (magenta gens AND hue-shifted video frames
    both key cleanly). rgb is 0..255 float; returns RGBA float32 0..1."""
    ring = np.concatenate([
        rgb[:4].reshape(-1, 3), rgb[-4:].reshape(-1, 3),
        rgb[:, :4].reshape(-1, 3), rgb[:, -4:].reshape(-1, 3),
    ])
    bg = np.median(ring, axis=0)
    d = np.abs(rgb - bg).sum(axis=2)
    alpha = np.clip((d - KEY_LO) / (KEY_HI2 - KEY_LO), 0.0, 1.0)
    return np.dstack([rgb / 255.0, alpha]).astype(np.float32)


def keyed_rgba(path: Path) -> np.ndarray:
    """Load a raw void-background PNG (magenta gen or video frame) → keyed RGBA float32 0..1."""
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    return key_rgb(rgb)


def figure_height(rgba: np.ndarray) -> int:
    op = rgba[:, :, 3] > 0.15
    ys = np.where(op.any(axis=1))[0]
    return int(ys.max() - ys.min() + 1) if len(ys) else 0


def resize_premult(rgba: np.ndarray, scale: float) -> np.ndarray:
    h, w = rgba.shape[:2]
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    a = rgba[:, :, 3:4]
    premult = np.dstack([rgba[:, :, :3] * a, rgba[:, :, 3]])
    img = Image.fromarray((np.clip(premult, 0, 1) * 255).astype(np.uint8), "RGBA").resize((nw, nh), Image.LANCZOS)
    arr = np.asarray(img).astype(np.float32) / 255.0
    a2 = arr[:, :, 3:4]
    rgb = np.divide(arr[:, :, :3], a2, out=np.zeros_like(arr[:, :, :3]), where=a2 > 1e-4)  # un-premultiply
    return np.dstack([rgb, arr[:, :, 3]])


def clean_rgba(rgba: np.ndarray) -> np.ndarray:
    """Post-resize magenta cleanup so NO purple survives: despill, erode the 1px anti-aliased ring
    where fringe lives, and hard-kill any residual magenta-family pixel."""
    rgb = rgba[:, :, :3] * 255.0
    a = rgba[:, :, 3].copy()
    rgb = key_layers.despill(rgb, a)  # pull R/B down toward G where magenta spill remains
    m = a > 0.15
    eroded = m & np.roll(m, 1, 0) & np.roll(m, -1, 0) & np.roll(m, 1, 1) & np.roll(m, -1, 1)
    a = np.where(eroded, a, 0.0)  # drop the outermost AA ring (fringe)
    d = np.abs(rgb - KEY_RGB.astype(np.float32)).sum(axis=2)
    family = (rgb[:, :, 0] > 120) & (rgb[:, :, 2] > 120) & (rgb[:, :, 1] < 60)
    # also kill the exact semi-transparent magenta fringe the gate flags (r>200,b>200,g<80)
    fringe = (a < 1.0) & (rgb[:, :, 0] > 200) & (rgb[:, :, 2] > 200) & (rgb[:, :, 1] < 80)
    a = np.where((d < KEY_HI) | family | fringe, 0.0, a)
    rgb = np.where(a[:, :, None] > 0, rgb, 0.0)
    return np.dstack([rgb / 255.0, a])


def place_cell(rgba: np.ndarray) -> np.ndarray:
    """Feet-anchor + center a scaled figure into a 320x256 RGBA uint8 cell."""
    op = rgba[:, :, 3] > 0.15
    ys, xs = np.where(op)
    cell = np.zeros((CELL_H, CELL_W, 4), np.float32)
    if len(ys) == 0:
        return (cell * 255).astype(np.uint8)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    crop = rgba[y0:y1 + 1, x0:x1 + 1, :]
    ch, cw = crop.shape[:2]
    dst_x = CELL_W // 2 - cw // 2
    dst_y = CELL_H - ch  # feet on the bottom row
    dst_x, dst_y = max(0, dst_x), max(0, dst_y)
    cw, ch = min(cw, CELL_W - dst_x), min(ch, CELL_H - dst_y)
    cell[dst_y:dst_y + ch, dst_x:dst_x + cw, :] = crop[:ch, :cw, :]
    return (np.clip(cell, 0, 1) * 255).astype(np.uint8)


def build_fighter(fid: str, sheets: dict) -> list[str]:
    logs: list[str] = []
    # scale from the upright neutral (idle frame 0)
    idle0 = RAW / fid / "idle" / "00.png"
    if not idle0.exists():
        idle0 = next((RAW / fid / "idle").glob("*.png"), None) if (RAW / fid / "idle").exists() else None
    if idle0 is None:
        return [f"{fid}: no raw idle reference; skipped"]
    ref = keyed_rgba(idle0)
    fig = figure_height(ref)
    scale = TARGET_H / fig if fig else 1.0
    logs.append(f"{fid}: scale {scale:.4f} (idle figure {fig}px -> {int(TARGET_H)}px)")

    for state, meta in sheets.items():
        raw_dir = RAW / fid / state
        allframes = sorted(raw_dir.glob("[0-9][0-9].png")) if raw_dir.exists() else []
        need = meta["frames"]
        if len(allframes) < need:
            logs.append(f"{fid}/{state}: have {len(allframes)} raw frames, need {need}; skipped")
            continue
        frames = allframes[:need]  # tolerate ffmpeg's off-by-one (fps sampling can yield N+1)
        strip = np.zeros((CELL_H, CELL_W * meta["frames"], 4), np.uint8)
        for i, fp in enumerate(frames):
            cell = place_cell(clean_rgba(resize_premult(keyed_rgba(fp), scale)))
            strip[:, i * CELL_W:(i + 1) * CELL_W, :] = cell
        outp = OUT / fid / f"{state}.png"
        outp.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(strip, "RGBA").save(outp)
        logs.append(f"{fid}/{state}: wrote {meta['frames']} frames")
    return logs


def selftest() -> None:
    # a magenta-framed red square keys to a clean feet-anchored cell with NO magenta.
    raw = np.full((100, 100, 3), KEY_RGB, np.float32)
    raw[20:90, 40:60] = [200, 60, 60]
    rgba = key_rgb(raw)
    cell = place_cell(clean_rgba(resize_premult(rgba, 185.0 / figure_height(rgba))))
    op = cell[:, :, 3] > 32
    assert op.any(), "selftest: figure vanished"
    assert op[CELL_H - 1, :].any(), "selftest: not feet-anchored"
    dd = np.abs(cell[:, :, :3].astype(np.int32) - KEY_RGB.astype(np.int32)).sum(axis=2)
    assert not (op & (dd < KEY_HI)).any(), "selftest: magenta survived keying"
    print("build-sprites selftest: OK")


def main() -> int:
    if "--selftest" in sys.argv:
        selftest()
        return 0
    selftest()  # always gate on our own fixtures before touching art
    if not RAW.exists():
        print(f"build-sprites: no raw art at {RAW.relative_to(ROOT)} — placeholders left in place (real art is the last step)")
        return 0
    reg = json.loads((ROOT / "public" / "configs" / "character-gym.json").read_text())
    for fid, entry in reg.items():
        if fid.startswith("_"):
            continue
        for line in build_fighter(fid, entry["render"]["sheets"]):
            print(" ", line)
    print("build-sprites: done — now run `python scripts/check-sprites.py`")
    return 0


if __name__ == "__main__":
    sys.exit(main())
