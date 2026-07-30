# Phase 19 — mobile viewport, the debug leak, hit-box reach, and pad art

**Status: implemented, gates green.**

Phase 18 shipped mobile play and the user confirmed it working on a real Samsung S23+. Then they
played it. Four defects came back, three of which no test in this repo could see.

---

## Spec

| # | Reported | Where the fix lives |
|---|---|---|
| 1 | On a phone the game "is not wide enough" and "is not centered" | `render/viewport.ts` + `main.ts` + `index.html` + a `layout(width)` seam on every screen-space owner |
| 2 | Pressing `B` in **production** shows the debug hit boxes | `MatchScene.ts`, behind `import.meta.env.DEV` |
| 3 | The attack's "brown top box" is too wide | `public/configs/character-gym.json` (21 widths) + `scripts/audit-boxes.py` |
| 4 | The vector pad buttons look low quality | `scripts/build-atlases.py --pad` → `public/ui/pad-atlas.*`, drawn by `touch-view.ts` |

The evidence for #1 was a screen recording (`Screen_Recording_20260729_163429_Brave.mp4`, 720×1560,
Brave/Android). Measured off its frames: without fullscreen the canvas held ~60% of the width, in
fullscreen ~82%, and in **both** the left bar was ~3× the right one. That asymmetry is what "not
centered" meant, and it is the more diagnostic half of the report.

---

## Fix 1 — the viewport

### Two separate defects wearing one complaint

**(a) Double-centering.** `index.html` had `#game { display: grid; place-items: center }` while the
game config had `autoCenter: CENTER_BOTH`. Phaser centres by writing `marginLeft`/`marginTop` onto the
canvas (`ScaleManager.updateCenter`), and CSS grid centres the canvas's **margin box** — so the two
compose and park the canvas about a quarter of the letterbox gap to the right. Either one alone is
correct. The Phaser scale docs state the rule outright: *do not style the canvas directly.*

**(b) `Scale.FIT` pillarboxes a locked 16:9 canvas.** Nothing adapted the game surface to the device.

A third thing found on the way: `canvas { image-rendering: pixelated }` contradicted `main.ts`'s
deliberate no-`pixelArt` decision. The art is photographic and the canvas is resampled on every phone,
so this was nearest-neighbour crunch applied to exactly the content LINEAR filtering was chosen for.
Likely a real part of "the buttons look low quality" — the whole screen was.

### The mechanism changed after verification, and this is the part worth keeping

The approved plan said `Phaser.Scale.EXPAND` with `min:{1280,720}` / `max:{1696,720}`. **That
combination is broken in Phaser 4.2.1**, and the trap is that `scale.min`/`max` read as game-size
bounds and are not:

- `parseConfig` maps them onto **`displaySize.setMin/setMax`** (`ScaleManager.js:577-585`) —
  `displaySize` is the **CSS** size.
- `Size.getNewWidth` does `Clamp(value, minWidth, maxWidth)` **before** comparing to the parent
  (`structs/Size.js:417`).

On an 851×393 phone parent that is `Clamp(851, 1280, 1696) = 1280`, then `1280 > 851` →
`max(1280, 851)` = **1280**. The result is `style.width: 1280px` on an 851px viewport with
`marginLeft: -215`. It would have looked plausible on a desktop and been wrong on every phone — the
exact defect class this repo keeps re-shipping. Dropping `min` does not rescue it either: with no
`max.height` a parent narrower than 16:9 takes the `scaleX < scaleY` branch and returns
`canvasHeight > 720`, which breaks "the stage art is exactly `STAGE_HEIGHT` tall" and the
bottom-aligned `centerOn`.

**What shipped instead: keep `Scale.FIT` + `CENTER_BOTH`, no `min`/`max`, and drive
`scale.setGameSize(viewWidthFor(parentW, parentH), 720)` ourselves.** `setGameSize` is the documented
entry for the scaled modes and ends in `refresh(previousWidth, previousHeight)`, which is exactly what
`CameraManager.onResize` matches on (`cam._width === previousWidth`, `CameraManager.js:685-699`) — so
both cameras resize themselves. FIT then letterboxes a canvas already shaped to the parent: zero bars
for any aspect between 16:9 and the world's own 2.356:1, and identical-to-before behaviour outside
that band. Desktop is untouched, because `viewWidthFor(1280, 720) === 1280`.

### `render/viewport.ts`

Phaser-free and unit-tested, like `edge-latch.ts` / `meter-view.ts`. `viewWidthFor(pw, ph)` =
`clamp(round(720 * pw / ph), VIEW_WIDTH, STAGE_WIDTH)`; `liveWidth(w)` sanitises whatever Phaser
reports before it reaches any layout arithmetic. The bounds are not arbitrary:

- **floor `VIEW_WIDTH` (1280)** — the menus are budgeted against it (`characterCardWidth`), so
  narrowing would clip the card row;
- **ceiling `STAGE_WIDTH` (1696)** — above that the camera needs world that does not exist.

`camera-frame.ts` `groupZoom` deliberately still uses the **constant** `VIEW_WIDTH`, so vertical
framing and zoom behaviour are bit-for-bit unchanged and the extra canvas width only ever reveals more
rooftop. `MAX_SEPARATION` stays 1040 — the sim never learns about any of this.

### The `layout(width)` seams

One `Scale.Events.RESIZE` subscription **per scene**, as a bound arrow-function property so `off()` can
actually remove it on `SHUTDOWN` (MatchScene is re-entered on Esc→Flow→match and on REMATCH; a leaked
listener would lay out a destroyed scene). Each `create()` ends by calling `layout()` once.

- **`Hud`** — every x assignment moved out of the constructor into `layout(width)`, which the
  constructor then calls. One positioning path, so nothing can drift. `bar()`/`meter()` already read
  `barX` live each frame, so the coloured fills follow with nothing to invalidate.
- **`MatchScene`** — and a real bug fixed on the way: `cameras.add(0, 0, VIEW_WIDTH, STAGE_HEIGHT)`
  hardcoded 1280. `CameraManager.onResize` only auto-resizes a camera whose size equals the *previous*
  game size, so a UI camera created at 1280 after FlowScene had already widened the game would never
  match and would stay 1280 — cropping P2's portrait plate and health bar clean off a phone. It is now
  created from `scale.gameSize` and sized explicitly in `layout()`.
- **`CutInView`** — the scrim is the whole screen during a freeze, so a 1280-wide one would leave a
  bright unscrimmed strip down the side of a full-screen effect.
- **`TouchPad`** — `TouchPadState` keeps its **own** copy of the layout and hit-tests against it, so
  `layout()` writes both. `setLayout()` calls `cancel()` first, deliberately: a finger resting on a
  button that just moved out from under it would otherwise hold that input forever with nothing on
  screen to explain it.
- **`FlowScene`** — the menu is **not** rebuilt. `build()` calls `layer.removeAll(true)`, and a
  lock-in `flash()` runs with `busy === false` while a `delayedCall` still closes over the card it is
  going to un-tint — so rebuilding on a resize would destroy the object that timer holds. Since the
  whole menu is one Container, centring it is a single `setX`, and every child keeps its identity, its
  tweens and its hit area. The backdrop scrim/stripe live outside the container and are resized by
  hand; the title's full-screen tap Zone is sized to the viewport and un-offsets itself, or the outer
  ~140px of a phone's title screen would be dead. The DEV `cards()` seam now reports
  `x + layer.x`, because a spec taps a game-space coordinate.
- Dev scenes (Gym, Playground, StagePreview) keep their `VIEW_WIDTH` anchors — **stated as a choice**,
  not overlooked. They are tuning tools; Playground gets the shared `Hud`/`CutIn` behaviour for free.

---

## Fix 2 — the debug overlay was shipping

`B` and `1`-`4` were bound in `MatchScene.create()` outside any DEV block, and the on-screen legend
advertised "B hitboxes · 1-4 kinds". Now the bindings, the legend substring, the `update()` polling,
the `Graphics` **allocation**, its per-frame `clear()` and its camera-list entry are all behind
`import.meta.env.DEV`. Gating `addKey` matters beyond tidiness: `addKey` captures by default, so
production was calling `preventDefault()` on `B` and `1`-`4` for no reason at all.

`src/scenes/input.ts`'s "B, 1-4 … are taken" comment was updated — it had become false in production.

**Measured, both directions:**

```
build from HEAD (before):  'B hitboxes' -> 1
build after the fix:       'B hitboxes' -> 0   ('1-4 kinds' -> 0, 'drawDebugBoxes' -> 0)
```

---

## Fix 3 — every attack was reaching through air

`audit-boxes.py` already measured the thing: per attack sheet, the hit box's far edge against the
**measured limb tip**, and `air` = the visible gap at the furthest separation the attack still
connects (`air = far − limb − 14`). The report was green — because `AIR_GAP_MAX` was **60** and the
worst shipped sheets sat at exactly 60. *A threshold set to the worst observed value cannot fail.*

### Why a flat 30px target per fighter would have been wrong

Trimming each fighter to `air = 30` sets `far = limb + 44`, so effective reach becomes
`limb + 44 − pushHalf`: jiujitsu `attackLight` → 90, monk → 85. `reach-parity.test.ts` asserts monk ≥
roster best, and it goes **red** — correctly. A common target erases the very asymmetry the monk's
wider pushboxes (60/76 vs 56/60) exist to compensate for.

### What shipped: one uniform delta per ATTACK

`delta(attack) = max(0, max_over_fighters(air) − 30)`, applied to `w` only. Every fighter's far edge
moves by the same amount, so effective-reach ordering and every pairwise difference are preserved by
construction. The worst offender lands on 30; everyone else lands below it, which is better — `air` is
a maximum, not a target.

| `attacks.<key>.hit.w` | delta | brawler | jiujitsu | monk | resulting air b/j/m |
|---|---|---|---|---|---|
| `light` | 19 | 70→51 | 92→73 | 94→75 | 14 / 25 / 30 |
| `heavy` | 30 | 105→75 | 95→65 | 107→77 | 28 / 7 / 30 |
| `airLight` | 13 | 70→57 | 70→57 | 72→59 | 29 / 30 / 14 |
| `airHeavy` | 29 | 90→61 | 90→61 | 92→63 | 28 / 30 / 30 |
| `crouchLight` | 8 | 66→58 | 66→58 | 74→66 | 19 / 6 / 30 |
| `crouchHeavy` | 30 | 95→65 | 100→70 | 108→78 | 30 / 18 / 23 |
| `special` | 30 | 94→64 | 100→70 | 100→70 | 30 / 11 / 30 |

`x`, `y` and `h` are untouched on all 21 — **`y`/`h` decide high/low**. The edit was applied by walking
the file and rewriting only the `w` line inside each `attacks.<key>.hit`, so the diff is exactly 21
insertions and 21 deletions and no formatting moved.

**This is a balance change, consciously.** The roster loses 8-30px of reach while `MAX_SEPARATION`
stays 1040, so neutral is closer-quarters than it was. `e2e/phase16-parity.spec.ts` documented the old
110px brawler-light reach in a comment; that comment now says 91 and names the phase.

### The audit is a hard gate now

`AIR_GAP_MAX` 60 → **30**, `main()` returns `1` on flags (was an unconditional `return 0`), with
`--advisory` kept for an art-regeneration session where looking at a number before moving it is the
point. Two new selftest fixtures pin the boundary itself — `air = 30` must NOT flag, `air = 31` must —
because a threshold nobody has watched fail is exactly how this one sat at 60 for two phases.

**Watched failing:** reverting `monk.heavy` to 107 gives
`REACH-GAP box far edge 152px vs limb 78px … ~60px of empty air (over 30)` and exit **1**.
**And the parity test is real:** shrinking `monk.light` alone to 65 reds
`reach-parity.test.ts` with `expected 75 to be greater than or equal to 85`.

`probe/koprobe.test.ts` **cannot** measure this change — it builds from `config.ts`'s `TEST_DUMMY`, not
the shipped registry, so the trim moves it zero ticks. The instrument that measures shipped-roster
balance is `e2e/cpu-difficulty.spec.ts` plus playing it.

---

## Fix 4 — the pad is real art now

`public/ui/pad-atlas.{png,json}`, 512×128, four frames, built by
**`python scripts/build-atlases.py --pad`**.

**Procedural, not generated.** `build_ui()` is a provenance-gated generative path: it requires
`concepts/ui/2026-07-17/<id>-{raw.png,prompt.txt,job.json}` and enforces shared-prompt-block identity
across every UI asset. Routing pure UI chrome through it would cost model credits, drift
`check_blocks` for the three existing assets, and chroma-key art that has no chroma. `--pad` is a
genuinely **independent mode** that skips `build_ui()`/`build_props()` entirely, because `main()` calls
both unconditionally before writing anything — and their raw art is gitignored, so without that the
pad would not be regenerable on a fresh clone.

**Four frames for eight buttons.** `touch-view.ts` only ever varied the art by two things — action vs
movement, pressed vs not — because each button's identity is carried by its `Text` label. Sixteen
per-button frames would be the same geometry at four times the texture.

**The contract that makes desync impossible.** Each frame is 128×128 = `2 * (BUTTON_R + PAD_BLEED)`,
holding a circle of radius exactly `BUTTON_R` at the centre with 12px of transparent bleed for the ring
and its antialiasing. `BUTTON_R`/`PAD_BLEED` are now exported from `touch.ts` and mirrored in
`build-atlases.py` the way `BAR_W` already mirrors `hud.ts`. `TouchPad`'s constructor throws naming the
frame if either the frame is absent or its size disagrees — **and checking `tex.has()` first is
load-bearing**, because `Texture.get()` does not throw on a missing frame: it `console.warn`s and
returns the atlas's FIRST frame (`Texture.js:255-270`). A renamed frame would otherwise draw `pad-move`
on every button in every state, forever, silently.

Drawn at 4× and LANCZOS-resampled down (the game renders LINEAR with no `pixelArt`, and the button is
downscaled on every phone), with a vertical gradient, a top bevel, a seated inner shadow and an outer
glow — which is what makes a circle read as a button rather than a debug overlay.

**A preview caught a defect no assertion could.** The first bake had a hard horizontal seam straight
across the equator of every button: the inner-shadow term used `(yy > c)`, a binary mask, where it
needed a ramp. Every check still passed — the frames were the right size, pairwise distinct, and the
right radius. Only looking at it found it. `docs/lessons.md`'s standing rule, earning its keep again.

New selftest fixtures: the opaque radius **measured back off the pixels** equals `BUTTON_R` (±1.5 for
the resample), and the four frames are pairwise distinct — a copy-paste making `-down` identical to
idle would otherwise ship a pad with no press feedback and nothing would go red.

---

## Gate log — measured, not claimed

```
$ npm run build          ✓ tsc --noEmit && vite build, 4.19s
$ npm test               20 files, 356 tests passed   (was 344)
$ python scripts/audit-boxes.py   28 selftest fixtures, all 21 sheets air <= 30, exit 0
$ python scripts/build-atlases.py --selftest   28 fixtures OK
$ npx playwright test    (see below)
```

Unit count 344 → 356: `viewport.test.ts` (+9), `touch.test.ts` (+3 net — the bounds and no-overlap
invariants now sweep `[1280, 1559, 1696]` instead of the default argument, plus a `setLayout` case).

### Every new test was watched failing

| Mutation | Result |
|---|---|
| `viewWidthFor` ceiling 1696 → 2000 | **RED:** the 21:9 and 32:9 cases (`expected 1720 to be 1696`) |
| `round()` → `floor()` in `viewWidthFor` | **RED:** the iPhone 13 Pro Max case (`expected 1557 to be 1558`) |
| `touchLayout` `rx = width - 160` → `VIEW_WIDTH - 160` | **RED:** `block @1559: expected 1120 to be 1399` |
| `setLayout` drops its `cancel()` | **RED:** `a contact must not survive the button moving out from under it` |
| `monk.heavy` width reverted to 107 | **RED:** `audit-boxes.py` exit 1, names the sheet |
| `monk.light` trimmed alone to 65 | **RED:** `reach-parity.test.ts`, `expected 75 … >= 85` |
| `frameFor` ignores `pressed` | **RED:** `the pressed frame never appeared` (browser) |
| the debug legend un-gated | the string reappears in `dist/` (1 occurrence vs 0) |

### One thing that did NOT fail when it was supposed to, and is recorded rather than dressed up

The Codex plan review's single **blocker** was that the explicit initial `applyViewport()` call is
required, because ScaleManager refreshes during `boot()` and on `READY` — both before `main.ts` can
subscribe — and its 500ms poll only refreshes when the parent size has actually **changed**. Sound
reasoning, and I built to it.

Then I mutated it: **removing that initial call left every acceptance case green.** A probe explained
why — under Chromium's phone emulation the parent goes `0 → real` during startup, so the poll fires a
RESIZE anyway and the subscription alone is sufficient *there*. The call is **kept**, because
correctness should not depend on that accident of timing on a device I am not holding, and it costs one
idempotent guarded call. But it is labelled in `main.ts` as defensive and **explicitly not covered by a
test**, rather than being listed above as though it had been verified. A blocker whose premise the
environment contradicts is still worth fixing; it is not worth claiming credit for.

### The Pixel 5 profile can only prove the clamp — so a second profile was added

Measured, not assumed: Playwright's `devices["Pixel 5 landscape"]` reports a **802×293 page parent**,
i.e. **2.74:1**, which is *wider than the world itself* (2.356:1). So on that profile `viewWidthFor`
lands on the STAGE_WIDTH ceiling and bars are unavoidable — correct behaviour, but it means "the canvas
fills the screen" is untestable there. The first draft of the acceptance case asserted exactly that and
failed for the right reason.

So there are two cases. On Pixel 5: the width equals the clamped formula, both cameras follow, the bars
are symmetric, and the remaining bar is **strictly less** than the authored width would have given
(281px → 112px). Plus a second profile shaped like the device the phase was actually reported broken
on — **900×415, ≈2.17:1, an S23+ in landscape** — where the canvas is asserted to fill the viewport
edge to edge with zero bars, with a fixture guard that fails if that viewport ever stops sitting inside
the band.

Centring tolerance is **2px**, and that is the floor rather than slack: Phaser centres with
`marginLeft = Math.floor((parentW - displayW) / 2)` while the display width is fractional (690.17 on
this profile), so ~2px of asymmetry is baked into the integer margin. The defect it guards was a
quarter of the whole gap — ~28px here.

---

## Carry-over

- The `?diag=1` readings from the real S23+ are **still** uncaptured (open since Phase 18). One load
  settles whether the original Phase 18 symptom was the stale bundle or the predicate.
- Dev scenes remain anchored to 1280 by choice; if `?scene=gym|playground` should follow the viewport,
  that is a small follow-up.
- `characterCardWidth` still budgets against `VIEW_WIDTH` on purpose: the row then fits at every width
  by construction, and only its centre moves. Parameterising it would make cards grow on a phone and
  buys nothing at n=3.
