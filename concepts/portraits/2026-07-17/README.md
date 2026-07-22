# Select portraits — 2026-07-17

Phase 06 deliverable: one stylised upper-body character-select portrait per fighter. These feed the
Phase 11 select cards, the Phase 14 HUD portrait base, and the Phase 15 super cut-in. **Nothing
loads from here** — `concepts/` is authoring art, not shipped (see the runtime handoff below).

Each portrait was reframed from its Phase 05 reference (`../../characters/2026-07-17/`) with the
Higgsfield CLI (`nano_banana_pro`), passing the reference as `--image`. The references stay the
design of record; these raise the fidelity and add the card backdrop.

## Files

| ID | Portrait | Source reference | Pose | Job |
|---|---|---|---|---|
| `brawler` | [`brawler.png`](brawler.png) | [`brawler.png`](../../characters/2026-07-17/brawler.png) | cocky, fists up, smirk | `770dd082-c56a-43e9-b70b-4e3eedf612c2` |
| `jiujitsu` | [`jiujitsu.png`](jiujitsu.png) | [`jiujitsu.png`](../../characters/2026-07-17/jiujitsu.png) | calm, collar grip | `6f147770-7240-41c1-a01b-310f018eab18` |
| `monk` | [`monk.png`](monk.png) | [`monk.png`](../../characters/2026-07-17/monk.png) | serene, Shaolin salute | `9d68c57b-083f-4910-ad6f-17b3f4c1341f` |

Each PNG carries a `<id>.prompt.txt` (the exact `--prompt` string) and a `<id>.job.json` (the
verbatim CLI job record). [`_preview.png`](_preview.png) is the 3-up contact sheet — it exists
because "do these three read as a set?" has no metric here and has to be judged by eye.

**IDs match the manifest's runtime sprite paths** (`public/sprites/<id>/`), as in Phase 05.

## The contract Phase 07 must honour

Phase 07's acceptance criterion is *"portrait base accepts a Phase 06 portrait without seams"*, and
until this phase [`07-ui-prop-atlases.md`](../../../docs/phases/07-ui-prop-atlases.md) did not even
list Phase 06 as a dependency (added in Phase 06, along with a pointer to these numbers). This table
and the [phase log](../../../docs/phases/06-select-portraits-log.md) are where the base's shape is
defined; Phase 07's criterion now cites them rather than restating them:

| | |
|---|---|
| Size | **1792×2400**, aspect **0.7467:1** (`3:4` — *the label lies*, it is not 0.75) |
| Framing | upper body: head, shoulders, upper chest. **The bust bleeds off the bottom edge** — there is no void band under the chest, so a rectangular slot butts against it with no seam. |
| Sides / top | a narrow band of backdrop beside the shoulders and above the hair |
| Backdrop | **baked in**, and identical across the three: vertical dusk gradient `#5E3C74` → `#8C476A` → `#FD9146`, sunburst rays behind the head, halftone dots in the corners. Hexes sampled from [`rooftop-dusk.png`](../../mockups/2026-07-16/rooftop-dusk.png), the locked direction. |
| HUD safe area | head + shoulders sit inside the **top 75%**, so a **top-anchored square crop** (1792×1792 from y=0) yields a usable HUD portrait. Verified by rendering it at 96px, by eye — not by a metric. |

## These are baked composites — there is nothing to key

**Do not reach for [`key-layers.py`](../../../scripts/key-layers.py) on these.** Unlike the Phase 05
references and the Phase 04 layers, there is no `#FF00FF` void here: the backdrop *replaced* it. The
gate measures this — **0 px** of surviving magenta on all three, at `KEY_LO` (L1 40, the "would key
as fully void" bound) and still 0 at the looser L1 120.

Two of the three PNGs report mode **`RGBA`** and one reports `RGB`, from identical model and params.
**The RGBA is meaningless**: alpha is 255 on every pixel of every portrait. Do not read the mode as
evidence of transparency — `nano_banana_pro` still emits no alpha, it just sometimes wraps an opaque
image in an RGBA container. A phase that tests `mode == "RGBA"` to decide "is this already keyed?"
will be wrong here.

## Geometry: these carry DESIGN, not SCALE

Inherited from Phase 05, and still true. **Do not scale a sprite from these images** — they are
portraits, framed for a card, at an arbitrary scale. The sim's fighter is
`HURT_STAND.h / STAGE_HEIGHT` = 185/720 = **25.7%** of the screen. Phase 09 hand-authors boxes
against the sim's constants.

## Runtime handoff — owned by Phase 11

`concepts/` is authoring art and nothing loads from it, but Phase 11 (select cards) and Phase 14
(HUD) need these at runtime, and **no phase owned the copy into `public/`** — Phase 08 owns it for
backgrounds; portraits had no equivalent. `asset-manifest.md` lists the destination as this
directory, which is true for the *masters* and insufficient for the *runtime*.

Phase 06 does not decide Phase 11's *loading*, but the gap is now **assigned** to
[Phase 11](../../../docs/phases/11-menus-modes-versus-cpu.md) rather than left floating. The
recommendation there, to accept or replace (the Phase 04 precedent of leaving a worked config for
the next phase):

> `public/ui/portraits/<id>.png`, **resized/cropped from these masters, never regenerated.** A
> 1792×2400 PNG is ~3 MB and the select card needs ~300×400 — ship a downscale, keep these as the
> masters. The HUD variant is the top-anchored square crop described above.

## Regenerating

```bash
cd concepts/portraits/2026-07-17
MSYS_NO_PATHCONV=1 higgsfield generate create nano_banana_pro \
  --prompt "$(cat brawler.prompt.txt)" \
  --image ../../characters/2026-07-17/brawler.png \
  --aspect_ratio 3:4 --resolution 2k --wait --json > brawler.job.json
# then: result_url from the JSON -> curl -o brawler.png
npm run check:portraits
```

`npm run check:portraits` ([`scripts/check-portraits.py`](../../../scripts/check-portraits.py)) is
the automated half of the gate: provenance, prompt↔record identity, the shared-block identity, size,
and the baked-backdrop check. It self-tests on 16 fixtures first. **It does not judge the art** —
framing, likeness, fidelity, distinctness, text and set-consistency have no metric here and are
covered by the visual checklist in the [phase log](../../../docs/phases/06-select-portraits-log.md).

## Gotchas worth knowing before touching these

- **Name the void as something to destroy.** The `--image` reference *is* a magenta void and
  `--image` dominates the prompt, so "paint a backdrop" alone invites the void to survive. The
  `BACKDROP:` block says *"Replace the reference image's flat magenta background completely. There
  must be no magenta anywhere in the finished image."* Result: 0 px of magenta in 3/3 first tries.
- **The backdrop belongs in the SHARED block, not the per-fighter head.** It is the only reason the
  three read as a set. Describe it per-fighter and you get three different cards.
- **Reference dominance was the asset here, not the enemy.** The worry was that `--image` would hand
  back the full body it was shown. It did not, in 3/3 — because the head names the framing as
  something to *discard* ("Discard the full-body framing… reframe to his head, shoulders and upper
  chest"), the same discard-by-name trick Phase 05 used on the stage.
- **The monk's wide low stance is named as a discard.** It is what blew his framing up twice in
  Phase 05; naming it preventively cost nothing and he landed first try.
- **The jiu-jitsu patch is forbidden by name even though the reference is already clean.** A generic
  "no logos" clause failed twice in Phase 05; the reference no longer has the patch, but "white gi"
  is exactly the prompt where one gets re-invented.
- **The blue belt is out of frame by design, not lost.** The reference's blue belt sits at the waist;
  the bust cuts above it. The white band across the gi is the crossed lapel tie. Checked against a
  crop of the reference before it was called a defect.
- **The aspect label lies, again.** `3:4` returns 1792×2400 = **0.7467:1**. Read `params.width/height`
  from the job record; the gate cross-checks the PNG against it.
- **The job record cannot name the source reference** — only an opaque upload id. The mapping in the
  table above is *recorded*, not proven. Same limit as Phase 05
  ([`check-characters.py:225`](../../../scripts/check-characters.py)).
- Redirect **stdout only**; `2>&1` merges the CLI's `Error:` line into the JSON and corrupts it.
- **Jobs are recoverable.** `higgsfield generate list --image --size 50 --json` finds a job you
  overwrote; `higgsfield generate get <id> --json > <id>.job.json` restores the record for free
  (bare-object shape — the checker normalises both).
