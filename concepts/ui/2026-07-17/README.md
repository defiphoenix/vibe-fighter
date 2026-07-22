# UI atlas — authoring art (Phase 07)

The health bar and portrait base that `public/ui/hud-atlas.png` is packed from.
Locked direction: **rooftop-dusk** (Phase 03), palette sampled from
[`../../backgrounds/rooftop-dusk/main.png`](../../backgrounds/rooftop-dusk/main.png).

**Nothing loads from here.** `concepts/` is authoring art. The runtime files are
`public/ui/hud-atlas.png` + `.json`, written by `npm run build:atlases` — which re-keys and re-packs
from the `*-raw.png` masters every run and is idempotent. Change the art, re-run; never hand-edit the
JSON.

## Files

| id | asset | aspect (label → real) | `--image` | job |
|----|-------|----------------------|-----------|-----|
| `health-bar` | HUD health bar, bevelled frame + enclosed fill channel | `21:9` → 3168×1344 (2.3571:1) | none | `7aedf8e4-5867-4f8c-b956-beb313afec03` |
| `portrait-base` | character-select portrait plate, ornamental border + enclosed window | `3:4` → 1792×2400 (0.7467:1) | none | `628e9654-8b53-456f-aa35-3fadc7b522cc` |

Each carries `<id>.prompt.txt` (the exact `--prompt`), `<id>.job.json` (verbatim CLI record),
`<id>-raw.png` (**durable provenance, not a temp file** — the opaque magenta original the keyer reads)
and `<id>.png` (keyed, for review).

## The contract downstream honours

Both plates carry a **transparent slot**, and both slots are declared as ordinary atlas frames —
`health-bar-slot`, `portrait-slot` — because a rect is a rect. Rects are in atlas space; subtract the
plate's origin to get a slot relative to its plate. Full detail, with code, in
[`public/configs/sprite-schema.md`](../../../public/configs/sprite-schema.md).

- **`health-bar` is 460×144.** Only the **460** is fixed (`src/render/hud.ts:5` `BAR_W`); the height
  is whatever the art said, and **Phase 14 must read it from the frame rather than hardcode 34**.
  The gate proves the resulting HUD band (bar + pips) ends at y=208, clear of the y=279 a fighter's
  head reaches at the apex of a jump.
- **`portrait-slot` is 300×402 at 0.7467:1, flush with the window's bottom edge.** That aspect and
  the bottom-flush rule are the Phase 06 contract: the bust bleeds off its own bottom edge, so a
  bottom-flush slot butts it with no seam and no gap under the chest. 300 comes from the "~300×400
  card" the [Phase 06 log](../../../docs/phases/06-select-portraits-log.md) hands Phase 11.
- Phase 14 draws the dynamic health fill **behind** the bar so it shows through the slot while the
  bevel stays on top. Phase 06's portraits are baked composites with **no alpha and 0 px magenta** —
  do not run a keyer on them; crop and scale into the slot.

## Regenerating

```bash
higgsfield generate create nano_banana_pro --prompt "$(cat health-bar.prompt.txt)" \
  --aspect_ratio 21:9 --resolution 2k --wait --json > health-bar.job.json
# result_url from the JSON -> health-bar-raw.png, then: npm run build:atlases
```

Redirect **stdout only** — `2>&1` merges the CLI's `Error:` line into the JSON and corrupts it.

## Gotchas worth knowing before touching these

- **Do not ask the model to hit a number; measure what it drew.** Neither slot was requested at a
  size. The fill slot is *found* (the enclosed transparent region matching a shape rule) and the
  portrait slot is *computed* (largest 0.7467:1 rect flush with the window's bottom). The proof this
  is the right call: the model drew the window at **0.6521:1** when the prompt asked for 3:4, and the
  slot still came out perfect at 99.97% inside. A requested-and-checked aspect would have burned a
  retry for nothing.
- **The bar will not be as shallow as you ask.** The prompt says "about eight times as wide as it is
  tall"; the art came back **3.19:1**. This is the same class as Phase 04's strip (asked 12%, got
  40%). It was accepted rather than argued with, because the gate proves 3.19:1 still fits the HUD
  band — arguing costs ~7px per credit.
- **The channel must be enclosed, and that is a real prompt clause.** Both the void and the slot key
  to alpha 0, so a channel open at either end merges with the outside void and is not a slot at all.
  The prompt says the frame "closes all the way around" it; the gate fails an open channel rather
  than mis-keying silently.
- **`RGBA` is a lie.** `portrait-base-raw.png` came back RGBA and `health-bar-raw.png` RGB from
  *identical* params, both with alpha 255 on every pixel. Never test `mode == "RGBA"` to decide
  whether something has alpha — read the channel.
- **The void is never literally `#FF00FF`,** and it is not perfectly flat. `health-bar-raw.png` keys
  to 13 connected components: the bar, plus **12 specks totalling 60 px** of dither noise hugging the
  right edge. A bbox taken over "any alpha > 0" reads those as art and returns the whole canvas — so
  the crop is taken over components ≥256 px, and the dropped specks are reported.

See also [`../../backgrounds/README.md`](../../backgrounds/README.md) for the stage-side gotchas and
the sampled dusk palette these prompts quote.
