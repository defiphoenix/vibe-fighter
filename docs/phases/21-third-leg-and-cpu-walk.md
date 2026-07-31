# Phase 21 — the third leg, and a CPU that never finished a step

Two defects, both reported by playing rather than by any gate:

1. *"When the brawler does the heavy attack while crouched, there's a glitch — there is a third leg
   when you kick."*
2. *"Player 2, when he is moving, isn't animating correctly, for all characters — it doesn't look
   like he's walking."*

Both were real. Neither was visible to the **383 unit tests or 175 browser passes that existed before
this change** — the pre-change counts, because the post-change 390/181 include the cases written
specifically to catch these, and quoting those as evidence about the old suite would be circular.
The reason nothing saw them is
the same in both cases: **every gate in the repo compares code to other code or art to its own
silhouette. Nothing counts limbs, and nothing asks whether a state lasts long enough to be drawn.**

---

## 1. The third leg

### What it actually was

Not a packing artifact, not a chroma-key speck. `drop_specks` had nothing to drop — every cell of the
shipped sheet was exactly ONE connected component. The extra limb was fused to the body and present
in the generated source video.

Measured, not eyeballed. Counting red shoe blobs in the ground band of
`concepts/characters/video/brawler/crouchHeavy.mp4` (97 frames @ 24fps):

| source frames | shoe blobs in the ground band | x-centroids |
| --- | --- | --- |
| 0 – 42 | **2** | 231, 497 |
| 43 – 57 | **3** | 231, 502, 670 → 724 |
| 58+ | 3–4 | — |

The third shoe appears at frame **43** — the exact frame the kick starts — and never leaves. The
model kept both original legs planted in a kneel and **grew a new leg to sweep with**.

`gen-sprite-videos.sh` samples 4 frames evenly (`fps=N/4` → source frames 0, 24, 48, 72), so cells 2
and 3 both landed in the contaminated region. `anim-timing.ts attackFrameDurations` then holds those
two cells for ~208 ms each — **78 % of the 533 ms move** was spent on the bad frames.

### Why re-sampling could not fix it

The clean window (frames 0–42) and the kick (frames 43+) are **mutually exclusive**. Measured forward
reach across the clean window peaked at 48 px against the 69 px the shipped hit box needs. There was
no arrangement of clean frames that contained a kick at all.

This is worth stating plainly because the first plan assumed the opposite: an eyeball pass over a
contact sheet read frames 42–52 as "clean", and only the shoe-blob count showed the boundary is 43.
**The colour discriminator found what a contact sheet could not.**

### The fix, and why the first attempt was not enough

The root cause was the START IMAGE. `brawler/crouchHeavy` had no `START_OVERRIDE`, so it began from
the fighter's **standing** idle and had to invent the crouch *and* the sweep — the exact failure
`monk/crouchLight` documents ("four prompt variants each produced the crouch OR the punch, never
both"). Given both, the model's answer was a kneel plus a spare leg.

**Attempt 1** — start from the fighter's own `crouch/03.png` (the jiujitsu/crouchLight trick), and add
an explicit two-limb clause to the prompt. Result: anatomy **fixed** (two legs in every frame, shoe
count 2 throughout) but the sweep reached only **53 px**, so `audit:boxes` flagged **46 px** of
visible air against its 30 px budget. Cause is the second thing the monk's note already records: that
crouch reference plants him low *and tucked*, toes under his hips, so "sweep past your own toes"
barely leaves his body.

Trimming the box to the art was considered and rejected — it drops the brawler's crouch-heavy
effective reach to **67** against **88** for both other fighters, a per-fighter reach cut, which is
exactly what `docs/lessons.md` forbids.

**Attempt 2** — the monk's actual remedy: a dedicated reference that is the same deep crouch with ONE
thing changed, the lead leg stretched along the floor
(`concepts/characters/crouch-refs/brawler-crouchHeavy.png`, `nano_banana_pro` from `crouch/03.png`).
Measured against its own raw output: height 1251 px, width 1343 px, area 706273 px **identical** — the
only edit is a **380 px left translation**, needed because the generated foot landed at x=1791 of
1792, hard against the frame edge with nowhere to sweep. Scale must not change: `build-sprites.py`
applies one idle-derived scale to every sheet.

Result: two legs, and reach **71 px**.

### The shipped sheet

Source frames **32 / 40 / 52 / 64**, not the default even sample. The even sample would put the
reference's already-extended lunge in cell 0, telegraphing the strike through the move's 8-tick
startup. 32/40/52/64 opens gathered and peaks on cell 2, which is what `hit: 2` declares.

```
check:sync   reach [-, 63, 71, 67]  contact=2  spread 8px
audit:boxes  strike 1..27  far 113 / limb 71  air 28  (budget 30)  OK
```

### The roster-wide sweep

Ground-contact masses per cell, all 21 shipped attack sheets. Everything reads 1–2 except the three
`crouchHeavy`s:

| sheet | per-cell masses | verdict |
| --- | --- | --- |
| the other 18 attack sheets | 1–2 | clean |
| `brawler/crouchHeavy` | `[3, 3, 3, 3]` | the reported defect — cells 0/1 a legitimate kneel, cells 2/3 three *shoes* |
| `monk/crouchHeavy` | `[2, 4, 4, 2]` | **false positive**, checked at 3× zoom: two legs, the extra masses are the robe hem and sash |
| `jiujitsu/crouchHeavy` | `[2, 2, 2, 2]` | clean on this metric but **broken differently** — see below |

### jiujitsu/crouchHeavy — a second defect the sweep surfaced

Its clip spends three of its four seconds crouched and only lunges in the last ~20 frames, so the even
sample gave it a **standing** pose in cell 0, two **identical crouched guards** in cells 1–2, and the
only striking frame in cell 3. Three of four cells did not attack. It was also the one attack sheet on
the roster with **no measured `hit`** in the registry — `check:sync` refuses a peak on the final frame
by design, so it had never been given a contact frame.

Re-sampled to frames **60 / 74 / 78 / 82** (free — no generation):

```
before  reach [-, 68, 68, 86]  INDETERMINATE (contact on the final frame)   no `hit` in the registry
after   reach [-, 54, 87, 86]  contact=2  spread 33px                        `hit: 2` written
```

The one-line registry diff is that added `hit: 2`. **Nothing was deleted** — the check Codex's review
demanded, because `check:sync --write` removes `hit` when a peak lands on the last cell.

Blast radius verified by md5 over all 58 shipped sheets: exactly the two intended files changed.

---

## 2. Player 2 never finished a step

### It is not a render asymmetry

There is no `index === 1` branch anywhere in `src/render` or `src/scenes`. `FighterSprite` reads
`f.facing` for `flipX` and nothing else; MatchScene constructs and updates both slots identically; the
walk states are chosen relative to `facing` (`sim/fighter.ts:150-151,214-219`), so P2 spawning
left-facing gets the correct sheet.

### It is that P2 is the CPU

`cpu.ts` re-rolled `approachBias` on **every eligible tick**. At `normal` (0.45) the conditional
expected run of `walkF` is `1/(1-0.45) = 1.8` ticks ≈ 30 ms. The shipped walk sheets are 8 frames at
12 fps — 83 ms per frame, ~667 ms per cycle — and `FighterSprite` restarts a looping animation on any
state change. So the state flickered `walkF ↔ idle` at 60 Hz and **the cycle never left frame 0**.
`vx` is zeroed on every dropped tick too, so the movement shuffled as much as the animation did.

Measured on the shipped roster, the **longest** walk run in a whole match:

| | easy | normal | hard |
| --- | --- | --- | --- |
| brawler before → after | 5.4 → **33.2** | 6.2 → **29.8** | 7.0 → **30.4** |
| jiujitsu before → after | 5.4 → **33.2** | 6.8 → **29.8** | 6.4 → **30.4** |
| monk before → after | 5.8 → **33.6** | 5.8 → **30.4** | 8.2 → **31.2** |

### The change

`WALK_HOLD = 20` ticks per committed decision, exported so the e2e cannot hold a second copy. **One**
`episodeTicks` counter plus an `episodeWalking` flag — two independent counters would admit the
illegal state "walking AND hesitating". Both sides of the decision are held for the same count, so the
marginal probability of walking on an uninterrupted eligible tick is still `approachBias`.

Three semantics that are load-bearing, all of them pinned by tests that were watched to fail:

- The episode ticks down **only on grounded + `ACTIONABLE`** ticks. `next()` is still called while
  attacking, stunned, knocked down or airborne, where `Fighter.think` discards movement — an episode
  burning there is spent on nothing, and would emerge from a knockdown with a few ticks left and
  stutter exactly as before. Same rule the reaction timer already follows.
- Arriving inside `myReach.min` **cancels** the episode. It does not pause: a decision taken at 600 px
  apart must not resume after the fight has closed and re-opened.
- `reset()` clears it, or a committed episode survives the round transition and the Enter rematch.

### Difficulty was re-measured, not assumed

Equal duty cycle is **not** equal difficulty — the variance per 20-tick window goes from
`Binomial(20, 0.45)`'s 4.95 to ~99, so the CPU closes in committed bursts instead of drifting. And
removing ~19 RNG draws per episode shifts every subsequent heavy / cooldown / block / special roll off
the one shared xorshift stream, so **same-seed matches play out completely differently**. That is
expected.

Measured on the shipped roster (5 seeds × 3 difficulties × 3 mirror matchups), walk duty fraction held
(4.6–16.1 % after vs 4.7–16.4 % before) and ticks-to-KO moved within seed noise with the
easy > normal > hard ordering intact. No `approachBias` retune was needed.

`probe/koprobe.test.ts` was deliberately **not** used for this: it builds from `config.ts`'s
`FIGHTER_A`/`FIGHTER_B`, which CLAUDE.md already identifies as blind to shipped-roster defects.

One behavioural change worth recording: the monk's CPU now never comes inside 110 px on normal/hard,
where it used to. That is correct — his shorter normal out-reaches 110, so he stops walking further
out; the old per-tick jitter was overshooting. His ticks-to-KO improved.

---

## 3. What was verified, and what could not be

| check | result |
| --- | --- |
| `npm test` | 390 pass (383 before this change) |
| `npm run build` | green |
| `npm run check:sprites` | OK |
| `npm run check:sync` | brawler contact 2 / jiujitsu contact 2, both matching the registry |
| `npm run audit:boxes` (HARD) | "every attack box agrees with its own sheet" |
| `npx playwright test` | 180 pass, 2 contention flakes, both re-run green in isolation: `qa20b-audio-deep` (a real-wall-clock cleanup assertion, passes with AND without this change) and `phase11-flow`'s registry-writing case (CLAUDE.md's "live ammunition" spec — the registry was checked afterwards and holds exactly the one intended added line) |
| in-game screenshots | brawler + jiujitsu crouch heavy read as two-legged low sweeps; the CPU walk burst captures cells **0→7**, the whole cycle |

### Mutation testing

Every new assertion was watched to fail. `src/sim/cpu.test.ts`:

| mutation | caught by |
| --- | --- |
| restore the per-tick Bernoulli | "blocks of exactly WALK_HOLD ticks", "reset() drops a committed episode" |
| drop the grounded+ACTIONABLE gate | "does not burn episode ticks while the fighter cannot walk anyway" |
| `WALK_HOLD` → `WALK_HOLD + 1` | "blocks of exactly WALK_HOLD ticks" |
| delete the in-range cancel | **SURVIVED at first** — see below |
| delete the GUARD-site cancel | **SURVIVED at first** — the site did not exist |
| delete the ATTACK-site cancel | **SURVIVED twice** — see below |

**Three of six mutations survived their first assertion, and that is the useful part of this section.**

*The in-range cancel.* The test as first written ("does not walk while in range") passed with the
clear deleted, because that branch returns before pressing either way. Decoration. Replaced by:
spend half an episode out of range, enter range, leave again, assert the next run is a WHOLE episode.

*The guard and attack cancels did not exist at all.* The comment claimed all three exits cancelled the
episode; only the in-range one did. Both other branches `return` before step 4 is reached, so a
half-spent decision simply waited for the exchange and resumed with its remainder — a 3-tick walk run
after a block is exactly the sub-animation-frame flicker this phase removes. Found by review, not by
the tests. Now one `cancelEpisode()` with one comment, called from all three sites.

*And the attack-site test then survived twice more*, for two different wrong reasons worth recording:
first because it asserted "the next WALK_HOLD ticks are uniform", and a cancelled episode re-rolls
onto the same decision about half the time — so the assertion passed on a coin flip. Fixed by
measuring run LENGTH modulo `WALK_HOLD` instead of uniformity. Then because the fixture swung at 45 px,
where `dist <= myReach.min` had *already* cancelled the episode, so the attack site was never
exercised. Fixed by swinging in the `min < dist <= heavy` window, where the heavy reaches but the
approach branch is still live. **A cancellation test has to be run at a distance where the OTHER
cancellation cannot fire.**

`e2e/qa21-animation-parity.spec.ts`:

- restoring the per-tick roll turns all three CPU-walk cases red;
- making a left-facing fighter skip its `walkB` re-play turns all three parity cases red, naming the
  frame: `frame 80: P1 {"state":"walkB","cell":0} vs P2 {"state":"walkF","cell":4}`.

### Adversarial corner cases (QA pass)

The dedicated QA subagent died on an account session limit partway through, so its charter was run
directly. Throwaway probes, deleted after measuring:

| case | measured | verdict |
| --- | --- | --- |
| max separation (both walls), all 3 difficulties x all 3 CPU characters | gap closed to 99 / 108 / 114 px, damage 9 / 26 / 47, longest walk run 60 / 100 / 60 | OK |
| KO mid-episode -> automatic round transition | next round `phase: fight`, wins `[0,1]`, longest run 20 | OK — `reset()` does not leak an episode |
| Esc -> Flow -> a new match | longest run 20, walk animation reaches cell 3 | OK |
| CPU pinned nose-to-nose inside its own reach for 600 ticks | walk ticks **0** | OK — no jitter, it attacks/guards instead |

Longest runs above 20 are episodes that rolled the same decision twice and merged, which is expected.

### Independent QA pass (re-run, 2026-07-31)

The QA agent was then re-run to completion against the finished tree. It edited nothing (`git status`
unchanged) and re-derived the two headline claims rather than reading them off this document:

| claim | how it was independently checked | result |
| --- | --- | --- |
| the third leg is gone | screenshot at the first tick of every cell (0/1/2/3), including the contact frame | **two legs on all four cells** |
| jiujitsu strikes on more than its last cell | same, plus a pixel diff of cell 2 vs cell 3 to rule out a duplicated frame | bbox `(139,185)-(359,343)`, 6875 differing px — distinct art, a deliberate hold at extension |
| the CPU walks | all **9** character x difficulty pairings, 1200 ticks each (the shipped spec covers 3) | longest run 20 (easy/hard) / 40 (normal, two merged episodes); max cell 3 / 7. Never the pre-fix 5-8. |
| the CPU does not park | monk chasing a wall-pinned monk from 260 px, 400 ticks | x fell monotonically 974 -> 374, longest run 60, cell 7 |

Its one substantive finding is a **margin**, not a defect: `brawler/crouchHeavy` now sits at
**air 28 against the `AIR_GAP_MAX = 30` budget**, the thinnest of all 21 sheets (next is monk at 23).
That is the deliberate consequence of keeping box reach at 113 for fighter parity instead of trimming
to the art's 71 px limb — see §1 — but it means *any* future re-sample of this one sheet has ~2 px of
room before `audit:boxes` goes red. Whoever touches it next should expect to regenerate, not re-sample.

Two scope limits it disclosed rather than papered over, both worth repeating: a black-box browser
trace **cannot** distinguish a leaked episode from a legitimate `cancelEpisode()`, because
`episodeTicks` is private — the mutation-tested unit case is the only instrument sharp enough for that
claim; and the 19-state x 3-character visual sweep was substituted with the `audit:anim` advisory
report (15/58 sheets flagged project-wide, **neither changed sheet among them**) rather than 57 manual
screenshots. A QA pass that names its own blind spots is worth more than one that reports full
coverage it did not have.

### What is NOT guarded

**Nothing automated catches a third leg.** Restoring the bad sheet is the current *green* baseline:
`check:sprites` checks dimensions, alpha, feet-anchoring and gross motion but not anatomy;
`audit:boxes` checks reach and bands; a frame-index parity test cannot see pixels. The shoe-blob and
ground-mass counts that found this are recorded above as a measurement, deliberately **not** shipped
as a gate — a per-fighter colour threshold tuned on one sheet is the kind of metric that cannot fail,
and `monk/crouchHeavy` already produced a false positive at `[2, 4, 4, 2]`.

The P1/P2 parity spec was **green the day it was written**, and that is the correct outcome — the
render layer was never asymmetric. It is a regression guard, not a reproduction of the reported bug.
The first draft of this phase's plan claimed it would be "red today"; that was wrong, and a test whose
pass you have misattributed to your fix is as misleading as one that cannot fail.

---

## Provenance

- `concepts/characters/video/brawler/crouchHeavy.mp4` — **regenerated**. Old clip md5
  `edcd32aeb6206ea94ec7281dd5a821a7`. Start image
  `concepts/characters/crouch-refs/brawler-crouchHeavy.png`. Cells from source frames 32/40/52/64.
- `concepts/characters/video/jiujitsu/crouchHeavy.mp4` — unchanged, md5
  `09a1a09f16360bc698283322e08c85f0`. Cells re-sampled from source frames 60/74/78/82.
- Both frame lists are ALSO in the tracked generator, as `FRAME_PICKS` in `gen-sprite-videos.sh`, and
  that is what makes the art regeneratable. Prose was not enough: a review pointed out that the
  generator still sampled evenly (`fps=N/4`), so running the advertised command after clearing the raw
  frames would have rebuilt a known-bad sheet — for the brawler, the exact three-legged timing this
  phase removed. Verified after the fix: extracting the `FRAME_PICKS` values and rebuilding reproduces
  both shipped PNGs **byte-for-byte (identical md5)**.
- The same review closed a second regeneration hole: a *declared but missing* `START_OVERRIDE` used to
  fall back silently to the standing idle, which is precisely the setup that generated the third leg.
  `concepts/**/*.png` is gitignored, so on any other machine that fallback is the DEFAULT path. It now
  fails loudly and skips the state.
- To be exact about what is gitignored: `concepts/**/*.png` and `*.mp4` are, so the reference image
  and both clips exist only on this machine. The `*.job.json`, `*.prompt.txt` and the two
  `00.frames.txt` records are tracked.
- 2 video generations + 1 image generation spent.
