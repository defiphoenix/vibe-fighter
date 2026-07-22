# Phase 01 — Architecture Log (gate result)

Evidence that Phase 01 passed. Recorded 2026-07-16. Phase 01 is a **plan-first, doc-only** phase —
no `src/**` changes were made. Its deliverable, a consolidated architecture note + prioritized gap
list, is [`docs/architecture.md`](../architecture.md); this log certifies the three acceptance
criteria in [01-architecture-and-delta-plan.md](01-architecture-and-delta-plan.md) lines 36–40.

## Acceptance criteria

### 1. The plan reuses `src/sim/` (no from-scratch rewrite) — PASS
The architecture note affirms the sim as the authority and states the stance "extend the sim,
don't rewrite it" ([architecture.md](../architecture.md)). No source was touched this phase; no
later phase (02–16) proposes rewriting the sim — build phases extend or render it, art phases
produce standalone assets, gate phases QA it. The hard rule (`src/sim/` pure, NO
Phaser, deterministic, integer ticks @ 60 Hz) is restated and cross-linked to `CLAUDE.md` as the
authoritative reference — not re-documented, so the two cannot drift.

### 2. Every gap in PRD.md maps to a later phase — PASS
Explicit crosswalk against the actual source of gaps — [`PRD.md`](../PRD.md)'s **"Not built"**
list (lines 50–53) and its four **"Delta nuances"** (lines 55–62) — not merely the traceability
tables. No orphans:

| PRD gap (source) | Owning phase(s) |
|---|---|
| art / spritesheets | [02](02-asset-provenance-and-pipeline.md) (pipeline) + [03](03-concept-mockups.md)–[07](07-ui-prop-atlases.md) (art) |
| `public/` + asset pipeline | [02](02-asset-provenance-and-pipeline.md) |
| `public/configs/*.json` | [09](09-fighter-registry-gym-config.md) (`character-gym.json`) + [08](08-stage-runtime-and-preview.md) (`stages.json`) |
| **splash / menu / character-select scenes** | **[11](11-menus-modes-versus-cpu.md)** — see note below |
| parallax stage runtime + camera scrolling | [08](08-stage-runtime-and-preview.md) (runtime) + [12](12-core-combat-camera-integration.md) (group camera) |
| Character Gym tooling | [09](09-fighter-registry-gym-config.md) |
| Playground tooling | [10](10-fighter-playground.md) |
| meter specials + multi-hit combos | [15](15-specials-meter-combos.md) |
| CPU controller | [11](11-menus-modes-versus-cpu.md) |
| distinct 2nd / 3rd fighters | [05](05-character-references.md) (refs) + [09](09-fighter-registry-gym-config.md) (config) |
| *Delta nuance:* guard character-level → per-frame | [13](13-guard-box-migration.md) |
| *Delta nuance:* `hasHit` single-connect → multi-hit | [15](15-specials-meter-combos.md) |
| *Delta nuance:* fixed single screen → camera/scroll | [08](08-stage-runtime-and-preview.md) |
| *Delta nuance:* hardcoded duplicate configs → JSON | [09](09-fighter-registry-gym-config.md) |
| Audio | none — explicit **non-goal** ([PRD.md](../PRD.md) line 36) |

**Worked case (why the crosswalk, not just traceability):** the "splash / menu / character-select
scenes" gap is listed as one line in `PRD.md`, and `traceability.md` row "Menu → mode → stage →
character select flow" points to Phase 11 — but the *scene chain* itself (splash → main menu →
mode → stage → select → "Round 1… Fight!") is only spelled out inside
[11-menus-modes-versus-cpu.md](11-menus-modes-versus-cpu.md). The mapping holds; it just needs the
owning phase doc to be fully explicit. Verified there.

### 3. First-pass constraints satisfied by the current repo — VERIFIED (not assumed)
Each of the three constraints checked against real code (full evidence table in
[architecture.md](../architecture.md)):
- **Two players / one keyboard** — two bindings ([`src/scenes/input.ts:15-17`](../../src/scenes/input.ts#L15-L17)) both attached to the single `scene.input.keyboard` ([`input.ts:28-38`](../../src/scenes/input.ts#L28-L38)); two-fighter drive at [`src/sim/world.ts:36`](../../src/sim/world.ts#L36).
- **Light + heavy** — [`src/sim/types.ts:39-50,64`](../../src/sim/types.ts#L39-L50), [`src/sim/fighter.ts:81-82`](../../src/sim/fighter.ts#L81-L82), [`src/sim/config.ts:74-95`](../../src/sim/config.ts#L74-L95).
- **Dedicated match scene** — [`src/scenes/MatchScene.ts:14,31`](../../src/scenes/MatchScene.ts#L14), [`src/main.ts:17`](../../src/main.ts#L17).

## No-regression check
Doc-only phase — no `src/**` changed, so the Phase 00 green baseline holds by construction.
`npm test` (15 tests) and `npm run typecheck` re-run at gate time to confirm no drift.

## Gate status: PASSED
Architecture affirmed (sim is pure + authoritative; extend, don't rewrite), gap list adopted and
crosswalked with no orphans, first-pass constraints verified against code. Proceed to
[Phase 02 — Asset provenance & pipeline](02-asset-provenance-and-pipeline.md).
