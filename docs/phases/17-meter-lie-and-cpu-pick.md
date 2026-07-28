# Post-16 defect pass — the meter lie, the CPU pick, and three stale items

**Status: shipped.** Three player reports, three different answers: one real bug with a fighter-specific
cause, one non-bug proved with numbers, and three stale items of which one closed, one closed as a
measurement limit, and one is still art-gated.

The player's words were "the special attack of the jiujitsu and the monk is not working", "the default
opponent is jiujitsu and not actually random", and "there is one stale thing we didn't fix".

---

## 1. The special: the HUD said READY, the sim said no

### The symptom, pinned down before anything was touched

Asked precisely, the report was: **P1, left side, meter bar visibly full, press `E`, and there is no
freeze, no cut-in, and the meter is not spent.** The brawler's works.

Every layer of the special path is fighter-agnostic, and reading them proves it: one binding table with
no per-fighter branch (`input.ts:23-24`), one latch (`edge-latch.ts:28`), one gate — `specialPressed &&
grounded`, then `meter >= METER_MAX` (`fighter.ts:168-174`) — and three near-identical `attacks.special`
blocks with **no per-fighter meter cost**, because `METER_MAX = 100` is a module constant. Driving the
real `World` for all three fighters enters `special`, freezes 36 ticks and lands every authored window.

So the sim could not produce the symptom. That is where guessing would have started, and it is where
the measurement started instead.

### The cause

**Meter is paid as `+damage`, and the ground heavy pays the brawler 15 but jiujitsu and monk 14.**
Measured by driving the shipped registry, not reasoned:

```
brawler   heavyDmg=15  meter after heavy 1..9: 15, 30, 45, 60, 75, 90, 100, 100, 100
jiujitsu  heavyDmg=14  meter after heavy 1..9: 14, 28, 42, 56, 70, 84,  98, 100, 100
monk      heavyDmg=14  meter after heavy 1..9: 14, 28, 42, 56, 70, 84,  98, 100, 100
```

The brawler lands exactly on 100 on his seventh heavy. The other two rest on **98** — two meter points short, i.e. one more landed hit — and
`meter / METER_MAX` drew **98% of the slot**. Measured off the live HUD: **315.0 px of a 318.2 px slot
at meter 99.** Three pixels. The bar was full to the eye, and the only thing separating ready from not
ready was the fill COLOUR, which nothing on screen explains. Pressing the super then did nothing at
all — the gate consumes the edge and refuses in silence — which reads as a broken move.

**This is R-13's shape again**: a cross-fighter comparison against an absolute constant, in a roster
where the per-fighter numbers differ. 299 unit tests and 72 browser tests passed, because every one of
them set the meter to `METER_MAX` directly and never asked what value a *player* arrives at.

### The fix

`src/render/meter-view.ts` — Phaser-free, unit-tested, in the spirit of `hud-entrance.ts` and
`anim-timing.ts`:

- `ready = meter >= max`, defined to agree with the sim's gate exactly. The HUD and the sim disagreeing
  about one number is the entire defect, so there is now one function that decides it.
- an unready fill is compressed into the first **92%** of the slot. Monotonic, so charging still reads
  as progress, but the last step to ready is a jump you cannot miss instead of 1% nobody can see.
- a **`MAX`** label on the meter plate, visible only while the super will actually come out, pulsing on
  the existing meter pulse. The gold fill already existed and was not enough: it is a colour with no
  legend.

Deliberately NOT done: snapping 98 up to 100, or changing damage numbers so every fighter divides into
100 evenly. Both change the meter economy to paper over a drawing bug, and the bar is self-correcting
once it tells the truth — 98 plus any 6-damage light clamps to 100.

### What now guards it

- `meter-view.test.ts` — the boundary, the monotonicity, the entrance interaction, and "never draws an
  unready bar as a full slot". **Watched failing**: with the old straight fraction, `meter 96 drew a
  full slot: expected 0.96 to be less than or equal to 0.92`, and the ready step measured `0.01`.
- `registry.test.ts` — the seven-heavies arithmetic (100 / 98 / 98) and a per-fighter refuse-at-99 /
  fire-at-100 boundary. **Both watched failing**: flipping `>=` to `>` in `fighter.ts` produced
  `brawler refused the special on a full bar`, and editing jiujitsu's heavy damage to 15 produced
  `expected 100 to be 98`. The registry was restored and verified clean with `git status` afterwards.
- `e2e/special-per-fighter.spec.ts` — the super run **as each of the three fighters** through the real
  select flow, asserting the refusal at 99 and the fire at 100, the drawn bar width, the `MAX` label,
  the freeze, and each fighter's own cut-in portrait. **Watched failing** by restoring the old fill:
  `Expected: < 308.654, Received: 315.018`.

### A stale comment that a spec had been repeating

`phase15-special.spec.ts` said trusted keyboard events do not reach Phaser headless, "which is why
every spec in this repo works this way", leaving the binding table "only guarded by review". Measured:
**false for the match scene** — `page.keyboard.down("e")` fires the super end to end. The new spec
presses the physical `E`. A comment can describe a mechanism that does not exist and nothing goes red.

---

## 2. The CPU opponent: no bug, and here are the numbers

`cpuPick` is drawn once per flow visit from `makeRoll(Date.now() & 0x7fffffff)` (`FlowScene.ts:95`,
consumed only at `:213`). Tallied over the production seeding expression at four realistic spacings,
2000 samples each:

```
3s apart   P1=brawler   -> {jiujitsu: 978,  monk: 1022}
30s apart  P1=brawler   -> {jiujitsu: 984,  monk: 1016}
2min apart P1=brawler   -> {jiujitsu: 980,  monk: 1020}
1ms apart  P1=brawler   -> {jiujitsu: 1029, monk: 971}
```

Even to within 3% at every gap, for every P1 card. Two outcomes at ~50/50 means three jiujitsus in a
row lands 12.5% of the time; the report was chance over a handful of games. **No behaviour changed.**

The one real gap was coverage: every spec pinned the seed through `__flow.seed(n)`, so nothing ever ran
the production seeding line. `phase16-parity.spec.ts` now finishes with an **unseeded** CPU match and
asserts the property rather than an outcome — the opponent is never the player's card and is always a
real roster id. That catches a throw, a NaN seed, or a pick that hands the CPU your own fighter.

### One test was written and then deleted

A unit test tallying `makeRoll` over wall-clock-spaced seeds looked valuable and had **no teeth**:
removing the Knuth mix, removing the 4-draw warm-up, and even swapping in a deliberately striping LCG
all left it green. Huge seeds decorrelate on their own, so the assertion could not fail for any
plausible regression. Deleted rather than kept — *whenever a metric cannot fail, it is decoration*. The
measurement above is reported here instead, which is what it always was.

---

## 3. The three stale items

**Docs vs artifact drift — CLOSED.** The Phase 15 log's header claimed the meter plate was still
vector-drawn and pointed at a `Carry-over` section that does not exist in the file; the plate shipped in
`4d4ea86` two phases earlier, and the same file's own body says so. `docs/asset-manifest.md` still
described the HUD atlas as "463×769, 4 frames" and never used the word "meter"; read back off the
shipped `hud-atlas.json` it is **463×871, 6 frames**, and the row now carries `meter-bar` 460×102 and
`meter-bar-slot` 370×39. A dangling "Both items left open above were then taken" in the Phase 16 log
pointed at two items that were not taken; corrected to name the two that were.

**The 5 INDETERMINATE `check:sync` sheets — CLOSED as a MEASUREMENT limit, no change.** The question
was metric or art. Measured: the metric differences each frame against frame 0 and takes the
furthest-moved column, which assumes a **planted body**. Three of the five are AIR normals, where the
whole figure is translating, so the moved region is the entire fighter — its lowest row reaches the
cell floor — and the horizontal extent it reports is the body's own silhouette, not a limb. Nothing
about the art is wrong; the metric is structurally blind to a state where everything moves.
`monk/attackLight` shows a textbook 65→71→71→65→65 profile that the 8px floor rejects at 6px, and
`jiujitsu/crouchHeavy` is measured correctly — its contact simply lands on the final frame, so there is
no recovery art to phase against. The threshold was left alone: lowering it to admit one sheet is
fitting the metric to the data, and a wrong metric is worse than no metric. INDETERMINATE keeps uniform
timing, which remains the right answer.

**`jiujitsu/crouch` stands upright for its first ~167ms — STILL OPEN.** Art, and gated on the user's
credit decision.

---

## Review, and what it caught

Both reviews found things the implementation had missed, and one of them found the same bug class this
pass exists to fix, relocated.

**The QA pass found `MAX` floating over an empty bar.** `readyText.setVisible()` ran before the
`if (fw <= 0) return` early-out, and `ready` deliberately ignores the entrance. `Fighter.meter` survives
`reset()`, so a fighter who banks a full bar in round 1 enters round 2's entrance ready while the drawn
fill is still exactly 0 for the first 18 ticks — the label sat over a visibly empty meter for ~300 ms at
the top of every later round with banked meter. That is *the cue disagreeing with the drawing*, which is
the defect this whole pass is about. `MeterView` now carries a separate **`showMax`** (`ready &&
fillFrac >= 1`) that drives the gold, the pulse and the label, so the cue waits for the bar it labels.
Watched failing: reverting it gave `MAX over an empty bar: expected true to be false`.

**Codex found the second toothless test of the pass.** The unseeded CPU case asserted only that the
opponent was a legal card — but `cpuPick` sanitises *any* roll (NaN, constant, out of range) into a
legal different card, so it passed with the seeding deleted. It now stubs `Date.now()` to two values two
milliseconds apart that field different fighters, which can only hold if the clock actually reaches the
draw. Two tests written in good faith this pass turned out to be decoration, and **both were caught by
mutating the thing they claimed to guard** rather than by reading them.

Also from the reviews: `meterFull()` is now exported from `src/sim/fighter.ts` and used by both the sim's
gate and the HUD, so the comparison has one owner instead of two identical spellings; the e2e asserts the
label's STRING, since an empty label is visible and unreadable; and two more copies of the "trusted keys
never reach Phaser headless" claim were corrected in `harness.ts` and the Phase 15 spec header.

## The art queue — measured, shown to the user, and ACCEPTED AS-IS

**Closed 2026-07-28 by the user, who played it and said the art looks good.** Nothing below is a bug
report any more; it is the record of what was measured, so a later session does not "discover" it and
spend Higgsfield credits re-fixing something already signed off. **Do not regenerate these without
asking.**

- `jiujitsu/crouch` — frames 0–1 are standing (heights 100/100/79/68) while the sim's crouch box drops
  on tick 1.
- `monk/special` — forward extent is a constant 66 px across all 8 frames, motion amplitude 0.31, the
  lowest attack sheet in the roster; `audit:anim` flags it `1/7 DEAD-PAIR`. The move fires and lands all
  five windows; nothing on screen travels toward the opponent.
- `jiujitsu/special` — the striking leg is drawn extending in −x while the hit box sits at +38..+138.

Worth keeping in mind next time the metrics disagree with the screen: **these three are exactly the
sheets `audit:anim` and `audit:boxes` flag hardest, and playing the game they read fine.** The gates
measure a silhouette, not whether a move reads as a move. They earn their keep by catching the cases
nobody has looked at yet — they do not overrule someone who has looked.

## Verification

`npm test` 309 passing / 18 files (was 299 / 17) · `npm run build` green · `npm run test:e2e` green ·
`check:sprites` OK · `check:sync` unchanged at 5 aligned / 8 misaligned / 5 indeterminate ·
`audit:boxes` 0 flagged · `audit:anim` 16 flagged. The last four are baseline checks, not evidence:
`audit:boxes` and `audit:anim` are advisory exit-0, and `check:sync` exits 0 with INDETERMINATE rows.
