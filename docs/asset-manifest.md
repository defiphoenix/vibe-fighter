# Asset Manifest

Every art/audio asset the game needs: its source, provenance/licensing, dimensions, runtime
processing, and destination path. Fill the **Status** column as you generate assets.

> **Provenance warning.** The original build generated sprites/animations with the creator's
> own tool **Spriterrific** (https://aiod.dev/c5h) and static art with **Codex + GPT Image
> 2.0**. Recipe prompts that say assets are "already bundled" (steps 9 & 15) refer to the
> creator's private asset pack. **Locally you have none of these.** Choose a provenance per
> asset below before building phases 09/15. Options: (a) the creator's **free asset pack**
> (https://aiod.dev/nkl) if its license permits reuse; (b) generate fresh via **Codex
> `$imagegen`** (this guide's default for static art); (c) generate animation sheets via a
> sprite skill (see [skills-map.md](skills-map.md) §4). Record which you chose + its license.

## Conventions

- **Transparency via chroma key:** static atlases are generated on a magenta `#ff00ff`
  background and keyed out locally (per PDF step 8). Backgrounds are split as transparent PNGs (step 5).
- **Fighter-local box convention** (already in `src/sim/geometry.ts`): `+x` = forward, `+y` = up
  from feet — sprite **anchor** must match (feet-centered) so authored boxes line up.
- Destination root is `public/` (Vite static dir), created in Phase 02.
- Per-fighter animation config (frame size, fps, anchor, animation keys) is authored in
  Phase 09 and persisted to `public/configs/character-gym.json`.
- **Sprite/atlas schema** (frame size, anchor, fps model, animation keys, transparency) is defined
  in [`../public/configs/sprite-schema.md`](../public/configs/sprite-schema.md) (Phase 02).
- **Provenance policy (chosen Phase 02):** static art + UI/prop atlases → **Higgsfield CLI (`nano_banana_pro`)**;
  character spritesheets → **sprite skill (Phase 09)**; the Phase 02 proof sheet → **programmatic
  placeholder**. All generated in-house, so **License = project-owned/proprietary** across the board
  (no third-party pack pulled, no CC0 dedication claimed). `Status` stays ☐ until each asset is
  actually produced in its phase.

## Test / pipeline proof (Phase 02)

| Asset | Source/provenance | License | Frame size | Anchor | fps | Destination | Status |
|-------|-------------------|---------|-----------|--------|-----|-------------|--------|
| Placeholder idle sheet | programmatic — `scripts/gen-placeholder-sheet.mjs` (stdlib PNG writer) | project-owned/proprietary | 320×256 ×4 | feet-centered | 10 | `public/sprites/test/brawler-idle.png` | ✅ |

## Static art (Higgsfield CLI, `nano_banana_pro`) — Phases 03–07

| Asset | Phase | Source/provenance | License | Dimensions | Processing | Destination | Status |
|-------|-------|-------------------|---------|-----------|------------|-------------|--------|
| 4 concept mockups | 03 | Higgsfield CLI (`nano_banana_pro`), PDF step 4 prompt | project-owned/proprietary | 2752×1536, 4 variants | picked **rooftop-dusk** | `concepts/mockups/2026-07-16/` | ✅ |
| Parallax bg — far (sky) | 04 | Higgsfield CLI (`nano_banana_pro`), 21:9, PDF step 5 | project-owned/proprietary | 3168×1344 | **opaque** RGBA (backmost layer) | `concepts/backgrounds/rooftop-dusk/far.png` | ✅ |
| Parallax bg — medium (buildings) | 04 | Higgsfield CLI (`nano_banana_pro`), 21:9 | project-owned/proprietary | 3168×1344 | magenta `#ff00ff` chroma → key out (`npm run key:layers`) | `.../medium.png` | ✅ |
| Parallax bg — main (roof) | 04 | Higgsfield CLI (`nano_banana_pro`), 21:9 | project-owned/proprietary | 3168×1344, **full-width** (verified: weakest column 100% opaque below the feet line) | chroma key | `.../main.png` | ✅ |
| Parallax bg — near (foreground) | 04 | Higgsfield CLI (`nano_banana_pro`), 21:9 | project-owned/proprietary | 3168×1344 | chroma key + masked to the bottom strip; drawn in front (covers 11% of a standing fighter) | `.../near.png` | ✅ |
| Parallax bg — sunset variant ×4 | 04 | Higgsfield CLI (`nano_banana_pro`), 21:9, **reference-edit** of the dusk `*-raw.png` | project-owned/proprietary | 3168×1344 | chroma key + alpha aligned to the dusk masks | `concepts/backgrounds/rooftop-sunset/{far,medium,main,near}.png` | ✅ |
| Character reference ×3 | 05 | Higgsfield CLI (`nano_banana_pro`), **3:4** (really 0.7467:1), full mockup as `--image` | project-owned/proprietary | 1792×2400, full-body isolated on a nominally `#ff00ff` void (verified: 1 figure, 0 specks, every margin ≥5%, figure 56–77% of frame) | none (reference) — void left in, Phase 09 owns the alpha. **Key by tolerance, not `== #ff00ff`**: only 0.004% of pixels are exactly magenta, the void sits at ~`(252,1,252)` | `concepts/characters/2026-07-17/{brawler,jiujitsu,monk}.png` | ✅ |
| Select portrait ×3 | 06 | Higgsfield CLI (`nano_banana_pro`), **3:4** (really 0.7467:1), Phase 05 reference as `--image`, PDF step 7 | project-owned/proprietary | 1792×2400, upper body (head/shoulders/chest) **bleeding off the bottom edge**, on a **baked** dusk backdrop (verified: 0 px magenta; prompt↔record match; shared 2750-char style block identical ×3) | none — **nothing to key**, the backdrop replaced the void. Do **not** run `key-layers.py` on these, and note `RGBA` on 2 of 3 files is an empty container (alpha is 255 everywhere) | `concepts/portraits/2026-07-17/{brawler,jiujitsu,monk}.png` — **masters**. `npm run copy:portraits` bakes TWO runtime sizes: `public/ui/portraits/<id>.png` (448×600 select cards) and, since Phase 14, `public/ui/portraits/hud/<id>.png` (192×294 HUD faces, cover-cropped to the atlas arch's 300:460 rather than the card's 0.7467:1). The HUD variant exists because Phaser only mipmaps power-of-two textures, so the card into a ~96×147 slot is a raw bilinear squeeze | ✅ |
| UI atlas (health bar + meter bar + portrait base) | 07, meter added 14 | Higgsfield CLI (`nano_banana_pro`), **21:9** (bars) + **3:4** (base), no `--image`, PDF step 8 | project-owned/proprietary | sheet **463×871, 6 frames** — read back off the shipped `hud-atlas.json` on 2026-07-28, when this row still said "463×769, 4 frames" and never mentioned the meter at all, two phases after Phase 14 packed it. `meter-bar` 460×102 at sheet (0, 144), with an enclosed `meter-bar-slot` **370×39** at plate-local (45, 32); packed to the SAME 460 width as the health plate so the two bevels line up, and drawn at the same anisotropic `BAR_SCALE_X`/`BAR_SCALE_Y`. Packing it needed the slot rule's height floor dropped from `0.40` to `0.33` of the plate: the meter's channel is 38% and the old floor had been set from a sample size of one (the health channel's 43%), so it rejected the shallower bar it was asked to accept. `health-bar` 460×144 — the **art** set the height (source 2926×916 = 3.19:1; only the 460 width is fixed, from `hud.ts:5`), with an enclosed `health-bar-slot` **380×62** at plate-local (40, 41) (verified: 1 slot matching the shape rule, 0 stray holes, 100% alpha-0 with no partial pixels; HUD bottom y=208 vs the y=279 a head reaches at a jump's apex). `portrait-base` 463×625 with a **measured** `portrait-slot` **300×460** at 0.6522:1 (plate-local (81, 81)) — the model drew the window at 0.6521:1 and it did not matter, because the slot is the whole window and the consumer cover-crops into it. Both slot figures were stale here until Phase 14 read them back off the shipped JSON: the earlier `384×67` / `300×402 @ 0.7467` describe the abandoned first design, the one whose aspect-fit left Phase 11's black band | magenta `#ff00ff` chroma → key out (`npm run build:atlases`; `key()`/`despill()` from `key-layers.py` via `art_gate.py`) | `public/ui/hud-atlas.png` + `.json`; masters in `concepts/ui/2026-07-17/*-raw.png` | ✅ |
| Prop atlas (crowds, vents, beacons, steam) | 07 | Higgsfield CLI (`nano_banana_pro`), **16:9** / **1:1** / **1:1** / **2:3**; frames 1–3 of each `--image`-chained **from frame 0** (never from the previous frame, so drift cannot compound) | project-owned/proprietary | 16 frames, `<prop>-0..3`, looping 0→1→2→3→0. Cells are per-prop, **not** uniform (that is why it is an atlas): each prop's 4 frames share one union crop so they stay registered. Silhouettes verified distinct: crowd 2.99:1 band · vents 1.03:1 box · beacon 0.35:1 needle · steam 0.58:1 wisp | chroma key (`npm run build:atlases`). Anchor **bottom-center** (`setOrigin(0.5, 1)`) per `sprite-schema.md`; beacon's mast runs off the bottom edge **by design** — the cut is the roofline | `public/props/twilight-atlas.png` + `.json`; masters in `concepts/props/2026-07-17/*-raw.png` | ✅ |

## Animated spritesheets (sprite skill) — feeds Phase 09 & 15

Per fighter (×3), one sheet per animation state. Frame size / fps / anchor follow
[`sprite-schema.md`](../public/configs/sprite-schema.md) and MUST match the sim's box convention.

| Fighter | Source/provenance | License | Animations needed | Frame size | Anchor | fps | Destination | Status |
|---------|-------------------|---------|-------------------|-----------|--------|-----|-------------|--------|
| Brawler (red) | sprite skill (Phase 09) | project-owned/proprietary | idle, walk fwd/back, crouch, jump, light, heavy, block high, block low, hit, KO, special-charge, special-exec (revolving uppercut) | 320×256 (uniform) | feet-centered | decoupled (per schema) | `public/sprites/brawler/` | ☐ |
| Jiu-jitsu | sprite skill (Phase 09) | project-owned/proprietary | same set; special = "spinarooni" | 320×256 | feet-centered | decoupled | `public/sprites/jiujitsu/` | ☐ |
| Monk (Shaolin) | sprite skill (Phase 09) | project-owned/proprietary | same set (roster completion) | 320×256 | feet-centered | decoupled | `public/sprites/monk/` | ☐ |

> The recipe temporarily restricts the roster to **brawler + jiu-jitsu** (PDF step 11); the
> monk is added for full README parity. (The recipe's third fighter was a *green boxer*; Phase 03
> dropped him and the dojo mockup's left fighter became a **Shaolin monk** — the ids here match
> Phase 05's references in [`concepts/characters/2026-07-17/`](../concepts/characters/2026-07-17/).)
> Specials (charge + execution sheets) are required by Phase 15 — verify they exist in your chosen
> provenance before starting that phase.

## Audio

**Non-goal** for this guide (see [PRD.md](PRD.md#vision--scope)). No audio assets tracked.
