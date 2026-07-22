# Phase 09 — Fighter Registry, Character Gym & JSON Config  `[build/tooling]`

**Goal:** Wire the three fighters in as data-driven entries and author per-frame hit/hurt/attack
(and guard) boxes — including each attack's active-frame window — persisted to JSON that drives
live combat. The Character Gym (translate/scale gizmos) is the optional authoring tool.

**Source:** PDF recipe step 9 (`prompts.txt:87-100`); Video Step 6 "Character Gym" (09:19).

**Verbatim source prompt:**
> Integrate the bundled fighter assets into the Character Gym. Each fighter should be one data
> entry (id, asset paths, animation keys, fps, frame size, anchor) so it auto-wires preload, the
> animation registry, and the gym's dropdown. Do not auto-fit bounds from sprite alpha — leave
> placeholder boxes; I'll author them by hand and save to public/configs/character-gym.json.
>
> How hard is it to adjust the bounds in the Character Gym via gizmos like in Unreal / Unity /
> Blender — two-axis arrows and free movement? Add a mode switcher in the debug panel, hotkeyed to
> Q (translate) and W (scale). Grabbing a box should auto-pause on the current frame and write to
> character-gym.json, flowing to the sidebar fields and live combat.

**Repo-adapted task:**
- "Bundled fighter assets" do **not** exist locally — use the assets chosen in
  [Phase 02](02-asset-provenance-and-pipeline.md). Define each fighter as one registry entry
  (id, asset paths, animation keys, fps, frame size, anchor).
- Move character data out of the hardcoded `src/sim/config.ts` duplicates into
  `public/configs/character-gym.json`, and load it into the sim (keep `sim/` pure — pass parsed
  config in; don't fetch inside `sim/`). Author real per-frame boxes for all three fighters.
- (Optional tooling) Build the Gym scene with Q/W translate/scale gizmos that auto-pause and write JSON.

**Tool / Skill:** `superpowers:test-driven-development`, `phaserjs/phaser@game-object-components`, `find-docs`.

**Deliverables:** `public/configs/character-gym.json`, a config loader feeding the sim, three registered fighters, optional Gym scene.

> **Sprite scale — settle this before authoring boxes.** The sim's fighter is
> `HURT_STAND.h / STAGE_HEIGHT` = 185/720 = **25.7%** of the screen, but the Phase 03 mockups drew
> fighters at roughly **45%** of frame — they assumed a closer camera than the sim has. Phase 04's
> stage art is anchored to the sim's 25.7% figure (props were explicitly sized to it, and verified
> against the real `HURT_STAND` box), so sprites rendered at 185px will sit correctly on the roof
> and next to the AC units. Anything scaled from the mockups' own proportions instead will come out
> ~1.8× too big. If 25.7% turns out to read too small in motion, that is a **sim constant** decision
> (`GROUND_Y` / box heights) with a test + stage-art blast radius — not a per-sprite fudge.

**Acceptance criteria:**
- Three distinct fighters load from JSON (no A/B duplication).
- Editing a box in JSON (or the Gym) changes live combat — verified in a test/match.
- Attack active-frame windows are authored per attack; `combat.test.ts` still green.
- Sim remains Phaser-free (config is injected, not fetched inside `sim/`).

**Depends on:** [02](02-asset-provenance-and-pipeline.md), [05](05-character-references.md).

**Current-state delta:** **Extend** — sim consumes character data, but it's hardcoded duplicates in `config.ts`; no JSON, no registry, no per-frame authoring, no Gym.
