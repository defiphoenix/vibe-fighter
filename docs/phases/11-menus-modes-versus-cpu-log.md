# Phase 11 — Menus, Modes, Versus Flow & CPU · gate log

**Date:** 2026-07-19 · **Status:** implementation complete, gate green
**Spec:** [`11-menus-modes-versus-cpu.md`](11-menus-modes-versus-cpu.md)

## What shipped

The game no longer boots into a match. A shipped `FlowScene` runs the Play flow — **title → mode
(1v1 / CPU easy·normal·hard) → stage → character select** — and hands `MatchScene` a `MatchConfig`
through `scene.start("Match", cfg)`. 1vCPU is driven by a pure, seeded `CpuController` in `src/sim/`.
Phase 06's portraits finally have a runtime home (`public/ui/portraits/`, baked, never regenerated).

| Acceptance criterion | Result |
| --- | --- |
| Full flow reaches a match with the chosen mode, stage and fighters; no dead-ends | ✅ e2e drives title→match and asserts the pair **and** that the chosen stage's layer textures are the ones on screen; `Esc` at `matchEnd` returns to the flow |
| 1vCPU: player picks, CPU picks with a lock-in flash, match runs vs CPU | ✅ e2e locks P1, the CPU takes the free card after a think beat, then P2 acts with **zero** human input |
| 1v1: independent P1/P2 selection with indicators and same-character lockout | ✅ P1 = `A`/`D` + `F`, P2 = `←`/`→` + `,`; moving swaps the pair, a locked opponent blocks the move, the two can never hold one card |
| "Round 1… Fight!" gates input until the intro completes | ✅ unchanged — the sim's `intro` phase and `Hud.update` already did this; no new sim work, and the flow deliberately did not re-implement it |

Also in this phase, from the same prompt: the **roster is restricted to brawler + jiujitsu** (monk
stays in the registry and in Gym/Playground; Phase 16 restores it to select), and the **per-bound
debug toggles now exist in the real match** — `1`–`4` per bound plus `B`, defaulting **off**, unlike
the Playground's default-on.

## The CPU is sampled per TICK, not per frame

The one architectural decision worth recording. `World.advance` runs a variable number of fixed
60 Hz ticks per call, so an `InputSnapshot` produced once per render frame would make the opponent
act at the *display's* rate — 3 ticks of one identical decision on a slow frame, none on a short one.
`advance` therefore takes an optional `CpuSeam` and calls `cpu.next(this)` **inside** the loop:

```ts
export interface CpuSeam { readonly index: 0 | 1; next(world: World): InputSnapshot }
advance(dt, inputs, cpu?: CpuSeam): number
```

The controller bypasses `EdgeLatch` (it re-derives its edges every tick, so a non-actionable tick
costs it nothing) and uses a seeded xorshift32 — no `Math.random`, no `Date.now`, `sim/` stays pure.
`cpu.test.ts` pins the seam with a counting spy: **a 3-tick batch must ask the controller 3 times.**
That test was watched failing (`expected 1 to be 3`) with the frame-sampling bug re-introduced, then
the bug was removed.

Codex reviewed the plan before implementation and flagged exactly this as its top finding.

## Bugs found and fixed along the way

- **The lock-in flash swallowed P2's lock.** The flash set a `busy` flag for its ~320 ms; in 1v1 both
  players press at once, so a quick P2 lost their input. Only the CPU's think-and-reveal beat sets
  `busy` now — there is genuinely nothing to press then.
- **Phaser 4 tween callbacks are wall-clock driven.** `TweenManager.getDelta()` reads `Date.now()`,
  not the scene delta, so a tween does **not** advance under a pumped `game.step` — the flow, if
  sequenced off `onComplete`, was untestable *and* one interrupted tween away from stranding both
  players locked with no match. Sequencing moved to `Time.Clock` (`delayedCall`, delta-driven); the
  tween is decoration.
- **Every card rendered invisible**, then **everything rendered dim** — two separate defects that no
  test could have caught and a screenshot caught instantly. First: `paint()` called
  `killTweensOf(card.root)`, which killed the entry *fade* mid-way and froze the cards at alpha 0
  (fix: track and stop only the card's own scale tween; the entry tween force-settles alpha on stop
  *or* complete). Second: the menu container defaulted to depth 0, i.e. **under** the backdrop scrim
  at depth 1 — a container's own depth is what sorts it against the scene; its children's depths are
  only relative to each other.

## The reported save bug: not reproducible

The prompt reported "when I tried to save the jiu-jitsu fighter's scale it said *target not found*".
That string exists nowhere in the repo. Both reachable paths were driven in a real browser
(`?scene=playground` with jiujitsu selected and `scale` edited, and `?scene=gym`), each with the file
bytes snapshotted and restored: both returned **`200 {"ok":true}`**, wrote the file, and showed
`saved ✓`. The third path in the plan — a `preview`/production build — turned out not to exist:
prod registers only Boot/Flow/Match, `?scene=` is DEV-only, and the save middleware is
`apply: "serve"`.

Rather than guess, three real defects on that path were fixed and the round trip was pinned by test:

- `saveRegistry` reported a bare `String(res.status)`, so a 404 surfaced as an opaque `"404"`. It now
  says *"save endpoint unavailable — dev server only (npm run dev)"*, and passes the server's own
  error text through otherwise.
- `saveRegistry` treated **any 2xx as success**, so a truncated or non-JSON response reported
  `saved ✓` with nothing on disk. It now requires `{ok:true}`.
- `gym-save-plugin.ts` resolved its target from `process.cwd()` — a dev server started from any other
  directory wrote to, or failed on, a path that does not exist (an ENOENT that reads exactly like
  "not found"). It now resolves from `import.meta.url` and reports a missing target directory
  explicitly. **This is the most plausible remaining explanation for the report.**
- `PlaygroundScene.selectFighters` re-read the working copy when only the **dummy** changed, silently
  discarding unsaved player edits.

The e2e now proves the user's actual requirement end to end: save a stat in the Playground → it lands
in `character-gym.json` → a fresh boot of the match reads it back. The spec snapshots and restores
the file's bytes in a `finally`; the middleware writes to one fixed path and this repo has no VCS
safety net.

## Portraits: the Phase 06 runtime handoff

`scripts/copy-portraits.py` (`npm run copy:portraits`) downscales the three 1792×2400 masters to
**448×600** (2× the ~300×400 card, so `Scale.FIT` upscaling never softens them) into
`public/ui/portraits/`. **No art gate runs**: these are baked composites with no void — Phase 06
measured 0 px of magenta — so this is a resize, not a key. The script self-tests 5 assertions before
it touches the real art, including that an opaque *RGBA-container* image passes (Phase 06's masters
are 2/3 RGBA with alpha 255 everywhere; the mode string carries no information). All three ids are
baked even though only two are selectable — the monk costs ~40 KB and keeps Phase 16 a config change.
The Phase 14 HUD square crop is deliberately **not** emitted yet.

## Visual direction

`ui-ux-pro-max --design-system` was consulted and **two of its three recommendations rejected on
purpose**: not Pixel Art (`main.ts` omits `pixelArt` because the art is photographic and LINEAR
filtering is what stops it shimmering) and not its neon red/blue palette. The menus use the game's
own locked rooftop-dusk hexes — `#5E3C74` → `#8C476A` → `#FD9146` — the same ones baked into the
portraits they display. Kept from it: dark backdrop, high contrast, and *colour is never the only
indicator* — **P1 draws a SOLID blue frame, P2 a DASHED red one**, each with its own tag, reusing the
solid/dashed vocabulary `render/boxes.ts` already established. Motion is `motion-design`'s Energetic
archetype: 120 ms cursor moves, 40 ms entry stagger, 1.04 selection scale.

## Codex review of the implementation

No blockers, no highs. Six findings, all applied:

- **Medium — the CPU was sampled on ticks that consume no input.** Correctly per-tick, but `tick()`
  early-returns on intro/roundEnd/matchEnd/hitstop *after* the controller had already decremented its
  cooldown and possibly spent an attack. `advance` now gates on a `consumesInput()` predicate that
  mirrors `tick()`'s early returns and sits next to them so the two can't drift. New regression test
  (watched failing without the gate): intro, hitstop and matchEnd batches ask the controller **zero**
  times, a fight batch asks it once per tick.
- **Medium — `scene.start("Match")` could be queued twice.** Both players' flash callbacks land
  ~320 ms after their own lock and both see `bothLocked`; `scene.start` queues rather than stopping
  synchronously. Guarded with a `starting` flag. (Found independently while the review ran.)
- **Medium — `MatchScene.init` did not reset adapter state.** An attack pressed on the match-end
  screen is never consumed (those ticks aren't actionable), so the `EdgeLatch` carried it through
  `Esc → Flow → new match` and fired it on the first actionable tick. `init` now rebuilds the latch
  and clears the DEV hold fields and the prev-key flags.
- **Medium — a hostile/partial `MatchConfig` crashed opaquely.** `{fighters: undefined}` overwrote the
  default and threw a bare TypeError on destructuring; an unknown `mode` silently meant 1v1; an
  unknown difficulty built a controller with `undefined` knobs that only exploded on its first
  decision. Replaced the spread with a field-by-field `sanitizeConfig()` — malformed values fall back,
  well-formed-but-unknown ids still fail loudly in `create()`.
- **Low — Match's DEV globals outlived the scene.** `__world`/`__sprites`/`__stage`/`__holdP1/2` now
  drop on `SHUTDOWN`, like `FlowScene`'s `__flow` already did; otherwise a *stopped* match keeps
  answering while the menu is up.
- **Low — a comment called the RNG an LCG.** It is xorshift32.

Codex confirmed the parts that mattered most: `src/sim/cpu.ts` is genuinely pure and deterministic,
the `tick()` step order is intact, the tween-vs-Clock reasoning is correct (it verified
`TweenManager.getDelta` against `Date.now()` and `Clock.update` against the frame delta in the
installed 4.2.1), FlowScene's teardown leaks nothing, and the production Boot routing has no
regression.

## Gate

| Check | Result |
| --- | --- |
| `npm test` | ✅ 139 passed (9 files) — +17 `flow-state`, +10 `cpu` |
| `npm run typecheck` / `npm run build` | ✅ clean under `noUnusedLocals` |
| `npm run test:e2e` | ✅ 29 passed — 5 new Phase 11 cases |
| `npm run copy:portraits` | ✅ self-test 5/5, three 448×600 PNGs |
| Visual pass | ✅ screenshots of all four steps + a live 1vCPU match reviewed by eye |

**Boot routing note:** `/` now lands on the flow, so the five specs that reached straight for a match
(`atlas`, `camera-juice`, `crouch-block`, `phase09-characters`, `stage`) navigate to the DEV-only
`?scene=match`. Their internal boot waits went 15 s → 30 s: boot now also pulls three portraits, and
with the suite's parallel workers on a cold dev server the *first* test of each file was grazing the
old limit (each file passes alone at ~7 s).

## Not covered

- The flow is **keyboard-only** — no pointer/gamepad. `input.ts`'s `ponytail:` note about rebindable
  bindings now covers the menus too.
- The CPU has one behaviour tree with three parameter sets. It does not read frame data, bait, or
  punish; `hard` is more aggressive, not smarter. Tuning knobs sit at the top of `src/sim/cpu.ts`.
- No sound anywhere in the flow (Phase 13 owns audio).
- The select screen's "nice cards" are judged by eye — there is no metric for it, and the screenshots
  in this log are the evidence, as with every art phase.
