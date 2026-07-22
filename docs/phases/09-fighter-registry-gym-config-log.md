# Phase 09 — Fighter Registry, Character Gym & JSON Config — Gate Log

**Status: PASSED — 2026-07-18.** Next: Phase 10.

## What shipped

### Data-driven fighters (the core deliverable)
- `public/configs/character-gym.json` — three distinct fighters (`brawler`/`jiujitsu`/`monk`), each
  `{ render, data }`. `render` is loader-only (per-state sheet path/frames/fps/loop, 320×256,
  anchor). `data` is compact sim config: stats, box constants, attack windows, non-attack frame
  counts, and `overrides[state]=[{frame,hurt?,push?,hit?}]`.
- `src/sim/character-builder.ts` (pure) — `assembleCharacter(id, data)` rebuilds the full
  `CharacterConfig` (frame builders moved here; clones per frame → no aliasing between fighters or
  frames).
- `src/sim/validate-character.ts` (pure) — ONE shared validator (`validateFighterEntry`/
  `validateRegistry`, `STATE_NAMES`), used by BootScene AND the Gym write-back so they can't drift.
- `src/sim/config.ts` — now assembles `FIGHTER_A`/`FIGHTER_B` from one shared `TEST_DUMMY` (removes
  the A==B duplication; existing sim tests stayed byte-green).
- Sim purity preserved: `src/sim/` imports no Phaser and does no I/O; JSON is parsed at the render
  edge and injected via `new World(cfgA, cfgB)`. `tsconfig` gained `resolveJsonModule`.

### State→animation switching (both fighters)
- `src/render/characters.ts` — `loadRegistry` (validate + fail-fast), `buildConfig`, `eachSheet`,
  `textureKey`.
- `src/render/fighter-sprite.ts` — `FighterSprite`: idempotent per-state anims, play-on-state-change,
  **pauses playback during hitstop**, `showFrame` maps sim frame → visual frame for the Gym.
- `src/scenes/BootScene.ts` — two-phase preload: load JSON in `preload`, validate + queue every sheet
  in `create`, `this.load.start()`, and on `COMPLETE` refuse to route if `failed>0` OR any expected
  texture is missing (blocks both 404s and corrupt-200s).
- `src/scenes/MatchScene.ts` — drives BOTH fighters as `FighterSprite`s (default matchup brawler vs
  jiujitsu; guards against a missing matchup fighter). Fighter-B box path removed.

### Character Gym (optional tooling — built)
- `src/scenes/GymScene.ts` (`?scene=gym`, DEV-only) — a real `Fighter` drives the box overlay;
  `Q` translate / `W` scale gizmos, `Tab` cycles the box, `[`/`]` steps the frame; edits persist as
  per-frame overrides. DOM sidebar built in-scene (prod never has `#gym-panel`).
- `vite/gym-save-plugin.ts` — `configureServer` middleware `POST /__gym/save`: **dev-server only**,
  same-origin + Origin check, 256 KB limit, shared validator, atomic temp-file + rename write.

### Art — real animated sprites
- Every fighter has real per-state sprites in `public/sprites/<id>/<state>.png` (12 states).
- Pipeline: **Seedance 2.0 image-to-video** per state (from the locked Phase 05 reference) →
  `ffmpeg` frame sampling → `scripts/build-sprites.py` (sampled-border chroma key + despill + erode,
  single per-fighter scale to `HURT_STAND.h=185`px, feet-anchor, 320×256 packing) →
  `scripts/check-sprites.py` gate. Video was chosen because independent still-image gens drift
  (outfit vanishes, hair recolors, knockdown/ko hallucinate a second figure); video is temporally
  consistent by construction and fixed all of it. `scripts/gen-sprite-videos.sh` is the driver;
  `scripts/gen-placeholder-sheet.mjs` now emits all 12×3 placeholder states.

## Acceptance criteria
- [x] Three distinct fighters load from JSON (no A/B duplication) — distinct stats + signature boxes.
- [x] Editing a box in JSON changes live combat — proven by `registry.test.ts` (moving a hurt box
      turns a hit into a whiff).
- [x] Attack active-frame windows authored per attack; `combat.test.ts` still green.
- [x] Sim remains Phaser-free (config injected, not fetched inside `sim/`).

## Verification
- `npm run typecheck` clean · `npm test` **49 pass** · `npm run test:e2e` **9 pass**
  (`e2e/phase09-characters.spec.ts` replaced the Phase-02 sprite spec; `stage.spec.ts` updated to
  `__sprites`) · `npm run build` OK · `python scripts/check-sprites.py` OK (self-tests + all sheets,
  incl. NO-PURPLE gate) · `python scripts/build-sprites.py --selftest` OK.
- Character Gym `/__gym/save` endpoint verified: 200/400/422/405/415/403 for
  valid/bad-JSON/validation-fail/GET/wrong-type/cross-origin.

## Reviews
- Codex reviewed the **plan** (4 blockers fixed: schema `entry.data`, BootScene `load.start()` +
  COMPLETE gate, Gym sim→visual frame map, e2e breakage + box-move proof) and the **implementation**
  (5 bugs fixed: corrupt-sheet gate bypass, roster-missing-fighter crash, fractional/negative
  validator gaps, same-origin fail-open).

## Known simplifications (deferred)
- Held/one-shot states (crouch, jumpRise, knockdown, ko) start from the standing idle, so their
  first 1–2 frames are upright before the action begins — tunable later with a state-specific start
  frame per state.
- Per-frame **guard** boxes are authored/validated but the sim overlays guard globally (per-frame
  guard consumption deferred). `ponytail:` noted in `character-builder.ts`.
- Preview GIFs for review live in `concepts/characters/preview/<id>/`.
