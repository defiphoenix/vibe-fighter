"""Shared provenance + prompt-integrity gate for the art phases.

Phases 05, 06 and 07 all generate with the Higgsfield CLI and all need the same two questions
answered before a manifest row is flipped: *is this job record real and does it match the prompt
sidecar beside it*, and *did the shared style block drift apart*. Those two checks used to live in
check-characters.py, with check-portraits.py importing them across an importlib shim.

check-portraits.py:62-63 named the trigger for this file in advance:

    "Upgrade path: if a third phase needs check_job, lift it and the shared-block check into a
     scripts/art_gate.py -- two callers is not yet three."

Phase 07 (UI + prop atlases) is the third caller, and it is the one that forced the issue: it
generates at `21:9`, `16:9`, `1:1` and `2:3`, not `3:4`, and its fresh gens pass NO reference image
where 05/06 always pass exactly one. Those were module constants; parameterising them in place would
have put Phase 07's values inside Phase 05's gate file, which is exactly the coupling the comment
predicted.

The defaults on `check_job` are Phase 05/06's old module constants, so both existing callers keep
their call sites verbatim and their behaviour is provably unchanged -- `npm run check:characters`
and `npm run check:portraits` are that proof. That proof is NECESSARY BUT NOT SUFFICIENT, though:
both callers pass the old `3:4`/`2k`, so a parameter that were ignored, swapped, or applied only to
non-3:4 jobs would leave both green. `selftest()` below is what actually exercises the new
arguments.

Reads nothing on its own. Run `python scripts/art_gate.py` to execute the fixtures standalone;
importing it runs nothing (main() is __main__-guarded), which is what lets the callers import it.
"""

import importlib.util
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ponytail: load key-layers.py for KEY_RGB/KEY_LO/KEY_HI/l1/key/despill rather than restating them.
# Its hyphenated name blocks a plain import, and 3 lines of importlib is cheaper than two copies of
# the thresholds drifting apart. Module level is only constants and defs; its main() is
# __main__-guarded. This shim used to live in check-characters.py; it moved here so the chain is
# art_gate -> key-layers for every caller, rather than portraits -> characters -> key-layers.
_spec = importlib.util.spec_from_file_location("key_layers", ROOT / "scripts" / "key-layers.py")
key_layers = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(key_layers)
l1, key, despill = key_layers.l1, key_layers.key, key_layers.despill
KEY_RGB, KEY_LO, KEY_HI = key_layers.KEY_RGB, key_layers.KEY_LO, key_layers.KEY_HI

# Phase 05/06's constants, kept as defaults so their call sites do not change. Phase 07 overrides.
ASPECT = "3:4"
RESOLUTION = "2k"
JOB_TYPE = "nano_banana_pro"
REFS = 1  # how many --image references the job is expected to carry

# Everything from this marker on is the shared style block, byte-identical across a phase's prompts.
SHARED_MARKER = "FRAMING:"


def _norm(s: str) -> str:
    """Text without line-ending noise. The API returns params.prompt with \\r\\n; sidecars are \\n."""
    return s.replace("\r\n", "\n").strip()


def check_job(
    fid: str,
    prompt: str,
    d: Path,
    aspect: str = ASPECT,
    resolution: str = RESOLUTION,
    job_type: str = JOB_TYPE,
    refs: int = REFS,
) -> list[str]:
    """Provenance gate: the manifest must never be flipped on an unverified job record.

    Returns human sentences; an empty list is a pass.

    `aspect`/`resolution`/`job_type`/`refs` default to Phase 05/06's values so those callers are
    unchanged. Phase 07 passes its own -- it generates at four different aspects, and its fresh gens
    carry `refs=0` while its chained prop frames carry `refs=1`.

    What this does NOT prove, inherited by every caller (see the long note at the refs check below):
    WHICH image was used as a reference, and whether the PNG on disk is the bytes the job served.
    """
    path = d / f"{fid}.job.json"
    try:
        jobs = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001 -- any unreadable record is the same failure
        return [f"{path.name}: unreadable ({e})"]

    # ponytail: both CLI shapes are accepted because both are verbatim output -- `create --wait
    # --json` emits a 1-object array, `generate get <id>` emits a bare object. A record recovered
    # from the server after a bad overwrite arrives in the second shape, and normalising here beats
    # hand-editing a provenance file into the "right" shape.
    if isinstance(jobs, dict):
        jobs = [jobs]
    if not isinstance(jobs, list) or len(jobs) != 1:
        return [f"{path.name}: expected 1 job, got {type(jobs).__name__} len {len(jobs)}"]

    j = jobs[0]
    p = j.get("params", {})
    bad = []
    if j.get("status") != "completed":
        bad.append(f"{path.name}: status is {j.get('status')!r}, not 'completed'")
    if j.get("job_type") != job_type:
        bad.append(f"{path.name}: job_type is {j.get('job_type')!r}, not {job_type!r}")
    if p.get("aspect_ratio") != aspect:
        bad.append(f"{path.name}: aspect_ratio is {p.get('aspect_ratio')!r}, not {aspect!r}")
    if p.get("resolution") != resolution:
        bad.append(f"{path.name}: resolution is {p.get('resolution')!r}, not {resolution!r}")
    if not j.get("result_url"):
        bad.append(f"{path.name}: no result_url")

    # ponytail: this asserts HOW MANY reference images were used, not WHICH. That is a limit of the
    # JSON, not of provenance in general: the API uploads the local --image and records only an
    # opaque upload id + a `<id>_resize.jpg` URL, so the source *filename* is genuinely unanswerable
    # from a static record. (A first cut asserted the basename and failed all three Phase 05 refs on
    # good art.) It is NOT unimprovable -- review noted two real upgrade paths, both rejected as more
    # machinery than these phases earn: fetch the resize URL and correlate it against the candidate
    # sources (a gate doing network I/O, and the URL is not guaranteed to outlive the job), or hash
    # the local input at generation time into a sidecar (a second provenance file to keep honest --
    # exactly the drift risk Phase 03 rejected). So the source binding is *recorded*, not proven: it
    # lives in each phase's id->source table, its README, and each prompt's discard clause. Do not
    # read a pass here as proof of which image produced an asset. Phase 07 relies on this too: it
    # cannot prove a chained prop frame referenced frame 0 rather than some other frame.
    got = p.get("input_images") or []
    if len(got) != refs or not all(r.get("id") for r in got):
        bad.append(f"{path.name}: expected exactly {refs} input image(s) with an id, got {got!r}")

    # The API returns params.prompt with \r\n; the sidecar is written with \n. Compare the text, not
    # the line endings -- a raw byte compare fails spuriously here (see near.job.json).
    if _norm(p.get("prompt", "")) != _norm(prompt):
        bad.append(f"{path.name}: params.prompt does not match {fid}.prompt.txt")
    return bad


def check_blocks(prompts: dict, marker: str = SHARED_MARKER) -> list[str]:
    """The shared style block is byte-identical across a phase's prompts.

    Worth being precise about what this buys: it prevents the prompts DRIFTING apart, which is a
    real failure it really catches. It does NOT prove the outputs match -- the model is stochastic,
    and identical prompts do not guarantee identical output. Set consistency is a by-eye call on
    each phase's _preview.png, and the phase logs say so.

    This merges two near-copies: check-portraits.py had it as a function, check-characters.py had it
    inline in main(). They differed only in their failure wording. One copy, one wording.
    """
    blocks = {f: (t[t.index(marker):] if marker in t else None) for f, t in prompts.items()}
    missing = [f for f, b in blocks.items() if b is None]
    if missing:
        return [f"prompt(s) missing the {marker!r} marker: {missing}"]
    if len(set(blocks.values())) != 1:
        return [f"the shared style block is not byte-identical across the {len(blocks)} prompts -- "
                "set consistency is enforced by construction, so this is a real fail"]
    return []


def shared_block(prompts: dict, marker: str = SHARED_MARKER) -> str:
    """The shared block itself, so a caller can report its length. Assumes check_blocks() passed."""
    t = next(iter(prompts.values()))
    return t[t.index(marker):]


def _write(d: Path, fid: str, job: object, prompt: str = "P") -> None:
    (d / f"{fid}.job.json").write_text(json.dumps(job), encoding="utf-8")
    (d / f"{fid}.prompt.txt").write_text(prompt, encoding="utf-8")


def _job(**over) -> dict:
    """A record that passes with the default arguments. Override one key per fixture."""
    j = {
        "status": "completed",
        "job_type": "nano_banana_pro",
        "result_url": "https://example/x.png",
        "params": {
            "aspect_ratio": "3:4",
            "resolution": "2k",
            "prompt": "P",
            "input_images": [{"id": "abc"}],
            "width": 1792,
            "height": 2400,
        },
    }
    j["params"].update(over.pop("params", {}))
    j.update(over)
    return j


def selftest() -> None:
    """Fixtures for this module's own logic, run before any caller trusts it on real art.

    CLAUDE.md: an art gate self-tests before it judges; a wrong metric is more dangerous than no
    metric. The specific reason this suite exists in this shape: a plan review pointed out that
    "check:characters and check:portraits stay green" does NOT prove the extraction preserved
    behaviour, because both callers pass the OLD hardcoded 3:4/2k -- an argument that were ignored,
    swapped, or applied only to non-3:4 jobs would leave both green. So the fixtures below are
    deliberately about the NEW arguments: that each one is read, that a wrong value fails, and that
    transposing two of them fails rather than silently passing.

    Scope, stated honestly: this covers check_job's record parsing and its five parameters, and
    check_blocks. It does NOT cover which source image a job used, nor whether a PNG is the bytes
    its job served -- both are unprovable from a static record (see the ponytail note in check_job),
    and both are named in the phase logs' "what the gate does not cover".
    """
    with tempfile.TemporaryDirectory() as td:
        d = Path(td)

        # --- parity: the pre-extraction behaviour, unchanged, via the defaults -----------------
        _write(d, "f", _job())
        assert check_job("f", "P", d) == [], "a good 3:4/2k record must pass on the defaults"

        _write(d, "f", _job(status="failed"))
        assert any("status" in b for b in check_job("f", "P", d)), "a failed job must not pass"

        _write(d, "f", [_job()])  # the `create --wait --json` 1-object-array shape
        assert check_job("f", "P", d) == [], "the 1-object-array CLI shape must pass"

        _write(d, "f", _job(params={"prompt": "P\r\n"}))
        assert check_job("f", "P\n", d) == [], "CRLF vs LF must not fail a matching prompt"

        _write(d, "f", _job(params={"prompt": "OTHER"}))
        assert any("does not match" in b for b in check_job("f", "P", d)), \
            "a prompt that disagrees with its sidecar must fail"

        # --- positive: EVERY new argument must accept a non-default value, or it is unusable -----
        # (a review noted resolution/job_type were only tested with expected failures -- a gate that
        # rejected every non-default value would have passed. So each gets a positive fixture too.)
        _write(d, "f", _job(params={"aspect_ratio": "21:9"}))
        assert check_job("f", "P", d, aspect="21:9") == [], "21:9 must pass when asked for 21:9"

        _write(d, "f", _job(params={"aspect_ratio": "16:9"}))
        assert check_job("f", "P", d, aspect="16:9") == [], "16:9 must pass when asked for 16:9"

        _write(d, "f", _job(params={"resolution": "4k"}))
        assert check_job("f", "P", d, resolution="4k") == [], "4k must PASS when asked for 4k"

        _write(d, "f", _job(job_type="gpt_image_2"))
        assert check_job("f", "P", d, job_type="gpt_image_2") == [], \
            "a non-default job_type must PASS when asked for -- else the param is unusable"

        # --- negative: each argument is actually READ, not decorative -------------------------
        _write(d, "f", _job(params={"aspect_ratio": "21:9"}))
        assert any("aspect_ratio" in b for b in check_job("f", "P", d, aspect="3:4")), \
            "a 21:9 record must FAIL against aspect='3:4' -- otherwise the arg is ignored"

        _write(d, "f", _job())
        assert any("resolution" in b for b in check_job("f", "P", d, resolution="4k")), \
            "a 2k record must FAIL against resolution='4k'"

        _write(d, "f", _job())
        assert any("job_type" in b for b in check_job("f", "P", d, job_type="gpt_image_2")), \
            "a nano_banana_pro record must FAIL against another job_type"

        # --- refs: Phase 07's fresh gens carry 0, its chained frames carry 1 -------------------
        _write(d, "f", _job(params={"input_images": []}))
        assert check_job("f", "P", d, refs=0) == [], "a fresh gen with no reference must pass refs=0"
        assert any("input image" in b for b in check_job("f", "P", d, refs=1)), \
            "a fresh gen must FAIL refs=1 -- otherwise a chained frame's missing --image is invisible"

        _write(d, "f", _job())
        assert any("input image" in b for b in check_job("f", "P", d, refs=0)), \
            "a referenced gen must FAIL refs=0"
        _write(d, "f", _job(params={"input_images": [{"nope": 1}]}))
        assert any("input image" in b for b in check_job("f", "P", d, refs=1)), \
            "a reference without an id must fail"

        # --- swap: transposing two arguments must fail, not silently pass ----------------------
        _write(d, "f", _job(params={"aspect_ratio": "21:9", "resolution": "2k"}))
        bad = check_job("f", "P", d, aspect="2k", resolution="21:9")
        assert any("aspect_ratio" in b for b in bad) and any("resolution" in b for b in bad), \
            "transposed aspect/resolution args must fail BOTH checks, not cancel out"

        # --- the directory argument is honoured ------------------------------------------------
        _write(d, "f", _job())
        empty = Path(td) / "empty"
        empty.mkdir()
        assert any("unreadable" in b for b in check_job("f", "P", empty)), \
            "check_job must read from `d`, not from a phase's default directory"

    # --- check_blocks -------------------------------------------------------------------------
    ok = f"head\n\n{SHARED_MARKER}\nstyle block\n"
    assert check_blocks({"a": ok, "b": "different head\n\n" + ok[6:]}) == [], \
        "different heads with an identical shared block must pass"
    assert any("not byte-identical" in b for b in
               check_blocks({"a": ok, "b": f"head\n\n{SHARED_MARKER}\nDIFFERENT\n"})), \
        "a drifted shared block must fail"
    assert any("missing the" in b for b in check_blocks({"a": ok, "b": "no marker here"})), \
        "a prompt with no marker must fail"
    assert check_blocks({"a": f"h\n\nX:\nblk", "b": f"j\n\nX:\nblk"}, marker="X:") == [], \
        "the marker argument must be honoured"

    print("art_gate selftest: OK (parity, positive, negative, swap, refs, dir, blocks)")


def main() -> int:
    selftest()
    return 0


if __name__ == "__main__":
    sys.exit(main())
