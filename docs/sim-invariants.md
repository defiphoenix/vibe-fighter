# Sim invariants

Everything under `src/sim/` is pure and imports NO Phaser — a self-contained deterministic simulation
the render layer reads. Vitest runs it in the `node` environment precisely because it has no DOM/Phaser
dependency. Anything you add must stay Phaser-free and deterministic (no `Date.now`, no `Math.random`).
Boundary write-up: [`architecture.md`](architecture.md). Render side: [`render-notes.md`](render-notes.md).

Layout is discoverable — `world.ts` owns the sim, `fighter.ts` is one fighter, `MatchScene.ts` is the
bridge. What follows is only what you cannot learn by opening the file.

## Tick order

**`world.ts` `tick()` is the authoritative order of operations** — documented as numbered steps (phase
management, input gating/hitstop, FSM `think`, physics `integrate`, spatial resolve, facing/depth,
combat resolve, round-over, timers, clock). **Preserve that step order** when editing; the tests encode
subtle ordering guarantees (clamp-before-measure; the clock must not tick on the hitstop frame).

**`World.advance` returns "a fight tick ran `think`", NOT "the buffered edge was acted on".** `think`
early-returns inside itself when the fighter is locked in an attack or stun, so a tick can run and
consume nothing. WHICH edges were consumed is reported separately per fighter via
**`Fighter.consumed{up,light,heavy}`, OR-accumulated into `World.consumedInputs[2]`** (reset each
`advance`), and THAT is what the render latch clears (`EdgeLatch.consume`). Clearing on the bool dropped
attacks pressed during your own move. `advance` also masks a consumed edge out of the rest of the batch,
so one press can't fire twice inside a multi-tick advance.

## Geometry

**All boxes are fighter-local**: `+x` = forward (facing direction), `+y` = up from the feet
(`geometry.ts` `toWorld`). Everything downstream depends on this.

**High/low blocking is decided by box geometry, not labels.** A high attack's hit box only overlaps the
standing guard box; a low (**the two crouch normals only**) overlaps the crouch guard box; the air
normals come down from above and are **overheads**. **Only the guard boxes' `y` band encodes high/low —
their `x` span must cover the BODY (`x -32, w 90`), not sit as a thin forward slab**: a forward-only
guard box left every attack unblockable at the separations where the pushboxes touch, i.e. exactly where
the match is played, while still passing every test that measured blocking from poking range.
`registry.test.ts` now sweeps the shipped geometry from contact range outward.

**Guard boxes are PER-FRAME data** (Phase 13): `FrameBoxes` carries `guardStand` **and** `guardCrouch`,
and `CharacterConfig` has no guard arrays at all. `CharacterData.boxes.guard*` is the authoring TEMPLATE
that seeds every frame of a state `isGuardableState()` accepts. **Phase 13b made block a real state**, so
that set is now **`block/blockCrouch/blockstun`** — a guarding fighter is planted in the dedicated
held-guard states `block` (high) / `blockCrouch` (low) by the FSM guard branch, and idle/walk/crouch
dropped out (a fighter never guards while in them). Both stances are carried per frame rather than one
resolved array because **`crouchIntent`, not the state, picks the stance** — `blockstun` has one body and
no stance of its own, so that is the only thing keeping a crouch-blocker's low guard up while stunned.
**`block`/`blockCrouch` are also in `ACTIONABLE`** — not for jab-out (the attack edge is checked before
the guard branch, independent of `ACTIONABLE`) but so `cpu.ts`'s reaction timer keeps ticking through a
guard episode, exactly as when the plant used idle/crouch.
**`isGuardableState` is enforced in the BUILDER, not just the validator**: `guarding` is derived from box
data now, so a guard override on an attack frame would make a fighter blockable mid-punch, and `config.ts`
assembles with no validator in front of it.

**`body` does NOT control high/low** — it's the attacker's own vulnerability profile. The ground heavy
shipped for two phases with `body: "crouch"` and a shin-height hit box on top of a *standing punch*
animation, so the top ~40% of the attacker was invulnerable mid-heavy. Both now match the art
(`body: "stand"`, hit `y 95`). `config.ts`'s `TEST_DUMMY` still authors its heavy low **on purpose**
(it's the fixture that exercises the low path) — don't "fix" it to match the roster.

**`stats.scale` rescales the whole fighter — art AND collision geometry.** Boxes are multiplied **last,
after overrides**, in one traversal, so authoring stays in unscaled space. `FighterSprite` takes a
**required** `scale` arg so a missed call site is a typecheck error, not a silent desync. The validator
enforces `scale > 0`: `0` collapses every box and divides by zero in the Gym's inverse, and a negative
gives negative `w`/`h`, which `toWorld` normalises horizontally but **not** vertically. Knockback and
walkSpeed are NOT scaled.

## Attacks

**Seven attack states**: ground `attackLight/attackHeavy`, air `airLight/airHeavy`, crouch
`crouchLight/crouchHeavy`, plus the meter `special`. The single source of truth is `ATTACK_STATE_TO_KEY`
+ `isAttackState()` in `types.ts`; every consumer keys off it, never hardcoded literals. `variantFor()`
picks a normal's variant by stance: **crouch (grounded+down) > air (!grounded) > ground**, and the attack
check in `think` runs before the airborne gate. **`startAttack(state)` is the ONE entry into every attack
state**, because it is also the only place `lastHitId` is cleared — see below.

**Multi-hit is per-WINDOW dedup, not per-attack** (Phase 15). `FrameBoxes.hitId` tags each frame with the
hit window it belongs to; `Fighter.lastHitId` refuses a window that already connected. A normal has one
window (id 0) so it still lands exactly once; `AttackData.repeat = {count, gap}` lays the active window
down `count` times so a special lands `count` times. **Window ids restart at 0 for every attack**, so
`startAttack` clearing `lastHitId` is load-bearing: without it a normal that just connected swallows the
special's first window (the test that pins this drops 5 hits to 4). `attackSimTicks()` in `types.ts` is
the ONE place the repeat length arithmetic lives — mirrored by `check-attack-sync.py` and
`audit-animations.py`, and consumed by the validator and `anim-timing.ts`.

## Meter and super

**The meter is earned by playing WELL, never by being hit**: landing a clean hit pays the attacker
`+damage`; a successful BLOCK pays the *blocker* `+floor(damage * BLOCK_METER_SHARE)` (0.5) off the
damage the attack *would* have dealt, so guarding is rewarded and landing it is rewarded more. Eating a
hit pays nothing, and a blocked attacker earns nothing either — chip is damage, but it is not a
successful hit. Always credited from the **applied** (rounded, difficulty-scaled) number — the spec's raw
`damage` is not required to be an integer, so reading it would leak floats into the sim. `METER_MAX` is
spent whole; the special is grounded-only, and the edge is **consumed even when refused** or a press on an
empty bar stays latched and fires itself the instant the bar fills. `reset()` deliberately keeps the meter
(it carries between rounds, like `damageScale`); `World.restart()` zeroes it.

**A fighter's meter therefore lands on multiples of its OWN damage, never on a shared grid** — pinned as
R-14. The ground heavy pays the brawler 15 but jiujitsu and monk 14, so seven clean heavies put the
brawler on exactly 100 and the other two on **98** — two points short, i.e. one more landed hit — and the
HUD drew that as 98% of the slot (measured live: 315 px of a 318 px bar) while the super refused in total
silence. Same shape as R-13 — an absolute constant compared against numbers that differ per fighter — and
invisible to 299 unit + 72 browser tests because every one of them assigned `METER_MAX` directly and never
asked what value a *player* arrives at. **`render/meter-view.ts` now owns the ready decision** so the HUD
and the sim cannot disagree about it; do not "fix" this class by rounding the meter up or re-balancing
damage onto a round number, which changes the economy to hide a drawing bug.

**The super freeze rides the existing hitstop channel**, folded in at step 3b **after** `checkRoundOver`
— a fighter KO'd on the tick they started a special gets neither the freeze nor the cut-in.
`Fighter.pendingFreeze` is consumed on read (left set, it re-freezes every tick).

### The interrupted-special signal

**`Fighter.interruptedSpecial`, OR-accumulated into `World.interruptedSpecials[2]`** — identical shape,
lifetime and reset discipline to `consumedInputs` above: cleared per tick in `tick()` before any early
return, cleared per advance at the top of `advance()`, OR'd immediately after each `tick()` returns.

Set in **`applyHit`**, beside `stunEpoch++` and **before the `health <= 0` early return**, when the hit
arrives while the fighter is still in `special`. `applyHit` is the single door every hit and block routes
through, so one line covers every caller; placing it before the KO branch is what makes being killed
mid-super report as the interruption it is. Keyed on the STATE, never on `blocked` — what makes it an
interruption is the move the hit landed on.

**It exists because the render layer cannot derive it.** A render frame samples state once but `advance`
can drain 15 ticks, so "the special ended and its owner was hit two ticks later" and "the special was
interrupted" leave the identical `special` → `hitstun` trail. Only the tick applying the hit can see which
one it is. The consumer is the audio cut in [`render-notes.md`](render-notes.md#audio-phase-20); the case
that proves the field is needed is in `src/sim/interrupted-special.test.ts` ("stays FALSE when the special
COMPLETES and its owner is hit later in the SAME advance").

It reports **hits only**. A round timeout and `World.restart()` both end a special without going through
`applyHit`, and the render layer covers those off the round phase instead.

## Blocking

**Block is a dedicated key**, not hold-back: `guardIntent = input.block && grounded`, and holding block
PLANTS the fighter. Use the **`guarding` getter** (block held, grounded, and the current FRAME carries a
guard box) for any guard cue — `guardIntent` alone is set even in hitstun/attack where no guard box exists.

## Space and the camera's constraints on it

**`spatial.ts` clamps to walls first** so corner penetration transfers to the other fighter, then a final
**`MAX_SEPARATION` cap** (=`VIEW_WIDTH-240`=1040) pulls the pair symmetrically to the midpoint so the
follow-camera always frames both. It only ever REDUCES a gap far larger than any pushbox, so it can't
create overlap; a midpoint near a wall just clamps back in. This is the SF-style off-screen fix; camera
zoom-out was rejected because the stage art is exactly viewport-height.

**`STAGE_WIDTH=1696` is the WORLD; `VIEW_WIDTH=1280` is the camera/canvas.** Splitting them is what gives
the camera room to scroll. Timing is in ticks (60 Hz), space in pixels.

## The CPU

**`cpu.ts`'s attack RANGES are derived from the fighter's own boxes, never mirrored** (Phase 19). They
were `LIGHT_RANGE = 110` / `HEAVY_RANGE = 150`, hand-copied from the brawler; the roster-wide reach trim
orphaned them, and the CPU then committed heavies out of range and spent **full meters** on supers that
could not reach — the special is now SHORTER than the heavy on all three fighters, which the old comment
explicitly assumed it never would be. `reachOf()` reads `allHitBoxes()`. Two traps behind that: **neither
normal is reliably the longer one** (jiujitsu heavy 110 < light 113), so the approach walks to `min` and
the reaction timer arms inside `max` — pairing "timer on heavy" with "approach on light" left that fighter
parked in the 3px gap dealing ZERO damage for a whole round; and **`cpu.test.ts` must build from the
shipped registry**, because `config.ts`'s `TEST_DUMMY` was never trimmed and cannot express the inverted
case at all.

**Difficulty is ONE code path and three parameter rows**, and the rows are not monotone in the same
direction: `attackCooldown`, `cooldownJitter` and `reactionTicks` fall as difficulty rises while every
chance knob rises. `KNOB_DIRECTION` declares which, and the test asserts against it — a single blanket
`easy <= normal <= hard` is exactly backwards for three knobs and goes green on a CPU tuned in reverse.
**`DAMAGE_SCALE.hard` is 1.00** (was 0.85): hard deals the authored numbers, no handicap and no bonus,
because a swing every ~56 ticks against a human's 15-tick light already left it landing ~22% of the
damage throughput of the player it was meant to threaten. Easy and normal keep a real handicap.

**`cpu.ts`'s approach decision is committed for `WALK_HOLD` (20) ticks, not re-rolled per tick** (Phase
21), and since 2026-08-01 it commits to one of THREE outcomes — advance, hold, or **retreat**. Retreat is
eligible only inside the opponent's reach and outside the CPU's own (the gap where they can hit you and
you cannot answer); backing off from across the stage is just running away, and a CPU that does it never
closes and times every round out. The composition is a CONDITIONAL, not a partition — `spacingBias` is
rolled first and `approachBias` still decides advance-vs-hold on everything it does not claim, so the two
are free to sum past 1. `episodeWalking: boolean` became `episodeMove: -1 | 0 | 1` so "retreating AND
advancing" stays unrepresentable, which is the same reason it was one counter plus a flag before. `approachBias` used to be a per-tick coin flip, which at `normal` gives a 1.8-tick expected `walkF`
run against an 83 ms animation frame — and since `FighterSprite` restarts a loop on every state change,
the CPU's 8-frame walk cycle **never left frame 0**. That is what "player 2 isn't animating correctly"
was. Measured before the fix: the LONGEST walk run in a whole match was 5.4–8.2 ticks across all three
difficulties, against a cycle needing 40. Three rules the episode must keep: it ticks down **only on
grounded + `ACTIONABLE`** ticks (`next()` is still called while attacking/stunned/airborne, where movement
is discarded, so an episode would burn on nothing); arriving inside `myReach.min` **cancels** it rather
than pausing it; and `reset()` clears it, or it survives the round transition and the Enter rematch. It is
ONE `episodeTicks` counter plus an `episodeWalking` flag — two counters would admit "walking AND
hesitating". **Equal duty cycle is NOT equal difficulty** (per-window variance goes 4.95 → ~99), so
re-measure ticks-to-KO on the SHIPPED roster after any change here; `probe/koprobe.test.ts` builds from the
`config.ts` fixture and is blind to it.

### The four free-swing behaviours (2026-08-01)

`next()`'s numbered steps now carry a **punish** window (2026-08-01), an **anti-air**, a **wake-up**
latch and a **three-way movement** episode. All four produce a `freeSwing`, which skips the cooldown and
the reaction timer — and **nothing else**. Four rules hold them together; each one was a defect first.

- **A free swing must still check `canAct`.** On the timed path it was implied (`inReachTicks >
  reactionTicks` can only be true on an ACTIONABLE tick, because step 1 zeroes the counter otherwise). A
  free swing carries no such implication, so without the explicit check the CPU burns its cooldown on a
  press `think()` silently discards while stunned or mid-attack. Reach and `grounded` are never skipped
  either — the CPU cannot hit you from outside its own measured boxes.

  This bullet used to claim the check also protected the **one-shot window**. It did not: the `canAct`
  test sits on the SWING, downstream of all three latches, so `punished`, `antiAired` and `reacted` were
  each set on ticks that could never convert them. That is what Phase 23's `lockDiscipline` fixes — see
  the next section. A doc that describes a protection the code does not have is worse than no doc.
- **A knob of exactly 0 must not consume its RNG draw.** `this.knobs.x > 0 &&` guards every new roll. A
  draw taken for a zero chance still advances the shared xorshift stream, so merely *adding* the punish
  branch moved every later decision on `easy` — and easy, which has none of these behaviours, started
  KO'ing the idle player that `difficulty is survivable` pins as exactly what it must never do. The
  payoff is a real guarantee: **`easy` is byte-identical to the pre-2026-08-01 controller**, pinned by
  two trace hashes in `cpu.test.ts` (one idle opponent, one ATTACKING).
- **The same gate applies to behaviour, not just draws.** Guarding is suppressed during the opponent's
  recovery (`isAttackState(opp.state) && !guardSuppressed`) so blocking cannot cannibalise the punish —
  the CPU used to plant itself in a block against a move whose active frames were already spent, and the
  guard branch's early return meant the punish never ran. That coupling is invisible until `blockChance`
  rises: taking hard 0.22 → 0.72 cut its conversion of a whiffed heavy by two thirds without touching a
  line of punish code. **The suppression is itself gated on `punishChance > 0`** — a tier with no punish
  has nothing to protect and must keep the old guard behaviour exactly. Missing that gate is what made
  the first "easy is unchanged" hash a false green: the fixture's opponent never attacked, so the whole
  guard branch was never executed.
- **The wake-up is a LATCH, not an edge, and it expires.** Step 2 (guard) returns before the swing, so a
  CPU that wakes into a live block hold would lose the reversal outright — hence the latch. But it is
  consumed on the first tick the fighter is actually free, **in range or not**: gating consumption on
  range let it survive a walk across the stage and fire on arrival, a "wake-up reversal" seconds after
  the wake-up. Out of range the opportunity simply passes; there was no meaty to reverse.

### Lock discipline: a decision is only made on a tick that can act on it (2026-08-02)

`Fighter.think()` early-returns on a STUN state, on an attack state and on an airborne tick, so a press
issued on any of those is dropped. Steps 1, 2b, 3 and 4 already refused to spend anything there. Three
sites did not, and all three were the same bug:

| site | was | now gated on |
|---|---|---|
| the `blockTicks` countdown | burned through the CPU's own attack, hitstun, knockdown | `guardEligible`, and **cancelled** rather than paused |
| the `reacted` guard roll | latched on a discarded tick **38.4%** of the time | `guardEligible` |
| the `punished` / `antiAired` latches | spent by a fighter that could not convert | `canAct` |

**`blockstun` is exempt, and this is the whole subtlety.** `think()` records `guardIntent` BEFORE its
STUN return and `GUARDABLE` includes `blockstun`, so a fighter holding guard through blockstun really is
guarding — measured **4063/4063** such ticks resolve `guarding === true`, against **0/3686** for the
CPU's own attack. Spending the hold there is the hold doing its job across a block-string. Treating it
as waste *lengthens* guard instead of stopping it, which is a balance change in exactly the Phase 13b
timing D11 was deferred to avoid: worth 14 points of hard's win rate (94.6% un-exempted vs 80.7%).
`ACTIONABLE` is therefore the wrong predicate here and `canAct || state === "blockstun"` is the right
one — the two are NOT interchangeable, and only the latch sites take the bare `canAct`.

**Cancel, not pause.** A guard decision must not survive the exchange that invalidated it — the same
rule, and the same verb, that `cancelEpisode()` applies to a walk. Pausing would hand the CPU a full
18-tick hold on wake-up and postpone its reversal by up to that long. Because the hold is cancelled,
`wakeupArmed` needed no change: `blockTicks` is 0 on the wake-up tick, so step 2 no longer returns early.

All of it is gated on a `lockDiscipline: 0 | 1` knob (easy 0) because `easy` is frozen byte-for-byte and
the fix moves the RNG stream. **Easy therefore still carries the bug, deliberately.**

`oppHelpless()` is now the exported module-level `isHelpless(f)`, because the tuning harness needs the
same predicate and the copy it had counted attack STARTUP as punishable. It reads
`cfg.states[state].frames.length - spec.recovery`, **not** `attackSimTicks()`:
that helper takes an authored `AttackData` (with `body`/`hit`) while `CharacterConfig.attacks` holds the
assembled `AttackSpec`, so the obvious call does not typecheck. The frame list already expanded the
`repeat` arithmetic, so reading its length reuses the number instead of re-deriving it, and the boundary
lands after the LAST repeated window — a multi-hit special is not punishable in the gaps between hits.

**KNOWN, measured and deliberately not fixed (2026-08-02):** a **masher** — walk in, press light, never
block — takes 100% of rounds off all three tiers. The cause is frame data: contact lands on the first
active frame, so the attacker has `frames.length - startup` ticks left against the defender's `hitstun`
— brawler 11 vs 12, jiujitsu +1, monk exactly NEUTRAL at 12 vs 12. Neutral already suffices, because the
defender needs `reactionTicks + 1` free in-range ticks before the timed branch can answer.

Not fixable from `cpu.ts` at any setting worth having: swept `attackCooldown` 18–35, `blockChance` to
1.0, `reactionTicks` to 4 and `punishChance` to 0.8 — **0.0% in every cell**. The one configuration that
dents it is `attackCooldown: 1` with every chance maxed (mash back), which reaches 32.7% and collapses
hard to 21.1% against a competent player. The test pins the FRAME RELATIONSHIP, not the win rate — a
win-rate pin would be an anti-improvement gate.

**Also known:** the anti-air branch is inert in match play. Controlled measurement (swings per descent
tick vs per ascent tick, same tier) gives hard 2.55% vs 2.03% and normal **0.78 ratio** — no detectable
effect. It works in a fixture and essentially never reaches its preconditions in a real match.

**`cpu.ts` is sampled once per TICK, inside the fixed-timestep loop** (`CpuSeam` on `World.advance`). A CPU
sampled once per render frame acts at the display's rate and is not reproducible. It skips `EdgeLatch`
deliberately (it re-derives its edges every tick). **`reactionTicks` is what makes a difficulty beatable**,
and its counter must only run on **`ACTIONABLE`** ticks — otherwise a stunned CPU banks reaction it can't
use and spends the swing on a press `think()` swallows. `DAMAGE_SCALE` becomes `Fighter.damageScale` (a
multiplier on damage DEALT, default 1, deliberately **not** reset by `reset()`); `combat.ts` floors a
scaled hit at 1, lets chip floor at 0, and puts the **scaled** number in the `hit` event because the camera
shake reads it. The controller outlives every round and the `Enter` rematch, so **`CpuSeam` has an optional
`reset()` that `world.resetRound()` calls** — the render layer can't own this, because the automatic round
transition happens inside `tick()`. The RNG is deliberately NOT re-seeded there (that would make every
round identical).

## Rounds

**A timeout is decided on the health SHARE (`health / maxHealth`), never on raw health** — fighters do not
share a pool (brawler 105, jiujitsu/monk 100). Raw health handed the brawler every timeout in which both
fighters had taken equal punishment, *including none*: two fighters who never touched each other, both bars
visibly full, ended 2-0 to the brawler on time. It survived every test because every test assigned both
healths from the same implied pool — the asymmetry only exists BETWEEN fighters, and nothing had ever timed
out a mismatched pair. Pinned as R-13. Generalises: **any cross-fighter comparison of an absolute stat is
suspect** while `maxHealth`, `scale` and the pushboxes all differ per fighter — the same shape as comparing
raw hit-box reach instead of effective reach ([`lessons.md`](lessons.md#balance)).

## Input

Input **edge presses are latched** in `pending[]` until a sim tick consumes them (held fields like `block`
pass straight through) — **plus the `down` held at press time, surfaced as `InputSnapshot.downAtPress`**, so
a buffered crouch normal doesn't come out standing when the player releases `down` before an actionable
tick lands.
