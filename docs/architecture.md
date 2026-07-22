# Vibe Fighter — Architecture Note (Phase 01)

The plan-first architecture affirmation for building the fighting game **on top of** the starter,
not rewriting it. This note is deliberately thin: it states the one rule everything follows,
draws the layering boundary, proves the first-pass constraints against real code, and names the
accepted gap list. Module-by-module detail lives in [`CLAUDE.md`](../CLAUDE.md) — the
authoritative architecture reference — and is **not** duplicated here.

Produced for [Phase 01](phases/01-architecture-and-delta-plan.md); certified in
[01-architecture-log.md](phases/01-architecture-log.md).

## The hard rule

**`src/sim/` is pure and imports NO Phaser.** It is a self-contained, deterministic 60 Hz
simulation:

- No Phaser anywhere under `src/sim/` — [`types.ts:1`](../src/sim/types.ts#L1) states it, and
  Vitest runs the sim in the `node` environment precisely because it has no browser dependency.
  Determinism extends the rule: no `Date.now`, no `Math.random`, no DOM (see
  [`CLAUDE.md`](../CLAUDE.md) Architecture section).
- **Timing is always in integer ticks @ 60 Hz**, never wall-clock seconds. Space is pixels.
- Determinism is the whole point: identical inputs produce identical state, which is what makes
  the sim unit-testable (`combat.test.ts`, `regression.test.ts`) and, later, replay/netcode-ready.

**No later phase (02–16) rewrites this sim** — build phases extend or render it, art phases produce
standalone assets, gate phases QA it. See `CLAUDE.md` for the module-by-module breakdown and the
authoritative `tick()` step order.

## Layering boundary

```
        INPUT (keyboard)
            │  latched edges (survive a 0-tick render frame)
            ▼
  ┌───────────────────────────┐        reads state, draws boxes
  │  src/sim/   (AUTHORITY)    │ ─────────────────────────────────┐
  │  pure · deterministic · 60Hz                                   │
  │  World.advance(dt, inputs) → tick()×N                          ▼
  └───────────────────────────┘        ┌─────────────────────────────────┐
            ▲                           │  render adapter (Phaser)         │
            └───────────────────────────│  src/scenes/ · src/render/       │
             feeds inputs each frame    │  src/main.ts                     │
                                        └─────────────────────────────────┘
```

The sim is authoritative; the render layer is a thin adapter that (1) reads keyboard input and
**latches rising edges** until a sim tick actually consumes them (so a press survives any render
frame whose ticks were all non-actionable — intro/roundEnd/matchEnd/hitstop, where `advance()`
reports 0), (2) calls `World.advance(dt, inputs)`, and (3) draws the resulting state — both
fighters as per-state animated sprites (hitboxes only in the toggleable debug overlay). The sim
never calls up into Phaser. (This note is Phase-01 era; the file:line refs below are approximate
and drift as code moves — trust the file, not the number.)

## First-pass constraints — verified against code

The phase spec's three first-pass constraints are satisfied by the current repo — **verified with
file:line evidence, not assumed**:

| Constraint | Status | Evidence |
|---|---|---|
| Two local human players sharing one keyboard (P1 + P2) | ✅ Confirmed | Two hardcoded bindings — P1 WASD+F/G, P2 arrows+`,`/`.` — at [`src/scenes/input.ts:15-17`](../src/scenes/input.ts#L15-L17), both attached to the one `scene.input.keyboard` in the constructor ([`input.ts:28-38`](../src/scenes/input.ts#L28-L38)); `read()` returns a two-element tuple ([`input.ts:41-43`](../src/scenes/input.ts#L41-L43)); the sim drives two fighters via `advance(dt, inputs: [InputSnapshot, InputSnapshot])` ([`src/sim/world.ts:36`](../src/sim/world.ts#L36)). |
| Two attack buttons — light and heavy | ✅ Confirmed | Still two buttons (light/heavy edges in the FSM). Since the resolution pass each button resolves to one of six attack *slots* by stance — ground/air/crouch × light/heavy — via `ATTACK_STATE_TO_KEY` and `attacks: Record<AttackKey, …>` ([`src/sim/types.ts`](../src/sim/types.ts)); `startAttack` picks the variant in [`src/sim/fighter.ts`](../src/sim/fighter.ts). |
| A dedicated match scene | ✅ Confirmed | `MatchScene extends Phaser.Scene` (key `"Match"`) at [`src/scenes/MatchScene.ts:14,31`](../src/scenes/MatchScene.ts#L14); registered in the Phaser game at [`src/main.ts:17`](../src/main.ts#L17). |

## Accepted gap list (the prioritized forward plan)

The prioritized gap list Phase 01 requires **already exists** and is hereby adopted as the
authority: the **[`PRD.md`](PRD.md) phase index** (00–16) together with its **"Not built"** and
four **"Delta nuances"** sections, cross-referenced by the **[`traceability.md`](traceability.md)**
source-step→phase and parity→phase tables. Every gap maps to a later phase with no orphans — the
item-by-item certification is in [01-architecture-log.md](phases/01-architecture-log.md).

**Stance: extend the sim, don't rewrite it.** The four verified delta nuances that shape later
phases:

| Delta nuance | Why it's not "validate" | Owning phase |
|---|---|---|
| Guard boxes are **character-level** arrays, not per-frame (`FrameBoxes` has only hurt/push/hit) | Migrate/extend into per-frame geometry | [13](phases/13-guard-box-migration.md) |
| `hasHit` dedups an attack to **one** connect | Multi-hit combos missing | [15](phases/15-specials-meter-combos.md) |
| `constants.ts` modelled a **fixed single screen** | **Scrolling shipped in Phase 08** (world `STAGE_WIDTH=1696` > `VIEW_WIDTH=1280`, follow-camera); only group-camera / zoom framing remains | [08 ✓](phases/08-stage-runtime-and-preview.md) scroll · [12](phases/12-core-combat-camera-integration.md) zoom |
| Fighters were **hardcoded duplicates** | **Shipped in Phase 09** — JSON registry (`character-gym.json`) + distinct data-driven fighters | [09 ✓](phases/09-fighter-registry-gym-config.md) |

## Related docs

- [`CLAUDE.md`](../CLAUDE.md) — authoritative architecture reference (sim module map, `tick()` step order, conventions).
- [`PRD.md`](PRD.md) — vision, scope, phase index, current baseline.
- [`traceability.md`](traceability.md) — source-step→phase and README-parity→phase→acceptance-test tables.
- [Phase 01 spec](phases/01-architecture-and-delta-plan.md) · [Phase 01 gate log](phases/01-architecture-log.md).
