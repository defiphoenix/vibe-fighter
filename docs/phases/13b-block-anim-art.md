# Phase 13b — Block Animation Art  `[DONE 2026-07-24]`

**Status: shipped.** Option A (full) — dedicated held-guard states `block` (high) + `blockCrouch`
(low). `GUARDABLE` SWAPPED to `{block, blockCrouch, blockstun}` (idle/walk/crouch dropped; no shipped
guard overrides on them, so no data lost). `ACTIONABLE` gained both (for cpu.ts's reaction timer; jab-
out works independently). `STATE_NAMES` 16→18. 6 Seedance clips (~84 credits, zero retries). Gates
green: 220 unit + 54 e2e, typecheck/build, check:sprites/audit:anim; adversarial QA agent found no
defects; Codex reviewed plan + diff (mergeable). **Blockstun re-entry seam — FIXED:** the block sheets
were regenerated to OPEN already braced (frame 0 = the held guard pose, started from each fighter's own
validated guard frame in `concepts/characters/guard-refs/`), so re-entering guard after a blockstun
replays guard→guard with no wind-up. brawler/blockCrouch drifted upward on regen and was pinned to a
static crouched-guard hold (its guard-ref copied to all 4 frames); the other five hold their
regenerated braces. ~168 credits total.

---

**Original handoff brief.** Phase 13 made guard boxes per-frame but deliberately shipped **no block
art**: a guarding fighter is still drawn by `idle`/`crouch`/`blockstun`. This phase adds real block
poses. It was scoped and costed at the end of the Phase 13 session; start here.

---

## Kickoff prompt (paste this to start the session)

> Read `docs/phases/13b-block-anim-art.md`. Implement block animation art for the three fighters
> (brawler / jiujitsu / monk). Load `superpowers:brainstorming`, the Phaser `animations` skill, and the
> `higgsfield-generate` skill before planning; read `docs/art-pipeline.md` for the sprite pipeline.
> First resolve the two decisions in the brief (reuse `blockstun` for the standing hold vs a new
> `block` state; and the FSM/`isGuardableState` shape) with me before you plan. Then plan it, have
> Codex review the plan, implement TDD, regenerate the art, run the art gates + full unit/e2e suites,
> and have Codex review the diff. Check the Higgsfield balance first and tell me the real credit spend
> as you go.

---

## What exists / what's missing

- Guard is per-frame geometry (Phase 13). The FSM plants a guarding fighter in `idle` (high) or
  `crouch` (low) via the guard branch in [`fighter.ts`](../../src/sim/fighter.ts) `think()`.
- `blockstun` art already exists and is a braced-forearm pose ("raises both forearms into a tight
  defensive block and braces in place") — but it's the **hit-reaction** state, played only after a
  blocked hit, not the held guard.
- Missing: a **held** standing block pose and a **held** crouching block pose.
- `STATE_NAMES` is **16** (`validate-character.ts` + the `StateName` union in `types.ts`). The art
  scripts, `check-sprites.py`, `audit-animations.py`, and BootScene's preload all key off that list.

## Decision 1 — how many new states (this sets the credit cost)

| Option | New states | Clips | Credits (≈14/clip) | Trade |
|---|---|---|---|---|
| **A. Full** (recommended) | `block` + `blockCrouch` | 6 | ~84 first-try, **~100–140** with crouch retries | Distinct held-guard poses top and bottom; cleanest read |
| B. Low-only | `blockCrouch` only, reuse `blockstun` art for the standing hold | 3 | ~42–70 | Cheaper; standing guard reuses the brace pose, which is *close* but is really the hit-reaction |

Balance at last check: **266 credits** (Higgsfield ultra) — either option fits. **Confirm A vs B before planning.**

## Decision 2 — FSM + guardable-state shape

Dedicated block states change more than art. Resolve in the plan:

- `isGuardableState` (in [`types.ts`](../../src/sim/types.ts)) currently = `idle/walkF/walkB/crouch/blockstun`. If a guarding fighter now enters `block`/`blockCrouch`, those must be **added** (or swapped in), or the per-frame guard boxes won't seed onto the state the fighter is actually in — and blocking silently breaks. This is the load-bearing edge; pin it with a test that a real `World` still blocks after the FSM change.
- The `think()` guard branch must set `block`/`blockCrouch` instead of `idle`/`crouch`.
- Attacking **out of** block: today the guard plant stays `ACTIONABLE` (you can jab out of a block). Keep that — either add the new states to `ACTIONABLE`, or make the attack check independent of it. Decide and test (`cpu.ts` reads `ACTIONABLE` for its reaction timer — check it doesn't regress).
- Held pose, not a loop: a looping guard sheet whose first frames are a wind-up reads as popping in and out of block (the exact Phase-09 `crouch` bug). Author one-shot into a braced hold (`loop:false`, hold last frame) like `blockstun`, **not** a loop.

## Code touchpoints (every place a state is enumerated)

- `src/sim/types.ts` — add to the `StateName` union; add to `isGuardableState`; maybe `ACTIONABLE`/attack path (Decision 2).
- `src/sim/fighter.ts` — `think()` guard branch → `block`/`blockCrouch`; guard-out-of-block attack path.
- `src/sim/validate-character.ts` — `STATE_NAMES` 16→18 (or 17 for option B).
- `src/sim/character-builder.ts` — new states are simple held states (`simpleState`, `loop:false`), seeded guard like the other guardable states. Body template: `stand` for `block`, `crouch` for `blockCrouch`.
- `public/configs/sprite-schema.md` — the state table + the "block high / block low" note (currently says Phase 13 skipped the art).
- `src/render/anim-timing.ts` — held states keep authored `fps`; they are NOT stun-timed and NOT attacks, so no change needed beyond confirming they fall through to `meta.fps`.
- `src/render/characters.ts` / BootScene — `eachSheet` iterates `STATE_NAMES`, so the new sheets preload automatically once the JSON lists them.

## Registry (`public/configs/character-gym.json`, ×3 fighters)

- `data.frames`: add `block`, `blockCrouch` counts (start ~4, mirror `blockstun`/`crouch`).
- `render.sheets.block` / `.blockCrouch`: `{ path, frames, fps, loop:false }`. Reference shapes:
  - `blockstun`: `{"frames":4,"fps":8,"loop":false}`
  - `crouch`: `{"frames":4,"fps":12,"loop":false}`

## Art pipeline (`docs/art-pipeline.md` is the full reference)

1. Add `[block]` and `[blockCrouch]` MOTION entries to `scripts/gen-sprite-videos.sh` (and to its default `STATES` list). A held brace fills the clip already, so **no `SPAN_CLIP`** needed; do NOT say "subtle" (reads as "don't move").
   - `block` ≈ "settles into a tight high guard, both forearms up covering the head and chest, and braces there, weight shifting only slightly."
   - `blockCrouch` ≈ the deep-crouch prompt discipline from crouch attacks: "squatting all the way down, thighs parallel to the ground, NEVER stands up, NEVER lies down," forearms up in a low guard.
2. **Monk `blockCrouch` needs a start-image override** — reuse `concepts/characters/crouch-refs/monk-crouch.png` (same as his other crouch states) with a `MOTION_FROM_START` entry, or he'll stand up. Jiujitsu can start from his own `crouch/03.png` (already deep, already on the void).
3. `bash scripts/gen-sprite-videos.sh <fighter> block blockCrouch` per fighter → ffmpeg samples N frames.
4. **Do NOT regenerate `idle`** — `build-sprites.py` derives the per-fighter scale from `idle` frame 0, so touching it rescales every other sheet and invalidates the measured contact frames. Build order stays: idle already done → `npm run build:sprites` → `npm run check:sync --write` (only if any attack idle changed — here it won't).
5. Gates: `npm run check:sprites` (`block`/`blockCrouch` are held, not attacks — they're not in the `ATTACK_STATES` MOTION_MIN check, but `check-sprites.py` `UPRIGHT` height-share may want `block` added; `blockCrouch` is a crouch, leave it out). `npm run audit:anim` for a movement sanity read.
6. **Look at the contact sheets** — crouch drift is per-subject and invisible to the gates; the visual check is load-bearing.

## Gotchas carried from Phase 09/12/13

- Crouch poses drift (monk worst); budget 1–2 regens on the three `blockCrouch` clips — that's the ~84→~140 credit spread.
- `--start-image` DOMINATES the prompt: supply the stance as the start frame and ask the prompt for the hold alone.
- A held state that loops reads as popping in/out of block. `loop:false`, hold last frame.
- Failed Higgsfield jobs cost 0; redirect **stdout only** (`2>&1` corrupts the JSON).
- `check:sync` order matters only if an idle changes — it won't here.

## Verification

`npm test`, `npm run build`, `npm run test:e2e`, the art gates above, a visual contact-sheet pass, and
Codex review of both plan and diff. Add a test that a real `World` still blocks high and low after the
FSM/`isGuardableState` change (Decision 2 is the thing most likely to silently break blocking).
