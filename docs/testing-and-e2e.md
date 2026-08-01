# Testing, E2E, and tooling gotchas

Commands are in [`../CLAUDE.md`](../CLAUDE.md#commands). The measurement philosophy behind the art/box
gates is [`lessons.md`](lessons.md).

## Unit tests (vitest, node env)

Tests live next to code as `*.test.ts` and drive the sim directly via `World.tick()` with crafted
`InputSnapshot`s. `combat.test.ts` covers hit/block/trade rules; `regression.test.ts` pins specific
ordering bugs (labelled P1-1, P2-1, …).

**Render-layer logic gets tested by being MOVED out of the scene.** `edge-latch.ts`, `flow-state.ts`,
`anim-timing.ts`, `camera-frame.ts`, `viewport.ts`, `touch.ts`, `audio-cues.ts`, `meter-view.ts`,
`hud-entrance.ts` and `super-cutin.ts` are Phaser-free modules precisely so vitest's node env can reach
them — if a scene rule has an edge case, that's the move, not a browser test.

**A regression test you haven't watched FAIL is decoration.** Re-introduce the bug, confirm the test goes
red, restore. Phase 10 shipped two fakes before a real one: the first never triggered the code path it was
named after, the second could pass vacuously on `undefined === undefined` (assert `typeof x === "number"`
when reading a value through a DEV hook).

**The same rule applies to a test you wrote five minutes ago, in good faith, that is not a regression test
at all.** A unit test tallying `makeRoll` over wall-clock-spaced seeds looked like real coverage of the CPU
pick; removing the Knuth mix, removing the 4-draw warm-up, and swapping in a deliberately striping LCG all
left it green, because large seeds decorrelate on their own. It was deleted, and the measurement it was
standing in for was written into the phase log instead. Before keeping a test, mutate the thing it claims to
guard and watch it go red — if nothing you can plausibly break turns it red, it is decoration no matter how
good the assertion reads.

**A test built on `config.ts`'s `TEST_DUMMY` cannot see a defect that lives in the SHIPPED registry.** The
fixture is hand-authored and does not move when `public/configs/character-gym.json` does. Phase 19 trimmed
all 21 attack widths and `cpu.test.ts` — which builds from the fixture — stayed green through a CPU that
dealt ZERO damage for a whole round on one of the three real fighters. `probe/koprobe.test.ts` has the same
blind spot by construction. **When a change edits the registry, at least one test must READ the registry.**

**A screenshot catches what no test can.** Phase 11's two worst defects (invisible cards, everything dim)
both passed the full unit + e2e suite. Look at it.

**A reviewer's finding can be real while its diagnosis is wrong — re-derive, don't apply the patch.** Phase
10's QA agent correctly measured input being swallowed after a reset and blamed an `EdgeLatch`/keydown race
that is impossible (keydown is emitted before the scene's `update`); the actual cause was a reset loop next
door. Take the *symptom* as evidence and the *cause* as a hypothesis.

`probe/koprobe.test.ts` sits outside `test.include` on purpose: it is the manual ticks-to-KO balance probe
(the CPU-difficulty measurement), not a test, and `npm test` never runs it. **No CLI flag reaches it** —
Vitest 4 dropped `--include`, and `--dir`/a path filter still intersect with the configured `include`, all
reporting `PASS (0)`. To run it, widen `test.include` in `vite.config.ts` or copy the file under `src/` for
the run.

## Playwright E2E (`e2e/`)

The sim/animations only advance inside Phaser's game step, which **headless Chromium throttles/pauses**
(reports the page hidden → `HIDDEN` → `loop.pause()`). So a spec: (1) `window.__game.loop.stop()` then pumps
`window.__game.step(t, 1000/60)` as the sole clock; (2) drives P1 input via the DEV
`window.__holdP1(Partial<InputSnapshot>)` seam; (3) pumps past the intro phase (`INTRO_TICKS=90`), which
gates input, before expecting movement.

**Correction (2026-07-28): "trusted keyboard events don't reach Phaser headless" is FALSE for the match
scene**, and this file and a spec header both asserted it for several phases. `page.keyboard.down("e")`
fires the super end to end — measured. The `__holdP1` seam is still the right default (it expresses a
one-frame edge in one frame, and reaches states a key cannot), but it injects *after* `InputReader`, so a
spec using it proves the latch→sim plumbing and **not** the binding table. `special-per-fighter.spec.ts`
presses the physical `E` for exactly that reason. Two rules survive unchanged: the seam FORCES the pressed
flag true every frame, so holding it two pumped frames double-fires; and a key press still needs pumped
frames around it to be seen.

**All of that lives in `e2e/harness.ts`** (Phase 16) — `ready` / `pump` / `keys` / `press` / `pumpUntil` /
`waitForMatch` / `toFlow` / `driveTo1v1`, imported by every driving spec. It used to be twelve hand-copied
sets, i.e. twelve places for the rules above to drift. Two live bugs were found purely by merging them, both
below. **`ready(page, {route, needs})` is parameterised by the DEV globals the spec actually drives** — each
scene publishes a different set at a different point in `create()`, so waiting on the wrong one means
driving a half-built scene; each spec keeps a one-line wrapper under its old name so call sites are
untouched.

- **`/` boots the MENU, not a match** — any spec that wants a match must navigate to **`?scene=match`**
  (DEV-only route). Boot pulls the whole sprite/stage/portrait set through the dev server, so the per-test
  timeout is **60 s** and the older specs' internal boot waits are 30 s. If a spec fails inside `ready()`'s
  `waitForFunction`, suspect boot cost, not the assertion.
- **`workers` is capped at 4** in `playwright.config.ts` — every worker cold-boots the whole asset set
  through one dev server, and past ~4 concurrent boots they starve each other and specs whose bodies take
  milliseconds time out at random. **A "new spec broke three unrelated ones" result is usually contention,
  not a regression**: re-run the suite without the new file before believing it. A spec whose BODY is
  genuinely expensive should call `test.slow()` (`cpu-difficulty.spec.ts` does).
- **The DEV `__holdP1`/`hold` seams FORCE a pressed flag true every frame**, whereas the real `InputReader`
  emits `*Pressed` as a 1-frame RISING edge. Holding it two pumped frames = two edges = a double-fire under
  the (correct) input buffer; specs must feed a 1-frame edge (`pump(1)`).
- **Batch the round-trips.** A spec that alternated `hold()` / `pump()` / read ~45 times grazed the timeout
  and went flaky; running the whole scripted sequence inside ONE `page.evaluate` that returns the observed
  states is stable and loses no coverage (the sim is deterministic).
- **`pump()` takes a delta** — passing `0` gives a frame that advances no sim tick, which is how the sub-tick
  phase bugs are reproduced deterministically instead of hoping for a short frame.
- **`game.loop.now` STOPS UPDATING after `loop.stop()`**, so the usual `let t = g.loop.now` at the top of
  `pump()` re-reads the same frozen value on every call: N separate `pump(1)`s all replay roughly the same
  wall-clock instant. Sim ticks still advance (they count frames), so anything driven by `world` is fine —
  but anything keyed off the `timeMs` Phaser hands `Scene.update` (today: only the HUD's low-health blink)
  looks frozen. Drive such a sequence from ONE `page.evaluate` that keeps its own accumulating `t`. This cost
  a QA pass a false "the HUD is frozen" finding.
- **Tween callbacks never fire under the pump**, so a spec can only wait on `Time.Clock`-driven progress —
  pump in a bounded loop until the expected global appears, never "one more frame". Corollary worth saying
  out loud, because a spec header got it backwards for four phases: the lock-in flash is a TWEEN and does
  **not** advance under the pump at all. What carries FlowScene to the match is `time.delayedCall`. A comment
  can describe a mechanism that does not exist and nothing goes red.
- **A "wait until X appears" loop must check BEFORE it steps, and must not step in chunks.** The original
  waited in 20-frame blocks, so it routinely overshot by ~20 ticks. Invisible until a spec measures something
  the overshoot already consumed — it made a test counting `INTRO_TICKS` read 70. `pumpUntil` now checks
  first and runs the whole loop inside ONE `page.evaluate`: minimum frames, one round trip. **An assertion on
  an absolute tick count is measuring the harness as much as the sim** — prefer checking the count against
  what the sim says is left (`match.introTicks`).
- **A spec that writes `public/configs/character-gym.json` is using live ammunition.** `withRegistryLock`
  serialises WRITERS only; the readers booting matches on the other three workers are unsynchronised, so the
  write must be atomic (temp + rename) or a concurrent boot can read a truncated file. But `renameSync`
  throws EPERM on Windows when another process holds the file open — and when that happened inside a
  `finally`, the restore never ran and the REAL registry shipped a 21-damage monk into every later spec. Four
  unrelated cases failed; only `git checkout` recovered it. So the restore retries and falls back to an
  in-place write: **a torn read by one worker is a bad day, a permanently mutated registry is a corrupted
  repo.** Mutate the MONK only (no other spec asserts his numbers), and prefer a change whose direction
  cannot break a reader — raising `walkSpeed` can only help a "moved at least N" assertion.
- **A worker-scoped shared page was tried for boot cost and REVERTED — don't re-buy it.** On paper it removes
  nearly every `page.goto`, which is the dominant cost (a case measured 4s alone against 114s in the full
  suite; that 28x is contention, not work). In practice giving up per-test isolation produced the corrupted
  registry above, an intro assertion that silently began measuring the harness, and a case that went from 4s
  to a 180s timeout. What survives is the cheap half: a SECOND scene entry inside one case uses
  `toFlow`/`scene.start` rather than a reload (`cpu-difficulty.spec.ts` has done this since Phase 11). Boot
  cost is not reducible from inside a spec file; budget for it instead — `test.setTimeout` is a BOOT
  allowance, the same kind as the 30s inside `ready`.
- **A touch spec needs a FULL device profile, not `hasTouch: true`.** `e2e/mobile-touch.spec.ts` uses
  `devices["Pixel 5 landscape"]` minus `defaultBrowserType` (which cannot be set inside a `describe` — it
  forces a new worker). A bare `hasTouch` flag on a desktop context leaves `any-pointer: fine` TRUE, so the
  whole phase switches itself off and every case passes for the wrong reason; the first case in that file
  asserts the classification itself for exactly that reason. Real touch events go through
  `page.touchscreen.tap` or CDP `Input.dispatchTouchEvent` — **never `__holdP1`**, which injects after
  `InputReader` and would prove nothing about the touch wiring.
- **Two things make a touch spec silently vacuous**, both found by mutation testing here: (1)
  `setInteractive()` defers insertion into the input list until the next scene pre-update
  (`InputPlugin.js:487`), so pump a frame after creating a tap target before tapping it; and (2)
  **`scale.canvasBounds` is refreshed by a 500 ms POLL** — tap the centre of the *canvas* computed after that
  poll, never the centre of the viewport. A stale-bounds tap transformed to game y ≈ −334, hit nothing, and
  passed a spec whose feature had been deleted. Derive a tap target from `getBounds()`, not from `x`/`y`,
  which are anchored by the object's ORIGIN.

## Tooling gotchas

- **A `codex:rescue` review DOES run inside plan mode.** Two real constraints, neither about plan mode: (1)
  the forwarding subagent **hard-refuses any prompt that mentions relayed authorization** ("the user
  confirmed…") — phrase the task plainly, describe the design, ask the questions, say "read-only, do not edit
  files"; (2) that subagent is scoped to a single `task` call, so it **cannot poll or return its own result**
  — fetch it yourself:
  `node ~/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs result <task-id>`
  (`… status` lists jobs, `… status <task-id>` shows live phase). A review takes several minutes; poll in a
  background Bash loop rather than blocking. If it refuses citing plan mode, update the Codex CLI; it also
  defaults to `--write`.
- **A `codex:rescue` review of a file OUTSIDE the workspace root hangs silently** — Codex sat 9 minutes
  frozen mid-read with no error on a plan in `~/.claude/plans/`. **Inline the file's text into the prompt**
  instead of passing its path, or copy it in-tree. In-tree files read fine.
- **`taskkill /PID` from the Bash tool needs `MSYS_NO_PATHCONV=1`** — Git Bash rewrites the leading `/PID`
  into a path and the kill silently fails. It generalises to any Windows tool taking a `/FLAG` argument.
- **`convert` on PATH is Windows NTFS `convert.exe`, not ImageMagick** — never call it.
- Real git history starts **2026-07-22**; `git stash`/`diff`/`log` all work. Notes older than that saying
  "there is no VCS safety net" are stale — except for the gitignored `concepts/` art, which is still only on
  this machine.
