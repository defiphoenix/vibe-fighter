# Phase 00 — Baseline Log (gate result)

Evidence that the Phase 00 gate passed. Recorded 2026-07-15 against the untouched starter
(no `src/**` changes). This is the "verified baseline" the phase file asks for — see
[00-source-research-and-baseline.md](00-source-research-and-baseline.md).

## Acceptance criteria

### 1. README parity items labelled — VERIFIED (already present)
[traceability.md](../traceability.md) lines 33–48: every parity row already carries a
current-state label (Present / Missing / Extend-style). No orphaned items. No edit needed.

### 2. `npm test` green on untouched starter — PASS
```
> vitest run  (v2.1.9)
 ✓ src/sim/regression.test.ts (4 tests)
 ✓ src/sim/combat.test.ts    (11 tests)
 Test Files  2 passed (2)
      Tests  15 passed (15)
```
Recorded before any phase touches `src/`. This is the green baseline.

### 3. Video Setup Steps 1–2 — CAPTURED
Watched `en37mtF42eQ` (title: *"Vibe Coding an Entire Street Fighter Game With AI (Cursor,
Codex, Opus 4.8)"*, 19:09) via the `watch` skill — native captions + frames over 0:00–4:30.
The 15 chapters match the docs exactly (Step 1 @ 02:40, Step 2 @ 03:16; full list below).
Full captions preserved for provenance at [00-walkthrough-captions.en.vtt](00-walkthrough-captions.en.vtt)
(yt-dlp native `en` subs); all quotes below are drawn from it.

**Step 1 — "Context" (02:40–03:16).** The creator starts from *"my basic Phaser template
project that I always use"* — a reused starter, not a fresh build — and prompts the model to
*"consider the architecture for a fighting game… think about the things you'll need for
animation, gameplay logic, and collisions."* Key framing: *"a game is going to be very
animation heavy"* (many attack states + UI). This confirms the guide's "reuse the per-frame
box starter, don't rewrite" stance and matches PDF recipe step 3 (`prompts.txt:5-24`).
- **Honesty note:** the video says **"template" + "animation / gameplay logic / collisions"**,
  not literally *"per-frame box engine."* That phrasing in the phase file is the guide author's
  gloss — accurate in substance (the starter's per-frame box system is the reused core), but
  the video never uses those exact words. No unverified claim carried forward.

**Step 2 — "Generating concept art and mockups" (03:16–04:01).** After confirming a fighting
game, the creator generates concept art with the imagegen skill: *"not too complex… recognise
this is a technical demonstration… four different versions."* The four mockups shown: a **dojo**,
a **subway**, a **warehouse by the docks**, and a **rooftop brawler** (rooftop w/ city skyline).
He chose the **rooftop-dusk** direction (posted to X for a vote). The on-screen cheat-sheet frame
states the rule the guide encodes: *"the mockup is the authority for every later asset."* Matches
PDF recipe step 4 (`prompts.txt:26-37`) / Phase 03.

## Gaps found beyond the acceptance list (both closed)

### A. `prompts.txt` generated from `prompts.pdf`
Extracted with `pdftotext -layout` → `prompts.txt` (193 content lines, CRLF, plus a trailing
form-feed). **All 13 phase line-refs validated** — every `prompts.txt:NN-MM` range lands exactly
on its recipe step header/end:

| Phase | Ref | Lands on |
|-------|-----|----------|
| 01 | 5-24 | step 3 Architect |
| 03 | 26-37 | step 4 Concept mockups |
| 04 | 39-49 | step 5 Parallax |
| 05 | 50-65 | step 6 Character refs |
| 06 | 67-74 | step 7 Portraits |
| 07 | 76-86 | step 8 UI/prop atlases |
| 09 | 87-100 | step 9 Register/hitboxes |
| 10 | 102-120 | step 10 Playground |
| 11 | 121-137 | step 11 Menus/versus |
| 12 | 139-154 | step 12 Core combat |
| 13 | 156-165 | step 13 Guard boxes |
| 14 | 166-176 | step 14 HUD |
| 15 | 178-191 | step 15 Specials |

Zero drift. (Cosmetic only: the source PDF's arrow separator in step headers extracts as a single
`0xB7` byte, e.g. `prompts.txt:5` `Cursor · build` — no effect on content or line numbers.)
**Count:** **13 of 17** phase files cite `prompts.txt` *line-ranges* (the table above); Phase 00
also references the file by name without a line-range (`00-source-research-and-baseline.md:7`), so
**14 of 17 reference it in total**. The earlier "14 of 17" in PRD/plan meant the line-range citers,
which is 13 — that is the number corrected here.

### B. Stale claim in the phase spec — FIXED
[00-source-research-and-baseline.md](00-source-research-and-baseline.md) previously said the
transcript pull was "already done". No transcript existed in the repo at session start — it was
captured here. The spec's task line now points to the saved captions; its editorial "per-frame
box engine" line is now marked as a gloss, not a video quote (both corrected this session). The
15-chapter count was correct.

## Delta claims — VERIFIED against the sim (codex-reviewed + spot-checked)
All four "verified against the sim" bullets in [PRD.md](../PRD.md) lines 55–62 hold:
- **Guard is character-level, not per-frame.** `FrameBoxes` has only hurt/push/hit
  (`src/sim/types.ts:12-17`); guard arrays live on `CharacterConfig` selected by stance
  (`src/sim/types.ts:60-68`, `src/sim/fighter.ts:217-224`); block resolved by guard-box overlap
  (`src/sim/combat.ts:72-82`). → Phase 13 is **migrate/extend**, not "validate".
- **Single-connect dedup.** `hasHit` resets on a new attack (`src/sim/fighter.ts:34-35,108-112`) and on
  fighter reset (`src/sim/fighter.ts:55`); combat skips a set attacker + sets on first connect
  (`src/sim/combat.ts:48-53,88-95`). → multi-hit **missing** (Phase 15).
- **Fixed single screen.** Stage hardcoded 1280×720 (`src/sim/constants.ts:8-12`). → camera/scroll **missing** (Phase 08).
- **Duplicate fighters.** `FIGHTER_A`/`FIGHTER_B` share one `buildCharacter`, differ only by id
  (`src/sim/config.ts:48-103`). → JSON config + distinct fighters **missing** (Phase 09).

## Video chapters (15)
```
00:00 Vibe Fighter Intro          09:19 Step 6: Build a Character Gym
01:08 This Video's Resources      11:59 Step 7: Build a Playground
01:53 What we're building         14:02 Step 8: Generating menu portraits
02:40 Step 1: Context             14:55 Step 9: Core combat loop
03:16 Step 2: Concept art/mockups 15:23 Step 10: Generating UI & Health Bars
04:01 Step 3: Extracting bkgds    16:53 Step 11: Special Moves and Polish
05:09 Step 4: Character references 18:09 Wrap Up
06:13 Step 5: Character Sprites & Animations
```

## Gate status: PASSED
Starter confirmed green + baseline docs confirmed accurate. Proceed to
[Phase 01 — Architecture & delta plan](01-architecture-and-delta-plan.md).
