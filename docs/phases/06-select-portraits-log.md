# Phase 06 — Select Portraits Log (gate result)

Evidence that Phase 06 passed. Recorded **2026-07-17**. Phase tag `[art]`. Deliverables live in
[`concepts/portraits/2026-07-17/`](../../concepts/portraits/2026-07-17/); this log certifies the two
acceptance criteria at [`06-select-portraits.md:33-35`](06-select-portraits.md).

Three upper-body character-select portraits — `brawler`, `jiujitsu`, `monk` — each reframed from its
Phase 05 reference with the Higgsfield CLI (`nano_banana_pro`), on a baked dusk backdrop.

New files outside `concepts/`: [`scripts/check-portraits.py`](../../scripts/check-portraits.py) and
one `package.json` script. Two lines changed in
[`scripts/check-characters.py`](../../scripts/check-characters.py) (see §"What differed").

## What differed from the recipe

| Recipe says | What actually happened |
|---|---|
| Generate with Codex `$imagegen` | **Higgsfield CLI** (`nano_banana_pro`), as for Phases 03–05 — Codex CLI has no image-generation subcommand. |
| "based on their reference images" | As specified: each Phase 05 reference passed as `--image`. |
| — (not in the recipe) | **The backdrop is baked in**, not a keyable void. A user decision this session, taken against the plan's recommendation, and it changes what the gate can prove — see below. `asset-manifest.md`'s `Processing = none` stays accurate: nothing is keyed either way. |
| — (not in the recipe) | **The bust bleeds off the bottom edge.** User decision. It is what makes Phase 07's "portrait base accepts a portrait without seams" achievable — a floating bust would leave a void gap under the chest, which is the seam. |
| Save to `concepts/portraits/<timestamp>/` | As specified, following the Phase 03/05 convention (README inside the timestamp dir). No `-raw.png` split: nothing is keyed. |

## The gate is thinner than Phase 05's, on purpose

Phase 05 measured void fraction, figure count, specks, bbox and margins. **Every one of those rests
on separating figure from background by chroma**, and a baked backdrop removes that separation.
`measure()` cannot even be called here — it invokes `key-layers.py`'s `key()`, which raises when
there is no magenta.

Two replacement metrics were considered in planning and **rejected**, per Phase 04's rule that a
*wrong* metric is more dangerous than no metric:

1. **Corner-hex palette distance between the three portraits**, as a proxy for "they read as a set".
   Confounded — three different characters legitimately differ in colour, so any threshold is
   arbitrary in exactly the way Phase 05's rejected unique-colour-count check was.
2. **Bottom-edge vs top-corner comparison**, to infer the bust bleeds off the bottom. A dark jacket
   on a dark backdrop reads identically to backdrop. This is Phase 04's topmost-opaque-pixel trap
   (which scored a chain-link mesh as a solid wall) with new paint.

**So §4's visual checklist is this phase's primary instrument, not its supplement.** Phase 05 said
its checklist was load-bearing; here it is the only thing covering either acceptance criterion in
full. That is stated rather than papered over.

## Acceptance criteria

`npm run check:portraits` ([`scripts/check-portraits.py`](../../scripts/check-portraits.py)) is the
automated half. It **self-tests on 16 synthetic fixtures before judging real art**, then verifies
each portrait's record, prompt, size and backdrop.

Numbers below are its output **except** where marked *(measured separately)* — the L1-120 figure and
the L1-7/L1-360 headroom below are ad-hoc measurements taken while choosing the threshold; the
checker only ever computes `KEY_LO` (L1 40). Flagged because "all numbers are the gate's output"
would be exactly the kind of small overstatement this phase spends its length arguing against.

### 1. One distinctive upper-body portrait per fighter, consistent with its reference — PASS

| | size | aspect | prompt↔record | magenta residue | mode / alpha |
|---|---|---|---|---|---|
| `brawler` | 1792×2400 | 0.7467:1 | ✅ 3586 chars | **0 px** | RGBA, 100% opaque |
| `jiujitsu` | 1792×2400 | 0.7467:1 | ✅ 3769 chars | **0 px** | RGB |
| `monk` | 1792×2400 | 0.7467:1 | ✅ 3810 chars | **0 px** | RGBA, 100% opaque |

*Upper-body*: judged **by eye** (§4). There is no honest pixel metric for it without a figure/backdrop
split, and none is claimed.

*Distinctive*: three deliberately contrasting poses — cocky fists-up smirk / calm collar grip /
serene Shaolin salute. Designed before generating, because "distinctive" does not fall out of a
shared framing block. Judged **by eye**.

*Consistent with its reference*: judged **by eye** against each Phase 05 ref (§4). The automated part
is narrower and worth stating precisely: `params.prompt` in each job record is verified byte-equal
(modulo CRLF) to its `.prompt.txt`, so **the prompt claimed for a portrait is the prompt the recorded
job ran**, and exactly one `--image` reference is asserted present. That proves the reference rung was
taken; it does not prove *which* reference, nor that the PNG on disk is the bytes that job served.

*Consistent style across the three*: the three prompts carry a **byte-identical 2750-character block**
from the `FRAMING:` marker on, and the checker asserts that identity. Stated precisely: this
**prevents the prompts drifting apart** — a real failure it really catches. It does **not** prove the
three backdrops match, because the model is stochastic and identical prompts do not guarantee
identical output. That they do match is §4's by-eye call on `_preview.png`.

### 2. Higher fidelity than the in-game sprite but recognizably the same character — PASS

*Higher fidelity*: the portrait is **1792×2400**; the in-game sprite frame is **320×256**
([`sprite-schema.md`](../../public/configs/sprite-schema.md)) — 5.6× the linear resolution, 52× the
pixels. That is arithmetic, not a judgement. That the extra pixels carry *detail* rather than just
scale is **by eye** (§4).

*Recognizably the same character*: **by eye** (§4), against each Phase 05 reference.

### The one honest pixel metric this phase does have

**The backdrop really replaced the void: 0 px of surviving `#FF00FF`, on all three.** This is not
decoration — it checks the single prompt clause most likely to fail. The reference passed as
`--image` *is* a magenta void, and `--image` dominates the prompt, so "replace the magenta
completely" is a real instruction the model could really have ignored in a corner. It also asserts
alpha is fully opaque where present: a hole would mean the backdrop failed to paint.

The bound is **`KEY_LO` (L1 40)** — "any pixel that would key as fully void" — imported from
`key-layers.py` rather than restated, so it moves with the keyer. The exact cut is not load-bearing
and the numbers say why: a real surviving void sits at ~`(252,1,252)`, **L1 7** from pure magenta and
far inside the bound, while the nearest backdrop colour (`#5E3C74`) is **L1 360** away — ~9× headroom
either side *(measured separately)*. The gate reports **0 px at L1 40**; **0 px at the looser L1 120**
is *(measured separately)*, not something the checker computes. It cost nothing today and it catches a
regeneration that regresses.

**What it does not prove**, since the name invites more than it earns: that the backdrop is the one
that was *asked for*. A flat slab of any non-magenta colour passes this check — the selftest's
passing fixture is exactly that. The gradient, the rays, the halftone, and whether the three match
have no metric and are §4's by-eye call. This check is about the **void being gone**, not the art
being right. (Review's wording catch, accepted.)

## Per-fighter visual checklist

Automated checks cannot tell a correct fighter from a generic one, and here they cannot judge framing
at all. Each final PNG was read at full resolution against its Phase 05 reference, and at both
consumer sizes (300×400 card, 96px HUD square).

| | design fidelity | identity | upper-body framing | bleeds off bottom | head in HUD safe area | distinctive pose | backdrop matches set | no text | no logos |
|---|---|---|---|---|---|---|---|---|---|
| `brawler` | ✅ spiky brown hair, red cropped jacket, grey tank, black fingerless gloves | ✅ Phase 05 brawler | ✅ head/shoulders/chest | ✅ | ✅ | ✅ cocky, fists up, smirk | ✅ | ✅ | ✅ |
| `jiujitsu` | ✅ plain white gi, crossed lapel, dark blue-black hair | ✅ Phase 05 jiujitsu | ✅ | ✅ | ✅ | ✅ calm, collar grip | ✅ | ✅ | ✅ **no patch** |
| `monk` | ✅ bald, forehead ordination dots, wooden prayer beads, one-shoulder orange robe, white forearm wraps | ✅ Phase 05 monk | ✅ | ✅ | ✅ | ✅ serene, Shaolin salute | ✅ | ✅ | ✅ |

**HUD safe area verified by rendering it**, not by assertion: a top-anchored 1792×1792 square crop
downscaled to 96px keeps all three heads legible. Recorded in the README as the contract for Phase 14.

**Framing variance, noted not fixed:** `brawler` is cut slightly lower (at the waist) than `jiujitsu`
and `monk` (upper chest), under the identical shared block. All three are upper-body busts that bleed
off the bottom, so all three satisfy the criterion and the Phase 07 contract. Recorded because it is
the kind of thing a later phase might otherwise think it imagined.

## Rejections

**3 generations for 3 portraits — every one kept, first try. 6 credits.** Enumerated from
`higgsfield generate list --image --size 50 --json`, which is the authority: rejected PNGs get
overwritten in place and this checkout has no usable git history.

| # | Fighter | Job | Defect | Result |
|---|---|---|---|---|
| 1 | `brawler` | `770dd082` | — | **KEPT** |
| 2 | `jiujitsu` | `6f147770` | — | **KEPT** |
| 3 | `monk` | `9d68c57b` | — | **KEPT** |

The plan set the Phase 05 hard stop at **3 generations per fighter, then ask rather than spend**. It
was never approached. This is the first art phase with a zero-rejection run, and the reason is worth
recording rather than filing under luck: **every lesson Phases 03–05 paid credits for was applied
preventively in the first prompt**, rather than discovered. See below.

### Preflight (zero credits)

`higgsfield account status` → live, ultra plan, **1654 credits**.
`higgsfield generate cost nano_banana_pro --aspect_ratio 3:4 --resolution 2k` → **2 credits/job**,
confirming Phase 03's figure. Worst case (3/fighter) was 18 credits; actual spend **6**.

A review probe of `higgsfield model get nano_banana_pro` had failed with
`Error: Higgsfield API request failed`; re-running it returned the full param table. **Transient — one
error is not a diagnosis.**

## The findings no metric would have caught

1. **`RGBA` is a lie.** `brawler` and `monk` come back mode `RGBA`; `jiujitsu` comes back `RGB` — from
   **identical model and params**. Alpha is **255 on every pixel of all three**. So the container mode
   is non-deterministic and carries no information. CLAUDE.md's "no Higgsfield image model emits alpha"
   is intact, but a phase that tests `mode == "RGBA"` to decide "is this already keyed?" would be
   fooled on 2 of 3 files. Now asserted by the gate and recorded in the README.
2. **The gi's white band is a lapel, not a lost blue belt.** Phase 05's checklist records `jiujitsu`
   as "plain white gi, **blue belt**", and the portrait shows a white band at his waist — which reads
   as a design regression. A crop of the reference settled it in seconds: the blue belt sits at the
   waist, *below* the bust's crop line, so it is correctly out of frame; the white band is the gi's
   crossed lapel tie. **Nearly logged a defect from a recollection.** This is Phase 05's lesson
   ("trust a measurement over a reviewer's recollection") pointed at myself.

## Reusable lessons

- **Name the void as something to destroy, not just the backdrop as something to paint.** The
  `--image` reference *is* a magenta void and `--image` dominates the prompt, so "paint a dusk
  backdrop" alone leaves the void a plausible answer. *"Replace the reference image's flat magenta
  background completely. There must be no magenta anywhere in the finished image."* → **0 px of
  magenta, 3/3, first try.** This is Phase 05's discard-by-name trick applied to a colour instead of
  a scene.
- **Reference dominance is an asset when you name the framing as a discard.** The predicted failure
  was that `--image` would hand back the full body it was shown. It never did. The head says *"Discard
  the full-body framing … reframe to his head, shoulders and upper chest"* — the same mechanism that
  made Phase 05's stages vanish. `--image` dominance appears to be steerable specifically by naming
  what to drop, and the "worst case" framing in CLAUDE.md keeps failing to materialise when you do.
- **Anything that must be consistent across a set goes in the shared block; anything that must differ
  goes in the head.** The backdrop in the shared block is the only reason the three read as a set.
  The poses in the heads are the only reason they don't read as the same man three times. Phase 05
  established the shared block for *style*; the general rule is set-consistency vs per-subject
  identity.
- **Design the differences before generating.** "Distinctive poses" is an acceptance criterion; a
  shared framing block actively works against it. Writing the three poses down first (aggression /
  grip / stillness) cost nothing and is why criterion 1 passed by eye.
- **Apply a previous phase's per-subject fix preventively, not reactively.** The monk's wide low
  stance blew his framing twice in Phase 05. Naming it as a discard cost one sentence and he landed
  first try. Likewise the jiu-jitsu patch, forbidden by name even though the reference is already
  clean — "white gi" is exactly the prompt where one gets re-invented.
- **A container is not a capability.** See `RGBA` above.

## Review findings, fixed

Two Codex reviews were run (plan, then implementation), per the phase's brief. **Neither found a
blocking defect; both found real things.** Recorded because Phases 04/05 established that the bugs a
gate ships are worth more written down than a clean-looking log.

**Plan review** — caught before a credit was spent:
1. **The "one-line" `check_job` fix was two lines.** Line 189 also hardcoded `CHARACTERS`, so changing
   only the signature would have left `check-portraits.py` silently reading **Phase 05's** records and
   passing on portraits that did not exist. The nastiest kind of bug: a green gate on the wrong files.
2. **Skipping the selftest was wrong.** My reasoning ("no pixel metrics left to get wrong; fixtures
   for string equality are ceremony") ignored that `check_job` had just grown a *new* directory
   parameter and that `check_blocks` is, by this log's own argument, the most load-bearing check here.
   `CLAUDE.md` already said it: an art gate self-tests before it judges.
3. **Phase 07's missing dependency, Phase 15's unnamed art source, the runtime-handoff gap** — all
   three now fixed in their own specs.

**Implementation review** — on the built code:
4. **The gate printed false success text on failure.** `main()` emitted "matches params.prompt",
   "0 px magenta survived" and "fully opaque" as *fixed strings*, so a `FAIL` heading was followed by
   affirmative claims about the very checks that had just failed. Exit status was correct; the human-
   readable output lied. Fixed by printing **measurements, not verdicts** (`alpha min 255`, `0 px
   within L1 40`) — a number cannot make that mistake. This is the one worth remembering: the phase
   spends its whole length arguing a gate must not claim more than it proves, and its own console
   output was doing exactly that.
5. **`check_baked` only looked for alpha in `RGBA`.** `LA`, `PA` and palette-with-transparency also
   carry alpha, and `convert("RGB")` would have dropped it silently before the magenta test ran — the
   docstring said "when present", which was broader than the code. Fixed to test any mode that can
   carry alpha; fixtures added for `LA` and palette.
6. **The fixture count was wrong** — "12" printed while the suite's own enumeration listed 14, and it
   had propagated into the README and this log. Now **16** after the new alpha cases, and counted.
   Phase 05's log shipped the identical bug (said 8, ran 9); noticing it there and then repeating it
   is not a coincidence — a hand-maintained count next to a list is a drift trap.
7. **"In-memory, no fixture files" was false** — copied from Phase 05, where it was true (pure numpy).
   This suite writes temp PNGs/JSON to a `TemporaryDirectory`, by design, because the directory
   override is the thing under test.
8. **"All numbers below are its output" overstated.** The L1-120 and headroom figures are ad-hoc
   measurements; the checker only computes `KEY_LO`. Now marked *(measured separately)*.
9. **`check-characters.py:218` had gone stale** — my own edit shifted the note to 225.

**Process lesson, paid for in wall-clock:** the first implementation review **stalled for 13 minutes
and had to be killed**. Cause was mine — I edited `check_baked`'s docstring while Codex was
mid-read, it detected the file changing under it, and it burned the time re-reading to reconcile.
**Freeze the tree while a review is running.** The restart, against a stable tree and with the 3-4 MB
PNGs excluded from scope, returned cleanly.

## What the gate does not cover

Stated plainly so Phase 07/11/14 do not over-trust a green tick. `check:portraits` does **not** prove:

- framing (upper-body vs full-body), or that the bust bleeds off the bottom
- that the head survives the HUD square crop
- likeness to the reference, "distinctive", or that the extra pixels carry detail
- the absence of text, logos, or a name plate
- that the three backdrops match — identical prompts ≠ identical output
- **which** source image was used, or that the PNG on disk is the bytes the job served
  (inherited; [`check-characters.py:225`](../../scripts/check-characters.py) has the full note)

All of the above are §4, by eye. The 16 fixtures exercise `check_blocks`/`check_job`/`check_size`/
`check_baked`, including the new directory override and both CLI JSON shapes; they do not exercise
`preview()`.

**Two lines changed in a passed gate.** `check_job(fid, prompt)` → `check_job(fid, prompt, d=CHARACTERS)`
plus `path = d / …`, so Phase 06 reuses the provenance rules instead of keeping a second copy to
drift — the same reasoning as that file's own `key-layers.py` import. Default-valued, so Phase 05's
behaviour is unchanged, and `npm run check:characters` still passing is the proof. It transfers only
because both phases generate `nano_banana_pro` at `3:4`/`2k`; a phase choosing another aspect would
need `ASPECT` parameterised too, and the docstring says so.

## Downstream consistency (what Phase 07, 11, 14 and 15 are handed)

- **The Phase 07 contract.** Phase 07 must build a portrait base that *"accepts a Phase 06 portrait
  without seams"*, and before this phase it **did not list Phase 06 as a dependency** — a real
  ordering bug, amended here. The contract: **1792×2400, 0.7467:1**, bust **bleeding off the bottom
  edge** (no void band under the chest — a rectangular slot butts against it seamlessly), narrow
  backdrop band at the sides and top. It is now stated in this log, the
  [deliverable README](../../concepts/portraits/2026-07-17/README.md), Phase 07's own acceptance
  criterion, the Phase 06 spec delta, the manifest row and `CLAUDE.md` — deliberately redundant,
  because the failure mode is Phase 07 never finding it. The README table is the source; the rest
  point at it.
- **Nothing here is keyable.** No `#FF00FF`, verified at 0 px. Do **not** run `key-layers.py` on these
  — unlike every previous art phase's output. And `RGBA` on 2 of 3 files does not mean alpha.
- **Runtime handoff — gap found, and now assigned to Phase 11.** `concepts/` is authoring-only, yet
  Phase 11 and 14 need portraits at runtime and **no phase owned the copy into `public/`** (Phase 08
  owns it for backgrounds; portraits had no equivalent). Phase 06 does not get to decide Phase 11's
  *loading*, but leaving the gap merely documented would have let it fall through — review's point,
  accepted. So [Phase 11's task](11-menus-modes-versus-cpu.md) now explicitly owns producing the
  shipped copies, with the recommendation left to accept or replace (Phase 04's precedent of handing
  the next phase a worked config): `public/ui/portraits/<id>.png` for the ~300×400 card, a
  top-anchored square crop for Phase 14's HUD slot, **downscaled from these masters, never
  regenerated** — a 3 MB 1792×2400 master is not a shipping asset. Rationale in the
  [deliverable README](../../concepts/portraits/2026-07-17/README.md).
- **Phase 15's cut-in source is Phase 06.** `15-specials-meter-combos.md` calls for a "super cut-in"
  and never says what art it uses; the source video is explicit
  ([`00-walkthrough-captions.en.vtt:1343`](00-walkthrough-captions.en.vtt)): *"I wanted to show the
  portrait, and then… this lightbox effect where the portrait comes in from the left."* Recorded in
  Phase 15's spec in this phase.
- **These carry design, not scale** — inherited from Phase 05 and still true. Do not scale a sprite
  from a portrait.

## No-regression check

No `src/**` changed — this is an `[art]` phase — so the green baseline holds by construction.
`package.json` gained one script (`check:portraits`), so typecheck and tests were run anyway, per the
Phase 04/05 precedent. **Neither is the verifier for an art gate**, and here `check:portraits` is not
the whole verifier either — §4 is the rest.

```
npm run check:portraits    -> all 3 pass (16 selftest fixtures OK)
npm run check:characters   -> all 3 pass  (proves the check_job edit is a no-op)
npm run typecheck          -> clean
npm test                   -> all pass
```

## Gate status: PASSED

Both acceptance criteria met. The automated half is narrow and this log says exactly how narrow; the
visual checklist in §4 is the load-bearing half and is recorded in full rather than summarised.

Proceed to [Phase 07 — UI & Prop Atlases](07-ui-prop-atlases.md).
