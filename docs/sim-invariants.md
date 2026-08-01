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

**`cpu.ts`'s approach decision is committed for `WALK_HOLD` (20) ticks, not re-rolled per tick** (Phase
21). `approachBias` used to be a per-tick coin flip, which at `normal` gives a 1.8-tick expected `walkF`
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
