# Phase 15 log — Specials, Meter & Multi-Hit Combos

**Status: shipped, with one carry-over.** The mechanic, the meter, the super freeze, the cut-in, the
HUD meter, the training dummy and all three fighters' real `special.png` sheets are in and green. The
only thing outstanding is the meter's own atlas plate — it is vector-drawn until that art exists (see
*Carry-over*).

## What shipped

**Per-window dedup replaces `hasHit`.** The blocker the spec named. `Fighter.hasHit` was one boolean
that ended an attack's ability to connect after the first hit; it is now `Fighter.lastHitId` compared
against `FrameBoxes.hitId`, the window id the builder stamps on each hit-bearing frame. Combat still
has exactly one dedup read and one write. A normal has a single window (id 0) and still lands exactly
once — `combat.test.ts`'s original "a light attack deals damage exactly once" test is unmodified and
was the guard rail for the whole swap.

**`repeat: {count, gap}` authors the hit count.** `attackState()` lays the active window down `count`
times separated by `gap` bare frames. N is authored, never emergent. `attackSimTicks()` in
`sim/types.ts` is the single home of the length arithmetic; six consumers read it, including the two
Python art gates that mirror the formula.

**Meter.** `METER_MAX = 100`, credited from the **applied** rounded number rather than the spec field —
the validator does not require an integer `damage`, so reading the spec would have leaked floats into
the sim. It carries between rounds (`reset()` leaves it alone, like `damageScale`) and is zeroed by
`World.restart()`. The special spends the whole bar.

The economy shipped as "damage dealt **and taken**" and was changed on sight of the running game: a
defender banking half of every hit he ate meant the meter partly tracked *who was losing*, and a player
being cornered watched his own super charge up as a consolation prize. It now pays for **doing
something right** — the attacker banks a clean hit in full, a successful **block** banks the *blocker*
`BLOCK_METER_SHARE` (0.5) of what that hit would have dealt him, and being hit pays nothing. A blocked
attacker earns nothing either: chip is damage, but it is not a successful hit. Sizing the block reward
off the would-be damage rather than off chip is what keeps "block earns less than hit" true by
construction — chip is 1 on a light, so a chip-derived share would have rounded to zero.

**Super freeze + cut-in.** `AttackData.freeze` arms `Fighter.pendingFreeze`, which `world.tick()`
consumes at step 3b — deliberately **after** `checkRoundOver`, so a fighter KO'd on the tick they
started a special gets neither the freeze nor the cut-in. It rides the existing hitstop channel, so
the "clock must not tick on a frozen frame" guarantee holds for free. `render/super-cutin.ts` is
Phaser-free and unit-tested; `render/cutin-view.ts` owns the objects and is used by **both**
MatchScene and PlaygroundScene, because the dummy is where you actually try the move.

**HUD meter + training dummy.** A strip under each health bar, drawn into the HUD's existing fill
Graphics, geometry derived from the health slot so a re-cut bar moves both. Playground gained
**regen hp** and **fill meter** toggles, applied *before* `world.advance` — after is too late, since
health reaching 0 sets `ko` and flips the match to roundEnd inside that same advance.

**…and the Playground kept confiscating the bar.** It must `world.restart()` after a KO (forcing the
phase back to `"fight"` re-banks the same win every tick), and `restart()` zeroes the meter — right for
a fresh match, wrong for a training scene whose entire purpose is trying a super repeatedly. Farm meter
on the dummy, KO it, and the bar was gone; the monk's special was effectively unreachable. `resetWorld`
now saves and restores both meters across the restart, covering the KO path and the R key alike. The
on-screen legend also names the panel toggles now — a training feature nobody can find is not a
training feature.

**Ripple.** 19th state (`special`) through `StateName`/`AttackKey`/`ATTACK_STATE_TO_KEY`/`STATE_NAMES`
/the builder's state literal/`toSpec`; `special`/`specialPressed` through `InputSnapshot`,
`Fighter.consumed`, `World.consumedInputs`, `InputReader` (P1 `E`, P2 `M`) and `EdgeLatch`; a
`specialChance` knob in `cpu.ts`; `special` added to `check-sprites.py`, `audit-animations.py` and
`check-attack-sync.py`.

## What the reviews caught

Codex rejected the first plan with six findings, every one real and every one folded in before a line
was written. The two that would have shipped as bugs:

- **`lastHitId` is not cleared per-attack unless every attack goes through one door.** Window ids
  restart at 0 for each move, so a normal that had just connected left a stale `lastHitId = 0` and the
  special's first window was silently swallowed. The fix is structural — `startAttack(state)` is now
  the single entry into every attack state, with the stance picker lifted out into `variantFor()`.
  Verified the honest way: deleting the reset line drops the pinning test from 5 hits to 4 while every
  other test stays green.
- **The Playground regen toggle was specified to run after `advance`**, where it cannot undo a KO that
  already happened inside that advance.

Also caught: `toSpec()` copies fields explicitly, so `freeze` would have vanished silently;
`assembleCharacter`'s state literal does not grow just because `STATE_NAMES` does; and the
`attackSimTicks` consumer list was missing the two Python gates and two test files.

A second Codex pass over the finished **diff**, plus a QA agent, then found four more real defects —
all now fixed, three with regression tests that were watched fail first:

- **An interrupted special still froze the world** (`R-9`). `think` arms `pendingFreeze`, but combat
  runs later in the same tick and can put the fighter in hitstun. The freeze was honoured anyway: the
  match stopped dead and flashed the portrait of a super that never came out. Now the freeze only
  fires if the fighter is still in an attack state — the KO check above it only covered the fatal case.
- **A refused special press could fire itself later** (`R-10`). The special branch sat *after* the
  light/heavy branches, which `return`. Pressing light+special on a nearly-full bar left the special
  edge unconsumed, the latch kept re-offering it, and the light's own damage topped the bar up — so
  the super came out on its own. The branch now runs first, which also means a super beats a normal
  pressed on the same frame. The test for this had to move to `input-buffer.test.ts`: the leak lives
  in the **latch**, so a test driving `tick()` directly passes with the bug present.
- **An airborne press was silently eaten.** The consume was unconditional, so a special pressed mid-jump
  vanished and left a full bar unused — where `upPressed` behind the same gate stays buffered. Now the
  branch is skipped entirely while airborne and the press comes out on landing.
- **Two simultaneous supers** overwrote one another's portrait. `CutInView` is first-wins now, so the
  outcome is at least deterministic; one shared freeze still means one portrait.

Two lower-severity notes were fixed rather than argued: `lastMeter` was recorded *before* the meter's
`fillRect`, so the e2e's width assertion would have survived the draw being deleted (it is recorded
after now), and the spec comment claiming it tested the `E` binding was corrected — it drives the DEV
seam, so it proves the latch→sim path, not the physical key.

## The jiujitsu special was a sweep you blocked by standing up

Found by playing, like the others. The spinarooni's art is a spinning floor sweep — but it shipped
with `hit.y 75 h 85` (a chest-height band, 75–160) and `body: "stand"`, so a STANDING guard stopped it
and a crouching one ate all five hits. Exactly inverted. **This is the ground-heavy defect again**, one
phase after the CLAUDE.md note about it was written: nothing in the pipeline compares a box to the
sprite it describes.

Measured rather than guessed — differencing each frame against frame 0 and taking the y band of the
furthest-forward moved pixels put the striking leg at **22–99 px above the feet**, and the fighter's
own silhouette at 69 % of his standing height for all seven active frames. The box is now `y 12 h 50`
(12–62), which clears `guardStand`'s 70 floor and sits inside `guardCrouch`'s 0–80 — a real low —
and `body: "crouch"`, matching the 7 of 8 frames where he is down. That leaves a ~9-tick wind-up where
he is upright behind a crouch hurt box; the alternative was 49 ticks of a tall hurt box over a body
that is not there, and a hurt box larger than the art (you get hit by things that miss) is the kinder
failure than one smaller than it (attacks pass through you).

Brawler and monk were checked and are correct: both drive forward at chest-to-head height and are
highs. **Only the jiujitsu changed.**

`registry.test.ts` now sweeps every special × every defender across three spacings, asserting which
stance turns damage into chip. Watched fail on the shipped geometry first: a standing guard against the
old box returned 10 chip where 30 damage was expected.

## Decisions worth keeping

- **One `special` sheet, not a charge + an exec.** The clip's opening frames cover the attack's
  `startup`, so the charge is the wind-up. Half the art, half the ripple, and no non-attack state to
  thread through `CharacterData.frames`.
- **A `repeat` attack gets UNIFORM playback.** `render.sheets.<state>.hit` is one measured contact
  frame and a multi-hit move has N. A two-segment phase split would align window 0 and smear the rest,
  so `attackFrameDurations` returns `null` and `check-attack-sync.py` skips the sheet outright rather
  than recording a number nothing reads. Same honest answer an unmeasurable sheet already gets.
- **The special's `knockback.x` is small (30–35).** One `AttackData` drives every window, so a big push
  would walk the defender out from under the later hits and the authored count would stop being the
  count that lands. `TEST_DUMMY` goes further and uses 0, which is why the fixture's count is exact.
- **`gen-placeholder-sheet.mjs` gained `--state`.** Without it the generator rewrites all 19 states for
  all 3 fighters — which now means overwriting the entire real Seedance roster. It was safe when the
  repo had no real art and is not any more.

## And then I looked at it

Every suite was green, the meter's drawn width was asserted in the browser against a real number —
and the meter was **invisible**. It was positioned below the bar's fill *slot* rather than below the
bar *plate*, which put it at `barTop + 57` inside a 72 px plate. The plate is opaque everywhere except
the slot, so the meter drew correctly every frame, entirely underneath the bezel. Nothing in the test
suite could see that: the width it reported was real.

One screenshot. This is the third phase running where the defect that mattered most was only findable
by looking at the screen.

## Verification

- **249 → 258 unit tests green**, `tsc --noEmit` clean, **62/62 e2e green** (including
  `camera-group.spec.ts`, which audits every object's `cameraFilter` — the three new cut-in objects
  are in `cameras.main.ignore`).
- New `e2e/phase15-special.spec.ts`: the meter fills from real combat and reaches the HUD (measured off
  the Graphics, not a bookkeeping field); `E` fires only on a full bar, spends it, and a refused press
  does **not** linger in the latch; the world freezes and the cut-in plays the Phase 06 portrait over
  it, then self-clears; and one special animation lands `repeat.count` hits on a live opponent.
- `npm run check:sprites` OK; `npm run check:sync` measures 18 sheets and reports the 3 specials as
  MULTI-HIT (skipped by design).

## The art pass — done, at five clips for three sheets

Real Seedance specials shipped for all three fighters. Two lessons, both old ones re-learned:

**A `set -u` script bug the review predicted, in a place the review did not look.** Codex flagged that
the special prompts sat in `MOTION_FROM_START`, where `set -u` would abort; they were moved into
`MOTION` — but keyed `<fid>/special`, because each fighter has a different super, while the lookup at
the call site still read `MOTION[$ST]`. All three fighters aborted on the first line of the first
command. The lookup now tries the per-fighter key and falls back to the shared per-state one, and a
missing entry fails that one state loudly instead of killing the run.

**Then I looked at the sheets, and two of three were wrong** — with `check:sprites` green on all three.

- The brawler was **flat on his back on frame 1**. The prompt asked for a "REVOLVING uppercut —
  *spinning* as he rises … comes down and rises again", and the model took every one of those licences
  to the floor. This is the crouch-prompt failure again: any wording that permits the body to leave
  vertical ends up on the ground, so the ground has to be forbidden by name.
- The monk was eight near-identical horse-stance frames (0.31 peak, the lowest on the roster). The
  prompt named the *move* — "a RISING PALM BARRAGE" — and never named the **arm travel**. Naming the
  limb reaching full extension is what fixed `attackLight`; naming the move is not a substitute.

Both regenerated: spin dropped, extension described, ground forbidden explicitly. The monk landed on
that pass and visibly extends a palm at four distinct heights. **The motion gate passed the fallen
frame happily** — a fighter lying down is a large silhouette change, which is exactly what the metric
rewards. A wrong metric is more dangerous than no metric, and only the contact sheet showed it.

**The brawler needed two more passes, each for a different reason — four causes, one sheet.**

*Pass 3, SAMPLING.* Pass 2 was a correct uppercut, but ffmpeg takes 8 frames evenly across the 4 s
clip and the extension occupied only a sliver of each swing, so 6 of 8 samples caught him mid-return
with his fists at his chest. In game he read as *standing still with his guard up* while dealing four
hits. Amplitude was never the problem and describing the motion harder would not have fixed it; asking
him to **HOLD** at the top of each uppercut widened the window enough for even sampling to land on it.
Same distinction as the Phase 09 idle bob, where naming the cycle COUNT fixed what naming the size
could not.

*Pass 4, DIRECTION — and this is the one worth keeping.* Pass 3 measured beautifully: silhouette height
alternating `100/115/115/100/115/114/100/115`, a legible barrage. It was still wrong, and the user
found it in one play: *"he just moved the fist up, he is not moving the hands through the enemy."* The
uppercut travelled **purely vertically**, beside his own head — the hit box reaches 145 px forward and
the art never crossed the gap, so nothing on screen ever touched the opponent. **Every metric in the
pipeline is direction-blind**: `check:sprites`' motion floor, the audit's per-pair change, and the
silhouette height all score a big vertical swing exactly as well as a big horizontal one, and the
vertical one is the one that misses. Naming the target ("at an opponent standing just in front of him
to the RIGHT … reaching well past where his own toes are") fixed it, and the numbers moved the way you
would want: minimum adjacent change **0.01 → 0.36**, dead pairs **1 → 0**, and the heights flattened to
`100` across the board because the motion is now horizontal. An attack animation is a claim about
*reaching the other fighter*; measure it against that, not against how much the pixels moved.

`check:sync` reports the three specials as MULTI-HIT and skips them by design; 18 attack sheets still
measured, unchanged.

## Carry-over — the meter plate

The one thing still staged: `concepts/ui/2026-07-17/meter-bar.prompt.txt` is written and shares the
identical FRAMING/STYLE/PALETTE block `check_blocks` enforces. Generate at 21:9, add
`"meter-bar": "21:9"` to `UI_ASSETS`, and give it a branch mirroring the health-bar one (bbox →
`find_slot` → pack, emitting `meter-bar` + `meter-bar-slot`) plus its share of the `HUD_BAND_MAX`
budget. `hud.ts`'s `METER_*` constants then become a `slotIn()` off the new frame; the fill code does
not change. Until then the meter is vector-drawn.

## Not taken

Air and crouch special variants; multiple meter stocks; EX moves; special-cancels out of normals
(`setState` no-ops on an unchanged state, so a cancel into the same state would not rewind
`stateFrame` — a real trap, but not this phase's); audio.
