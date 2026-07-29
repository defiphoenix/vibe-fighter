# Phase 18 — Mobile + tablet support with on-screen touch controls

**Status: implemented, gates green, not pushed.**

The deployed game was keyboard-only. On a phone it booted, letterboxed correctly, and was then
unplayable: every binding is a physical key, the mode screen offered local 1v1 that two people cannot
share on one handset, and portrait squeezed a 1280×720 canvas into a tall viewport.

This phase makes https://vibe-fighter-dusky.vercel.app playable on a phone and a tablet **without
touching `src/sim/`, the world geometry, or the desktop experience**.

---

## Spec

| # | Requirement | Where it lives |
|---|---|---|
| 1 | Playable on a phone/tablet in a mobile browser, at the deployed URL | the whole phase |
| 2 | On TOUCH the mode select offers **Player-vs-CPU only**; desktop keeps PvP | `flow-state.ts` `modeOptions(touch)` |
| 3 | Landscape enforced on touch; portrait shows a rotate overlay that blocks input and clears instantly | `touch.ts` `shouldBlockForOrientation` + `main.ts` + `index.html` |
| 4 | On-screen controls for movement, jump, crouch, light, heavy, block, super — legible about what each does | `touch.ts` `touchLayout` + `touch-view.ts` |
| 5 | Controls render only on touch devices, and only during a match | `MatchScene.create` / `setVisible` |

Constraints held: `src/sim/` untouched; touch enters through the same `InputSnapshot`; one rising-edge
implementation; touch UI on the second non-zooming camera and in exactly one `ignore()` list;
`STAGE_WIDTH`/`VIEW_WIDTH` unchanged; vector art only, no Higgsfield credits spent.

---

## What shipped

**`src/render/touch.ts`** — Phaser-free, the whole decision surface:
`isTouchDevice({maxTouchPoints, anyPointerFine})`, a memoised `touchMode()`, `shouldBlockForOrientation`,
`touchLayout()`, and `TouchPadState`.

**`src/render/touch-view.ts`** — `TouchPad`, the Phaser adapter: one `Graphics` (depth **96**) and 8
`Text` labels (depth **97**), `objects` for the camera list, `addPointer(3)`, scene-level
`pointerdown/move/up/upoutside`, and a `reconcile` against `input.manager.pointers[].isDown`.

**`src/scenes/input.ts`** — `read(touchHeld?)` ORs the pad's held flags into P1's **before** the existing
`prev`/`now` edge computation. That is the entire integration: one implementation of `*Pressed`.

**`src/scenes/MatchScene.ts`** — builds the pad before the camera block, hides the keyboard legend on
touch, drains the pad once per update, hides it at `matchEnd`, adds it to `cameras.main.ignore()`,
makes the end menu tappable, and routes a new `⎋ MENU` button through the same `pressMenu()` the Esc
key uses.

**`src/scenes/flow-state.ts` / `FlowScene.ts`** — `FlowState.touch`, `modeOptions(touch)`, `setChar()`
for a positional pick; on touch every card is a tap target under one rule (**tap an unselected card
selects; tap the selected card confirms**), the title is a full-screen Zone that requests fullscreen on
`pointerup` then advances, plus a `◀ BACK` button and touch-worded hints.

**`index.html` / `src/main.ts`** — an `html.touch` class, a static `#rotate` overlay, and one
`applyOrientation()` that toggles the class, sets `game.input.enabled`, and sleeps/wakes the loop.

### The three decisions worth keeping

**Touch means "touch AND no fine pointer", not "has touch".** `game.device.input.touch` answers
capability, and a touchscreen Windows laptop answers yes — it would have lost local two-player, the one
mode a laptop is *good* at, and gained a pad nobody needs. `matchMedia("(any-pointer: fine)")` is what
separates a phone from a laptop with a trackpad.

**`touchMode()` is memoised, deliberately.** FlowScene, MatchScene and `main.ts` all need the answer and
are constructed at different times. Three independent derivations are three chances to disagree — the
exact shape of R-14, where the HUD and the sim answered the same question differently. Threading it
through `MatchConfig` was considered and rejected: `?scene=match` boots with no FlowScene at all, so the
field would be absent exactly where the specs need it.

**`consume()` is a queued press counter with a forced release gap.** Two separate failures rule out the
obvious "is a finger on it" read:

1. Phaser dispatches touch **synchronously from the DOM listener** — `InputManager.onTouchStart` calls
   `updateInputPlugins` directly (`InputManager.js:508-533`), nothing is queued for the next step. So a
   tap whose down and up both land between two frames is never seen as held, the edge never forms, and
   the attack silently does not come out. Under the e2e's pumped clock that is *every* `touchscreen.tap`.
2. A plain sticky bit still drops the second of two fast taps: if the previous frame reported `true`,
   `InputReader.prev` is `true`, so a second `true` is not an edge. Mashing LIGHT is the commonest thing
   a phone player does.

So a press is queued on touchdown, released one frame at a time, and a queued press waiting behind a
frame that already read `true` first forces one `false` frame. Cost: 16 ms of latency on the second of
two very fast taps. Benefit: every tap is exactly one edge.

---

## Gate log — measured, not claimed

### Build + suites

```
$ npm run build
> tsc --noEmit && vite build
✓ 41 modules transformed.
dist/index.html                    2.40 kB │ gzip:   1.20 kB
dist/assets/index-6NXQ255L.js  1,450.70 kB │ gzip: 392.82 kB
✓ built in 3.76s

$ npm test
 Test Files  19 passed (19)
      Tests  344 passed (344)
   Duration  1.73s

$ npm run test:e2e
  85 passed (8.8m)
```

344 unit, up from 309 — **+24** in `touch.test.ts` and **+11** in `flow-state.test.ts` (24 → 35). 85
browser cases, up from 73: **+12** in `mobile-touch.spec.ts`.

### Every new test was watched failing

The project's rule is that a test nobody has watched fail is decoration. Each of these had the thing it
guards deliberately broken, the failure recorded, and the code restored.

| Mutation | Result |
|---|---|
| `consume()` → `out[b] = held` (no press queue) | **RED, unit:** `a tap that starts AND ends between two consumes…`, `a fast re-tap…`, `cancel() clears…` — 3 failures |
| same mutation, browser | **RED:** `a TAP on the LIGHT button lands a hit` — `expect(after[1]).toBeLessThan(before[1])` |
| `isTouchDevice` → drop the `!anyPointerFine` clause | **RED:** `is NOT a touchscreen laptop (touch AND a mouse)` |
| `move()` → ignore the `padPointers` guard | **RED:** `a pointer that started off the pad cannot grab a button mid-drag` |
| `modeOptions` → return `MODE_OPTIONS` unfiltered | **RED:** 4 failures incl. `still boots a real match config from a touch flow` |
| `game.input.enabled = !blocked` deleted from `main.ts` | **RED:** `a tap on the rotate overlay cannot advance the menu behind it` — `- "step": "title"` / `+ "step": "mode"` |
| every release path removed (`pointerup`, `pointerupoutside`, `reconcile`) | **RED:** `a touch released OFF the canvas does not leave the button held` |

**Two of my own specs were decoration first, and only mutation testing found it.** Both are worth
recording because both passed convincingly:

- *the rotate-overlay spec.* It tapped, waited on the wall clock, and asserted the flow had not moved —
  and it passed with the input gate **deleted**. Cause: the rotate gate also puts the loop to sleep, so
  nothing was processed either way. Then, once it stepped the game by hand, it *still* passed with the
  gate deleted: it tapped the centre of the **viewport**, and the ScaleManager polls its parent every
  500 ms, so with stale bounds that point transformed to game y ≈ **−334**, off the canvas, hitting
  nothing. It only became a real test once it waited past the poll and tapped the centre of the
  **canvas** — at which point deleting the gate produced `"step": "mode"` where `"title"` was expected.
- *the off-canvas spec.* It dragged the thumb into the letterbox before releasing, so `move()` had
  already let go of the button and the `up` path was never the thing under test.

Residue at this point: no browser case distinguished `POINTER_UP_OUTSIDE` from plain `POINTER_UP`,
because Chromium reports the canvas as `upElement` even for a release in the letterbox bar. The Codex
diff review called that out and it is now covered by a case that drives the event directly (finding 4
below).

### The screenshot — looked at, and it found a defect

Pixel 5 landscape, mid-match, taken at `test-results/phone-landscape.png` (gitignored).

The first shot showed the `⎋ MENU` button drawn at the top-right corner **overlapping the P2 portrait
plate** — placed by arithmetic that never asked what was already there. Moved to the bottom-centre strip
the keyboard legend vacates on touch: clear of both thumb clusters, clear of the HUD.

The second shot (`phone-landscape-pressed.png`) was taken with a CDP touch held on LIGHT: the button
draws its pressed state and the brawler is mid-punch in the same frame — the pad, the edge and the sim
agreeing on screen rather than in an assertion.

Read on the real thing: **the vector controls are legible and do not look cheap.** Words (`JUMP`,
`CROUCH`, `LIGHT`, `HEAVY`, `BLOCK`, `SUPER`) plus `◀`/`▶`, 104 px circles, translucent plate, orange
rings on the actions and pale rings on movement — the rooftop-dusk palette, so they read as part of the
game. A Higgsfield atlas is **not** proposed as follow-up on this evidence; if it is ever wanted it is a
pure swap behind `touchLayout()`.

### Layout, measured

Eight circles, r = 52, in game space, two symmetric crosses:
`JUMP(160,480) ◀(68,570) ▶(252,570) CROUCH(160,660)` and
`BLOCK(1120,480) LIGHT(1028,570) HEAVY(1212,570) SUPER(1120,660)`.
`touch.test.ts` asserts as invariants — not as constants — that every button is inside 0..1280 / 0..720
and that no two circles overlap (`dist > r1+r2`; the closest pair is 128.7 px against a 104 px sum). On
an 851×393 phone viewport `Scale.FIT` gives 0.546, so a button draws ≈ 56 CSS px ≈ 9 mm.

---

## Codex review of the plan — 7 findings, all re-derived, all real

Run read-only before implementation. Each was checked against the shipped Phaser source rather than
patched on the reviewer's say-so.

| Finding | Verdict | What was done |
|---|---|---|
| The rotate overlay does not swallow Phaser input | **REAL** — `TouchManager.js:280-287` registers `onTouchStartWindow` on `window` and forwards any touch whose `target !== canvas` | `game.input.enabled = false` while blocked; **the spec that proves it was itself broken twice first** (above) |
| Applying orientation at boot races the loop start | **REAL** — `TimeStep.js:781-790` is `if (this.running)`, and `loop.start()` runs after READY | first `applyOrientation()` on `Phaser.Core.Events.PRE_STEP` |
| `FlowState.touch` never reaches MatchScene | **REAL risk, different fix** — `MatchConfig` cannot carry it because `?scene=match` has no FlowScene | memoised `touchMode()` |
| `pointerup` alone leaves a button held | **REAL** — `InputPlugin.js:2064-2075` | `pointerupoutside` + `reconcile` + gating a hidden pad |
| The sticky bit drops the second of two fast taps | **REAL** | replaced with the press queue + forced gap |
| `viewport-fit=cover` puts the outer buttons under a notch | **REAL**, and invisible to Pixel 5 emulation | dropped from the viewport meta |
| "both ignore lists" would render the pad never | **REAL — my plan's wording was wrong** | `cameras.main.ignore()` only |

Two further notes it contributed, both confirmed in source: touch **is** dispatched synchronously with
the loop stopped, and `setInteractive()` defers insertion until the next scene pre-update (so a spec
must pump a frame after creating a tap target).

## Codex review of the diff — 4 findings, all real, all fixed

Run read-only against the working tree after the gates were green. All four survived re-derivation.

**1 · Fullscreen would have stranded the rotate overlay.** With no `fullscreenTarget`, Phaser "will
automatically create a blank `<div>` element and move the canvas into it" (`ScaleManager.js:1309-1312`)
— so `#rotate`, a sibling, is outside the fullscreen subtree. On a phone that entered fullscreen and
then rotated, the player would have got a frozen canvas and no explanation. `#rotate` now lives INSIDE
`#game`, and `#game` is the configured `fullscreenTarget`.

**2 · A finger held across the rotation would have stuck a button forever.** While input is disabled
Phaser's own `manager.enabled` guard discards the `touchend` (`TouchManager.js:285`), so the Pointer
keeps reporting `isDown` — and `TouchPad.consume`'s reconciliation believes it. `applyOrientation()`
now calls `Pointer.reset()` (which clears `isDown`, `Pointer.js:1208-1233`) on every pointer across the
transition. This is a bug the "self-healing" reconcile actively caused rather than caught.

**3 · The whole-journey spec drove the menus through a DEV seam.** It called `__flow.tap(i)` for every
card, so it would have stayed green with the cards' `setInteractive` registration, hit areas or
coordinate transform completely broken — the same objection that keeps `__holdP1` out of this file,
which I applied to the pad and then failed to apply to the menus. It now reads real card geometry from
a `cards()` seam and taps the actual screen position with `page.touchscreen.tap`.

Fixing it immediately exposed a second thing, and it is worth writing down: **a card fading in from
alpha 0 is not hit-testable at all** (`willRender` fails), and its entry tween needs BOTH the wall
clock (Phaser's `TweenManager` reads `Date.now`) AND a pumped `game.step` (the manager only runs inside
one). Waiting on either alone hangs forever. The spec now alternates pump and real time until the card
settles — which is also the only reason the real taps land.

**4 · The off-canvas spec did not test the `POINTER_UP_OUTSIDE` subscription.** Correct: Chromium
reports the canvas as `upElement` even for a release in the letterbox bar, and reconcile can clear it
anyway. Rather than leave it as documented insurance, there is now a case that emits the event the way
Phaser would, on a pointer that is still physically down so reconcile cannot be what releases the
button. **Watched failing** with the subscription deleted.

Final counts after this round: **344 unit, 85 browser** (12 in `mobile-touch.spec.ts`).

---

## Deliberately not done

- **`screen.orientation.lock()` is never called.** MDN: "Limited availability … not Baseline because it
  does not work in some of the most widely-used browsers", and "orientation locking is only enabled on
  mobile devices, and when the browser context is full screen". It needs fullscreen on Android, is
  unsupported on iPhone Safari, and rejects asynchronously. The overlay is the mechanism; the API adds
  an unhandled rejection and buys nothing.
- **Phaser's `scale.lockOrientation()` is also never called** — `ScaleManager.js:717-727` calls
  `screen.lockOrientation || screen.mozLockOrientation || screen.msLockOrientation`, all removed from
  modern browsers, so it returns `false` unconditionally. It is dead code, not a fallback.
- **No art generated.** Vector only, as specified.
- **No new npm dependency, no `vercel.json`/CSP/`vite.config.ts` change, no balance number touched.**

## Known limits, stated rather than hidden

- **iPhone Safari has no fullscreen for an arbitrary element.** The title tap requests it, Phaser
  answers `FULLSCREEN_UNSUPPORTED`, and the game carries on letterboxed. Correct either way; fullscreen
  only makes it bigger.
- **iOS ignores `user-scalable=no` / `maximum-scale`.** `touch-action: none` protects gestures that
  begin on the canvas, which is where the pad is; a pinch starting in the letterbox bar is not blocked.
- **Two-finger play is supported (`addPointer(3)`) but the phase's evidence for it is a unit test**, not
  a browser case — CDP multi-touch through the pumped clock was not worth the spec complexity here.
- The journey spec ends at **damage + a clean exit**, not a KO: reaching a KO by tapping is ~17 exchanges
  against a live CPU and would be a slow, flaky test. Real KOs are already covered by
  `phase16-parity.spec.ts`.
