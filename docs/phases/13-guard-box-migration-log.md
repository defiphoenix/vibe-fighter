# Phase 13 log — Guard-Box Migration (Per-Frame)

**Gate: PASSED** — 2026-07-23. 220 unit tests (14 files), 51 Playwright e2e, `npm run build` green.
Plan Codex-reviewed once before approval ("safe with listed fixes", 6 findings folded in), the diff
Codex-reviewed once after ("equivalence holds", 2 Medium findings, both fixed).

## What the phase actually was

A **migrate/extend, not a rebuild** — the phase spec said so, and the code agreed:

| Piece | Found | Did |
|---|---|---|
| Two-check resolution (overlap-then-guard) | present (`combat.ts`) | nothing |
| Guard as per-frame geometry | missing — guard was two `CharacterConfig` arrays, overlaid globally | built |
| `FrameOverride.guardStand`/`guardCrouch` | authored + stored since Phase 09, consumed by **nothing** | wired in |
| High/low decided by `y` band | present (Phase 09 / crouch-block pass) | nothing |

The single change underneath everything: `FrameBoxes` gained `guardStand`/`guardCrouch`, and
`CharacterConfig`'s two arrays were **removed**. `CharacterData.boxes.guard*` stays the authoring
**template** that seeds every frame of a guardable state. Because the seed set is *exactly* the old
`guarding` state list, and the shipped roster is all `scale: 1` with no overrides, the migration is a
provable no-op on the game as shipped.

Block **art** (a `block`/`blockCrouch` state + sheets) was in the original plan and **dropped
mid-planning at the user's call**. The 16 states are unchanged; a guarding fighter is still drawn by
`idle`/`crouch`/`blockstun`. `sprite-schema.md`'s "block high / block low → Phase 13" line now says so
rather than pointing forward.

## 1. Per-frame data + the seed set

`isGuardableState()` in `types.ts` names `idle/walkF/walkB/crouch/blockstun` — the set the pre-13
`guarding` getter accepted (`ACTIONABLE ∪ blockstun`). The builder seeds those states' frames from the
template and leaves every other state's guard arrays `[]`. `stats.scale` walks the frame guards in the
same single post-override traversal as hurt/push/hit, so authoring stays unscaled.

**Both stances are carried per frame, not one resolved array.** `crouchIntent`, not the state, picks
between them at read time (`Fighter.guardBoxes`). That matters for exactly one state: `blockstun` has
a single body and no stance of its own, so the two-array shape is the only thing keeping a
crouch-blocker's low guard up while stunned. A single-array shape would have silently regressed it.

## 2. `guarding` derived from data, enforced in the builder

`Fighter.guarding` is now `grounded && guardIntent && guardBoxes().length > 0` — derived from the box
data instead of a duplicated state list, so the two can't drift. `guardBoxes()` and `activeBoxes()`
share one `currentFrame()` clamp (`Math.min(stateFrame, len-1)`), the same clamp `activeBoxes` always
used.

The plan review's one **High** finding: deriving legality from data means malformed data could switch
guard on mid-attack, and `config.ts` calls `assembleCharacter()` with **no validator in front**. So
`isGuardableState` is enforced in the **builder** (it drops a guard override on a non-guardable state)
as well as the validator (which rejects it, so a hand edit is never silently swallowed).

## 3. The live proof runs on `crouch`, not `blockstun`

The other plan-review finding that changed the tests: the obvious per-frame proof — override a
`blockstun` frame and watch the block change — cannot work. `advanceTimers` never advances
`stateFrame` during stun and `blockstun` ships with one authored slot, so such a test proves assembly
and nothing about gameplay. `crouch` has 2 looping slots that alternate every tick, so an override
that parks `guardCrouch` above the head on frame 1 flips the *same* crouch-light attack from a chip
(contact on frame 0) to a clean hit (contact on frame 1), in a real `World`. The test asserts the
emitted `block` vs `hit` event and the defender's crouch frame at contact, with an unguarded control
so two whiffs can't read as a pass.

## 4. Gym edits the stance template

Guard is authored as a stance, so a Gym guard edit writes `data.boxes.guardStand`/`guardCrouch` (all
frames) via a new Phaser-free `src/render/gym-persist.ts` — testable in the node env, like
`anim-timing.ts`/`edge-latch.ts`. Two things the diff review confirmed had to be right:

- The Gym shows a **scaled view of the template**, not the assembled frame's guard box. Editing the
  frame's box and saving it as the template would smear a hand-authored per-frame override across
  every frame. `guardView` scales the template; `persistGuard` divides it back.
- A template write touches **every** frame's independent clone, so a guard edit re-assembles
  (`rebuild()`); a per-frame body edit still just redraws.

## Findings from review that changed the code

**Codex (plan)** — 6 findings, all folded in before coding: the `blockstun` live-proof trap (§3), the
builder-must-enforce-guardability point (§2), the scaled-template display (§4), a Gym rebuild-vs-redraw
correction, a missing Gym-persistence unit test (→ `gym-persist.test.ts`), and a vacuous case in the
shipped blocking matrix (`registry.test.ts` `continue`d past every whiffing gap and asserted nothing —
now requires ≥1 connected gap per matchup/move, watched failing with `GAPS=[9999]`).

**Codex (diff)** — 2 Medium, both fixed:
- `persist()` rebuilt a frame's override from hurt/push/hit alone, **silently deleting** a pre-existing
  per-frame guard override on that frame. `mergeFrameOverride` in `gym-persist.ts` carries the guard
  fields across a body edit. (The Gym never authors such an override itself, but a hand-authored JSON
  can, and that is the file the Gym round-trips.)
- `gym-guard.spec.ts` and `phase11-flow.spec.ts` both snapshot/overwrite/restore the ONE registry file
  under `workers=4` — a real clobber race. `e2e/registry-lock.ts` (atomic-`mkdir` cross-worker mutex)
  now serializes both critical sections. Separately, the first `gym-guard` draft parked *jiujitsu's*
  guard off-screen and failed a concurrent `crouch-block` (brawler vs jiujitsu); the spec now edits
  **monk**, never a default-match fighter, so its write window is benign to the rest of the suite.

## What this phase deliberately did NOT do

- **No block art / `block` states.** Geometry + plumbing only; `STATE_NAMES` stays 16 (user call).
- **No `blockstunCrouch`.** The two-array shape keeps a crouch-blocker's low guard correct while
  stunned; that is the part that matters, and the art is shared.
- **No stun-frame progression.** The diff review is right that `blockstun` can't animate its box slots,
  but that is a behaviour change to every stun state, not a guard migration.
- **No per-frame guard authored into the shipped roster.** The capability is proven by tests; varying
  the numbers would be a balance change wearing a migration's clothes.
