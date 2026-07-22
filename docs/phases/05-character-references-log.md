# Phase 05 — Character References Log (gate result)

Evidence that Phase 05 passed. Recorded **2026-07-17**. Phase tag `[art]`. Deliverables live in
[`concepts/characters/2026-07-17/`](../../concepts/characters/2026-07-17/); this log certifies the
three acceptance criteria at [`05-character-references.md:38-40`](05-character-references.md).

Three isolated full-body references — `brawler`, `jiujitsu`, `monk` — each generated from its
locked Phase 03 mockup with the Higgsfield CLI (`nano_banana_pro`), on a flat `#FF00FF` void.

## What differed from the recipe

| Recipe says | What actually happened |
|---|---|
| Generate with Codex `$imagegen` | **Higgsfield CLI** (`nano_banana_pro`), as for Phases 03–04 — Codex CLI has no image-generation subcommand. |
| "the green boxer from the dojo mockup" | **Shaolin monk.** Phase 03 dropped the boxer from the roster; the dojo's left fighter is a monk. |
| "the jiu-jitsu fighter … from the subway mockup" | **neon-alley.** The subway stage was scrapped in Phase 03. |
| Save **draft & final** prompts | **Final only.** Phase 03 ruled a second copy a drift risk and recorded the sidecar as "the single source passed verbatim to `--prompt` (no separate copy that could drift)". The `job.json`'s `params.prompt` is an independent second record, and the checker asserts the two match — a real integrity check, which a hand-kept "draft" file would not be. Deviation accepted deliberately, not overlooked. |
| Save to `concepts/characters/<timestamp>/` | As specified. Follows the **Phase 03 mockups** convention (README inside the timestamp dir); no `-raw.png` split, because nothing is keyed. |
| — (not in the recipe) | **Nothing is chroma-keyed.** `asset-manifest.md` specifies `Processing = none (reference)` for this row; Phase 09 owns the alpha sheets. The void is kept because it is the only way to force "no stage" from a generator that cannot emit alpha, and because it makes "did the stage survive?" measurable. |

## Acceptance criteria

`npm run check:characters` ([`scripts/check-characters.py`](../../scripts/check-characters.py)) is
the gate. It **self-tests its own metrics on 8 synthetic fixtures before judging real art**, then
measures each reference and verifies each job record. All numbers below are its output.

### 1. 3 distinct, isolated full-body references, consistent SNES style — PASS

| | size | void | figures | specks | bbox h | margins L/R/T/B |
|---|---|---|---|---|---|---|
| `brawler` | 1792×2400 | 81.6% | **1** | 0 | 76.1% | 28.5 / 21.8 / 14.0 / 10.0 % |
| `jiujitsu` | 1792×2400 | 87.1% | **1** | 0 | 56.0% | 27.0 / 22.8 / 24.1 / 19.9 % |
| `monk` | 1792×2400 | 71.4% | **1** | 0 | 77.0% | 14.8 / 12.8 / 17.5 / 5.5 % |

*Isolated*: void ≥ 55% required, 71–88% measured. Void flatness delegated to `key-layers.py`'s own
`key()`, so a polluted void fails identically in both scripts.

*Distinct*: three different archetypes, sourced from three different mockups — judged **by eye**
(see §4). There is no honest pixel metric for "distinct", and none is claimed.

*Consistent style*: enforced **by construction**, not by eye. All three prompts carry a
byte-identical 3231-character style block, and the checker asserts that identity. `params.prompt`
in each job record is verified against its `.prompt.txt`, so **the prompt claimed for a reference is
the prompt the recorded job actually ran**. That is a prompt↔record check, not an end-to-end one:
the gate does not verify that the local PNG is the bytes served by that job's `result_url`, so it
cannot prove the image itself came from the job beside it. §4's visual review is what actually ties
each PNG to its fighter.

### 2. No stage, HUD, opponent, logos, or text; generous padding (crop-safe) — PASS

*No stage / no opponent* is the **figure count**: exactly 1 column run in all three, 0 specks
outside the figure bbox. Two of the three mockups contain a second fighter and all three are dense
scenes; nothing survived.

*Generous padding / crop-safe*: every margin ≥ 5% of its dimension, and the figure 55–80% of frame
height. Measured margins are 5.5–28.5%; no figure touches an edge.

*No logos / no text*: judged **by eye** (§4). No OCR is run and none is claimed. One real defect
was caught this way — see the flag patch in §5.

### 3. Prompts saved alongside each — PASS

`brawler.prompt.txt`, `jiujitsu.prompt.txt`, `monk.prompt.txt`, each the exact `--prompt` string,
each verified byte-equal (modulo `\r\n`) to its job record's `params.prompt`. Final only — see
"What differed" above.

## Per-fighter visual checklist

Automated checks cannot tell a correct fighter from a generic one, so the gate is not only
automated. Each final PNG was read and checked against its source mockup:

| | design fidelity | correct identity | faces right | full body | neutral lighting | no text | no weapons |
|---|---|---|---|---|---|---|---|
| `brawler` | ✅ spiky brown hair, red cropped jacket, light shirt, denim, red sneakers, fingerless gloves | ✅ rooftop-dusk left | ✅ | ✅ | ✅ no dusk cast | ✅ | ✅ |
| `jiujitsu` | ✅ plain white gi, blue belt, barefoot, short dark hair | ✅ neon-alley right | ✅ **mirrored** from the source | ✅ | ✅ no neon cast | ✅ | ✅ |
| `monk` | ✅ bald, orange robes, red sash, prayer beads, forearm/shin wraps | ✅ dojo left | ✅ | ✅ | ✅ no lantern warmth | ✅ | ✅ weapon rack gone |

`jiujitsu` faces right by **mirroring**: he is the right-hand fighter in neon-alley and faces left
there. [`sprite-schema.md`](../../public/configs/sprite-schema.md) requires art drawn facing `+x`.

## Rejections

**10 generations for 3 references** — `brawler` ×2, `monk` ×3, `jiujitsu` ×5. Enumerated from
`higgsfield generate list`, which is the authority here: the rejected PNGs were overwritten in place
and this checkout has no usable git history, so the server's job list is the only durable record.

| # | Fighter | Job | Defect | Caught by | Result |
|---|---|---|---|---|---|
| 1 | `brawler` | `d843d633` | fills the frame, no padding | margin + bbox-height | 91.6% h, margins 4.6/3.8% |
| 2 | `jiujitsu` | `eb1fa06c` | flag patch; framing ok | eye | 75.7% h |
| 3 | `monk` | `2060526f` | fills the frame | margin + bbox-height | 89.4% h |
| 4 | `brawler` | `09411d83` | — | — | **KEPT**, 76.1% h |
| 5 | `jiujitsu` | `bf56e4ec` | flag patch survives a generic "no logos" clause | eye | 77.4% h |
| 6 | `monk` | `f7980dcf` | camera fix made it *worse* | margin + bbox-height | 95.1% h, 3 edges |
| 7 | `monk` | `24c4634d` | — | — | **KEPT**, 77.0% h |
| 8 | `jiujitsu` | `8b1dbe54` | patch gone; framing just under floor | bbox-height | 53.2% h |
| 9 | `jiujitsu` | `7e047f17` | full-bleed blowout — a prompt error of mine, not a bad roll | margin | 100.0% h, margins 0 |
| 10 | `jiujitsu` | `527cfd82` | — | — | **KEPT**, 56.0% h |

### Retry budget and the two decisions that extended it

The plan set a hard stop at **3 generations per fighter**, then ask rather than spend. `brawler`
(2) and `monk` (3) finished inside it. `jiujitsu` reached the stop at #8 and the budget was
extended twice, each by an explicit user decision, both recorded here because the plan's whole point
was that going past 3 is a decision and not a loop:

1. **At the stop (#8, 53.2%)** the options put were: accept and re-derive the 55% floor at zero
   credits, or spend a 4th. The user chose to spend. That generation (#9) was **wasted by a prompt
   error of mine** — a nudge telling him to "nearly touch" the margin band contradicted the shared
   block's "do not let him fill the frame", and the model resolved the contradiction by going
   full-bleed. #8 was then recovered from the server for free via `generate get`.
2. **After #9 failed**, the same choice was put again with the new evidence. The user chose one more
   clean roll. #10 landed at 56.0% — inside the band, patch still gone. **No threshold was moved.**

## The finding no metric would have caught

`jiujitsu`'s gi carried a small **blue-and-yellow flag patch**, straight out of the mockup
(visible in `neon-alley.png` at roughly x 2180–2480, y 780–980). It survived two generations under
the shared block's generic "no logos, no labels" clause; naming it explicitly — *"in the reference
there is a small blue-and-yellow flag patch on his shoulder: REMOVE IT"* — removed it.

This is recorded because of how close it came to shipping. The plan review had flagged the patch as
an unsupported detail I'd invented, and it was dropped from the prompt on that basis; it was real,
and it was only caught because the visual checklist is part of the gate rather than a formality. A
national flag on a character the recipe requires to be original is exactly the kind of defect the
"no logos" criterion exists for, and **no pixel metric in this gate would have flagged it**.

## Reusable lessons

- **Describe the camera's distance, not the figure's percentage** — Phase 04's lesson, re-confirmed
  from the other side. "He spans roughly two thirds of the image height" was ignored twice.
  Replacing it with a camera pulled back far enough to leave *a band as tall as his own head* above
  and below fixed `brawler` in one gen. Phase 04 anchored scale to a person in a scene; here the
  subject *is* the person, so the anchor became his own head.
- **When it still ignores you, name what is actually driving it.** `monk` got worse under the camera
  fix. One sentence naming his **wide low stance** as the thing forcing the blowout — and saying the
  camera must therefore pull back *further* — fixed him in a single gen. Phase 04 said a 3×-ignored
  instruction means the prompt names the wrong variable; the corollary is that the wrong variable
  can be fighter-specific even when the instruction is shared.
- **Do not contradict your own prompt; the model resolves it by maximising.** A nudge telling
  `jiujitsu`'s head to "nearly touch" the band collided with the shared block's "do not let him fill
  the frame", and the result was 100% full-bleed. Tighten a constraint or replace it — never argue
  with it.
- **`--image` carries over what the prompt never mentioned.** A generic "no logos" clause did not
  remove the flag patch across two gens; naming it explicitly did. Read the source art for anything
  a criterion would catch, and forbid it *by name*.
- **Trust a measurement over a reviewer's recollection — including a reviewer you asked for.** The
  patch was dropped from the prompt because a plan review judged it unsupported; a 300×200 crop of
  the mockup settled it in seconds and showed it was real. The repo's own convention already says
  this ("prefer a measurement to an opinion on generated art"); it applies to opinions about the
  *source* art too, and the crop costs nothing.
- **The expected `--image` failure did not happen.** `CLAUDE.md` predicts `--image` dominates the
  prompt and invents scenery into the void, so "discard the scene" should have been its worst case.
  Across all 7 gens the stage never survived once. Naming each element to discard *by name* appears
  to be what does it. The gotcha is not wrong — it is narrower than stated.

## Three metric bugs, caught and fixed

Recorded because Phase 04 established that a *wrong* metric is more dangerous than no metric. Two
were caught by machinery; the third was caught by review, which is the interesting one.

1. **A 4px speck scored as a second figure.** The first figure-count cut thresholded columns at
   0.5% of image height — 2px on the fixture — so a speck registered as a whole fighter. **The
   selftest caught it before a single credit was spent**, which is the entire reason the selftest
   runs first. Fixed by weighting each run by the art it holds (a real second fighter carries art
   comparable to the first; a speck carries a rounding error).
2. **The job-provenance check asserted the impossible.** It required the source mockup's basename in
   `params.input_images`, and **failed all three references on good art**. The API uploads the local
   `--image` and records an opaque upload id + `<id>_resize.jpg` URL — the filename is never in the
   record. Weakened to what the record can actually prove (exactly one input image was used, i.e.
   the reference rung was really taken) with the ceiling named in the code. Review's correction,
   accepted: this is an unavoidable *filename* limit, not an unavoidable *provenance* limit —
   correlating the stored `_resize.jpg` against the mockups, or hashing the input at generation
   time, would both work. Both were rejected as more machinery than this phase earns (a gate doing
   network I/O; or a second provenance file to keep in sync, which is the drift risk Phase 03 ruled
   against). The mockup binding is therefore **recorded, not proven**, and the code says so.
3. **"Exactly one figure" did not mean exactly one figure.** Runs holding under 10% of the main
   figure's art were dropped as scenery, and the leftover pixels were only *reported*. Review
   demonstrated the hole with a 50×25 second figure: `runs=1`, 1250px of specks, **verdict PASS**.
   The selftest could not have caught this — its two-figure fixture uses near-equal rectangles, so
   it never probes the filter's low end. Fixed by bounding speck area at 0.5% of the figure's own
   art, which makes the two gates complements: anything large enough to be a figure trips `runs`,
   anything smaller but above noise trips the speck bound. A fixture for exactly that case is now
   pinned in the selftest. All three references measure **0 specks**, so the bound costs nothing.

A third check was **deliberately not written**: unique-colour count as a proxy for "limited SNES
palette". `nano_banana_pro` emits non-indexed 2k PNGs with tens of thousands of colours regardless,
so any threshold would be vacuous or arbitrary. Phase 04 removed vacuous checks rather than leave
them as decoration; this one was never added.

The inherited void-flatness bound is also documented in `measure()` as catching a *bimodal* void but
not a gentle ramp — a uniform ramp's stddev is range/√12, and the prefilter only admits pixels
within L1 200 of magenta, so the sum tops out near 58 < 60 **by construction**. The selftest asserts
the behaviour the metric has (two-tone), not the one it doesn't (ramp).

**What the gate does not cover**, stated plainly so Phase 06/09 do not over-trust it: the 9 fixtures
exercise `measure()`/`verdict()`, not every margin direction, the upper bbox bound, the shared-block
identity check, or `check_job()` — those are exercised by the real run instead. Two overlapping
figures would still read as one (the run projection is not connected-component labelling; ceiling
named in the code, and `scipy.ndimage.label` is importable here — 1.16 — if a real asset ever needs
it). A pass does not prove which mockup produced a reference, nor that the PNG on disk is the bytes
from the job record beside it. And "no text" / "no logos" / "distinct" have no
metric at all — §4's visual review is load-bearing, not decorative, as the flag patch proved.

## Downstream consistency (what Phase 06 and 09 are handed)

- **Canonical IDs**: `brawler`, `jiujitsu`, `monk` — matching the manifest's runtime sprite paths
  `public/sprites/<id>/`, so Phase 09 does not have to infer hyphenation. `asset-manifest.md`'s
  stale `Boxer (green)` → `public/sprites/boxer/` row is replaced with `Monk (Shaolin)` →
  `public/sprites/monk/` in this phase; leaving it would have meant a monk reference feeding a row
  named boxer.
- **These refs carry design, not scale.** The mockups draw fighters at ~50% of frame; the sim's
  fighter is `HURT_STAND.h/STAGE_HEIGHT` = 185/720 = **25.7%**. Phase 09 records that scaling from
  mockup proportions lands ~1.8× too big, and these refs inherit that trap. Phase 09 hand-authors
  boxes against the sim's constants — it must not scale from these images. Restated in the
  [deliverable README](../../concepts/characters/2026-07-17/README.md).
- **Facing**: all three drawn facing `+x` (right), per `sprite-schema.md`. `jiujitsu` is mirrored
  relative to his mockup.
- **Not keyed, and the void is not literally `#FF00FF`.** Phase 09 owns the alpha, per the manifest.
  The void is *nominally* magenta because that is what the prompt asks for, but only **0.004%** of
  pixels are exactly `(255,0,255)` — it clusters around **`(252,1,252)`**. **Key with a tolerance,
  never with `== #FF00FF`**, or Phase 09 will erase nothing and conclude the asset is broken. Reuse
  `key-layers.py`'s `key()`/`despill()` (L1, `KEY_LO=40`/`KEY_HI=120`) — which is exactly what
  `check-characters.py` reuses to measure these. Caught in review; restated in the deliverable
  README and the manifest row.

**Noticed, not fixed:** [`03-concept-mockups-log.md:39`](03-concept-mockups-log.md) lists a
`subway.prompt.txt` among the Phase 03 sidecars; that file does not exist (it is
`neon-alley.prompt.txt`). That log's own downstream section already records the subway→neon-alley
swap correctly, so only its file list is stale. Editing a passed gate's log is a separate call.

## No-regression check

No `src/**` changed — this is an `[art]` phase — so the green baseline holds by construction.
`package.json` gained one script (`check:characters`), so typecheck and tests were run anyway,
per the Phase 04 precedent. **Neither is the verifier for an art gate**; `check:characters` is.

```
npm run typecheck   -> clean
npm test            -> all pass
```

## Gate status: PASSED

All three acceptance criteria met, with measured evidence above and an explicit eyeball checklist
for the parts no metric can honestly cover.

Proceed to [Phase 06 — Select Portraits](06-select-portraits.md).
