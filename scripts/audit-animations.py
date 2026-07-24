#!/usr/bin/env python3
"""Roster-wide animation audit: does each sheet MOVE, and does it last as long as the move it depicts?

This is a REPORT, not a gate — it always exits 0 unless a metric self-test fails. The enforcing checks
live elsewhere and are deliberately narrower: `check-sprites.py` fails an attack sheet under
MOTION_MIN, and `anim-timing.test.ts` fails a length that drifts from its sim duration. What this adds
is the whole-roster view those two can't give, in the units a regeneration decision is made in.

Three failure modes, each of which has shipped:

  barely-moves  The strike is not in the art. `monk/crouchLight` was four identical squats, so the sim
                ran a live hit box for 16 ticks over a still image.
  dead frames   The action finishes early and the remaining sampled frames repeat a held pose. The
                clip is 4s and `gen-sprite-videos.sh` samples N frames EVENLY across all of it, so a
                punch thrown in the first second spends the rest of the sheet frozen; a 6-frame sheet
                carries 3 distinct poses. Invisible to a PEAK metric, which only needs one good frame.
  wrong length  The art does not span the state. Every non-attack sheet was authored at a flat
                `fps: 8`: knockdown got 750ms for a 300ms state, so playback was cut at frame 2 of 6 —
                and the fall is frames 3-5. Fixed in code (see `anim-timing.ts`); this reports the
                ratio so an art change that alters a frame COUNT is visible here too.

Deps: Pillow + numpy.  Run: `python scripts/audit-animations.py`  (npm run audit:anim)
"""
from __future__ import annotations
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CELL_W, CELL_H = 320, 256
TICK_HZ = 60
TICK_MS = 1000 / TICK_HZ

# An adjacent pair changing less than this is the same pose twice: a sampled frame carrying no new
# information. Measured on the shipped roster, real adjacent motion runs 0.03-1.5 and true duplicates
# sit at 0.00-0.01, so the boundary is wide and 0.02 is not a tuned number.
DEAD = 0.02
# check-sprites.py's enforced floor, mirrored so the two reports agree.
MOTION_MIN = 0.20

ATTACK_KEY = {
    "attackLight": "light", "attackHeavy": "heavy",
    "airLight": "airLight", "airHeavy": "airHeavy",
    "crouchLight": "crouchLight", "crouchHeavy": "crouchHeavy",
}
# Held or looping: they repeat until the player stops, so there is no duration to check them against.
OPEN_ENDED = {"idle", "walkF", "walkB", "crouch", "block", "blockCrouch", "ko"}
# Of those, the ones that genuinely CYCLE: a repeated pose here is a stutter the player sees on loop.
LOOPING = {"idle", "walkF", "walkB"}
STUN_TICKS = {"knockdown": 18}  # fixed by Fighter.onLand; hitstun/blockstun come from the attack


def cell_masks(path: Path, n: int) -> list[np.ndarray]:
    a = np.asarray(Image.open(path).convert("RGBA"))
    return [a[:, i * CELL_W:(i + 1) * CELL_W, 3] > 32 for i in range(n)]


def change(a: np.ndarray, b: np.ndarray, area: int) -> float:
    """Symmetric silhouette difference as a fraction of the reference frame's own area (scale-free)."""
    return float((a ^ b).sum()) / area if area else 0.0


def amplitude(ms: list[np.ndarray]) -> float:
    """Peak change vs frame 0 — 'does the strike happen at all'. Same metric check-sprites.py gates on.

    It measures SILHOUETTE AREA, so it under-reads motion that happens inside the outline, and that
    makes it the wrong metric for an idle: a good fighting idle deliberately keeps its silhouette,
    moving arms, torso and weight while the head stays at one height. Chasing a higher number here
    produced a brawler who squatted twice a second ("why can the characters not stay idle by
    standing"), and the honest version scores 0.15. Only the ATTACK sheets are gated on this; for
    idle, read the steps and LOOK at the contact sheet.
    """
    area = int(ms[0].sum())
    return max((change(c, ms[0], area) for c in ms[1:]), default=0.0)


def steps(ms: list[np.ndarray]) -> list[float]:
    """Per-adjacent-pair change — 'is every frame doing work'. A peak cannot see a frozen tail."""
    area = int(ms[0].sum())
    return [change(ms[i], ms[i + 1], area) for i in range(len(ms) - 1)]


def figure_height(m: np.ndarray) -> int:
    ys = np.where(m.any(axis=1))[0]
    return int(ys.max() - ys.min() + 1) if ys.size else 0


def sim_ms(fid: str, state: str, data: dict, reg: dict) -> float | None:
    """How long the SIM holds this state, or None when it is open-ended."""
    if state in ATTACK_KEY:
        a = data["attacks"][ATTACK_KEY[state]]
        return (a["startup"] + a["active"] + a["recovery"]) * TICK_MS
    if state in STUN_TICKS:
        return STUN_TICKS[state] * TICK_MS
    if state in ("hitstun", "blockstun"):
        # Chosen by the ATTACKER's move, so report the mean over every attack that could cause it.
        key = state
        vals = [atk[key] for oid, e in reg.items()
                if not oid.startswith("_") and oid != fid
                for atk in e["data"]["attacks"].values()]
        return sum(vals) / len(vals) * TICK_MS if vals else None
    if state in ("jumpRise", "jumpFall"):
        s = data["stats"]
        return s["jumpVelocity"] / s["gravity"] * 1000 if s["gravity"] > 0 else None
    return None


def selftest() -> None:
    """A wrong metric is more dangerous than no metric (Phase 04). Fixtures before any judgement."""
    blank = np.zeros((CELL_H, CELL_W), bool)
    stand = blank.copy(); stand[CELL_H - 140:, 150:170] = True
    punch = stand.copy(); punch[CELL_H - 130:CELL_H - 110, 170:260] = True

    assert amplitude([stand, stand.copy()]) == 0.0, "identical frames must score 0"
    assert amplitude([stand, punch]) > MOTION_MIN, "an extended limb must clear the floor"
    # PEAK must survive a return to guard, which is exactly why it cannot see a frozen tail.
    assert amplitude([stand, punch, stand.copy()]) == amplitude([stand, punch]), "peak must be the max"

    # ...and STEPS must see it. This pair is the whole reason both metrics exist: identical amplitude,
    # opposite verdicts.
    good = steps([stand, punch, stand.copy()])
    frozen = steps([stand, punch, punch.copy()])
    assert sum(1 for s in good if s < DEAD) == 0, "a jab that returns to guard has no dead frame"
    assert sum(1 for s in frozen if s < DEAD) == 1, "a held final pose IS a dead frame"

    assert figure_height(stand) == 140, f"height must span the opaque rows, got {figure_height(stand)}"
    assert figure_height(blank) == 0, "an empty frame has no height"
    # A single frame cannot animate, and must not raise.
    assert amplitude([stand]) == 0.0 and steps([stand]) == [], "a one-frame sheet is inert"


def main() -> int:
    selftest()
    reg = json.loads((ROOT / "public/configs/character-gym.json").read_text())
    print(f"{'fighter/state':<24}{'fr':>3}{'amp':>7}{'minstep':>9}{'dead':>5}"
          f"{'art':>7}{'sim':>7}{'ratio':>7}  height %idle / notes")
    flagged = 0
    for fid, entry in reg.items():
        if fid.startswith("_"):
            continue
        sheets, data = entry["render"]["sheets"], entry["data"]
        idle = sheets["idle"]
        idle_h = max(figure_height(m) for m in cell_masks(ROOT / "public" / idle["path"], idle["frames"]))
        for state, meta in sheets.items():
            n = meta["frames"]
            ms = cell_masks(ROOT / "public" / meta["path"], n)
            amp, st = amplitude(ms), steps(ms)
            dead = sum(1 for s in st if s < DEAD)
            sim = sim_ms(fid, state, data, reg)
            # The renderer derives the rate for everything that is not open-ended, so its art length
            # equals the sim length by construction; the authored fps is what the OPEN_ENDED ones use.
            art = n / meta["fps"] * 1000 if state in OPEN_ENDED else sim

            # A repeated pose is only a DEFECT where the sheet had something left to show. Settling is
            # correct behaviour for a state that ends at rest: `ko` lies still, `knockdown` stops on
            # the ground, `crouch` holds the crouch, and an attack's last pair is its recovery hold.
            # Flagging those would bury the real ones (23 sheets vs 6 when this rule was added).
            trailing = len(st) - 1
            bad_dead = sum(1 for i, s in enumerate(st)
                           if s < DEAD and not (i == trailing and state not in LOOPING))
            notes = []
            if state in ATTACK_KEY and amp < MOTION_MIN:
                notes.append(f"BARELY-MOVES (<{MOTION_MIN})")
            if bad_dead:
                notes.append(f"{bad_dead}/{len(st)} DEAD-PAIR")
            if notes:
                flagged += 1
            hs = "/".join(str(figure_height(m) * 100 // idle_h) for m in ms)
            ratio = f"{art / sim:.2f}" if art and sim else "  -"
            print(f"{fid + '/' + state:<24}{n:>3}{amp:>7.2f}{min(st) if st else 0:>9.2f}{dead:>5}"
                  f"{art or 0:>7.0f}{sim or 0:>7.0f}{ratio:>7}  {hs}"
                  + ("  " + " ".join(notes) if notes else ""))
            if notes:
                print(f"{'':<24}   steps " + " ".join(f"{s:.2f}" for s in st))
    print(f"\naudit-animations: {flagged} sheet(s) flagged for review "
          f"(advisory -- regenerate with scripts/gen-sprite-videos.sh <fighter> <state>)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
