# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Vibe Fighter** — a local two-player Street Fighter–style game. Vite + TypeScript + Phaser 4
(`^4.2.1`). The gameplay is a deterministic 60 Hz simulation; Phaser is only a rendering/input adapter
on top of it. Rendering uses **default LINEAR antialiasing — no `pixelArt`** — because the art is
photographic (video-derived sprites + painted backgrounds).

Built in phases. **Phases 00–15 are shipped, plus a post-15 animation/box defect pass
([`docs/phases/16-animation-box-defect-pass.md`](docs/phases/16-animation-box-defect-pass.md)), the
Phase 16 integration/parity gate
([`docs/phases/16-integration-parity-qa.md`](docs/phases/16-integration-parity-qa.md)), and a post-16
defect pass ([`docs/phases/17-meter-lie-and-cpu-pick.md`](docs/phases/17-meter-lie-and-cpu-pick.md)),
and Phase 18's mobile/touch support
([`docs/phases/18-mobile-touch.md`](docs/phases/18-mobile-touch.md)), and Phase 19's mobile viewport +
pad art pass
([`docs/phases/19-mobile-viewport-and-pad-art.md`](docs/phases/19-mobile-viewport-and-pad-art.md)),
and Phase 20's game audio
([`docs/phases/20-audio.md`](docs/phases/20-audio.md)).**
Specs and gate
results in [`docs/phases/`](docs/phases/); the narrative of what shipped when, including the fix passes
between phases, is in [`docs/history.md`](docs/history.md). `prompts.pdf` holds the original spec.

Art direction is **rooftop-dusk**, locked in Phase 03. Roster is **brawler / jiujitsu / monk** — those
ids are canonical from `concepts/characters/` through to `public/sprites/<id>/`. Generating art is its
own discipline with its own expensive lessons: [`docs/art-pipeline.md`](docs/art-pipeline.md).

### The rest of `docs/`

| File | What it is |
| --- | --- |
| [`architecture.md`](docs/architecture.md) | the sim/render boundary, consolidated |
| [`history.md`](docs/history.md) | what shipped when, including the fix passes between phases |
| [`lessons.md`](docs/lessons.md) | the worked defect cases behind the measurement rules below |
| [`art-pipeline.md`](docs/art-pipeline.md) | generating sprites/backgrounds, and what it costs to get wrong |
| [`PRD.md`](docs/PRD.md) | the product spec the phases were cut from |
| [`traceability.md`](docs/traceability.md) | PRD requirement → phase → test mapping |
| [`asset-manifest.md`](docs/asset-manifest.md) | provenance/licensing for everything under `public/` |
| [`skills-map.md`](docs/skills-map.md) | which Claude skill each phase expects |
| [`phases/`](docs/phases/) | per-phase spec + gate log |
| [`reviews/`](docs/reviews/) | cross-phase senior/QA review write-ups |

## Commands

```bash
npm run dev        # Vite dev server (hot reload)
npm run build      # tsc --noEmit typecheck, then vite build
npm run typecheck  # tsc --noEmit only
npm test           # vitest run — `include` is src/**/*.test.ts ONLY, sim unit tests, node env
npm run test:e2e   # Playwright browser acceptance for the render layer (e2e/, headed)
npm run preview    # serve the BUILT bundle — the only place the production CSP is testable
npm run build:audio  # masters -> public/audio/*.mp3 (needs the gitignored concepts/ masters)
npm run check:audio  # HARD gate: per-cue duration/peak/crest/bytes, the 1.2 MB budget, and the
                     # worst-case ONE-FRAME mix (a KO fires 3 cues at once and used to clip at +3.9 dBFS)
```

Run one test file: `npx vitest run src/sim/combat.test.ts`
Filter by name: `npx vitest run -t "corner"`
Watch mode: `npx vitest` (no `run`)
One e2e file: `npx playwright test e2e/phase16-parity.spec.ts`; by name: `-g "timeout"`

TypeScript is strict with `noUnusedLocals`/`noUnusedParameters`/`noImplicitReturns` — an unused import
or param fails the build. **But `tsconfig` `include` is `["src"]`**, so `tsc --noEmit` typechecks
NEITHER `vite.config.ts` NOR `vite/gym-save-plugin.ts` — a broken import there fails `vite build` or
`vitest run`, not the deploy-gating typecheck.

[`probe/koprobe.test.ts`](probe/koprobe.test.ts) sits outside `test.include` on purpose: it is the
manual ticks-to-KO balance probe (the CPU-difficulty measurement), not a test, and `npm test` never
runs it. **No CLI flag reaches it** — Vitest 4 dropped `--include`, and `--dir`/a path filter still
intersect with the configured `include`, all reporting `PASS (0)`. To run it, widen `test.include` in
`vite.config.ts` or copy the file under `src/` for the run.

### Asset + art scripts

```bash
npm run build:sprites    # pack raw frames (concepts/characters/sprites/<id>/<state>/NN.png) -> public/sprites/<id>/<state>.png
npm run check:sprites    # gate: cell size, frame count == JSON, feet-anchored, height, NO-PURPLE hue, attack MOTION_MIN
npm run check:sync       # gate: measure each attack sheet's CONTACT frame, check against render.sheets.<state>.hit; --write records it
npm run audit:anim       # roster-wide animation REPORT (advisory, always exit 0)
npm run audit:boxes      # roster-wide BOX-vs-ART report: hurt height vs the figure, hit band vs the
                         # measured strike, and the HORIZONTAL reach gap — limb tip vs box far edge
                         # and the visible air at max connect range. HARD GATE since Phase 19: exits 1
                         # on any flag, budget AIR_GAP_MAX=30. `--advisory` restores exit 0 for an art
                         # regeneration session. All 21 sheets pass.
npm run gen:placeholder  # regenerate 19 states x 3 fighters of placeholder sheets
                         # (`-- --state <name>` limits it — without it this OVERWRITES the real art)
npm run key:layers       # re-key + validate the Phase 04 parallax layers
npm run copy:stages      # pre-bake keyed layers to runtime 1697x720 into public/backgrounds
npm run copy:portraits   # Phase 06 masters (1792x2400) -> select cards at 448x600 AND hud/<id>.png at 192x294
npm run build:atlases    # key + measure + pack the Phase 07 UI/prop atlases into public/
python scripts/build-atlases.py --pad  # ONLY the Phase 19 touch-pad atlas: procedural, no model, no
                         # `concepts/` input, so unlike the default path it runs on a fresh clone
npm run check:characters # validate the Phase 05 character refs
npm run check:portraits  # validate the Phase 06 select portraits
bash scripts/gen-audio.sh                   # regenerate audio masters (SPENDS CREDITS; reuses a job
                         # record for free where one exists — `generate get <id>` restores its URL)
python scripts/build-audio.py --selftest    # the audio gate's own fixtures
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
  matters — but remember it does NOT cover `vite.config.ts` or `vite/` (see Commands); `vite build`
  is what catches those. Python art scripts never run there; only what's committed under `public/` ships.
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
  **A fighter's meter therefore lands on multiples of its OWN damage, never on a shared grid** — pinned
  as R-14. The ground heavy pays the brawler 15 but jiujitsu and monk 14, so seven clean heavies put the
  brawler on exactly 100 and the other two on **98** — two points short, i.e. one more landed hit — and
  the HUD drew that as 98% of the
  slot (measured live: 315 px of a 318 px bar) while the super refused in total silence. Same shape as
  R-13 — an absolute constant compared against numbers that differ per fighter — and invisible to 299
  unit + 72 browser tests because every one of them assigned `METER_MAX` directly and never asked what
  value a *player* arrives at. **`render/meter-view.ts` now owns the ready decision** so the HUD and the
  sim cannot disagree about it; do not "fix" this class by rounding the meter up or re-balancing damage
  onto a round number, which changes the economy to hide a drawing bug.
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
- **`cpu.ts`'s attack RANGES are derived from the fighter's own boxes, never mirrored** (Phase 19).
  They were `LIGHT_RANGE = 110` / `HEAVY_RANGE = 150`, hand-copied from the brawler; the roster-wide
  reach trim orphaned them, and the CPU then committed heavies out of range and spent **full meters** on
  supers that could not reach — the special is now SHORTER than the heavy on all three fighters, which
  the old comment explicitly assumed it never would be. `reachOf()` reads `allHitBoxes()`. Two traps
  behind that: **neither normal is reliably the longer one** (jiujitsu heavy 110 < light 113), so the
  approach walks to `min` and the reaction timer arms inside `max` — pairing "timer on heavy" with
  "approach on light" left that fighter parked in the 3px gap dealing ZERO damage for a whole round; and
  **`cpu.test.ts` must build from the shipped registry**, because `config.ts`'s `TEST_DUMMY` was never
  trimmed and cannot express the inverted case at all.
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
- **A timeout is decided on the health SHARE (`health / maxHealth`), never on raw health** — fighters
  do not share a pool (brawler 105, jiujitsu/monk 100). Raw health handed the brawler every timeout in
  which both fighters had taken equal punishment, *including none*: two fighters who never touched
  each other, both bars visibly full, ended 2-0 to the brawler on time. It survived every test because
  every test assigned both healths from the same implied pool — the asymmetry only exists BETWEEN
  fighters, and nothing had ever timed out a mismatched pair. Pinned as R-13. Generalises: **any
  cross-fighter comparison of an absolute stat is suspect** while `maxHealth`, `scale` and the
  pushboxes all differ per fighter — this is the same shape as comparing raw hit-box reach instead of
  effective reach (see Balance).
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
- **The canvas WIDTH is not a constant (Phase 19).** `Scale.FIT` alone pillarboxed a locked 16:9 canvas
  on a phone, so `main.ts` reshapes the GAME to the device's aspect —
  `scale.setGameSize(viewWidthFor(parentW, parentH), STAGE_HEIGHT)` from a `Scale.Events.RESIZE`
  listener — and FIT then has nothing to letterbox. **The height NEVER moves** (the stage art is exactly
  `STAGE_HEIGHT` tall and `centerOn` is bottom-aligned). The decision is Phaser-free in
  [`render/viewport.ts`](src/render/viewport.ts), bounded by `VIEW_WIDTH` (the menus are budgeted
  against it) and `STAGE_WIDTH` (above it the camera needs world that does not exist). `src/sim/` is
  untouched: `MAX_SEPARATION` is still `VIEW_WIDTH - 240`, and `camera-frame.ts groupZoom` deliberately
  keeps the CONSTANT so vertical framing is unchanged and the extra width only reveals more rooftop.
  Four things are load-bearing:
  - **`Phaser.Scale.EXPAND` + `scale.min`/`max` is a TRAP, not the answer.** `parseConfig` maps min/max
    onto `displaySize` — the CSS size — and `Size.getNewWidth` clamps to `minWidth` BEFORE comparing to
    the parent, so `min.width: 1280` writes `style.width: 1280px` onto an 851px phone with a -215px
    margin. Looks fine on a desktop, wrong on every phone.
  - **Do NOT also centre the canvas in CSS.** Phaser's `CENTER_BOTH` writes `marginLeft`/`marginTop`,
    and a grid/flex parent centres the canvas's MARGIN BOX, so the two compose and park it a quarter of
    the gap off to one side. That was the "not centered" bug. Same reason `image-rendering: pixelated`
    must stay OFF the canvas — it contradicts the no-`pixelArt` LINEAR decision.
  - **Every screen-space owner has a `layout(width)`** (`Hud`, `CutInView`, `TouchPad`, MatchScene,
    FlowScene), called once from `create()` and again on RESIZE via a **bound property** so `SHUTDOWN`
    can `off()` it. `TouchPadState` holds a SECOND copy of the pad layout — write both, and `cancel()`
    the live contacts first or a thumb keeps holding a button that has moved.
  - **A second camera created with an explicit size does NOT auto-resize.** `CameraManager.onResize`
    only resizes cameras whose dimensions equal the PREVIOUS game size, so MatchScene's `uiCam` must be
    built from `scale.gameSize` and sized in `layout()` — hardcoded at 1280 it cropped P2's HUD plate
    off a phone screen entirely.
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
  colour choice, not a bug. Depth bands: layers 0–2, props 3–8, fighters 9–11, debug 50, **touch pad
  96–97**, end scrim 99, HUD 100–101, Esc quit prompt 102, match-end menu 103, super cut-in 104–106,
  **mute button 107**. The mute button is deliberately the topmost thing on screen: a control that
  disappears during a super freeze or behind the end-menu scrim is not a mute control.
  The pad is deliberately BELOW the cut-in (which owns the screen during a freeze) and below the end
  menu; it never collides with the HUD because it lives at the bottom and the HUD at the top.
  Fighter depth (`11`/`9`) follows the most recent MOVER, and must key off walk
  STATE, not position — pushback and knockback move a fighter who never acted.
- **Do NOT set a Phaser Image's `displayHeight` alone to scale a layer** — that setter changes only
  `scaleY` and squashes it to full width. Use `setScale()` or a pre-baked size. Stage layers are pre-baked
  to 1697×720 by `copy-stage-layers.py` and drawn at `setScale(1)`.
- **BootScene is two-phase**: `load.json` in preload → validate in create → queue every sheet and
  `portrait-<id>` → `this.load.start()` → on COMPLETE refuse routing if `failed>0` OR any expected
  texture is missing (blocks a 404 AND a corrupt-200). Portraits can't be queued in `preload()` because
  their ids come from the registry, which is only cached after preload.
  **`loader.timeout` is unset, so a request that never resolves hangs boot forever** — for the registry
  JSON, both atlases, the stage layers, every sheet, every portrait and (since Phase 20) every sound
  alike. Measured, not fixed: it satisfies "refuse to route" and the failure direction is the safe one
  (the title screen waits rather than the game starting broken). Raised by a QA pass as an audio gap;
  it predates audio by eighteen phases. Re-derive a finding's blast radius before accepting its framing.
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
  **Mute is `N`** (Phase 20), bound in both MatchScene and FlowScene — `M` was already P2's super.
- **Touch (Phase 18) is ONE extra argument, not a second input route.** `InputReader.read(touchHeld?)`
  ORs the pad's held flags into P1's **before** the existing `prev`/`now` comparison, so there is still
  exactly one implementation of `*Pressed` and touch inherits the 1-frame rising edge instead of
  re-deriving it. The rules live in Phaser-free [`render/touch.ts`](src/render/touch.ts);
  [`render/touch-view.ts`](src/render/touch-view.ts) is the adapter. Three things that are load-bearing:
  - **"Touch" means `maxTouchPoints > 0` AND `matchMedia("(pointer: coarse)")`** — the PRIMARY pointer
    is a finger. Not `game.device.input.touch` (capability: a touchscreen laptop would lose local PvP
    and gain a pad it does not need), and **NOT `!any-pointer: fine`**, which is what shipped and what
    a real Samsung S23+ / Android 16 disproved on the first try: Android reports `any-pointer: fine`
    TRUE for stylus/DeX capability, so the entire phase switched itself off on the device it was built
    for — title read "PRESS ENTER", nothing tappable, no rotate gate. Every emulator agreed with the
    broken version. `any-pointer` asks "could a fine pointer exist"; `pointer` asks "what do you point
    with", which is the actual question. **Two seams exist for this and are NOT DEV-gated**, because
    device classification is the one decision here that cannot be reproduced from this machine:
    **`?touch=1` / `?touch=0`** forces the mode, and **`?diag=1`** prints what the device actually
    reports (`maxTouchPoints`, `pointer:coarse`, `any-pointer:*`, `hover:none`, viewport, dpr) on the
    title screen. Reach for `?diag=1` FIRST on any "it doesn't work on my phone" report — two fix
    attempts were burned guessing at hardware before it existed. Its mere presence also settles the
    stale-cache hypothesis: a build without it cannot draw it.
    **`touchMode()` is memoised**: Flow, Match and `main.ts`
    all ask, at different times, and three derivations are three chances to disagree (R-14's shape).
    Threading it through `MatchConfig` does NOT work — `?scene=match` boots with no FlowScene.
  - **`TouchPadState.consume()` is a queued press counter with a forced 1-frame release gap.** Phaser
    dispatches touch **synchronously from the DOM listener** (`InputManager.onTouchStart` calls
    `updateInputPlugins` directly — nothing waits for the game step), so a tap whose down+up land
    between two frames is invisible to a plain "is a finger on it" read and the attack never comes out;
    and a plain sticky bit still swallows the second of two fast taps, because `InputReader.prev` is
    already true. Do not "simplify" this back to a boolean.
  - **Scene-level pointer events, not per-button `setInteractive()`** — a Game Object hit test would put
    the multi-touch and slide rules inside Phaser where vitest cannot reach them. Subscribe to
    `pointerupoutside` as well as `pointerup` (`InputPlugin.js:2064-2075` picks between them on
    `pointer.upElement === game.canvas`, and a letterbox bar is outside the canvas ELEMENT), and hiding
    the pad must also DEACTIVATE it — invisible objects keep their scene-level listeners.
- **The rotate overlay does NOT block Phaser input on its own.** `TouchManager.onTouchStartWindow`
  (`TouchManager.js:280-287`) is registered on `window` and forwards any touch whose `target !== canvas`
  straight into `InputManager` — so a tap on a DOM overlay still hits the menu underneath. `main.ts`
  sets **`game.input.enabled = false`** while blocked; that is the actual gate, the `<div>` is the
  visible half. And `applyOrientation()`'s first call rides **`Phaser.Core.Events.PRE_STEP`**, because
  `TimeStep.sleep()` is `if (this.running)` and `loop.start()` runs after READY — called at boot it
  would set the class and never pause. `screen.orientation.lock()` is deliberately NOT called (needs
  fullscreen on Android, unsupported on iOS Safari); Phaser's `scale.lockOrientation()` is dead code —
  it calls the removed `screen.lockOrientation` and always returns `false`.
- **Audio (Phase 20) is the same split as everything else**: the DECISION is Phaser-free in
  [`render/audio-cues.ts`](src/render/audio-cues.ts) (which sim event becomes which cue, cooldowns,
  priority, a 3-per-frame cap), and [`render/audio-view.ts`](src/render/audio-view.ts) `GameAudio` is
  the **only thing in the project that touches `this.sound`**. It owns the mute button too, so a scene
  wires one object: one `objects` array for the camera lists, one `layout(width)`, one `destroy()`.
  Six things are load-bearing:
  - **`CueKey` is derived from the `CUE_KEYS` tuple**, never written twice — a TS union does not exist
    at runtime, so "a test proves the union and the file list agree" is unwritable.
  - **`whiff` and `jump` come from `World.consumedInputs`, NOT from a state comparison.** A render
    frame can drain 15 sim ticks (`advance` clamps a stall to 0.25 s) and the brawler's light attack is
    exactly 15 ticks — so a slow frame starts it, runs it and returns to idle, and a state comparison
    sees idle→idle and plays nothing. `land` stays a transition because being grounded persists.
  - **Movement cues are gated on `phase === "fight"`**, and the trackers keep updating outside it. That
    one predicate kills a phantom `land` at the top of round 2 (a fighter KO'd in the AIR leaves
    `grounded: false` behind), the `settleBodies` thud during the round-end pause, and any noise from
    the intro pose-set. Keying it off the `roundStart` EVENT does not work: that is pushed when the
    intro ENDS (`world.ts`), ~90 ticks after `resetRound()` actually moves the fighters.
  - **`sound.mute` is a MECHANISM, not a source of truth.** On WebAudio the setter schedules
    `masterMuteNode.gain.setValueAtTime` and the getter reads that gain back — and a **suspended**
    context (before the first gesture) silently discards the write and reads back wrong. `GameAudio`
    keeps its own `mutedFlag`, with a module-level in-memory fallback *written before* the
    `localStorage` attempt, because storage throws in private-mode Safari and the setting has to
    survive one scene's `GameAudio` being destroyed and the next being built.
  - **`destroy()` must `off()` the exact unlock handler and `manager.remove()` the bed.** The
    SoundManager is game-global: a deferred `once(UNLOCKED)` armed by FlowScene outlives it and would
    start the MENU bed on top of the match ambience, and `stop()` alone leaves the instance in
    `sound.sounds` to accumulate on every Esc → Flow → match round trip.
  - **Cues play at `CUE_VOLUME` (0.5), which is a clipping fix.** A KO fires `hitHeavy` + `ko` +
    `roundEnd` on one frame; at full volume the shipped files sum to **+3.9 dBFS**. `check:audio`
    recomputes that worst case from the files and parses the volume out of `audio-view.ts` — do not
    re-copy the constant into the script, which is exactly the drift it caught once already.
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
  **Phase 15's `meter-bar` is a second plate on the same contract** — packed to the same 460 px width
  so the bevels line up, drawn at the same anisotropic scales, its fill read off `meter-bar-slot` with
  the same mirrored-for-P2 arithmetic. Two things the packer needed: the slot rule's height floor was
  `0.40` of the plate on a sample size of ONE (the health channel is 43%) and rejected the meter's 38%
  for being exactly the shallower bar it was asked to be — now `0.33`, still 30× the 1% decorative
  panel lines it exists to reject; and the HUD's vertical budget had to start measuring the **drawn**
  height (`BAR_SCALE_Y`), because on packed heights alone two plates read as 246 px of HUD and failed
  an assertion that in truth clears a jumping head by 90 px.
  **The meter's READY state is `render/meter-view.ts`, not a `frac >= 1` test in the draw call.** It is
  Phaser-free so the boundary is unit-testable, and it exists because the HUD and the sim disagreed
  about the same number (R-14 above). Two rules it encodes: an UNREADY fill is compressed into the
  first 92% of the slot — a straight fraction drew 98/100 as 315 px of a 318 px bar, i.e. full — and
  the **`MAX`** label is the cue, because the gold fill on its own is a colour with no legend. The
  label's visibility AND its string are read straight off the Text object in `snapshot()`, never from a
  cached flag — an empty label is visible and unreadable.
  **`ready` and `showMax` are deliberately different, and conflating them re-created the bug.** `ready`
  is the sim's number (it defers to `meterFull()` in `sim/fighter.ts`, so there is ONE spelling of the
  comparison); `showMax = ready && fillFrac >= 1` is the drawing instruction. They diverge because
  `Fighter.meter` survives `reset()` while the entrance scales the drawn bar from zero, so a fighter
  carrying a full bar into round 2 is ready with `fillFrac` at exactly 0 for 18 ticks — keying the cue
  off `ready` put **`MAX` over a visibly empty meter** for ~300 ms at the top of every later round.
  Any HUD cue for a sim value has this shape: gate it on what is DRAWN, not only on what is true.
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

The defect class this project keeps re-shipping: **a test that compares code to other code cannot see
it.** Boxes vs sprite art, animation length vs move duration, an absolute stat compared across fighters
who do not share a scale. The worked cases — the measurement that found each, and the prompt change
that fixed the art — are in [`docs/lessons.md`](docs/lessons.md). The rules they distil:

- **A box is a claim about a sprite.** Measure the strike: difference each frame against frame 0 and
  take the y band of the furthest-forward moved pixels. Never eyeball it, and never trust the move's
  NAME (`crouchHeavy`'s prompt said "low sweeping attack" for two phases while he punched at chest
  height). `npm run audit:boxes` reports all 21 attack sheets and is a HARD gate (Phase 19);
  `registry.test.ts` sweeps every special x defender x spacing for which stance turns damage into chip.
  **A threshold set to the worst observed value cannot fail** — `AIR_GAP_MAX` sat at exactly 60 while
  four shipped sheets sat on 60, so the REACH-GAP branch was unreachable and the whole roster connected
  through up to 60px of visible air. It is 30 now, with fixtures on BOTH sides of the boundary.
- **Any cross-fighter comparison of an ABSOLUTE stat is suspect** — `maxHealth`, `scale` and the
  pushboxes all differ per fighter. Compare shares (R-13) and effective reach (see Balance); a test
  written from one fighter's numbers cannot see the asymmetry.
- **A test built on `config.ts`'s `TEST_DUMMY` cannot see a defect that lives in the SHIPPED registry.**
  Same class, different axis: the fixture is hand-authored and does not move when
  `public/configs/character-gym.json` does. Phase 19 trimmed all 21 attack widths and `cpu.test.ts` —
  which builds from the fixture — stayed green through a CPU that dealt ZERO damage for a whole round on
  one of the three real fighters. `probe/koprobe.test.ts` has the same blind spot by construction. When
  a change edits the registry, at least one test must READ the registry.
- **An animation is a claim about a move.** Measure its LENGTH (`fps` is DERIVED in
  `src/render/anim-timing.ts`, never authored), its PHASE (contact frame vs active window, measured by
  `check:sync`; budget the wind-up `startup - 1` ticks for `PLAY_LAG_TICKS`), and whether the wind-up
  gets enough ticks to be SEEN — the only honest lever there is drawing FEWER poses
  (`attackStartFrame`/`stunStartFrame`).
- **Every one of those metrics is VERTICAL and direction-blind.** A big vertical swing scores exactly
  as well as the forward one that actually crosses the gap — so does a body lying flat on its back.
  Name the TARGET in the prompt, and check the VISIBLE gap at max connect range, not the raw overshoot.
- **When you fix a defect class, sweep the WHOLE class.** The attack-timing derivation skipped the
  other 15 sheets for two phases, and a fighter stood bolt upright through his entire knockdown.
- **Measuring a guard from behind the guard tells you nothing** (Phase 20). `play()`'s cache check
  would not go red, so it was deleted as unfalsifiable insurance — correct instinct, wrong conclusion.
  Every probe had run with the `try/catch` still in place, swallowing the exception Phaser actually
  throws (`Audio key "x" not found in cache`). Remove the OTHER guard too before concluding one is
  redundant. Same shape as an instrument that saturates: `s16le` decoding reports a +2 dBFS master as
  0.0, so a normaliser calibrated through it under-corrects by exactly the amount it is over.
- **Whenever a metric cannot fail, it is decoration** — check what would turn it red before trusting
  it. The audit's own length column was 1.00 by construction: code checked against code, inside the
  tool built to stop exactly that.
- **A held state must not loop if any frame leaves the pose**; `blockCrouch` loops precisely because
  every frame stays in the low guard. Do not reintroduce a bob — a LOOP of near-identical held frames
  already is a steady guard.
- **Art: the REFERENCE is the lever, not the wording**, and prefer the prompt that MEASURED best over
  the one that reads best. `--start-image` dominates, so a bad reference cannot be argued out of the
  model; measure a new reference against the one it replaces before spending a video credit. The model
  lands a strike HIGHER than you ask — name the joint one lower. The forgotten prompt variable is the
  SAMPLING RATE: ask for a HOLD at full extension, or name the cycle COUNT. Change ONE clause at a time
  and measure — run-to-run variance is real (five samples of one sheet: sd ~ 4.6px), so a single better
  sample is not a better prompt. Detail in [`docs/art-pipeline.md`](docs/art-pipeline.md).

### Balance

**Compare fighters by EFFECTIVE reach (`hit.x + hit.w − own pushbox half`), never by raw hit-box reach.**
The monk's art is a wide low stance, so his pushboxes are bigger (`pushStand 60` / `pushCrouch 76` vs
56 / 60), which parks him further from the opponent and lands the same nominal hit box short — he played
as if his moves "didn't reach" even though they executed and connected. A wide-bodied character needs
correspondingly longer hit boxes just to break even. `reach-parity.test.ts` pins it. Only `w` was
changed — **`y`/`h` decide high/low, so never touch them for a reach tweak**.

**A roster-wide reach change must be a UNIFORM DELTA PER ATTACK, never a per-fighter target** (Phase
19, when all 21 boxes were trimmed to a 30px visible-air budget). Trimming each fighter to the same
`air` sets `far = limb + 44`, which makes effective reach `limb + 44 − pushHalf` — i.e. it erases the
monk's pushbox compensation by construction and reds `reach-parity.test.ts` (jiujitsu light 90 vs monk
85). Subtracting the SAME delta from all three moves every far edge equally, so the ordering and every
pairwise difference survive untouched and the parity test is green by arithmetic rather than by luck.

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
  **The same rule applies to a test you wrote five minutes ago, in good faith, that is not a
  regression test at all.** A unit test tallying `makeRoll` over wall-clock-spaced seeds looked like
  real coverage of the CPU pick; removing the Knuth mix, removing the 4-draw warm-up, and swapping in a
  deliberately striping LCG all left it green, because large seeds decorrelate on their own. It was
  deleted, and the measurement it was standing in for was written into the phase log instead. Before
  keeping a test, mutate the thing it claims to guard and watch it go red — if nothing you can plausibly
  break turns it red, it is decoration no matter how good the assertion reads.
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
(reports the page hidden → `HIDDEN` → `loop.pause()`). So a spec: (1) `window.__game.loop.stop()` then
pumps `window.__game.step(t, 1000/60)` as the sole clock; (2) drives P1 input via the DEV
`window.__holdP1(Partial<InputSnapshot>)` seam; (3) pumps past the intro phase (`INTRO_TICKS=90`), which
gates input, before expecting movement.

**Correction (2026-07-28): "trusted keyboard events don't reach Phaser headless" is FALSE for the match
scene**, and this file and a spec header both asserted it for several phases. `page.keyboard.down("e")`
fires the super end to end — measured. The `__holdP1` seam is still the right default (it expresses a
one-frame edge in one frame, and reaches states a key cannot), but it injects *after* `InputReader`, so
a spec using it proves the latch→sim plumbing and **not** the binding table. `special-per-fighter.spec.ts`
presses the physical `E` for exactly that reason. Two rules survive unchanged: the seam FORCES the
pressed flag true every frame, so holding it two pumped frames double-fires; and a key press still needs
pumped frames around it to be seen.

**All of that lives in `e2e/harness.ts` now** (Phase 16) — `ready` / `pump` / `keys` / `press` /
`pumpUntil` / `waitForMatch` / `toFlow` / `driveTo1v1`, imported by every driving spec. It used to be
twelve hand-copied sets, i.e. twelve places for the rules above to drift. Two live bugs were found
purely by merging them, both below. **`ready(page, {route, needs})` is parameterised by the DEV globals
the spec actually drives** — each scene publishes a different set at a different point in `create()`,
so waiting on the wrong one means driving a half-built scene; each spec keeps a one-line wrapper under
its old name so call sites are untouched.

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
  pump in a bounded loop until the expected global appears, never "one more frame". Corollary worth
  saying out loud, because a spec header got it backwards for four phases: the lock-in flash is a
  TWEEN and does **not** advance under the pump at all. What carries FlowScene to the match is
  `time.delayedCall`. A comment can describe a mechanism that does not exist and nothing goes red.
- **A "wait until X appears" loop must check BEFORE it steps, and must not step in chunks.** The
  original waited in 20-frame blocks, so it routinely overshot by ~20 ticks. Invisible until a spec
  measures something the overshoot already consumed — it made a test counting `INTRO_TICKS` read 70.
  `pumpUntil` now checks first and runs the whole loop inside ONE `page.evaluate`: minimum frames,
  one round trip. **An assertion on an absolute tick count is measuring the harness as much as the
  sim** — prefer checking the count against what the sim says is left (`match.introTicks`).
- **A spec that writes `public/configs/character-gym.json` is using live ammunition.** `withRegistryLock`
  serialises WRITERS only; the readers booting matches on the other three workers are unsynchronised,
  so the write must be atomic (temp + rename) or a concurrent boot can read a truncated file. But
  `renameSync` throws EPERM on Windows when another process holds the file open — and when that
  happened inside a `finally`, the restore never ran and the REAL registry shipped a 21-damage monk
  into every later spec. Four unrelated cases failed; only `git checkout` recovered it. So the restore
  retries and falls back to an in-place write: **a torn read by one worker is a bad day, a permanently
  mutated registry is a corrupted repo.** Mutate the MONK only (no other spec asserts his numbers), and
  prefer a change whose direction cannot break a reader — raising `walkSpeed` can only help a
  "moved at least N" assertion.
- **A worker-scoped shared page was tried for boot cost and REVERTED — don't re-buy it.** On paper it
  removes nearly every `page.goto`, which is the dominant cost (a case measured 4s alone against 114s
  in the full suite; that 28x is contention, not work). In practice giving up per-test isolation
  produced the corrupted registry above, an intro assertion that silently began measuring the harness,
  and a case that went from 4s to a 180s timeout. What survives is the cheap half: a SECOND scene entry
  inside one case uses `toFlow`/`scene.start` rather than a reload (`cpu-difficulty.spec.ts` has done
  this since Phase 11). Boot cost is not reducible from inside a spec file; budget for it instead —
  `test.setTimeout` is a BOOT allowance, the same kind as the 30s inside `ready`.
- **A touch spec needs a FULL device profile, not `hasTouch: true`.** `e2e/mobile-touch.spec.ts` uses
  `devices["Pixel 5 landscape"]` minus `defaultBrowserType` (which cannot be set inside a `describe` —
  it forces a new worker). A bare `hasTouch` flag on a desktop context leaves `any-pointer: fine` TRUE,
  so the whole phase switches itself off and every case passes for the wrong reason; the first case in
  that file asserts the classification itself for exactly that reason. Real touch events go through
  `page.touchscreen.tap` or CDP `Input.dispatchTouchEvent` — **never `__holdP1`**, which injects after
  `InputReader` and would prove nothing about the touch wiring.
- **Two things make a touch spec silently vacuous**, both found by mutation testing here:
  (1) `setInteractive()` defers insertion into the input list until the next scene pre-update
  (`InputPlugin.js:487`), so pump a frame after creating a tap target before tapping it; and
  (2) **`scale.canvasBounds` is refreshed by a 500 ms POLL** — tap the centre of the *canvas* computed
  after that poll, never the centre of the viewport. A stale-bounds tap transformed to game y ≈ −334,
  hit nothing, and passed a spec whose feature had been deleted. Derive a tap target from
  `getBounds()`, not from `x`/`y`, which are anchored by the object's ORIGIN.

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
