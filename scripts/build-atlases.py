"""Keys, measures and packs the Phase 07 UI + prop atlases, then validates what it packed.

This is the first art phase whose output lands in `public/` -- the shipped bundle -- so unlike
Phases 04/05/06 it both authors and installs. It is also the first to emit atlas JSON, on a repo
that had never called `this.load.atlas`.

The governing rule, from the phase spec and from Phase 04's scar tissue: **no generated geometry is
trusted**. nano_banana_pro inflates any requested band/cell size ~3x and will not honour a grid on
request -- Phase 04 asked for a 12% strip and got 40%, reworded for 5% and got 32%, ~7px of movement
per credit spent. So nothing here asks the model to hit a number. Every rect in both JSON files is
either measured from the keyed pixels or chosen by this packer:

  - the bar's height is whatever the art says, scaled to the existing BAR_W (hud.ts:5)
  - the fill slot is FOUND (an enclosed transparent region matching a shape rule), not requested
  - the portrait slot is COMPUTED (the largest 0.7467:1 rect flush with the hole's bottom), so any
    hole the model draws works and there is no "the model missed the aspect" retry
  - prop cells are cropped to a per-prop union bbox, so cell inflation is irrelevant

Reads  concepts/ui/2026-07-17/<id>-raw.png       (opaque, magenta void)
       concepts/props/2026-07-17/<prop>-<n>-raw.png
       ...and each asset's <id>.prompt.txt + <id>.job.json
Writes concepts/{ui,props}/2026-07-17/<id>.png   (keyed, for review)
       concepts/{ui,props}/2026-07-17/_preview.png
       public/ui/hud-atlas.png + hud-atlas.json
       public/props/twilight-atlas.png + twilight-atlas.json

Run: `npm run build:atlases`. Idempotent -- re-keys and re-packs from the raws every time, so a
rerun reproduces byte-identical output. Exits non-zero on any failed assertion. Self-tests its own
metrics first, every run.

`--selftest` runs only the fixtures (no art needed), which is what makes this file safe to develop
before a single credit is spent.
"""

import importlib.util
import json
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
UI = ROOT / "concepts" / "ui" / "2026-07-17"
PROPS = ROOT / "concepts" / "props" / "2026-07-17"
OUT_UI = ROOT / "public" / "ui"
OUT_PROPS = ROOT / "public" / "props"

# ponytail: scipy.ndimage.label is a REAL new dependency reach, and check-characters.py:92-97
# pre-authorised exactly this one -- "scipy.ndimage.label is already importable here (scipy 1.16),
# it is just not worth the dependency reach until a real asset needs it". A real asset now needs it:
# telling the fill slot apart from a decorative aperture is connected-component labelling, and the
# 1-D column projection that sufficed for "is there a second fighter" cannot do it (two holes on the
# same rows read as one run). scipy was already ambient (CLAUDE.md says so); this makes it required
# for `npm run build:atlases`. There is still no requirements.txt -- that gap is the repo's, not this
# script's, and the phase log records the escalation.
_spec = importlib.util.spec_from_file_location("art_gate", ROOT / "scripts" / "art_gate.py")
art_gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(art_gate)
key, despill, l1 = art_gate.key, art_gate.despill, art_gate.l1
KEY_RGB, KEY_LO = art_gate.KEY_RGB, art_gate.KEY_LO
check_job, check_blocks, shared_block = art_gate.check_job, art_gate.check_blocks, art_gate.shared_block

# --- what gets generated -----------------------------------------------------------------------
# id -> aspect. The aspect label lies (`3:4` really returns 1792x2400 = 0.7467:1), so it is only ever
# used to check the job record against itself; the pixel truth comes from params.width/height.
UI_ASSETS = {"health-bar": "21:9", "portrait-base": "3:4", "meter-bar": "21:9"}
PROP_ASPECTS = {"crowd": "16:9", "vents": "1:1", "beacon": "1:1", "steam": "2:3"}
PROP_FRAMES = 4  # frames 1..3 are --image-chained from frame 0, so refs=0 for -0 and refs=1 after

# --- the sim/render constants this art has to live inside ---------------------------------------
# Mirrored, not imported (this is Python, that is TypeScript). Each cites its source so a drift is
# findable. If one of these changes, this gate goes red -- which is the point.
#
# Phase 14 note: the direction of this mirror has REVERSED. These were the HUD's layout constants
# back when the HUD was vector-drawn; hud.ts had in fact already drifted to 360/32/26 by the time
# they were written down. The atlas skin now reads the bar's width, height and slot rect back off the
# packed frames and applies its own BAR_SCALE, so BAR_W below is what the PACKER guarantees the art
# is, and hud.ts is the consumer. Treat it as the contract, not as a copy of a TypeScript literal.
BAR_W = 460     # the width this packer resizes `health-bar` to; src/render/hud.ts scales from it
MARGIN = 40     # layout budget only (the shipped HUD uses its own MARGIN + a portrait plate)
TOP = 34        # ditto -- these two only feed the vertical-budget assertion below
PIP_GAP = 8     # src/render/hud.ts PIP_GAP
PIP_H = 22      # pip font size, src/render/hud.ts
# Phase 15's meter plate rides under the health bar at the same width, so it consumes the same
# vertical budget. Its own art is much shallower (the prompt asks for ~16:1 against the health bar's
# ~8:1), so what this costs the budget is whatever the model actually painted -- measured, not
# assumed, which is why METER_W is a width we impose and the height falls out of the art.
METER_W = BAR_W  # both plates resize to the same width so their bevels line up
METER_GAP = 6   # src/render/hud.ts METER_GAP
# The HUD draws both plates NON-UNIFORMLY at half height (their bezel above and below the slot is
# frame art, not padding, so "thinner and wider" has no uniform-scale answer). The vertical budget
# below has to measure what is DRAWN, not what is packed: on packed heights alone the health bar and
# meter together read as 246px of HUD and the assertion fails on art that in fact fits with 90px to
# spare. src/render/hud.ts:24 BAR_SCALE_Y.
BAR_SCALE_Y = 0.5

# The HUD's vertical budget is DERIVED from the sim, not chosen. CLAUDE.md: check art against the
# sim's real constants, not against how it looks. The first cut of this file used a round 200 and it
# was pure invention. The second used the continuous apex jumpVelocity^2/(2*gravity) = 155.8px -- and
# a review caught that that is the CALCULUS apex, not the one the sim reaches. fighter.ts:127-136
# integrates gravity discretely (semi-implicit Euler at DT=1/60): `vy += g*DT; y += vy*DT` per tick.
# The discrete apex is lower -- 148.3px, not 155.8 -- so the continuous number was 7.4px too strict
# and could false-reject a HUD that clears a real jump. So this mirrors the sim's own integrator
# rather than the textbook formula: the discrete loop IS the clock (hardware is never the ideal on
# paper). What constrains the HUD is the highest a head ever goes = at a jump's apex.
GROUND_Y = 620          # src/sim/constants.ts:11
HURT_STAND_H = 185      # src/sim/config.ts:6
JUMP_VELOCITY = 900     # src/sim/config.ts:68
GRAVITY = 2600          # src/sim/config.ts:69
DT = 1 / 60             # src/sim/constants.ts:3-4


def _discrete_jump_apex() -> float:
    """Peak rise of a jump under the sim's exact discrete integrator (fighter.ts:86,128,136)."""
    y, vy, peak = 0.0, -JUMP_VELOCITY, 0.0
    while True:
        vy += GRAVITY * DT       # fighter.ts:128
        y += vy * DT             # fighter.ts:136
        peak = min(peak, y)
        if y >= 0:               # back on the ground
            return -peak


HUD_BAND_MAX = int(GROUND_Y - _discrete_jump_apex() - HURT_STAND_H)  # 286 -- a jumping head's top edge

# ponytail: 1280 is the VIEWPORT width. src/sim/constants.ts calls it STAGE_WIDTH and it currently
# doubles as both world and canvas (main.ts:8). concepts/backgrounds/README.md:72-82 records that the
# HUD is screen-space but reads the world constant, so the day Phase 08 widens the world to 1696 the
# timer drifts off-centre and P2's bar leaves the screen. Harmless today, load-bearing then. This
# gate measures against the viewport deliberately -- the bar is screen furniture, not world art.
VIEW_W = 1280

# The Phase 06 contract. concepts/portraits/2026-07-17/README.md + 06-select-portraits-log.md:273-281.
# Phase 07 has no other source for these numbers, and check-portraits.py:83-84 warns that a silent
# drift here only surfaces two phases later -- so they are asserted against that gate's own output.
PORTRAIT_W, PORTRAIT_H = 1792, 2400
PORTRAIT_ASPECT = PORTRAIT_W / PORTRAIT_H  # 0.746666...

# 06-select-portraits-log.md:284-293 hands Phase 11 a "~300x400 card". The base is authored at that
# scale so the shipped atlas stays small (native crop would make hud-atlas.png ~1700x2400). This is
# the repo's own recorded number, not a new invention. Re-packing at another scale is one command --
# the masters are the -raw.png files, which are durable provenance, not temp files.
SLOT_TARGET_W = 300

# Props are packed at PROP_MAX_DIM on their longest side, not at the resolution they were generated
# at. Packing native produced a 9828x6800 sheet -- and that is not merely a big file, it is BROKEN:
# it blows past the 8192px max texture size a lot of GPUs report, so the upload fails and nothing
# draws. MAX_ATLAS_DIM below is the actual gate; 2048 is the conservative floor that every WebGL
# implementation in practice supports.
#
# 384 keeps ~3x headroom over the size these are drawn at: the sim's adult is HURT_STAND.h = 185px
# tall (config.ts:6), and these props are described in the prompts against that adult -- the vent is
# "waist-high", the beacon "chest-high", the pipe "knee-high" -- so in game they land around 90-140px.
# ponytail: a single cap, not a per-prop target. Phase 08 owns placement and final scale; if it wants
# a different pack the masters are the -raw.png files and `npm run build:atlases` is one command.
PROP_MAX_DIM = 384
MAX_ATLAS_DIM = 2048

# --- the fill-slot shape rule -------------------------------------------------------------------
# "Exactly one enclosed hole" was the first cut and it was wrong both ways: it rejected a legal
# ornamental frame with decorative apertures, and it would have accepted a decorative hole AS the
# slot on a bar with no real channel. So the slot is identified by shape, and other holes are
# reported rather than fatal.
SLOT_ELONGATION = 3.0    # a health channel is a long horizontal box, not a rivet hole
SLOT_W_FRAC = 0.60       # ...spanning most of the bar
# ...and a real fraction of its height. Placed at 0.40 when the health bar was the only sample
# (its channel measures 43%). Phase 15's meter bar is by DESIGN the shallower plate and its channel
# comes in at 38% — rejected by two points, for being exactly what it was asked to be. Lowered to
# 0.33 on two samples instead of one; the decorative panel lines this floor exists to reject measure
# 1%, so the margin is still two orders of magnitude. Widen it only against a third real bar.
SLOT_H_FRAC = 0.33
SLOT_CENTER_TOL = 0.10   # ...centred on the bar's mid-line
SLOT_FILL_MIN = 0.85     # ...and actually a filled rectangle, not a T/L/cross with a wide bbox
# The portrait window need only be MOSTLY a window: the portrait composites UNDER the plate, so the
# plate's own shape (arch, scallop) masks the corners and the window's exact outline does not matter.
# 0.60 admits a generous arch while still rejecting a thin decorative slit that happens to be large.
# (A review flagged the old 0.98 as rejecting a perfectly usable arched window.)
SLOT_RECT_FILL = 0.60
SLOT_TRIM_MAX = 0.25     # seating the portrait in the window must not crop away more than this


def keyed(path: Path, name: str) -> np.ndarray:
    """<id>-raw.png -> RGBA. key() raises if the void is missing or is a gradient."""
    rgb = np.array(Image.open(path).convert("RGB"))
    a = key(rgb, name)  # float alpha in [0,1]; asserts the void exists and is flat
    return np.dstack([despill(rgb, a), (a * 255).round().astype(np.uint8)])


SPECK_AREA_MIN = 256        # a connected blob smaller than this is void noise, not art
SPECK_DROP_MAX_FRAC = 0.005  # ...but if the dropped specks add up past this, fail loudly, don't crop


def art_bbox(a: np.ndarray) -> tuple[tuple[int, int, int, int], int, int]:
    """Bbox of the real art, ignoring speck noise. Returns (bbox, speck_px, speck_count).

    NOT `np.where(a > 0)`. That was the first cut and it is a wrong metric of exactly the kind
    Phase 04 warns about -- it read the very first health-bar gen's bbox as the ENTIRE 3168x1344
    canvas. Measured on that gen: the keyed image has 13 connected components -- the bar at 1,629,510
    px, and twelve specks totalling 60 px (largest 42) hugging the right edge, dither noise in a void
    that key()'s flatness assert still passes. A dozen stray pixels must not decide the crop.

    This is Phase 05's speck problem (check-characters.py:104-110, where a 4px speck scored as a whole
    second figure) in a new place, so it takes Phase 05's answer: judge by AREA, and report what was
    dropped rather than hiding it.

    Thresholding alpha instead (`a >= 200` recovers the right bbox here) is rejected: the steam prop's
    real art IS soft alpha, so an alpha floor would crop its wisps off. Area is the honest
    discriminator -- a speck is small at any alpha, a plume is large at low alpha. The measured gap is
    four orders of magnitude wide (42 px vs 1.6M) and the 256..4095 bucket is empty, so the threshold
    sits in a void rather than on a slope.
    """
    lab, n = ndimage.label(a > 0)
    if n == 0:
        raise AssertionError("image is fully transparent -- the key ate the art")
    areas = np.bincount(lab.ravel())
    areas[0] = 0  # label 0 is the transparent background
    keep = np.where(areas >= SPECK_AREA_MIN)[0]
    if not len(keep):
        raise AssertionError(
            f"no connected region of art reaches {SPECK_AREA_MIN}px -- largest is {areas.max()}px; "
            "the gen is noise, not art"
        )
    ys, xs = np.where(np.isin(lab, keep))
    dropped = int(areas.sum() - areas[keep].sum())
    kept = int(areas[keep].sum())
    # The 256px cutoff cannot tell a 255px spark from 255px of dither by size alone -- for these four
    # props there are no sparks, only <=68px of void noise, so it is safe. But a review rightly noted
    # it COULD silently drop legitimate small detached art on some future asset. So the silent case is
    # closed: if the dropped fragments add up to a real fraction of the art, fail loudly and make a
    # human look, rather than crop art away quietly. (0.5% of a ~1.6M-px asset is ~8000px; the actual
    # dropped is ~60. A single intended detached element would trip this and get looked at.)
    if dropped > SPECK_DROP_MAX_FRAC * kept:
        raise AssertionError(
            f"{dropped}px of art dropped as sub-{SPECK_AREA_MIN}px specks -- that is >{SPECK_DROP_MAX_FRAC:.1%} "
            f"of the {kept}px kept. If it is real detached art (a spark, a glow fragment) it must not be "
            "cropped silently; look at it and raise SPECK_AREA_MIN or keep it deliberately"
        )
    return ((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1),
            dropped, int(n - len(keep)))


def alpha_bbox(a: np.ndarray) -> tuple[int, int, int, int]:
    """art_bbox's rect alone, for callers that do not report specks."""
    return art_bbox(a)[0]


def enclosed_holes(a: np.ndarray) -> list[dict]:
    """Fully-transparent regions that do not touch the image border, largest first.

    Border-touching is the definition, NOT "the region a flood from (0,0) missed". After a tight crop
    to the art's bbox the corner pixel is usually art, so a flood from it fills nothing and every
    hole -- including one open to the right edge -- would score as enclosed. That is the exact defect
    the open-channel fixture exists to catch, so it is defined out of existence here instead.
    """
    lab, n = ndimage.label(a == 0)
    out = []
    for i in range(1, n + 1):
        m = lab == i
        if m[0, :].any() or m[-1, :].any() or m[:, 0].any() or m[:, -1].any():
            continue  # touches the border: this is the outside void, or a hole open to it
        ys, xs = np.where(m)
        out.append({
            "mask": m,
            "bbox": (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1),
            "area": int(m.sum()),
        })
    return sorted(out, key=lambda h: -h["area"])


def find_slot(a: np.ndarray) -> tuple[dict | None, list[dict], list[str]]:
    """The health-fill slot among the enclosed holes, by shape. Returns (slot, others, failures)."""
    H, W = a.shape
    holes = enclosed_holes(a)
    matches = []
    for h in holes:
        x0, y0, x1, y1 = h["bbox"]
        w, hh = x1 - x0, y1 - y0
        cx = (x0 + x1) / 2
        fill = h["area"] / (w * hh)  # a real channel is a filled rectangle; a T/L/cross is not
        if (w > SLOT_ELONGATION * hh
                and w >= SLOT_W_FRAC * W
                and hh >= SLOT_H_FRAC * H
                and abs(cx - W / 2) <= SLOT_CENTER_TOL * W
                and fill >= SLOT_FILL_MIN):
            matches.append(h)

    # by identity: `h not in matches` would compare the dicts, and a dict holding a numpy mask makes
    # `==` return an array, which `in` cannot reduce to a bool.
    matched = {id(h) for h in matches}
    others = [h for h in holes if id(h) not in matched]
    if not matches:
        return None, others, [
            f"no fill slot: {len(holes)} enclosed hole(s), none matching the slot rule "
            f"(w > {SLOT_ELONGATION}h, w >= {SLOT_W_FRAC:.0%} of {W}, h >= {SLOT_H_FRAC:.0%} of {H}, "
            f"centred +/-{SLOT_CENTER_TOL:.0%}). An open-ended channel keys into the outside void and "
            "is not enclosed -- that is the most likely cause."
        ]
    if len(matches) > 1:
        return None, others, [
            f"ambiguous fill slot: {len(matches)} enclosed holes match the slot rule "
            f"{[h['bbox'] for h in matches]} -- cannot tell which one the fill goes in"
        ]
    return matches[0], others, []


def portrait_slot(hole: dict) -> tuple[tuple[int, int, int, int], float]:
    """The slot IS the whole window, + how much of that rect is really window.

    The first cut computed "the largest PORTRAIT_ASPECT rect flush with the window's bottom", to seat
    the portrait without distorting it. That was wrong, and no metric caught it -- the 3-up composite
    in _preview.png did. The model drew the window at 0.6521:1, TALLER than the portrait's 0.7467:1,
    so an aspect-preserving rect flush with the bottom left ~209px of unfilled window above the head:
    a transparent band inside the frame. It did not remove the seam, it moved it from the chest to
    the forehead.

    So the slot is the window, and the consumer COVER-crops into it -- scale to cover, trim the
    overflow, anchor the BOTTOM. That is what a real select screen does, and it keeps the property
    that actually matters: the Phase 06 bust bleeds off its own bottom edge, so anchoring the crop's
    bottom to the slot's bottom butts real art against the frame with nothing to leave a gap
    (07-ui-prop-atlases.md:40-44). Distortion is impossible because the crop preserves aspect; the
    cost is trimmed edges, which `cover_trim` measures.

    The fill fraction is still not decoration: on an arch-topped or scalloped window the bbox pokes
    into the painted frame, and a portrait would then cover the border. Measured, not assumed.
    """
    x0, y0, x1, y1 = hole["bbox"]
    inside = float(hole["mask"][y0:y1, x0:x1].mean())
    return (int(x0), int(y0), int(x1 - x0), int(y1 - y0)), inside


def cover_trim(slot_w: int, slot_h: int, src_w: int = PORTRAIT_W, src_h: int = PORTRAIT_H) -> dict:
    """What a bottom-anchored cover-crop of the portrait into the slot costs, as fractions trimmed.

    Reported so a frame whose shape simply does not suit the art shows up as a number rather than as
    a surprise two phases later. A little trim is normal and invisible; a lot means the window is the
    wrong shape for a 0.7467:1 bust.
    """
    sc = max(slot_w / src_w, slot_h / src_h)
    w, h = src_w * sc, src_h * sc
    return {"scale": sc,
            "trim_w": max(0.0, (w - slot_w) / w),   # cropped off the sides (centred)
            "trim_h": max(0.0, (h - slot_h) / h)}   # cropped off the TOP only (bottom is anchored)


def check_clipped(bb: tuple[int, int, int, int], shape: tuple[int, int], fid: str) -> list[str]:
    """Art must not run off the top, left or right. The BOTTOM is allowed, and that is not a fudge.

    Props are bottom-anchored -- they sit on the roof, and the packer's cells are placed with
    setOrigin(0.5, 1) per sprite-schema.md's feet convention. So a mast or a pipe continuing below
    the canvas is exactly right: the cut IS the roofline. The measured case is beacon-0, whose
    lattice mast runs off the bottom and whose crop bottom is therefore the point it stands on.
    Clipping any other edge silently loses art, which is a real defect.

    A blanket "must not touch any edge" rule was the first cut, and it would have failed beacon-0 --
    good art rejected by a rule that was never about the art. Same defect class as the "exactly one
    enclosed hole" rule this file already walked back.
    """
    H, W = shape
    hit = [n for n, v in (("top", bb[1] == 0), ("left", bb[0] == 0), ("right", bb[2] == W)) if v]
    return [f"{fid}: art is clipped at the {'/'.join(hit)} edge -- the gen ran off the canvas"] if hit else []


BOTTOM_ANCHOR_TOL = 0.03  # a frame's bottom edge may drift this fraction of the cell height, no more


def check_bottom_anchor(reg: list[dict], cell_h: int, prop: str) -> list[str]:
    """The one thing registration CAN enforce: the frames' bottom edge does not drift.

    The moving part of a prop (plume, blades, halo) is measured-never-enforced -- see registration().
    But every prop is bottom-anchored to the roof (setOrigin(0.5,1)), so its base -- the pipe, the
    mast, the housing, the crowd's shoulders -- must stay put frame to frame, or the prop appears to
    float off the roof mid-animation. That IS enforceable without a wrong-metric problem, because the
    base is not the part that is supposed to change. A review pointed out that measuring everything
    and enforcing nothing let an arbitrarily floated frame pass despite the anchor contract.

    Measured across the shipped props the bottom drift is <=4px on a >=950px cell (<0.5%); the 3%
    bound leaves ~6x headroom and still catches a frame that floated a visible fraction of its height.
    """
    tol = BOTTOM_ANCHOR_TOL * cell_h
    bad = []
    for r in reg:
        dy1 = r["d_bbox"][3]  # bottom-edge delta vs frame 0
        if abs(dy1) > tol:
            bad.append(f"{prop}-{r['frame']}: bottom edge moved {dy1}px vs frame 0 (max {tol:.0f} = "
                       f"{BOTTOM_ANCHOR_TOL:.0%} of the {cell_h}px cell) -- it floats off the roof anchor")
    return bad


def registration(frames: list[np.ndarray]) -> list[dict]:
    """Each frame's alpha bbox + centroid delta vs frame 0, in px.

    The MOVING part is measured, never enforced, following key-layers.py:114-121's seam_delta
    precedent. No threshold on it could be honest: a steam plume is SUPPOSED to change shape between
    frames, so a bbox delta of 40px is either the animation working or the vent sliding, and nothing
    in the pixels distinguishes them. Enforcing that would be the wrong-metric failure Phase 04 hit
    twice. (The frames are --image-chained from frame 0, but the API JPEG-compresses and resizes any
    reference, ~1px jitter, CLAUDE.md:30 -- so "chained" does not even mean "in register".)

    What IS enforced, from these same numbers, is the bottom edge -- see check_bottom_anchor().
    """
    out = []
    for i, f in enumerate(frames):
        a = f[..., 3]
        bb = alpha_bbox(a)
        ys, xs = np.where(a > 0)
        cen = (float(xs.mean()), float(ys.mean()))
        if i == 0:
            base_bb, base_cen = bb, cen
        out.append({
            "frame": i,
            "bbox": bb,
            "d_bbox": tuple(int(b - c) for b, c in zip(bb, base_bb)),
            "d_centroid": (round(cen[0] - base_cen[0], 1), round(cen[1] - base_cen[1], 1)),
        })
    return out


def png_matches_job(fid: str, d: Path, png: Path) -> list[str]:
    """The PNG's pixel size agrees with its own job record's params.width/height.

    Does NOT prove the PNG is the bytes that job served -- a stale same-sized file passes. That gap
    is inherited from Phase 06 (06-select-portraits-log.md:248) and is named in the phase log's
    "what the gate does not cover". What it does catch is a params/aspect drift, which is real:
    the aspect LABEL lies, so params.width/height is the only pixel truth in the record.
    """
    try:
        w, h = Image.open(png).size
        jobs = json.loads((d / f"{fid}.job.json").read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        return [f"{fid}: unreadable ({e})"]
    if isinstance(jobs, dict):
        jobs = [jobs]
    if not isinstance(jobs, list) or len(jobs) != 1:
        return []  # check_job already fails this shape; no second complaint
    p = jobs[0].get("params", {})
    if (p.get("width"), p.get("height")) != (w, h):
        return [f"{fid}: job says {p.get('width')}x{p.get('height')}, PNG is {w}x{h} -- the record "
                "does not describe the file beside it"]
    return []


def pack(rows: list[list[tuple[str, np.ndarray]]]) -> tuple[Image.Image, dict]:
    """Left-to-right rows of named cells -> one RGBA sheet + a Phaser JSON-Hash frames dict.

    Rows are packed at their own heights and cells at their own widths; the JSON carries exact rects
    so nothing has to be uniform. No power-of-two rounding and no byte budget: neither is falsifiable,
    neither is in public/configs/sprite-schema.md, and nothing needs them.
    """
    W = max(sum(im.shape[1] for _, im in r) for r in rows)
    H = sum(max(im.shape[0] for _, im in r) for r in rows)
    sheet = np.zeros((H, W, 4), np.uint8)
    frames, y = {}, 0
    for r in rows:
        rh = max(im.shape[0] for _, im in r)
        x = 0
        for name, im in r:
            h, w = im.shape[:2]
            sheet[y:y + h, x:x + w] = im
            frames[name] = {
                "frame": {"x": x, "y": y, "w": w, "h": h},
                "rotated": False, "trimmed": False,
                "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h},
                "sourceSize": {"w": w, "h": h},
            }
            x += w
        y += rh
    return Image.fromarray(sheet), frames


def check_texture_size(im: Image.Image, name: str) -> list[str]:
    """A sheet larger than the GPU's max texture size does not draw AT ALL.

    Not a tidiness rule, and not the "power-of-two-friendly / sane byte budget" hand-waving an earlier
    draft had (dropped: neither was falsifiable). This is a hard runtime limit -- packing the props at
    the resolution they were generated at produced a 9828x6800 sheet, which exceeds the 8192 many GPUs
    report and would have failed to upload. 2048 is the conservative floor.
    """
    if im.width > MAX_ATLAS_DIM or im.height > MAX_ATLAS_DIM:
        return [f"{name}: sheet is {im.width}x{im.height}, over the {MAX_ATLAS_DIM}px max texture "
                "size -- it would fail to upload on some GPUs and draw nothing"]
    return []


def write_atlas(path_png: Path, im: Image.Image, frames: dict, extra: dict) -> None:
    path_png.parent.mkdir(parents=True, exist_ok=True)
    im.save(path_png)
    doc = {"frames": frames, "meta": {
        "app": "scripts/build-atlases.py", "version": "1.0",
        "image": path_png.name, "format": "RGBA8888",
        "size": {"w": im.width, "h": im.height}, "scale": "1",
        **extra,
    }}
    path_png.with_suffix(".json").write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")


# ================================ fixtures ======================================================

def _void(h: int, w: int) -> np.ndarray:
    return np.full((h, w, 3), KEY_RGB, np.uint8)


def _rgba(img: np.ndarray, name: str) -> np.ndarray:
    return np.dstack([img, (key(img, name) * 255).round().astype(np.uint8)])


def _crop(rgba: np.ndarray) -> np.ndarray:
    x0, y0, x1, y1 = alpha_bbox(rgba[..., 3])
    return rgba[y0:y1, x0:x1]


def _bar(w=600, h=90, slot=(60, 25, 540, 65), extra_holes=(), open_right=False) -> np.ndarray:
    """A magenta-void canvas holding a solid bar frame with a magenta channel punched out of it."""
    img = _void(h + 40, w + 40)
    img[20:20 + h, 20:20 + w] = (40, 60, 90)  # the bar frame: solid art
    x0, y0, x1, y1 = slot
    img[20 + y0:20 + y1, 20 + x0:20 + (w if open_right else x1)] = KEY_RGB  # the channel: void again
    for (a, b, c, d) in extra_holes:
        img[20 + b:20 + d, 20 + a:20 + c] = KEY_RGB
    return img


def selftest() -> None:
    """Fixtures for this script's own metrics, before it judges real art or spends a credit.

    CLAUDE.md: an art gate self-tests before it judges; a wrong metric is more dangerous than no
    metric. Phase 05's suite caught a real bug -- a 4px speck scoring as a whole second figure --
    before a credit was spent, which is the entire argument for writing these first.

    Scope, stated honestly. This covers the key/crop/hole/slot/registration metrics and the packer.
    It does NOT cover: whether the bar reads as a health bar, whether a prop's four frames form one
    coherent motion, whether the props read as a set, the absence of text or logos, or whether a
    portrait sits in the slot without a visible seam. None of those has a metric that is not a lie;
    they are the phase log's visual checklist, which is load-bearing, not decoration.
    """
    # 1. a clean slot is found, and its bbox is exact
    slot, others, bad = find_slot(_crop(_rgba(_bar(), "fx1"))[..., 3])
    assert not bad, f"a clean bar must pass: {bad}"
    assert slot["bbox"] == (60, 25, 540, 65), f"slot bbox wrong: {slot['bbox']}"
    assert others == [], "a clean bar has no other holes"

    # 2. an open-ended channel keys into the outside void -> not enclosed -> no slot
    slot, _, bad = find_slot(_crop(_rgba(_bar(open_right=True), "fx2"))[..., 3])
    assert slot is None and any("no fill slot" in b for b in bad), \
        "a channel open to the edge must fail -- it is indistinguishable from the outside void"

    # 3. a decorative aperture alongside a real slot is reported, not fatal
    slot, others, bad = find_slot(_crop(_rgba(_bar(extra_holes=[(20, 8, 34, 18)]), "fx3"))[..., 3])
    assert not bad, f"a decorative aperture must not fail a good bar: {bad}"
    assert slot["bbox"] == (60, 25, 540, 65) and len(others) == 1, \
        "the slot must still be the channel, with the aperture reported as an 'other'"

    # 4. ONLY a decorative hole -> no slot
    slot, _, bad = find_slot(_crop(_rgba(_bar(slot=(20, 8, 34, 18)), "fx4"))[..., 3])
    assert slot is None and any("no fill slot" in b for b in bad), \
        "a bar with only a rivet hole has no fill slot"

    # 5. two rule-matching holes -> ambiguous, rather than silently picking one.
    # Both channels must genuinely satisfy the rule for this to test ambiguity rather than just
    # re-testing SLOT_H_FRAC, so the bar is tall enough for two 40%-height channels.
    two = _bar(h=250, slot=(60, 20, 540, 120), extra_holes=[(60, 130, 540, 230)])
    slot, _, bad = find_slot(_crop(_rgba(two, "fx5"))[..., 3])
    assert slot is None and any("ambiguous" in b for b in bad), f"two channels must fail: {bad}"

    # 6. no hole at all
    solid = _void(130, 640)
    solid[20:110, 20:620] = (40, 60, 90)
    slot, _, bad = find_slot(_crop(_rgba(solid, "fx6"))[..., 3])
    assert slot is None and any("no fill slot" in b for b in bad), "a solid slab has no slot"

    # 6b. a T-shaped transparent region whose BBOX satisfies the slot rule but whose FILL does not.
    # (A review found the old bbox-only rule would accept this as a valid fill slot.)
    tee = _void(130, 640)
    tee[20:110, 20:620] = (40, 60, 90)      # the bar frame
    tee[55:75, 60:580] = KEY_RGB            # a wide thin bar of void (the top of the T)...
    tee[55:100, 300:340] = KEY_RGB          # ...plus a stem hanging down -- one connected T region
    slot, _, bad = find_slot(_crop(_rgba(tee, "fx6b"))[..., 3])
    assert slot is None and any("no fill slot" in b for b in bad), \
        "a T-shaped hole (wide bbox, low fill) must NOT pass as a rectangular fill slot"

    # 7. key() raises with no magenta at all
    try:
        key(np.full((40, 40, 3), (10, 20, 30), np.uint8), "fx7")
        raise SystemExit("FIXTURE FAILED: no void at all must raise")
    except AssertionError:
        pass

    # 8. key() raises on a two-tone void. Bimodal, not a ramp, and the green channel rather than a
    # dimmer magenta: check-characters.py:243-246 already established both points -- a gentle ramp
    # cannot exceed the inherited VOID_SPREAD_MAX (so testing one would assert a behaviour the metric
    # does not have), and a dimmer magenta falls outside VOID_PREFILTER and is simply not judged.
    twotone = _void(40, 40)
    twotone[:, :20, 1] = 190  # half the void parked well off pure magenta, still inside the prefilter
    try:
        key(twotone, "fx8")
        raise SystemExit("FIXTURE FAILED: a two-tone void must fail key()'s flatness assert")
    except AssertionError:
        pass

    # 9. the slot IS the window -- it must leave NO unfilled band. This fixture is the regression for
    # the real defect the 3-up composite caught: an aspect-preserving rect flush with the bottom left
    # a transparent strip above the head, because the window (0.6521) is taller than the art (0.7467).
    hole_img = np.full((400, 400, 3), (30, 30, 30), np.uint8)
    hole_img[0, 0] = KEY_RGB  # key() needs SOME void to exist; one pixel is enough for this fixture
    hole_img[50:350, 100:300] = KEY_RGB  # a 200x300 window -- 0.667:1, TALLER than the 0.7467 art
    h = enclosed_holes(_rgba(hole_img, "fx9")[..., 3])[0]
    (rx, ry, rw, rh), inside = portrait_slot(h)
    assert (rx, ry, rw, rh) == (100, 50, 200, 300), f"the slot must BE the window, got {(rx,ry,rw,rh)}"
    assert ry + rh == 350 and ry == 50, "the slot spans the window top to bottom -- no unfilled band"
    assert inside == 1.0, f"a rectangular window must be 100% inside, got {inside:.3f}"

    # 9a. a bottom-anchored cover-crop into that window trims the SIDES and nothing off the top,
    # so the bust's bleed edge survives -- which is the whole point of anchoring the bottom.
    t = cover_trim(200, 300)
    assert t["trim_h"] == 0.0, f"a window taller than the art must not trim the top: {t}"
    assert 0.0 < t["trim_w"] < 0.2, f"...it trims the sides a little: {t}"
    # ...and a window WIDER than the art trims the top instead, never the bottom.
    t = cover_trim(300, 200)
    assert t["trim_w"] == 0.0 and t["trim_h"] > 0.0, f"a wide window trims the top: {t}"

    # 9b. an arch-topped window: bbox pokes into the frame, the fill fraction says so, and -- the
    # point a review made -- it is a USABLE window that must PASS, because the portrait composites
    # under the plate so the arch masks the corners. Fill here is ~0.86, above SLOT_RECT_FILL=0.60.
    arch = np.full((400, 400, 3), (30, 30, 30), np.uint8)
    arch[0, 0] = KEY_RGB
    arch[50:350, 100:300] = KEY_RGB
    for i, r in enumerate(range(50, 90)):       # round the two top corners off into an arch
        arch[r, 100:100 + (40 - i)] = (30, 30, 30)
        arch[r, 300 - (40 - i):300] = (30, 30, 30)
    h = enclosed_holes(_rgba(arch, "fx9b")[..., 3])[0]
    _, inside = portrait_slot(h)
    assert SLOT_RECT_FILL <= inside < 1.0, \
        f"an arched window must be <100% inside yet still pass the {SLOT_RECT_FILL} floor, got {inside:.3f}"

    # 10c. the bottom-anchor gate: the moving top is free, a floated bottom fails.
    base = np.zeros((1000, 400, 4), np.uint8)
    base[600:900, 150:250] = 255                       # frame 0: a blob sitting at y=900
    grow = base.copy(); grow[300:900, 120:280] = 255   # frame 1: same bottom, taller+wider top -> OK
    reg = registration([base, grow])
    assert check_bottom_anchor(reg, 300, "grow") == [], \
        "a frame that grows UPWARD from a fixed bottom must pass -- that is the animation working"
    floated = np.zeros((1000, 400, 4), np.uint8)
    floated[400:700, 150:250] = 255                    # same blob, shifted UP 200px -> off the anchor
    reg = registration([base, floated])
    assert any("floats off" in b for b in check_bottom_anchor(reg, 300, "float")), \
        "a frame whose whole body floated up off the roof anchor must FAIL"

    # 10. registration is MEASURED and does not fail the run
    f0 = np.zeros((100, 100, 4), np.uint8); f0[40:60, 40:60] = 255
    f1 = np.zeros((100, 100, 4), np.uint8); f1[40:60, 80:100] = 255  # slid 40px right
    reg = registration([f0, f1])
    assert reg[0]["d_centroid"] == (0.0, 0.0), "frame 0 is its own baseline"
    assert reg[1]["d_centroid"][0] == 40.0, f"a 40px slide must be measured: {reg[1]['d_centroid']}"
    assert reg[1]["d_bbox"][0] == 40, "the bbox delta must be reported too"

    # 11. the packer's rects really describe where the pixels went
    sheet, frames = pack([[("a", np.full((10, 20, 4), 1, np.uint8)),
                           ("b", np.full((10, 30, 4), 2, np.uint8))],
                          [("c", np.full((5, 40, 4), 3, np.uint8))]])
    assert (sheet.width, sheet.height) == (50, 15), f"sheet {sheet.size} != (50, 15)"
    assert frames["b"]["frame"] == {"x": 20, "y": 0, "w": 30, "h": 10}, frames["b"]
    assert frames["c"]["frame"] == {"x": 0, "y": 10, "w": 40, "h": 5}, frames["c"]
    arr = np.array(sheet)
    assert (arr[0:10, 20:50, 0] == 2).all() and (arr[10:15, 0:40, 0] == 3).all(), \
        "the packer's JSON rects must actually describe where the pixels went"

    # 12. the HUD band bound is the sim's DISCRETE apex, and it bites. 286 is where a jumping head
    # reaches under fighter.ts's semi-implicit Euler -- NOT the continuous 279 (v^2/2g), which a
    # review caught was 7.4px too strict. A bar reaching it would draw over the fighter at apex.
    assert HUD_BAND_MAX == 286, f"the derived band floor moved: {HUD_BAND_MAX} -- did a sim constant change?"
    assert 148.0 < _discrete_jump_apex() < 149.0, \
        f"the discrete apex must be ~148px, not the continuous 155.8; got {_discrete_jump_apex():.2f}"
    assert TOP + 144 + PIP_GAP + PIP_H <= HUD_BAND_MAX, "the real 144px bar must fit under a jumping head"
    assert not (TOP + 230 + PIP_GAP + PIP_H <= HUD_BAND_MAX), \
        "a 230px bar must NOT fit -- otherwise the bound is decorative"

    # 12b. a dozen stray dither pixels must not decide the crop (the first real gen's actual defect:
    # 12 specks totalling 60px dragged the bbox from 2926x916 to the full 3168x1344 canvas)
    speckly = np.zeros((400, 400), np.uint8)
    speckly[100:300, 100:300] = 255          # the art
    speckly[5, 395] = 200                    # a speck, far away, high alpha
    speckly[7:9, 390:392] = 120              # ...and a 4px one, exactly Phase 05's bug
    bb, sp_px, sp_n = art_bbox(speckly)
    assert bb == (100, 100, 300, 300), f"specks must not move the bbox, got {bb}"
    assert sp_px == 5 and sp_n == 2, f"the dropped specks must be REPORTED, got {sp_px}px in {sp_n}"

    # 12c. ...but soft alpha that is genuinely large is art, not speck (the steam plume case)
    wispy = np.zeros((400, 400), np.uint8)
    wispy[100:300, 100:300] = 255
    wispy[60:100, 150:250] = 12              # a big, very faint plume above it: 4000px at alpha 12
    bb, _, _ = art_bbox(wispy)
    assert bb == (100, 60, 300, 300), \
        f"a large faint region is art and must be kept -- an alpha threshold would crop it: {bb}"

    # 12c-2. the silent-drop guard: many small fragments adding up past the fraction must FAIL, not
    # crop quietly. (A review noted a lone small spark could be dropped silently; this closes the
    # aggregate case and forces a human look.) 40 specks of 100px each = 4000px vs 10000px kept = 40%.
    specky = np.zeros((400, 400), np.uint8)
    specky[100:200, 100:200] = 255           # 10000px of real art
    for i in range(40):                      # 40 detached 10x10 specks, well separated
        y, x = 5 + (i // 8) * 12, 250 + (i % 8) * 15
        specky[y:y + 10, x:x + 10] = 255
    try:
        art_bbox(specky)
        raise SystemExit("FIXTURE FAILED: a large aggregate of dropped specks must raise, not crop")
    except AssertionError as e:
        assert "dropped as sub-" in str(e), f"wrong assertion: {e}"

    # 12d. the max-texture-size gate bites. The real twilight-atlas packed native was 9828x6800 --
    # over the 8192 many GPUs report, so it would have uploaded nothing. This is the one size rule
    # that is falsifiable, which is why it survived and "power-of-two-friendly" did not.
    assert check_texture_size(Image.new("RGBA", (2048, 2048)), "x") == [], "2048 square must pass"
    assert any("max texture size" in b for b in
               check_texture_size(Image.new("RGBA", (9828, 6800)), "x")), \
        "a 9828x6800 sheet must FAIL -- that is the size the props packed to natively"

    # 13. png_matches_job catches a record that does not describe its file
    with tempfile.TemporaryDirectory() as td:
        d = Path(td)
        Image.new("RGBA", (100, 50)).save(d / "f.png")
        job = {"status": "completed", "job_type": "nano_banana_pro", "result_url": "https://x/y",
               "params": {"aspect_ratio": "1:1", "resolution": "2k", "prompt": "P",
                          "input_images": [], "width": 100, "height": 50}}
        (d / "f.job.json").write_text(json.dumps(job), encoding="utf-8")
        assert png_matches_job("f", d, d / "f.png") == [], "a matching record must pass"
        job["params"]["width"] = 999
        (d / "f.job.json").write_text(json.dumps(job), encoding="utf-8")
        assert any("does not describe" in b for b in png_matches_job("f", d, d / "f.png")), \
            "a record whose size disagrees with its PNG must fail"

    print("build-atlases selftest: 25 fixtures OK (slot found/open/decorative/none/ambiguous/solid, "
          "key raises x2, T-shape rejected, slot IS the window + cover-trim + usable-arch, "
          "bottom-anchor enforced, packer rects, discrete-apex HUD band, max-texture, "
          "speck filter + aggregate-drop guard, faint-art kept, png<->job)")


def _prompts(d: Path, ids: list[str]) -> dict:
    return {i: (d / f"{i}.prompt.txt").read_text(encoding="utf-8") for i in ids}


def build_ui(fail: list) -> tuple[Image.Image, dict, dict]:
    ids = list(UI_ASSETS)
    prompts = _prompts(UI, ids)
    fail += check_blocks(prompts)
    print(f"\nUI shared block: {'identical' if not fail else 'DRIFTED'} across {len(prompts)} prompts "
          f"({len(shared_block(prompts))} chars)")

    plates, facts = {}, {}
    for fid, aspect in UI_ASSETS.items():
        raw = UI / f"{fid}-raw.png"
        fail += check_job(fid, prompts[fid], UI, aspect=aspect, refs=0)
        fail += png_matches_job(fid, UI, raw)
        rgba = keyed(raw, fid)
        Image.fromarray(rgba).save(UI / f"{fid}.png")  # keyed, for review
        bb, sp, sn = art_bbox(rgba[..., 3])
        fail += check_clipped(bb, rgba.shape[:2], fid)
        crop = rgba[bb[1]:bb[3], bb[0]:bb[2]]
        plates[fid], facts[fid] = crop, {"raw": rgba.shape[1::-1], "bbox": bb, "specks": (sp, sn)}

    # --- health bar: the art picks the height; we only fix the width to the existing layout -------
    bar = plates["health-bar"]
    ch, cw = bar.shape[:2]
    scale = BAR_W / cw
    bar_h = round(ch * scale)
    bar_im = Image.fromarray(bar).resize((BAR_W, bar_h), Image.LANCZOS)
    slot, others, bad = find_slot(np.array(bar_im)[..., 3])
    fail += [f"health-bar: {b}" for b in bad]
    facts["health-bar"].update(scale=scale, size=(BAR_W, bar_h), others=[h["bbox"] for h in others])

    # --- meter bar: same treatment, same imposed width, its own (much shallower) art height -------
    meter = plates["meter-bar"]
    mh, mw = meter.shape[:2]
    mscale = METER_W / mw
    meter_h = round(mh * mscale)
    meter_im = Image.fromarray(meter).resize((METER_W, meter_h), Image.LANCZOS)
    mslot, m_others, m_bad = find_slot(np.array(meter_im)[..., 3])
    fail += [f"meter-bar: {b}" for b in m_bad]
    facts["meter-bar"].update(scale=mscale, size=(METER_W, meter_h),
                              others=[h["bbox"] for h in m_others])
    # The meter is meant to read as the LEANER sibling of the health bar; if the model paints it as
    # tall it is not a meter, it is a second health bar, and the HUD reads wrong at a glance.
    if meter_h > bar_h:
        fail.append(f"meter-bar: {meter_h}px tall against the health bar's {bar_h}px -- the meter is "
                    "supposed to be the shallower of the two")

    # The vertical budget is now health bar + meter + pips, all of it above a jumping head, and all
    # of it measured at the height the HUD actually DRAWS (see BAR_SCALE_Y).
    drawn_bar, drawn_meter = round(bar_h * BAR_SCALE_Y), round(meter_h * BAR_SCALE_Y)
    pip_y = TOP + drawn_bar + METER_GAP + drawn_meter + PIP_GAP
    hud_bottom = pip_y + PIP_H
    if hud_bottom > HUD_BAND_MAX:
        fail.append(f"health-bar: at {BAR_W}px wide the bar draws {drawn_bar}px tall and the meter "
                    f"{drawn_meter}px, putting the HUD's bottom at y={hud_bottom}; a fighter's head "
                    f"reaches y={HUD_BAND_MAX} at the apex of a jump, so the HUD would be drawn "
                    "over him")
    if 2 * (MARGIN + BAR_W) > VIEW_W:
        fail.append(f"health-bar: two bars + margins = {2*(MARGIN+BAR_W)} > {VIEW_W} viewport")
    facts["health-bar"].update(pip_y=pip_y, hud_bottom=hud_bottom)

    # --- portrait base: the slot is COMPUTED, so the model's window aspect never has to be right --
    base = plates["portrait-base"]
    holes = enclosed_holes(base[..., 3])
    if not holes:
        fail.append("portrait-base: no enclosed window in the plate -- the border does not close")
        pslot, inside, base_im = None, 0.0, Image.fromarray(base)
    else:
        (rx, ry, rw, rh), inside = portrait_slot(holes[0])
        if inside < SLOT_RECT_FILL:
            fail.append(f"portrait-base: the window's rect is only {inside:.1%} actually window "
                        f"(need {SLOT_RECT_FILL:.0%}) -- it is not rectangular enough to seat a "
                        "portrait without covering the painted border")
        trim = cover_trim(rw, rh)
        if max(trim["trim_w"], trim["trim_h"]) > SLOT_TRIM_MAX:
            fail.append(f"portrait-base: seating a {PORTRAIT_W}x{PORTRAIT_H} portrait in this "
                        f"{rw}x{rh} window costs {trim['trim_w']:.1%} of its width / "
                        f"{trim['trim_h']:.1%} of its height -- the window is the wrong shape for the art")
        pscale = SLOT_TARGET_W / rw
        bh2, bw2 = base.shape[:2]
        base_im = Image.fromarray(base).resize((round(bw2 * pscale), round(bh2 * pscale)), Image.LANCZOS)
        pslot = tuple(round(v * pscale) for v in (rx, ry, rw, rh))
        facts["portrait-base"].update(window=holes[0]["bbox"], window_aspect=rw / rh,
                                      inside=inside, trim=trim, scale=pscale,
                                      size=base_im.size, slot=pslot)

    sheet, frames = pack([[("health-bar", np.array(bar_im))], [("meter-bar", np.array(meter_im))],
                          [("portrait-base", np.array(base_im))]])
    # Slots are frames too: a rect is a rect, Phaser hands it back via texture.get(name), and it
    # needs no schema Phaser does not already have. They are sub-rects of their plate, so they are
    # offset by the plate's packed origin. Phase 14 gets the slot's position relative to the bar by
    # subtracting the bar frame's x/y -- sprite-schema.md says so.
    if slot:
        bx, by = frames["health-bar"]["frame"]["x"], frames["health-bar"]["frame"]["y"]
        sx0, sy0, sx1, sy1 = slot["bbox"]
        frames["health-bar-slot"] = {"frame": {"x": bx + sx0, "y": by + sy0,
                                               "w": sx1 - sx0, "h": sy1 - sy0},
                                     "rotated": False, "trimmed": False,
                                     "spriteSourceSize": {"x": 0, "y": 0, "w": sx1-sx0, "h": sy1-sy0},
                                     "sourceSize": {"w": sx1-sx0, "h": sy1-sy0}}
        facts["health-bar"]["slot"] = (sx0, sy0, sx1 - sx0, sy1 - sy0)
    if mslot:
        mx, my = frames["meter-bar"]["frame"]["x"], frames["meter-bar"]["frame"]["y"]
        tx0, ty0, tx1, ty1 = mslot["bbox"]
        frames["meter-bar-slot"] = {"frame": {"x": mx + tx0, "y": my + ty0,
                                              "w": tx1 - tx0, "h": ty1 - ty0},
                                    "rotated": False, "trimmed": False,
                                    "spriteSourceSize": {"x": 0, "y": 0, "w": tx1-tx0, "h": ty1-ty0},
                                    "sourceSize": {"w": tx1-tx0, "h": ty1-ty0}}
        facts["meter-bar"]["slot"] = (tx0, ty0, tx1 - tx0, ty1 - ty0)
    if pslot:
        px, py = frames["portrait-base"]["frame"]["x"], frames["portrait-base"]["frame"]["y"]
        frames["portrait-slot"] = {"frame": {"x": px + pslot[0], "y": py + pslot[1],
                                             "w": pslot[2], "h": pslot[3]},
                                   "rotated": False, "trimmed": False,
                                   "spriteSourceSize": {"x": 0, "y": 0, "w": pslot[2], "h": pslot[3]},
                                   "sourceSize": {"w": pslot[2], "h": pslot[3]}}
    return sheet, frames, facts


def build_props(fail: list) -> tuple[Image.Image, dict, dict]:
    ids = [f"{p}-{n}" for p in PROP_ASPECTS for n in range(PROP_FRAMES)]
    prompts = _prompts(PROPS, ids)
    fail += check_blocks(prompts)
    print(f"\nprop shared block: {'identical' if not fail else 'DRIFTED'} across {len(prompts)} "
          f"prompts ({len(shared_block(prompts))} chars)")

    rows, facts = [], {}
    for prop, aspect in PROP_ASPECTS.items():
        mats = []
        for n in range(PROP_FRAMES):
            fid = f"{prop}-{n}"
            raw = PROPS / f"{fid}-raw.png"
            # frame 0 is fresh (refs=0); 1..3 are --image-chained from it (refs=1). Which image is
            # NOT provable -- art_gate.check_job's note explains why, and the log repeats it.
            fail += check_job(fid, prompts[fid], PROPS, aspect=aspect, refs=0 if n == 0 else 1)
            fail += png_matches_job(fid, PROPS, raw)
            rgba = keyed(raw, fid)
            Image.fromarray(rgba).save(PROPS / f"{fid}.png")
            mats.append(rgba)

        sizes = {m.shape[:2] for m in mats}
        if len(sizes) != 1:
            fail.append(f"{prop}: frames are not all the same size ({sizes}) -- a shared crop is "
                        "meaningless, so this prop cannot be packed")
            continue

        # ONE union bbox across the 4 frames. This keeps them on a shared canvas rect, which is what
        # the packer needs. It does NOT mean they are "in register" -- the API JPEG-ises and resizes
        # every --image reference (CLAUDE.md:30), and the model can translate the subject anyway.
        # registration() reports how much each frame moved; nothing here enforces it.
        boxes = [art_bbox(m[..., 3]) for m in mats]
        for (bb, _, _), fid in zip(boxes, [f"{prop}-{n}" for n in range(PROP_FRAMES)]):
            fail += check_clipped(bb, mats[0].shape[:2], fid)
        u = (min(b[0][0] for b in boxes), min(b[0][1] for b in boxes),
             max(b[0][2] for b in boxes), max(b[0][3] for b in boxes))
        cells = [m[u[1]:u[3], u[0]:u[2]] for m in mats]

        # One scale for all 4 frames of a prop -- scaling them independently would undo the shared
        # crop and break the registration the union bbox exists to preserve.
        cw, chh = u[2] - u[0], u[3] - u[1]
        sc = min(1.0, PROP_MAX_DIM / max(cw, chh))
        tw, th = max(1, round(cw * sc)), max(1, round(chh * sc))
        cells = [np.array(Image.fromarray(c).resize((tw, th), Image.LANCZOS)) for c in cells]

        reg = registration(mats)
        fail += check_bottom_anchor(reg, chh, prop)  # the base must stay on the roof, even as the plume moves
        rows.append([(f"{prop}-{n}", c) for n, c in enumerate(cells)])
        facts[prop] = {"canvas": mats[0].shape[1::-1], "union": u,
                       "cell": (cw, chh), "scale": sc, "packed": (tw, th),
                       "specks": [b[1] for b in boxes], "reg": reg}
    sheet, frames = pack(rows)
    return sheet, frames, facts


def previews(ui_sheet: Image.Image, ui_frames: dict, pr_sheet: Image.Image, pr_frames: dict) -> None:
    """The artifacts the by-eye calls are actually made on.

    Not decoration. check-portraits.py:35-36 makes the same argument: the questions that matter most
    here -- do the props read as a set, does each prop's 4 frames animate as one motion, does a
    portrait seat in the slot without a seam -- have no honest metric, so the visual checklist IS the
    gate for them, and it needs something to look at.
    """
    # props: one row per prop, its 4 frames left to right, on a dark card
    cells = [[(n, pr_frames[n]["frame"]) for n in (f"{p}-{i}" for i in range(PROP_FRAMES))]
             for p in PROP_ASPECTS]
    pad, cw = 8, max(f["w"] for row in cells for _, f in row)
    chh = max(f["h"] for row in cells for _, f in row)
    sheet = Image.new("RGB", (4 * (cw + pad) + pad, len(cells) * (chh + pad) + pad), (28, 28, 32))
    for r, row in enumerate(cells):
        for c, (_, f) in enumerate(row):
            tile = pr_sheet.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"]))
            sheet.paste(tile, (pad + c * (cw + pad) + (cw - f["w"]) // 2,
                               pad + r * (chh + pad) + (chh - f["h"])), tile)  # bottom-aligned: the anchor
    sheet.save(PROPS / "_preview.png")
    print(f"wrote {(PROPS / '_preview.png').relative_to(ROOT)}  ({sheet.width}x{sheet.height}) "
          "-- rows are props, columns are the 4 frames, bottom-aligned like the runtime anchor")

    # UI: the plates, plus each Phase 06 portrait actually seated in the slot. That composite is the
    # only way to answer "does a portrait fit without a seam?", which is an acceptance criterion.
    pf, sf = ui_frames["portrait-base"]["frame"], ui_frames.get("portrait-slot", {}).get("frame")
    base = ui_sheet.crop((pf["x"], pf["y"], pf["x"] + pf["w"], pf["y"] + pf["h"]))
    bar_f = ui_frames["health-bar"]["frame"]
    bar = ui_sheet.crop((bar_f["x"], bar_f["y"], bar_f["x"] + bar_f["w"], bar_f["y"] + bar_f["h"]))

    masters = ROOT / "concepts" / "portraits" / "2026-07-17"
    fids = [f for f in ("brawler", "jiujitsu", "monk") if (masters / f"{f}.png").exists()]
    W = max(bar.width, (pf["w"] + 8) * max(1, len(fids)) + 8)
    card = Image.new("RGB", (W + 16, bar.height + pf["h"] + 40), (28, 28, 32))
    card.paste(bar, (8, 8), bar)
    for i, fid in enumerate(fids):
        seated = base.copy()
        if sf:
            # The contract, performed exactly as a consumer must: COVER the slot (scale so neither
            # axis leaves a gap), trim the overflow, and anchor the BOTTOM so the bust's bleed edge
            # butts the frame. Anything else reintroduces the transparent band this preview caught.
            p = Image.open(masters / f"{fid}.png").convert("RGBA")
            sc = max(sf["w"] / p.width, sf["h"] / p.height)
            p = p.resize((max(1, round(p.width * sc)), max(1, round(p.height * sc))), Image.LANCZOS)
            left = (p.width - sf["w"]) // 2          # centre horizontally
            top = p.height - sf["h"]                 # ...but anchor the BOTTOM, never the top
            p = p.crop((left, top, left + sf["w"], top + sf["h"]))
            local = (sf["x"] - pf["x"], sf["y"] - pf["y"])
            under = Image.new("RGBA", seated.size, (0, 0, 0, 0))
            under.paste(p, local)
            seated = Image.alpha_composite(under, seated)  # plate ON TOP: the border must survive
        card.paste(seated, (8 + i * (pf["w"] + 8), bar.height + 24), seated)
    card.save(UI / "_preview.png")
    print(f"wrote {(UI / '_preview.png').relative_to(ROOT)}  ({card.width}x{card.height}) -- the bar, "
          f"and {len(fids)} Phase 06 portrait(s) really seated in the slot")


def main() -> int:
    selftest()
    if "--selftest" in sys.argv:
        return 0

    fail: list[str] = []
    ui_sheet, ui_frames, ui_facts = build_ui(fail)
    pr_sheet, pr_frames, pr_facts = build_props(fail)
    fail += check_texture_size(ui_sheet, "hud-atlas")
    fail += check_texture_size(pr_sheet, "twilight-atlas")

    # --- report measurements, not verdicts (06-select-portraits-log.md:221-226: a gate that printed
    # hardcoded affirmative text under a FAIL heading is a real bug this repo already shipped once) -
    f = ui_facts["health-bar"]
    print(f"\nhealth-bar   raw {f['raw'][0]}x{f['raw'][1]}  art {f['bbox']}  specks {f['specks'][0]}px/"
          f"{f['specks'][1]}\n"
          f"             packed {f['size'][0]}x{f['size'][1]}  (scale {f.get('scale', 0):.4f})  "
          f"slot {f.get('slot')}  extra holes {f.get('others')}\n"
          f"             HUD: bar y{TOP}..{TOP + f['size'][1]}, pips y{f.get('pip_y')}, bottom "
          f"y{f.get('hud_bottom')} vs jumping-head floor y{HUD_BAND_MAX}")
    f = ui_facts["portrait-base"]
    print(f"portrait-base raw {f['raw'][0]}x{f['raw'][1]}  art {f['bbox']}  specks {f['specks'][0]}px/"
          f"{f['specks'][1]}\n"
          f"             window {f.get('window')}  aspect {f.get('window_aspect', 0):.4f} "
          f"(model missed 0.7467 -- does not matter, the slot is computed)\n"
          f"             packed {f.get('size')}  slot {f.get('slot')}  {f.get('inside', 0):.2%} inside")

    for prop, f in pr_facts.items():
        print(f"\n{prop:<7} canvas {f['canvas'][0]}x{f['canvas'][1]}  union {f['union']}  cell "
              f"{f['cell'][0]}x{f['cell'][1]}  specks {f['specks']}")
        for r in f["reg"]:
            print(f"         frame {r['frame']}: d_bbox {str(r['d_bbox']):<22} d_centroid "
                  f"{r['d_centroid']}   (measured, never enforced -- a plume SHOULD change shape)")

    if fail:
        print(f"\nFAILED ({len(fail)}):")
        for b in fail:
            print(f"  - {b}")
        return 1

    write_atlas(OUT_UI / "hud-atlas.png", ui_sheet, ui_frames,
                {"phase": "07", "source": "concepts/ui/2026-07-17"})
    write_atlas(OUT_PROPS / "twilight-atlas.png", pr_sheet, pr_frames,
                {"phase": "07", "source": "concepts/props/2026-07-17",
                 "anchor": "bottom-center: add with setOrigin(0.5, 1)",
                 "frames_per_prop": PROP_FRAMES})
    print(f"\nwrote public/ui/hud-atlas.png       {ui_sheet.width}x{ui_sheet.height}  "
          f"{len(ui_frames)} frames: {sorted(ui_frames)}")
    print(f"wrote public/props/twilight-atlas.png {pr_sheet.width}x{pr_sheet.height}  "
          f"{len(pr_frames)} frames")
    previews(ui_sheet, ui_frames, pr_sheet, pr_frames)
    print("\nNOT covered here -- see the phase log's visual checklist: whether the bar reads as a "
          "health bar,\nwhether each prop's 4 frames animate as one motion, whether the props read "
          "as a set, text/logos,\nwhether a portrait seats in the slot without a seam, and which "
          "image a chained frame actually used.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
