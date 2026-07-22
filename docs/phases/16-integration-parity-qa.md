# Phase 16 — Integration, Parity & QA  `[gate]`

**Goal:** Prove the whole game hangs together and matches README parity: the full flow, all three
fighters, both modes, both stage variants, camera, HUD, specials, rematch, and config reload —
backed by unit tests and a browser smoke test.

**Source:** Derived from the [GitHub README](https://github.com/chongdashu/vibe-fighter) parity
list; Video "Wrap Up" (18:09). See [traceability.md](../traceability.md).

**Verbatim source prompt:** *(none — QA gate.)*

**Repo-adapted task:**
- Restore the **third fighter** (boxer) that the recipe deferred in [Phase 11](11-menus-modes-versus-cpu.md); confirm all three are selectable and playable.
- Walk the full flow end-to-end in both 1v1 and 1vCPU, on both stages.
- Drive a Playwright acceptance test through the DEV `window.__world` hook already exposed in
  `MatchScene.ts` (see `CLAUDE.md`): start a match, land a hit, land a multi-hit special, KO,
  advance rounds, reach match-end, rematch.
- Run `npm run build` (typecheck) + `npm test` (vitest) green; add browser smoke coverage.
- Verify config reload: editing `public/configs/character-gym.json` changes live combat/stats.

**Tool / Skill:** `playwright-cli`, `superpowers:verification-before-completion`, `superpowers:test-driven-development`.

**Deliverables:** a green build + test run, a Playwright smoke test, a filled-in parity checklist in [traceability.md](../traceability.md).

**Acceptance criteria (parity checklist — all must pass):**
- Full flow: splash → menu → mode → stage → character select → match, no dead-ends, both modes.
- Three distinct fighters; two stage variants; group camera scrolls a wide stage.
- Per-frame hit/hurt/guard combat with active windows; light + heavy; geometric high/low block.
- Best-of-3 + 60s timer; z-order + facing flip; rematch/menu.
- Atlas HUD with dynamic fill, low-health blink, match-start entrance.
- Meter specials with a deterministic multi-hit count + super cut-in.
- `npm run build` and `npm test` pass; Playwright smoke test passes.

**Depends on:** all prior phases.

**Current-state delta:** N/A (integration gate). Baseline `combat.test.ts` + `regression.test.ts` already green; extend, don't replace.
