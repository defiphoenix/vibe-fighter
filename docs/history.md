# Project history

What shipped, in order. Per-phase detail is in [`docs/phases/`](phases/) (`NN-*.md` spec +
`NN-*-log.md` gate results); this file is the connective narrative, plus the **passes** that happened
between phases and therefore have no phase log of their own.

`CLAUDE.md` deliberately does not carry this — it's history, not guidance.

## Phases

- **00 baseline** (2026-07-15) — repo verified, tests green, source video + `prompts.txt` captured.
- **01 architecture** (2026-07-16) — doc-only; [`docs/architecture.md`](architecture.md) established the
  pure-sim / render-adapter boundary that everything since follows.
- **02 asset pipeline** (2026-07-16) — placeholder sprite replaces the debug box; Playwright E2E harness
  born (the `__game.step` pump + `__holdP1` seam).
- **03 concept mockups** (2026-07-16) — four SNES-style mockups in `concepts/mockups/2026-07-16/`;
  **rooftop-dusk locked** as the art direction and the roster cut to **brawler / jiujitsu / monk** (the
  recipe's green boxer and subway stage were dropped). Those three ids are canonical all the way to
  `public/sprites/<id>/`.
- **04 parallax backgrounds** (2026-07-17) — 8 layers × 2 stages (twilight/sunset) at 21:9 in
  `concepts/backgrounds/`, chroma-keyed by `scripts/key-layers.py`.
- **05 character references** (2026-07-17) — the three fighters pulled out of the dense mockups into
  isolated refs in `concepts/characters/`.
- **06 select portraits** (2026-07-17) — 1792×2400 busts on a **baked** backdrop, so unlike every other
  art phase there is no void and nothing to key. That geometry is the contract Phases 07/11/14/15 build
  against. First zero-rejection art phase (6 credits).
- **07 UI + prop atlases** (2026-07-17) — `public/ui/hud-atlas.png` and `public/props/twilight-atlas.png`
  (16 animated prop frames) via `scripts/build-atlases.py`; the shared provenance gate extracted into
  `scripts/art_gate.py`.
- **08 scrolling stage** (2026-07-18) — a world wider than the viewport (`STAGE_WIDTH=1696` vs
  `VIEW_WIDTH=1280`), per-layer parallax, a midpoint follow-camera, animated props, two
  config-selectable variants in `public/configs/stages.json`, and the dev `StagePreviewScene`. Camera
  zoom was deferred to Phase 12.
- **09 fighter registry + Gym** (2026-07-18) — fighters became data-driven: three entries in
  `public/configs/character-gym.json` (each `{ render, data }`), the pure `assembleCharacter`, the shared
  `validate-character` gating both BootScene and the dev Gym write-back, and BOTH fighters animating from
  real per-state sprites. The Character Gym (`?scene=gym`) landed with it.
- **10 fighter playground** (2026-07-19) — dev-only `?scene=playground`: controllable fighter + inert
  dummy, live per-character stat tuning saved back to `character-gym.json`, the keyboard focus guard, and
  `stats.scale` finally wired to both art and boxes.
- **11 menus, modes, versus CPU** (2026-07-19) — the game boots into `FlowScene` (title → mode → stage →
  character select) handing `MatchScene` a `MatchConfig`; `1v1` or `1vCPU` at three difficulties; the
  pure seeded `CpuController`; portraits baked to `public/ui/portraits/`.
- **12 core combat + camera integration** (2026-07-22) — zoom-in-only group camera plus a second
  non-zooming camera for the HUD; z-order follows the most recent MOVER; attack animations phase-aligned
  to the sim's active window via a measured contact frame; selectable REMATCH / MAIN MENU at match end.
  Also raised `STAGE_MARGIN` 90→116 (a cornered KO was cropped) and un-clipped the control legend (it
  measured 1535px in a 1280 viewport).
- **13 guard box migration** (2026-07-23) — guard moved from two character-level arrays into
  `FrameBoxes` as a per-frame `guardStand`/`guardCrouch` pair; `CharacterConfig`'s copies are gone and
  `Fighter.guarding` is derived from the box data instead of a duplicated state list. Per-frame guard
  overrides — authored and stored since Phase 09 but consumed by nothing — are now honoured by the
  builder and validated. The Gym can edit guard boxes, which write the stance template. Deliberately
  **not** taken: block-high/low art, so the 16 states are unchanged. Shipped numbers untouched: every
  frame of a guardable state is seeded from the same template, which is what made it a no-op.
- **13b block animation art** (2026-07-24) — took the art Phase 13 skipped: two dedicated held-guard
  states `block` (high) and `blockCrouch` (low), with real Seedance clips for all three fighters
  (states 16→18). The FSM guard branch now plants a guarding fighter in these states, and the
  `GUARDABLE` set was *swapped* to `{block, blockCrouch, blockstun}` — idle/walk/crouch dropped out
  because a fighter is never guarding while in them (no shipped guard override rode those states, so
  nothing was lost). `block`/`blockCrouch` also joined `ACTIONABLE`, not for jab-out (the attack edge
  is read before the guard branch) but to keep `cpu.ts`'s reaction timer running through a guard
  episode. Held one-shots (`loop:false`) needed no new render code. The Phase-13 per-frame live-guard
  proof was rebuilt around `blockCrouch`'s deterministic clamped contact frame, since the looping
  2-slot `crouch` it used to rely on is no longer guardable. A follow-up pass then regenerated all six
  block sheets to open ALREADY braced (frame 0 = the held guard, started from each fighter's own guard
  frame), so re-entering guard after a blockstun no longer replays a raise-guard wind-up; brawler's
  blockCrouch drifted upward on regen and was pinned to a static crouched-guard hold.

- **14 HUD skin** (2026-07-25) — the Phase 07 UI atlas finally reaches the screen: `BootScene` had
  never loaded `hud-atlas` at all, and the HUD was still the vector rectangles from Phase 02. Now two
  `health-bar` plates with the coloured fill drawn *behind* them (so it shows through the art's own
  transparent slot), two `portrait-base` plates with each fighter's Phase 06 portrait cover-cropped
  into the arch, and a match-start entrance — the band slides down over 900 ms while the bars charge
  over 900 ms, 1.2 s total inside the 1.5 s intro, deliberately slow because "too rapid" was the
  source prompt's one complaint. The entrance is derived from `match.introTicks`
  (`render/hud-entrance.ts`, Phaser-free, unit-tested) rather than a tween, so it replays every round
  and on the rematch with zero render state. `hud.ts` authors only `BAR_SCALE`/`PORTRAIT_SCALE` and
  three offsets; the bar's height and its fill slot come off the atlas frames. Three rounds of playing
  it then reshaped the band: the bar is drawn **non-uniformly** (0.86 × 0.5 — its 40 px of bezel is
  frame art, not padding, so a thin-and-wide bar has no uniform-scale answer), the timer moved under
  the bars, and `copy-portraits.py` grew the **`--hud` bake** its Phase 06 docstring anticipated —
  the select card into a ~96×147 slot is a 4.7× bilinear squeeze with no mipmaps (Phaser only mipmaps
  power-of-two textures), which is what "the portraits look low res" measurably was. Deliberately
  **not** taken: art for the timer or the win pips (still text). Also corrected four stale documented
  figures (two in `asset-manifest.md`, two in the Phase 07 log) that described an abandoned first
  design, and put the preload atlases behind Boot's own missing-texture guard.

### Phase 15 — Specials, Meter & Multi-Hit Combos (2026-07-25)

The spec named its own blocker: `Fighter.hasHit` was one boolean that ended an attack's ability to
connect after the first hit, so a special could never land more than once. It is now **per hit
WINDOW**: the builder stamps a `hitId` on every hit-bearing frame, `Fighter.lastHitId` refuses a window
that already connected, and `AttackData.repeat = {count, gap}` lays the active window down `count`
times. A normal has one window and still lands exactly once — the original single-connect test is
unmodified and was the guard rail for the swap. On top of that: a meter earned by **playing well**
(landing a clean hit pays the attacker in full; a successful *block* pays the blocker half of what the
attack would have dealt him; being hit pays nothing) that carries between rounds and is spent whole on
a grounded-only special; a **super freeze** riding the existing
hitstop channel, folded in *after* the round-over check so a fighter KO'd on the tick they started a
special gets neither the freeze nor the flourish; and the Phase 06 select portrait sweeping in over it,
derived from the freeze countdown rather than a tween (`render/super-cutin.ts`, Phaser-free and unit
tested) and shared by MatchScene *and* the Playground, because the dummy is where you try the move. The
Playground gained **regen hp** and **fill meter** toggles, applied before `advance` — after is too late,
since health reaching 0 sets `ko` and ends the round inside that same advance.

Codex rejected the first plan with six findings. The one that would have shipped as a real bug: window
ids restart at 0 for every attack, so a normal that had just connected left a stale `lastHitId = 0` and
silently swallowed the special's first window. Fixed structurally — `startAttack(state)` is now the one
door into every attack state, since it is also the only place `lastHitId` is cleared — and verified by
deleting the reset and watching the pinning test drop from 5 hits to 4 while everything else stayed
green. Also caught: `toSpec()` copies fields explicitly, so `freeze` would have vanished without a
sound.

Then the game was played, and everything the tests could not see turned up at once. **The meter was
invisible** — positioned below the health bar's fill *slot* rather than below the *plate*, drawing
correctly every frame underneath an opaque bezel, with the browser test happily asserting a real
width. **The meter economy was wrong** as originally specced: crediting the defender for damage taken
meant a cornered player watched his own super charge as a consolation prize, so it now pays for landing
a hit or blocking one and nothing for being beaten up. **The Playground kept confiscating the bar** —
it must `world.restart()` after a KO, and that zeroes the meter, which made a super you have to farm
for effectively untestable. And **the jiujitsu's spinning floor sweep shipped as a HIGH**: a
chest-height hit box on top of a leg scything along the ground, so you blocked it by standing up. The
ground-heavy defect exactly, one phase after it was written down.

The art took **8 Seedance clips for 3 sheets (~98 credits)**, and every failure had a different cause:
a `set -u` lookup bug that aborted all three instantly; a prompt whose word "spinning" put the brawler
flat on his back; a monk prompt that named the *move* but never the arm travel; sampling that caught 6
of 8 frames mid-return; and finally **direction** — a perfectly-measuring uppercut that travelled
straight up beside his own ear and never crossed the gap to the opponent. Worth keeping: every metric
in the pipeline is direction-blind, and the motion gate passed the frame where the fighter was lying
down.

A follow-up pass closed the two things the phase left open. The meter got its own Phase 07 atlas
plate, which cost two packer fixes that were both artefacts of the gate having only ever seen one
bar: a slot-height floor set from a single sample rejected the meter for being the shallower plate it
was asked to be, and a vertical budget that summed PACKED heights failed art that in fact clears a
jumping head by 90px (the HUD draws both plates at half height). And `scripts/audit-boxes.py`
finally measures boxes against the sprites they describe -- hurt height against the figure, hit band
against the strike, differenced against frame 0 so a planted leg is not mistaken for a fist. It ships
ADVISORY because four shipped sheets flag: the monk's crouch normals punch at chest height while the
sim sweeps at the knee, and since crouch normals are defined as lows, that one is an art pass rather
than a number change.

## Passes between phases

### Gameplay resolution pass (2026-07-18)

Freed the fighters' feet; dropped the front `near` layer (the "residual purple" was measured to be real
dusk palette, 0 magenta spill); made block a **dedicated key** (P1 `Q` / P2 `/`, plant-on-block); added
**air + crouch attacks** (fighter states 12→16); generated real Seedance sprites for the new and
idle-derived states across all three fighters. The held/one-shot states (crouch, jumpRise, jumpFall,
knockdown, ko) got real per-state motion here — they no longer start from the standing idle. Codex
reviewed both the plan and the diff.

### Crouch/block fix pass (2026-07-19)

Three complaints, three unrelated root causes: crouch pop-up was a **looping** sheet whose first frames
are the standing wind-up (held states must not loop); block failed only at contact range because the
guard boxes were a thin forward slab; crouch attacks flaked because `EdgeLatch` buffered the edge but not
the stance (`downAtPress`).

### CPU difficulty + heavy hitbox pass (2026-07-20)

The CPU was unbeatable even on easy, so it gained a `reactionTicks` window and a `DAMAGE_SCALE` handicap.
The **ground heavy stopped being a low** once its boxes were measured against its own sprite — it is a
standing punch, not a sweep. `Esc` started working in every phase, with a mid-match confirm.

### Input-buffer / props / menu / off-screen pass (2026-07-21)

**Attacks were silently dropped** when pressed during your own move — the render latch cleared on any
fight tick, but `World.tick()` returns "a fight tick ran `think`", NOT "the edge was consumed"; fixed
with per-edge consumption tracking. The reported **"monk can't do moves" was the FOCUS GUARD, not the
monk** — picking a fighter from the Playground dropdown left the `<select>` focused so the keyboard
stayed disabled. **Off-screen fighters** fixed by a sim-side `MAX_SEPARATION=1040` cap (camera zoom was
rejected — the stage art is exactly viewport-height, so uniform zoom bands the top/bottom). Also: a DEV
Playground button on the FlowScene title, and the background props shrunk via a new `PropConfig.scale`.
Attack animation timing was derived from sim duration here, fixing "the light attack does nothing".

### Security pass (2026-07-22, `0713c76`)

`npm audit` 5→0 via vite 5.4.21→7.3.6 and vitest 2→4; `/__gym/save` now requires a full-origin match;
new `vercel.json` CSP. The 17% bundle shrink is Vite 7's raised browser target, not lost code.

### Animation audit pass (2026-07-23)

A roster-wide audit (`npm run audit:anim`) found the stun/jump timing bug — `knockdown` had 750ms of art
for a 300ms state, so **the fall never drew** and a fighter stood bolt upright through his entire
knockdown. The Phase 12 fix for *attacks* had never been swept across the other 15 sheets. Ten
barely-moving sheets were regenerated in the same pass; see the sampling-rate section of
[`docs/art-pipeline.md`](art-pipeline.md) for why they came out frozen.

### Block art + in-game polish pass (2026-07-25)

After Phase 13b shipped the block art, three issues showed up only in the running game (no test caught
them): (1) a guarding fighter turned **blue** — a leftover steady guard tint from before block had its
own pose; removed, the pose is the cue now. (2) **green key debris** floating around jiujitsu's
crouch-block — its generated background was noisy and left fragments the 0.5% speck floor kept;
`build-sprites` now keeps only the largest component for the always-connected guard states
(`SOLID_BLOB_STATES`). (3) crouch-block **looked frozen / like standing** — the real cause was
`blockCrouch` being `loop:false` (it played once and froze) compounded by regens that drifted up out of
the crouch. Fixed by making `blockCrouch` **loop** a contained crouch bob (every frame stays low, so
looping never pops up), with monk's real cyclic bob, a synthetic breathing bob for jiujitsu (the
generator would not give a contained crouch bounce), and brawler's subtle motion. The block-art work
cost ~168 credits across the initial gen and the polish regens.

### Animation / box defect pass (2026-07-26)

Four more defects found by PLAYING with 276 unit + 65 e2e tests green. Full write-up in
[`docs/phases/16-animation-box-defect-pass.md`](phases/16-animation-box-defect-pass.md).

The crouch-block fix above **overshot**: removing the bob to stop it reading as "jumping on the spot"
left monk at amp 0.05 and jiujitsu at 0.06 — frozen stills. Worse, the monk had no low guard at all
(IoU 0.95 against his own `crouch`), because the reference chosen to fix his height *was* the crouch
reference. A prompt rewrite naming the arm change changed literally nothing (0.95 → 0.95); building a
purpose-made low-guard reference fixed it in one gen. Then copying the jiujitsu motion sentence
verbatim took the monk from 0.029 to 0.150 — while every rewrite invented for his deep squat measured
worse. Five samples of `monk/crouchHeavy` measured 50/61/57/55/60px reach (sd ≈ 4.6), so run-to-run
variance was swamping the prompt changes; that sheet stays open at ~87px of air, but gained a
measurable contact frame for the first time. ~11 generations.

"All animations play too fast" turned out to be neither arithmetic nor the override — both traced
correct in the browser — but the frame BUDGET: three wind-up poses sharing three ticks, one refresh
each. Fixed by drawing fewer poses rather than flashing them all. Two genuine bugs surfaced alongside:
a combo's 2nd+ hit never restarted the hurt animation (the state name doesn't change, so `play()` was
never called), and a review's claim that `knockdown` loses a tick was re-derived and found **correct
but harmless** — the state also lasts exactly that long.

Every attack box was measured against its own art horizontally for the first time and **all 21
overshot**, by 28–106px. Five of the six over-tolerance sheets closed with `hit.w` trims that keep the
parity rule passing unchanged; the parity test itself was extended to the air normals, where the monk
had been quietly out-ranged (80 vs 82) for its whole life. Three gaps in the audit tooling were closed
too — including an `art/sim` ratio that was 1.00 **by construction** and could never fail.

## Deployment history

The repo went live and **private** at `roiizchak/vibe-fighter` on 2026-07-22, wired to Vercel by git
integration. That **lifted the old "never push" rule**. Before that date `.git/` was an empty directory
and every `git` command failed — notes older than 2026-07-22 saying "there is no VCS safety net" are
stale.
