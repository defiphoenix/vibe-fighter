# Vibe Fighter — Project-First Building Guide (PRD)

A phase-by-phase guide for building **Vibe Fighter** — a local two-player Street
Fighter–style 2D game — from the current starter (pure sim + boxes render) to a complete
game with sprite art, menus, per-frame hitbox combat, guard-box blocking, HUD, meter
specials, group camera, and a 1vCPU mode.

This guide reverse-engineers the public build by **[@chongdashu](https://x.com/chongdashu)**
into an executable, dependency-ordered plan you can run one phase at a time.

## Sources

| # | Source | What it gives |
|---|--------|---------------|
| 1 | `prompts.pdf` → `prompts.txt` (repo root) | The verbatim prompt recipe, recipe steps 3–15 |
| 2 | [YouTube walkthrough `en37mtF42eQ`](https://www.youtube.com/watch?v=en37mtF42eQ) | 15 chapters incl. setup Step 1 (Context) and Step 5 (Sprites & Animations); ordering nuance |
| 3 | [GitHub `chongdashu/vibe-fighter`](https://github.com/chongdashu/vibe-fighter) | The finished feature set (README parity list) |

**Original stack:** Codex (OpenAI) + GPT Image 2.0 for art; Cursor + Opus 4.8 for the build;
Phaser 4 + TypeScript. Sprites/animations were produced with the creator's own tool,
**Spriterrific** — see [asset-manifest.md](asset-manifest.md) for how to substitute it.
**Art generation:** the recipe's Codex `$imagegen` was the original plan but is **not usable** —
`codex-cli` has no image-generation subcommand (verified in Phases 03 and 04). Art phases 03–07
generate with the **Higgsfield CLI** (`nano_banana_pro`); Codex is still used, via `codex:rescue`,
to review each art phase's plan and output. See [skills-map.md](skills-map.md) and the
`phase-03-done` / `phase-04-done` memory entries for the generator's gotchas.

## Vision & scope

**In scope (target = README parity):** splash → main menu → mode select (1v1 / 1vCPU) →
stage select → character select (portraits, big cards, lock-in) → versus match. Real
per-frame hit/hurt/attack/guard boxes with active-frame windows; light + heavy normals;
geometric high/low blocking; best-of-3 rounds; 60s round timer; group camera scrolling a
wide stage; z-order + facing flip; UI-atlas HUD with dynamic health fill, low-health blink,
match-start entrance; meter specials with multi-hit combos and a super cut-in finisher;
three fighters (red brawler, green boxer, jiu-jitsu).

**Non-goals** (state explicitly so they are not silently assumed):
- **Audio / SFX / music** — not promised by `prompts.txt` or the public README. Revisit only if desired.
- **Online play / netcode.**
- **Rebindable controls / gamepad** (hardcoded P1 WASD+F/G, P2 arrows+`,`/`.` — a marked `ponytail:` simplification).
- **Building the game itself** — this repo delivers the *guide*; each phase is executed separately.

## Current baseline (what the starter already provides)

The repo is **not** a blank slate. `src/sim/` is a complete, tested, deterministic 60 Hz
simulation. The gap is everything *above* the mechanics layer.

**Already built & tested** (`src/sim/`, `src/render/hud.ts`, `src/scenes/MatchScene.ts`):
FSM movement/jump/crouch, geometric hit/hurt combat, hitstop, pushbox + corner resolution,
facing/depth (z-order) updates, best-of-3 match flow with timer, vector HUD, boxes-only
render, vitest suites (`combat.test.ts`, `regression.test.ts`).

**Not built:** art/spritesheets, `public/` + asset pipeline, `public/configs/*.json`, splash/
menu/character-select scenes, parallax **stage runtime** + camera scrolling, Character Gym +
Playground tooling, meter specials + **multi-hit** combos, CPU controller, distinct 2nd/3rd
fighters (currently one duplicated archetype in `src/sim/config.ts`).

**Delta nuances that change how phases are labelled** (verified against the sim):
- Guard *decision rule* exists (`combat.ts` — did-it-touch + was-stance-up), but `FrameBoxes`
  in `types.ts` has only hurt/push/hit; guards are **character-level arrays**, not per-frame.
  → Guard work is **migrate/extend**, not "validate". See [Phase 13](phases/13-guard-box-migration.md).
- `hasHit` in `fighter.ts` dedups an entire attack to **one** connect → multi-hit is **missing**.
  See [Phase 15](phases/15-specials-meter-combos.md).
- `constants.ts` models a fixed single screen → group camera + scrolling are **missing**. See [Phase 08](phases/08-stage-runtime-and-preview.md).
- Configs are hardcoded duplicates → JSON config loading is **missing**. See [Phase 09](phases/09-fighter-registry-gym-config.md).

## Phase index

Phases are dependency-ordered. **[art]** = Codex image generation; **[build]** = code (Cursor/
Claude Code); **[tooling]** = optional dev tooling (skip if you author data by hand); **[gate]**
= research/QA checkpoint.

| Phase | Title | Kind | Recipe / video source |
|-------|-------|------|-----------------------|
| [00](phases/00-source-research-and-baseline.md) | Source research & verified baseline | gate | Video Step 1 (Context) |
| [01](phases/01-architecture-and-delta-plan.md) | Architecture & delta plan | build | PDF step 3 |
| [02](phases/02-asset-provenance-and-pipeline.md) | Asset provenance & pipeline | build | Video Step 5 (Sprites & Animations) |
| [03](phases/03-concept-mockups.md) | Concept mockups | art | PDF step 4 / Video Step 2 |
| [04](phases/04-parallax-backgrounds.md) | Parallax backgrounds | art | PDF step 5 / Video Step 3 |
| [05](phases/05-character-references.md) | Character references | art | PDF step 6 / Video Step 4 |
| [06](phases/06-select-portraits.md) | Character-select portraits | art | PDF step 7 / Video Step 8 |
| [07](phases/07-ui-prop-atlases.md) | UI + prop atlases | art | PDF step 8 / Video Step 10 |
| [08](phases/08-stage-runtime-and-preview.md) | Stage runtime & preview | build/tooling | Derived (README parallax + camera) |
| [09](phases/09-fighter-registry-gym-config.md) | Fighter registry, Gym & JSON config | build/tooling | PDF step 9 / Video Step 6 |
| [10](phases/10-fighter-playground.md) | Fighter Playground | tooling | PDF step 10 / Video Step 7 |
| [11](phases/11-menus-modes-versus-cpu.md) | Menus, modes, versus flow & CPU | build | PDF step 11 / Video Step 9 |
| [12](phases/12-core-combat-camera-integration.md) | Core combat, camera & integration | build | PDF step 12 / Video Step 9 |
| [13](phases/13-guard-box-migration.md) | Guard-box migration (per-frame) | build | PDF step 13 |
| [14](phases/14-hud-skin.md) | HUD skin | build | PDF step 14 / Video Step 10 |
| [15](phases/15-specials-meter-combos.md) | Specials, meter & multi-hit combos | build | PDF step 15 / Video Step 11 |
| [16](phases/16-integration-parity-qa.md) | Integration, parity & QA | gate | Derived (README parity) |

> **Note on numbering:** the video uses 11 steps and the PDF recipe uses steps 3–15; they
> interleave art and build. This guide re-sequences them by dependency and adds three phases
> the sources assume implicitly (02 asset pipeline, 08 stage runtime, 16 QA). Full mapping in
> [traceability.md](traceability.md).

## How to use each phase file

Every `phases/NN-*.md` has:
- **Goal** · **Source** · **Verbatim source prompt** (quoted from the recipe — historical, may
  reference assets you don't have yet) · **Repo-adapted task** (what to actually run *here*) ·
  **Tool / Skill** (see [skills-map.md](skills-map.md)) · **Deliverables** · **Acceptance
  criteria** · **Depends on** · **Current-state delta** (Present / Extend / Missing).

Run phases top-to-bottom. Art phases (03–07) can be deferred and run *just-in-time* right
before the build phase that consumes them, as the video does — dependencies are listed per phase.

## Glossary

- **Hitbox / hurtbox / pushbox / guard box** — fighter-local AABBs; `+x` = forward (facing), `+y` = up from feet. See `src/sim/geometry.ts`.
- **Active-frame window** — the frames of an attack animation on which its hitbox is live.
- **Hitstop** — brief freeze on both fighters when a hit lands (impact feel).
- **Chip damage** — small damage dealt through a block.
- **Meter / super** — energy bar that, when full, enables a special/super move.
- **Character Gym / Playground** — dev tooling scenes for authoring per-frame boxes and tuning stats (optional; not in the public repo).
- **`ponytail:` comment** — an intentional simplification with its upgrade path noted inline.

## Related docs

- [skills-map.md](skills-map.md) — which skill builds each phase, and install commands.
- [traceability.md](traceability.md) — every source step + README parity item → phase → acceptance test.
- [asset-manifest.md](asset-manifest.md) — every art asset: source, provenance, dimensions, processing, destination.
