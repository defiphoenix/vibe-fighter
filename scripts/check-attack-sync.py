#!/usr/bin/env python3
"""Phase 12 attack-sync gate. Measures WHEN each attack sprite actually strikes and compares it to
when the sim's hit box goes live.

`anim-timing.ts` already makes an attack's animation the same LENGTH as its move. That fixed nothing
about its PHASE: measured here, 13 of 18 shipped attacks had the hit box go active roughly one
render frame before the sprite reached full extension, so the strike connected on a wind-up pose.

The metric is the forward reach of the silhouette in each frame — the furthest opaque column ahead
of the fighter's own centre line. The frame where that peaks is the contact frame. That number is
written back into `render.sheets.<state>.hit` in character-gym.json, and `attackFrameDurations`
uses it to start that frame on the first ACTIVE tick.

The metric CANNOT always decide, and says so. A fighter whose widest feature is a planted trailing
leg rather than the striking limb (the monk, whose stance is very wide) gives an almost flat
profile, e.g. monk/crouchLight measures [66, 66, 66, 66]. Those report INDETERMINATE and keep the
old uniform timing rather than being handed a guessed value — a wrong metric is worse than no
metric, and a green tick that means "I couldn't tell" is worse than both.

Self-tests its own metric on synthetic fixtures before judging any real art (the check-characters.py
convention).

Deps: Pillow + numpy.
Run: `python scripts/check-attack-sync.py`   (npm run check:sync)
     `python scripts/check-attack-sync.py --write`  also writes the measured `hit` values back.
"""
from __future__ import annotations
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
REGISTRY = ROOT / "public" / "configs" / "character-gym.json"
PUBLIC = ROOT / "public"

# Attack STATE -> attack DATA key. Mirrors ATTACK_STATE_TO_KEY in src/sim/types.ts.
ATTACK_STATE_TO_KEY = {
    "attackLight": "light",
    "attackHeavy": "heavy",
    "airLight": "airLight",
    "airHeavy": "airHeavy",
    "crouchLight": "crouchLight",
    "crouchHeavy": "crouchHeavy",
}

PLAY_LAG_TICKS = 1  # mirrors render/anim-timing.ts
ALPHA_MIN = 16   # a pixel counts as art above this alpha (video-derived edges are soft)
FLAT_PX = 8      # if peak-minus-baseline reach is under this, the metric cannot call the frame


def forward_reach(sheet: np.ndarray, frame_w: int, frames: int) -> list[int]:
    """Per frame: how far past the cell's centre line the furthest column that MOVED sits.

    "Moved" means opaque in this frame and not in frame 0, which is the wind-up/neutral pose. The
    obvious metric — the furthest opaque column, full stop — measures the whole silhouette, and for
    a wide-stanced fighter the widest thing in frame is a planted trailing leg that never moves. The
    monk's `attackLight` measured [65, 65, 65, 66, 65, 65] that way: a 1px spread across the entire
    punch, which is not a measurement, and QA confirmed by eye that his light really was striking on
    a wind-up pose. Differencing against frame 0 deletes the static stance and leaves the limb.

    Frame 0 is the baseline, so it scores -inf: it can never be the contact frame anyway (`hit` must
    be > 0, or the wind-up segment is empty).
    """
    mid = frame_w // 2
    base = sheet[:, 0:frame_w, 3] > ALPHA_MIN
    out = [-10**6]
    for i in range(1, frames):
        moved = (sheet[:, i * frame_w:(i + 1) * frame_w, 3] > ALPHA_MIN) & ~base
        cols = np.where(moved.max(axis=0))[0]
        out.append(int(cols.max()) - mid if cols.size else -10**6)
    return out


def contact_frame(reach: list[int]) -> tuple[int | None, str]:
    """(frame, note). None when the measurement must not be acted on.

    Two ways it declines. A FLAT profile means the striking limb never dominates the silhouette, so
    the peak is noise. A peak on the LAST frame means the clip ends at extension and there is no
    recovery art at all: re-timing would give that one frame the whole active+recovery budget and
    freeze it, trading "the strike is never drawn" for "the strike is drawn and then held". That is
    an art gap to re-shoot, not a timing bug to paper over.
    """
    real = [r for r in reach[1:] if r > -10**5]  # frame 0 is the baseline; drop empty frames too
    if len(real) < 2:
        return None, "not enough moving art to compare"
    peak = int(np.argmax(reach))
    spread = max(real) - min(real)
    if spread < FLAT_PX:
        return None, f"flat profile (spread {spread}px < {FLAT_PX})"
    if peak == len(reach) - 1:
        return None, f"contact on the final frame ({reach[peak]}px): no recovery art to spend time on"
    return peak, f"peak {reach[peak]}px, spread {spread}px"


def active_render_window(startup: int, active: int, frames: int, total: int) -> tuple[int, int]:
    """The render frames the sim's ACTIVE ticks land on under UNIFORM playback — i.e. what the
    animation shows at the moment the hit box is live today."""
    lo = int(startup * frames / total)
    hi = int((startup + active - 1) * frames / total)
    return lo, min(hi, frames - 1)


# --------------------------------------------------------------------------------------- selftest

def _synth(frames: int, reaches: list[int], stance: int = 0, w: int = 320, h: int = 256) -> np.ndarray:
    """A sheet where frame i's ARM extends `reaches[i]` px past the centre line.

    `stance` adds a static leg reaching that far forward in EVERY frame, including frame 0 — the
    monk case. It must not affect the measurement, which is the whole point of differencing.
    """
    sheet = np.zeros((h, frames * w, 4), dtype=np.uint8)
    mid = w // 2
    for i, r in enumerate(reaches):
        if stance:  # legs: same pixels in every frame, so they difference away
            sheet[h - 40:h, i * w + mid - 20:i * w + mid + stance + 1, 3] = 255
        if r is None:   # a genuinely EMPTY frame — `0` still draws a body, which is not the same
            continue
        x0, x1 = i * w + mid - 20, i * w + mid + r + 1   # torso + arm
        sheet[h - 100:h - 40, x0:x1, 3] = 255
    return sheet


def selftest() -> None:
    NEG = -10**5

    # 1. reach measures the MOVED pixels per frame, from the centre line. Frame 0 is the baseline.
    r = forward_reach(_synth(4, [10, 30, 60, 20]), 320, 4)
    assert r[0] < NEG, f"selftest: frame 0 must be the baseline, got {r}"
    assert r[1:] == [30, 60, 20], f"selftest: reach wrong: {r}"

    # 2. the peak frame is the contact frame
    f, _ = contact_frame(r)
    assert f == 2, f"selftest: contact frame wrong: {f}"

    # 3. THE REASON THIS METRIC EXISTS: a static wide stance that out-reaches the arm must not swamp
    #    the measurement. Same arm, plus a leg planted 90px forward in EVERY frame (the monk).
    wide = forward_reach(_synth(4, [10, 30, 60, 20], stance=90), 320, 4)
    assert wide[1:] == r[1:], f"selftest: a static stance leaked into the measurement: {wide} vs {r}"
    assert contact_frame(wide)[0] == 2, "selftest: wide stance broke the contact frame"

    # 4. a genuinely flat profile is still refused, not guessed
    f, note = contact_frame([NEG - 1, 66, 66, 66])
    assert f is None and "flat" in note, f"selftest: flat profile not refused: {f} {note}"
    f, _ = contact_frame([NEG - 1, 66, 66, 70])  # 4px < FLAT_PX, still noise
    assert f is None, "selftest: near-flat profile not refused"

    # 4b. a peak on the final frame is refused too — re-timing it would just freeze that frame
    f, note = contact_frame([NEG - 1, 30, 40, 90])
    assert f is None and "final frame" in note, f"selftest: last-frame peak not refused: {f} {note}"

    # 5. a frame with NO art at all scores as a large negative, so it can never win the argmax
    r2 = forward_reach(_synth(4, [10, 40, None, None]), 320, 4)
    assert r2[2] < NEG and r2[3] < NEG, f"selftest: empty frames must score negative, got {r2}"
    assert contact_frame(r2)[0] is None, "selftest: one moving frame is not enough to decide"

    # 6. the uniform-playback window maps ticks to frames the way FighterSprite/showFrame does
    assert active_render_window(4, 3, 6, 15) == (1, 2), "selftest: window mapping wrong"
    assert active_render_window(0, 1, 4, 10) == (0, 0), "selftest: zero-startup window wrong"

    # 7. and the whole pipeline agrees on a sheet built to strike on frame 2 of 4
    f, _ = contact_frame(forward_reach(_synth(4, [20, 25, 70, 30]), 320, 4))
    lo, hi = active_render_window(6, 3, 4, 21)
    assert f == 2 and not (lo <= f <= hi), "selftest: fixture should read as misaligned"



# ------------------------------------------------------------------------------------------- main

def main() -> int:
    selftest()
    write = "--write" in sys.argv
    reg = json.loads(REGISTRY.read_text(encoding="utf-8"))

    rows, bad = [], 0
    for fid, entry in reg.items():
        if fid.startswith("_") or not isinstance(entry, dict) or "render" not in entry:
            continue
        render, data = entry["render"], entry["data"]
        fw = render["frameWidth"]
        for state, key in ATTACK_STATE_TO_KEY.items():
            sh, atk = render["sheets"][state], data["attacks"][key]
            n = sh["frames"]
            total = atk["startup"] + atk["active"] + atk["recovery"]
            path = PUBLIC / sh["path"]
            if not path.exists():
                print(f"MISSING  {fid}/{state}: {path}")
                bad += 1
                continue
            reach = forward_reach(np.array(Image.open(path).convert("RGBA")), fw, n)
            peak, note = contact_frame(reach)
            lo, hi = active_render_window(atk["startup"], atk["active"], n, total)

            if peak is None:
                status = "INDETERMINATE"
            elif lo <= peak <= hi:
                status = "ALIGNED"
            else:
                status = "MISALIGNED"
            rows.append((fid, state, n, total, lo, hi, peak, status, note, reach))

            if write:
                # `startup > PLAY_LAG_TICKS`, matching validate-character.ts and anim-timing.ts:
                # the wind-up segment is budgeted startup-1 ticks, so a startup of 1 would record a
                # contact frame the renderer then silently refuses to use.
                if peak is not None and 0 < peak < n and atk["startup"] > PLAY_LAG_TICKS:
                    sh["hit"] = peak
                else:
                    sh.pop("hit", None)  # never leave a stale measurement behind

    w = max(len(f"{r[0]}/{r[1]}") for r in rows) if rows else 20
    for fid, state, n, total, lo, hi, peak, status, note, reach in rows:
        print(f"{status:13} {fid + '/' + state:<{w}}  frames={n} ticks={total} "
              f"uniform-active-frames={lo}..{hi} contact={peak}  reach={reach}  ({note})")

    n_mis = sum(1 for r in rows if r[7] == "MISALIGNED")
    n_ind = sum(1 for r in rows if r[7] == "INDETERMINATE")
    n_ok = sum(1 for r in rows if r[7] == "ALIGNED")
    print(f"\n{len(rows)} attack sheets: {n_ok} aligned, {n_mis} misaligned, {n_ind} indeterminate")

    if write:
        REGISTRY.write_text(json.dumps(reg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        placed = sum(1 for r in rows if r[6] is not None)
        print(f"wrote {placed} contact frames into {REGISTRY.relative_to(ROOT)}")
        return 1 if bad else 0

    # Without --write the gate judges the SHIPPED registry against the CURRENT art. Every row is
    # checked, not just the misaligned ones: `hit` retimes the animation whatever the status, so a
    # declaration left behind by since-changed art is exactly as wrong as a missing one — and it
    # would go unnoticed if the new art happened to measure as ALIGNED or INDETERMINATE.
    unfixed = 0
    for fid, state, n, total, lo, hi, peak, status, note, reach in rows:
        declared = reg[fid]["render"]["sheets"][state].get("hit")
        if declared == peak:
            continue
        if peak is None:
            print(f"STALE    {fid}/{state}: declares hit={declared} but the measurement is indeterminate ({note})")
        elif declared is None:
            print(f"UNFIXED  {fid}/{state}: contact frame {peak} but the registry declares no hit")
        else:
            print(f"STALE    {fid}/{state}: declares hit={declared} but the art now peaks at {peak}")
        unfixed += 1
    if unfixed:
        print(f"\n{unfixed} sheet(s) disagree with their art. Run with --write.")
    return 1 if (bad or unfixed) else 0


if __name__ == "__main__":
    raise SystemExit(main())
