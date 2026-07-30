#!/usr/bin/env python
"""Phase 20 audio: transcode the generated masters into the shipped cues, and gate them.

Two modes, one file:

  python scripts/build-audio.py            # BUILD: masters -> public/audio/*.mp3   (needs concepts/)
  python scripts/build-audio.py --check    # CHECK: measure + gate public/audio/    (fresh-clone safe)

BUILD reads `concepts/audio/<DATE>/<key>-raw.mp3` (the Higgsfield output, gitignored) and produces
`public/audio/<key>.mp3`. CHECK reads only `public/`, so it runs on a clone that has never seen the
masters — which is the point: the gate must work for anyone, the build only for whoever holds the art.

Why a build step at all, when Higgsfield already returns MP3:

  * the models emit 1.3-13.5 s of material for a cue that wants ~0.5 s, with the event anywhere in it
    (`super`'s onset measured at 10.80 s of a 13.53 s file) -- so each SFX is TRIMMED to its first
    event;
  * levels arrive between -0.0 and -24 dBFS with no consistency, so everything is PEAK-NORMALISED;
  * the bitrate has to be chosen against a hard mobile budget.

`AUDIO_KEYS` is PARSED out of `src/render/audio-cues.ts`, never re-listed here. A duplicated list is
the R-14 defect shape: two spellings of one fact, free to drift.

ffmpeg/ffprobe are driven through `subprocess`, which is fine -- `docs/art-pipeline.md`'s ban on that
is specific to `higgsfield`, a `.cmd` shim whose arg quoting mangles a multi-line `--prompt`.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CUES_TS = ROOT / "src" / "render" / "audio-cues.ts"
MASTERS = ROOT / "concepts" / "audio" / "2026-07-30"
OUT = ROOT / "public" / "audio"

SR = 44100

# --- the shipped budget -------------------------------------------------------------------------
# 1.2 MB total, the ceiling agreed for the phase. Enforced as a HARD gate rather than described in a
# doc, because the first draft of this phase planned 128 kbps beds -- 90 s of which is 1.44 MB before
# a single SFX, i.e. the plan's own stated ceiling was arithmetically impossible and nobody had
# multiplied it out. A number a script checks cannot drift like that.
TOTAL_BUDGET_BYTES = 1_200 * 1024

# Peak window for every shipped file. Anything outside it means the normalisation did not run, or the
# encoder clipped.
PEAK_MIN_DB, PEAK_MAX_DB = -3.0, -0.05

# Normalise the PRE-encode signal to this, not to the -1 dBFS you actually want out the far end.
#
# MP3 is lossy in amplitude as well as in spectrum: the decoded waveform overshoots the peak it was
# handed. Measured on this exact set, targeting -1.0 dBFS produced 0.0 dBFS decoded on all 12 SFX and
# the ambience bed (~1.0 dB of overshoot) and -0.8 on the music bed (~0.2 dB). The first build flagged
# all thirteen -- the gate doing its job on its first run, which is the only evidence that it works.
# -2.0 leaves the overshoot landing near -1, inside the window, with real headroom against clipping.
NORM_TARGET_DB = -2.0

# Cues that a single frame can fire together, and the volume the game plays them at.
#
# A KO emits `hitHeavy` + `ko` + `roundEnd` on one frame. Summed at full volume the shipped files peak
# at +3.9 dBFS -- over the destination ceiling, i.e. audible distortion on the most important moment in
# a match. `audio-view.ts` plays cues at CUE_VOLUME to fix it; this gate recomputes the worst case from
# the actual files so the number cannot quietly stop being enough when a cue is regenerated louder.
WORST_CASE_STACK = ["hitHeavy", "ko", "roundEnd"]
STACK_CEILING_DB = -1.0
VIEW_TS = ROOT / "src" / "render" / "audio-view.ts"

# Per-cue encode settings. `tail_s` is how much to keep AFTER the first event's onset; the trim also
# stops early once the signal has decayed, so this is a ceiling and not a padding.
SFX_KBPS = 64
BEDS = {
    "ambience": dict(kbps=64, stereo=False, fade_s=0.0),
    # NO fade, and that is the second answer, not the first.
    #
    # The raw bed has a 6.9 dB step between its head and its tail, which is a small bump on each loop.
    # A 1.5 s fade-in + fade-out pair was added to "crossfade" it. That is not what a fade pair does to
    # a SINGLE stream: with nothing to overlap it, it just drives both ends to silence. Measured on the
    # shipped file: head -47.4 dB, tail -52.7 dB against -16.2 dB mid-track -- a ~35 dB hole every time
    # the loop came round, where the defect being fixed was a 6.9 dB step.
    #
    # A real crossfade needs the tail mixed OVER the head (two inputs, `acrossfade`), which also
    # shortens the loop. Not worth it for 6.9 dB: the untouched seam is the better of the two, and it is
    # what ships.
    "menuMusic": dict(kbps=96, stereo=True, fade_s=0.0),
}
TAIL_S = {
    # `super` is long because it is the one cue with a WIND-UP: the prompt asks for a rising charge
    # before the burst, `first_event` now reaches back to include it, and cutting the tail at 2.2 s
    # would throw away what the extra start just recovered.
    "ko": 2.2, "super": 3.6, "roundStart": 2.0, "roundEnd": 2.4,
    "land": 0.8, "jump": 0.6, "whiff": 0.5,
    "hitLight": 0.5, "hitHeavy": 0.6, "block": 0.5,
    "menuMove": 0.35, "menuConfirm": 0.8,
}


def audio_keys() -> tuple[list[str], list[str]]:
    """Parse CUE_KEYS and BED_KEYS out of the TypeScript module.

    Deliberately strict: if the shape of those declarations changes, this raises rather than silently
    gating a subset. A gate that quietly checks fewer things than it claims is worse than no gate.
    """
    src = CUES_TS.read_text(encoding="utf-8")

    def grab(name: str) -> list[str]:
        m = re.search(rf"export const {name} = \[(.*?)\] as const;", src, re.S)
        if not m:
            raise SystemExit(f"build-audio: could not parse {name} out of {CUES_TS}")
        # Digits, underscores and hyphens included: the previous class silently DROPPED any key
        # containing them while keeping its neighbours, so the gate would have checked a subset
        # while reporting success.
        keys = re.findall(r'"([A-Za-z0-9_-]+)"', m.group(1))
        if not keys:
            raise SystemExit(f"build-audio: {name} parsed empty in {CUES_TS}")
        return keys

    return grab("CUE_KEYS"), grab("BED_KEYS")


def playback_levels() -> tuple[float, float]:
    """Read CUE_VOLUME and the ambience bed volume out of `audio-view.ts`.

    Parsed, not copied. Holding a second spelling of these numbers here is the R-14 defect shape and it
    was briefly real: with a hardcoded `CUE_VOLUME = 0.5` in this file, raising the volume in the
    TypeScript back to 1.0 left the clipping gate perfectly green — it was checking its own copy.
    """
    src = VIEW_TS.read_text(encoding="utf-8")
    m = re.search(r"const CUE_VOLUME = ([0-9.]+);", src)
    if not m:
        raise SystemExit(f"build-audio: could not parse CUE_VOLUME out of {VIEW_TS}")
    b = re.search(r'volume: key === "menuMusic" \? [0-9.]+ : ([0-9.]+)', src)
    if not b:
        raise SystemExit(f"build-audio: could not parse the bed volume out of {VIEW_TS}")
    return float(m.group(1)), float(b.group(1))


def decode(path: Path) -> np.ndarray:
    """Decode to mono float at SR, for measurement only.

    **`f32le`, never `s16le`, and that is load-bearing.** A 16-bit decode CLAMPS at full scale, so any
    source hotter than 0 dBFS reads back as exactly 0.0 -- its true peak is invisible. The Higgsfield
    masters are hot: `hitHeavy-raw.mp3` measures **+2.00 dBFS** decoded as float.

    Read through `s16le`, that master reported 0.0, so `encode()` computed a normalising gain 2 dB too
    small and every shipped SFX came out pinned at full scale. The peak gate flagged all thirteen, the
    obvious hypothesis was MP3 encoder overshoot, and a target sweep disproved it: real overshoot here
    is +/-0.25 dB. The defect was in the instrument, not the thing it measured -- which is why the gate
    exists at all.
    """
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
        check=True, stdout=subprocess.PIPE,
    ).stdout
    return np.frombuffer(out, dtype=np.float32)


def db(x: float) -> float:
    return 20.0 * np.log10(max(x, 1e-9))


def envelope(x: np.ndarray, win_s: float = 0.05) -> np.ndarray:
    hop = max(int(SR * win_s), 1)
    n = max(len(x) - hop, 1)
    return np.array([db(np.sqrt((x[i:i + hop] ** 2).mean())) for i in range(0, n, hop)])


MAX_LEAD_S = 1.6      # how much wind-up may be pulled in ahead of the release


def first_event(x: np.ndarray) -> tuple[float, float]:
    """(start_s, end_s) of the first event, INCLUDING any wind-up that leads into it.

    The generators hand back several takes of one sound separated by true silence -- `hitLight` came
    back as three punches, `ko` as three booms -- so the first take is both the shortest file and the
    only choice that sounds like a single hit.

    Two indices, not one, and conflating them broke it once already:

      * `peak` is the RELEASE: the first window within 12 dB of the loudest moment.
      * `start` walks BACK from the release to pick up a charge sitting below that line. `super` is
        exactly that shape by prompt, and measured on its master a steady -20..-13 dB region runs from
        9.0 s into the -8 dB burst at 11.5 s, while the release-only trim began at 10.77 s.

    The end must be measured FORWARD FROM THE RELEASE, never from the extended start. Computing it
    from the start collapsed `super` to 0.13 s: the decay floor was derived over a range beginning in
    quiet material, so the very next soft window looked like the end of the sound.

    The lead-in is capped at MAX_LEAD_S, because a bed-like cue has no silence to stop the walk and
    would otherwise reach back to the top of the file.
    """
    env = envelope(x)
    hop_s = 0.05
    if len(env) == 0:
        return 0.0, len(x) / SR
    above = env > env.max() - 12.0        # "the event" = within 12 dB of the loudest moment
    if not above.any():
        return 0.0, len(x) / SR
    peak = int(np.argmax(above))

    lead_floor = env.max() - 34.0
    max_back = int(MAX_LEAD_S / hop_s)
    start = peak
    while start > 0 and peak - start < max_back and env[start - 1] > lead_floor:
        start -= 1

    # Decay, measured from the release: 30 dB below the event peak, sustained for 150 ms.
    floor = env[peak:].max() - 30.0
    quiet = 0
    end = len(env)
    for i in range(peak, len(env)):
        quiet = quiet + 1 if env[i] < floor else 0
        if quiet >= 3:
            end = i
            break
    return max(start * hop_s - 0.03, 0.0), end * hop_s   # 30 ms pre-roll so the attack is not clipped


def encode(src: Path, dst: Path, *, start: float, dur: float, kbps: int, stereo: bool, fade_s: float = 0.0) -> None:
    # Peak-normalise: measure, then apply a fixed gain. `loudnorm` would be the usual choice and is
    # the wrong one here -- it targets perceived LOUDNESS, which for a 0.4 s impact means crushing the
    # transient that IS the sound.
    x = decode(src)
    seg = x[int(start * SR):int((start + dur) * SR)]
    gain_db = NORM_TARGET_DB - db(np.abs(seg).max() if len(seg) else 1.0)

    af = [f"volume={gain_db:.2f}dB"]
    if fade_s > 0:
        af.append(f"afade=t=in:st=0:d={fade_s}")
        af.append(f"afade=t=out:st={max(dur - fade_s, 0):.2f}:d={fade_s}")

    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", str(src),
         "-ac", "2" if stereo else "1", "-ar", str(SR), "-b:a", f"{kbps}k",
         "-af", ",".join(af), "-map_metadata", "-1", str(dst)],
        check=True,
    )


def build() -> int:
    cues, beds = audio_keys()
    missing = [k for k in cues + beds if not (MASTERS / f"{k}-raw.mp3").exists()]
    if missing:
        print(f"build-audio: no master for {missing} under {MASTERS} -- nothing to build from.")
        return 1

    for k in cues:
        src = MASTERS / f"{k}-raw.mp3"
        x = decode(src)
        s, e = first_event(x)
        dur = min(e - s, TAIL_S.get(k, 1.0))
        encode(src, OUT / f"{k}.mp3", start=s, dur=dur, kbps=SFX_KBPS, stereo=False)
        print(f"  {k:<13} trim {s:.2f}s +{dur:.2f}s")

    for k in beds:
        src = MASTERS / f"{k}-raw.mp3"
        cfg = BEDS[k]
        dur = len(decode(src)) / SR
        encode(src, OUT / f"{k}.mp3", start=0.0, dur=dur, **cfg)
        print(f"  {k:<13} full {dur:.2f}s @ {cfg['kbps']}k {'stereo' if cfg['stereo'] else 'mono'}")
    return 0


def check() -> int:
    cues, beds = audio_keys()
    keys = cues + beds
    flags: list[str] = []
    total = 0

    print(f"{'key':<14}{'dur':>8}{'peak':>9}{'crest':>8}{'KB':>8}")
    for k in keys:
        f = OUT / f"{k}.mp3"
        if not f.exists():
            flags.append(f"MISSING {f.relative_to(ROOT)} (declared in audio-cues.ts)")
            print(f"{k:<14}{'--':>8}{'--':>9}{'--':>8}{'--':>8}")
            continue
        x = decode(f)
        size = f.stat().st_size
        total += size
        peak = db(np.abs(x).max())
        crest = peak - db(np.sqrt((x ** 2).mean()))
        print(f"{k:<14}{len(x) / SR:>7.2f}s{peak:>8.1f}d{crest:>7.1f}d{size / 1024:>7.0f}K")
        if not (PEAK_MIN_DB <= peak <= PEAK_MAX_DB):
            flags.append(f"PEAK {k}: {peak:.1f} dBFS outside [{PEAK_MIN_DB}, {PEAK_MAX_DB}]")

    # The mix nobody hears until it is too late: several cues landing on ONE frame, over the bed.
    cue_vol, bed_vol = playback_levels()
    have = [k for k in WORST_CASE_STACK if (OUT / f"{k}.mp3").exists()]
    if have:
        xs = [decode(OUT / f"{k}.mp3") * cue_vol for k in have]
        n = max(len(x) for x in xs)
        mix = np.zeros(n, dtype=np.float64)
        for x in xs:
            mix[:len(x)] += x
        amb = OUT / "ambience.mp3"
        if amb.exists():
            b = decode(amb)[:n] * bed_vol
            mix[:len(b)] += b
        stack_db = db(np.abs(mix).max())
        print(f"worst-case one-frame mix ({' + '.join(have)} @ {cue_vol} over the bed @ {bed_vol}): {stack_db:+.1f} dBFS")
        if stack_db > STACK_CEILING_DB:
            flags.append(f"STACK: {stack_db:+.1f} dBFS exceeds {STACK_CEILING_DB} — a KO will clip")

    print(f"\ntotal {total / 1024:.0f} KB of a {TOTAL_BUDGET_BYTES / 1024:.0f} KB budget")
    if total > TOTAL_BUDGET_BYTES:
        flags.append(f"BUDGET: {total / 1024:.0f} KB over the {TOTAL_BUDGET_BYTES / 1024:.0f} KB ceiling")

    # "no file without a cue" was only half true: the loop above walks DECLARED keys, so a renamed or
    # abandoned mp3 sat in public/ forever, shipped to every player and invisible to the byte budget.
    stray = sorted(f.name for f in OUT.glob("*.mp3") if f.stem not in keys)
    if stray:
        flags.append(f"STRAY: {stray} in public/audio with no cue in audio-cues.ts")

    for f in flags:
        print(f"FLAG  {f}")
    return 1 if flags else 0


def selftest() -> int:
    """Fixtures for the two decisions that are easy to get silently wrong.

    Both sit on BOTH sides of their boundary. A threshold only ever tested from the passing side is
    how `AIR_GAP_MAX` sat at its own worst observed value for two phases.
    """
    ok = True

    # (1) first_event finds the FIRST of several takes, not the loudest.
    x = np.zeros(int(SR * 3.0), dtype=np.float32)
    x[int(SR * 0.50):int(SR * 0.55)] = 0.4      # first, quieter
    x[int(SR * 2.00):int(SR * 2.05)] = 1.0      # second, louder
    s, e = first_event(x)
    if not (0.40 <= s <= 0.52 and e < 1.5):
        print(f"SELFTEST FAIL first_event picked {s:.2f}..{e:.2f}, wanted the ~0.5s take")
        ok = False

    # (1b) a WIND-UP below the 12 dB line must be kept, not cut. This is the `super` shape, and the
    # fixture deliberately puts the charge 20 dB down -- well under the old threshold, which is why the
    # old build started `super` 1.8 s late. The earlier fixture's takes were only ~8 dB apart, so it
    # could not have caught this.
    y = np.zeros(int(SR * 4.0), dtype=np.float32)
    y[int(SR * 1.00):int(SR * 2.00)] = 0.05     # charge, -26 dB
    y[int(SR * 2.00):int(SR * 2.30)] = 1.0      # release
    s2, e2 = first_event(y)
    if not (0.90 <= s2 <= 1.05):
        print(f"SELFTEST FAIL first_event started at {s2:.2f}, cutting the wind-up (wanted ~1.0)")
        ok = False

    # (2) the key list really is parsed, and really is the module's.
    cues, beds = audio_keys()
    if "hitHeavy" not in cues or "menuMusic" not in beds or len(cues) + len(beds) != 14:
        print(f"SELFTEST FAIL audio_keys parsed {len(cues)} cues + {len(beds)} beds: {cues} {beds}")
        ok = False

    print("selftest OK" if ok else "selftest FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="gate public/audio (no masters needed)")
    ap.add_argument("--selftest", action="store_true", help="run this script's own fixtures")
    a = ap.parse_args()
    sys.exit(selftest() if a.selftest else check() if a.check else build())
