# Project history

What shipped, in order. Per-phase detail is in [`docs/phases/`](phases/) (`NN-*.md` spec +
`NN-*-log.md` gate results); this file is the connective narrative, plus the **passes** that happened
between phases and therefore have no phase log of their own.

`CLAUDE.md` deliberately does not carry this — it's history, not guidance.

## Phases

- **00 baseline** (2026-07-15) — repo verified, tests green, source video + `prompts.txt` captured.
- **01 architecture** (2026-07-16) — doc-only; [`docs/architecture.md`](architecture.md) established the
  pure-sim / render-adapter boundary that everything since follows.
- **02 asset pipeline** (2026-07-16) — placeholder sprite replaces the debug box; Playwright E2E harness
  born (the `__game.step` pump + `__holdP1` seam).
- **03 concept mockups** (2026-07-16) — four SNES-style mockups in `concepts/mockups/2026-07-16/`;
  **rooftop-dusk locked** as the art direction and the roster cut to **brawler / jiujitsu / monk** (the
  recipe's green boxer and subway stage were dropped). Those three ids are canonical all the way to
  `public/sprites/<id>/`.
- **04 parallax backgrounds** (2026-07-17) — 8 layers × 2 stages (twilight/sunset) at 21:9 in
  `concepts/backgrounds/`, chroma-keyed by `scripts/key-layers.py`.
- **05 character references** (2026-07-17) — the three fighters pulled out of the dense mockups into
  isolated refs in `concepts/characters/`.
- **06 select portraits** (2026-07-17) — 1792×2400 busts on a **baked** backdrop, so unlike every other
  art phase there is no void and nothing to key. That geometry is the contract Phases 07/11/14/15 build
  against. First zero-rejection art phase (6 credits).
- **07 UI + prop atlases** (2026-07-17) — `public/ui/hud-atlas.png` and `public/props/twilight-atlas.png`
  (16 animated prop frames) via `scripts/build-atlases.py`; the shared provenance gate extracted into
  `scripts/art_gate.py`.
- **08 scrolling stage** (2026-07-18) — a world wider than the viewport (`STAGE_WIDTH=1696` vs
  `VIEW_WIDTH=1280`), per-layer parallax, a midpoint follow-camera, animated props, two
  config-selectable variants in `public/configs/stages.json`, and the dev `StagePreviewScene`. Camera
  zoom was deferred to Phase 12.
- **09 fighter registry + Gym** (2026-07-18) — fighters became data-driven: three entries in
  `public/configs/character-gym.json` (each `{ render, data }`), the pure `assembleCharacter`, the shared
  `validate-character` gating both BootScene and the dev Gym write-back, and BOTH fighters animating from
  real per-state sprites. The Character Gym (`?scene=gym`) landed with it.
- **10 fighter playground** (2026-07-19) — dev-only `?scene=playground`: controllable fighter + inert
  dummy, live per-character stat tuning saved back to `character-gym.json`, the keyboard focus guard, and
  `stats.scale` finally wired to both art and boxes.
- **11 menus, modes, versus CPU** (2026-07-19) — the game boots into `FlowScene` (title → mode → stage →
  character select) handing `MatchScene` a `MatchConfig`; `1v1` or `1vCPU` at three difficulties; the
  pure seeded `CpuController`; portraits baked to `public/ui/portraits/`.
- **12 core combat + camera integration** (2026-07-22) — zoom-in-only group camera plus a second
  non-zooming camera for the HUD; z-order follows the most recent MOVER; attack animations phase-aligned
  to the sim's active window via a measured contact frame; selectable REMATCH / MAIN MENU at match end.
  Also raised `STAGE_MARGIN` 90→116 (a cornered KO was cropped) and un-clipped the control legend (it
  measured 1535px in a 1280 viewport).
- **13 guard box migration** (2026-07-23) — guard moved from two character-level arrays into
  `FrameBoxes` as a per-frame `guardStand`/`guardCrouch` pair; `CharacterConfig`'s copies are gone and
  `Fighter.guarding` is derived from the box data instead of a duplicated state list. Per-frame guard
  overrides — authored and stored since Phase 09 but consumed by nothing — are now honoured by the
  builder and validated. The Gym can edit guard boxes, which write the stance template. Deliberately
  **not** taken: block-high/low art, so the 16 states are unchanged. Shipped numbers untouched: every
  frame of a guardable state is seeded from the same template, which is what made it a no-op.
- **13b block animation art** (2026-07-24) — took the art Phase 13 skipped: two dedicated held-guard
  states `block` (high) and `blockCrouch` (low), with real Seedance clips for all three fighters
  (states 16→18). The FSM guard branch now plants a guarding fighter in these states, and the
  `GUARDABLE` set was *swapped* to `{block, blockCrouch, blockstun}` — idle/walk/crouch dropped out
  because a fighter is never guarding while in them (no shipped guard override rode those states, so
  nothing was lost). `block`/`blockCrouch` also joined `ACTIONABLE`, not for jab-out (the attack edge
  is read before the guard branch) but to keep `cpu.ts`'s reaction timer running through a guard
  episode. Held one-shots (`loop:false`) needed no new render code. The Phase-13 per-frame live-guard
  proof was rebuilt around `blockCrouch`'s deterministic clamped contact frame, since the looping
  2-slot `crouch` it used to rely on is no longer guardable. A follow-up pass then regenerated all six
  block sheets to open ALREADY braced (frame 0 = the held guard, started from each fighter's own guard
  frame), so re-entering guard after a blockstun no longer replays a raise-guard wind-up; brawler's
  blockCrouch drifted upward on regen and was pinned to a static crouched-guard hold.

- **14 HUD skin** (2026-07-25) — the Phase 07 UI atlas finally reaches the screen: `BootScene` had
  never loaded `hud-atlas` at all, and the HUD was still the vector rectangles from Phase 02. Now two
  `health-bar` plates with the coloured fill drawn *behind* them (so it shows through the art's own
  transparent slot), two `portrait-base` plates with each fighter's Phase 06 portrait cover-cropped
  into the arch, and a match-start entrance — the band slides down over 900 ms while the bars charge
  over 900 ms, 1.2 s total inside the 1.5 s intro, deliberately slow because "too rapid" was the
  source prompt's one complaint. The entrance is derived from `match.introTicks`
  (`render/hud-entrance.ts`, Phaser-free, unit-tested) rather than a tween, so it replays every round
  and on the rematch with zero render state. `hud.ts` authors only `BAR_SCALE`/`PORTRAIT_SCALE` and
  three offsets; the bar's height and its fill slot come off the atlas frames. Three rounds of playing
  it then reshaped the band: the bar is drawn **non-uniformly** (0.86 × 0.5 — its 40 px of bezel is
  frame art, not padding, so a thin-and-wide bar has no uniform-scale answer), the timer moved under
  the bars, and `copy-portraits.py` grew the **`--hud` bake** its Phase 06 docstring anticipated —
  the select card into a ~96×147 slot is a 4.7× bilinear squeeze with no mipmaps (Phaser only mipmaps
  power-of-two textures), which is what "the portraits look low res" measurably was. Deliberately
  **not** taken: art for the timer or the win pips (still text). Also corrected four stale documented
  figures (two in `asset-manifest.md`, two in the Phase 07 log) that described an abandoned first
  design, and put the preload atlases behind Boot's own missing-texture guard.

### Phase 15 — Specials, Meter & Multi-Hit Combos (2026-07-25)

The spec named its own blocker: `Fighter.hasHit` was one boolean that ended an attack's ability to
connect after the first hit, so a special could never land more than once. It is now **per hit
WINDOW**: the builder stamps a `hitId` on every hit-bearing frame, `Fighter.lastHitId` refuses a window
that already connected, and `AttackData.repeat = {count, gap}` lays the active window down `count`
times. A normal has one window and still lands exactly once — the original single-connect test is
unmodified and was the guard rail for the swap. On top of that: a meter earned by **playing well**
(landing a clean hit pays the attacker in full; a successful *block* pays the blocker half of what the
attack would have dealt him; being hit pays nothing) that carries between rounds and is spent whole on
a grounded-only special; a **super freeze** riding the existing
hitstop channel, folded in *after* the round-over check so a fighter KO'd on the tick they started a
special gets neither the freeze nor the flourish; and the Phase 06 select portrait sweeping in over it,
derived from the freeze countdown rather than a tween (`render/super-cutin.ts`, Phaser-free and unit
tested) and shared by MatchScene *and* the Playground, because the dummy is where you try the move. The
Playground gained **regen hp** and **fill meter** toggles, applied before `advance` — after is too late,
since health reaching 0 sets `ko` and ends the round inside that same advance.

Codex rejected the first plan with six findings. The one that would have shipped as a real bug: window
ids restart at 0 for every attack, so a normal that had just connected left a stale `lastHitId = 0` and
silently swallowed the special's first window. Fixed structurally — `startAttack(state)` is now the one
door into every attack state, since it is also the only place `lastHitId` is cleared — and verified by
deleting the reset and watching the pinning test drop from 5 hits to 4 while everything else stayed
green. Also caught: `toSpec()` copies fields explicitly, so `freeze` would have vanished without a
sound.

Then the game was played, and everything the tests could not see turned up at once. **The meter was
invisible** — positioned below the health bar's fill *slot* rather than below the *plate*, drawing
correctly every frame underneath an opaque bezel, with the browser test happily asserting a real
width. **The meter economy was wrong** as originally specced: crediting the defender for damage taken
meant a cornered player watched his own super charge as a consolation prize, so it now pays for landing
a hit or blocking one and nothing for being beaten up. **The Playground kept confiscating the bar** —
it must `world.restart()` after a KO, and that zeroes the meter, which made a super you have to farm
for effectively untestable. And **the jiujitsu's spinning floor sweep shipped as a HIGH**: a
chest-height hit box on top of a leg scything along the ground, so you blocked it by standing up. The
ground-heavy defect exactly, one phase after it was written down.

The art took **8 Seedance clips for 3 sheets (~98 credits)**, and every failure had a different cause:
a `set -u` lookup bug that aborted all three instantly; a prompt whose word "spinning" put the brawler
flat on his back; a monk prompt that named the *move* but never the arm travel; sampling that caught 6
of 8 frames mid-return; and finally **direction** — a perfectly-measuring uppercut that travelled
straight up beside his own ear and never crossed the gap to the opponent. Worth keeping: every metric
in the pipeline is direction-blind, and the motion gate passed the frame where the fighter was lying
down.

A follow-up pass closed the two things the phase left open. The meter got its own Phase 07 atlas
plate, which cost two packer fixes that were both artefacts of the gate having only ever seen one
bar: a slot-height floor set from a single sample rejected the meter for being the shallower plate it
was asked to be, and a vertical budget that summed PACKED heights failed art that in fact clears a
jumping head by 90px (the HUD draws both plates at half height). And `scripts/audit-boxes.py`
finally measures boxes against the sprites they describe -- hurt height against the figure, hit band
against the strike, differenced against frame 0 so a planted leg is not mistaken for a fist. It ships
ADVISORY because four shipped sheets flag: the monk's crouch normals punch at chest height while the
sim sweeps at the knee, and since crouch normals are defined as lows, that one is an art pass rather
than a number change.

## Passes between phases

### Gameplay resolution pass (2026-07-18)

Freed the fighters' feet; dropped the front `near` layer (the "residual purple" was measured to be real
dusk palette, 0 magenta spill); made block a **dedicated key** (P1 `Q` / P2 `/`, plant-on-block); added
**air + crouch attacks** (fighter states 12→16); generated real Seedance sprites for the new and
idle-derived states across all three fighters. The held/one-shot states (crouch, jumpRise, jumpFall,
knockdown, ko) got real per-state motion here — they no longer start from the standing idle. Codex
reviewed both the plan and the diff.

### Crouch/block fix pass (2026-07-19)

Three complaints, three unrelated root causes: crouch pop-up was a **looping** sheet whose first frames
are the standing wind-up (held states must not loop); block failed only at contact range because the
guard boxes were a thin forward slab; crouch attacks flaked because `EdgeLatch` buffered the edge but not
the stance (`downAtPress`).

### CPU difficulty + heavy hitbox pass (2026-07-20)

The CPU was unbeatable even on easy, so it gained a `reactionTicks` window and a `DAMAGE_SCALE` handicap.
The **ground heavy stopped being a low** once its boxes were measured against its own sprite — it is a
standing punch, not a sweep. `Esc` started working in every phase, with a mid-match confirm.

### Input-buffer / props / menu / off-screen pass (2026-07-21)

**Attacks were silently dropped** when pressed during your own move — the render latch cleared on any
fight tick, but `World.tick()` returns "a fight tick ran `think`", NOT "the edge was consumed"; fixed
with per-edge consumption tracking. The reported **"monk can't do moves" was the FOCUS GUARD, not the
monk** — picking a fighter from the Playground dropdown left the `<select>` focused so the keyboard
stayed disabled. **Off-screen fighters** fixed by a sim-side `MAX_SEPARATION=1040` cap (camera zoom was
rejected — the stage art is exactly viewport-height, so uniform zoom bands the top/bottom). Also: a DEV
Playground button on the FlowScene title, and the background props shrunk via a new `PropConfig.scale`.
Attack animation timing was derived from sim duration here, fixing "the light attack does nothing".

### Security pass (2026-07-22, `0713c76`)

`npm audit` 5→0 via vite 5.4.21→7.3.6 and vitest 2→4; `/__gym/save` now requires a full-origin match;
new `vercel.json` CSP. The 17% bundle shrink is Vite 7's raised browser target, not lost code.

### Animation audit pass (2026-07-23)

A roster-wide audit (`npm run audit:anim`) found the stun/jump timing bug — `knockdown` had 750ms of art
for a 300ms state, so **the fall never drew** and a fighter stood bolt upright through his entire
knockdown. The Phase 12 fix for *attacks* had never been swept across the other 15 sheets. Ten
barely-moving sheets were regenerated in the same pass; see the sampling-rate section of
[`docs/art-pipeline.md`](art-pipeline.md) for why they came out frozen.

### Block art + in-game polish pass (2026-07-25)

After Phase 13b shipped the block art, three issues showed up only in the running game (no test caught
them): (1) a guarding fighter turned **blue** — a leftover steady guard tint from before block had its
own pose; removed, the pose is the cue now. (2) **green key debris** floating around jiujitsu's
crouch-block — its generated background was noisy and left fragments the 0.5% speck floor kept;
`build-sprites` now keeps only the largest component for the always-connected guard states
(`SOLID_BLOB_STATES`). (3) crouch-block **looked frozen / like standing** — the real cause was
`blockCrouch` being `loop:false` (it played once and froze) compounded by regens that drifted up out of
the crouch. Fixed by making `blockCrouch` **loop** a contained crouch bob (every frame stays low, so
looping never pops up), with monk's real cyclic bob, a synthetic breathing bob for jiujitsu (the
generator would not give a contained crouch bounce), and brawler's subtle motion. The block-art work
cost ~168 credits across the initial gen and the polish regens.

### Animation / box defect pass (2026-07-26)

Four more defects found by PLAYING with 276 unit + 65 e2e tests green. Full write-up in
[`docs/phases/16-animation-box-defect-pass.md`](phases/16-animation-box-defect-pass.md).

The crouch-block fix above **overshot**: removing the bob to stop it reading as "jumping on the spot"
left monk at amp 0.05 and jiujitsu at 0.06 — frozen stills. Worse, the monk had no low guard at all
(IoU 0.95 against his own `crouch`), because the reference chosen to fix his height *was* the crouch
reference. A prompt rewrite naming the arm change changed literally nothing (0.95 → 0.95); building a
purpose-made low-guard reference fixed it in one gen. Then copying the jiujitsu motion sentence
verbatim took the monk from 0.029 to 0.150 — while every rewrite invented for his deep squat measured
worse. Five samples of `monk/crouchHeavy` measured 50/61/57/55/60px reach (sd ≈ 4.6), so run-to-run
variance was swamping the prompt changes; that sheet stays open at ~87px of air, but gained a
measurable contact frame for the first time. ~11 generations.

"All animations play too fast" turned out to be neither arithmetic nor the override — both traced
correct in the browser — but the frame BUDGET: three wind-up poses sharing three ticks, one refresh
each. Fixed by drawing fewer poses rather than flashing them all. Two genuine bugs surfaced alongside:
a combo's 2nd+ hit never restarted the hurt animation (the state name doesn't change, so `play()` was
never called), and a review's claim that `knockdown` loses a tick was re-derived and found **correct
but harmless** — the state also lasts exactly that long.

Every attack box was measured against its own art horizontally for the first time and **all 21
overshot**, by 28–106px. Five of the six over-tolerance sheets closed with `hit.w` trims that keep the
parity rule passing unchanged; the parity test itself was extended to the air normals, where the monk
had been quietly out-ranged (80 vs 82) for its whole life. Three gaps in the audit tooling were closed
too — including an `art/sim` ratio that was 1.00 **by construction** and could never fail.

## Phase 16 — integration, parity & QA

The gate that checks whether the whole thing hangs together, and it mostly did — the interesting part
was **what nothing was measuring.**

The third fighter had been finished since Phase 05 and hidden by one line. `SELECTABLE =
["brawler","jiujitsu"]` in `FlowScene`, with a comment naming Phase 16 as its owner; the monk's art,
portraits, HUD face and registry entry were all shipped and loaded, and two unit tests already swept
all three. Moving the list into the Phaser-free module and **cross-checking it against the registry**
turns "a fighter exists but nobody can pick him" from a silent omission into a red test.

Restoring him then exposed a rule that had been wrong for five phases without ever being wrong *yet*:
`cpuPick` was `wrap(taken + 1)`, always the card to the player's right. At two cards that is the only
legal answer, so it looked correct — at three it meant the CPU could never field the monk. Now a
uniform draw with the sample injected by the caller, so `flow-state.ts` stays pure and an e2e can pin
an exact opponent instead of flipping a coin.

Two shipped tests were passing **for the wrong reason**, neither of them red. One asserted "no
same-character pick" on the premise "P1 has nowhere to move" — false once a third card exists, and it
kept passing by coincidence while testing the opposite of its name. The other compared two CPU runs on
the premise "same fighters", but entered one through the select screen and direct-booted the other, so
a randomised pick would have silently compared two different fighters. Codex's diff review of the plan
caught the second; the plan had missed it.

`best-of-3` and the 60-second timer had **no browser coverage at all** — both existing specs reached
the end state by assigning `world.match.phase`, which skips the rule under test. The new spec plays two
real KOs and asserts the phase sequence it *observed*, and runs the full 3600-tick clock out for real
(a throughput probe put that at 0.8s, so the accelerated version the plan had budgeted for was
unnecessary). Both were watched failing against genuine product breaks — `ROUNDS_TO_WIN` set to 1, and
the clock decrement deleted.

And `monk/crouchHeavy`, the one item the animation pass left open, closed **in a single generation**
once the lever was the right one. Five earlier attempts had measured 50/61/57/55/60px of reach against
an 82px target, i.e. run-to-run noise was larger than every prompt edit. The problem was never the
wording: the prompt asks the leg to sweep "past where his own toes are", and the shared crouch
reference has his toes tucked under his hips, so the *target itself* was parked under his body. A
purpose-built reference — the same pose with one thing changed, measured against its parent at
identical height and +160% forward extent — took limb reach 55 → 89px and the visible air 87 → 53px,
without losing the measurable contact frame that made this sheet worth keeping. `audit:boxes` now
reports zero gaps: *"every attack box agrees with its own sheet"*.

Same lesson as `monk/blockCrouch`, one phase later and cheaper for having been written down: **the
reference is the lever, not the wording.**

And then the browser check at the end of the phase found the one thing none of the 299 unit tests or
72 browser tests could: **the 60-second timeout was decided on absolute health**, between fighters who
do not share a health pool. The brawler has 105 and the other two have 100, so two fighters who never
touched each other — both bars visibly full — ended 2–0 to the brawler on time. Every test had always
set both healths from the same implied pool, so the asymmetry that only exists *between different
fighters* had never been exercised. The tiebreak is now the remaining share, which is what the HUD bar
draws anyway. Fifth entry in the same column: look at it.

A follow-up pass then took the two things the gate had deliberately left open. **`e2e/harness.ts` now
backs every driving spec** — 349 lines deleted for 277 added — and merging twelve hand-copied
copies of the same helpers immediately exposed two bugs the duplication had been hiding: the
wait-for-scene loop advanced in 20-frame chunks and so routinely overshot by ~20 ticks (which is what
made a test counting `INTRO_TICKS` read 70), and one spec's header had spent four phases describing the
lock-in flash as a tween that "advances on pumped time" when tweens do not advance under the pump at
all. A comment can document a mechanism that does not exist and nothing ever goes red.

The other item, boot cost, **was not fixed, and the failure taught more than a fix would have.** A
worker-scoped shared page removes nearly every page load on paper. In practice giving up per-test
isolation produced three separate injuries: an atomic restore that threw on Windows and left the real
`character-gym.json` carrying a 21-damage monk — failing four later cases for reasons that had nothing
to do with them, recoverable only because the work had been committed first — an assertion that
silently began measuring the harness instead of the sim, and a case that went from 4s to a 180s
timeout. Reverted. What survives is the cheap half (a second scene entry inside one case restarts the
scene instead of reloading the page) and a hardened restore that retries and falls back to an in-place
write, because a torn read by one worker is a bad day and a permanently mutated registry is a corrupted
repo. The two heavy cases are still ~1.8m; almost none of it is the work, and it is not reducible from
inside a spec file, so they carry an explicit boot budget rather than a claim of being faster.

## The meter lie, and a bug report that was not a bug (2026-07-28)

Three player reports after Phase 16, and the value was in how differently they ended.
[`docs/phases/17-meter-lie-and-cpu-pick.md`](phases/17-meter-lie-and-cpu-pick.md).

**"The special of the jiujitsu and the monk is not working."** Reading every layer of the special path
proved it has no per-fighter branch anywhere — one binding table, one latch, one gate, three
near-identical data blocks, and a `METER_MAX` that is a module constant — and driving the real `World`
for all three fighters fired all three supers. So the sim could not produce the symptom, and the
temptation at that point is to decide the player is wrong. The player was not wrong. **Meter is paid as
`+damage`, and the ground heavy pays the brawler 15 but jiujitsu and monk 14**, so seven clean heavies
put the brawler on exactly 100 and the other two on 98 — two points short, i.e. one more landed hit.
The HUD drew that as 98% of the
slot: measured off the live game, **315 px of a 318 px bar**. Full to the eye, with the fill colour as
the only tell and nothing on screen to explain it, and a super that refuses in total silence. R-13's
shape exactly — an absolute constant compared against numbers that differ per fighter — and invisible
to 299 unit and 72 browser tests because every one of them assigned `METER_MAX` directly and never
asked what value a *player* actually arrives at. The fix is a Phaser-free `meter-view.ts` that owns the
ready decision so the HUD and the sim cannot disagree, compresses an unready fill into 92% of the slot,
and puts a **`MAX`** label on the bar. Not fixed by rounding 98 up or by re-balancing damage: both would
have changed the economy to hide a drawing bug.

**"The default opponent is jiujitsu and not actually random."** Tallied instead of argued: the
production seeding expression is even to within 3% at 1ms, 3s, 30s and 2min spacings, for every P1
card. Two outcomes at 50/50 makes three jiujitsus in a row a 12.5% event. No behaviour changed — but
every spec had pinned the seed through a DEV seam, so the production seeding line had never run in a
test, and now does. A unit test written for the same purpose was **deleted** after removing the RNG's
mix, removing its warm-up, and swapping in a deliberately striping LCG all left it green: a metric that
cannot fail is decoration, and that rule applies to tests written in good faith five minutes ago. A
second one slipped through anyway and was caught in review: an "unseeded" browser case asserting the
opponent was a *legal* card passes with the seeding deleted, because `cpuPick` sanitises any roll into a
legal different card. It now stubs the clock to two values two milliseconds apart that field different
fighters. **Both toothless tests were found by mutating the thing they claimed to guard, not by reading
them** — reading a test tells you what it says, not what it would notice.

**And the review found the same bug class again, one round later.** The `MAX` cue keyed off the sim's
readiness, which ignores the HUD entrance — but meter survives `reset()`, so a fighter carrying a full
bar into round 2 got the label over a *visibly empty* meter for the first ~300 ms while the bar charged.
The cue disagreeing with the drawing is precisely what this pass set out to fix; it had simply been
moved to the round transition. The ready cue now waits for the bar it labels to finish charging.

**The art queue that came out of this pass was closed by looking at it.** Three sheets measured badly —
`monk/special` with no forward limb travel at all across its 8 frames, `jiujitsu/special` sweeping its
leg away from the hit box, `jiujitsu/crouch` standing through its first 167 ms — and the user played the
game and accepted all three as-is. Recorded rather than fixed, so nobody spends credits rediscovering
it. The useful residue: these are among the worst sheets `audit:anim` and `audit:boxes` flag, and they
read fine in motion. The gates measure a silhouette, not whether a move reads as a move; they are for
the sheets nobody has looked at yet, and they do not overrule someone who has.

**The stale items.** The Phase 15 log had been claiming for two phases that the meter plate was still
vector-drawn, pointing at a `Carry-over` section that does not exist; the asset manifest still described
the HUD atlas as 4 frames when the shipped JSON has 6. Both corrected from the artifacts. The 5
INDETERMINATE `check:sync` sheets turned out to be a **measurement** limit, not art: the metric
differences each frame against frame 0, which assumes a planted body, and three of the five are air
normals where the whole figure translates — so what it measures is the fighter's own silhouette. The
8px threshold was left alone, because lowering it to admit one sheet is fitting the metric to the data.

## Phase 18 — the game learns to be held

The deployed URL had always been a desktop game. On a phone it booted, letterboxed correctly, and then
did nothing: every binding was a physical key, the mode screen offered a local two-player match that
cannot be played on one handset, and portrait squeezed a 1280×720 canvas into a tall window.

Phase 18 added a touch classification, a rotate gate, an on-screen pad, tappable menus and a CPU-only
mode screen — **without touching `src/sim/`, the world geometry, or the desktop experience**. The pad
enters through the same `InputSnapshot` the keyboard uses, as one optional argument to
`InputReader.read`, so there is still exactly one implementation of a rising edge.

**Three things were less obvious than they looked.** "Is this a touch device" is not
`game.device.input.touch` — that reports capability, and a touchscreen laptop answers yes, which would
have taken local two-player away from the one machine that is good at it; the question is touch AND no
fine pointer. A tap is not "a finger is on the button": Phaser dispatches touch synchronously from the
DOM listener, so a quick tap's down and up both land between two frames and a naive read never sees it —
and a sticky bit that survives one frame still swallows the second of two fast taps, because the edge
detector compares against the previous frame. And the rotate overlay does not block the game: Phaser
listens on `window` and deliberately forwards any touch whose target is not the canvas, so a `<div>` on
top stops nothing without `game.input.enabled = false`.

**The pass's own lesson is about tests, again.** Two of the new browser specs were written in good
faith, passed convincingly, and proved nothing. The rotate-overlay case passed with the input gate
deleted — first because the gate also sleeps the loop so nothing ran either way, then, after that was
fixed, because it tapped the centre of the *viewport* while the ScaleManager's 500 ms poll still held
stale bounds, so the tap transformed to a point off the canvas and hit nothing at all. The off-canvas
case dragged the thumb clear of the button before releasing, so the release path it was named after was
never exercised. Both were only exposed by deliberately breaking the thing they claimed to guard —
which is the rule this repo already had, applied to specs written five minutes earlier.

**And the screenshot found what the suite could not.** The `⎋ MENU` button had been placed in the
top-right corner by arithmetic that never asked what was already there: it landed on top of the P2
portrait plate. Moved to the bottom-centre strip the keyboard legend vacates on touch. Every gate was
green in both positions.

**Then it shipped, and a real phone switched the whole thing off.** On a Samsung S23+ the title still
read `PRESS ENTER` — which is exactly the string that means `touchMode()` returned false, so there was
no rotate gate, nothing tappable and no pad. The classification had been "touch AND no fine pointer",
and Android reports `any-pointer: fine` **true**: it advertises stylus/DeX capability whether or not
one is attached. The right question is `pointer: coarse` — *what do you point with*, not *could a fine
pointer exist somewhere*. Pixel 5 and iPhone 13 emulation both agreed with the broken version, under
Playwright and under a QA pass that was hunting for exactly this kind of false green. The predicate was
not under-tested; it was **untestable from here**. An emulator is code checked against code, which is
the same lesson as every hit box measured against another number instead of against the sprite.

**The second attempt did not land either, and that is the more useful half of the story.** After the
fix deployed the phone still said `PRESS ENTER`, with two live explanations — wrong predicate, or a
cached bundle — and no way to separate them remotely. The answer was to stop fixing and start
instrumenting: `?diag=1` now prints what the device itself reports onto the title screen, and its mere
presence distinguishes a stale bundle from a wrong test, because a build without that function cannot
draw the line. It worked on the next try. **When a defect lives on hardware you do not have, the third
guess is worth less than the first instrument.** Both `?touch=1` and `?diag=1` are deliberately not
DEV-gated for that reason — they are the only seams in this repo that ship.

## Phase 19 — the mobile viewport, a debug leak, reach, and pad art

Phase 18 was confirmed working on the S23+, and then it was *played*. Four defects came back and three
of them were invisible to the whole suite. Full write-up:
[`docs/phases/19-mobile-viewport-and-pad-art.md`](phases/19-mobile-viewport-and-pad-art.md).

**"Not wide enough" and "not centered" were two different bugs.** The centring one is the one worth
remembering: `index.html` centred the canvas as a CSS grid item *and* Phaser centred it with
`autoCenter: CENTER_BOTH`. Both are correct alone; together, because grid centres the canvas's *margin
box* and Phaser's centring **is** a margin, they compose and park the canvas a quarter of the letterbox
gap off to one side. The width one was `Scale.FIT` faithfully pillarboxing a locked 16:9 canvas, fixed
by reshaping the GAME to the device's aspect and letting FIT scale something that already fits.

**The approved mechanism for that turned out to be a Phaser trap, and re-deriving it before building
was what saved it.** The plan said `Scale.EXPAND` with `scale.min`/`max` as bounds. Those read as
game-size bounds and are not: `parseConfig` maps them onto `displaySize`, the CSS size, and
`Size.getNewWidth` clamps to `minWidth` *before* comparing to the parent — so `min.width: 1280` writes
`style.width: 1280px` onto an 851px phone. It would have looked right on this desktop and been broken on
every phone, which is this repo's oldest defect shape wearing a new hat.

**A threshold set to the worst observed value cannot fail.** `audit-boxes.py` had measured, for two
phases, that every attack connected through up to 60px of visible air — and passed, because
`AIR_GAP_MAX` was 60 and four sheets sat exactly on it. The budget is 30 now, the gate exits non-zero,
and there are fixtures on *both* sides of the boundary. The trim itself had to be a **uniform delta per
attack** rather than a per-fighter target: a common target erases the monk's pushbox compensation by
construction and reds `reach-parity.test.ts`, whereas subtracting the same number from all three
preserves every pairwise difference by arithmetic.

**A mutation that would not go red, and what it was actually saying.** Codex's one blocker was that an
explicit initial `applyViewport()` call was required, because Phaser refreshes before `main.ts` can
subscribe. I built it, then could not make removing it fail. The first explanation was environmental —
Chromium's emulation grows the parent from 0, so the poll fires a RESIZE anyway — and it got written down
as a defensive, untestable line. Wrong answer. A test that **rewrites the served HTML to pin `#game` to a
fixed pixel size**, so the parent bounds are final on the first read and no poll RESIZE can fire, still
passed without the call. Reading the source gave the real ordering: `DOMContentLoaded()` invokes its
callback *synchronously* at `readyState: interactive`, so `boot()`'s refresh is indeed missed (Codex was
right about that half) — but `boot()` also registers a refresh on READY, which fires after module eval
and before any scene's `create()`. The subscription is sufficient deterministically, the extra call
guarded a case that cannot occur, and it was deleted. **A mutation that refuses to go red is telling you
something about the code, not about the harness** — the instinct to blame the emulator was the thing to
distrust.

**And a preview caught what no assertion could, again.** The first pad bake had a hard seam across the
equator of every button — a binary `(yy > c)` mask where a ramp was needed. Right size, pairwise
distinct, correct radius, every fixture green. Only looking at it found it.

**The reach trim orphaned a copy of the geometry, and fixing that opened a second hole.** Codex's diff
review found `cpu.ts` still carrying `LIGHT_RANGE = 110` / `HEAVY_RANGE = 150`, hand-copied from the
brawler's pre-trim boxes, with a comment asserting the special always out-reaches the heavy. After the
trim that was false for all three fighters, so the CPU was throwing **full-meter supers** at air.
Deriving the ranges from `allHitBoxes()` fixed it — and broke something the constants had silently
guaranteed: the reaction timer keyed off the heavy while the approach keyed off the light, which only
works while every heavy is the longer of the two. Jiujitsu's heavy is 110 and its light 113, so its CPU
parked in that 3px gap, too close to walk and too far to arm the timer, and dealt **zero damage for an
entire round on every difficulty**. Found by an independent QA pass briefed on the acceptance criteria
alone; invisible to the unit suite, which built its world from `config.ts`'s never-trimmed fixture rather
than the shipped roster. One of that agent's two failures was its own fixture forgetting to reset the
round clock — **symptom as evidence, diagnosis as hypothesis** is what told the two apart.

**And my own boundary fixture was decoration, committed inside the fix for decoration.** The
`air = 30 / 31` selftest recomputed the arithmetic instead of calling `audit_state()`, so reverting the
threshold, weakening the predicate, or restoring `return 0` would all have left it green. It drives the
real gate now, pins the budget as a literal (the boundary cases derive their input *from* the threshold,
so they cannot see it move), and pins the flag→exit mapping — with the one case it still cannot catch
written down rather than implied.

**Confirmed on the phone.** The user retested after the review pass deployed and accepted it: the game
fills the screen, it is centred, the pad reads as real art, and the tighter neutral plays. Both open
judgement calls closed the same way — the trimmed reach feels right, and the pad's idle opacity is fine
on a real screen even though it looked thin in a screenshot. Worth recording as an outcome rather than a
metric: this phase's four defects were all found by a person playing the game, and the last word on
whether they are fixed belonged to the same person, not to the suite.

## Deployment history

The repo went live and **private** at `roiizchak/vibe-fighter` on 2026-07-22, wired to Vercel by git
integration. That **lifted the old "never push" rule**. Before that date `.git/` was an empty directory
and every `git` command failed — notes older than 2026-07-22 saying "there is no VCS safety net" are
stale.
