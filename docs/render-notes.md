# Render adapter notes

`src/scenes/`, `src/render/`, `src/main.ts` read sim state and draw it. The sim side is
[`sim-invariants.md`](sim-invariants.md); the boundary itself is [`architecture.md`](architecture.md).
Rendering uses **default LINEAR antialiasing — no `pixelArt`** — because the art is photographic.

Everything here is what you cannot learn by opening the file.

## Tint and sprite feedback

**Phaser 4 tint COLOR and tint MODE are separate, and `setTintFill()` is a deprecated no-op.** A white
MULTIPLY tint is invisible, so a flash must `setTint(0xffffff).setTintMode(Phaser.TintModes.FILL)` and
switch the mode back, or the fighter stays a white silhouette. `FighterSprite.update()` is the ONLY writer
of the tint — `applyHitFeedback` runs before `render()`, so tinting from the event loop is overwritten the
same frame; a block flash can only be set THROUGH the sprite. **There is NO steady guard tint** — a
guarding fighter used to be tinted blue every frame, but once `block`/`blockCrouch` got real poses that
pose IS the cue, and a whole-body blue tint just read as "the character turned blue". Only the white
block-flash (a landed block) tints now.

## The canvas is not a fixed size (Phase 19)

`Scale.FIT` alone pillarboxed a locked 16:9 canvas on a phone, so `main.ts` reshapes the GAME to the
device's aspect — `scale.setGameSize(viewWidthFor(parentW, parentH), STAGE_HEIGHT)` from a
`Scale.Events.RESIZE` listener — and FIT then has nothing to letterbox. **The height NEVER moves** (the
stage art is exactly `STAGE_HEIGHT` tall and `centerOn` is bottom-aligned). The decision is Phaser-free in
[`../src/render/viewport.ts`](../src/render/viewport.ts), bounded by `VIEW_WIDTH` (the menus are budgeted
against it) and `STAGE_WIDTH` (above it the camera needs world that does not exist). `src/sim/` is
untouched: `MAX_SEPARATION` is still `VIEW_WIDTH - 240`, and `camera-frame.ts groupZoom` deliberately keeps
the CONSTANT so vertical framing is unchanged and the extra width only reveals more rooftop.

Four things are load-bearing:

- **`Phaser.Scale.EXPAND` + `scale.min`/`max` is a TRAP, not the answer.** `parseConfig` maps min/max onto
  `displaySize` — the CSS size — and `Size.getNewWidth` clamps to `minWidth` BEFORE comparing to the
  parent, so `min.width: 1280` writes `style.width: 1280px` onto an 851px phone with a -215px margin.
  Looks fine on a desktop, wrong on every phone.
- **Do NOT also centre the canvas in CSS.** Phaser's `CENTER_BOTH` writes `marginLeft`/`marginTop`, and a
  grid/flex parent centres the canvas's MARGIN BOX, so the two compose and park it a quarter of the gap off
  to one side. That was the "not centered" bug. Same reason `image-rendering: pixelated` must stay OFF the
  canvas — it contradicts the no-`pixelArt` LINEAR decision.
- **Every screen-space owner has a `layout(width)`** (`Hud`, `CutInView`, `TouchPad`, MatchScene,
  FlowScene), called once from `create()` and again on RESIZE via a **bound property** so `SHUTDOWN` can
  `off()` it. `TouchPadState` holds a SECOND copy of the pad layout — write both, and `cancel()` the live
  contacts first or a thumb keeps holding a button that has moved.
- **A second camera created with an explicit size does NOT auto-resize.** `CameraManager.onResize` only
  resizes cameras whose dimensions equal the PREVIOUS game size, so MatchScene's `uiCam` must be built from
  `scale.gameSize` and sized in `layout()` — hardcoded at 1280 it cropped P2's HUD plate off a phone screen
  entirely.

## Cameras, depth and zoom

**`setScrollFactor(0)` does NOT exempt an object from ZOOM.** Hence the second, non-zooming camera for
HUD/legend/quit-prompt/end-menu (`cameras.add` + reciprocal `ignore()` lists). An object missing from both
lists renders TWICE; one in both renders never. The lists must stay exhaustive —
`e2e/camera-group.spec.ts` asserts every object's `cameraFilter`. This is why `StageHandle` exposes
`objects` (not just `layers` — props were unreachable) and `Hud` exposes `objects`.

Zoom is **IN only**: `groupZoom(sep) = clamp(VIEW_WIDTH/(sep+240), 1, 1.25)`, eased by `stepZoom`, then
`centerOn(midpoint, STAGE_HEIGHT - cam.displayHeight/2)` for a bottom-aligned view. Below 1 shows empty
bands (the art is exactly `STAGE_HEIGHT` tall); the far case is already solved by `MAX_SEPARATION`.
`ZOOM_PAD = VIEW_WIDTH - MAX_SEPARATION` makes the curve meet 1.0 exactly at max separation.

**`STAGE_MARGIN` is 116, not 90**: it must be ≥ the widest sprite extent from the origin (jiujitsu `ko` =
116px) or a cornered body is cropped by the camera's world bound.

**A Container's own depth is what sorts it against the scene**; its children's depths are only relative to
each other. A menu container left at depth 0 renders *under* a depth-1 scrim — which looks like a colour
choice, not a bug. Depth bands: layers 0–2, props 3–8, fighters 9–11, debug 50, **touch pad 96–97**, end
scrim 99, HUD 100–101, Esc quit prompt 102, match-end menu 103, super cut-in 104–106, **mute button 107**.
The mute button is deliberately the topmost thing on screen: a control that disappears during a super
freeze or behind the end-menu scrim is not a mute control. The pad is deliberately BELOW the cut-in (which
owns the screen during a freeze) and below the end menu; it never collides with the HUD because it lives at
the bottom and the HUD at the top. Fighter depth (`11`/`9`) follows the most recent MOVER, and must key off
walk STATE, not position — pushback and knockback move a fighter who never acted.

## Stage layers and props

**Do NOT set a Phaser Image's `displayHeight` alone to scale a layer** — that setter changes only `scaleY`
and squashes it to full width. Use `setScale()` or a pre-baked size. Stage layers are pre-baked to 1697×720
by `copy-stage-layers.py` and drawn at `setScale(1)`.

**There is deliberately NO per-prop `scrollFactor`** in `PropConfig` (a factor < 1 drifts a prop across the
roof as the camera pans); only `scale`. The **water tower and left-side shed are BAKED into
`medium.png`/`main.png`**, not props — resizing them needs an art regen. Measure a prop's displayed opaque
height against the fighter (~183px) rather than eyeballing.

The front `near` occluder was **dropped from `stages.json`** in the resolution pass (its dusk-palette edge
read as "residual purple"); BootScene still preloads `near.png`, so re-adding a `<stage>-near` entry
restores it. The stage is 3 layers now.

## Boot

**BootScene is two-phase**: `load.json` in preload → validate in create → queue every sheet and
`portrait-<id>` → `this.load.start()` → on COMPLETE refuse routing if `failed>0` OR any expected texture is
missing (blocks a 404 AND a corrupt-200). Portraits can't be queued in `preload()` because their ids come
from the registry, which is only cached after preload.

**`loader.timeout` is unset, so a request that never resolves hangs boot forever** — for the registry JSON,
both atlases, the stage layers, every sheet, every portrait and (since Phase 20) every sound alike.
Measured, not fixed: it satisfies "refuse to route" and the failure direction is the safe one (the title
screen waits rather than the game starting broken). Raised by a QA pass as an audio gap; it predates audio
by eighteen phases. Re-derive a finding's blast radius before accepting its framing.

## Keyboard, bindings and the dev panel

**`Phaser.Input.Keyboard.JustDown` is NOT frame-scoped.** `Key._justDown` is set on keydown and cleared
only by a `JustDown()` read or keyup, so polling it only while a menu is open lets a key *already held*
when the KO landed (down = crouch, an ordinary way to die) fire a phantom edge. Poll every frame, act only
in the right phase.

**Block can't use Left/Right Shift** — Phaser 4.2.1 dispatches by keyCode and both shifts are 16. Bindings:
P1 WASD + F/G, block `Q`, super `E`; P2 arrows + `,`/`.`, block `/`, super `M`. **Mute is `N`** (Phase 20),
bound in both MatchScene and FlowScene — `M` was already P2's super.

**`installFocusGuard` needs `disableGlobalCapture()`, not just `keyboard.enabled = false`**: `InputReader`
builds keys with `addKey()` (capture defaults **true**) and Phaser's `KeyboardManager` listens on `window`
and `preventDefault()`s any captured keyCode **regardless of event target**, so typing into a panel field is
otherwise swallowed. It also calls `resetKeys()` so a key released over the panel can't strand an `isDown`.
Capture is game-global while `enabled` is per-plugin, so it assumes ONE dev scene at a time (Boot guarantees
that). **A `<select>` is NOT blurred by changing its value** — the shared `select()` helper `blur()`s on
change, or the keyboard stays dead after a dropdown pick (this read as "the monk can't do any moves").

`render/dev-panel.ts` is **function declarations only, no top-level DOM/fetch**, so importing it can't drag
panel/save code into a prod bundle. The Gym saves through a **dev-server-only** Vite middleware
(`vite/gym-save-plugin.ts`): full-origin match, 256 KB limit, shared `validate-character`, atomic
temp+rename write.

Gym boxes come off the **assembled** config, so `persist()` **divides by `stats.scale`**, and both persist
and display round to **2dp, never integers**. **Guard is the exception**: it edits the STANCE TEMPLATE (all
frames) via `render/gym-persist.ts`, and its display box is a scaled view of the template, *not* the
assembled frame's box — editing the frame's box would smear a hand-authored per-frame override across every
other frame. A template write then needs a full `rebuild()`, because each frame holds its own clone.
(`applyFromPanel` rewrites all four fields when one is edited, so an integer display re-authors the
untouched three at a fractional scale.)

**PlaygroundScene must never force `phase` back to `"fight"` after a KO** — `endRound` has already banked
the win and left a fighter in `ko`, so the next tick banks it again until `matchWinner` sets; and a 15-tick
`advance` batch can KO mid-loop, so a pre-loop pin can't catch it anyway. It pins the clock only while
`phase === "intro"` and does a full `world.restart()` on any non-`fight` phase.
**…and `restart()` zeroes the meter, so `resetWorld` must save and restore it** — right for a fresh match,
wrong for a training scene whose whole purpose is trying a super repeatedly. Without it, farming meter on
the dummy and KO'ing it confiscated the bar, which made the specials untestable exactly where you go to
test them. The scene's panel also has **fighter select · regen hp · fill meter**, now named in the on-screen
legend: a training feature nobody can find is not one.

## Debug overlay

`drawDebugBoxes` falls back to **`allHitBoxes(cfg, state)` — all distinct hit boxes across the state's
frames**, not the first one, because a per-frame override may legally replace `hit[]` on a single active
frame with different reach. Guard falls back to **`f.guardBoxes()` — the current FRAME's stance array** — so
a frame carrying no guard box correctly draws nothing rather than advertising a stance box the sim would
never honour. Bounds draw **faint when inactive, solid when active**.

## HUD

HUD is screen-space: `setScrollFactor(0)` on every element and it reads `VIEW_WIDTH`, not the world.

**The HUD is atlas ART, and the art owns the geometry** (Phase 14). `hud.ts` authors only two scales and
three offsets; the bar's width, **height** and fill-slot rect are read from the `hud-atlas` frames. Slot
frames are packed in **atlas space**, so the plate's own `cutX/cutY` comes off first, and a flipped (P2)
plate needs the mirrored slot `barW - dx - w`. The coloured fill is a `Graphics` drawn **behind** the plate
so it shows through the transparent slot — which means **`fillStyle` must be set before
`fillGradientStyle`**: the gradient is WebGL-only and the Canvas renderer *skips the command*, leaving
whatever fill style preceded it (the black backdrop) to draw the health bar black. Portraits cover-crop into
the plate's arch with no crop and no mask — the overflow hides under the plate — but never letterbox one
(that is Phase 11's black band). The bar plate is drawn **non-uniformly** (`BAR_SCALE_X`/`BAR_SCALE_Y`): its
40 px of bezel above and below the slot is frame art, not padding, so "thinner and wider" has no
uniform-scale answer.

**Phase 15's `meter-bar` is a second plate on the same contract** — packed to the same 460 px width so the
bevels line up, drawn at the same anisotropic scales, its fill read off `meter-bar-slot` with the same
mirrored-for-P2 arithmetic. Two things the packer needed: the slot rule's height floor was `0.40` of the
plate on a sample size of ONE (the health channel is 43%) and rejected the meter's 38% for being exactly the
shallower bar it was asked to be — now `0.33`, still 30× the 1% decorative panel lines it exists to reject;
and the HUD's vertical budget had to start measuring the **drawn** height (`BAR_SCALE_Y`), because on packed
heights alone two plates read as 246 px of HUD and failed an assertion that in truth clears a jumping head
by 90 px.

**The meter's READY state is `render/meter-view.ts`, not a `frac >= 1` test in the draw call.** It is
Phaser-free so the boundary is unit-testable, and it exists because the HUD and the sim disagreed about the
same number (R-14 in [`sim-invariants.md`](sim-invariants.md#meter-and-super)). Two rules it encodes: an
UNREADY fill is compressed into the first 92% of the slot — a straight fraction drew 98/100 as 315 px of a
318 px bar, i.e. full — and the **`MAX`** label is the cue, because the gold fill on its own is a colour with
no legend. The label's visibility AND its string are read straight off the Text object in `snapshot()`, never
from a cached flag — an empty label is visible and unreadable.

**`ready` and `showMax` are deliberately different, and conflating them re-created the bug.** `ready` is the
sim's number (it defers to `meterFull()` in `sim/fighter.ts`, so there is ONE spelling of the comparison);
`showMax = ready && fillFrac >= 1` is the drawing instruction. They diverge because `Fighter.meter` survives
`reset()` while the entrance scales the drawn bar from zero, so a fighter carrying a full bar into round 2 is
ready with `fillFrac` at exactly 0 for 18 ticks — keying the cue off `ready` put **`MAX` over a visibly empty
meter** for ~300 ms at the top of every later round. Any HUD cue for a sim value has this shape: gate it on
what is DRAWN, not only on what is true.

**Phaser only builds mipmaps for POWER-OF-TWO textures**, so a heavy downscale of an NPOT texture is a raw
bilinear squeeze and reads as low-res. That is why the HUD faces are their own bake (`copy-portraits.py
--hud` → `ui/portraits/hud/<id>.png`, loaded as `hud-portrait-<id>`) rather than the 448×600 select card:
measure the ratio between a texture's size and its drawn size before concluding the source art is bad.

**The HUD entrance is derived from `match.introTicks`, not a tween or a wall clock**
(`render/hud-entrance.ts`, Phaser-free + unit-tested). That buys replay-per-round and the Enter-rematch for
free, since both go through `beginRound()`, and lets an e2e scrub the animation by writing one number. The
entrance scales the drawn WIDTH only — **colour tier and blink must key off real health**, or a full-health
fighter opens the round red and blinks through yellow into green. PlaygroundScene zeroes `introTicks` before
advancing, so it always renders the settled HUD.

## The super cut-in

Derived arithmetic, not a tween (`render/super-cutin.ts`, Phaser-free + unit-tested;
`render/cutin-view.ts` is the shared scene-side owner, used by BOTH MatchScene and PlaygroundScene because
the dummy is where you try the move). It reads `World.hitstop` counting down, so it advances under the e2e
pump and cannot outlive the freeze it belongs to. The art is the **Phase 06 select portrait** drawn near 1:1
— an UPSCALE, so the no-mipmaps-on-NPOT softness that forced the HUD's own portrait bake does not apply.

## Combo counter

**A combo counter must be a persistent per-defender tally**, reset when the defender leaves `hitstun` — not
a count of one drained batch. A 15-tick `advance` can carry several hits, and `hitId` restarts at 0 on every
attack, so neither is usable as an identity.

## Touch (Phase 18)

**Touch is ONE extra argument, not a second input route.** `InputReader.read(touchHeld?)` ORs the pad's held
flags into P1's **before** the existing `prev`/`now` comparison, so there is still exactly one implementation
of `*Pressed` and touch inherits the 1-frame rising edge instead of re-deriving it. The rules live in
Phaser-free [`../src/render/touch.ts`](../src/render/touch.ts);
[`../src/render/touch-view.ts`](../src/render/touch-view.ts) is the adapter.

Three things that are load-bearing:

- **"Touch" means `maxTouchPoints > 0` AND `matchMedia("(pointer: coarse)")`** — the PRIMARY pointer is a
  finger. Not `game.device.input.touch` (capability: a touchscreen laptop would lose local PvP and gain a pad
  it does not need), and **NOT `!any-pointer: fine`**, which is what shipped and what a real Samsung S23+ /
  Android 16 disproved on the first try: Android reports `any-pointer: fine` TRUE for stylus/DeX capability,
  so the entire phase switched itself off on the device it was built for — title read "PRESS ENTER", nothing
  tappable, no rotate gate. Every emulator agreed with the broken version. `any-pointer` asks "could a fine
  pointer exist"; `pointer` asks "what do you point with", which is the actual question. **Two seams exist
  for this and are NOT DEV-gated**, because device classification is the one decision here that cannot be
  reproduced from this machine: **`?touch=1` / `?touch=0`** forces the mode, and **`?diag=1`** prints what
  the device actually reports (`maxTouchPoints`, `pointer:coarse`, `any-pointer:*`, `hover:none`, viewport,
  dpr) on the title screen. Reach for `?diag=1` FIRST on any "it doesn't work on my phone" report — two fix
  attempts were burned guessing at hardware before it existed. Its mere presence also settles the
  stale-cache hypothesis: a build without it cannot draw it. **`touchMode()` is memoised**: Flow, Match and
  `main.ts` all ask, at different times, and three derivations are three chances to disagree. Threading it
  through `MatchConfig` does NOT work — `?scene=match` boots with no FlowScene.
- **`TouchPadState.consume()` is a queued press counter with a forced 1-frame release gap.** Phaser
  dispatches touch **synchronously from the DOM listener** (`InputManager.onTouchStart` calls
  `updateInputPlugins` directly — nothing waits for the game step), so a tap whose down+up land between two
  frames is invisible to a plain "is a finger on it" read and the attack never comes out; and a plain sticky
  bit still swallows the second of two fast taps, because `InputReader.prev` is already true. Do not
  "simplify" this back to a boolean.
- **Scene-level pointer events, not per-button `setInteractive()`** — a Game Object hit test would put the
  multi-touch and slide rules inside Phaser where vitest cannot reach them. Subscribe to `pointerupoutside`
  as well as `pointerup` (`InputPlugin.js:2064-2075` picks between them on `pointer.upElement ===
  game.canvas`, and a letterbox bar is outside the canvas ELEMENT), and hiding the pad must also DEACTIVATE
  it — invisible objects keep their scene-level listeners.

**The rotate overlay does NOT block Phaser input on its own.** `TouchManager.onTouchStartWindow`
(`TouchManager.js:280-287`) is registered on `window` and forwards any touch whose `target !== canvas`
straight into `InputManager` — so a tap on a DOM overlay still hits the menu underneath. `main.ts` sets
**`game.input.enabled = false`** while blocked; that is the actual gate, the `<div>` is the visible half.
And `applyOrientation()`'s first call rides **`Phaser.Core.Events.PRE_STEP`**, because `TimeStep.sleep()` is
`if (this.running)` and `loop.start()` runs after READY — called at boot it would set the class and never
pause. `screen.orientation.lock()` is deliberately NOT called (needs fullscreen on Android, unsupported on
iOS Safari); Phaser's `scale.lockOrientation()` is dead code — it calls the removed
`screen.lockOrientation` and always returns `false`.

## Audio (Phase 20)

Same split as everything else: the DECISION is Phaser-free in
[`../src/render/audio-cues.ts`](../src/render/audio-cues.ts) (which sim event becomes which cue, cooldowns,
priority, a 3-per-frame cap), and [`../src/render/audio-view.ts`](../src/render/audio-view.ts) `GameAudio`
is the **only thing in the project that touches `this.sound`**. It owns the mute button too, so a scene
wires one object: one `objects` array for the camera lists, one `layout(width)`, one `destroy()`.

Ten things are load-bearing:

- **`CueKey` is derived from the `CUE_KEYS` tuple**, never written twice — a TS union does not exist at
  runtime, so "a test proves the union and the file list agree" is unwritable.
- **`whiff` and `jump` come from `World.consumedInputs`, NOT from a state comparison.** A render frame can
  drain 15 sim ticks (`advance` clamps a stall to 0.25 s) and the brawler's light attack is exactly 15 ticks
  — so a slow frame starts it, runs it and returns to idle, and a state comparison sees idle→idle and plays
  nothing. `land` stays a transition because being grounded persists.
- **Movement cues are gated on `phase === "fight"`**, and the trackers keep updating outside it. That one
  predicate kills a phantom `land` at the top of round 2 (a fighter KO'd in the AIR leaves `grounded: false`
  behind), the `settleBodies` thud during the round-end pause, and any noise from the intro pose-set. Keying
  it off the `roundStart` EVENT does not work: that is pushed when the intro ENDS (`world.ts`), ~90 ticks
  after `resetRound()` actually moves the fighters.
- **`sound.mute` is a MECHANISM, not a source of truth — and so is `sound.volume`.** On WebAudio both
  setters schedule (`gain.setValueAtTime(v, 0)`) while both getters read the gain node back, so on a
  context that has not resumed the write is merely pending and the read returns the pre-scheduled value.
  Measured twice now: `sound.mute` read `false` right after being set `true`, and a bed created at 0.6 read
  back `1.0` whenever a spec beat the unlock. **Never assert on either getter** — `GameAudio` keeps
  `mutedFlag`, and the `__audio.bedVolume` seam reads `currentConfig.volume` instead. `GameAudio` keeps its own
  `mutedFlag`, with a module-level in-memory fallback *written before* the `localStorage` attempt, because
  storage throws in private-mode Safari and the setting has to survive one scene's `GameAudio` being
  destroyed and the next being built.
- **`destroy()` must `off()` the exact unlock handler and `manager.remove()` the bed.** The SoundManager is
  game-global: a deferred `once(UNLOCKED)` armed by FlowScene outlives it and would start the MENU bed on top
  of the match ambience, and `stop()` alone leaves the instance in `sound.sounds` to accumulate on every Esc
  → Flow → match round trip.
- **Cues play at `CUE_VOLUME` (0.5), which is a clipping fix.** A KO fires `hitHeavy` + `ko` + `roundEnd` on
  one frame; at full volume the shipped files sum to **+3.9 dBFS**. `check:audio` recomputes that worst case
  from the files and parses the volume out of `audio-view.ts` — do not re-copy the constant into the script,
  which is exactly the drift it caught once already.
- **Both beds run at 0.6, and 0.6 is a ceiling, not a preference.** They shipped at 0.35/0.4 and were
  inaudible on desktop and on a phone at normal volume. The binding constraint is the same worst-case KO
  stack: ambience at 0.6 measures **-1.15 dBFS** against `check:audio`'s -1.0 gate, and 0.65 lands on the
  ceiling exactly. Past that a KO clips, and no amount of wanting a louder bed changes it — the next lever
  is re-mastering the bed masters, not this constant. The gate PARSES the level out of the ternary in
  `beginBed`, so **that expression must stay literal and inline**; extracting it to a named constant makes
  `check:audio` exit rather than silently pass.
- **The `super` cue is the ONE cue with a retained handle**, because it is the one that has to be
  *stopped*. `sound.play(key)` returns a boolean and the instance is unreachable, so a 3.6 s sting rang out
  over a ~1.5 s special that had already been interrupted. `sound.stopByKey` is not the cheaper fix: `stop()`
  tears down the buffer source so `COMPLETE` never fires, `pendingRemove` stays false, and the manager never
  splices it — every cut would leak a dead Sound (measured in `qa20b-audio-deep.spec.ts`). The instance is
  built EAGERLY in the constructor so it sits inside every e2e baseline, and `destroy()` must `remove()` it
  like the bed. Impact cues stay untracked: they are meant to overlap.
- **"Was the super interrupted?" is answered by the SIM, not inferred from state.** `World.interruptedSpecials`
  (see [`sim-invariants.md`](sim-invariants.md#the-interrupted-special-signal)) is read straight through
  `MatchScene` into `CueDirector`. A render-side `special` → `hitstun` comparison cannot work: one frame can
  drain 15 ticks, so "the move ended and its owner was hit two ticks later" leaves the identical trail.
  The sim flag reports HITS only, so `CueDirector` also cuts on **`phase === "intro" || "matchEnd"`**: a
  round timeout, a mid-match `Enter` restart and a match-deciding timeout all end a super without routing
  through `applyHit`. `matchEnd` is not optional — non-fight phases stop advancing fighter timers, so a
  timeout freezes its owner in `special` permanently, and with only `intro` in the list the tail rings over
  the match-end menu until the player asks for a rematch. **`roundEnd` is deliberately excluded**, which is
  why this is a phase list and not `phase !== "fight"`: a super that scores the KO drives the phase to
  `roundEnd` while its owner is still mid-move, and the broader rule would silence the one sting the cue
  exists for. A non-final timeout therefore still rings through the round-end pause and is cut at the next
  `intro` — the pause is ~2 s against a 3.6 s sample, and `roundEnd` cannot be added without breaking the
  KO case.
- **A cut super is dropped from `want` BEFORE `admit`, never filtered out of its result.** `admit` stamps
  the cooldown for every cue it returns, so removing the cue afterwards spends its 800 ms gap on a sound
  nobody heard and silences the next real super. Same defect `admit` already documents for the per-frame
  cap, one layer up.

## Phaser 4 timing

**TWEENS run on the wall clock, `Time.Clock` runs on the delta.** `TweenManager.getDelta()` reads
`Date.now()`, so a tween does **not** advance under the e2e's pumped `game.step` — anything sequenced off a
tween's `onComplete` is both untestable and one interrupted tween away from deadlock. Hang game logic on
`this.time.delayedCall`; keep tweens decorative. Corollary: **`killTweensOf(target)` kills EVERY tween on
that target** — an entry fade and a selection scale sharing one target means killing the second freezes the
first, which is how Phase 11's cards ended up permanently at alpha 0. Track and stop the specific tween, and
have a fade force-settle its end value on `onStop` as well as `onComplete`.
