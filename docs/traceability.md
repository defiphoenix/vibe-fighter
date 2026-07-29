# Traceability Matrix

Maps every source requirement (PDF recipe step, video chapter, README parity item) to the
phase that owns it, the current repo state, and the acceptance test that proves it done.
No parity item should be orphaned.

## Source-step → phase

| PDF step | Video chapter | Phase | Notes |
|----------|---------------|-------|-------|
| — | Step 1: Context (02:40) | [00](phases/00-source-research-and-baseline.md) | Starter = platformer template that already had the per-frame box system |
| 3 Architect the game | (covered in Step 1) | [01](phases/01-architecture-and-delta-plan.md) | Plan-first; audit starter, list gaps |
| — | Step 5: Character Sprites & Animations (06:13) | [02](phases/02-asset-provenance-and-pipeline.md) | **Added.** Recipe steps 9 & 15 assume bundled sheets that don't exist locally |
| 4 Concept mockups | Step 2 (03:16) | [03](phases/03-concept-mockups.md) | 4 SNES mockups, lock one direction |
| 5 Parallax backgrounds | Step 3 (04:01) | [04](phases/04-parallax-backgrounds.md) | far/medium/main/near layers |
| 6 Character references | Step 4 (05:09) | [05](phases/05-character-references.md) | 3 fighters, full-body isolated |
| 7 Select portraits | Step 8 (14:02) | [06](phases/06-select-portraits.md) | upper-body portrait per fighter |
| 8 UI + prop atlases | Step 10 (15:23) | [07](phases/07-ui-prop-atlases.md) | health bar + portrait base + animated props; magenta chroma |
| — | (implied by parallax) | [08](phases/08-stage-runtime-and-preview.md) | **Added.** Layers → playable stage + camera bounds; 2 variants |
| 9 Register fighters & hitboxes | Step 6: Character Gym (09:19) | [09](phases/09-fighter-registry-gym-config.md) | registry data entry + per-frame boxes + gizmos + JSON persist |
| 10 Fighter Playground | Step 7 (11:59) | [10](phases/10-fighter-playground.md) | fixed-axis sandbox, live stat tuning, dummy |
| 11 Menus, portraits, versus | Step 9 (14:55, flow) | [11](phases/11-menus-modes-versus-cpu.md) | mode → stage → char-select → "Round 1, Fight!" + CPU pick |
| 12 Core combat, rounds, timer, camera | Step 9: Core combat loop (14:55) | [12](phases/12-core-combat-camera-integration.md) | z-order, facing flip, damage, best-of-3, timer, group camera |
| 13 Guard-box blocking | (folded into combat) | [13](phases/13-guard-box-migration.md) | **Migrate** guards to per-frame; two independent checks |
| 14 HUD | Step 10: UI & Health Bars (15:23) | [14](phases/14-hud-skin.md) | atlas HUD, dynamic colour, low-health blink, slide-in |
| 15 Meter specials & combos | Step 11: Special Moves & Polish (16:53) | [15](phases/15-specials-meter-combos.md) | meter, multi-hit, super cut-in |
| — | Wrap Up (18:09) | [16](phases/16-integration-parity-qa.md) | **Added.** Full-flow parity + QA |
| — | — | [17](phases/17-meter-lie-and-cpu-pick.md) | **Added.** Post-16 defect pass: the meter lie (R-14), the CPU pick measured, three stale items |
| — | — | [18](phases/18-mobile-touch.md) | **Added.** Mobile + tablet: touch controls, rotate gate, CPU-only mode screen on touch. Not in the source recipe at all |

## README parity item → phase → current state → acceptance test

Parity list from [GitHub README](https://github.com/chongdashu/vibe-fighter).

| Parity item | Phase | Current state | Acceptance test |
|-------------|-------|---------------|-----------------|
| Menu → mode → stage → character select flow | 11, 16 | **Present** (`FlowScene` over the Phaser-free `flow-state.ts`; every step has a back edge and re-entry clears both locks, so no dead-ends) | `flow-state.test.ts` + `e2e/phase11-flow.spec.ts` + `e2e/phase16-parity.spec.ts` |
| 1v1 local (two players, one keyboard) | 11, 12 | **Present** (P1 WASD + F/G/Q/E, P2 arrows + `,`/`.`//`/M) | `e2e/phase11-flow.spec.ts` (1v1 pair boots) + `combat.test.ts` |
| 1vCPU mode + CPU picks a fighter | 11, 16 | **Present** (four mode cards `1v1 / CPU easy·normal·hard`; the CPU's pick is a **seeded uniform draw** over the untaken cards, so it can field any fighter) | `flow-state.test.ts` cpuPick suite + `roll.test.ts` + `cpu.test.ts` + `e2e/cpu-difficulty.spec.ts` + `e2e/phase16-parity.spec.ts` (seeded monk pick) |
| Per-frame hit/hurt/attack boxes, active windows | 09, 12, 13 | **Present** (per-frame `FrameBoxes`, guards included; Gym-authored JSON drives live combat) | `character-builder.test.ts` + `registry.test.ts` + `e2e/gym-guard.spec.ts` + `e2e/phase16-parity.spec.ts` (raw file edit changes live damage) |
| Light + heavy attacks | 12 | **Present** (7 attack states: ground/air/crouch light+heavy, plus the meter special) | `combat.test.ts` + `e2e/phase09-characters.spec.ts` (strike lands on the active window) |
| Geometric guard-box blocking (high/low) | 13, 13b | **Present** (per-frame `guardStand`/`guardCrouch`; `block`/`blockCrouch` are real states; high/low is decided by box overlap, never by a label) | `combat.test.ts` + `registry.test.ts` blocking & special sweeps + `e2e/crouch-block.spec.ts` + `e2e/phase13b-block.spec.ts` |
| Best-of-3 rounds + 60s timer | 12, 16 | **Present** | `combat.test.ts` + `regression.test.ts` + `e2e/phase16-parity.spec.ts` — **two real KOs walk the observed phase sequence to `matchEnd`, and the full 3600-tick clock runs out and resolves on health** |
| Group camera scrolls wide stage | 08, 12 | **Present** (midpoint follow over a 1696px world in a 1280px view, zoom-IN only 1.0–1.25, `MAX_SEPARATION` 1040 keeps both framed) | `camera-frame.test.ts` + `stage.test.ts` + `e2e/camera-group.spec.ts` |
| Z-order + facing flip on crossover | 12 | **Present** (depth follows the most recent MOVER, not position) | `e2e/phase09-characters.spec.ts` (`flipX === facing<0`, depth 11/9) |
| Three fighters (brawler, jiujitsu, **monk**) | 05, 09, 16 | **Present** — the recipe's "boxer" was never built in this repo; the **monk** is the shipped third and became selectable in Phase 16 | `registry.test.ts` + `reach-parity.test.ts` + `flow-state.test.ts` (roster ↔ registry cross-check) + `e2e/phase16-parity.spec.ts` (monk boots with his own art, HUD face and stats) |
| UI-atlas HUD, dynamic fill, low-health blink, entrance | 07, 14 | **Present** (atlas plates + portraits + `introTicks`-derived entrance) | `e2e/phase14-hud.spec.ts` + `hud-entrance.test.ts` |
| Meter specials, multi-hit combos, super cut-in | 15 | **Present** (per-window dedup, `METER_MAX` bar, `repeat` specials, freeze + portrait cut-in, real Seedance `special` sheets, `meter-bar` atlas plate) | `combat.test.ts` hit-count + `registry.test.ts` high/low sweep + `e2e/phase15-special.spec.ts` |
| Parallax stage (twilight, sunset) | 04, 08, 16 | **Present** (2 stages × 3 runtime layers pre-baked to 1697×720; the front `near` occluder is deliberately dropped; the stage pick is honoured at `MatchScene.create`) | `stage.test.ts` + `e2e/stage.spec.ts` + `e2e/phase16-parity.spec.ts` (**both variants build a real match, with different layers**) |
| Audio | — | **Non-goal** | n/a (out of scope) |
| Mobile + tablet play, on-screen touch controls | 18 | **Present** — touch-primary classification (touch AND no fine pointer), 8-button vector pad feeding the same `InputSnapshot`, CPU-only mode screen on touch, tappable menus, rotate gate that also disables Phaser input | `touch.test.ts` (24) + `flow-state.test.ts` (touch mode + `setChar`) + `e2e/mobile-touch.spec.ts` (**11 cases on a real `devices["Pixel 5 landscape"]` profile, including a whole-journey run from the title screen to damage in a live match using only touch events**) |

## Delta legend

**Present** = works in `src/sim/` today · **Extend** = partial, needs additions ·
**Missing** = not started. Each phase file restates its own delta in its "Current-state delta" section.

**Phase 16 filled this table in.** Seven rows were stale — written before Phases 08/11/12/13 shipped
and never revisited — so the matrix claimed "Missing (boots straight to match)" about a flow that had
worked for five phases. That is the same failure the rest of this repo has a rule about: a document
is a claim about the code, and nothing was measuring it. Every `Acceptance test` cell now names a file
that exists; if one is deleted or renamed, this table is wrong again, so treat the paths as part of
the gate rather than as prose.
