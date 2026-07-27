# Animation / box defect pass (post-Phase-15)

Four defects a player found by PLAYING, with the whole suite green. Every one is an instance of the
class CLAUDE.md names "measure the claim against the thing it claims about" — the existing metrics
either compared code to other code, or were direction-blind.

Plan reviewed by Codex before implementation; diff reviewed after. Findings and dispositions at the
end.

---

## D1 — `blockCrouch` read as not moving / wrong

**Not** the loop flag (`loop:true` on all three, correct) and **not** the frame rate (authored
`fps:8`, deliberately not derived — a held loop has no sim length to match). The art.

| | amplitude | IoU vs own `crouch` | |
|---|---|---|---|
| monk/blockCrouch | 0.049 → **0.150** | 0.95 → **0.75** | pose AND motion fixed |
| jiujitsu/blockCrouch | 0.065 → **0.225** | 0.57 | motion fixed |
| brawler/blockCrouch | 0.12 (untouched) | 0.61 | was always fine |

Two different causes wearing one symptom, both in `scripts/gen-sprite-videos.sh`:

- **monk** had no distinguishable low guard at all — his crouch and crouch-block were the same
  silhouette. His `START_OVERRIDE` was `crouch-refs/monk-crouch.png`, *the very reference his `crouch`
  sheet is generated from*, plus a prompt saying "holds **exactly** the pose of the start image". A
  95% match was precisely what was ordered.
- **jiujitsu**'s pose was always fine; the sheet was four identical frames. Its prompt asked for
  breathing and then negated motion four times in one sentence. The model maximised the stillness.

**The lesson, re-learned at credit cost: the reference is the lever, not the wording.** A prompt
rewrite that named the arm change explicitly was generated and measured — IoU stayed at 0.95, amp at
0.049, *completely unchanged*. What fixed it was building a purpose-made low-guard reference first
(`guard-refs/monk-blockCrouch-v2.png`, nano_banana_pro from `monk-crouch.png` with the legs/hips/
height held and only the arms replaced; measured 1558px against the crouch reference's 1557px on the
same canvas). CLAUDE.md already said `--start-image` dominates. It was right.

**Second lesson: use the wording that measured best, do not reason about what should work.** Four
monk attempts measured 0.049 / 0.049 / 0.055 / 0.029. Copying the jiujitsu motion sentence *verbatim*
gave 0.150. The attempt that swapped its weight-shift for hip-rocking — which seemed better suited to
a deep squat, since both heels are planted — was the worst of the four. Every "better" rewrite
invented from first principles made things worse.

## D2 — "all move animations play too fast"

Traced live in the browser. **The arithmetic and the play-config override are both correct**;
`globalTimeScale` and per-sprite `timeScale` are never set anywhere. `brawler/attackLight` scheduled
durations of 16.33ms (wind-up) and 67ms (strike), and the observed dwell was exactly 1 and 4 render
frames; total 15 ticks = the move; the contact frame appeared at `stateFrame 4`, exactly when the hit
box goes live.

So the complaint was real but the cause was the **frame budget**, not the clock: three wind-up poses
were sharing three ticks, i.e. **one refresh each at 60Hz**.

Three outcomes:

- **D2-a — a combo's 2nd+ hit never restarted the hurt animation.** `applyHit` resets `stateFrame`
  and `stunTimer` even when already in `hitstun`, but the state NAME does not change, and
  `FighterSprite.update` re-played only on a state change. The defender sat on the last frame of the
  one-shot hurt sheet for the rest of the combo. Fixed with `Fighter.stunEpoch`, a monotonic episode
  id. `stunTimer` rising is NOT a usable substitute — a multi-tick advance batch can decrement it and
  a re-hit restore it to exactly the previously observed value. Same lesson as the combo counter:
  identity needs its own counter. Watched failing in the browser first (`Expected: < 4, Received: 4`).
- **D2-b — NOT a defect.** A review flagged `knockdown` entering the renderer with 17 ticks where the
  attack assigned 18, and proposed restoring the 18. Re-derived against the live sim: it is 17 because
  `onLand` fires inside `integrate` (world.ts:169) which precedes `advanceTimers` (world.ts:210) with
  no hitstop to bail on — **and the state also lasts exactly 17 more ticks**, so 17 is correct and a
  +1 would overrun the state and be cut at its exit. Comment corrected, contract pinned as R-12
  (hitstun 12/12/12, blockstun 9/9/9, knockdown 18→17 seen/17 lasted). Finding real, diagnosis wrong.
- **The "too fast" itself** — a minimum-dwell rule in `anim-timing.ts`. Phase alignment fixes the
  wind-up budget at `startup - 1` ticks, so a pose cannot be given more time without delaying the
  contact frame; the only honest lever is to draw FEWER poses. `attackStartFrame` / `stunStartFrame`
  skip the poses the window cannot afford. Two floors, chosen by looking at the result:

  | | floor | why |
  |---|---|---|
  | attack wind-ups | 2 ticks | anticipation the player reads; only rescue the sub-perceptual. Fixes brawler/attackLight (3 poses @ 1.0t → 1 @ 3.0t) and brawler/crouchLight (2 @ 1.5t → 1 @ 3.0t) |
  | stuns | 3 ticks | a pose you are PUT INTO; the lead-in is dead weight. blockstun 4 poses → 3 @ 3.0t (snaps straight to the braced guard), knockdown 6 → 5 @ 3.4t (reaches its fall sooner) |

  At floor 3 everywhere, `jiujitsu/attackLight` (2 poses @ 2.0t) and `monk/airLight` (2 @ 2.5) collapsed
  to a single held pose despite being perfectly readable. Hence two constants, not one.

## D3 — attack boxes sat too far from the drawn animation

Measured with `forward_reach` (difference each frame against frame 0, take the furthest-forward MOVED
column — the furthest opaque column measures a planted leg). **All 21 attack sheets** overshot their
own drawn limb by 28–106px; at the furthest range each attack still connected, the fist was 14–92px
short of the defender's drawn body.

Tolerance set at **60px of visible air**. Six sheets failed; five were closed by coordinated `hit.w`
trims that keep the existing parity rule passing unchanged, and one needed art.

| sheet | `hit.w` | effective reach | |
|---|---|---|---|
| brawler/attackHeavy | 110 → 105 | 127 → 122 | paired with monk |
| monk/attackHeavy | 112 → 107 | 127 → 122 | tied-best |
| brawler/crouchHeavy | 100 → 95 | 118 → 113 | monk stays 118 |
| brawler/special | 105 → 94 | 117 → 106 | |
| monk/special | 110 → 100 | 120 → 110 | best |
| monk/airLight | 70 → **72** | 80 → 82 | closes a parity hole |
| monk/airHeavy | 90 → **92** | 105 → 107 | closes a parity hole |

`hit.x` unchanged and **`hit.y`/`hit.h` never touched** — they encode high/low.

**`reach-parity.test.ts` was not rewritten.** No balance target changed; moves got 3–11px shorter and
the monk stays tied-best on every attack. It *was* extended: it only ever covered the four ground
attacks, and the monk was measurably out-ranged on both AIR normals (80 vs 82, 105 vs 107) — the exact
thing the file exists to prevent. Watched failing on those real numbers before the +2 landed. It also
now picks the pushbox from the attack's own `body` rather than guessing from the attack's name, which
is how the air gap surfaced.

Also corrected: the identical `crouchLight`/`crouchHeavy` reach (74/74/74, 118/118/118) is **not**
copy-paste, as first suspected — the monk carries +8px of extra width on both to offset his +16px
wider `pushCrouch`, landing exactly on parity. Deliberate compensation.

## D4 — roster audit, and the gaps in the audit itself

Three measurement gaps let all of the above ship green. All three closed:

- **Nothing measured the HORIZONTAL box-vs-art gap.** `audit-boxes.py` checked hurt height and the
  vertical hit band only. Added metric C (`strike_reach` + the air-gap figure + a `REACH-GAP` flag),
  with two new fixtures — including the planted-leg trap, where a static leg reaching 60px further
  forward than the arm must not be reported as the strike.
- **`MOTION_MIN` was applied only to ATTACK states**, so a held looping guard was never checked at
  all — which is exactly why D1's 0.05/0.06 passed. Added `HELD-FROZEN` at a lower floor (0.10);
  brawler sits at 0.12 and reads fine, the other two did not, so the line goes between them.
- **The `art/sim` ratio was 1.00 BY CONSTRUCTION** for every derived state — the renderer derives its
  rate from the sim duration, so re-deriving it in the audit only compared the formula with itself.
  Code checked against code, inside the audit. Replaced with a `drawn` column reporting the poses
  actually DRAWN and the ticks the SHORTEST-lived of them gets — information the ratio never carried.
  `brawler/attackLight` scored a perfect 1.00 while flashing three poses at one refresh each.

  **That replacement column then shipped wrong on its first writing, and the diff review caught it.**
  It duplicates a TypeScript rule in another language, so it can drift silently, and it did in two
  ways: `knockdown` was modelled at the 18 ticks `onLand` assigns rather than the 17 the renderer is
  actually handed (reporting 6 poses where 5 are drawn), and an attack printed its total pose count
  beside its WIND-UP dwell, so the two numbers described different halves of the animation. Both
  fixed; the dwell is now the minimum across drawn poses, and `drawn_poses` has selftest fixtures
  pinning exactly those two drifts — which it should have had from the start, since this file's own
  docstring says a wrong metric is more dangerous than no metric.

### Final state

| gate | before | after |
|---|---|---|
| `audit:boxes` REACH-GAP | 6 | **1** (monk/crouchHeavy) |
| `audit:anim` flagged | 18 | **16**, no HELD-FROZEN |
| `check:sync` indeterminate | 6 | **5** |
| unit / e2e | 276 / 65 | **283 / 65** |

### Open, deliberately

> **`monk/crouchHeavy` is the next session's first job.** The `OPEN WORK` blockquote in CLAUDE.md
> carries the full context; the short version and everything already tried is below, so no one
> re-buys it.


- **`monk/crouchHeavy`, ~87px of air** (was 92). Five generations measured limb reach 50/61/57/55/60 —
  mean ~56, sd ~4.6, i.e. run-to-run variance swamped every prompt change. The sample kept is the one
  with a MEASURABLE contact frame (spread 9px clears the 8px floor), because phase alignment is worth
  more than 5px of reach; it is the first time this sheet has ever had one. Closing the last 27px by
  trimming the box would drop the monk from 118 to 91 effective reach — worst on the move — and turn
  the parity test red, so it needs art, not data.
- **5 INDETERMINATE sheets** (`monk/airHeavy` spread 2px, `brawler/airLight` 3px, `jiujitsu/airLight`
  4px, `monk/attackLight` 6px, `jiujitsu/crouchHeavy` contact-on-final-frame). All within the 60px air
  tolerance, so they keep uniform timing rather than costing a regeneration.
- **`jiujitsu/crouch` stands upright for its first 167ms** (heights 100/100/79/68) while the sim's
  crouch box drops instantly.
