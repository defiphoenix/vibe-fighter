# Phase 11 — Menus, Modes, Versus Flow & CPU  `[build]`

**Goal:** Thread the full Play flow — splash → mode (1v1 / 1vCPU) → stage select → character
select (portraits, big cards, lock-in) → versus match with "Round 1... Fight!" — and add a CPU
controller for 1vCPU.

**Source:** PDF recipe step 11 (`prompts.txt:121-137`); Video Step 9 flow (14:55).

**Verbatim source prompt:**
> Now let's get the main flow in. Play -> 1v1 or 1vCPU. Level selection -> [rooftop twilight,
> rooftop sunset] using nice cards that show the names. In character selection, if it's 1vCPU the
> player picks freely and then the CPU picks; add a nice selection effect — a brief pause while
> the choice flashes to lock in. In 1v1, WASD moves the selection for P1 (indicated) and the
> arrows move P2 (indicated); they can't choose the same character, so they skip over one. Make
> the character-select screen nice and use the portraits — big cards. Start the match with a
> 'Round 1... Fight!' text before the players can move and attack.
>
> In the playground we need to be able to save the character stats to file as a config so they
> apply in the main game and can be loaded. (When I tried to save the jiu-jitsu fighter's scale it
> said 'target not found'.) For now restrict the selectable characters to the brawler and the jiu-
> jitsu fighter; in 1v1 moving the selection just swaps them since there's no room. Also show the
> bounds toggle in the main match too.

**Repo-adapted task:** Add the scene chain (splash, menu, mode-select, stage-select,
character-select) ahead of `MatchScene`, wiring stage + fighter choices into the match. Use
Phase 06 portraits on big cards.

> **This phase owns the portrait runtime handoff** (assigned in Phase 06, which produced the masters
> but deliberately did not decide how they load). `concepts/` is authoring art and nothing loads from
> it, so **this phase must produce the shipped copies** — the equivalent of what Phase 08 does for
> backgrounds. The masters are `concepts/portraits/2026-07-17/{brawler,jiujitsu,monk}.png`, 1792×2400
> at 0.7467:1, ~3 MB each, backdrop **baked in** (nothing to key — do *not* run `key-layers.py`).
> **Downscale, never regenerate.** The Phase 06 README's recommendation, to accept or replace:
> `public/ui/portraits/<id>.png` for the ~300×400 card, and a **top-anchored square crop** for
> Phase 14's HUD slot. Contract + rationale: [Phase 06 log](06-select-portraits-log.md) and
> [its README](../../concepts/portraits/2026-07-17/README.md). P1=WASD, P2=arrows select with distinct indicators; same-character
lockout. Add a **CPU controller** (an `InputSnapshot` producer for the sim — the sim already
consumes injected inputs) for 1vCPU. Match starts with a gated "Round 1... Fight!" intro (the sim
already has an `intro` phase in `match.ts` — drive the announce off it). Recipe restricts the
roster to brawler + jiu-jitsu for the first pass; restore the boxer for parity in [Phase 16](16-integration-parity-qa.md).

**Tool / Skill:** `frontend-design`, `ui-ux-pro-max`, `motion-design` (lock-in flash), `phaserjs/phaser@game-setup-and-config`.

**Deliverables:** splash/menu/mode/stage/character-select scenes; CPU controller; scene→match parameter passing.

**Acceptance criteria:**
- Full flow reaches a match with the chosen mode, stage, and fighters; no dead-ends.
- 1vCPU: player picks, CPU picks with a lock-in flash, match runs vs CPU.
- 1v1: independent P1/P2 selection with indicators and same-character lockout.
- "Round 1... Fight!" gates input until the intro completes (reuses sim `intro` phase).

**Depends on:** [06](06-select-portraits.md), [08](08-stage-runtime-and-preview.md), [09](09-fighter-registry-gym-config.md).

**Current-state delta:** **Missing** — game boots straight into `MatchScene`; no menus, no character select, no CPU.
