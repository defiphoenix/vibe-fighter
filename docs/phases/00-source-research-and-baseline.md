# Phase 00 — Source Research & Verified Baseline  `[gate]`

**Goal:** Lock the ground truth before building. Confirm the starter's capabilities, watch the
walkthrough for setup Steps 1–2 (which the PDF recipe omits), and record the exact repo delta
so no later phase rebuilds something that already works.

**Source:** Video Step 1 "Context" (02:40); the whole walkthrough `en37mtF42eQ`; `prompts.txt`; the sim under `src/sim/`.

**Verbatim source prompt:** *(none — this is a research gate, not a recipe step.)* The guide's
framing of this step (an editorial gloss, **not** a verbatim video quote — see
[00-baseline-log.md](00-baseline-log.md) §3): *"Why a fighting game is 'just' a per-frame box
engine — and how a platformer starter already had everything it needed."*

**Repo-adapted task:**
- Pull the walkthrough transcript + chapters (done in this gate via `yt-dlp` native subs; 15
  chapters; captions saved to [00-walkthrough-captions.en.vtt](00-walkthrough-captions.en.vtt)).
- Read `src/sim/{world,fighter,combat,spatial,match,config,types,constants}.ts` and both test
  files; write down what is Present / Extend / Missing (captured in [PRD.md](../PRD.md#current-baseline-what-the-starter-already-provides)).
- Confirm the starter is a platformer-style template whose per-frame box + debug-scene system is reused, not rewritten.

**Tool / Skill:** `watch`, `find-docs`. See [skills-map.md](../skills-map.md).

**Deliverables:** the completed baseline + delta sections in [PRD.md](../PRD.md) and [traceability.md](../traceability.md).
**Gate result:** [00-baseline-log.md](00-baseline-log.md) — test baseline, delta verification, Setup Steps 1–2 notes, `prompts.txt` generation.

**Acceptance criteria:**
- Every README parity item appears in [traceability.md](../traceability.md) with a current-state label.
- `npm test` passes on the untouched starter (records the green baseline).
- Setup Steps 1–2 content is captured (or explicitly marked "member-only / not shown") — no unverified claims.

**Depends on:** nothing.

**Current-state delta:** N/A (research gate).
