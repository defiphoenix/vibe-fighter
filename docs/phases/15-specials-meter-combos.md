# Phase 15 — Specials, Meter & Multi-Hit Combos  `[build]`

**Goal:** Add a meter-gated special system with multi-hit combos and a super cut-in finisher —
proven on a training dummy. **The key blocker is that the sim currently dedups an attack to a
single connect**; multi-hit requires changing that.

**Source:** PDF recipe step 15 (`prompts.txt:178-191`); Video Step 11 "Special Moves and Polish" (16:53).

**Verbatim source prompt:**
> I'd like a 'special moves' system — hit a specials button when a meter is filled. Define the
> specials for the brawler and the jiu-jitsu fighter; they each need a charging animation and an
> execution animation (the jiu-jitsu guy could do a 'spinarooni', the brawler a revolving
> uppercut). The key thing: how do we register multiple hits across an animation? Right now we
> register one hit per attack animation, but specials usually have a combo. Also consider what on-
> screen effect is needed. (The special charge/execution spritesheets are already bundled.)
>
> The playground needs a dummy character and a debug toggle to fill the player's special bar. The
> dummy should have a health bar that constantly regenerates after hits so we can visualise the
> impact of attacks. I just tried the jiu-jitsu special on the dummy — how many hits do we expect?

**Repo-adapted task:**
- **Multi-hit:** `fighter.ts` uses a single `hasHit` flag that dedups an entire attack to one
  connect. Replace with per-active-window (or per-hit-id) dedup so one special animation can land
  N hits. This is the central mechanic — cover it with new `combat.test.ts` cases asserting the
  expected hit count.
- **Meter:** add a meter that fills on hits/damage; a specials button spends it when full. Extend
  the sim state + `InputSnapshot` (keep sim pure/deterministic).
- **Specials:** define brawler (revolving uppercut) + jiu-jitsu (spinarooni) with charge +
  execution animations; the super cut-in is a render-layer effect. "Bundled" special sheets do
  **not** exist locally — source them per [asset-manifest.md](../asset-manifest.md) (Phase 02).
  **The cut-in's art is the [Phase 06](06-select-portraits.md) select portrait** — the spec never
  said so, but the source video is explicit (`00-walkthrough-captions.en.vtt:1343`: *"when the
  specials happens, I wanted to show the portrait, and then… this lightbox effect where the portrait
  comes in from the left"*). They are 1792×2400 masters on a baked backdrop; scale, don't regenerate.
- **Dummy:** add a training-dummy toggle in the [Playground](10-fighter-playground.md) with a
  self-regenerating health bar + a fill-meter debug toggle.

**Tool / Skill:** `superpowers:test-driven-development` (multi-hit count is a must-test), `find-docs`.

**Deliverables:** meter system, per-window multi-hit, two specials + super cut-in effect, training dummy in Playground.

**Acceptance criteria:**
- A single special animation lands a **deterministic N>1** hit count (asserted in a test).
- Meter fills from combat and gates the special; empty meter = no special.
- Both specials play charge → execution with an on-screen effect / cut-in.
- Dummy regenerates health and the meter-fill toggle works in the Playground.

**Depends on:** [10](10-fighter-playground.md), [12](12-core-combat-camera-integration.md),
[06](06-select-portraits.md) (the super cut-in renders a Phase 06 portrait — added in Phase 06).

**Current-state delta:** **Missing** — no meter, no specials, no combos; `hasHit` single-connect dedup blocks multi-hit.
