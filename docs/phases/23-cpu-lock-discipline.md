# Phase 23 — the decisions the CPU spent while it could not act

*2026-08-02. Not deployed.*

> *"Fix D11, the CPU block hold that is spent while the CPU is knocked down. And independently QA the
> CPU strength pass that precedes it, which has never been QA'd."*

Phase 22 shipped four new CPU behaviours and left one defect diagnosed and unfixed. This phase ran the
independent QA that pass never had, fixed D11 — which turned out to be three defects, not one — and
re-tuned the tiers against a gate that had been measuring the wrong thing.

**The QA agent's verdict on Phase 22 was "do not deploy", and it was right.**

## What the QA pass found

Twelve findings. The two that mattered most were not about D11 at all.

**F1 (blocker). The "competent scripted human" every strength number was measured against could not
block.** It entered `blockstun` **0 times across 48 matches** while taking 1,169 hits, and hard's win
rate was byte-identical at reaction delays 6, 12, 18 and 30 — a parameter with no effect is a parameter
whose branch never fires.

The cause was not the delay. Instrumented, the block branch *was* reached on 79.8% of the ticks the CPU
was attacking. **96% of the hits it took landed while it was locked in its own `attackHeavy`**: its
whiff-punish predicate counted any attack state as punishable, *startup included*, so it answered the
first frame of every CPU attack with a 33-tick heavy and was still in it when the active frames arrived.
It was not a competent human; it was a trade-happy masher with a decorative guard.

The fix is one shared predicate. `oppHelpless` was extracted from `CpuController` as an exported
`isHelpless()` and the proxy now uses it — the copy it had was the same idea written wrong, which is
exactly the drift a second definition invites. Block rate **0.2% → 17%** at a reaction delay of 6,
derived rather than picked: guard is up on tick 7, which beats every heavy's 9-frame startup and misses
every light's 4-frame one. Block the telegraph, eat the fast poke.

**F2 (blocker). Hard loses 100% of rounds to a masher.** Confirmed. The sweep tried `attackCooldown`
18–35, `blockChance` to **1.0**, `reactionTicks` to 4 and `punishChance` to 0.8, and the masher's rate
stayed at **exactly 0.0% in every cell** — including the one that took hard to 92.7% against the
scripted human.

The cause is frame data, which this phase's scope lock forbids touching. Contact lands on the first
active frame, so the attacker has `frames.length - startup` ticks left while the defender is stuck for
`hitstun`: brawler **11 vs 12** (+1 attacker), jiujitsu +1, monk exactly **neutral** (12 vs 12). Neutral
already suffices, because the defender needs `reactionTicks + 1` free in-range ticks before its timed
branch can answer and at best it gets zero. Hard eats 12.35× the damage it deals and spends 53% of the
match in hitstun or blockstun.

**My first write-up claimed "no CPU parameter can fix it". Codex Gate 2 was right that this was not
established, and it is false.** `attackCooldown: 1` with every chance maxed — mashing back — reaches
**32.7%** against the masher, and collapses hard to **21.1%** against a competent player. So the honest
statement is not "impossible" but "only by abandoning what the tier is for". Left unfixed, and the test
now pins the **frame relationship** rather than the win rate: pinning `< 25%` would have been an
anti-improvement gate that reddened the suite the day someone succeeded.

**F5.** The anti-air path was protected by neither byte-identity hash: `antiAirChance = 1e-12` moved
easy's draw count 949 → 950 with the hash unchanged. Fixed with a third fixture (jumping opponent,
`7b22e5ac`), captured against the OLD build and verified to catch the ungated draw the other two miss.

**F6.** Deleting the one-roll latches left **all ten behaviour tests green** — the punish and anti-air
fixtures called `next()` exactly once, and a per-window latch is invisible to a one-tick fixture. Fixed
with windowed fixtures; the window is `reactionTicks` long, derived, because that is the longest run for
which the ordinary cooldown+reaction path provably cannot answer.

**F7.** A third unnamed latch site — `reacted` at `cpu.ts:411`, spent on a discarded tick 38.4% of the
time. Folded into the fix. `sim-invariants.md` documented a `canAct` protection the code did not have.

**F8.** Anti-air is inert in play. **Confirmed and NOT fixed** — see below.

Also accepted and fixed: **F3** (the gate was statistically too weak), **F4** (four of eight gate-table
numbers did not reproduce), **F10** (`DAMAGE_SCALE.normal` moved 0.7 → 0.8 undocumented), **F11** (D6's
"~6 ticks" double-counted the active window; measured +7 to +10), **F12** (`wakeupArmed` latched
permanently on easy).

QA also returned clean bills worth recording: held-out seed leakage **refuted** (the gate block scored
*above* the tuning block), and `runMatch` vs `World.advance()` **refuted at 0.0pt delta on 9/9 cells**
with all seven omissions enumerated and shown neutral.

## D11 was three defects, and the phase doc named the smallest one

Measured on hard over the held-out seeds, 48 matches, 25,597 block-hold ticks:

| state the hold burned in | ticks | |
|---|---|---|
| `blockstun` | 8,173 | **not waste** — the fighter is guarding |
| **its own attack** | **7,545** | the real defect |
| `hitstun` | 431 | |
| `airborne` | 88 | |
| `knockdown` | **52** | the only case the Phase 22 doc names — **0.3%** |

Genuine waste is **8,116 / 25,597 = 31.7%**, not the 63.6% a naive `!ACTIONABLE` count gives.

**The blockstun exemption is the whole difficulty of this fix, and both reviewers found it
independently** — Codex Gate 1 and the QA agent, from different directions. `Fighter.think()` records
`guardIntent` *before* its STUN early-return and `GUARDABLE` includes `blockstun`, so a hold spent there
is the hold doing its job across a block-string: measured **4,063/4,063** such ticks resolve
`guarding === true`, against **0/3,686** for the CPU's own attack. Cancelling them would have *lengthened*
guard — a buff, in exactly the Phase 13b timing that was the stated reason for deferring D11 at all.
Worth 14 points of win rate: the un-exempted version measured 94.6%, the correct one 80.7%.

## What changed

One production file, `src/sim/cpu.ts`. A new knob `lockDiscipline: 0 | 1` (easy 0, normal 1, hard 1)
gates every site, because `easy` is frozen byte-for-byte and the fix moves the RNG stream.

Two predicates, hoisted above the countdown (stream-neutral — no `rand()` between):

```ts
const canAct = ACTIONABLE.has(me.state);
const guardEligible = canAct || me.state === "blockstun";
```

| site | predicate | why |
|---|---|---|
| `blockTicks` countdown | `guardEligible` — **cancel**, not pause | a decision must not survive the exchange that voided it, the same rule and the same verb as `cancelEpisode()` |
| the guard press | *none needed* | `blockTicks` is already 0 whenever ineligible |
| `reacted` latch (F7) | `guardEligible` | a roll spent while locked LATCHES, so the attack cannot be rolled for again |
| `punished` latch | `canAct` | blockstun can hold a guard but cannot swing |
| `antiAired` latch | `canAct` | same |

Plus F12: `wakeupArmed` arming is gated on `wakeupChance > 0`.

**Cancel, not pause**, and the wake-up latch needed no change as a result: with the hold cancelled
during the stun, `blockTicks` is 0 on the wake-up tick, so step 2 no longer returns early. Pausing would
instead have handed the CPU a full 18-tick hold on wake-up and postponed its reversal.

**Not changed: the `cooldown--`.** QA recommended gating it too. Measured, that makes hard *worse*
(36.0%, normal 5.9%) because the cooldown then stops ticking through the CPU's own recovery and the
effective cadence gets longer. Rejected on the number.

## The re-tune, in two rounds — the second forced by Gate 2

Round one. The fix looked like a 40-point buff (56.8% → 94.6%) right up until the proxy was repaired.
Against an opponent that can block, the *unmodified* Phase 22 controller scores **30.1%**, so the
re-tune direction was **up**, not down: `attackCooldown` 35 → 20 (hard), 39 → 32 (normal).

Round two. **Codex Gate 2 found that the repaired proxy still could not whiff-punish.** Its guard branch
returns before the punish branch and kept returning through the opponent's recovery — and for a light,
recovery begins at frame 7 while `seenAttackFor > 6` becomes true at frame 7, so the punish was
unreachable by exactly one tick. Measured over 24 matches: **6,971 guard returns during recovery against
92 punishes.** Suppressing guard during recovery (the same `guardSuppressed` rule the CPU applies to
itself) takes that to 0 and 240 — and drops hard from 66.7% to **41.1%** at an unchanged knob table.

Repairing only that produced the mirror error: an opponent that punished 100% of windows with **zero**
reaction delay while its guard had a 6-tick one. A human has one reaction time. The punish now shares
the guard's clock, which is both more honest and what stops the cadence sweep chasing an opponent no
person can play like.

Against that opponent cadence saturates — cooldown 20 → 10 moves hard only 32.7% → 37.8% — because the
binding constraint is conversion, not tempo: the proxy converts every window it sees, the CPU converted
54% once per window. So the second round moved the CHANCE knobs: hard `punishChance` 0.54 → **0.97**,
`blockChance` 0.47 → **0.90**, `reactionTicks` 7 → **6**; normal 0.48 → 0.65, 0.42 → 0.60. Cadence stayed
at 20/7 and 32/12.

## Gate results

Swept on seeds **1001–1096 only**. Every block below was never looked at during tuning.

| block | hard | normal | easy | KO |
|---|---|---|---|---|
| GATE 101–148 | 59.0% [49.9, 67.5] | 19.0% | 0% | 100% |
| fresh 201–248 | 64.2% | 15.0% | 0% | 111% |
| fresh 301–348 | 65.5% | 17.0% | 0% | 102% |
| fresh 401–448 | 56.1% | 16.0% | 0% | 104% |
| fresh 501–548 | 64.9% | 14.6% | 0% | 102% |
| fresh 601–648 | 58.0% | 16.7% | 0% | 102% |
| **BIG 2001–2200** (200 seeds) | **64.8% [60.3, 68.9]** | 10.9% | 0% | 102% |
| **pooled, six 48-blocks** | **61.3% (410/669), Wilson [57.5, 64.9]** | | | |

Inside the 60–70% design target with the whole interval inside the 55–75% band. Phase 22's equivalent
spread was 53.0–65.8% (sd 4.8) with one fresh block falling *through* the 55% floor — and against an
opponent that guarded nothing.

All four easy trace hashes hold, each checked against the **old** (pre-Phase-22) controller rather than
re-baselined against this build.

```
npm test          449 passed (22 files)     [was 436]
npm run build     ✓ built in 3.52s, tsc --noEmit clean
npm run test:e2e  191 passed (15.0m)        [no flake, two consecutive runs]
npx playwright test e2e/cpu-difficulty.spec.ts e2e/qa19-adversarial.spec.ts   21 passed
```

## The two review gates

**Gate 1 (plan): BLOCK.** Six findings, all accepted. The load-bearing one was that cancelling the hold
on every `!ACTIONABLE` tick conflates blockstun with genuinely discarded decisions — the same defect the
QA agent found from the other direction, and worth 14 points of win rate. It also caught that the
`easy` bypass predicate was underspecified in the plan prose, that a standard deviation is not a bound,
and that the `1e-12` mutation trick does not work on a boolean knob (it is truthy).

**Gate 2 (diff): BLOCK-WITH-FIXES.** Six findings, all accepted, all fixed:

1. **The repaired proxy still could not whiff-punish** — the guard branch returned through recovery and
   beat the punish branch by exactly one tick. This invalidated round one of the re-tune and forced
   round two. The single most valuable finding of the session.
2. **My blockstun regression test was vacuous.** It set `guardIntent` by hand and asserted
   `Fighter.guarding`, which is a fact about box data — true with or without the exemption. Replaced
   with a controller-level test, verified by mutation: removing the exemption takes it from 93% to
   **0/990**. Exactly the class of defect this phase exists to remove, shipped by me, inside the phase
   that exists to remove it.
3. **A production defect:** the three one-shot latches gated on `myReach.max` while the swing was
   range-checked against whichever normal the per-tick roll picked, so in the annulus between the two
   reaches a window was latched and the swing then refused. The heavy roll now happens before the
   latches and all four agree on one distance.
4. **The e2e driver still used the discredited 12-tick delay** and asserted no blocks. Repaired, and it
   now asserts the guard connects.
5. **The Masher claim was overstated** (see F2 above).
6. A missing locked-then-free case for the guard roll — added: an attack whose entire startup happens
   during blockstun still gets its roll, asserted as a rate across 60 seeds.

Gate 2 also independently confirmed easy's byte-identity by tracing `next()` against the indexed
predecessor, and confirmed the seed sets are disjoint by reconstructing the generated values.

## What is NOT fixed

- **The masher sweeps every tier (F2).** Frame data, out of scope. Pinned by a test that asserts the
  defect and says to promote it to a real gate when the frame data changes.
- **Anti-air is inert in play (F8).** Confirmed with a controlled measurement — swings per descent tick
  vs per *ascent* tick, same tier, same cadence, differing only in the condition the branch keys on:
  hard 2.55% vs 2.03% (ratio 1.26), and with `antiAirChance` neutered 2.05% vs 2.26% (0.91). Normal's
  ratio is **0.78**, i.e. no detectable effect at all. The branch adds ~0.5pp on hard and nothing on
  normal. This phase did not change it. The knob's own docstring already admits the ceiling: a real
  anti-air needs the jump ARC, not just `vy > 0`. **No test was added** — the signal is too weak to
  assert without flakiness, and a flaky test is worse than none.
- **Whether hard *feels* fair on a device.** Still no human play session, still no touch confirm.
- **Proxy over-fit.** The proxy is now much better, but it is still one scripted opponent. QA's attack 5
  showed hard beats only opponents that throttle their own offence; the passive three (turtle,
  whiff-punisher, runaway) beat **all three tiers 100%**, so they do not discriminate tiers either.
