# Phase 07 — UI + Prop Atlases Log (gate result)

**Recorded** 2026-07-17. Phase tag `[art]`, and the first art phase whose deliverable lands in
**`public/`** — the shipped bundle — rather than stopping at `concepts/`.

Deliverables live in `public/ui/`, `public/props/` (runtime) and `concepts/{ui,props}/2026-07-17/`
(authoring masters). This log certifies the three acceptance criteria at
[`07-ui-prop-atlases.md:38-46`](07-ui-prop-atlases.md).

New files outside `concepts/`: `scripts/art_gate.py`, `scripts/build-atlases.py`,
`e2e/atlas.spec.ts`, `public/ui/hud-atlas.{png,json}`, `public/props/twilight-atlas.{png,json}`.
Modified: `scripts/check-characters.py`, `scripts/check-portraits.py` (both now import from
`art_gate`), `package.json`, `public/configs/sprite-schema.md`, `docs/asset-manifest.md`, `CLAUDE.md`.
**No `src/**` changed** — the green baseline holds by construction; typecheck and tests were run
anyway to prove it.

## What differed from the recipe

| Recipe says | What actually happened |
|---|---|
| `$imagegen` generates the atlases | Codex has no image subcommand. **Higgsfield CLI**, `nano_banana_pro`, as with Phases 03–06. |
| One "UI atlas" and one "prop atlas" prompt | **18 prompts**: the bar and the base need different aspects (`21:9` vs `3:4`), and each prop needs one prompt per animation frame. A single gen cannot lay out a grid — see below. |
| Magenta chroma for the transparent areas | Held, with one correction the spec could not have known: **the fill slot must be *enclosed*.** The slot and the void are the same magenta, so a channel open at either end merges with the outside void and stops being a slot at all. |
| — | The spec's "atlas JSON" had no schema anywhere. Written now in [`sprite-schema.md`](../../public/configs/sprite-schema.md), which was titled "Sprite / **Atlas** Schema" while defining no atlas format. |

## Acceptance criteria

### 1. "Health bar has a clean transparent fill slot after chroma keying (dynamic fill can be composited)." — PASS

`health-bar` keys to one enclosed transparent region and **zero** stray candidates. Packed at
**460×144** with the slot at **(40, 41) 380×62**. `e2e/atlas.spec.ts` proves the slot rect lies inside
the bar rect, which is what makes it composite-able: Phase 14 draws the fill *behind* the art so it
shows through the slot while the bevel stays on top.

Only the **460** is fixed (`hud.ts:5` `BAR_W`); the height is whatever the art drew. The prompt asked
for "about eight times as wide as it is tall" and got **3.19:1** — not argued with, because the gate
proves it fits (below).

### 2. "Portrait base accepts a Phase 06 portrait without seams." — PASS

Verified by composite, not by assertion: `concepts/ui/2026-07-17/_preview.png` seats **all three**
Phase 06 masters in the real slot. No seam at the chest, none at the perimeter.

The window measures **1076×1650 = 0.6521:1** — the model missed the 3:4 it was asked for, and it did
not matter, because the slot is measured rather than requested. Slot packs to **300×460**; a
bottom-anchored cover-crop of the 1792×2400 bust into it trims **12.66% off the width** (the sides)
and **0% off the height**, so the bust's bleed edge survives intact. Window rect is **99.90%**
actually window, so a portrait cannot cover the painted border.

### 3. "Prop atlas frames key out cleanly and can animate." — PASS

16 frames, `<prop>-0..3`, packed **1536×1290**. `e2e/atlas.spec.ts` builds a real Phaser animation
from `generateFrameNames` and pumps the game clock: 4 frames resolve and more than one distinct frame
is shown, so "can animate" is executed rather than asserted. Every frame's rect is proven inside the
sheet.

## Visual checklist — the primary instrument for everything below

No honest metric exists for any of these. `_preview.png` in each concepts dir is what the call was
made on.

| check | verdict |
|---|---|
| bar reads as a health bar (bevel, rivets, sunk channel) | ✅ |
| all 3 portraits seat with no seam, top/sides/bottom | ✅ (the black-band defect below was found here) |
| plate border survives with a portrait seated | ✅ |
| crowd: 4 frames read as the same nine people | ✅ |
| vents: turbine visibly rotates, housing does not move | ✅ |
| beacon: dark → ember → blaze → fading reads as one lamp | ✅ |
| steam: stub → column → cap → torn blobs reads as one plume | ✅ |
| 4 props read as one set (palette, rim light, cel style) | ✅ |
| props sit at plausible scale against `rooftop-dusk/main.png` | ✅ |
| no text, letters, numbers, logos anywhere | ✅ |
| props' perspective matches the stage | ✅ — see "measured against the locked art" below |

## Rejections and credit spend

**25 gens ≈ 50 credits** — the largest art spend of the project (Phase 06 was 3 gens / 6 credits), and
exactly the ceiling the plan set. 19 first pass + 6 regens.

| # | subject | defect | outcome |
|---|---|---|---|
| 1 | `portrait-base` (job `d4fc6aa0`) | ran at aspect **1:1** instead of `3:4` — the flags never arrived | **wasted**; tooling bug, see below |
| 2 | `beacon-2` | halo ran off the canvas: **906 px — 44% of the width — on the top row** | regenerated |
| 3 | `beacon-3` | glow **1.725% pink**, surviving the key | regenerated |
| 4–6 | `steam-0..3` | `steam-1` clipped (438 px on the top row); plume translucent over the void | regenerated as one opaque set |

Everything else was kept first try: `health-bar`, `portrait-base`, all of `crowd`, all of `vents`,
`beacon-0/1`.

## The findings no metric would have caught

**1. The portrait slot had a black band above every head, and the gate was green.**
The first design computed "the largest 0.7467:1 rect flush with the window's bottom" so the bust would
seat undistorted. It passed every check — 99.97% inside, bottom-flush, correct aspect. The 3-up
composite showed a transparent band across the top of all three windows: the model drew the window
**taller** (0.6521) than the art (0.7467), so an aspect-preserving rect left ~209px of window
unfilled. **The rule did not remove the seam, it moved it from the chest to the forehead.** Fixed by
making the slot *the whole window* and having the consumer cover-crop into it, bottom-anchored — which
is what a real select screen does. Distortion is impossible (the crop preserves aspect) and the cost
is a measured 12.66% trimmed off the sides.
This is the phase's clearest vindication of the repo's rule that a visual checklist is load-bearing:
a green gate on a defect that is obvious the instant you look.

**2. The vent's perspective looked wrong and was right.** The shared block asks for an eye-level
camera; the model drew the vent from above. Rather than spend a credit "fixing" it, it was checked
against the locked stage: `rooftop-dusk/main.png` draws its roof deck as a receding plane seen from
slightly above, so the vent **matches**. Not a defect. *(Measure against the real art, not against
your recollection of what you asked for.)*

## Reusable lessons

- **Never ask for translucency over a chroma void.** This cost 12 credits. The steam and beacon heads
  asked for a "soft translucent cloud" and a "wide soft halo" — while the shared STYLE block those
  same prompts carry says "flat blocks of colour, hard cel edges, no airbrush gradient". CLAUDE.md
  already says the model resolves a self-contradiction by **maximising**, and it did: glows so large
  they ran off the canvas, dragging the void's colour into the art. It is also the one thing a chroma
  key physically cannot do — a translucent pixel over magenta is indistinguishable from the void. The
  fix ("opaque, solid colour, hard cel edges") is what the style block wanted all along.
- **A palette list does not forbid a colour; naming it does.** The block listed the allowed dusk ramp
  and `beacon-3` still came back with a glow that is 1.725% pink *and survives the key* (beyond
  `KEY_HI`, so real art, not a keying artifact). Same shape as Phase 05's flag patch. The heads now
  say "never pink, never magenta, never purple".
- **Do not ask the model to hit a number — measure what it drew.** Neither slot was requested at a
  size. The proof it was right: the window came back at 0.6521 against a 0.7467 request and cost zero
  retries. Contrast Phase 04, which spent ~7px per credit arguing about a band.
- **Design the animation around what the model can actually do.** `vents` is a **3-blade** turbine on
  purpose: 3 blades give 120° symmetry, so four frames at 30° steps are all distinct and frame 3 → 0
  is seamless. A 4-blade turbine has 90° symmetry — the fourth frame would duplicate the first, one
  credit for nothing.
- **Chaining every frame from frame 0 (never from its predecessor) holds position.** Measured:
  `vents` moves `d_bbox (0,0,0,0)` and **<1px** of centroid across all four frames — only the blades
  turn. All four props keep their bottom edge within 3px. But this is not free registration (the API
  JPEG-ises and resizes every `--image`), which is why the numbers are **reported and never enforced**.
- **`RGBA` is a lie, again.** `portrait-base-raw.png` came back RGBA and `health-bar-raw.png` RGB from
  identical params, both with alpha 255 everywhere. Third phase to hit this.

## Metric bugs, caught and fixed

Both were found by the fixtures or by a real asset **before** they could pass bad art:

1. **`alpha_bbox` over `a > 0` returned the whole canvas.** The first real gen keys to 13 connected
   components: the bar (1,629,510 px) and **twelve specks totalling 60 px** of dither noise at the
   right edge. Twelve stray pixels decided the crop. This is Phase 05's speck bug
   (`check-characters.py:104-110`) in a new place, and it takes Phase 05's answer: judge by **area**
   (components ≥256 px; the measured gap is four orders of magnitude wide and the 256–4095 bucket is
   empty) and report what was dropped. An alpha threshold was rejected — it recovers this bar's bbox
   but would crop the steam's wisps, whose real art *is* soft alpha.
2. **`HUD_BAND_MAX = 200` was invention.** It would have rejected the first, good bar on a number with
   no meaning. Replaced with the sim's own: a fighter's head is highest at a jump's **apex**. A second
   cut used the *continuous* `jumpVelocity²/(2·gravity)` = 155.8px → y=279 — and the Codex output
   review caught that the sim does not integrate with calculus. `fighter.ts:127-136` steps gravity
   discretely (semi-implicit Euler at DT=1/60), whose apex is **148.3px → y=286**, 7.4px lower, so the
   continuous number was too strict and could false-reject a valid HUD. The gate now runs the sim's
   own integrator (`_discrete_jump_apex`). The bar's HUD band ends at y=208, clearing the y=286 floor
   by 78px. *(The discrete loop is the clock, not the textbook.)*

Both new gates were **mutation-tested** — `art_gate.py` 6/6, `build-atlases.py` 8/8 — because a
passing suite proves nothing until you know it bites. Two fixtures were themselves wrong and were
fixed by the exercise (one tested `SLOT_H_FRAC` while claiming to test ambiguity).

## The `art_gate.py` extraction, and why "both gates green" is not the proof

`check-portraits.py:62-63` named the trigger in advance: *"if a third phase needs check_job, lift it
and the shared-block check into a scripts/art_gate.py — two callers is not yet three."* Phase 07 is
the third and forced the issue: it generates at four aspects, not `3:4`, and its fresh gens carry
**zero** `--image` references where 05/06 always carry exactly one.

A plan review made the point that mattered: `npm run check:characters` + `check:portraits` staying
green is **necessary but not sufficient** — both callers pass the old hardcoded `3:4`/`2k`, so an
argument that were ignored, swapped, or applied only to non-3:4 jobs would leave both green. So
`art_gate.py` carries fixtures for the **new** arguments: parity, positive, negative (each argument
is read), swap-detection, and the refs count. Both existing gates do still pass unchanged — the
extraction caught one real break (`check_job`'s `d` lost its default) at exactly the moment it should.

## What the gate does not cover

Stated plainly rather than left for a green tick to imply:

- **That a chained frame actually used frame 0.** The job record stores an opaque upload id, never a
  filename — `refs == 1` proves only that *some* reference was supplied. Inherited from Phase 05.
- **That a PNG is the bytes its adjacent job record served.** Unproven since Phase 06; matching
  `params.width/height` does not close it — a stale same-sized file passes.
- Whether the bar reads as a health bar, whether four frames animate as one motion, whether the props
  read as a set, the absence of text/logos, whether a portrait seats without a seam. All by eye; all
  in the checklist above.
- **The atlases are not wired into the game.** `BootScene` still loads only the Phase 02 placeholder.
  `e2e/atlas.spec.ts` drives the loader through the DEV `__game` hook to prove the files work; making
  them appear on screen is Phase 08 (props) and Phase 14 (HUD).

## Downstream consistency (what Phases 08 and 14 are handed)

**Phase 08 (props):** `public/props/twilight-atlas.{png,json}`, 16 frames, `<prop>-0..3`, loop
`0→1→2→3→0`. Anchor **bottom-center** (`setOrigin(0.5, 1)`). `beacon`'s mast runs off the bottom edge
**by design** — the cut is the roofline. Cells are per-prop, not uniform. Packed at ≤384px on the long
side, ~3× the ~90–140px they are drawn at; re-pack from the masters if that is wrong.

**Phase 14 (HUD):** `public/ui/hud-atlas.{png,json}`. **Read the bar's height from the frame — do not
hardcode 34.** The art made it 144, the pips move to y=186, and the gate proves the band clears a
jumping head. Draw the fill *behind* the bar so it shows through `health-bar-slot`; keep the existing
colour + blink logic (`hud.ts:31-34`). Slot rects are in atlas space — subtract the plate's origin.

**Phase 11 (select):** `portrait-slot` is 300×460 and the portrait **cover-crops into it,
bottom-anchored**. Do not letterbox: an aspect-preserving fit is what produced the black band.

**Noticed, not fixed:** the HUD is screen-space but reads `STAGE_WIDTH`, the *world* constant
(`hud.ts:20,23,48`). Harmless today (world == viewport == 1280); the day Phase 08 widens the world to
1696 the timer drifts off-centre and P2's bar leaves the screen. This gate deliberately measures
against the 1280 **viewport**. Recorded in `concepts/backgrounds/README.md:72-82` since Phase 04.

**Dependency escalation:** `build-atlases.py` needs **scipy** (`ndimage.label`), which
`check-characters.py:92-97` had pre-authorised for exactly this case. scipy was already ambient;
it is now required for `npm run build:atlases`. There is still no `requirements.txt` — a repo-level
gap, recorded in CLAUDE.md.

## Tooling gotchas this phase paid for

- **Do not drive the Higgsfield CLI from Python `subprocess`.** `higgsfield` on PATH is a `.cmd` shim,
  so subprocess routes it through `cmd.exe`, whose arg quoting mangles a multi-line `--prompt`: the
  flags never arrive and the job silently runs at the **default aspect (1:1)**. Cost one credit and a
  confusing job record. Use bash.
- **Write a job record only after the call succeeds.** Opening the `.job.json` for writing before the
  CLI ran truncated a good record the instant the CLI failed to launch. Recoverable — CLAUDE.md's
  `generate list --json` → `generate get <id>` worked exactly as documented, for free — but a
  provenance file should not need rescuing.
- **A Codex review of a plan file outside the workspace root hangs silently.** The plan lives in
  `~/.claude/plans/`; Codex's root is the repo. It sat 9 minutes with the log frozen mid-`Get-Content`
  and no error. Inline the plan text instead of passing its path.
- **`taskkill /PID` needs `MSYS_NO_PATHCONV=1` from the Bash tool** — Git Bash rewrote `/PID` to
  `C:/Program Files/Git/PID`, so the cancel silently failed. Same MSYS translation CLAUDE.md already
  documents for ctx7 library ids; it generalises to any Windows `/FLAG` argument.
- **`.git/` in this repo is an empty directory.** Every git command fails; there is no history. Noted,
  not acted on — no commit was requested.

## No-regression check

```
python scripts/art_gate.py                 -> OK (parity, positive, negative, swap, refs, dir, blocks)
python scripts/build-atlases.py --selftest -> 20 fixtures OK
npm run build:atlases                      -> both atlases written; byte-identical on rerun (idempotent)
npm run check:characters                   -> all 3 pass  (necessary, NOT sufficient -- see above)
npm run check:portraits                    -> all 3 pass  (same)
npm run typecheck                          -> clean
npm test                                   -> 26 passed (2 files)
npm run build                              -> built in 3.57s (public/ ships now)
npx playwright test                        -> 6 passed (4 atlas + the Phase 02 sprite regression)
```

## Gate status: PASSED

Proceed to [Phase 08](08-stage-runtime-and-preview.md), which is the first consumer of
`public/props/twilight-atlas.png`.
