# Phase 02 — Asset Provenance & Pipeline  `[build]`

**Goal:** Decide where every sprite/animation comes from, define the sprite/atlas schema
(frame size, anchor, fps, animation keys, chroma-key), and stand up `public/` + a loader so
later phases have real assets to wire. **This phase exists because the recipe assumes bundled
spritesheets that do not exist in this repo.**

**Source:** Video Step 5 "Character Sprites & Animations" (06:13); PDF steps 9 & 15 (which
reference already-bundled sheets); [asset-manifest.md](../asset-manifest.md).

**Verbatim source prompt:** *(none in the PDF — the recipe treats sprites as pre-bundled. Video
framing: sprites/animations were produced with the creator's own tool, "Spriterrific".)*

**Repo-adapted task:**
- Choose a provenance per asset (creator's **free asset pack** at https://aiod.dev/nkl if its
  license permits, **Codex `$imagegen`** for static art, or a sprite skill for sheets) and
  record it + license in [asset-manifest.md](../asset-manifest.md).
- Define the schema: uniform frame size, **feet-centered anchor** (must match `src/sim/geometry.ts`
  `+y`-up-from-feet convention), fps, per-state animation keys, magenta `#ff00ff` chroma for keyed transparency.
- Create `public/` (Vite static root — does not exist yet) with `sprites/`, `ui/`, `props/`,
  `backgrounds/`, `configs/` subfolders.
- Wire a Phaser preloader in `BootScene.ts` (currently a placeholder) to load an atlas/sheet and prove one animation plays.

**Tool / Skill:** `phaserjs/phaser@sprites-and-images`, `find-docs` (Phaser 4 loader/atlas API).

**Deliverables:** populated [asset-manifest.md](../asset-manifest.md), `public/` tree, a working `BootScene` preload of at least one test sheet.

**Acceptance criteria:**
- One fighter animation loads and plays in a scene (replaces a box) at the authored fps.
- Sprite anchor aligns with sim boxes when overlaid with the debug box view (`B` toggle).
- Every asset row in the manifest has a chosen source + license before Phase 09.

**Depends on:** [00](00-source-research-and-baseline.md), [01](01-architecture-and-delta-plan.md).

**Current-state delta:** **Missing** — no `public/`, no asset loading, `BootScene` preloads nothing.
