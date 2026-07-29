# Lessons: measure the claim against the thing it claims about

Worked cases behind the rules in [`CLAUDE.md`](../CLAUDE.md)'s section of the same name. Each of these
shipped for one or more phases and was invisible to the whole test suite, because the tests only ever
compared code to other code. Read this before touching hit/hurt boxes, animation timing, or an art
prompt. Narrative of what shipped when is in [`history.md`](history.md).

**The shape is not confined to art.** Phase 16's R-13 is the same bug in the sim: the 60s timeout
compared ABSOLUTE health between fighters who do not share a pool, so two fighters who never touched
each other ended 2-0 to the brawler with both bars visibly full. 299 unit and 72 browser tests passed,
because every one of them set both healths from the same implied pool — the asymmetry only exists
BETWEEN different fighters and nothing had ever timed out a mismatched pair. **The HUD had been right
the whole time** (it always drew fractions); the sim disagreed with the thing on screen. Only playing
it found that. Generalises: **any cross-fighter comparison of an ABSOLUTE stat is suspect** while
`maxHealth`, `scale` and the pushboxes all differ per fighter — it is the same error as comparing raw
hit-box reach instead of effective reach (see Balance), and a test written from one fighter's numbers
cannot see it.

- **A box is a claim about a sprite.** The ground heavy had a crouching hurt box and a shin-height hit box
  on top of a standing punch. One-liner that catches the class: read the sheet's alpha, take the topmost
  opaque row per frame, compare to `hurt.h`. `scripts/` still has no gate for box-vs-art agreement.
  **It happened again in Phase 15**, one phase after this was written: the jiujitsu's `special` is a
  spinning FLOOR SWEEP and shipped with `hit.y 75 h 85` + `body:"stand"` — a chest-height box, so a
  STANDING guard stopped it and a crouching one ate all five hits. Inverted, not merely off. Measure the
  strike, don't eyeball it: difference each frame against frame 0 and take the y band of the
  furthest-forward moved pixels (that put the leg at 22–99px above the feet, and the box at `y 12 h 50`).
  **`registry.test.ts` now sweeps every special × every defender × three spacings** for which stance
  turns damage into chip — the same shape as the normals' blocking matrix, which had no special row.
  **`scripts/audit-boxes.py` (`npm run audit:boxes`) finally closes the measurement gap**: hurt height
  vs the figure, hit band vs the measured strike, for all 21 attack sheets. Advisory (exit 0) like
  `audit:anim`. It found **4 more on its first run** — `jiujitsu/airLight`+`airHeavy` and
  `monk/crouchLight`+`crouchHeavy`, all carrying boxes entirely BELOW where their art struck — and
  none could be fixed by moving the box: crouch normals are *defined* as lows (they must clear
  `guardStand`'s 70 floor), so the ART had to come down. All four regenerated; the audit now reports
  "every attack box agrees with its own sheet". Hard enforcement stays in `registry.test.ts`; this
  stays advisory so a regression reads as a report rather than a bypassed red gate.

**CLOSED in Phase 16, and the way it closed is the reusable part.** `monk/crouchHeavy` sat at ~87px of
visible air (tolerance 60) with **zero** box-trim budget — `reach-parity.test.ts` requires the monk to
be tied-best and he already was, so every px had to come from art. Five generations had measured limb
reach 50 / 61 / 57 / 55 / 60px (sd ≈ 4.6) against an 82px target: **run-to-run variance was larger than
the effect every prompt edit was chasing**, which is the tell that the prompt is not the variable.
It went in ONE generation once the start image changed. The prompt asks the leg to sweep *"past where
his own toes are"* — and the shared `crouch-refs/monk-crouch.png` plants him low and **tucked**, toes
under his hips, so the target the prompt names was parked under his own body. A purpose-built
`crouch-refs/monk-crouchHeavy.png` (nano_banana_pro from `monk-crouch.png`, ONE thing changed: the lead
leg stretched along the floor) measured **identical height 1558px, identical rear extent, forward
extent 512 → 820px** against its parent, and took the sheet to limb 89px / air 53px while KEEPING the
measurable contact frame. Two things worth stealing: **measure a new reference against the one it
replaces before spending a video credit on it** (height held = the crouch hurt profile still agrees),
and **check where the figure sits on the canvas** — the generated foot landed 4px from the right edge,
leaving the sweep nowhere to travel, so it was shifted 260px left with the area preserved to the pixel.
Do NOT rescale to fix that: `build-sprites` applies one idle-derived scale to every sheet, so a smaller
figure in one state's frames ships a smaller fighter on that state alone.
- **The model lands a strike HIGHER than you ask — aim a joint lower.** The vertical form of Phase 04's
  "inflates any requested band". `monk/crouchLight` asked for KNEE height and measured 61–127px against
  an 18–58 box; asking for the SHIN got the knee (55–126, in the box). Naming the *move* never does it
  — `crouchHeavy`'s prompt said "low sweeping attack" for two phases and he punched at chest height.
  Name the height, then name it one joint lower than you want.
  When body and art disagree on a state whose frames are mostly crouched, prefer the CROUCH profile: a
  hurt box larger than the art means you get hit by things that visually miss, one smaller means attacks
  pass through you, and the second is the worse failure.
- **An ANIMATION is a claim about a move — measure its length against that move.** Attack anims used an
  authored per-state `fps` that had drifted: every fighter's `attackLight` had 0.43s of art over a
  0.25–0.27s move, so playback was cut at ~60% and **the strike was never drawn** ("the light attack does
  nothing"), while `crouchHeavy` finished early and froze ("runs too quickly"). Frame rates are now
  DERIVED (`fps = renderFrames * TICK_HZ / simTicks`) in the Phaser-free `src/render/anim-timing.ts`.
- **…and measure its PHASE too, not just its length.** Even at the right length the strike landed on a
  wind-up pose on 10 of 18 sheets, because nothing aligned the *contact frame* with the *active window*.
  `render.sheets.<state>.hit` (measured by `check-attack-sync.py`) plus `attackFrameDurations` now spend
  the `startup` ticks on frames `0..hit-1` and the rest on `hit..n-1`. Three traps: (1) **the obvious
  metric is the wrong one** — furthest opaque column measures the whole silhouette, and for a
  wide-stanced fighter the widest thing in frame is a planted leg; difference each frame against frame 0
  to isolate what MOVED. (2) A sheet the metric can't call reports **INDETERMINATE and keeps uniform
  timing** — never a guessed number. (3) **`PLAY_LAG_TICKS`**: `play()` runs in the render pass AFTER the
  tick that entered the state, so the animation clock is one tick behind the sim — budget the wind-up
  `startup - 1` ticks or the contact frame lands on the LAST active tick. Invisible to perfect arithmetic;
  only showed up by tracing `stateFrame` against `anims.currentFrame` on the running game.
- **…and when you fix a defect class, sweep the WHOLE class.** The derivation above was applied to attacks
  and stopped there; every other sheet kept a flat authored `fps: 8` for two more phases. `knockdown` got
  750ms of art for a 300ms state, cut at frame 2 of 6 — **and the fall is frames 3–5**, so a fighter stood
  bolt upright through his entire knockdown. `attackFrameRate` is now **`stateFrameRate`** and also covers
  jumps (arc = `jumpVelocity / gravity`, constant per fighter, bakeable at registration); stun length is
  chosen by the attack that *caused* it and is only known once the state is entered, so **`stunFrameRate`**
  supplies it as a play-time override. That override **disables Phaser's per-frame durations** —
  `Animation.getNextTick` only honours them while `state.frameRate === currentAnim.frameRate`
  ([Animation.js:518](../node_modules/phaser/src/animations/Animation.js#L518)) — which is safe only because
  attacks are the sole carriers of durations and `stunFrameRate` returns `null` for every attack state.
  The unit test proves the arithmetic; the **browser** test is the one that matters, because the
  arithmetic was already right and what could still fail is the override reaching Phaser's clock.
- **…and an ATTACK animation is a claim about REACHING the other fighter — every metric here is
  direction-blind.** Phase 15's brawler super measured beautifully (silhouette height alternating
  `100/115/115/100/…`, no dead pairs, motion floor cleared) and was still wrong: the uppercut travelled
  purely VERTICALLY, up beside his own head, while the hit box reaches 145px forward — so nothing on
  screen ever crossed the gap ("he is not moving the hands through the enemy"). `check:sprites`' motion
  floor, `audit:anim`'s per-pair change and silhouette height all score a big vertical swing exactly as
  well as a big horizontal one, **and the vertical one is the one that misses**. Same blindness passed
  the frame where the fighter had fallen flat on his back — a body on the floor is a large silhouette
  change, which is what the metric rewards. Fix in the prompt by naming the TARGET ("at an opponent
  standing just in front of him to the RIGHT … reaching well past where his own toes are"); the tell
  that it worked is the minimum adjacent change (0.01 → 0.36) and heights going FLAT, not taller.
- **…and an animation that spans its state exactly can still be too fast to SEE.** Deriving the rate
  from the sim fixed length and phase and left a third defect untouched: `brawler/attackLight` spent
  its three wind-up frames on ONE tick each — 16.7ms, a single refresh at 60Hz — while measuring a
  perfect 1.00 art/sim ratio. Phase alignment fixes the wind-up budget at `startup - 1` ticks, so a
  pose cannot be given more time without delaying the contact frame; the only honest lever is to draw
  FEWER poses. `attackStartFrame`/`stunStartFrame` skip what the window cannot afford, at **two**
  floors: 2 ticks for attack wind-ups (anticipation the player reads — only rescue the sub-perceptual)
  and 3 for stuns (a pose you are PUT INTO — the lead-in is dead weight, so `blockstun` snaps to the
  brace and `knockdown` reaches its fall sooner). One floor of 3 everywhere collapsed two perfectly
  readable 2-pose wind-ups to a single held pose.
- **The audit's own length column was 1.00 BY CONSTRUCTION.** `audit-animations.py` set
  `art = sim` for every derived state, so the ratio compared the formula with itself — code checked
  against code, inside the tool built to stop exactly that. It now reports the poses actually DRAWN
  and the ticks each gets. Whenever a metric cannot fail, it is decoration: check what would make it
  go red before trusting it.
- **A held LOOPING state needs its own motion floor.** `MOTION_MIN` is applied only to ATTACK states,
  so `blockCrouch` was never measured at all — which is why two sheets shipped at amp 0.05/0.06
  reading as frozen stills with every gate green. `HELD-FROZEN` (floor 0.10) closes it.
- **The forgotten prompt variable is the SAMPLING RATE, and it is not the same problem as amplitude.**
  ffmpeg takes N frames evenly across the 4s clip, so a correct motion occupying a sliver of each swing
  lands 6 of 8 samples mid-return and reads as *standing still*. Ask the model to **HOLD** at full
  extension (or name the cycle COUNT for a cyclic state) — describing the motion harder does nothing.

Related: **a held state must not loop if any frame leaves the pose** — a looping `crouch` sheet whose
first frames are the standing wind-up reads as the fighter popping up out of the crouch. The inverse
also holds: `blockCrouch` **does** loop (`render.sheets.blockCrouch.loop:true`, Phase 13b) precisely
because EVERY frame stays in the low guard, so it keeps the guard alive while held without ever
popping up. `block` (high) stays a one-shot hold. Render loop is the Phaser `repeat` from
`render.sheets.<state>.loop`; the builder's sim `StateSpec.loop` is independent and only clamps the
sim `stateFrame` (irrelevant for a guard whose frames all carry the same box).
**The BOB those sheets were generated with is gone** — Phase 13b asked for a bounce so a held guard
would not read as a frozen still, and playing it, the bounce is what read wrong: jiujitsu measured 9px
of vertical spread across four frames and the monk 17px (9% of his standing height), i.e. a fighter
jumping on the spot. It was never load-bearing — **a LOOP of near-identical held frames already is a
steady guard**, which is what the bob was reaching for. Both prompts now hold and breathe ("the top of
his head stays at very nearly the same height in every single frame"), like the high `block` prompts
that always worked: jiujitsu 9→3px, monk 17→2px. Do not reintroduce a bob count.
Also: **`guard-refs/monk-blockCrouch.png` is a STANDING pose** and is no longer used — it is why his
low block measured 86–96% of his standing height. `--start-image` dominates the prompt, so a bad
reference cannot be argued out of the model; `monk/blockCrouch` starts from `crouch-refs/monk-crouch.png`
(his other crouch states' deep squat, which already holds a guard) and now measures 85% against his own
`crouch` at 84%.

- **…and every one of those metrics was VERTICAL. Nothing measured whether the box reaches as far
  FORWARD as the fist does.** Measured across all 21 attack sheets, every box far edge overshot its own
  drawn limb by 28–106px, and at the furthest range each attack still connected the fist sat 14–92px
  short of the defender's drawn body — a whole unmeasured defect class, sitting next to two gates that
  both passed. `audit:boxes` now carries metric C (limb reach, box far edge, and the visible air at
  max connect range against a 60px tolerance). Note the number that matters is the VISIBLE gap, not
  the raw overshoot: a hit box legitimately has to reach the defender's hurt box, not his skin.
- **Closing that gap is a BALANCE decision, not a repair.** Setting every `hit.w` to match its art
  gives the monk the worst effective reach on every attack — his art reaches least far forward — so
  `reach-parity.test.ts` goes red and "the monk's moves don't reach" comes straight back. Trim only as
  far as the existing parity rule still passes UNCHANGED, and let art close the rest. And measure
  effective reach with the pushbox the attack's own `body` selects: an AIR normal is `body:"air"` and
  uses `pushStand`, and guessing crouch-vs-stand from the attack's NAME is what hid the monk being
  out-ranged on both air normals (80 vs 82, 105 vs 107) for the whole life of that test.

**Art generation: the REFERENCE is the lever, not the wording — and prefer the prompt that measured
best over the one that reads best.** Both re-learned at credit cost. `monk/blockCrouch` was 95%
identical to his own `crouch` because its start image *was* the crouch reference; a prompt rewrite
naming the arm change explicitly moved IoU 0.95 → 0.95 and amp 0.049 → 0.049, changing nothing at all.
Building a purpose-made low-guard reference first fixed it in one generation. Then, on motion: four
attempts measured 0.049/0.049/0.055/0.029, and copying the *jiujitsu sheet's motion sentence verbatim*
gave 0.150 — while the rewrite invented for the monk's deep squat (hip-rocking instead of a weight
shift, which seemed better suited to a pose with both heels planted) was the worst of the four. Same
for `monk/crouchHeavy`: a prompt that self-contradicts (`SPAN_CLIP`'s "never hold still" plus "HOLDS at
full extension") measured 61px reach / 15px spread, and replacing it with a clean explicit timeline
measured 57/7. **Change ONE clause at a time and measure; run-to-run variance is real** (five samples
of the same sheet: 50/61/57/55/60px, sd ≈ 4.6), so a single better sample is not a better prompt.

Same rule for art: prefer a measurement to an opinion, and a wrong metric is more dangerous than no
metric. Detail in [`docs/art-pipeline.md`](art-pipeline.md).

## An emulator is code checked against code (Phase 18)

The newest case, and the one that generalises furthest from art. Phase 18 classified a touch device as
`maxTouchPoints > 0 && !matchMedia("(any-pointer: fine)")`. It shipped, and on a real Samsung S23+ the
whole phase switched itself off: the title read `PRESS ENTER`, nothing was tappable, portrait never
raised the rotate gate. **Android reports `any-pointer: fine` TRUE** — it advertises stylus/DeX pointer
capability whether or not one is attached. The right question is `pointer: coarse`: *what do you point
with*, not *could a fine pointer exist anywhere on this machine*.

What makes it belong in this file is not the wrong media query, it is **why nothing went red**. Pixel 5
and iPhone 13 emulation both report `any-pointer: fine` as false — under Playwright, and under an
independent QA pass whose brief was specifically to hunt for assertions that pass for the wrong reason.
It found none, because there were none to find. The predicate was not under-tested; it was
**untestable from here**. A device profile is a claim about hardware, and an emulator asked to check it
answers with the same assumption the code was written from — exactly like a box measured against
another number instead of against the sprite.

**And the fix for that class is an instrument, not another guess.** The corrected predicate deployed
and the phone still said `PRESS ENTER`, leaving two indistinguishable hypotheses (wrong predicate, or a
cached bundle). The third attempt stopped fixing and added `?diag=1`, which prints what the device
itself reports onto the title screen — and whose mere *presence* separates a stale bundle from a wrong
test, because a build without that function cannot draw the line. That is the attempt that landed.

- **When the thing you cannot measure is hardware, ship a way to ask it.** Two deploys were spent
  guessing; one diagnostic ended it. `?touch=1` and `?diag=1` are deliberately the only seams in this
  repo that are not DEV-gated, for that reason.
- **A green suite over an emulated profile is evidence about the emulator.** Say so in the assertion:
  `mobile-touch.spec.ts` now asserts the emulator reports `any-pointer: fine === false` *with a comment
  explaining that this is precisely why emulation could not settle the question* — so the next reader
  cannot re-derive the broken discriminator from a passing test.
