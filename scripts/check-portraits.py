"""Validates the Phase 06 character-select portraits against the acceptance criteria.

This gate is deliberately much thinner than check-characters.py's, and the reason is worth stating
before the code, because a reader coming from Phase 05 will expect the pixel metrics and not find
them.

Phase 05's references are painted on a flat #FF00FF void, and every number that gate reports --
void fraction, figure count, specks, bbox, margins -- rests on being able to separate figure from
background by chroma. Phase 06's portraits are baked composites: the void is *replaced* by a
painted dusk backdrop (a user decision, recorded in the log). There is no key colour, so there is
no separation, so those metrics do not exist here. `measure()` cannot even be called -- it invokes
key-layers.py's key(), which raises when there is no magenta.

What honestly survives is provenance, prompt identity and size. That is what this script checks.

Two metrics were considered for the gap and rejected, per the repo's rule that a *wrong* metric is
more dangerous than no metric (Phase 04 deleted vacuous checks rather than leave them as
decoration):
  - corner-hex palette distance between the three portraits, as a proxy for "they read as a set".
    Confounded: three different characters legitimately differ in colour, so the threshold would be
    arbitrary in exactly the way Phase 05's rejected unique-colour-count check was.
  - comparing the bottom edge against the top corners to infer "the bust bleeds off the bottom".
    A dark jacket on a dark backdrop reads identically to backdrop. This is Phase 04's
    topmost-opaque-pixel trap (which scored a chain-link mesh as a solid wall) with new paint.

So this script does NOT cover, and does not claim to cover:
  - framing: upper-body vs full-body, and whether the bust bleeds off the bottom edge
  - whether the head survives a top-anchored square crop for the Phase 14 HUD slot
  - likeness to the Phase 05 reference, "distinctive", or "higher fidelity"
  - the absence of text, logos or a name plate
  - whether the three backdrops actually match (identical prompts != identical output)
  - which source image was used, and whether the PNG on disk is the bytes the job served
    (both inherited from check_job -- see the ponytail note in art_gate.py)
All of the above are covered by the per-fighter visual checklist in the phase log, which is this
phase's PRIMARY instrument rather than a supplement to it. `_preview.png` exists to make the
"do these read as a set?" call possible.

Reads concepts/portraits/2026-07-17/<id>.png        (baked composite, no void, nothing to key)
      concepts/portraits/2026-07-17/<id>.prompt.txt (the exact --prompt string)
      concepts/portraits/2026-07-17/<id>.job.json   (verbatim `--json` job record)
Writes concepts/portraits/2026-07-17/_preview.png   (3-up contact sheet for the visual gate)

Run: `npm run check:portraits` (or `python scripts/check-portraits.py`). Exits non-zero on any
failure. Self-tests its own logic first, every run.
"""

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
PORTRAITS = ROOT / "concepts" / "portraits" / "2026-07-17"
REFS = "concepts/characters/2026-07-17"

# ponytail: the upgrade path this comment used to describe has been taken. Phase 07 became the third
# caller of check_job, so it and the shared-block check now live in art_gate.py, and this file imports
# from there instead of reaching through check-characters.py. One hop, one copy. art_gate re-exports
# key-layers' l1/KEY_* too. Its main() is __main__-guarded, so importing it runs nothing.
_spec = importlib.util.spec_from_file_location("art_gate", ROOT / "scripts" / "art_gate.py")
art_gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(art_gate)
check_job, check_blocks, shared_block = art_gate.check_job, art_gate.check_blocks, art_gate.shared_block
l1, KEY_RGB, KEY_LO = art_gate.l1, art_gate.KEY_RGB, art_gate.KEY_LO

# id -> the Phase 05 reference passed as --image. Recorded, not proven: the job record stores only an
# opaque upload id, never the source filename (art_gate.py's check_job has the full note).
FIGHTERS = {"brawler": "brawler", "jiujitsu": "jiujitsu", "monk": "monk"}

# The aspect label lies -- `3:4` really returns 1792x2400 = 0.7467:1, not 0.7500. So the contract is
# the pixel dimensions, and they are checked against the job record rather than trusted from the tag.
WIDTH, HEIGHT = 1792, 2400

SHARED_MARKER = art_gate.SHARED_MARKER  # one definition, in art_gate; kept as a name for the fixtures


def check_size(fid: str, d: Path = PORTRAITS) -> list[str]:
    """The PNG is the size the contract promises, and the job record agrees with the PNG.

    Phase 07's portrait base is built to these numbers and Phase 07 has no other source for them, so
    a silent size drift here is a defect that only surfaces two phases later.
    """
    bad = []
    png = d / f"{fid}.png"
    try:
        w, h = Image.open(png).size
    except Exception as e:  # noqa: BLE001 -- an unreadable PNG is the same failure as a wrong one
        return [f"{png.name}: unreadable ({e})"]
    if (w, h) != (WIDTH, HEIGHT):
        bad.append(f"{png.name}: {w}x{h}, expected {WIDTH}x{HEIGHT}")

    try:
        jobs = json.loads((d / f"{fid}.job.json").read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001 -- check_job reports the record's own faults; don't double up
        return bad + [f"{fid}.job.json: unreadable ({e})"]
    if isinstance(jobs, dict):
        jobs = [jobs]
    if not isinstance(jobs, list) or len(jobs) != 1:
        return bad  # check_job already fails this shape; no second complaint
    p = jobs[0].get("params", {})
    if (p.get("width"), p.get("height")) != (w, h):
        bad.append(
            f"{fid}.job.json: params say {p.get('width')}x{p.get('height')}, PNG is {w}x{h} -- the "
            "record does not describe the file beside it"
        )
    return bad


def baked_facts(fid: str, d: Path = PORTRAITS) -> dict:
    """The measured facts behind check_baked. Split out so main() can PRINT numbers rather than
    verdicts -- a number cannot claim success on a failing file the way a hardcoded sentence can."""
    im = Image.open(d / f"{fid}.png")
    # Not `mode == "RGBA"`: LA, PA and palette-with-transparency also carry alpha, and convert("RGB")
    # would silently discard it before the magenta test ever ran.
    has_alpha = "A" in im.getbands() or (im.mode == "P" and "transparency" in im.info)
    amin = int(np.array(im.convert("RGBA").getchannel("A")).min()) if has_alpha else 255
    resid = int((l1(np.array(im.convert("RGB")), KEY_RGB) < KEY_LO).sum())
    return {"mode": im.mode, "has_alpha": has_alpha, "alpha_min": amin, "magenta_px": resid}


def check_baked(fid: str, d: Path = PORTRAITS) -> list[str]:
    """The void was really replaced, and the image is really opaque.

    Scope, stated narrowly on purpose: this proves **no pixel sits in the magenta key range** and
    **nothing is transparent**. It does NOT prove the backdrop is the one that was asked for -- a
    flat slab of any non-magenta colour passes, and the selftest's passing fixture is exactly that.
    The gradient, the rays, the halftone and "do the three match?" have no metric here and belong to
    the visual checklist. The name is about the void being gone, not about the art being right.

    Still not decoration: it checks the single prompt clause most likely to fail. The Phase 05
    reference passed as `--image` IS a magenta void, and `--image` dominates the prompt, so "replace
    the magenta completely" is a real instruction the model could really ignore in a corner.

    The bound is KEY_LO (L1 40), i.e. "any pixel that would key as fully void" -- borrowed from
    key-layers.py rather than restated, so it moves with the keyer. It is the right threshold rather
    than a cautious one: a real surviving void sits at ~(252,1,252), which is L1 7 from pure magenta
    and well inside 40, while the nearest backdrop colour (#5E3C74) is L1 360 away -- ~9x headroom
    either side, so the exact cut is not load-bearing.

    Alpha is checked for any mode that can carry it, not just RGBA. `nano_banana_pro` returns an
    RGBA *container* non-deterministically (2 of these 3 portraits are RGBA, 1 is RGB, from identical
    params) with every pixel at 255 -- so mode is not evidence of transparency, and a real hole would
    mean the backdrop failed to paint.
    """
    m = baked_facts(fid, d)
    bad = []
    if m["alpha_min"] != 255:
        bad.append(f"{fid}.png: alpha is not opaque (mode {m['mode']}, min {m['alpha_min']}) -- the "
                   "backdrop is meant to be baked in; a hole here means it did not paint")
    if m["magenta_px"]:
        bad.append(f"{fid}.png: {m['magenta_px']} px of #FF00FF survived -- the reference's void was "
                   "supposed to be replaced by the backdrop, not kept")
    return bad


def preview(d: Path = PORTRAITS) -> None:
    """3-up contact sheet. Not decoration: 'do these three read as a set?' lost its metric when the
    void did, so this is the artifact the by-eye call is actually made on. Aspect preserved."""
    pngs = [d / f"{fid}.png" for fid in FIGHTERS]
    if not all(p.exists() for p in pngs):
        return
    tw, pad, bar = 380, 12, 26
    ims = [Image.open(p).convert("RGB") for p in pngs]
    th = max(round(tw * im.height / im.width) for im in ims)  # preserve each source aspect
    sheet = Image.new("RGB", (len(ims) * tw + (len(ims) + 1) * pad, th + bar + 2 * pad), (24, 24, 28))
    dr = ImageDraw.Draw(sheet)
    for i, (im, fid) in enumerate(zip(ims, FIGHTERS)):
        x = pad + i * (tw + pad)
        sheet.paste(im.resize((tw, round(tw * im.height / im.width)), Image.LANCZOS), (x, pad))
        dr.text((x + 4, pad + th + 6), f"{fid}  {im.width}x{im.height}", fill=(220, 220, 220))
    sheet.save(d / "_preview.png")
    print(f"wrote {(d / '_preview.png').relative_to(ROOT)}  ({sheet.width}x{sheet.height})")


def selftest() -> None:
    """Negative cases for this script's own logic, before it judges real art.

    CLAUDE.md: an art gate self-tests before it judges. The temptation here was to skip it -- there
    are no pixel metrics left to get wrong, and fixtures for string equality are ceremony. That
    reasoning is wrong twice: check_job just grew a NEW directory parameter (Phase 05's fixtures
    never exercised check_job at all), check_size's cross-check is new logic, and check_blocks is by
    this script's own argument the most load-bearing check it has. Untested load-bearing code is
    exactly Phase 04's warning.

    Unlike Phase 05's suite these are not purely in-memory: check_job/check_size/check_baked read
    from disk by design (the directory override is the thing under test), so the fixtures are written
    to a TemporaryDirectory and cleaned up. No fixture files are committed.
    """
    import tempfile

    ok_shared = f"head\n\n{SHARED_MARKER}\nstyle block\n"
    assert check_blocks({"a": ok_shared, "b": "different head\n\n" + ok_shared[6:]}) == [], \
        "identical shared blocks after different heads must pass"
    assert any("not byte-identical" in b for b in
               check_blocks({"a": ok_shared, "b": f"head\n\n{SHARED_MARKER}\nDIFFERENT\n"})), \
        "a drifted shared block must fail"
    assert any("missing the" in b for b in check_blocks({"a": ok_shared, "b": "no marker here"})), \
        "a prompt without the marker must fail"

    def job(**over):
        j = {"status": "completed", "job_type": "nano_banana_pro", "result_url": "https://x/y.png",
             "params": {"aspect_ratio": "3:4", "resolution": "2k", "prompt": "P",
                        "width": WIDTH, "height": HEIGHT,
                        "input_images": [{"id": "u1", "type": "media_input", "url": "https://x/r.jpg"}]}}
        j["params"].update(over.pop("params", {}))
        j.update(over)
        return j

    with tempfile.TemporaryDirectory() as td:
        d = Path(td)
        Image.new("RGB", (WIDTH, HEIGHT), (10, 20, 30)).save(d / "f.png")

        # The directory override is the new code path: without it check_job silently reads Phase 05's
        # records and passes on a portrait that does not exist.
        (d / "f.job.json").write_text(json.dumps([job()]), encoding="utf-8")
        assert check_job("f", "P", d) == [], "a good record in an overridden dir must pass"
        assert check_size("f", d) == [], "a correctly sized PNG + agreeing record must pass"

        # Bare-object shape, as `generate get <id> --json` emits after a recovery.
        (d / "f.job.json").write_text(json.dumps(job()), encoding="utf-8")
        assert check_job("f", "P", d) == [], "the bare-object CLI shape must pass too"

        # The API returns params.prompt with CRLF; the sidecar is LF.
        (d / "f.job.json").write_text(json.dumps([job(params={"prompt": "P\r\n"})]), encoding="utf-8")
        assert check_job("f", "P\n", d) == [], "CRLF vs LF must not fail a matching prompt"

        (d / "f.job.json").write_text(json.dumps([job(params={"prompt": "OTHER"})]), encoding="utf-8")
        assert any("does not match" in b for b in check_job("f", "P", d)), \
            "a record whose prompt is not the sidecar's must fail"

        (d / "f.job.json").write_text(json.dumps([job(status="failed")]), encoding="utf-8")
        assert any("status" in b for b in check_job("f", "P", d)), "a failed job must not pass"

        # The record must describe the file beside it -- a stale record + a fresh PNG is the way a
        # size drift reaches Phase 07 unnoticed.
        (d / "f.job.json").write_text(json.dumps([job(params={"width": 1024})]), encoding="utf-8")
        assert any("does not describe the file" in b for b in check_size("f", d)), \
            "params.width disagreeing with the PNG must fail"

        (d / "f.job.json").write_text(json.dumps([job()]), encoding="utf-8")
        Image.new("RGB", (800, 600), (10, 20, 30)).save(d / "f.png")
        assert any("expected" in b for b in check_size("f", d)), "a wrong-sized PNG must fail"

        # check_baked: a painted backdrop passes; surviving void fails; a real alpha hole fails.
        Image.new("RGB", (64, 64), (94, 60, 116)).save(d / "f.png")  # #5E3C74, the backdrop's top
        assert check_baked("f", d) == [], "a fully painted backdrop must pass"
        void = Image.new("RGB", (64, 64), (94, 60, 116))
        void.paste(Image.new("RGB", (8, 8), (252, 1, 252)), (0, 0))  # the void as really emitted
        void.save(d / "f.png")
        assert any("survived" in b for b in check_baked("f", d)), \
            "magenta surviving in a corner must fail -- and at the real (252,1,252), not pure"
        holed = Image.new("RGBA", (64, 64), (94, 60, 116, 255))
        holed.paste((0, 0, 0, 0), (0, 0, 8, 8))
        holed.save(d / "f.png")
        assert any("not opaque" in b for b in check_baked("f", d)), \
            "a transparent hole must fail -- the backdrop is meant to be baked"

        # ...and not only in RGBA. `mode == "RGBA"` was the first cut and it let LA / palette
        # transparency through to convert("RGB"), which drops alpha silently. Review's catch.
        la = Image.new("LA", (64, 64), (128, 255))
        la.paste((0, 0), (0, 0, 8, 8))
        la.save(d / "f.png")
        assert any("not opaque" in b for b in check_baked("f", d)), \
            "an LA-mode hole must fail too -- alpha is not RGBA-only"
        pal = Image.new("P", (64, 64), 1)
        pal.putpalette([0, 0, 0] + [94, 60, 116] * 255)
        pal.info["transparency"] = 0
        pal.paste(0, (0, 0, 8, 8))
        pal.save(d / "f.png")
        assert any("not opaque" in b for b in check_baked("f", d)), \
            "palette transparency must fail too"

    print("selftest: 16 fixtures OK (blocks identical/drifted/no-marker, dir override, array+object "
          "shapes, CRLF, prompt mismatch, failed status, size cross-check, wrong size, backdrop "
          "painted/void-survived, alpha holes RGBA/LA/palette)")


def main() -> int:
    selftest()

    prompts = {}
    for fid in FIGHTERS:
        p = PORTRAITS / f"{fid}.prompt.txt"
        if not p.exists():
            print(f"FAIL {fid}: {p} is missing")
            return 1
        prompts[fid] = p.read_text(encoding="utf-8")

    failures = list(check_blocks(prompts))
    if not failures:
        print(f"shared style block: identical across {len(prompts)} prompts "
              f"({len(shared_block(prompts))} chars)")

    for fid, ref in FIGHTERS.items():
        png = PORTRAITS / f"{fid}.png"
        if not png.exists():
            failures.append(f"{fid}: {png.name} is missing")
            continue
        bad = check_size(fid) + check_baked(fid) + check_job(fid, prompts[fid], PORTRAITS)
        w, h = Image.open(png).size
        m = baked_facts(fid)
        # Report MEASUREMENTS, never verdicts. An earlier cut printed "matches params.prompt" and
        # "0 px magenta survived" as fixed strings, so a FAIL heading was followed by affirmative
        # claims about the very checks that had just failed. Numbers cannot do that; the `!!` lines
        # below carry the failures. (Review caught it -- in a phase whose whole argument is that a
        # gate must not claim more than it proves.)
        print(
            f"\n{'PASS' if not bad else 'FAIL'} {fid}  <- {REFS}/{ref}.png\n"
            f"  size        {w}x{h}  ({w / h:.4f}:1)\n"
            f"  prompt      {len(prompts[fid])} chars\n"
            f"  backdrop    {m['mode']}, alpha min {m['alpha_min']}, "
            f"{m['magenta_px']} px within L1 {KEY_LO:.0f} of #FF00FF"
        )
        for b in bad:
            print(f"  !! {b}")
        failures += [f"{fid}: {b}" for b in bad]

    preview()

    print()
    if failures:
        print(f"FAILED ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(f"all {len(FIGHTERS)} portraits pass the automated gate "
          f"(provenance + prompt identity + size)")
    print("NOT covered here -- see the phase log's visual checklist: framing, bottom bleed, HUD-crop "
          "safe area, likeness, fidelity, distinctness, text/logos, backdrop set-consistency")
    return 0


if __name__ == "__main__":
    sys.exit(main())
