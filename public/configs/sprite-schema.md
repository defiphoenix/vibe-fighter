# Sprite / Atlas Schema (Phase 02)

The contract every later phase authors character art against. It exists so sprites line up with
the sim's collision boxes with zero per-asset fiddling. The sim is authoritative and never reads
any of this — it's a pure render-side convention.

## Frame

- **Size:** uniform **320 × 256 px** per frame.
  - Width 320 → ±160 px from the centered feet anchor, enclosing the heavy hitbox forward reach
    (local `+140`: `HIT_HEAVY x:45 w:95` in `src/sim/config.ts`).
  - Height 256 → clears the tallest stand hurt box (185) plus the light-attack vertical reach
    (~145 above feet).
- **Layout:** one horizontal strip per animation state (`frameWidth: 320, frameHeight: 256`),
  frames left→right, index 0..N-1.

## Anchor

- **Feet-centered, bottom-middle.** Phaser `sprite.setOrigin(0.5, 1.0)`, drawn at the fighter's
  `f.x` (feet-center x) / `f.y` (feet y, `GROUND_Y = 620`).
- Local axes match `src/sim/geometry.ts` `toWorld`: `+x` = forward (facing dir), `+y` = up from
  feet. Foot pixels sit on the **bottom row** of the frame in every frame — vertical motion is
  animated in the torso/head, never by translating the whole silhouette off the ground line.
- **Mirroring:** `sprite.setFlipX(f.facing < 0)`. Art is drawn facing `+x` (right); the engine
  flips it for left-facing. Put an asymmetric forward feature in the art so the flip is visible.

## fps — decoupled from sim ticks

The sim advances one box-frame slot per 60 Hz tick; **fps is a pure playback/visual choice** and is
never read by the sim. Author few drawn frames per state and let them loop/play independently.

**A HELD state whose clip opens with a transition must NOT loop.** The video-derived crouch sheets
start with the fighter still standing and settle into the squat over the next frames; looping them
replayed the stand-up twice a second and read as "crouch doesn't hold". `loop: false` maps to Phaser
`repeat: 0`, which plays the clip once and holds the final frame — a crouch-in that settles.

| State (`StateName`) | Suggested fps | Loop | Sim tick ref (not authoritative) |
|---|---|---|---|
| `idle` | 10 | yes | 4 |
| `walkF` / `walkB` | 12 | yes | 6 |
| `crouch` | 12 | **no** | 2 |
| `block` | 8 | **no** | high guard brace, one-shot into a hold |
| `blockCrouch` | 8 | **yes** | low guard — loops a contained crouch bob so it stays alive while held |
| `jumpRise` / `jumpFall` | 8 | no | 1 (physics-driven) |
| `attackLight` | ~12 (read against 4/3/8 startup/active/recovery) | no | 15 |
| `attackHeavy` | ~12 (read against 9/4/18) | no | 31 |
| `airLight` / `airHeavy` | ~10 | no | air normals, independent timing from ground |
| `crouchLight` / `crouchHeavy` | ~10 | no | low attacks (crouch body, low hit box) |
| `hitstun` / `blockstun` | 8 | no | 1 (stun-timer-driven) |
| `knockdown` / `ko` | 8 | no | 1 (timer-driven) |

## Animation keys

One animation per authoritative sim `StateName` — the 19 states in `src/sim/types.ts`:
`idle, walkF, walkB, crouch, block, blockCrouch, jumpRise, jumpFall, attackLight, attackHeavy,
airLight, airHeavy, crouchLight, crouchHeavy, special, hitstun, blockstun, knockdown, ko`.

Art-list extras in the manifest map to later phases, not here:
- **block high / block low** → shipped in Phase 13b as the dedicated held-guard states `block` (high)
  and `blockCrouch` (low). High/low is still box geometry (`GUARD_STAND` vs `GUARD_CROUCH`, per-frame
  since Phase 13); the FSM now plants a guarding fighter in these states, and `crouchIntent` picks the
  stance. `blockstun` remains the separate hit-reaction.
- **special-charge / special-exec** → shipped in Phase 15 as ONE state, `special`: the sheet's opening
  frames ARE the charge (they cover the attack's `startup`) and the rest is the execution, so there is
  no separate `specialCharge` sheet. It is a real attack state (`ATTACK_STATE_TO_KEY`), and the only
  one carrying `repeat` — several hit windows in one animation. Because a multi-hit move has N contact
  frames and `render.sheets.<state>.hit` holds ONE number, a `repeat` sheet gets **uniform** playback
  and `check-attack-sync.py` deliberately skips it. Sheet list is **19**.

## Transparency

- **Sprite sheets:** native **PNG alpha** (both the Phase 02 placeholder and real Phase 09 sheets).
- **Static atlases** (UI / props): magenta `#ff00ff` chroma key, keyed out locally — per the asset
  manifest conventions. Not used for character sprites.
- **Backgrounds:** split as transparent PNGs (no chroma), per the manifest / PDF step 5.

## Atlas JSON (Phase 07)

Sprite *sheets* above are uniform strips loaded with `load.spritesheet` + explicit `frameWidth`/
`frameHeight`. The two Phase 07 atlases are **not** uniform — their cells are whatever the art
measured — so they ship a JSON sidecar and load with `load.atlas` instead:

```js
this.load.atlas("hud-atlas", "ui/hud-atlas.png", "ui/hud-atlas.json");
this.load.atlas("twilight-atlas", "props/twilight-atlas.png", "props/twilight-atlas.json");

// ...then address frames BY NAME, not by index:
this.add.image(x, y, "hud-atlas", "health-bar");
this.add.sprite(x, y, "twilight-atlas", "vents-0").setOrigin(0.5, 1);
```

Format is Phaser's **JSON Hash** (the TexturePacker shape) — a `frames` object keyed by name:

```json
{ "frames": { "health-bar": { "frame": { "x": 0, "y": 0, "w": 460, "h": 144 } } },
  "meta": { "image": "hud-atlas.png", "size": { "w": 463, "h": 769 }, "scale": "1" } }
```

Both files are **generated, never hand-edited** — `npm run build:atlases` re-keys and re-packs them
from `concepts/{ui,props}/2026-07-17/*-raw.png` and writes every rect from a measurement. Editing the
JSON by hand desynchronises it from the PNG; change the art and re-run instead.

**Slots are frames.** `health-bar-slot` and `portrait-slot` are transparent sub-rects of the plate
they sit in — the fill slot in the bar, and the window in the portrait base. They are declared as
ordinary frames because a rect is a rect: Phaser hands them back via `textures.get(key).get(name)`
with no schema it does not already have, and no second config file has to be kept honest.

Their rects are in **atlas space**, like every frame. A consumer that wants a slot relative to its
plate subtracts the plate's origin:

```js
const t = this.textures.get("hud-atlas");
const bar = t.get("health-bar"), slot = t.get("health-bar-slot");
const fillX = barScreenX + (slot.cutX - bar.cutX);   // where to draw the dynamic health fill
const fillY = barScreenY + (slot.cutY - bar.cutY);
```

Phase 14 draws the fill **behind** the bar art, so it shows through the transparent slot while the
bevel stays on top. It should also read the bar's **height from the frame** rather than hardcoding
it: the art defines the height (`hud.ts:5`'s `BAR_W` = 460 is the only number the packer holds fixed),
and `build-atlases.py` asserts the resulting HUD band clears a jumping fighter's head.

**Prop anchor: bottom-center.** Props sit *on* the roof, so add them with `setOrigin(0.5, 1)` — the
same feet-anchor convention as the sprite sheets above. Each prop has 4 frames named `<prop>-0..3`
(`crowd`, `vents`, `beacon`, `steam`), designed to loop `0→1→2→3→0`:

```js
this.anims.create({
  key: "vents-spin",
  frames: this.anims.generateFrameNames("twilight-atlas", { prefix: "vents-", start: 0, end: 3 }),
  frameRate: 12, repeat: -1,
});
```

All four frames of one prop share a single crop rect and are packed at one scale, so they line up on
a common cell. That places them identically; it does not by itself prove the *content* is in register
(the frames are `--image`-chained and the API resamples each reference). What the build gate does
enforce is the **bottom edge**: every prop is bottom-anchored to the roof, so its base must not drift
frame-to-frame (`check_bottom_anchor`, ≤3% of the cell height) — while the moving part (plume, blades,
halo) is measured and reported but deliberately not bounded, since it is *supposed* to change. Cells
are **not** uniform across different props, which is exactly why this is an atlas and not a
spritesheet. `e2e/atlas.spec.ts` is the regression check that both files still load and resolve.

## Phase 02 proof asset

`public/sprites/test/brawler-idle.png` — 4-frame 320×256 idle strip generated by
`scripts/gen-placeholder-sheet.mjs` (stdlib PNG writer, deterministic, self-checking). Placeholder
only; Phase 09 replaces it with real per-state sheets under `public/sprites/<fighter>/` and the
full `public/configs/character-gym.json`.
