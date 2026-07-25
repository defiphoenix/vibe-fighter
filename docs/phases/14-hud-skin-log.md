# Phase 14 log — HUD Skin

**Gate: PASSED** — 2026-07-25. 230 unit tests (15 files), 58 Playwright e2e (13 specs),
`npm run build` green, `python scripts/build-atlases.py --selftest` green (25 fixtures). Plan
Codex-reviewed before approval, the diff Codex-reviewed after, plus an independent QA-agent pass
driving Playwright against the running game.

## What the phase actually was

| Requirement | Found | Did |
|---|---|---|
| Health bar uses the atlas art with a dynamic fill | vector `Graphics` rectangles (`hud.ts`), atlas **never loaded** | load `hud-atlas` in Boot; draw `health-bar` plates with the fill behind them |
| Colour changes with health, blinks when low | present (`hud.ts:37-45`) | kept the tiers verbatim; **retuned the blink** for the bigger art |
| Both portraits render in the portrait base | portraits loaded, used only by the select screen | cover-cropped into `portrait-base`'s arch |
| Match-start entrance, readable pace | nothing | `introTicks`-derived slide + fill, 1.2 s |
| Timer + win pips preserved | present | unchanged, repositioned to the new band |

The headline: **Phase 07's art had been sitting unused in `public/` for seven phases.** `BootScene`
loaded `twilight-atlas` and the portraits, never `hud-atlas`; a grep for `hud-atlas` across `src/`
returned zero hits. This phase is mostly wiring, and the interesting decisions are all about letting
the art dictate geometry instead of re-deciding it in code.

## 1 — The art owns the layout

`hud.ts` authors six numbers: `BAR_SCALE_X 0.86`, `BAR_SCALE_Y 0.5`, `PORTRAIT_SCALE 0.32`,
`MARGIN 24`, `GAP 10`, `TOP 20`.
Everything else is measured off the atlas frames at construction — the bar's width **and height**
(460×144, a 3.19:1 the prompt never asked for), the fill slot (380×62 at plate-local 40,41), the
portrait window (300×460 at 81,81). The Phase 07 log's instruction was literally "read the bar's
height from the frame — do not hardcode 34", and the reason is visible in the drift it left behind:
that log cites `hud.ts` constants (`BAR_W=460 / MARGIN=40 / TOP=34`) that the shipped file had
**already** moved away from (`360 / 32 / 26`) before the log was written.

Slot frames are packed in **atlas space**, so `slotIn()` subtracts the plate's own `cutX/cutY`. P2's
plate is `setFlipX(true)`, so its slot is mirrored as `barW - dx - w` — with the shipped art's
symmetric 40/40 margins that is the same number, but deriving it means a re-cut bar cannot silently
misplace the fill.

Layout, chosen with the user from three options: portrait outboard at the screen edge, bar inboard
running toward centre. Two bars + two portraits at full art size do not fit 1280 px; at these scales
the band is 148 + 396 per side, the bar is **vertically centred against the portrait** (top-aligning
a 3.19:1 bar beside a 0.74:1 bust left it floating at the ceiling), and the timer sits **under** the
bars rather than in the centre gap.

The bar is the one thing drawn **non-uniformly** (0.86 × 0.5), on the user's request for a bar that is
"narrower and wider". That is not a free choice: the plate carries **40 px of solid bezel above and
below the slot** — measured, not assumed — so the vertical padding is frame art and cannot be cropped,
and a uniform scale that makes the bar thin also makes it short. A 1.7:1 anisotropy is the lever; much
past 2:1 and the rivets read as ovals.

## 2 — The fill draws behind the plate

One `Graphics` at depth 100, both plates at 101, so the coloured fill shows through the transparent
slot while the painted bevel stays on top. The slot is genuinely 100 % alpha-0 with no partial
pixels, so there is nothing to key or mask.

**Depth 100, not 99**, and that is not arbitrary: the match-end scrim is depth 99 and is created
*after* the HUD, so an equal-depth portrait face would be dimmed by the scrim while its own plate at
101 stayed bright — a half-lit portrait. Ordering *within* the 100/101 band is Phaser's stable
insertion order, and all eleven objects are created in one constructor.

The fill is a vertical gradient per tier rather than one flat colour: at 24 px the flat fill was
fine, at 62 px it read as a plastic slab over a painted bevel. **`fillStyle` is set immediately
before `fillGradientStyle`** — the gradient is WebGL-only and the Canvas renderer *skips the command
outright* (`GraphicsCanvasRenderer.js:227` advances the index and moves on), so without the solid
underneath, a Canvas fallback would inherit the black backdrop style and draw the health bar black.
The game boots `Phaser.AUTO`.

## 3 — Portraits: a HUD-sized bake, cover-cropped, no crop and no mask

Cover, never letterbox — an aspect-fit is what produced Phase 11's black band. The overflow lands
under the plate's 81 px opaque frame, the vertical fit is exact so the bust's bottom-bleed edge (the
Phase 06 contract) survives, and at the arch's antialiased scallop the face blends through
proportionally, which is what the arch is *for*. No crop, no mask.

The first cut fed the **select card** (448×600) straight in, and the user's verdict on the running
game was "the images look low res". They were right, and the cause is measurable rather than
aesthetic: the HUD draws the face at ~96×147, so the card is a **4.7× downscale**, and Phaser only
builds mipmaps for **power-of-two** textures (`WebGLTextureWrapper` checks `IsSizePowerOfTwo`).
448×600 is not one, so that reduction is a raw bilinear squeeze sampling 4 texels out of every ~22.
Enlarging the face only reduces the ratio; it does not fix the resampling.

So `copy-portraits.py` finally grew the `--hud` flag its own ponytail note asked for in Phase 06: each
master is cover-cropped to the **arch's** aspect (300:460, so the sides come off and the full height
stays) and LANCZOS-resampled to 192×294 — 2× the on-screen size, because `Scale.FIT` can letterbox the
canvas *up* on a large display. Boot loads them as `hud-portrait-<id>`; the HUD prefers that key and
falls back to the select card if it has not been baked. ~90 KB each, three files.

The faces are built hidden on a placeholder frame and revealed by `applyPortraits()`, which reapplies
lazily whenever `world.fighters[i].cfg.id` changes, because PlaygroundScene rebuilds its world on
every stat edit.

## 4 — The entrance is sim-derived, not a tween

`src/render/hud-entrance.ts` is Phaser-free and unit-tested in the node env, like `anim-timing.ts` /
`camera-frame.ts` / `flow-state.ts`. `hudEntrance(phase, introTicks)` returns `{slideY, fillFrac,
done}`; elapsed is `INTRO_TICKS - introTicks` during the intro and settled in every other phase.

- slide 54 ticks / 900 ms, ease-out cubic, from 240 px above its parked y;
- fill 54 ticks / 900 ms, ease-out quad, starting 18 ticks / 300 ms behind the slide;
- 72 ticks / 1.2 s total, inside the 90-tick intro, settled 300 ms before "FIGHT!".

`SLIDE_DROP_PX` must be at least the band's own bottom edge or the HUD starts half on-screen and the
slide reads as a twitch. That module is Phaser-free and cannot measure the art, so the relationship is
pinned in the e2e against the real objects (`bandBottom <= 0` on the first tick) rather than asserted
against a copied number.

Deliberately slow: the source prompt's only feedback on this animation was *"the slide-down of the UI
and the fill need to be a bit slower — right now it's too rapid."* A unit test asserts the entrance is
still mid-flight at the ~200 ms mark that complaint describes, and that `ENTRANCE_TICKS < INTRO_TICKS`.

Why not a tween: Phaser 4's `TweenManager` takes its delta from `Date.now()`, so a tween neither
advances under the e2e's pumped `game.step` nor survives an interruption — the repo already enforces
"tweens stay decoration". Deriving from `introTicks` additionally costs **zero render state**: the
entrance replays on every round and on the Enter-rematch for free (both go through `beginRound()`),
and an e2e scrubs the whole animation by writing one number.

`slideY` moves every object except the centre announce text, which belongs to the round, not the band.
PlaygroundScene zeroes `introTicks` before advancing, so it always renders the settled HUD — correct
for a tuning scene, and commented so it is not filed as a bug.

## 5 — Boot

`hud-atlas` is loaded in `preload()`, and **both** preload atlases were added to the `keys` array that
Boot's COMPLETE guard checks. This is earlier failure handling rather than a new safety net —
`buildStage()` already threw on a missing prop frame — so the error message was widened from
`characters: spritesheets failed` to name assets generally.

## Findings from review that changed the code

### Codex (plan)

1. The plan claimed `stage.spec.ts` already covered the new objects' `scrollFactor`; it pins Texts and
   depth-≥100 **Graphics** only, so nothing would have caught a plate that scrolled with the world.
   The new spec asserts it for the Images.
2. The stated `twilight-atlas` failure mode was wrong — `buildStage` validates frames and throws. The
   Boot guard is still right, for a better reason.
3. **Portrait faces at depth 99 would collide with the match-end scrim.** Moved to 100.
4. Both plates need an explicit `setOrigin(0, 0)`; the slot arithmetic is top-left based and a Phaser
   `Image` defaults to centred.
5. A two-sample blink assertion is flaky by construction (fixed-ms buckets on absolute time). Sample a
   bounded run instead.
6. Two more stale figures in the Phase 07 log (`99.90 %` window, the `hud.ts` constants).

### Codex (diff)

1. **HIGH, real: the colour tier was keyed off `health × fillFrac`** — the animated value. A
   full-health fighter opened every round RED and blinked through yellow into green. `bar()` now takes
   `health` (colour, blink) and `draw` (width) separately.
2. **HIGH: the DEV snapshot was pure bookkeeping**, so deleting the actual `y` assignment or the fill
   draw would have left the spec green. `slideY` is now measured off the bar plate's real `y` against
   its parked `y`, the snapshot exposes the Graphics command-buffer length and the faces' real `y`,
   and the spec asserts on those. Verified by deleting the slide and watching the spec go red.
3. **MEDIUM: `fillGradientStyle` is WebGL-only and Canvas skips it**, leaving the black backdrop style
   active — a black health bar on a Canvas fallback. Solid `fillStyle` now precedes it.
4. LOW: `clamp01(NaN)` fell through both comparisons and produced a NaN `y`, which Phaser does not
   throw on — it just stops rendering the object. Guarded, with a test.
5. Nits: an over-claimed comment about gradient midpoints, and the Boot error prefix.

### QA agent (running game)

1. Independently caught the red→yellow→green sweep above, and asked for a regression assertion at the
   `Hud` level since `hud-entrance.ts` cannot see colour. Added: the entrance sweep asserts the tier
   stays `HEALTH_HIGH` for all 91 ticks at full health. Verified failing by re-introducing the bug.
2. **The low-health blink now reads as a strobe.** The mechanism was carried over unchanged from the
   vector HUD (`BLINK_MS = 120`, full on/off), which was subtle on a 24 px rectangle and is ~4.3 Hz of
   whole-bar disappearance on the art's 62 px painted slot — past the usual 3 Hz comfort guidance for
   large flashing content. Retuned for the size of the thing that is now flashing: `BLINK_MS = 250`
   and a dim pulse (`alpha 0.28`) instead of a vanish. The spec pins both the cadence and that the bar
   is never blanked.
3. Reported the e2e harness trap that cost it a false "frozen HUD" finding: **`game.loop.now` stops
   updating after `loop.stop()`**, so separate `pump(1)` calls all replay the same wall-clock instant.
   Recorded in CLAUDE.md.

It found no defect in entrance pacing, clipping, portrait fit, fill-vs-bevel alignment, drain
direction, round-end / match-end survival, the round-2 replay, the Enter-rematch, or PlaygroundScene.

### The user, playing it

Three rounds of feedback on the running game, none of which any gate could have produced:

1. *"The health bar is too high"* → the bar came down from 0.8 to 0.6, then to a non-uniform
   0.86 × 0.5 on the follow-up *"narrower and more wide"*. Measuring the plate's rows first is what
   turned that from a guess into a decision: the 40 px above and below the slot are **bezel**, so
   cropping was off the table and anisotropy was the only lever.
2. *"The images of the characters do not look good. They look low res."* → first answered by drawing
   them larger (0.2 → 0.32), which the user correctly judged insufficient, then properly by baking the
   HUD-sized portrait (§3). The enlargement stayed: it halves the remaining downscale.
3. *"Move the timer under the health bars."*

### Screenshots caught what no test did

The flat green fill against the painted bevel — no assertion would ever have called that wrong, and
it is why the gradient exists. The colour sweep was also visible in a screenshot before either
reviewer named it.

## Known and deliberately not fixed

- **The timer and win pips are still text.** There is no atlas art for either; inventing vector
  chrome for them would fight the plates.
- **The entrance does not play in PlaygroundScene**, by design (§4).
- **The bar plate is stretched, not re-cut.** A 9-slice would keep the bevel undistorted horizontally
  but cannot make the bar shorter than its two 41 px caps, so it does not solve the axis that
  mattered. The real fix, if the squash ever bothers anyone, is a regenerated wide-and-thin plate.
- The gradient pairs are eyeballed against the plate's bevel, not computed from the tier colour.

## Gate

```
npm test
  Test Files  15 passed (15)
       Tests  230 passed (230)

npm run build
  tsc --noEmit -> clean
  vite build   -> built in 4.37s

npx playwright test
  PASS (58) FAIL (0)   13 specs, 4 workers

python scripts/build-atlases.py --selftest
  25 fixtures OK
```
