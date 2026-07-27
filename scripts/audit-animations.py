#!/usr/bin/env python3
"""Roster-wide animation audit: does each sheet MOVE, and does it last as long as the move it depicts?

This is a REPORT, not a gate — it always exits 0 unless a metric self-test fails. The enforcing checks
live elsewhere and are deliberately narrower: `check-sprites.py` fails an attack sheet under
MOTION_MIN, and `anim-timing.test.ts` fails a length that drifts from its sim duration. What this adds
is the whole-roster view those two can't give, in the units a regeneration decision is made in.

Four failure modes, each of which has shipped:

  barely-moves  The strike is not in the art. `monk/crouchLight` was four identical squats, so the sim
                ran a live hit box for 16 ticks over a still image.
  held-frozen   The same thing in a HELD LOOPING guard, which `MOTION_MIN` never covered because it is
                only applied to attack states. monk/blockCrouch (0.05) and jiujitsu/blockCrouch (0.06)
                shipped as four identical frames — "the crouch block does not move" — with every gate
                green, because nothing measured them at all.
  dead frames   The action finishes early and the remaining sampled frames repeat a held pose. The
                clip is 4s and `gen-sprite-videos.sh` samples N frames EVENLY across all of it, so a
                punch thrown in the first second spends the rest of the sheet frozen; a 6-frame sheet
                carries 3 distinct poses. Invisible to a PEAK metric, which only needs one good frame.
  unreadable    The art spans its state exactly and is still too fast to see. Length is no longer the
                interesting question — the renderer derives it — so the `drawn` column reports the
                poses actually DRAWN and the ticks each gets. brawler/attackLight scored a perfect
                1.00 on the old art/sim ratio while spending three wind-up frames on ONE tick each
                (16.7ms, a single refresh). That ratio was 1.00 BY CONSTRUCTION for every derived
                state and could never fail; see `drawn_poses`.

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
# ...and the same idea for a HELD LOOPING guard, which MOTION_MIN never covered because it is only
# applied to ATTACK states. That gap is exactly why monk/blockCrouch (0.05) and jiujitsu/blockCrouch
# (0.06) shipped reading as frozen stills with every gate green. A held guard should breathe, not
# swing, so it gets its own much lower floor: brawler/blockCrouch sits at 0.12 and reads as alive,
# the other two did not, so the line goes between them.
HELD_MOTION_MIN = 0.10
HELD_LOOPING = {"blockCrouch"}  # the only state that is BOTH held and looping (block is a one-shot hold)

ATTACK_KEY = {
    "attackLight": "light", "attackHeavy": "heavy",
    "airLight": "airLight", "airHeavy": "airHeavy",
    "crouchLight": "crouchLight", "crouchHeavy": "crouchHeavy",
    "special": "special",
}
# Held or looping: they repeat until the player stops, so there is no duration to check them against.
OPEN_ENDED = {"idle", "walkF", "walkB", "crouch", "block", "blockCrouch", "ko"}
# Of those, the ones that genuinely CYCLE: a repeated pose here is a stutter the player sees on loop.
LOOPING = {"idle", "walkF", "walkB"}
# `Fighter.onLand` assigns 18, but the RENDERER never sees 18: onLand fires inside `integrate`, which
# precedes `advanceTimers` in the same tick with no hitstop to bail on, so the render pass reads 17 —
# and the state also lasts exactly 17 more ticks. 17 is what `stunFrameRate` is handed and what the
# animation spans, so it is what this report must model. Pinned by regression test R-12.
STUN_TICKS = {"knockdown": 17}


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
        # Mirrors attackSimTicks() in src/sim/types.ts: a `repeat` attack is `count` active windows
        # with `gap` ticks between them, not one. Miss this and a multi-hit special is reported as
        # having far more art than move, which is the exact false alarm this audit exists to avoid.
        rep = a.get("repeat") or {}
        count, gap = rep.get("count", 1), rep.get("gap", 0)
        ticks = a["startup"] + count * a["active"] + (count - 1) * gap + a["recovery"]
        return ticks * TICK_MS
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


# Fewest ticks a drawn pose may occupy before it is a flicker rather than a pose. Mirrors
# MIN_POSE_TICKS_ATTACK / MIN_POSE_TICKS_STUN in src/render/anim-timing.ts.
MIN_POSE_TICKS = {"attack": 2, "stun": 3}


def drawn_poses(state: str, meta: dict, data: dict, sim: float | None) -> tuple[int, float] | None:
    """(poses actually drawn, ticks the SHORTEST-lived drawn pose gets) — None if open-ended.

    The second value is deliberately the MINIMUM and not an average. An attack has two segments with
    different dwells — brawler/attackLight draws its single wind-up pose for 3 ticks and each strike
    pose for 4 — so one "ticks each gets" number is a lie whichever segment it comes from. The minimum
    is the one that answers the question the column exists for: is any pose too brief to see.

    The column this REPLACES was `art / sim`, which for every derived state was 1.00 by construction:
    the renderer derives its rate from the sim duration, so re-deriving it here only ever compared the
    formula with itself. That is the code-checked-against-code failure the rest of this file exists to
    avoid, sitting inside the audit.

    Poses-and-dwell is information the ratio never carried. A sheet can span its state exactly and
    still be unreadable — brawler/attackLight spent its three wind-up frames on ONE tick each (16.7ms,
    a single refresh at 60Hz) while measuring a perfect 1.00 — so anim-timing.ts now draws fewer poses
    rather than flashing them all, and this reports what survives.
    """
    if sim is None or state in OPEN_ENDED:
        return None
    n, ticks = meta["frames"], sim / TICK_MS
    if state in ATTACK_KEY:
        a = data["attacks"][ATTACK_KEY[state]]
        hit = meta.get("hit")
        rep = a.get("repeat") or {}
        if hit is None or rep.get("count", 1) > 1 or not 0 < hit < n:
            return n, ticks / n           # uniform timing: no wind-up segment to trim
        wind = a["startup"] - 1           # PLAY_LAG_TICKS
        if wind <= 0:
            return n, ticks / n
        drawn_wind = min(hit, max(1, wind // MIN_POSE_TICKS["attack"]))
        strike_poses = n - hit
        strike_dwell = (ticks - wind) / strike_poses if strike_poses else wind / drawn_wind
        return n - (hit - drawn_wind), min(wind / drawn_wind, strike_dwell)
    if state in ("hitstun", "blockstun", "knockdown"):
        drawn = min(n, max(1, int(ticks) // MIN_POSE_TICKS["stun"]))
        return drawn, ticks / drawn
    return n, ticks / n                   # jumps: no trimming, straight division


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

    # drawn_poses must mirror src/render/anim-timing.ts. It is a DUPLICATE of that rule in another
    # language, so it can drift silently — and it did on first writing, in two ways this pins:
    #   * knockdown was modelled at the 18 ticks onLand assigns instead of the 17 the renderer is
    #     handed, reporting 6 poses where 5 are drawn;
    #   * an attack reported its total pose count next to its WIND-UP dwell, so the two numbers
    #     described different halves of the animation.
    d = {"stats": {}, "attacks": {"light": {"startup": 4, "active": 3, "recovery": 8}}}
    got = drawn_poses("attackLight", {"frames": 6, "fps": 14, "hit": 3}, d, 15 * TICK_MS)
    # 3 wind-up ticks afford ONE pose at floor 2, so 4 of 6 poses are drawn; the shortest-lived of
    # them is that wind-up pose at 3.0 ticks, against 4.0 for each strike pose.
    assert got == (4, 3.0), f"attack drawn_poses drifted: {got}"
    kd = drawn_poses("knockdown", {"frames": 6, "fps": 8}, d, STUN_TICKS["knockdown"] * TICK_MS)
    assert kd is not None and kd[0] == 5 and abs(kd[1] - 17 / 5) < 1e-9, \
        f"knockdown must model the 17 renderable ticks, not the 18 assigned: {kd}"
    # A window with room for every pose is left alone, and an open-ended state is not judged at all.
    assert drawn_poses("hitstun", {"frames": 4, "fps": 8}, d, 12 * TICK_MS) == (4, 3.0)
    assert drawn_poses("blockCrouch", {"frames": 4, "fps": 8}, d, None) is None


def main() -> int:
    selftest()
    reg = json.loads((ROOT / "public/configs/character-gym.json").read_text())
    print(f"{'fighter/state':<24}{'fr':>3}{'amp':>7}{'minstep':>9}{'dead':>5}"
          f"{'art':>7}{'sim':>7}{'drawn':>10}  height %idle / notes")
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
            # Only the OPEN_ENDED states have an art length independent of the sim: everything else
            # has its rate DERIVED from the sim duration, so printing both columns just showed the
            # same number twice (which is what made the old art/sim ratio 1.00 by construction).
            art = n / meta["fps"] * 1000 if state in OPEN_ENDED else None
            drawn = drawn_poses(state, meta, data, sim)

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
            if state in HELD_LOOPING and amp < HELD_MOTION_MIN:
                notes.append(f"HELD-FROZEN amp {amp:.2f} (<{HELD_MOTION_MIN}) -- a looping held guard "
                             f"that never changes reads as a still image")
            if bad_dead:
                notes.append(f"{bad_dead}/{len(st)} DEAD-PAIR")
            if notes:
                flagged += 1
            hs = "/".join(str(figure_height(m) * 100 // idle_h) for m in ms)
            # Poses actually DRAWN and the ticks each gets, replacing an `art/sim` ratio that was
            # 1.00 by construction for every derived state (see drawn_poses).
            pose_s = f"{drawn[0]}p@{drawn[1]:.1f}t" if drawn else "     -"
            art_s = f"{art:.0f}" if art else "-"
            sim_s = f"{sim:.0f}" if sim else "-"
            print(f"{fid + '/' + state:<24}{n:>3}{amp:>7.2f}{min(st) if st else 0:>9.2f}{dead:>5}"
                  f"{art_s:>7}{sim_s:>7}{pose_s:>10}  {hs}"
                  + ("  " + " ".join(notes) if notes else ""))
            if notes:
                print(f"{'':<24}   steps " + " ".join(f"{s:.2f}" for s in st))
    print(f"\naudit-animations: {flagged} sheet(s) flagged for review "
          f"(advisory -- regenerate with scripts/gen-sprite-videos.sh <fighter> <state>)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
