# Phase 12 log — Core Combat, Camera & Integration

**Gate: PASSED** — 2026-07-22. 195 unit tests (13 files), 49 Playwright e2e, `npm run build` green,
`check:sync` and `check:sprites` green. Plan Codex-reviewed in 3 passes before approval, the diff
Codex-reviewed twice after — the second pass blocked on a real batch-timing defect (see §3) — plus an
independent QA-agent pass on the running game.

## What the phase actually was

A **capability delta**, not a rebuild. Every row of the phase spec's table was checked against the
code first, and four of them were already done:

| Requirement | Found | Did |
|---|---|---|
| Hit detection / damage / knockdown | present (`combat.ts`, `fighter.ts`) | nothing |
| Best-of-3 + round timer | present (`match.ts`, surfaced in `hud.ts`) | nothing |
| Per-character high/low config | present **since Phase 09** — the spec's "Missing" was stale | nothing |
| Facing flip | present (`updateFacing` + `setFlipX`) | nothing |
| Z-order "recent mover in front" | partial — only swapped on an *attack* | fixed |
| Group camera | missing | built |
| Sprite-frame ↔ sim-frame sync | missing, and measurably broken | built |
| Rematch / menu wiring | keys worked, nothing said so | built a menu |

## 1. Group camera (zoom-in only) + a second camera for the UI

`src/render/camera-frame.ts` (Phaser-free, node-tested): `groupZoom(sep)` =
`clamp(VIEW_WIDTH/(sep+240), 1, 1.25)`, `stepZoom` eases at 0.12/frame and snaps inside 0.001.
`MatchScene.update` calls `setZoom` then `centerOn(midpoint, STAGE_HEIGHT - displayHeight/2)`.

**Zoom never goes below 1.** Phase 08 rejected zoom because the stage art is exactly `STAGE_HEIGHT`
tall, so zooming *out* exposes empty bands. Zooming *in* has no such problem, and the framing
problem at maximum separation was already solved in the sim by `MAX_SEPARATION`. `ZOOM_PAD = 240 =
VIEW_WIDTH - MAX_SEPARATION`, so the curve meets the un-zoomed camera at exactly 1.0 with no step.
`ZOOM_MAX = 1.25` sits inside a measured vertical budget: bottom-anchored, the ceiling is 1.53
(highest jump apex 185px + 185px fighter → topmost art pixel at world y ≈ 250).

**`setScrollFactor(0)` does not exempt an object from zoom** — that is why the HUD needed its own
camera. At 1.25 the bars would have grown 25% and the outer ones left the screen. `StageHandle` now
exposes `objects` (it only exposed `layers`, so **every prop would have rendered on both cameras**),
`Hud` exposes `objects`, and the control legend is retained instead of being dropped on the floor.

## 2. Z-order

`updateDepth`: attacker wins (unchanged); else whichever fighter is in `walkF`/`walkB`; else keep.

The first draft compared `x` against a `prevX` captured before `think`. Codex killed it: that signal
is contaminated three ways — `resolveSpatial` moves *both* bodies when a walker pushes an idle
opponent, the `MAX_SEPARATION` cap rewrites both, and retained knockback moves a fighter who never
acted, including **a KO body sliding through `roundEnd`, which would have popped the loser in
front**. The locomotion state `think` already assigns has none of those problems.

## 3. Sprite-frame ↔ sim-frame sync

`scripts/check-attack-sync.py` (`npm run check:sync`) measures each attack sheet's **contact frame**
and writes it to `render.sheets.<state>.hit`; `attackFrameDurations` in `anim-timing.ts` then gives
Phaser explicit per-frame durations so that frame starts when the hit box does. Total move length is
unchanged. 14 of 18 sheets carry a measurement; the other 4 keep uniform timing.

Three things had to be got right, and the last two were only found by running the game:

- **The metric.** The obvious one — furthest opaque column — measures the whole silhouette, and for
  a wide-stanced fighter the widest thing in frame is a planted leg that never moves. The monk's
  `attackLight` scored `[65, 65, 65, 66, 65, 65]`: a 1px spread across an entire punch. Differencing
  each frame against frame 0 deletes the static stance and leaves the limb. The new metric **agrees
  with the old one on every sheet the old one could call**, and resolves two it could not.
- **Honest refusal.** A flat profile, a peak on the final frame (no recovery art to spend time on),
  or fewer than two moving frames all report INDETERMINATE and keep the old timing. Naming that is
  worth more than a green tick that means "I couldn't tell".
- **`PLAY_LAG_TICKS`, and then the batch case.** `FighterSprite` calls `play()` during the render
  pass *after* the tick that entered the state, so the animation clock runs one tick behind the sim.
  Measured live: at `stateFrame === 4` the animation had elapsed exactly 3 ticks. The arithmetic was
  perfect and the contact frame still landed on the *last* active tick instead of the first. The
  wind-up segment is now budgeted `startup - 1` ticks (plus a 1ms bias so an exact boundary resolves
  early, not late). **A second Codex pass then showed one tick is not always the lag**: `World.advance`
  runs a whole batch of fixed ticks before the scene renders — up to 15 at `MAX_FRAME` — so on a frame
  hitch an attack can enter its state and run clean past its active window before `play()` is ever
  called. `FighterSprite` now fast-forwards a freshly started animation by `stateFrame - PLAY_LAG_TICKS`
  ticks. Every other pump in the e2e suite is exactly one tick, so none of them could see it; the new
  test steps 5 ticks at a time and fails without the catch-up.

## 4. Match-end menu

REMATCH / MAIN MENU, arrows or W/S, Enter confirms, defaults to REMATCH so the old Enter reflex
still rematches. Enter **outside** matchEnd is still the plain restart. Scrim at 50% black, selection
marked by a caret and an underline as well as colour.

## Findings from review that changed the code

**Codex (diff):**
- `STAGE_MARGIN` was 90 against a **116px** widest sprite extent (jiujitsu `ko`), so a cornered KO
  lost 26 world px. Pre-existing and invisible; the zoom magnified it. Raised to 116, measured.
- The gate only compared a declared `hit` to the measurement on MISALIGNED rows, so art that changed
  into ALIGNED/INDETERMINATE could keep a stale value that still retimed the animation. Now every
  row is checked. Both new failure modes were watched failing before being accepted.
- `ArrowDown` and `S` both moving the selection meant pressing both in one frame wrapped twice back
  to where it started. At most one move per frame now.
- One self-test was vacuous: its "empty" frames still drew a body.

**Codex (re-review of the final diff):**
- The fixed one-tick play-lag model is not batch-safe — see `PLAY_LAG_TICKS` above. Fixed with a
  catch-up in `FighterSprite`, plus an e2e that pumps multi-tick frames.
- `startup: 1` was an inconsistent accepted configuration: the validator and the gate allowed a
  declared `hit` when `startup > 0`, but the renderer refuses it when `startup - PLAY_LAG_TICKS <= 0`.
  All three now require `startup > PLAY_LAG_TICKS`.

**QA agent (running game):**
- **A nav key already held when the KO landed moved the selection.** Phaser's `Key._justDown` is set
  on keydown and cleared only when a `JustDown()` read consumes it or the key comes up — it is *not*
  frame-scoped. Polling it only while the menu was up meant a player who died while holding crouch
  (an entirely normal way to die) arrived at a menu already pointing at MAIN MENU, and a reflex Enter
  quit the match. Now polled every frame, acted on only at matchEnd. Watched failing first.
- The monk's `attackLight` and `crouchLight` still struck on a wind-up pose — which is what sent the
  metric back to the drawing board (above).

**Screenshots caught what no test did:** the control legend measured **1535px wide in a 1280
viewport** and had been clipped at both ends for several phases — including the P1 bindings. Split
across two lines. The end menu also needed a plate behind it; the winner usually stands exactly
where those two lines sit.

## Known and deliberately not fixed

- **No two fighters can physically cross.** The QA agent computed and then confirmed with real ticked
  jumps that no roster member clears any opponent's `pushStand.h` (discrete integration falls ~8px
  short of the continuous apex, which erases even the monk's small margin). `spatial.ts`'s
  "a jump-over won't push" branch is therefore unreachable in play. Changing it is jump-height
  balance, not this phase.
- 4 of 18 attack sheets have no measurable contact frame (`monk/crouchLight` is literally flat;
  `jiujitsu/crouchHeavy` and `monk/airHeavy` peak on the final frame). They keep uniform timing. The
  honest fix is re-shooting those clips with follow-through, not guessing a number.
- The zoom lerp is frame-rate dependent (render-only, never feeds the sim), marked `ponytail:`.

## Gate

```
npm test                # 195 passed (13 files)
npm run build           # tsc --noEmit && vite build, green
npm run check:sync      # 18 sheets: 4 aligned, 10 misaligned+fixed, 4 indeterminate; exit 0
npm run check:sprites   # OK (self-tests + all registry sheets)
npm run test:e2e        # 49 passed
```
