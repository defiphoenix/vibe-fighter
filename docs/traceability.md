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

## README parity item → phase → current state → acceptance test

Parity list from [GitHub README](https://github.com/chongdashu/vibe-fighter).

| Parity item | Phase | Current state | Acceptance test |
|-------------|-------|---------------|-----------------|
| Menu → mode → stage → character select flow | 11 | Missing (boots straight to match) | Manual: navigate full flow to a match; no dead-ends |
| 1v1 local (two players, one keyboard) | 11, 12 | Present (match only) | Two players control independently in a match |
| 1vCPU mode + CPU picks a fighter | 11 | Missing | CPU selects; match starts vs CPU controller |
| Per-frame hit/hurt/attack boxes, active windows | 09, 12 | Present in sim; boxes hardcoded not per-frame-authored | `combat.test.ts` green + Gym-authored JSON drives live combat |
| Light + heavy attacks | 12 | Present (light jab, heavy sweep) | Both normals connect on their active frames |
| Geometric guard-box blocking (high/low) | 13 | Decision rule present; boxes not per-frame | Unit: high light blocked standing, low heavy beats stand guard, crouch blocks low |
| Best-of-3 rounds + 60s timer | 12 | Present | `combat.test.ts` KO→round→match flow; timer expiry decides round |
| Group camera scrolls wide stage | 08, 12 | Missing (fixed single screen) | Camera holds until a fighter gives ground on a >viewport stage |
| Z-order + facing flip on crossover | 12 | Present in sim (facing/depth) | Recent mover draws in front; boxes flip on side-swap |
| Three fighters (brawler, boxer, jiu-jitsu) | 05, 09 | Missing (A/B duplicate) | Three distinct configs selectable |
| UI-atlas HUD, dynamic fill, low-health blink, entrance | 07, 14 | **Present** (atlas plates + portraits + `introTicks`-derived entrance) | `e2e/phase14-hud.spec.ts` + `hud-entrance.test.ts` |
| Meter specials, multi-hit combos, super cut-in | 15 | **Present** (per-window dedup, `METER_MAX` bar, `repeat` specials, freeze + portrait cut-in, real Seedance `special` sheets, `meter-bar` atlas plate) | `combat.test.ts` hit-count + `registry.test.ts` high/low sweep + `e2e/phase15-special.spec.ts` |
| Parallax stage (twilight, sunset) | 04, 08 | **04 art done** (8 layers, 2 stages, `concepts/backgrounds/`); 08 runtime missing | Two stages render with independent layer scroll |
| Audio | — | **Non-goal** | n/a (out of scope) |

## Delta legend

**Present** = works in `src/sim/` today · **Extend** = partial, needs additions ·
**Missing** = not started. Each phase file restates its own delta in its "Current-state delta" section.
