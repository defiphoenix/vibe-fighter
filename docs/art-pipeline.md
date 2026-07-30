# Art pipeline (Phases 03–09)

Everything about generating the game's art with the Higgsfield CLI. Phases 03–09 are shipped, so this
is reference for the next art task, not something to read every session. `CLAUDE.md` links here.

Background-specific gotchas live in [`concepts/backgrounds/README.md`](../concepts/backgrounds/README.md),
character-specific ones in [`concepts/characters/2026-07-17/README.md`](../concepts/characters/2026-07-17/README.md).
Per-phase detail is in the `docs/phases/*-log.md` files and the project memory
(`phase-03-done`, `phase-04-done`, `phase-05-done`, … under `~/.claude/projects/c--Claude-Street-Fighter/memory/`).

## The generator

The recipe's Codex `$imagegen` is **not wired** (Codex CLI has no image-generation subcommand) — art is
generated with the **Higgsfield CLI**, model `nano_banana_pro`:

```bash
higgsfield generate create nano_banana_pro --prompt "$(cat X.prompt.txt)" --aspect_ratio 21:9 --wait --json > X.job.json
# then: result_url from the JSON -> curl -o X-raw.png
```

Save the exact prompt (`X.prompt.txt`) and job record (`X.job.json`: model, flags, job id, result URL)
beside every PNG — a prompt alone doesn't say what produced it. Redirect **stdout only**; `2>&1` merges
the CLI's `Error:` line into the JSON and corrupts it. Jobs fail transiently — check `status`, retry.

## Character sprites are image-to-VIDEO, not stills

Independent per-pose still gens DRIFT badly across a roster (outfit vanishes, hair recolors,
knockdown/ko hallucinate a second figure), and `autosprite` (AutoSprite Animation) failed opaquely on
every input. The working pipeline: **Seedance 2.0 image-to-video**, one clip per state from the locked
Phase 05 reference (`--start-image`) with a per-state motion prompt that re-states the exact outfit,
then `ffmpeg` samples N frames and `scripts/build-sprites.py` packs them. Video is temporally consistent
*by construction*, which is what fixes the drift.

Driver: `scripts/gen-sprite-videos.sh <fighter> [states…]` (skips already-complete states; `set -u`
needs every state in its `MOTION` map — now all **16**). The old still-image `gen-real-sprites.sh` is
**retired** (hard-exits; it drifted and lacked the new states).

Resolution-pass gotcha: **crouch attacks need a forceful "squatting all the way down, thighs parallel to
the ground, NEVER stands up, NEVER lies down" prompt** — the default came out standing (jiujitsu's
upright judo prior especially resisted "low", and "low"/"diving" can drift a fighter onto the ground);
drift is per-subject, so review contact sheets before accepting.

### The sampling rate is a prompt variable, and it is the one that is always forgotten

`ffmpeg` samples N frames EVENLY across the whole 4s clip, so what matters is not "does the motion
happen" but "is the motion still happening at every sample". Two distinct failures, two distinct fixes,
both in `gen-sprite-videos.sh`:

- **One-shot motions finish early** and the remaining samples repeat a held pose — a 6-frame sheet
  carrying 3 distinct poses (`monk/attackLight` measured steps `0.00 0.33 0.01 0.32 0.09`). Fixed by the
  shared **`SPAN_CLIP`** clause: perform the single motion slowly enough to fill the entire clip,
  extending through the first half and returning through the second, never holding still and never
  repeating.
- **Cyclic motions run too FEW cycles.** Three idles measured 0.05–0.12 peak change and read as frozen
  photographs. "Subtly bobs" was the first cause (the model reads "subtle" as "do not move") but raising
  the amplitude alone only reached 0.10 — with ONE slow bob across 4s, 8 evenly-spaced samples all land
  at nearly the same phase. **Name the cycle COUNT**: "bobs … exactly TWICE during the clip, one
  complete down-and-up about every two seconds" took all three idles to 0.35–0.44 with zero duplicate
  frames, first try on each. The tell was in the numbers beforehand — the least-bad idle scored best
  purely because it happened to run ~2.5 cycles (steps `0.01/0.13/0.12` repeating).

### A fighter's own earlier clip is a free start image, and a better one

`jiujitsu/crouchLight` needed a genuinely crouched stance; rather than generate a still for it, the last
frame of his own `crouch` clip (`concepts/characters/sprites/jiujitsu/crouch/03.png`) was already deep
(aspect 0.85 vs 0.69 at the start), already on the magenta void, and already at the right scale — 0
credits, and the two animations now agree pixel-for-pixel at the moment the player presses the button.
Only generate a fresh still (as the monk needed) when no existing clip reaches the pose.

## Audio (Phase 20)

Same CLI, same provenance discipline (`X.prompt.txt` + `X.job.json` beside the master), different
models and one trap of its own.

```bash
higgsfield generate create seed_audio  --prompt "$(cat X.prompt.txt)" --format mp3 --sample_rate 44100 --wait --json > X.job.json
higgsfield generate create sonilo_music --prompt "$(cat X.prompt.txt)" --duration 60 --wait --json > X.job.json
```

Driver: `bash scripts/gen-audio.sh` (regenerates only missing masters; **reuses a committed job record
for free** rather than re-billing, because `generate get <id>` restores a result URL at no cost). Then
`npm run build:audio && npm run check:audio`.

- **`seed_audio` for everything percussive, `sonilo_music` for music.** The model whose name promises
  otherwise, `mirelo_text_to_audio`, was measured on the same punch prompt and returned a **flat
  −29 dBFS noise floor with a 12.9 dB crest** — no transient at all — against seed_audio's −4.3 dBFS
  and 21.1 dB. It is also 2.5× the price. Probe one cue before committing a batch.
- **`generate cost` UNDER-reports audio by ~6×.** It quoted 0.2 credits per `seed_audio` job; 17 jobs
  billed 25.35, i.e. ~1.5 each. Do not budget an audio phase from the preflight.
- **`seed_audio` has no `duration` parameter** and returns 1.3–30 s at its own discretion; `sonilo_music`
  requires one. `build-audio.py` trims cues to their first event, so the variance only matters for beds.
- **The models return several takes of one sound** — a "single punch" prompt came back as three punches
  separated by silence. Keeping the first is both the shortest file and the only one that sounds like
  one hit. A cue with a WIND-UP (`super`) needs the trim to reach back BEFORE the loudest moment, or
  the charge is thrown away: its release was at 10.77 s of a 13.53 s file with the charge running from
  9.0 s.
- **The masters are HOT** — one measures +2.00 dBFS. Measure with a float decode (`f32le`); `s16le`
  clamps and silently reports any hot file as exactly 0.0.
- **Ask for what you want to hear, not for a category.** The one cue that came back as silence
  (−37.9 dBFS) was prompted "very short and clean"; the retake that worked said "sharp percussive
  attack … clearly audible and punchy". Same lesson as the sprite prompts: name the physical event.

## Higgsfield CLI gotchas that cost credits

- The CLI name **`nano_banana_2` resolves to Nano Banana PRO** — the real "Nano Banana 2" job type is
  **`nano_banana_flash`**.
- `--image`/`--start-image` take a local **path or UUID, never a URL**.
- Seedance fast 720p 4s ≈ **14 credits/clip** (failed jobs cost 0).
- `higgsfield account status` shows balance, `higgsfield model list` the true job types.
- **`higgsfield generate list --json` recovers a job you overwrote locally**; `generate get <id>` then
  restores its record + result URL for free. Note the two shapes: `create --wait --json` emits a
  1-object *array*, `generate get` a bare *object*. The job record **never names the source `--image`
  file** — only an opaque upload id — so provenance-by-filename isn't machine-checkable.
- **Drive the higgsfield CLI from bash, never Python `subprocess`.** `higgsfield` on PATH is a `.cmd`
  shim; subprocess routes it through cmd.exe, whose arg quoting mangles a multi-line `--prompt` so the
  flags never arrive and the job **silently runs at the default aspect (`1:1`)**. Cost a credit in Phase
  07 to find. Redirect **stdout only** and write the `.job.json` only *after* the call succeeds, or a
  failed launch truncates a good record.

## Alpha, chroma keying, and the magenta void

- **No Higgsfield image model emits alpha** — all 30 job types checked (`gpt_image_2` doesn't surface
  OpenAI's `background:"transparent"`; `recraft_v4_1`'s `background_color` is explicitly "no alpha").
  Paint art over a flat `#FF00FF` void and key it locally — `npm run key:layers`.
- **…but the PNG's mode lies about it.** Phase 06 got `RGBA` on 2 of 3 portraits and `RGB` on the third
  from *identical* model and params, with alpha 255 on every pixel of all three. The container mode is
  non-deterministic and carries no information: **never test `mode == "RGBA"` to decide "is this keyed /
  does this have alpha?"** — read the alpha channel.
- **The void is never literally `#FF00FF`.** Ask for flat magenta and you get ~`(252,1,252)`, with only
  **0.004%** of pixels exactly `(255,0,255)` (measured on the Phase 05 refs). **Key by L1 tolerance,
  never by `== #FF00FF`** — an exact-equality key erases nothing. Reuse `key-layers.py`'s
  `key()`/`despill()` (`KEY_LO=40`/`KEY_HI=120`).

## Prompting rules

- **Aspect labels lie.** `16:9` returns 2752×1536 = 1.7917:1, which at the sim's 720 height leaves *10px*
  of scroll room; `3:4` returns 1792×2400 = 0.7467:1. Read `params.width/height` from the job JSON;
  don't trust the label.
- **`--image` dominates the prompt** (no reference-strength knob), so generate **fresh** to change a
  look. It also **invents scenery inside the magenta void**, and the API JPEG-ises + resizes the
  reference (~1px edge jitter everywhere). **But it will discard a whole scene if you name what to
  discard** — Phase 05 pulled single fighters out of dense mockups in 10/10 gens (stage, second fighter,
  every kanji scroll gone) by listing the elements by name ("the water tower, the chain-link fence, …
  and the bald rival on the right"). Use `--image` when the *subject* must survive and only the scene
  must go; the old "only to keep a scene and swap one thing" rule was too narrow.
- **`--image` also imports details you never mentioned.** The mockup jiu-jitsu wore a blue-and-yellow
  flag patch; a generic "no logos, no labels" clause failed twice, naming it explicitly worked. Read the
  source art and forbid by name.
- **Discard-by-name works on anything, not just scenery — including a colour and a crop.** Phase 06
  reframed full-body refs to busts and replaced their magenta void with a painted backdrop, 3/3 first
  try, by naming *both* as discards: "Discard the full-body framing … reframe to his head, shoulders and
  upper chest", and "Replace the reference image's flat magenta background completely. There must be no
  magenta anywhere" (result: **0 px** of magenta). Paint-a-backdrop alone would leave the void a
  plausible answer, since the ref *is* one and `--image` dominates. Reference dominance is steerable —
  name what to drop.
- **Set-consistency goes in the shared block; per-subject identity goes in the head.** Phase 05 used a
  byte-identical block for *style*; Phase 06 generalised it — the backdrop lives in the shared block (the
  only reason three cards read as a set) and the poses live in the per-fighter heads (the only reason
  they aren't the same man three times). Corollary: **design the differences before generating** — a
  shared framing block actively fights "distinctive", so write the poses down first.
- **Apply a per-subject fix preventively.** The monk's wide low stance cost two gens in Phase 05; naming
  it as a discard in Phase 06's first prompt cost one sentence and he landed first try. Same for the
  jiu-jitsu patch, forbidden by name even though the ref was already clean.
- **Describe the CAMERA, not the percentage.** If the model ignores a dimension, the prompt is naming
  the wrong variable. `main`'s floor band would not shrink through three rewrites (22%→39%, 8%→40%)
  because the model was drawing a *downward* camera; one sentence putting the camera at fighter eye
  level fixed it in a single gen. Same for figures: "spans two thirds of the image height" → 91.6%, but a
  camera pulled back far enough to leave *a band as tall as his own head* above and below → 76.1% in one
  gen.
- **The wrong variable can be per-subject even under a shared prompt.** The monk got *worse* under that
  camera fix (89.4%→95.1%); one sentence naming his **wide low stance** as the cause fixed him in a
  single gen (→77.0%).
- **Never contradict your own prompt — the model resolves it by maximising.** A nudge saying a fighter's
  head should "nearly touch" the margin band collided with "do not let him fill the frame" and produced
  100% full-bleed. Tighten or replace a constraint; don't argue with it.
- **Anchor scale to a person** ("an adult on this roof is one quarter of the image height") or props come
  out ~2× oversized — these prompts forbid figures, which removes the model's only scale reference. When
  the subject *is* the person, anchor to his own head.
- **Match palettes by sampling hex** from the target, not by describing them ("dusk sky" produced a
  purple night).
- Always add a **"full-bleed, no border/CRT bezel/vignette"** clause.

## Judging the output

- **Prefer a measurement to an opinion on generated art.** Phase 04's three worst defects were all
  invisible by eye and obvious by number — and one *wrong* metric (topmost-opaque-pixel, which scores a
  chain-link mesh as a solid wall) hid a bad asset for a whole iteration. Check art against the sim's
  real constants (`GROUND_Y`, `HURT_STAND.h`), not against how it looks. This applies to reviewers too: a
  Phase 05 plan review said a shoulder patch on the mockup fighter was imagined, so it was dropped from
  the prompt — a 300×200 crop showed it was real, and it shipped into two gens. A crop costs nothing; a
  recollection isn't evidence.
- **An art gate self-tests before it judges.** `check-characters.py` runs 9 synthetic fixtures on its own
  metrics every run, and caught a real bug (a 4px speck scoring as a whole second figure) *before* a
  credit was spent. Phase 04's rule — a wrong metric is more dangerous than no metric — is why.
  Corollary: say plainly what the gate does **not** cover rather than let a green tick imply more than it
  proves. Some criteria ("no text", "no logos", "distinct") have no honest metric; the visual checklist
  in a phase log is load-bearing, not decoration.
- **A visual check beats a green gate.** Phase 07's portrait black-band passed every metric.
