# Phase 14 — HUD Skin  `[build]`

**Goal:** Re-skin the existing vector HUD with the UI atlas — both fighters' health bars and
portraits — with dynamic colour, a low-health blink, and a match-start entrance.

**Source:** PDF recipe step 14 (`prompts.txt:166-176`); Video Step 10 (15:23).

**Verbatim source prompt:**
> Integrate the UI elements into the game. Lay out health for the two characters and their
> portraits — make it look good. The health bar should be dynamic and change colour based on the
> amount of health left, plus blink when low. Add some dynamism: at match start the health bars
> fill and the UI slides down.
>
> The slide-down of the UI and the fill need to be a bit slower — right now it's too rapid.

**Repo-adapted task:** A functional vector HUD already exists in `src/render/hud.ts` (bars with
colour/blink, timer text, win pips, announce text). This phase **re-skins** it with the Phase 07
UI atlas: health bar art with the transparent fill slot, portrait base + Phase 06 portraits.
Keep the dynamic colour + low-health blink logic; add the match-start entrance (bars fill + UI
slides down) at a **deliberately slower** tempo (tunable — the original's first cut was too rapid).

**Tool / Skill:** `frontend-design`, `motion-design` (entrance timing), `phaserjs/phaser@game-object-components`.

**Deliverables:** atlas-skinned HUD, portraits wired, match-start entrance animation with a tunable duration.

**Acceptance criteria:**
- Health bar uses the atlas art with a dynamic fill that changes colour with remaining health and blinks when low.
- Both portraits render in the portrait base.
- At match start the bars fill and the UI slides down at a readable (not rapid) pace.
- Timer + win pips remain correct (existing HUD behaviour preserved).

**Depends on:** [06](06-select-portraits.md), [07](07-ui-prop-atlases.md), [12](12-core-combat-camera-integration.md).

**Current-state delta:** **Extend** — vector HUD with colour/blink Present (`hud.ts`); atlas art, portraits, and entrance animation Missing.
