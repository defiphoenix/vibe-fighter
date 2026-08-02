# Next-session prompt — D11: the block hold that burns while knocked down

*Copy everything below the line into a fresh session.*

---

Vibe Fighter (c:\Claude\Street-Fighter) — fix D11, the CPU block hold that is spent while the CPU is
knocked down. **And independently QA the CPU strength pass that precedes it, which has never been
QA'd.**

## Context (carry forward)

- Deterministic 60 Hz sim in `src/sim/` — pure, imports NO Phaser, no `Date.now`, no `Math.random`.
  Phaser is a render/input adapter only.
- **The immediately preceding work is Phase 22, the CPU strength pass. It is UNCOMMITTED, NOT deployed,
  and NO independent QA agent has ever run against it** — its only reviews were two Codex passes.
  Read `docs/phases/22-cpu-strength.md` first; it lists exactly what it does and does not cover.
- Prior CPU decisions you must not silently undo: the Phase-19 reach derivation (`reachOf`, `min`/`max`),
  the Phase-21 20-tick committed approach episode (now three-way), and Phase 22's four free-swing
  behaviours and their four holding rules in `docs/sim-invariants.md`.
- A push to `main` IS a production deploy. Do not push, do not deploy.

## The defect (D11)

`CpuController.blockTicks` decrements unconditionally at the top of `next()`, and the guard branch
returns `input.block = true` regardless of the CPU's own state. But `Fighter.think()` early-returns on a
STUN state (`hitstun`/`blockstun`/`knockdown`) **before** the guard branch is reached, so the press is
discarded. Net effect: a block hold rolled while the CPU is knocked down is spent doing nothing, and the
CPU stands up holding only whatever tail is left.

This interacts with Phase 22's wake-up latch — a CPU that wakes into a live block hold postpones its
reversal — so the two must be reasoned about together, not separately.

It was diagnosed during Phase 22 and deliberately left alone: it is a fifth behaviour change on top of
four, and it perturbs the guard timing Phase 13b was tuned against.

## Task

Two things, in this order.

**1. Independent QA of Phase 22 (do this FIRST, before changing anything).** Spawn a QA agent whose brief
is to find assertions in `src/sim/cpu.test.ts` and `e2e/cpu-difficulty.spec.ts` that pass for the wrong
reason, and to check the Phase 22 claims against the code rather than against each other. Specifically
ask it to attack:
   - the held-out-seed gates — is 101–148 genuinely independent of the tuning, or did tuning leak?
   - the two "easy is byte-identical" trace hashes — do their fixtures actually reach the guard branch,
     the punish branch, the anti-air branch and the retreat branch? A hash whose fixture never executes
     a path proves nothing about that path, which is exactly how the first one was a false green.
   - `chanceFloor`/`chanceCeiling` — can any behaviour test pass with its branch neutered?
   - the ladder harness's three hand-rolled substitutes for `advance()` (input gate, per-round
     `reset()`, `DAMAGE_SCALE`) — is anything else `advance()` does still missing?
   - whether Hard is *readable* — does it have patterns a player could learn, or does it just win?
   Report what it finds before touching D11.

**2. Then fix D11.** The likely shape is gating the `blockTicks` countdown and/or the guard press on the
CPU being able to act at all — but derive it, do not assume it; there is more than one defensible
answer and the interaction with `wakeupArmed` is the interesting part.

## Scope lock

ALLOWED: `src/sim/cpu.ts` and its per-difficulty parameters, `src/sim/cpu.test.ts`, and the e2e specs
that already cover the CPU (`e2e/cpu-difficulty.spec.ts`, `e2e/qa19-adversarial.spec.ts`). Docs and
memory updates at the end.

FORBIDDEN: fighter frame data, damage, hurt/hit boxes, stats, `public/configs/character-gym.json`.
No new dependencies. No art, audio, or asset-pipeline changes. No `git push`, no `vercel` deploy.

## Hard constraints

- **`easy` must stay byte-identical.** Two trace hashes in `cpu.test.ts` pin it (`bd99b475` idle
  opponent, `477eba3b` attacking opponent). If your change moves either, you have changed a tier that is
  supposed to be frozen — gate the change on a knob the way Phase 22's four behaviours are, or explain
  why the hash legitimately moves and re-baseline against the OLD controller, not against your new one.
- **Human-vs-human must stay bit-identical** — hash `d9d977af` in the same file.
- Deterministic and seeded. Same seed + same inputs = same match.
- Difficulty stays ONE code path and three parameter tables. No `if (difficulty === 'hard')`.
- The CPU must not read uncommitted input and must not get frame-1 omniscience.
- **Every behavioural change lands with a test you have watched FAIL first.**
- **Never seed a CPU test with small sequential integers.** `cpu.ts` runs raw xorshift32 with no
  warm-up; on a tiny seed the first output is ~0.00006, so the CPU passes the first chance it rolls and
  an earlier branch swallows the one you are testing. Use the `seeds()` helper already in the file.
- **A roll gated on a zero knob must not consume its draw** — that is what keeps `easy` frozen.

## Plan first — do not implement until I approve

1. QA findings from step 1, verbatim, with your accept/reject and reasons.
2. Diagnosis of D11 backed by file:line and a measured number — how often does a block hold actually
   burn during a stun, per tier, on the shipped roster? Measure it; do not estimate.
3. The change, and what it does to the wake-up latch.
4. Re-run the Phase 22 gate table (it is in `docs/phases/22-cpu-strength.md`) and state the before/after
   numbers. If Hard drifts outside 55–75%, re-tune and say so.
5. Risks: guard timing vs Phase 13b, mobile/touch CPU-only, the round/meter systems.

## Review gates — both mandatory

- **Gate 1:** `/codex:rescue` reviews the plan before I approve it. Report findings verbatim, state
  which you accept and which you reject with reasons, revise, then stop.
- **Gate 2:** `/codex:rescue` reviews the diff after QA is green.

## Stop and ask me before

Deleting any file, adding any dependency, touching anything outside the scope lock, pushing, deploying,
or any point where you are under 95% sure what I want. Batch your questions.

## Done when

- The independent QA of Phase 22 is reported and its findings resolved or explicitly rejected.
- D11 is fixed with a watched-red test.
- `npm test`, `npm run test:e2e`, `npm run build` all green, with real output shown.
- The Phase 22 gate table still holds (or the drift is reported and re-tuned).
- All three trace hashes still pass, or a moved one is justified and re-baselined against the old build.
- Both Codex reviews complete.
- `docs/phases/`, `docs/sim-invariants.md`, `docs/history.md`, `docs/lessons.md` and the project memory
  updated.
- Every dev server and background process you started is killed.
