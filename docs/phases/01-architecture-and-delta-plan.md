# Phase 01 — Architecture & Delta Plan  `[build]`

**Goal:** Produce a written, plan-first fighting-game architecture on top of the starter —
reusing the per-frame boxes, not rewriting them — and an explicit gap list to drive later phases.

**Source:** PDF recipe step 3 (`prompts.txt:5-24`).

**Verbatim source prompt:**
> Let's consider what we have here as a template. We now want to build a 2D fighting game like
> Street Fighter on top of this starting project. There already exists several scenes and
> functionality that will help with debugging, testing, and getting the main game in.
>
> Consider an architecture for a fighting game that is representative of what is done in a
> fighting game, but not overly complex. The key here is the animation + collision + gameplay
> logic. A traditional fighter has many animation states (forward, backward, block high, block
> low, attack soft/medium/hard, etc.) — but let's focus on the basic animations required for a
> compelling first pass and decide where to build on later.
>
> Before writing code, audit what the starter already gives us and tell me what is missing for a
> fighter. Then write a detailed implementation plan.
>
> Constraints for the first pass: two local human players sharing one keyboard (P1 + P2); two
> attack buttons — light and heavy; a new dedicated match scene; write the plan first, then build
> incrementally.

**Repo-adapted task:** Most of this first pass **already exists** in `src/sim/` (deterministic
sim, light+heavy, match scene, two local players). So the audit here is a *forward* plan:
confirm the sim architecture (pure `sim/` + Phaser render adapter, documented in `CLAUDE.md`)
and write the phase-by-phase plan to reach README parity — i.e. this very `docs/` guide. Do
**not** rewrite the sim; extend it.

**Tool / Skill:** `superpowers:brainstorming`, `superpowers:writing-plans`.

**Deliverables:** an architecture note affirming the `sim/`-is-pure rule and a prioritized gap list (this guide's phase index).

**Acceptance criteria:**
- The plan reuses `src/sim/` (no from-scratch rewrite proposed).
- Every gap in [PRD.md](../PRD.md) maps to a later phase.
- First-pass constraints (2 players/1 keyboard, light+heavy, dedicated match scene) are satisfied by the current repo — verified, not assumed.

**Depends on:** [00](00-source-research-and-baseline.md).

**Current-state delta:** **Present** — architecture + first pass already built; this phase validates & plans forward.
