# Phase 10 — Fighter Playground · gate log

**Date:** 2026-07-19 · **Status:** implementation complete, gate green
**Spec:** [`10-fighter-playground.md`](10-fighter-playground.md)

## What shipped

A DEV-only `PlaygroundScene` (`?scene=playground`) on the Phase 08 twilight stage: one controllable
fighter plus an inert dummy, a DOM tuning panel pinned top-right that edits per-character stats live
and saves them back to `public/configs/character-gym.json`, and a debug-bounds overlay with
per-bound toggles and faint-when-inactive / solid-when-active rendering.

| Acceptance criterion | Result |
| --- | --- |
| Fighter moves on a fixed axis and performs all their actions | ✅ `walkF/walkB` never change the feet line; all six attack states, jump and crouch reachable (e2e) |
| Stat edits persist to config and apply in the main match | ✅ live rebuild of the sim config + `Save JSON` through the existing `/__gym/save` middleware |
| Typing in the panel never moves the fighter; canvas click restores control | ✅ tested with *real* trusted key events, not just the DEV seam |
| Frame-gated boxes faint (inactive) vs solid (active); per-bound + toggle-all | ✅ keys `1/2/3/4` + `B`, panel checkboxes stay in sync |

Fighters are selectable in the playground (player + dummy dropdowns); the Gym already had its
selector, so that half of the spec needed no work.

## Three things worth remembering

**1. `stats.scale` was dead, and waking it up has one non-obvious inverse.** The field was authored
in `character-gym.json` from Phase 09 but had *zero readers* in `src/` — every fighter shipped
`scale: 1`. It now multiplies every assembled collision box (in `assembleCharacter`, applied last,
*after* overrides — one traversal, one choke point) and the sprite (`FighterSprite` takes a
**required** `scale` arg, so a missed call site is a typecheck error rather than a silent art/box
desync). The subtlety: the Gym reads boxes off the **assembled** config, so writing them back into
`data.overrides` must divide by scale first, or the next assemble scales them twice. And the panel's
*display* rounding matters as much as the persist rounding — `applyFromPanel` rewrites all four
fields whenever one is edited, so an integer display would quietly re-author the three untouched
fields at a fractional scale (56 → 72.8 → shows 73 → saves 56.15). Both paths are 2dp now.

The validator gained `stats.scale > 0`. Zero collapses every box *and* divides by zero in that
inverse; a negative gives negative `w`/`h`, which `toWorld` normalises horizontally but **not**
vertically — overlap tests would have gone silently wrong.

**2. "Typing must not move the fighter" is really two bugs, and the second one is invisible.** The
obvious half is that key state keeps driving the sim. The half nobody sees until they try it:
`InputReader` builds keys with `kb.addKey(code)`, whose `enableCapture` defaults to **true**, and
Phaser's `KeyboardManager` attaches to `window` and calls `preventDefault()` on any captured keyCode
**regardless of event target** — so typing `a`/`d`/`w` into a panel field is *swallowed outright*.
The guard therefore needs `disableGlobalCapture()` alongside `enabled = false` and `resetKeys()`
(the last so a key released over the panel can't strand an `isDown`). `GymScene` had the identical
latent bug — arrowing inside a number field also nudged the selected box — and now shares the guard.

**3. Don't un-KO a decided round; restart it.** The first design pinned `match.phase` back to
`"fight"` before every `advance()`. Codex's plan review killed it: `checkRoundOver → finishRound →
endRound` has already banked the win and left the fighter in `ko`, so the next tick banks the same
KO again until `matchWinner` sets — and since one `advance()` runs up to 15 ticks, a pin placed
before the loop can't catch a mid-batch KO anyway. Shipped instead: pin only the round clock (plus
skip the intro freeze on a *fresh* round), and after `advance`, if the phase left `"fight"`, call the
existing `world.restart()`. Lifecycle invariants owned by `beginRound`/`endRound` are never violated.

## Reviews

**Codex plan review** — verdict *BLOCKED*, three blockers, all folded in before implementation:
the KO lifecycle above; `stats.scale > 0` validation; and "the DEV hook can't drive the planned input
tests" (there was no input seam, and merely exposing a `keyboardEnabled` flag proves a flag changed,
not that gameplay input stopped). The seam is now `__playground.hold()`, mirroring `__holdP1`, and it
is itself gated by the focus guard.

**Codex implementation review** — all three blockers confirmed resolved. Four new findings, none
blocking; two were real and are fixed (the Gym's integer display rounding, finding 1 above; and a
post-KO reset that kept the player's `x` while re-placing the dummy at a fixed point, which could
render an overlapped or reversed pair for one frame — the reset is now a clean full re-place, and the
stat-rebuild path clamps the kept `x` clear of the dummy). One was a test gap, also fixed: the
focus-guard e2e only drove the DEV seam, which the guard discards anyway, so it now also types with
trusted key events and asserts the digits land; and a scale test was added asserting sprite scale and
collision-box width grow together. The fourth — the guard's global-capture flag being game-wide while
`enabled` is per-plugin, so two simultaneous dev panels could re-enable each other — is unreachable
through `?scene=` routing (Boot starts exactly one dev scene) and is marked `ponytail:` with its
upgrade path (refcount the capture).

**Visual QA pass** (browser agent + `playwright-cli`, real Chrome) — four findings, all fixed:

1. It reported inputs being *silently swallowed* right after `R`. The reported root cause (a race
   between `latch.clear()` in the keydown handler and `EdgeLatch.apply()` in `update`) was **wrong** —
   keydown is emitted before the scene's `update`, so nothing is lost there. The real cause was
   next door and worse: `world.restart()` leaves the phase in `intro`, and `resetIfRoundOver` was
   written as `phase !== "fight"`, so **any frame that advances no sim tick restarts the world
   again** — teleporting the fighter to spawn and clearing the latch, once per short frame. Now it
   matches only the two *decided* phases (`roundEnd`/`matchEnd`). Measured: 1 reset vs 5 across
   three zero-delta frames. Worth stating plainly: **the bug was real, the diagnosis was not** —
   the fix came from re-deriving it, not from applying the suggested patch.
2. `FAINT = 0.28` measured as near-invisible against the dusk sky and warm rooftop (the backdrop
   competes with red and blue at low alpha). Raised to `0.5` **and** given a dashed stroke, so
   "not live" reads independently of the pixels behind it.
3. The panel covered ~51% of the dummy's health bar. `panelCard` took an optional `top`; the
   Playground passes `96px` to clear the HUD (watching the bar drain is half the point).
4. No upper bound on the stat fields — typing on the end of `walkSpeed` produced `24099`, which
   tunnels the fighter through the dummy's pushbox in one tick and reads as a collision bug.
   `STAT_RANGE` now clamps every stat, with matching `min`/`max` on the inputs.

QA confirmed working: faint→solid→faint across the real frame windows, every toggle plus panel
checkbox sync, the focus guard (digits land in the field, fighter doesn't move, canvas click
restores), `scale: 1.3` growing art and boxes together with feet still on the ground line,
`walkSpeed 600` and `gravity 800` visibly changing feel, and no console errors.

**A note on the regression test.** The first version of the sub-tick test passed against the
reintroduced bug — it never actually reset, so it asserted nothing. The second version could have
passed vacuously (`undefined === undefined`). The shipped version was verified by *reintroducing the
bug and watching it fail* (expected 2, received 5), then restoring. A test that has never failed
is not evidence.

## Gate

- `npx tsc --noEmit` — clean (strict, `noUnusedLocals`/`noUnusedParameters`/`noImplicitReturns`)
- `npm test` — **65** unit tests pass (was 58; +7 for box scaling, `allHitBoxes`, scale validation)
- `npm run test:e2e` — **20** Playwright tests pass (was 12; +8 new playground acceptance tests),
  stable across three consecutive full runs. The six-attack-states test batches its ~45 browser
  round-trips into one `page.evaluate` — sequentially it grazed the 30 s timeout and went flaky.
- `npm run build` — succeeds
- Production-bundle check: `dist/assets/*.js` contains **0** occurrences of `__gym/save`,
  `gym-panel`, `playground-panel`, `Fighter Playground`

## Not covered

- **The panel is not a designed UI.** It's the same dark monospace card as the Gym sidebar. Phase 14
  skins the HUD; the dev panels stay deliberately plain.
- **No stat presets / undo.** Editing is destructive until you hit Save, and Save only writes the
  player fighter's `stats` block (box overrides stay whatever the Gym authored).
- **The dummy is inert** — it never attacks, so the player's own `hitstun`/`blockstun` can't be felt
  here, only the guard box and blockstun geometry. A recording/playback dummy is a later ask.
- **`scale != 1` is now possible but untuned.** All three fighters still ship `scale: 1`; the sprites
  were baked to a single 185px per-fighter normalisation in Phase 09, so a scale change stretches
  that bake rather than re-rendering art at the new size.
- The camera still follows a single fighter with no zoom — the Phase 12 group-camera gap, unchanged.
