# Phase 07 — UI + Prop Atlases  `[art]`

**Goal:** Create the HUD art (health bar with a transparent fill slot, portrait base) and a set
of animated stage props.

**Source:** PDF recipe step 8 (`prompts.txt:76-86`); Video Step 10 (15:23).

**Verbatim source prompt:**
> Generate a UI atlas with $imagegen we can use for the game — a health bar (with appropriate
> transparent areas for the dynamic health fill) and a portrait base we can drop each character's
> portrait into. Use a magenta (#ff00ff) chroma background for the transparent areas so we can key
> it out locally.
>
> In parallel, generate a separate atlas of animated props for the twilight stage — crowds, roof
> vents, beacons, steam — that we can use to give the background some depth. $imagegen.

**Repo-adapted task:** Generate with the **Higgsfield CLI** (`higgsfield generate create
nano_banana_pro …` — Codex `$imagegen` isn't wired; see the [Phase 03 log](03-concept-mockups-log.md)).
Produce (a) a UI atlas — health bar with a transparent fill slot + portrait base, magenta `#ff00ff`
chroma keyed out locally; (b) a prop atlas — crowds, roof vents, beacons, steam. UI atlas feeds
[Phase 14 HUD](14-hud-skin.md); props feed [Phase 08 stage runtime](08-stage-runtime-and-preview.md).

**Tool / Skill:** **Higgsfield CLI** for generation; **Codex** (`codex:rescue`) for review; chroma-key processing per [asset-manifest.md](../asset-manifest.md).

> **The chroma pipeline already exists — reuse, don't rebuild.** Phase 04 hit the same wall (no
> Higgsfield image model emits alpha, so magenta + local key is the only route) and left
> [`scripts/key-layers.py`](../../scripts/key-layers.py) behind: a flat-void key with a soft matte,
> proper unpremultiply despill on edge pixels, and a per-image void-flatness assert. Lift its
> `key()` / `despill()` for the atlases; the rest of that file is Phase-04-specific validation.
> Verified there: `nano_banana_pro` honours "solid flat `#FF00FF` void" almost exactly (void std
> 1.6, 99.93% within 30 of pure, 1-row transition, zero residue), so this spec's `#ff00ff` chroma
> plan is sound. Two traps for an **animated** prop atlas specifically: the model inflates any
> requested band/cell size ~3×, and it will not honour a grid just because you ask — measure the
> emitted frames, don't assume them.

**Deliverables:** `public/ui/hud-atlas.png` + atlas JSON; `public/props/twilight-atlas.png` + JSON.

**Acceptance criteria:**
- Health bar has a clean transparent fill slot after chroma keying (dynamic fill can be composited).
- Portrait base accepts a Phase 06 portrait without seams. **The portrait's shape is specified
  nowhere else** — build the base to the contract in the
  [Phase 06 log](06-select-portraits-log.md): **1792×2400 (0.7467:1)**, the bust **bleeds off the
  bottom edge** (so a rectangular slot butts against it with no seam — do not leave a gap under the
  chest), backdrop **baked in** and **not keyable** (0 px magenta; `key-layers.py` does not apply).
- Prop atlas frames key out cleanly and can animate.

**Depends on:** [02](02-asset-provenance-and-pipeline.md) (chroma pipeline), [03](03-concept-mockups.md),
[06](06-select-portraits.md) (the portrait base must fit the portraits — added in Phase 06; the
criterion above already required it, but the dependency was missing).

**Current-state delta:** **Missing** — HUD is currently vector-drawn (`src/render/hud.ts`), no atlas art.
