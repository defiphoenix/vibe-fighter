# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Vibe Fighter** — a local two-player Street Fighter–style game. Vite + TypeScript + Phaser 4
(`^4.2.1`). The gameplay is a deterministic 60 Hz simulation; Phaser is only a rendering/input adapter
on top of it. Rendering uses **default LINEAR antialiasing — no `pixelArt`** — because the art is
photographic (video-derived sprites + painted backgrounds).

Built in phases. **Phases 00–15 are shipped; Phase 16 is next.** Specs and gate
results in [`docs/phases/`](docs/phases/); the narrative of what shipped when, including the fix passes
between phases, is in [`docs/history.md`](docs/history.md). `prompts.pdf` holds the original spec.

Art direction is **rooftop-dusk**, locked in Phase 03. Roster is **brawler / jiujitsu / monk** — those
ids are canonical from `concepts/characters/` through to `public/sprites/<id>/`. Generating art is its
own discipline with its own expensive lessons: [`docs/art-pipeline.md`](docs/art-pipeline.md).

## Commands

```bash
npm run dev        # Vite dev server (hot reload)
npm run build      # tsc --noEmit typecheck, then vite build
npm run typecheck  # tsc --noEmit only
npm test           # vitest run (all *.test.ts under src/) — sim unit tests, node env
npm run test:e2e   # Playwright browser acceptance for the render layer (e2e/, headed)
```

Run one test file: `npx vitest run src/sim/combat.test.ts`
Filter by name: `npx vitest run -t "corner"`
Watch mode: `npx vitest` (no `run`)

TypeScript is strict with `noUnusedLocals`/`noUnusedParameters`/`noImplicitReturns` — an unused import
or param fails the build.

### Asset + art scripts

```bash
npm run build:sprites    # pack raw frames (concepts/characters/sprites/<id>/<state>/NN.png) -> public/sprites/<id>/<state>.png
npm run check:sprites    # gate: cell size, frame count == JSON, feet-anchored, height, NO-PURPLE hue, attack MOTION_MIN
npm run check:sync       # gate: measure each attack sheet's CONTACT frame, check against render.sheets.<state>.hit; --write records it
npm run audit:anim       # roster-wide animation REPORT (advisory, always exit 0)
npm run gen:placeholder  # regenerate 19 states x 3 fighters of placeholder sheets
                         # (`-- --state <name>` limits it — without it this OVERWRITES the real art)
npm run key:layers       # re-key + validate the Phase 04 parallax layers
npm run copy:stages      # pre-bake keyed layers to runtime 1697x720 into public/backgrounds
npm run copy:portraits   # Phase 06 masters (1792x2400) -> select cards at 448x600 AND hud/<id>.png at 192x294
npm run build:atlases    # key + measure + pack the Phase 07 UI/prop atlases into public/
npm run check:characters # validate the Phase 05 character refs
npm run check:portraits  # validate the Phase 06 select portraits
python scripts/art_gate.py                  # the shared art gate's own fixtures, standalone
python scripts/build-atlases.py --selftest  # the atlas gate's fixtures, without needing the art
```

**Sprite rebuild ORDER MATTERS.** `build-sprites.py` derives each fighter's ONE scale from `idle` frame
0 (`scale = 185/figure`), so regenerating an IDLE silently rescales every other sheet for that fighter
and moves its measured contact frames by a pixel — enough to flip a sheet between ALIGNED and
INDETERMINATE. Always:

1. regenerate `idle` first,
2. `npm run build:sprites`,
3. `npm run check:sync --write`.

The build itself is deterministic (same md5).

**`build-sprites.py` keeps ONLY the largest connected component for `SOLID_BLOB_STATES` (`block`,
`blockCrouch`)** — a held guard is one connected piece, so this scrubs the stray green key debris a
noisy generated background leaves floating in the void (measured up to 211px, above the 0.5% speck
floor `drop_specks` uses for every other state). Do NOT add jump/air/attack states to that set: they
extend a fist or foot that a chroma-key AA gap can legitimately split off, and keep-largest would eat
it. (Also updated `requirements.txt`: `scipy` is now used by `build-sprites.py` too, not only
`build-atlases.py`.)

**Python deps are declared in `requirements.txt`** (Pillow, numpy, scipy — scipy only for
`build-atlases.py`'s `ndimage.label`). None ship in the bundle. The scripts chain by `importlib` (a
hyphenated filename blocks a plain import) so they can't drift apart: **`art_gate.py` owns the
provenance gate (`check_job`), the shared-block check (`check_blocks`) and the re-exported `key-layers`
thresholds**, and `check-characters.py`, `check-portraits.py` and `build-atlases.py` all import from it.
Editing `art_gate.py` therefore edits all three gates — `check_job` is parameterised by
directory/aspect/resolution/job_type/refs for exactly that reason. `check:characters` + `check:portraits`
passing proves a change stayed a no-op for Phases 05/06, but that is **necessary, not sufficient**: both
callers pass the old `3:4`/`2k` defaults, so `art_gate.py`'s own fixtures are what exercise the
parameters.

**`convert` on PATH is Windows NTFS `convert.exe`, not ImageMagick** — never call it.

## Deploying (GitHub + Vercel)

GitHub `roiizchak/vibe-fighter` (**private**) → Vercel project `vibe-fighter` (org
`rois-projects-f9d9895d`), wired by Vercel's git integration. Live at
**https://vibe-fighter-dusky.vercel.app**.

- **A push to `main` IS a production deploy.** No staging step, no approval gate. Commit and push
  normally, but **say what you are deploying** — a push is a release, not a save.
- Still in force: **do not make the repo public and do not announce or share the game anywhere until the
  user says it's finished.**
- Vercel runs **`npm run build`** — the same `tsc --noEmit && vite build`, on Node 24.x, output `dist/`.
  **A red typecheck fails the deploy**, so `npm run build` green locally is the pre-push check that
  matters. Python art scripts never run there; only what's committed under `public/` ships.
- `vercel --prod` deploys the working directory manually (uploads local files, skipping anything
  `.gitignore`d) — useful to test a change without pushing. `vercel logs <url>` / `vercel inspect <url>`
  debug a deployment; `vercel rollback <url>` reverts one.
- **Prod is a real build, so `import.meta.env.DEV` is false**: `?scene=gym|playground|preview` do not
  exist there (BootScene routes to `Flow`), and `window.__game`/`__world`/`__flow` are absent. Any
  e2e/debug seam you add is dev-only by construction; don't reach for one to diagnose production.
- **A Vercel PREVIEW deploy can't gate a CSP** — Deployment Protection 302s every route to SSO. Mirror
  `vercel.json` onto `vite preview.headers` instead.
- `.gitignore` excludes `node_modules/`, `dist/`, `.vercel/`, test artifacts, `*.mp4`, and
  `concepts/**/*.png|gif`. **That last one is a real gap in the safety net**: 483 MB of art authoring
  exists ONLY on this machine — a deleted sprite source is not recoverable from git, only re-generatable
  at credit cost. The prompts and `*.job.json` records ARE committed.

## Architecture

The hard rule everything else follows: **`src/sim/` is pure and imports NO Phaser.** It's a
self-contained deterministic simulation; the render layer (`src/scenes/`, `src/render/`, `src/main.ts`)
reads sim state and draws it. Vitest runs the sim in the `node` environment precisely because it has no
DOM/Phaser dependency. Anything you add under `sim/` must stay Phaser-free and deterministic (no
`Date.now`, no `Math.random`). Consolidated note: [`docs/architecture.md`](docs/architecture.md).

Layout is discoverable — `world.ts` owns the sim, `fighter.ts` is one fighter, `MatchScene.ts` is the
bridge. What follows is only what you cannot learn by opening the file.

### Sim invariants

- **`world.ts` `tick()` is the authoritative order of operations** — documented as numbered steps (phase
  management, input gating/hitstop, FSM `think`, physics `integrate`, spatial resolve, facing/depth,
  combat resolve, round-over, timers, clock). **Preserve that step order** when editing; the tests
  encode subtle ordering guarantees (clamp-before-measure; the clock must not tick on the hitstop frame).
- **`World.advance` returns "a fight tick ran `think`", NOT "the buffered edge was acted on".** `think`
  early-returns inside itself when the fighter is locked in an attack or stun, so a tick can run and
  consume nothing. WHICH edges were consumed is reported separately per fighter via
  **`Fighter.consumed{up,light,heavy}`, OR-accumulated into `World.consumedInputs[2]`** (reset each
  `advance`), and THAT is what the render latch clears (`EdgeLatch.consume`). Clearing on the bool
  dropped attacks pressed during your own move. `advance` also masks a consumed edge out of the rest of
  the batch, so one press can't fire twice inside a multi-tick advance.
- **All boxes are fighter-local**: `+x` = forward (facing direction), `+y` = up from the feet
  (`geometry.ts` `toWorld`). Everything downstream depends on this.
- **High/low blocking is decided by box geometry, not labels.** A high attack's hit box only overlaps
  the standing guard box; a low (**the two crouch normals only**) overlaps the crouch guard box; the air
  normals come down from above and are **overheads**. **Only the guard boxes' `y` band encodes high/low —
  their `x` span must cover the BODY (`x -32, w 90`), not sit as a thin forward slab**: a forward-only
  guard box left every attack unblockable at the separations where the pushboxes touch, i.e. exactly
  where the match is played, while still passing every test that measured blocking from poking range.
  `registry.test.ts` now sweeps the shipped geometry from contact range outward.
- **Guard boxes are PER-FRAME data** (Phase 13): `FrameBoxes` carries `guardStand` **and**
  `guardCrouch`, and `CharacterConfig` has no guard arrays at all. `CharacterData.boxes.guard*` is the
  authoring TEMPLATE that seeds every frame of a state `isGuardableState()` accepts. **Phase 13b made
  block a real state**, so that set is now **`block/blockCrouch/blockstun`** — a guarding fighter is
  planted in the dedicated held-guard states `block` (high) / `blockCrouch` (low) by the FSM guard
  branch, and idle/walk/crouch dropped out (a fighter never guards while in them). Both stances are
  carried per frame rather than one resolved array because **`crouchIntent`, not the state, picks the
  stance** — `blockstun` has one body and no stance of its own, so that is the only thing keeping a
  crouch-blocker's low guard up while stunned. **`block`/`blockCrouch` are also in `ACTIONABLE`** — not
  for jab-out (the attack edge is checked before the guard branch, independent of `ACTIONABLE`) but so
  `cpu.ts`'s reaction timer keeps ticking through a guard episode, exactly as when the plant used
  idle/crouch.
  **`isGuardableState` is enforced in the BUILDER, not just the validator**: `guarding` is derived from
  box data now, so a guard override on an attack frame would make a fighter blockable mid-punch, and
  `config.ts` assembles with no validator in front of it.
- **`body` does NOT control high/low** — it's the attacker's own vulnerability profile. The ground heavy
  shipped for two phases with `body: "crouch"` and a shin-height hit box on top of a *standing punch*
  animation, so the top ~40% of the attacker was invulnerable mid-heavy. Both now match the art
  (`body: "stand"`, hit `y 95`). `config.ts`'s `TEST_DUMMY` still authors its heavy low **on purpose**
  (it's the fixture that exercises the low path) — don't "fix" it to match the roster.
- **Seven attack states**: ground `attackLight/attackHeavy`, air `airLight/airHeavy`, crouch
  `crouchLight/crouchHeavy`, plus the meter `special`. The single source of truth is
  `ATTACK_STATE_TO_KEY` + `isAttackState()` in `types.ts`; every consumer keys off it, never hardcoded
  literals. `variantFor()` picks a normal's variant by stance: **crouch (grounded+down) > air
  (!grounded) > ground**, and the attack check in `think` runs before the airborne gate.
  **`startAttack(state)` is the ONE entry into every attack state**, because it is also the only place
  `lastHitId` is cleared — see below.
- **Multi-hit is per-WINDOW dedup, not per-attack** (Phase 15). `FrameBoxes.hitId` tags each frame with
  the hit window it belongs to; `Fighter.lastHitId` refuses a window that already connected. A normal
  has one window (id 0) so it still lands exactly once; `AttackData.repeat = {count, gap}` lays the
  active window down `count` times so a special lands `count` times. **Window ids restart at 0 for
  every attack**, so `startAttack` clearing `lastHitId` is load-bearing: without it a normal that just
  connected swallows the special's first window (the test that pins this drops 5 hits to 4).
  `attackSimTicks()` in `types.ts` is the ONE place the repeat length arithmetic lives — mirrored by
  `check-attack-sync.py` and `audit-animations.py`, and consumed by the validator and `anim-timing.ts`.
- **The meter is earned by playing WELL, never by being hit**: landing a clean hit pays the attacker
  `+damage`; a successful BLOCK pays the *blocker* `+floor(damage * BLOCK_METER_SHARE)` (0.5) off the
  damage the attack *would* have dealt, so guarding is rewarded and landing it is rewarded more. Eating
  a hit pays nothing, and a blocked attacker earns nothing either — chip is damage, but it is not a
  successful hit. Always credited from the **applied** (rounded, difficulty-scaled) number — the spec's
  raw `damage` is not required to be an integer, so reading it would leak floats into the sim.
  `METER_MAX` is spent whole; the special is grounded-only, and the
  edge is **consumed even when refused** or a press on an empty bar stays latched and fires itself the
  instant the bar fills. `reset()` deliberately keeps the meter (it carries between rounds, like
  `damageScale`); `World.restart()` zeroes it.
- **The super freeze rides the existing hitstop channel**, folded in at step 3b **after**
  `checkRoundOver` — a fighter KO'd on the tick they started a special gets neither the freeze nor the
  cut-in. `Fighter.pendingFreeze` is consumed on read (left set, it re-freezes every tick).
- **Block is a dedicated key**, not hold-back: `guardIntent = input.block && grounded`, and holding block
  PLANTS the fighter. Use the **`guarding` getter** (block held, grounded, and the current FRAME carries
  a guard box) for any guard cue — `guardIntent` alone is set even in hitstun/attack where no guard box
  exists.
- **`stats.scale` rescales the whole fighter — art AND collision geometry.** Boxes are multiplied
  **last, after overrides**, in one traversal, so authoring stays in unscaled space. `FighterSprite`
  takes a **required** `scale` arg so a missed call site is a typecheck error, not a silent desync. The
  validator enforces `scale > 0`: `0` collapses every box and divides by zero in the Gym's inverse, and a
  negative gives negative `w`/`h`, which `toWorld` normalises horizontally but **not** vertically.
  Knockback and walkSpeed are NOT scaled.
- **`spatial.ts` clamps to walls first** so corner penetration transfers to the other fighter, then a
  final **`MAX_SEPARATION` cap** (=`VIEW_WIDTH-240`=1040) pulls the pair symmetrically to the midpoint so
  the follow-camera always frames both. It only ever REDUCES a gap far larger than any pushbox, so it
  can't create overlap; a midpoint near a wall just clamps back in. This is the SF-style off-screen fix;
  camera zoom-out was rejected because the stage art is exactly viewport-height.
- **`cpu.ts` is sampled once per TICK, inside the fixed-timestep loop** (`CpuSeam` on `World.advance`).
  A CPU sampled once per render frame acts at the display's rate and is not reproducible. It skips
  `EdgeLatch` deliberately (it re-derives its edges every tick). **`reactionTicks` is what makes a
  difficulty beatable**, and its counter must only run on **`ACTIONABLE`** ticks — otherwise a stunned
  CPU banks reaction it can't use and spends the swing on a press `think()` swallows. `DAMAGE_SCALE`
  becomes `Fighter.damageScale` (a multiplier on damage DEALT, default 1, deliberately **not** reset by
  `reset()`); `combat.ts` floors a scaled hit at 1, lets chip floor at 0, and puts the **scaled** number
  in the `hit` event because the camera shake reads it. The controller outlives every round and the
  `Enter` rematch, so **`CpuSeam` has an optional `reset()` that `world.resetRound()` calls** — the
  render layer can't own this, because the automatic round transition happens inside `tick()`. The RNG
  is deliberately NOT re-seeded there (that would make every round identical).
- **`STAGE_WIDTH=1696` is the WORLD; `VIEW_WIDTH=1280` is the camera/canvas.** Splitting them is what
  gives the camera room to scroll. Timing is in ticks (60 Hz), space in pixels.

### Render adapter

- **Phaser 4 tint COLOR and tint MODE are separate, and `setTintFill()` is a deprecated no-op.** A white
  MULTIPLY tint is invisible, so a flash must `setTint(0xffffff).setTintMode(Phaser.TintModes.FILL)` and
  switch the mode back, or the fighter stays a white silhouette. `FighterSprite.update()` is the ONLY
  writer of the tint — `applyHitFeedback` runs before `render()`, so tinting from the event loop is
  overwritten the same frame; a block flash can only be set THROUGH the sprite. **There is NO steady
  guard tint** — a guarding fighter used to be tinted blue every frame, but once `block`/`blockCrouch`
  got real poses that pose IS the cue, and a whole-body blue tint just read as "the character turned
  blue". Only the white block-flash (a landed block) tints now.
- **`setScrollFactor(0)` does NOT exempt an object from ZOOM.** Hence the second, non-zooming camera for
  HUD/legend/quit-prompt/end-menu (`cameras.add` + reciprocal `ignore()` lists). An object missing from
  both lists renders TWICE; one in both renders never. The lists must stay exhaustive —
  `e2e/camera-group.spec.ts` asserts every object's `cameraFilter`. This is why `StageHandle` exposes
  `objects` (not just `layers` — props were unreachable) and `Hud` exposes `objects`.
- Zoom is **IN only**: `groupZoom(sep) = clamp(VIEW_WIDTH/(sep+240), 1, 1.25)`, eased by `stepZoom`, then
  `centerOn(midpoint, STAGE_HEIGHT - cam.displayHeight/2)` for a bottom-aligned view. Below 1 shows empty
  bands (the art is exactly `STAGE_HEIGHT` tall); the far case is already solved by `MAX_SEPARATION`.
  `ZOOM_PAD = VIEW_WIDTH - MAX_SEPARATION` makes the curve meet 1.0 exactly at max separation.
- **`STAGE_MARGIN` is 116, not 90**: it must be ≥ the widest sprite extent from the origin (jiujitsu `ko`
  = 116px) or a cornered body is cropped by the camera's world bound.
- **`Phaser.Input.Keyboard.JustDown` is NOT frame-scoped.** `Key._justDown` is set on keydown and cleared
  only by a `JustDown()` read or keyup, so polling it only while a menu is open lets a key *already held*
  when the KO landed (down = crouch, an ordinary way to die) fire a phantom edge. Poll every frame, act
  only in the right phase.
- **A Container's own depth is what sorts it against the scene**; its children's depths are only relative
  to each other. A menu container left at depth 0 renders *under* a depth-1 scrim — which looks like a
  colour choice, not a bug. Depth bands: layers 0–2, props 3–8, fighters 9–11, debug 50, HUD 100–101,
  Esc quit prompt 102. Fighter depth (`11`/`9`) follows the most recent MOVER, and must key off walk
  STATE, not position — pushback and knockback move a fighter who never acted.
- **Do NOT set a Phaser Image's `displayHeight` alone to scale a layer** — that setter changes only
  `scaleY` and squashes it to full width. Use `setScale()` or a pre-baked size. Stage layers are pre-baked
  to 1697×720 by `copy-stage-layers.py` and drawn at `setScale(1)`.
- **BootScene is two-phase**: `load.json` in preload → validate in create → queue every sheet and
  `portrait-<id>` → `this.load.start()` → on COMPLETE refuse routing if `failed>0` OR any expected
  texture is missing (blocks a 404 AND a corrupt-200). Portraits can't be queued in `preload()` because
  their ids come from the registry, which is only cached after preload.
- **`installFocusGuard` needs `disableGlobalCapture()`, not just `keyboard.enabled = false`**:
  `InputReader` builds keys with `addKey()` (capture defaults **true**) and Phaser's `KeyboardManager`
  listens on `window` and `preventDefault()`s any captured keyCode **regardless of event target**, so
  typing into a panel field is otherwise swallowed. It also calls `resetKeys()` so a key released over
  the panel can't strand an `isDown`. Capture is game-global while `enabled` is per-plugin, so it assumes
  ONE dev scene at a time (Boot guarantees that). **A `<select>` is NOT blurred by changing its value** —
  the shared `select()` helper `blur()`s on change, or the keyboard stays dead after a dropdown pick
  (this read as "the monk can't do any moves").
- `render/dev-panel.ts` is **function declarations only, no top-level DOM/fetch**, so importing it can't
  drag panel/save code into a prod bundle. The Gym saves through a **dev-server-only** Vite middleware
  (`vite/gym-save-plugin.ts`): full-origin match, 256 KB limit, shared `validate-character`, atomic
  temp+rename write.
- Gym boxes come off the **assembled** config, so `persist()` **divides by `stats.scale`**, and both
  persist and display round to **2dp, never integers**. **Guard is the exception**: it edits the
  STANCE TEMPLATE (all frames) via `render/gym-persist.ts`, and its display box is a scaled view of
  the template, *not* the assembled frame's box — editing the frame's box would smear a hand-authored
  per-frame override across every other frame. A template write then needs a full `rebuild()`, because
  each frame holds its own clone. (`applyFromPanel` rewrites all four fields when one
  is edited, so an integer display re-authors the untouched three at a fractional scale).
- **PlaygroundScene must never force `phase` back to `"fight"` after a KO** — `endRound` has already
  banked the win and left a fighter in `ko`, so the next tick banks it again until `matchWinner` sets;
  and a 15-tick `advance` batch can KO mid-loop, so a pre-loop pin can't catch it anyway. It pins the
  clock only while `phase === "intro"` and does a full `world.restart()` on any non-`fight` phase.
  **…and `restart()` zeroes the meter, so `resetWorld` must save and restore it** — right for a fresh
  match, wrong for a training scene whose whole purpose is trying a super repeatedly. Without it,
  farming meter on the dummy and KO'ing it confiscated the bar, which made the specials untestable
  exactly where you go to test them. The scene's panel also has **fighter select · regen hp · fill
  meter**, now named in the on-screen legend: a training feature nobody can find is not one.
- **Block can't use Left/Right Shift** — Phaser 4.2.1 dispatches by keyCode and both shifts are 16.
  Bindings: P1 WASD + F/G, block `Q`, super `E`; P2 arrows + `,`/`.`, block `/`, super `M`.
- **The super cut-in is derived arithmetic, not a tween** (`render/super-cutin.ts`, Phaser-free +
  unit-tested; `render/cutin-view.ts` is the shared scene-side owner, used by BOTH MatchScene and
  PlaygroundScene because the dummy is where you try the move). It reads `World.hitstop` counting
  down, so it advances under the e2e pump and cannot outlive the freeze it belongs to. The art is the
  **Phase 06 select portrait** drawn near 1:1 — an UPSCALE, so the no-mipmaps-on-NPOT softness that
  forced the HUD's own portrait bake does not apply.
- **A combo counter must be a persistent per-defender tally**, reset when the defender leaves
  `hitstun` — not a count of one drained batch. A 15-tick `advance` can carry several hits, and
  `hitId` restarts at 0 on every attack, so neither is usable as an identity.
- Input **edge presses are latched** in `pending[]` until a sim tick consumes them (held fields like
  `block` pass straight through) — **plus the `down` held at press time, surfaced as
  `InputSnapshot.downAtPress`**, so a buffered crouch normal doesn't come out standing when the player
  releases `down` before an actionable tick lands.
- `drawDebugBoxes` falls back to **`allHitBoxes(cfg, state)` — all distinct hit boxes across the state's
  frames**, not the first one, because a per-frame override may legally replace `hit[]` on a single
  active frame with different reach. Guard falls back to **`f.guardBoxes()` — the current FRAME's
  stance array** — so a frame carrying no guard box correctly draws nothing rather than advertising a
  stance box the sim would never honour. Bounds draw **faint when inactive, solid when active**.
- HUD is screen-space: `setScrollFactor(0)` on every element and it reads `VIEW_WIDTH`, not the world.
- **The HUD is atlas ART, and the art owns the geometry** (Phase 14). `hud.ts` authors only two scales
  and three offsets; the bar's width, **height** and fill-slot rect are read from the `hud-atlas`
  frames. Slot frames are packed in **atlas space**, so the plate's own `cutX/cutY` comes off first,
  and a flipped (P2) plate needs the mirrored slot `barW - dx - w`. The coloured fill is a `Graphics`
  drawn **behind** the plate so it shows through the transparent slot — which means **`fillStyle` must
  be set before `fillGradientStyle`**: the gradient is WebGL-only and the Canvas renderer *skips the
  command*, leaving whatever fill style preceded it (the black backdrop) to draw the health bar black.
  Portraits cover-crop into the plate's arch with no crop and no mask — the overflow hides under the
  plate — but never letterbox one (that is Phase 11's black band). The bar plate is drawn
  **non-uniformly** (`BAR_SCALE_X`/`BAR_SCALE_Y`): its 40 px of bezel above and below the slot is
  frame art, not padding, so "thinner and wider" has no uniform-scale answer.
- **Phaser only builds mipmaps for POWER-OF-TWO textures**, so a heavy downscale of an NPOT texture is
  a raw bilinear squeeze and reads as low-res. That is why the HUD faces are their own bake
  (`copy-portraits.py --hud` → `ui/portraits/hud/<id>.png`, loaded as `hud-portrait-<id>`) rather than
  the 448×600 select card: measure the ratio between a texture's size and its drawn size before
  concluding the source art is bad.
- **The HUD entrance is derived from `match.introTicks`, not a tween or a wall clock**
  (`render/hud-entrance.ts`, Phaser-free + unit-tested). That buys replay-per-round and the
  Enter-rematch for free, since both go through `beginRound()`, and lets an e2e scrub the animation by
  writing one number. The entrance scales the drawn WIDTH only — **colour tier and blink must key off
  real health**, or a full-health fighter opens the round red and blinks through yellow into green.
  PlaygroundScene zeroes `introTicks` before advancing, so it always renders the settled HUD.
- **There is deliberately NO per-prop `scrollFactor`** in `PropConfig` (a factor < 1 drifts a prop across
  the roof as the camera pans); only `scale`. The **water tower and left-side shed are BAKED into
  `medium.png`/`main.png`**, not props — resizing them needs an art regen. Measure a prop's displayed
  opaque height against the fighter (~183px) rather than eyeballing.
- The front `near` occluder was **dropped from `stages.json`** in the resolution pass (its dusk-palette
  edge read as "residual purple"); BootScene still preloads `near.png`, so re-adding a `<stage>-near`
  entry restores it. The stage is 3 layers now.

## Conventions

- Timing is always in **ticks** (integers at 60 Hz), never wall-clock seconds, inside the sim.
- Comments tagged `ponytail:` mark deliberate simplifications with their upgrade path. Intent markers,
  not TODO noise.

### Measure the claim against the thing it claims about

Four bugs, one shape. Each shipped for one or more phases and was invisible to the whole test suite,
because the tests only ever compared code to other code.

- **A box is a claim about a sprite.** The ground heavy had a crouching hurt box and a shin-height hit box
  on top of a standing punch. One-liner that catches the class: read the sheet's alpha, take the topmost
  opaque row per frame, compare to `hurt.h`. `scripts/` still has no gate for box-vs-art agreement.
  **It happened again in Phase 15**, one phase after this was written: the jiujitsu's `special` is a
  spinning FLOOR SWEEP and shipped with `hit.y 75 h 85` + `body:"stand"` — a chest-height box, so a
  STANDING guard stopped it and a crouching one ate all five hits. Inverted, not merely off. Measure the
  strike, don't eyeball it: difference each frame against frame 0 and take the y band of the
  furthest-forward moved pixels (that put the leg at 22–99px above the feet, and the box at `y 12 h 50`).
  **`registry.test.ts` now sweeps every special × every defender × three spacings** for which stance
  turns damage into chip — the same shape as the normals' blocking matrix, which had no special row.
  When body and art disagree on a state whose frames are mostly crouched, prefer the CROUCH profile: a
  hurt box larger than the art means you get hit by things that visually miss, one smaller means attacks
  pass through you, and the second is the worse failure.
- **An ANIMATION is a claim about a move — measure its length against that move.** Attack anims used an
  authored per-state `fps` that had drifted: every fighter's `attackLight` had 0.43s of art over a
  0.25–0.27s move, so playback was cut at ~60% and **the strike was never drawn** ("the light attack does
  nothing"), while `crouchHeavy` finished early and froze ("runs too quickly"). Frame rates are now
  DERIVED (`fps = renderFrames * TICK_HZ / simTicks`) in the Phaser-free `src/render/anim-timing.ts`.
- **…and measure its PHASE too, not just its length.** Even at the right length the strike landed on a
  wind-up pose on 10 of 18 sheets, because nothing aligned the *contact frame* with the *active window*.
  `render.sheets.<state>.hit` (measured by `check-attack-sync.py`) plus `attackFrameDurations` now spend
  the `startup` ticks on frames `0..hit-1` and the rest on `hit..n-1`. Three traps: (1) **the obvious
  metric is the wrong one** — furthest opaque column measures the whole silhouette, and for a
  wide-stanced fighter the widest thing in frame is a planted leg; difference each frame against frame 0
  to isolate what MOVED. (2) A sheet the metric can't call reports **INDETERMINATE and keeps uniform
  timing** — never a guessed number. (3) **`PLAY_LAG_TICKS`**: `play()` runs in the render pass AFTER the
  tick that entered the state, so the animation clock is one tick behind the sim — budget the wind-up
  `startup - 1` ticks or the contact frame lands on the LAST active tick. Invisible to perfect arithmetic;
  only showed up by tracing `stateFrame` against `anims.currentFrame` on the running game.
- **…and when you fix a defect class, sweep the WHOLE class.** The derivation above was applied to attacks
  and stopped there; every other sheet kept a flat authored `fps: 8` for two more phases. `knockdown` got
  750ms of art for a 300ms state, cut at frame 2 of 6 — **and the fall is frames 3–5**, so a fighter stood
  bolt upright through his entire knockdown. `attackFrameRate` is now **`stateFrameRate`** and also covers
  jumps (arc = `jumpVelocity / gravity`, constant per fighter, bakeable at registration); stun length is
  chosen by the attack that *caused* it and is only known once the state is entered, so **`stunFrameRate`**
  supplies it as a play-time override. That override **disables Phaser's per-frame durations** —
  `Animation.getNextTick` only honours them while `state.frameRate === currentAnim.frameRate`
  ([Animation.js:518](node_modules/phaser/src/animations/Animation.js#L518)) — which is safe only because
  attacks are the sole carriers of durations and `stunFrameRate` returns `null` for every attack state.
  The unit test proves the arithmetic; the **browser** test is the one that matters, because the
  arithmetic was already right and what could still fail is the override reaching Phaser's clock.
- **…and an ATTACK animation is a claim about REACHING the other fighter — every metric here is
  direction-blind.** Phase 15's brawler super measured beautifully (silhouette height alternating
  `100/115/115/100/…`, no dead pairs, motion floor cleared) and was still wrong: the uppercut travelled
  purely VERTICALLY, up beside his own head, while the hit box reaches 145px forward — so nothing on
  screen ever crossed the gap ("he is not moving the hands through the enemy"). `check:sprites`' motion
  floor, `audit:anim`'s per-pair change and silhouette height all score a big vertical swing exactly as
  well as a big horizontal one, **and the vertical one is the one that misses**. Same blindness passed
  the frame where the fighter had fallen flat on his back — a body on the floor is a large silhouette
  change, which is what the metric rewards. Fix in the prompt by naming the TARGET ("at an opponent
  standing just in front of him to the RIGHT … reaching well past where his own toes are"); the tell
  that it worked is the minimum adjacent change (0.01 → 0.36) and heights going FLAT, not taller.
- **The forgotten prompt variable is the SAMPLING RATE, and it is not the same problem as amplitude.**
  ffmpeg takes N frames evenly across the 4s clip, so a correct motion occupying a sliver of each swing
  lands 6 of 8 samples mid-return and reads as *standing still*. Ask the model to **HOLD** at full
  extension (or name the cycle COUNT for a cyclic state) — describing the motion harder does nothing.

Related: **a held state must not loop if any frame leaves the pose** — a looping `crouch` sheet whose
first frames are the standing wind-up reads as the fighter popping up out of the crouch. The inverse
also holds: `blockCrouch` **does** loop (`render.sheets.blockCrouch.loop:true`, Phase 13b) precisely
because EVERY frame stays in the low guard — a contained crouch bob — so it keeps the guard visibly
alive while held without ever popping up. `block` (high) stays a one-shot hold. Render loop is the
Phaser `repeat` from `render.sheets.<state>.loop`; the builder's sim `StateSpec.loop` is independent
and only clamps the sim `stateFrame` (irrelevant for a guard whose frames all carry the same box).

Same rule for art: prefer a measurement to an opinion, and a wrong metric is more dangerous than no
metric. Detail in [`docs/art-pipeline.md`](docs/art-pipeline.md).

### Balance

**Compare fighters by EFFECTIVE reach (`hit.x + hit.w − own pushbox half`), never by raw hit-box reach.**
The monk's art is a wide low stance, so his pushboxes are bigger (`pushStand 60` / `pushCrouch 76` vs
56 / 60), which parks him further from the opponent and lands the same nominal hit box short — he played
as if his moves "didn't reach" even though they executed and connected. A wide-bodied character needs
correspondingly longer hit boxes just to break even. `reach-parity.test.ts` pins it. Only `w` was
changed — **`y`/`h` decide high/low, so never touch them for a reach tweak**.

### Testing

- Tests live next to code as `*.test.ts` and drive the sim directly via `World.tick()` with crafted
  `InputSnapshot`s. `combat.test.ts` covers hit/block/trade rules; `regression.test.ts` pins specific
  ordering bugs (labelled P1-1, P2-1, …).
- **Render-layer logic gets tested by being MOVED out of the scene.** `edge-latch.ts`, `flow-state.ts`,
  `anim-timing.ts` and `camera-frame.ts` are Phaser-free modules precisely so vitest's node env can reach
  them — if a scene rule has an edge case, that's the move, not a browser test.
- **A regression test you haven't watched FAIL is decoration.** Re-introduce the bug, confirm the test
  goes red, restore. Phase 10 shipped two fakes before a real one: the first never triggered the code
  path it was named after, the second could pass vacuously on `undefined === undefined` (assert
  `typeof x === "number"` when reading a value through a DEV hook).
- **A screenshot catches what no test can.** Phase 11's two worst defects (invisible cards, everything
  dim) both passed the full unit + e2e suite. Look at it.
- **A reviewer's finding can be real while its diagnosis is wrong — re-derive, don't apply the patch.**
  Phase 10's QA agent correctly measured input being swallowed after a reset and blamed an
  `EdgeLatch`/keydown race that is impossible (keydown is emitted before the scene's `update`); the actual
  cause was a reset loop next door. Take the *symptom* as evidence and the *cause* as a hypothesis.

### Phaser 4 timing

**TWEENS run on the wall clock, `Time.Clock` runs on the delta.** `TweenManager.getDelta()` reads
`Date.now()`, so a tween does **not** advance under the e2e's pumped `game.step` — anything sequenced off
a tween's `onComplete` is both untestable and one interrupted tween away from deadlock. Hang game logic
on `this.time.delayedCall`; keep tweens decorative. Corollary: **`killTweensOf(target)` kills EVERY tween
on that target** — an entry fade and a selection scale sharing one target means killing the second freezes
the first, which is how Phase 11's cards ended up permanently at alpha 0. Track and stop the specific
tween, and have a fade force-settle its end value on `onStop` as well as `onComplete`.

## Playwright E2E (`e2e/`)

The sim/animations only advance inside Phaser's game step, which **headless Chromium throttles/pauses**
(reports the page hidden → `HIDDEN` → `loop.pause()`). Trusted **keyboard events also don't reach Phaser
headless**. So a spec: (1) `window.__game.loop.stop()` then pumps `window.__game.step(t, 1000/60)` as the
sole clock; (2) drives P1 input via the DEV `window.__holdP1(Partial<InputSnapshot>)` seam, not synthetic
keys; (3) pumps past the intro phase (`INTRO_TICKS=90`), which gates input, before expecting movement.

- **`/` boots the MENU, not a match** — any spec that wants a match must navigate to **`?scene=match`**
  (DEV-only route). Boot pulls the whole sprite/stage/portrait set through the dev server, so the per-test
  timeout is **60 s** and the older specs' internal boot waits are 30 s. If a spec fails inside `ready()`'s
  `waitForFunction`, suspect boot cost, not the assertion.
- **`workers` is capped at 4** in `playwright.config.ts` — every worker cold-boots the whole asset set
  through one dev server, and past ~4 concurrent boots they starve each other and specs whose bodies take
  milliseconds time out at random. **A "new spec broke three unrelated ones" result is usually contention,
  not a regression**: re-run the suite without the new file before believing it. A spec whose BODY is
  genuinely expensive should call `test.slow()` (`cpu-difficulty.spec.ts` does).
- **The DEV `__holdP1`/`hold` seams FORCE a pressed flag true every frame**, whereas the real
  `InputReader` emits `*Pressed` as a 1-frame RISING edge. Holding it two pumped frames = two edges = a
  double-fire under the (correct) input buffer; specs must feed a 1-frame edge (`pump(1)`).
- **Batch the round-trips.** A spec that alternated `hold()` / `pump()` / read ~45 times grazed the
  timeout and went flaky; running the whole scripted sequence inside ONE `page.evaluate` that returns the
  observed states is stable and loses no coverage (the sim is deterministic).
- **`pump()` takes a delta** — passing `0` gives a frame that advances no sim tick, which is how the
  sub-tick phase bugs are reproduced deterministically instead of hoping for a short frame.
- **`game.loop.now` STOPS UPDATING after `loop.stop()`**, so the usual `let t = g.loop.now` at the top
  of `pump()` re-reads the same frozen value on every call: N separate `pump(1)`s all replay roughly
  the same wall-clock instant. Sim ticks still advance (they count frames), so anything driven by
  `world` is fine — but anything keyed off the `timeMs` Phaser hands `Scene.update` (today: only the
  HUD's low-health blink) looks frozen. Drive such a sequence from ONE `page.evaluate` that keeps its
  own accumulating `t`. This cost a QA pass a false "the HUD is frozen" finding.
- **Tween callbacks never fire under the pump**, so a spec can only wait on `Time.Clock`-driven progress —
  pump in a bounded loop until the expected global appears, never "one more frame".

## Tooling gotchas

- **A `codex:rescue` review DOES run inside plan mode.** Two real constraints, neither about plan mode:
  (1) the forwarding subagent **hard-refuses any prompt that mentions relayed authorization** ("the user
  confirmed…") — phrase the task plainly, describe the design, ask the questions, say "read-only, do not
  edit files"; (2) that subagent is scoped to a single `task` call, so it **cannot poll or return its own
  result** — fetch it yourself:
  `node ~/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs result <task-id>`
  (`… status` lists jobs, `… status <task-id>` shows live phase). A review takes several minutes; poll in
  a background Bash loop rather than blocking. If it refuses citing plan mode, update the Codex CLI; it
  also defaults to `--write`.
- **A `codex:rescue` review of a file OUTSIDE the workspace root hangs silently** — Codex sat 9 minutes
  frozen mid-read with no error on a plan in `~/.claude/plans/`. **Inline the file's text into the
  prompt** instead of passing its path, or copy it in-tree. In-tree files read fine.
- **`taskkill /PID` from the Bash tool needs `MSYS_NO_PATHCONV=1`** — Git Bash rewrites the leading `/PID`
  into a path and the kill silently fails. Same MSYS translation as the ctx7 rule; it generalises to any
  Windows tool taking a `/FLAG` argument.
- Real git history starts **2026-07-22**; `git stash`/`diff`/`log` all work. Notes older than that saying
  "there is no VCS safety net" are stale — except for the gitignored `concepts/` art, which is still only
  on this machine.

## Assets

`public/` is the Vite static root: `sprites/<id>/<state>.png` (per-state sheets, 320×256 cells),
`configs/character-gym.json` (fighter registry, each `{ render, data }`), `ui/portraits/<id>.png`
(448×600 — **downscale from the Phase 06 masters, never regenerate**) and `ui/portraits/hud/<id>.png`
(192×294, the HUD's own bake), plus `ui/` `props/`
`backgrounds/`. Schema in [`public/configs/sprite-schema.md`](public/configs/sprite-schema.md);
provenance/licensing in [`docs/asset-manifest.md`](docs/asset-manifest.md). `tsconfig` has
`resolveJsonModule` so sim tests import the registry JSON directly.

`concepts/` is **authoring** art, not shipped — nothing loads from there. Read
[`concepts/backgrounds/README.md`](concepts/backgrounds/README.md) for the full stage geometry contract,
measured wrap seams, and the worked `STAGE_WIDTH = 1696` config.
