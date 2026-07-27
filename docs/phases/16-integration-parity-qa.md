# Phase 16 — Integration, Parity & QA  `[gate]`

**Goal:** Prove the whole game hangs together and matches README parity: the full flow, all three
fighters, both modes, both stage variants, camera, HUD, specials, rematch, and config reload —
backed by unit tests and a browser smoke test.

**Source:** Derived from the [GitHub README](https://github.com/chongdashu/vibe-fighter) parity
list; Video "Wrap Up" (18:09). See [traceability.md](../traceability.md).

**Verbatim source prompt:** *(none — QA gate.)*

**Repo-adapted task:**
- Restore the **third fighter** that the recipe deferred in [Phase 11](11-menus-modes-versus-cpu.md); confirm all three are selectable and playable.
  **The third fighter is the `monk`, not a boxer** — this line said "boxer" because the README's roster
  does, but no boxer was ever built here: Phase 03 locked brawler / jiujitsu / monk and Phases 05–09
  shipped all three. The monk had full art, portraits, a HUD face and a registry entry the whole time;
  only the select screen's `SELECTABLE` list left him out.
- Walk the full flow end-to-end in both 1v1 and 1vCPU, on both stages.
- Drive a Playwright acceptance test through the DEV `window.__world` hook already exposed in
  `MatchScene.ts` (see `CLAUDE.md`): start a match, land a hit, land a multi-hit special, KO,
  advance rounds, reach match-end, rematch.
- Run `npm run build` (typecheck) + `npm test` (vitest) green; add browser smoke coverage.
- Verify config reload: editing `public/configs/character-gym.json` changes live combat/stats.

**Tool / Skill:** `playwright-cli`, `superpowers:verification-before-completion`, `superpowers:test-driven-development`.

**Deliverables:** a green build + test run, a Playwright smoke test, a filled-in parity checklist in [traceability.md](../traceability.md).

**Acceptance criteria (parity checklist — all must pass):**
- Full flow: splash → menu → mode → stage → character select → match, no dead-ends, both modes.
- Three distinct fighters; two stage variants; group camera scrolls a wide stage.
- Per-frame hit/hurt/guard combat with active windows; light + heavy; geometric high/low block.
- Best-of-3 + 60s timer; z-order + facing flip; rematch/menu.
- Atlas HUD with dynamic fill, low-health blink, match-start entrance.
- Meter specials with a deterministic multi-hit count + super cut-in.
- `npm run build` and `npm test` pass; Playwright smoke test passes.

**Depends on:** all prior phases.

**Current-state delta:** N/A (integration gate). Baseline `combat.test.ts` + `regression.test.ts` already green; extend, don't replace.

---

## Gate results

Plan reviewed by Codex before implementation, diff reviewed after. Both reviews earned their keep:
the plan review caught `cpu-difficulty.spec.ts` (below) and a fallback arithmetic error, and the diff
review caught **three assertions in the new spec that could pass while the product was broken** —
including one where the timer test would have gone green with the lights never connecting, because the
default pair starts 105 vs 100 and `health[0] > health[1]` is true before a single hit lands. That one
was re-verified the hard way: with the brawler's light made unreachable the strengthened test fails
`Expected: < 100, Received: 100`, and without the new assertion it passed.

### What the gate actually found

The parity list was mostly already satisfied — but three of its claims had **no test that could fail**,
and one had no implementation at all.

- **The third fighter was one line.** `FlowScene.ts` carried
  `const SELECTABLE = ["brawler", "jiujitsu"]` with a comment naming Phase 16 as its owner. Everything
  else for the monk was already wired — `BootScene` loads sheets and portraits for *every* registry id,
  `registry.test.ts` and `reach-parity.test.ts` had covered all three since Phase 05, and
  `flow-state.test.ts` even had a forward-looking `count: 3` case. The list now lives in the
  Phaser-free `flow-state.ts` as `SELECTABLE_IDS` and is **cross-checked against the shipped registry**,
  so a built-but-unpickable fighter is a red test rather than a silent omission. That test was watched
  failing (`expected ['brawler','jiujitsu'] to deeply equal ['brawler','jiujitsu','monk']`) — it states
  the Phase 11 bug in one line.
- **The CPU could never pick the monk.** `cpuPick` was `wrap(taken + 1, count)` — always the card
  immediately right of the player. On Phase 11's two-card roster that is the *only* legal answer, so it
  read as correct for five phases; at three cards it meant the monk was unreachable unless the player
  happened to sit on the jiujitsu. Now a uniform draw over the untaken cards, with the sample supplied
  by the caller so `flow-state.ts` keeps its purity promise.
- **`best-of-3` and the 60s timer had no browser proof.** Both existing specs reached the end state by
  *assigning* `world.match.phase`, which skips the rule entirely. The new spec plays two real KOs and
  asserts the phase sequence it **observed** (`intro → fight → roundEnd → intro → fight → matchEnd`),
  and runs the full 3600-tick clock out for real.
- **Nothing tested a raw config edit.** The Playground spec proves the dev *save endpoint* round-trips;
  the parity item asks whether the **file** drives combat. Now covered by writing the bytes, verifying
  the dev server serves them, reloading, and measuring the changed damage in a live hit.

### Two tests that were passing for the wrong reason

Both are the "a metric that cannot fail is decoration" class, and neither was red:

- `e2e/phase11-flow.spec.ts` asserted "no same-character pick" on the premise *"P1 has nowhere to
  move"*. True at two cards, **false at three** — and the assertion still passed by coincidence while
  testing the opposite of its name. Split into a swap test and a skip-over test; the skip branch is
  only *reachable* at three cards, and it was watched failing against the two-card roster.
- `e2e/cpu-difficulty.spec.ts` compares two runs on the premise "same fighters, same seed", but its
  easy run enters through the real select screen while its hard run direct-boots a fixed pair. A
  uniform CPU pick would have had it comparing a monk run against a jiujitsu one, intermittently.
  Seeded, and the pair is now **asserted** rather than assumed. *(Codex caught this one; the plan had
  missed it.)*

### The one defect the gate found by PLAYING, not by testing

**R-13 — the 60s timeout was decided on ABSOLUTE health, across fighters who do not share a health
pool.** The brawler carries 105; the jiujitsu and the monk carry 100. So
`a.health > b.health` handed the brawler every timeout in which both fighters had taken equal
punishment — *including none at all*.

Watched live, at the end of this phase's browser check: monk vs brawler, neither fighter ever hit,
both health bars visibly full, and the match ended **2–0 to the brawler on time**.

```
ids [monk, brawler]  hp [100, 105]  max [100, 105]  wins [0, 2]  winner 1
```

Every unit and browser test passed, because every one of them assigned both healths from the same
implied pool — the asymmetry only exists between *different* fighters, and no test had ever timed out
a mismatched pair. It is the exact shape this repo keeps re-learning: the tests compared code to other
code, and the screen was the only thing that could tell you.

Fixed by comparing the remaining **share**, which is also what the HUD bar draws — the bar had been
right all along; it was the *sim* that disagreed with it. Written cross-multiplied
(`a.health * bMax` vs `b.health * aMax`) rather than as a division, because a **draw** is exactly the
outcome a hair of float error would silently convert into a win, and the shipped pools are integers.
Pinned by R-13 with four cases: the untouched draw, a fighter with fewer points winning on the larger
share, a fighter with more points losing on the smaller one, and a sweep of equal-share pairs across
the two pools. Watched failing first.

This predates Phase 16 (brawler vs jiujitsu had it since Phase 12) but the monk turns it from one
matchup into two thirds of the roster.

### `monk/crouchHeavy` — the animation pass's one open item, closed

Carried over from [the animation/box defect pass](16-animation-box-defect-pass.md): the box far edge
reached 156px while the drawn leg reached 55px, so the sweep connected through **~87px of visible air**
(tolerance 60). It could not be fixed by trimming the box — `reach-parity.test.ts` requires the monk to
be tied-best, and he *was* tied-best at 118, so his trim budget was exactly zero.

Five earlier generations measured 50 / 61 / 57 / 55 / 60px (sd ≈ 4.6) — run-to-run variance swamped
every prompt change, so the +27px was never going to arrive by resampling or rewording. CLAUDE.md had
already named the remaining lever and it was right: **the reference, not the wording.** The shared
`crouch-refs/monk-crouch.png` plants him low *and tucked*, toes under his hips — and the prompt measures
the sweep "past where his own toes are", so the target itself was parked under his own body.

A purpose-built reference fixed it in **one generation**: `monk-crouchHeavy.png`, nano_banana_pro from
`monk-crouch.png` with one thing changed — the lead leg stretched along the floor — then measured
against its parent before use:

| | height | rear extent | forward extent from head centre |
|---|---|---|---|
| `monk-crouch.png` | 1558 | 700 | 512 |
| `monk-crouchHeavy.png` | **1558** | **701** | **820** (+308, 160%) |

One non-obvious step: the generated foot landed **4px from the right edge** of the canvas, leaving the
sweep nowhere to travel. Shifted 260px left with the area preserved to the pixel — *not* rescaled,
because `build-sprites` applies one idle-derived scale to every sheet and a smaller figure here would
have shipped a smaller monk on this state alone.

| | before | after |
|---|---|---|
| limb reach | 55px | **89px** |
| visible air at max range | 87px | **53px** (tolerance 60) |
| forward spread | 9px | **12px** (contact frame stays measurable) |
| `audit:boxes` | 1 REACH-GAP | **0** — *"every attack box agrees with its own sheet"* |

The contact frame stayed measurable, which was the constraint that mattered: phase alignment is worth
more than a few px of reach, and it is the one thing the four earlier attempts never had.

### Final state

| gate | before | after |
|---|---|---|
| `audit:boxes` REACH-GAP | 1 (`monk/crouchHeavy`) | **0** |
| `audit:anim` flagged | 16 | **16** (unchanged, no new flags) |
| `check:sync` indeterminate | 5 | **5** (unchanged) |
| unit | 283 | **299** |
| e2e | 65 | **72** |
| selectable fighters | 2 | **3** |

`npm run build`, `npm test`, `npm run test:e2e`, `check:sprites`, `check:sync`, `audit:anim`,
`audit:boxes`, `check:characters`, `check:portraits` all green.

### Left open, deliberately

- **5 INDETERMINATE `check:sync` sheets** (`monk/airHeavy` 2px spread, `brawler/airLight` 3px,
  `jiujitsu/airLight` 4px, `monk/attackLight` 6px, `jiujitsu/crouchHeavy` contact-on-final-frame). All
  inside the 60px air tolerance, so they keep uniform timing rather than costing a regeneration.
- **`jiujitsu/crouch` stands upright for its first 167ms** (heights 100/100/79/68) while the sim's
  crouch box drops instantly.
- **`e2e/harness.ts` is imported only by the new spec.** The other 14 specs still each re-declare their
  own `ready`/`pump`/`keys`. Retrofitting them is worthwhile but is exactly the change most likely to
  produce a "new spec broke three unrelated ones" result, so it does not belong inside a QA gate.
- **Two of the new cases run close to their budget.** In the full 4-worker run the timer case took 1.9m
  and the three-fighters case 2.0m against `test.slow()`'s 180s — the cost is cold boots and worker
  contention, not the stepping (3600 pumped ticks measured 0.8s in isolation). The suite is green, but
  these are now the first two specs that would go red if boot cost grows. The fix when that happens is
  a shared warm page, not raising `workers`.
