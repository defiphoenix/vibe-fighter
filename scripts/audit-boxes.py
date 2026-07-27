#!/usr/bin/env python3
"""Box-vs-ART audit. The gap CLAUDE.md has named since Phase 12 and that shipped a bug in Phase 15.

A box is a CLAIM ABOUT A SPRITE, and nothing in `scripts/` ever compared the two. The whole suite is
code checked against code, so both of these shipped green:

  * the ground heavy, with `body:"crouch"` and a shin-height hit box on top of a standing punch —
    the top ~40% of the attacker was invulnerable mid-heavy;
  * the jiujitsu `special`, a spinning FLOOR SWEEP carrying a chest-height hit box, so you blocked
    it by standing up. Inverted, not merely off.

This measures the two claims an attack's boxes make about its own sheet:

  A. HURT height vs the figure.  `body` picks hurtStand/hurtCrouch/hurtAir; compare that box's `h`
     against the tallest frame of the state's own sheet. A box far SHORTER than the art means part
     of the fighter is invulnerable; far TALLER means he is hit by things that visibly miss.
  B. HIT band vs where the strike actually IS.  Compare `hit.y .. hit.y+hit.h` against the y band of
     the striking limb. Report NO OVERLAP — the box describes a strike the art does not make.

Metric traps this is built around (all learned the expensive way, CLAUDE.md "Measure the claim"):
  * The obvious metric is the WRONG one. Furthest opaque column measures the whole silhouette, and
    for a wide-stanced fighter that is a planted leg. Every frame is differenced against frame 0 so
    only what MOVED is measured.
  * A sheet the metric cannot call reports INDETERMINATE and is not judged. Never a guessed number.
  * Sprite pixels and box units are 1:1 (build-sprites.py scales each fighter to a 185px figure and
    `stats.scale` is applied after authoring), and the sprite is feet-anchored, so local y is
    measured up from the figure's own lowest opaque row.

ADVISORY, exit 0 — like audit:anim, and for the same reason. Four shipped sheets fail metric B today
and each needs an art or a design decision, not a silent number change; a red gate nobody can make
green just gets bypassed. The HARD enforcement of high/low semantics lives in
`src/sim/registry.test.ts`'s blocking matrix, which is a real red gate.

Runs synthetic fixtures first: a wrong metric is more dangerous than no metric.
Deps: Pillow + numpy.  Run: `python scripts/audit-boxes.py`  (npm run audit:boxes)
"""
from __future__ import annotations
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CELL_W, CELL_H = 320, 256
ALPHA = 32          # same opacity floor check-sprites.py uses
EDGE_COLS = 7       # width of the column window sampled at the strike's leading edge

# state -> the AttackKey whose data describes it (types.ts ATTACK_STATE_TO_KEY).
ATTACK_STATE_TO_KEY = {
    "attackLight": "light", "attackHeavy": "heavy",
    "airLight": "airLight", "airHeavy": "airHeavy",
    "crouchLight": "crouchLight", "crouchHeavy": "crouchHeavy",
    "special": "special",
}
BODY_TO_HURT = {"stand": "hurtStand", "crouch": "hurtCrouch", "air": "hurtAir"}

# Metric A tolerance. Measured across the shipped roster before being chosen: the standing states sit
# within +-3% and the crouch/air states run -10% to -41%, because a crouch profile is authored to the
# body and the ART of a crouch varies hugely between fighters. So a tight bound would flag most of the
# roster and mean nothing. This flags only the case the ground heavy actually was — a box so much
# shorter than the art that a visible part of the fighter has no hurt box at all.
HURT_SHORT_FRAC = 0.45   # box shorter than 55% of the figure: a large chunk is invulnerable
HURT_TALL_FRAC = 0.20    # box more than 20% TALLER than the art: hit by things that miss

# Metric C tolerance. Metrics A and B are both VERTICAL; nothing here or anywhere else in scripts/
# ever measured whether the box reaches forward as far as the fist does. It does not: measured across
# all 21 shipped attack sheets, every single box far edge overshoots its own drawn limb, and at the
# furthest separation each attack still connects the fist sits 14-92px short of the defender's body.
#
# The number that matters to a player is that VISIBLE gap, not the raw overshoot, because a hit box
# legitimately has to reach the defender's HURT box rather than his skin. So:
#     visible air = (hit.x + hit.w + defender hurt half) - defender silhouette half - own limb reach
# Both defender terms are properties of whoever is being hit, so a roster-wide audit uses the
# narrowest standing hurt box (30px half) and a representative silhouette half (44px) — the report is
# a ranking, and `src/sim/reach-parity.test.ts` owns the real per-matchup enforcement.
DEF_HURT_HALF = 30       # narrowest hurtStand half-width across the roster
DEF_SILHOUETTE_HALF = 44 # median drawn half-width of a standing fighter, measured from the idle sheets
AIR_GAP_MAX = 60         # px of empty space at max connect range before a box reads as disconnected


def cells(sheet: np.ndarray, n: int) -> list[np.ndarray]:
    return [sheet[:, i * CELL_W:(i + 1) * CELL_W, 3] > ALPHA for i in range(n)]


def figure_height(masks: list[np.ndarray]) -> tuple[int, int]:
    """(tallest figure height, the feet row) — the sprite is feet-anchored, so that row is y=0."""
    feet = max(int(np.where(m.any(axis=1))[0].max()) for m in masks if m.any())
    top = min(int(np.where(m.any(axis=1))[0].min()) for m in masks if m.any())
    return feet - top, feet


def strike_reach(masks: list[np.ndarray]) -> int | None:
    """How far forward, in px past the cell's centre line, the striking limb ever gets.

    Metric C's input, and the same differenced-against-frame-0 trick as `strike_band`: the furthest
    opaque column full stop measures a planted leg, not the fist. Mirrors `forward_reach` in
    check-attack-sync.py, which uses it to pick the contact frame.
    """
    base = masks[0]
    mid = CELL_W // 2
    best = None
    for m in masks[1:]:
        moved = m & ~base
        if not moved.any():
            continue
        far = int(np.where(moved.any(axis=0))[0].max()) - mid
        best = far if best is None else max(best, far)
    return best


def strike_band(masks: list[np.ndarray], feet: int) -> tuple[int, int] | None:
    """Local-y band of the STRIKING limb, or None when the sheet cannot be called.

    Differenced against frame 0 so a planted leg (the widest thing in a wide stance) is excluded; the
    band is read off the leading EDGE_COLS columns of what moved, which is the limb doing the hitting.
    """
    base = masks[0]
    lo, hi = [], []
    for m in masks[1:]:
        moved = m & ~base
        if not moved.any():
            continue
        far = int(np.where(moved.any(axis=0))[0].max())
        rows = np.where(moved[:, max(0, far - EDGE_COLS + 1):far + 1].any(axis=1))[0]
        lo.append(feet - int(rows.max()))
        hi.append(feet - int(rows.min()))
    if not lo:
        return None  # nothing moved on any frame: check:sprites' MOTION gate owns that failure
    return min(lo), max(hi)


def audit_state(fid: str, state: str, data: dict, sheet_path: Path, frames: int) -> list[str]:
    key = ATTACK_STATE_TO_KEY[state]
    atk = data["attacks"][key]
    hurt = data["boxes"][BODY_TO_HURT[atk["body"]]][0]
    masks = cells(np.array(Image.open(sheet_path).convert("RGBA")), frames)
    fig, feet = figure_height(masks)
    band = strike_band(masks, feet)
    reach = strike_reach(masks)
    hit_lo, hit_hi = atk["hit"]["y"], atk["hit"]["y"] + atk["hit"]["h"]
    hit_far = atk["hit"]["x"] + atk["hit"]["w"]
    # Furthest separation this attack still connects at, minus where the defender is actually DRAWN.
    air = None if reach is None else (hit_far + DEF_HURT_HALF) - DEF_SILHOUETTE_HALF - reach

    notes = []
    if hurt["h"] < fig * HURT_SHORT_FRAC:
        notes.append(f"HURT-SHORT body={atk['body']} h={hurt['h']} vs figure {fig}px "
                     f"({hurt['h'] / fig:.0%}) -- the top of him has no hurt box")
    if hurt["h"] > fig * (1 + HURT_TALL_FRAC):
        notes.append(f"HURT-TALL body={atk['body']} h={hurt['h']} vs figure {fig}px "
                     f"({hurt['h'] / fig:.0%}) -- hit by attacks that visibly miss")
    if band is None:
        notes.append("INDETERMINATE -- nothing moved against frame 0; the hit band cannot be judged")
    elif hit_hi < band[0] or hit_lo > band[1]:
        where = "below" if hit_hi < band[0] else "above"
        notes.append(f"HIT-MISS box {hit_lo}..{hit_hi} is entirely {where} the strike at "
                     f"{band[0]}..{band[1]}px -- the box describes a blow the art does not throw")

    if air is not None and air > AIR_GAP_MAX:
        notes.append(f"REACH-GAP box far edge {hit_far}px vs limb {reach}px -- connects with ~{air}px "
                     f"of empty air at max range (over {AIR_GAP_MAX})")

    band_s = f"{band[0]:3d}..{band[1]:3d}" if band else "    ?    "
    reach_s = f"{reach:3d}" if reach is not None else "  ?"
    air_s = f"{air:4d}" if air is not None else "   ?"
    status = "OK" if not notes else "FLAG"
    print(f"  {fid + '/' + state:24} {atk['body']:6} hurt {hurt['h']:3d}/{fig:3d}  "
          f"hit {hit_lo:3d}..{hit_hi:3d}  strike {band_s}  "
          f"far {hit_far:3d}/limb {reach_s}  air {air_s}  {status}")
    return [f"{fid}/{state}: {n}" for n in notes]


# --- fixtures: a wrong metric is more dangerous than no metric ----------------------------------

def _sheet(poses: list[tuple[int, int, int, int]]) -> np.ndarray:
    """Build a synthetic sheet; each pose is (body_top, body_bottom, arm_row, arm_reach) in rows/cols
    measured from the top of the cell. Body is a fixed column block, arm a horizontal bar."""
    out = np.zeros((CELL_H, CELL_W * len(poses), 4), np.uint8)
    for i, (top, bottom, arm_row, reach) in enumerate(poses):
        c = out[:, i * CELL_W:(i + 1) * CELL_W]
        c[top:bottom, 150:170, 3] = 255
        if reach:
            c[arm_row:arm_row + 6, 170:170 + reach, 3] = 255
    return out


def selftest() -> None:
    BOT, TOPROW, ARM = 200, 60, 100          # feet row (exclusive), body top, the arm's row
    feet_row, fig_h = BOT - 1, BOT - 1 - TOPROW

    # A jab: body TOPROW..BOT, arm out at row ARM. Its local band must contain the arm's own height.
    masks = cells(_sheet([(TOPROW, BOT, 0, 0), (TOPROW, BOT, ARM, 60), (TOPROW, BOT, ARM, 60)]), 3)
    fig, feet = figure_height(masks)
    assert (fig, feet) == (fig_h, feet_row), (fig, feet)
    band = strike_band(masks, feet)
    arm_y = feet_row - ARM
    assert band is not None and band[0] <= arm_y <= band[1], (band, arm_y)

    # THE trap, and the reason this differences against frame 0: a PLANTED LEG that reaches further
    # forward than the striking arm is the widest thing in frame on every frame, so a "furthest
    # opaque column" metric would report the ankle as the strike. It is static, so differencing
    # removes it — the band must come back at the arm, not down at the leg.
    wide = _sheet([(TOPROW, BOT, 190, 120)] * 3)
    for i in (1, 2):  # the arm exists only on the later frames, so only it MOVED
        wide[ARM:ARM + 6, i * CELL_W + 170:i * CELL_W + 230, 3] = 255
    wm = cells(wide, 3)
    _, wfeet = figure_height(wm)
    wband = strike_band(wm, wfeet)
    assert wband is not None and wband[0] >= arm_y - 6, \
        f"the static planted leg was measured as the strike: {wband} (arm sits at {arm_y})"

    # A frozen sheet cannot be called at all — INDETERMINATE, never a guessed number.
    frozen = cells(_sheet([(TOPROW, BOT, ARM, 60)] * 3), 3)
    _, ffeet = figure_height(frozen)
    assert strike_band(frozen, ffeet) is None, "an unmoving sheet must be INDETERMINATE"

    # ...and the defect this whole script exists for: the jiujitsu's shipped sweep box (6..48) sits
    # entirely below a strike thrown at chest height, which is what HIT-MISS has to catch.
    assert 48 < band[0], f"fixture drift: a low box must sit under this strike band {band}"

    # Metric C. `_sheet` draws the arm across columns 170..170+reach, so a 60px arm ends at column
    # 229 — that is 69px past the cell's centre line (CELL_W//2 == 160).
    ARM_TIP = 170 + 60 - 1 - CELL_W // 2
    assert strike_reach(masks) == ARM_TIP, strike_reach(masks)
    # The same planted-leg trap as the band metric, and the one that matters most here: in `wide` the
    # static leg reaches column 289 — 60px FURTHER forward than the arm — on every frame including
    # frame 0. A "furthest opaque column" reach would report 129 and call the box honest when it is
    # not. Differencing must give the arm.
    assert strike_reach(wm) == ARM_TIP, \
        f"the static planted leg was measured as the reach: {strike_reach(wm)} (arm tip is {ARM_TIP})"
    assert strike_reach(frozen) is None, "an unmoving sheet has no measurable reach"
    print("audit-boxes selftest: 6 fixtures OK (jab band, planted-leg trap, frozen sheet, "
          "low-box-vs-high-strike, forward reach, reach planted-leg trap)")


def main() -> int:
    selftest()
    reg = json.loads((ROOT / "public/configs/character-gym.json").read_text(encoding="utf-8"))
    flags: list[str] = []
    print("\n  sheet                    body   hurt h/fig   hit band    strike band  "
          "far/limb      air")
    for fid, entry in reg.items():
        if not isinstance(entry, dict) or "data" not in entry:
            continue  # "_doc"
        for state in ATTACK_STATE_TO_KEY:
            sheet = ROOT / "public" / entry["render"]["sheets"][state]["path"]
            flags += audit_state(fid, state, entry["data"], sheet,
                                 entry["render"]["sheets"][state]["frames"])
    if flags:
        print(f"\n{len(flags)} box/art disagreement(s) -- ADVISORY, each needs an art or a design call:")
        for f in flags:
            print(f"  - {f}")
    else:
        print("\nevery attack box agrees with its own sheet")
    return 0  # advisory by design; see the module docstring


if __name__ == "__main__":
    sys.exit(main())
