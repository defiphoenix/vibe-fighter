# Character references — 2026-07-17

Phase 05 deliverable: one clean, isolated, full-body reference per fighter. These are the source
art the Phase 09 animation spritesheets are drawn from, and the input to the Phase 06 select
portraits. **Nothing loads from here** — `concepts/` is authoring art, not shipped.

Each fighter was pulled out of its locked Phase 03 mockup (`../../mockups/2026-07-16/`). The
mockups stay the art direction of record; these refs isolate one character each, on a flat
`#FF00FF` void, under neutral lighting so the sprite reads on any stage.

## Files

| ID | Reference | Source mockup | Fighter | Job |
|---|---|---|---|---|
| `brawler` | [`brawler.png`](brawler.png) | [`rooftop-dusk.png`](../../mockups/2026-07-16/rooftop-dusk.png) | left | `09411d83-ef25-42be-ad6b-1c94166dbeaf` |
| `jiujitsu` | [`jiujitsu.png`](jiujitsu.png) | [`neon-alley.png`](../../mockups/2026-07-16/neon-alley.png) | right (**mirrored**) | `527cfd82-3067-4b19-8a65-162bc19871e9` |
| `monk` | [`monk.png`](monk.png) | [`dojo.png`](../../mockups/2026-07-16/dojo.png) | left | `24c4634d-b5d4-4dd4-8386-edcb8bed4088` |

Each PNG carries a `<id>.prompt.txt` (the exact string passed to `--prompt`) and a
`<id>.job.json` (the verbatim CLI job record: model, params, id, result URL, status).

**IDs match the manifest's runtime sprite paths** (`public/sprites/<id>/`) so Phase 09 never has
to guess a spelling. There is no `-raw.png` here and nothing is keyed: `asset-manifest.md`
specifies `Processing = none (reference)` for this row, and Phase 09 owns the real alpha sheets.
The void is left in place because it is the only way to force "no stage" out of a generator that
[cannot emit alpha](../../backgrounds/README.md), and because it gives the gate something to
measure.

> **Phase 09: key with a tolerance, never with `== #FF00FF`.** The void is *nominally* `#FF00FF`
> because that is what the prompt asks for, but the generator does not deliver it exactly: only
> **0.004%** of pixels are literally `(255,0,255)` and the void actually clusters around
> **`(252,1,252)`**. An exact-equality key would erase essentially nothing. Use the same L1-distance
> key as the backgrounds — [`scripts/key-layers.py`](../../../scripts/key-layers.py)'s `key()` and
> `despill()`, with `KEY_LO=40` / `KEY_HI=120` — which is what
> [`check-characters.py`](../../../scripts/check-characters.py) reuses to measure these.

## The roster changed in Phase 03

The PDF recipe's step 6 names a "green boxer from the dojo mockup" and a "jiu-jitsu fighter on the
right from the subway mockup". Both are stale. Phase 03 dropped the green boxer (the dojo's left
fighter is now a **Shaolin monk**) and scrapped the subway stage for **neon-alley**. See the
[Phase 03 log](../../../docs/phases/03-concept-mockups-log.md) downstream-consistency section.

## Geometry: these refs carry DESIGN, not SCALE

**Do not scale a sprite from these images.** They are isolated, so their scale is arbitrary — the
fighter is 56–77% of frame height here purely as a framing choice.

The sim's fighter is `HURT_STAND.h / STAGE_HEIGHT` = **185/720 = 25.7%** of the screen. The Phase
03 mockups drew fighters at roughly **50%** of frame — they assumed a closer camera than the sim
has — and Phase 09 records that anything scaled from the mockups' own proportions comes out
**~1.8× too big**. These refs inherit the mockups' design, so they inherit that trap too.

Phase 09 hand-authors boxes against the sim's constants. If 25.7% reads too small in motion, that
is a **sim constant** change (`GROUND_Y` / box heights) with a test and stage-art blast radius —
not a per-sprite fudge, and not something to fix by redrawing these.

The prompts do ask for chunky ~5.5-head arcade-sprite proportions so the design survives being
drawn small. That is a *style* constraint, not a scale one.

## Regenerating

```bash
MSYS_NO_PATHCONV=1 higgsfield generate create nano_banana_pro \
  --prompt "$(cat brawler.prompt.txt)" \
  --image ../../mockups/2026-07-16/rooftop-dusk.png \
  --aspect_ratio 3:4 --resolution 2k --wait --json > brawler.job.json
# then: result_url from the JSON -> curl -o brawler.png
npm run check:characters
```

`npm run check:characters` ([`scripts/check-characters.py`](../../../scripts/check-characters.py))
is the gate. It self-tests its own metrics on synthetic fixtures before it will judge real art,
then reports void fraction, figure count, bbox, margins and specks per reference, and verifies each
job record against its prompt. It exits non-zero on any failure.

## Gotchas worth knowing before touching these

- **The full mockup as `--image` works for this** — which the repo did not expect.
  [`CLAUDE.md`](../../../CLAUDE.md) warns that `--image` dominates the prompt and invents scenery
  into the void, so "discard the scene" should have been its worst case. It wasn't: the stage, the
  second fighter and every scroll and neon sign dropped cleanly on the first try (void 61–82%,
  exactly 1 figure, 0 specks, every time). The prompt naming each element to discard by name
  ("the water tower, the chain-link fence, ... and the bald rival on the right") is doing the work.
  Reference dominance helped here — the scene had to go, but the *character* had to survive.
- **Describe the camera's DISTANCE, not the figure's percentage.** "He spans roughly two thirds of
  the image height" was ignored: brawler came back at 91.6%, monk at 89.4%. Replacing it with a
  camera pulled back far enough to leave *a band as tall as his own head* above and below fixed
  brawler in one gen (91.6% → 76.1%). This is Phase 04's lesson, re-confirmed: when the model
  ignores a dimension, the prompt is naming the wrong variable.
- **When it still ignores you, name what is actually driving it.** Monk got *worse* under the same
  camera fix (89.4% → 95.1%). His distinguishing feature is a wide low horse stance — one sentence
  saying his stance is wide and low and the camera must therefore pull back *further* fixed him in
  a single gen (95.1% → 77.0%).
- **Contradicting the shared block makes the model maximise.** A nudge telling jiu-jitsu his head
  should "nearly touch" the margin band collided with the block's "do not let him fill the frame";
  the model went to 100% full-bleed. Tighten a constraint or replace it — do not argue with it.
- **`--image` carries over details the prompt never mentioned.** The mockup's jiu-jitsu wears a
  small blue-and-yellow flag patch on his shoulder. A generic "no logos, no labels" clause did not
  remove it across two gens; naming it explicitly ("in the reference there is a small
  blue-and-yellow flag patch: REMOVE IT") did. Check the source art for anything a "no logos"
  criterion would catch, and forbid it *by name*.
- **The aspect label lies, again.** `3:4` returns 1792×2400 = **0.7467:1**, not 0.7500. Read
  `params.width/height` from the job JSON.
- **The job record cannot name the source mockup.** The API uploads the local `--image` and stores
  an opaque upload id + a `<id>_resize.jpg` URL. The mockup's filename is nowhere in the record, so
  provenance-by-*filename* is not machine-checkable from the JSON — the mapping is **recorded**, in
  the table above, in `check-characters.py`'s `FIGHTERS`, and in each prompt's discard clause. Do
  not read the gate's pass as proof of which mockup produced a reference; it only proves a reference
  was used. (Stronger checks exist and were rejected as more machinery than this phase earns — see
  the `ponytail:` note on `check_job()`.)
- **Two CLI shapes.** `create --wait --json` emits a **1-object array**; `generate get <id> --json`
  emits a **bare object**. All three files here are the array shape, but a record recovered via
  `generate get` arrives as the object, so the checker normalises both. Both are verbatim output —
  don't hand-edit one into the other's shape.
- **Jobs are recoverable.** `higgsfield generate list --json` finds a job you overwrote locally —
  `generate get <id>` then restores its record and result URL, at no credit cost. Worth knowing
  before you re-roll something good.
- Redirect **stdout only**; `2>&1` merges the CLI's `Error:` line into the JSON and corrupts it.
