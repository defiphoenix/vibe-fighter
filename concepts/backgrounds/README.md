# Parallax Backgrounds (Phase 04)

Layered, transparent parallax art split out of the locked [`rooftop-dusk`](../mockups/2026-07-16/rooftop-dusk.png)
concept. Two stages, four layers each. Consumed by the stage runtime in
[Phase 08](../../docs/phases/08-stage-runtime-and-preview.md).

## Stage → directory map

Phases 07/08/11 call the locked stage **"twilight"**; the mockup and
[asset-manifest](../../docs/asset-manifest.md) call it **"dusk"**. They are the same stage.

| Runtime variant (`stages.json`, Phase 08) | Directory |
|---|---|
| `twilight` | [`rooftop-dusk/`](rooftop-dusk/) |
| `sunset` | [`rooftop-sunset/`](rooftop-sunset/) |

## Layers

Draw order is back to front. `near` draws **in front of the fighters**; the other three behind.

| Layer | Content | Alpha |
|---|---|---|
| `far.png` | Dusk sky gradient + stars + thin clouds | **Opaque** — backmost, nothing shows behind it |
| `medium.png` | Skyline silhouettes, lit windows, water tower, satellite dish, antennas | Transparent above the skyline |
| `main.png` | Cracked concrete roof (**full width**), roof-edge chain-link fence, HVAC units, parapet, vent | Transparent above the roof |
| `near.png` | Foreground parapet, pipes, HVAC corner, low chain-link railing | Transparent except the bottom strip |

## Geometry contract

All eight layers are **3168×1344** (aspect 2.357:1). The contract is **vertical and normalized**, so
it is independent of how Phase 08 scales horizontally.

| Anchor | Value | Source |
|---|---|---|
| Feet line (where a fighter's feet sit) | **0.861111** of height → y=1157 | `GROUND_Y / STAGE_HEIGHT` = 620/720, [`src/sim/constants.ts`](../../src/sim/constants.ts) |
| Standing fighter height | 0.2569 of height → 345px | `HURT_STAND.h`/`STAGE_HEIGHT` = 185/720, [`src/sim/config.ts`](../../src/sim/config.ts) |
| `near` strip top edge | 0.8328 of height → y=1119 | feet line − 11% of a fighter (ankle bite) |

**Scaling.** 3168×1344 does not scale to 1280×720 on both axes — match the **height** (1344 → 720,
factor 0.5357) and let the width fall where it lands (**1697px** in game space). That is the point:
it gives the Phase 08 camera **+417px** of scroll room against the 1280 viewport. Do not scale to
width; that would move the feet line off `GROUND_Y` and the fighters would float or sink.

## Recommended Phase 08 config

**Set the world width to the layer width and nothing ever tiles**, so the wrap seams below never
render. A layer at parallax factor `f` must be `1280 + f·(W−1280)` wide to cover a world of width
`W`; each layer here is **1697px** in game space. Choosing `W = 1696` satisfies every layer at once:

| World `W` | Camera travel | Result |
|---|---|---|
| **1696** | 416px | **No layer tiles. No seam can render.** |
| 2560 | 1280px | `main`, `near` tile → seams show |
| 3840 | 2560px | `medium`, `main`, `near` tile → seams show |

```ts
// src/sim/constants.ts
export const STAGE_WIDTH = 1696;  // WORLD  — sim: spatial.ts MAX_X, world.ts CENTER
export const VIEW_WIDTH  = 1280;  // CAMERA — render: main.ts canvas, hud.ts
```

| Layer | `f` | Needs (W=1696) | 1697 covers? |
|---|---|---|---|
| `far` | 0.1 | 1322 | ✅ |
| `medium` | 0.3 | 1405 | ✅ |
| `main` | 1.0 | 1696 | ✅ (1px spare) |
| `near` | 1.0 | 1696 | ✅ |

Keep `near` at exactly **1.0**. Above it the strip runs short and its ends pull into view
(f=1.05 → 20px short, f=1.10 → 40px, f=1.15 → 61px).

### Two traps — both resolved in Phase 08 (kept for the reasoning)

Phase 08 shipped the world/viewport split; these are no longer open, but the reasoning is why the
constants are shaped the way they are:

1. **`STAGE_WIDTH` once meant both "world" and "viewport".** Phase 08 added a separate
   `VIEW_WIDTH=1280`; [`main.ts`](../../src/main.ts) now feeds the canvas `VIEW_WIDTH` while the
   world is the wider `STAGE_WIDTH=1696`, leaving room to scroll. (Had they stayed one constant, the
   whole world would be on screen with nothing left to scroll.)
2. **The HUD is screen-space and now reads the viewport constant.**
   [`hud.ts`](../../src/render/hud.ts) and [`MatchScene.ts`](../../src/scenes/MatchScene.ts) position
   at `VIEW_WIDTH/2` (with `setScrollFactor(0)`), so the timer stays centred and P2's health bar
   stays on screen as the camera pans. (Reading `STAGE_WIDTH` here would drift them off once
   world ≠ viewport.)

Blast radius is otherwise small: every consumer already derives from the constant, and no test
hardcodes 1280. `STAGE_MARGIN=90` / `START_GAP=260` stay sane at 1696 (fighters roam x 90..1606 and
still start inside one viewport).

**Trade-off:** 1696 buys 416px of travel — 0.33 of a viewport. Enough to show parallax working, but
not an SF2-scale 2–3 screen stage. Going wider means `main` must tile, the seam shows, and a wrap-art
pass (mirror-tile or blend a strip) becomes real work. The choice is **world size vs. seam work**.

`main` spans the canvas edge-to-edge (verified: weakest column below the feet line is **100% opaque**),
so *if* it is ever tiled there are no gaps — the fix the PDF recipe's step 5 explicitly asks for.

**Wrap seams are measured, not fixed.** Left-vs-right edge mean delta:

| | `main` | `near` |
|---|---|---|
| rooftop-dusk | 40.8 | 21.4 |
| rooftop-sunset | 44.8 | 60.5 |

Read the spec carefully here, because it says two things. The **task** says the main layer should span
full width "so it tiles seamlessly" ([04-parallax-backgrounds.md:20-21](../../docs/phases/04-parallax-backgrounds.md)),
and the **acceptance criterion** says "main layer is full-width (no tiling gaps)" (line 29). The
verbatim source complaint is about *gaps* ("not end-to-end to the edge of the canvas, so it will tile
with gaps"), and that is what Phase 04 closed and verified. A seamless left-to-right **wrap** is a
different property, it is not something diffusion gives for free, and it is **not closed here** —
these deltas are non-zero and a plain `TileSprite` repeat will show the join. If Phase 08 tiles these
and the seam reads, this is the number to attack: mirror-tile, or blend a wrap strip.

`near` is a horizontal strip, so its seam is confined to the bottom ~17% of the layer — but it does
contain vertical features (fence posts, a vent, an HVAC corner) that will not line up across a wrap.

## Regenerating

```bash
npm run key:layers     # re-keys every *-raw.png, rebuilds _preview.png, re-runs all assertions
```

The `*-raw.png` files are **durable provenance, not temp files**: they are the pre-key generator
output, the input to the sunset reference-edit, and what a re-key consumes so reruns cost no credits.

Each layer carries `<layer>.prompt.txt` (the exact prompt) and `<layer>.job.json` (model, flags, job
id, result URL). Generated with the **Higgsfield CLI**, model `nano_banana_pro`, `--aspect_ratio 21:9`.

## Gotchas worth knowing before touching these

- **No Higgsfield image model emits alpha.** All 30 job types checked: `gpt_image_2` does not surface
  OpenAI's native `background:"transparent"`; `recraft_v4_1`'s `background_color` is explicitly
  *"#RRGGBB … no alpha"*. Hence the flat `#FF00FF` void + local key.
- **Higgsfield's `16:9` is 2752×1536 = 1.7917:1**, not 1.7778. At 720 high that is 1290×720 — ten
  pixels of scroll room. Use `21:9`.
- **The model will not draw a thin foreground strip.** Asked for the bottom 12% it drew 40%; asked
  emphatically for 5% it drew 32%. `near` is generated tall and masked down in `key-layers.py`.
- **Describe the CAMERA, not the percentage.** `main` came back as a solid wall from ~61%, burying
  the skyline, through three rewrites asking for a thinner floor band (22%→39%, 8%→40% — no
  movement). The percentage was never the variable: the model was drawing a camera *angled down* at
  the roof, which makes the floor a deep receding plane at any fraction. Adding *"the camera sits
  LOW, at the height of a fighter standing on the roof, looking flat ACROSS the rooftop at eye level
  — NOT looking down at it … Do NOT tilt the camera down"* moved the floor top to 74.3% in one
  generation. If it ignores a dimension three times, you are naming the wrong variable.
- **Anchor scale to a person, or props come out ~2× too big.** These prompts forbid figures, which
  removes the model's only scale reference. State it explicitly: *"a grown adult on this roof is one
  quarter of the image height; the AC units are waist-high on them; the water tower is twice their
  height."* That took HVAC from ~0.9× a fighter's height to the mockup's ~0.5×.
- **Match palettes by sampling hex, not by describing them.** "Dusk sky" produced a purple night
  (`#A7478F` at 40% vs the mockup's `#FD9146`). Feeding the mockup's sampled ramp cut mean palette
  distance 214 → 74.
- **A reference-edit paints into the void.** Told to recolour only, it invented a skyline in
  `sunset/main`'s magenta (+13.3% of the reference's geometry, raw IoU 0.881).
  `align_to_reference()` clamps the edit's alpha to the reference's; real geometry *loss* still
  hard-fails.
- **The API JPEG-compresses and resizes a `--image` reference.** So a reference-edit comes back with
  ~1px of edge jitter everywhere. On a high-perimeter layer like the `near` mesh that scores >1% of
  "geometry" while being pure noise — which is why the loss gate measures the reference's *interior*,
  not its raw mask.
- **`convert` on PATH is Windows NTFS `convert.exe`, not ImageMagick.** Never call it.
