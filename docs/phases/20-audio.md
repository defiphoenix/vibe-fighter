# Phase 20 — Game audio

**Status: SHIPPED 2026-07-30** — all gates green, two Codex reviews, two independent QA passes, pushed
to `main` (a production deploy).

Nineteen phases shipped and the game is silent. Every hit, block, KO and super lands with camera shake
and a white flash and no sound at all. This phase adds the last missing sensory channel, and touches
the one asset class the project has never had: `docs/asset-manifest.md` ended with
*"Audio — **Non-goal** for this guide. No audio assets tracked."*

Numbering note: the brief said `19-audio.md`, but 19 is
[`19-mobile-viewport-and-pad-art.md`](19-mobile-viewport-and-pad-art.md). This is Phase 20.

---

## Spec

| # | Deliverable | Where it lives |
|---|---|---|
| 1 | 12 sound cues + 2 long-form beds, all **generated with Higgsfield** | `public/audio/*.mp3` |
| 2 | A Phaser-free decision module: which sim event maps to which cue, with cooldown and priority | [`src/render/audio-cues.ts`](../../src/render/audio-cues.ts) + its test |
| 3 | The Phaser adapter, the only thing that touches `this.sound` | [`src/render/audio-view.ts`](../../src/render/audio-view.ts) |
| 4 | A mute control reachable on desktop **and** touch | same file (`GameAudio` owns its button) |
| 5 | Audio wired into BootScene's refuse-to-route gate | [`src/scenes/BootScene.ts`](../../src/scenes/BootScene.ts) |
| 6 | `media-src 'self'` in the production CSP | [`vercel.json`](../../vercel.json) |

Constraints that shaped every decision below: **`src/sim/` stays pure**, audio never desyncs the
fixed-timestep loop, a failed decode never throws into `update()`, mobile audio unlocks on the first
gesture including a Phase 18 pad touch, and a 404'd sound is a boot failure rather than a silent
nothing.

---

## The cue set

12 cues + 2 beds. **`AUDIO_KEYS` is the one list** — BootScene queues from it and `check:audio` reads
it, so a cue cannot exist without a file or a file without a cue.

| Cue | Fired by | Generated length |
|---|---|---|
| `hitLight` / `hitHeavy` | `hit` event, split on the **attack key** | 2 s |
| `block` | `block` event | 2 s |
| `whiff` | the sim CONSUMING a light/heavy edge (never `special`) | 2 s |
| `jump` / `land` | consumed jump edge / `grounded` false→true | 2 s |
| `ko` | `ko` event | 3 s |
| `super` | `special` event | 3 s |
| `roundStart` / `roundEnd` | those events | 3 s |
| `menuMove` / `menuConfirm` | `FlowState` before/after a state transition | 2 s |
| bed `ambience` | MatchScene, looping | 30 s |
| bed `menuMusic` | FlowScene, looping | 60 s |

### Two semantics that are choices, not accidents

**`whiff` is the swing whoosh, fired on attack STARTUP** — not a retroactive "that move missed".
Detecting a real miss means waiting for the move to end, which fires the sound long after the arm
moved. Layering impact on top of a swing is what fighting games do, and it means the decision needs no
lookahead.

**Light vs heavy comes from the attack KEY, never from a damage threshold.** The ground heavy pays the
brawler 15 and the monk 14. A `damage > 10` test is exactly R-13/R-14's shape — an absolute stat
compared across fighters who do not share a scale. `special`'s per-window hits map to `hitHeavy`; its
activation already fired `super`.

### The one sim change

`resolveCombat` pushed `hit`/`block` with `data: { damage, hitId }` — no attack identity, and by drain
time the attacker's state may have advanced (a 15-tick `advance` batch). Added
**`attack: ATTACK_STATE_TO_KEY[attacker.state]`**, captured beside `spec` in the attacker loop and
carried on `PendingResult`.

`SimEvent.data` is already `Record<string, number | string | boolean>`, so this is no type change, no
new abstraction, and no Phaser/clock/random — `sim/` stays pure.

**Capturing it early rather than re-reading during resolution is load-bearing**, and the review caught
why: an earlier half of a trade can already have called `applyHit()` and flipped that fighter to
`hitstun`, so `attacker.state` read in the resolution loop is not reliably an attack state.

---

## Design

### `audio-cues.ts` — Phaser-free, where the mapping lives

Render logic gets tested by being moved out of the scene; this is that move. It holds the previous
per-fighter `state`/`grounded` so transitions are derived rather than passed in, a per-cue cooldown map
in ms, a priority order (`ko > super > hitHeavy > hitLight > block > roundEnd > roundStart > land >
jump > whiff`), a `MAX_PER_FRAME` cap applied after sorting, and within-frame dedup so a two-fighter
trade yields one `hitHeavy` rather than two.

**`nowMs` is a parameter, never `Date.now()` inside** — the same reason `sim/` bans it: the e2e pump
has to drive the cooldowns deterministically.

**`CueKey` is derived from a `CUE_KEYS` tuple, not written twice.** A TypeScript union cannot be
enumerated at runtime, so the "unit test proves the union and the array agree" this phase originally
planned is unwritable. Derivation makes them agree by construction and deletes the test.

#### Movement cues are gated on `phase === "fight"`

A round transition happens *inside* `world.tick()`, so the render layer cannot hook it — which is why
`CpuSeam` needed an optional `reset()`. This module avoids needing one, but **not** by keying off
`roundStart`: reading `world.ts` rather than assuming, `roundStart` is pushed when the **intro ends**
(`introTicks <= 0`, `world.ts:138`), not by `beginRound()`. Positions reset ~90 ticks earlier at
`resetRound()`, so re-seeding on that event would be 90 ticks late and the bug would still ship.

Two rules instead:

- **the first observation baselines and emits nothing** — MatchScene is a *reused* scene object (it
  resets surviving adapter state in `init()`), so the director is constructed there and its first
  sample can never read as a transition;
- **outside `"fight"`, keep the trackers updated but emit no movement cue** — by the time the fight
  starts, `prev === current` by construction.

That kills three things with one predicate: a fighter KO'd **in the air** leaves `grounded: false`
behind and the next round starts them grounded (a phantom `land` on round 2); `settleBodies` drops an
airborne corpse during the round-end pause (a thud after the KO); and nothing in the intro pose-set can
make a noise. Event-driven cues are unaffected — they only exist when the sim produced them.

#### `menuCue` and the seam it hooks into

A pure function over the Phaser-free `FlowState`: step changed or a lock flipped → `menuConfirm`; a
cursor moved → `menuMove`; identical → `null`.

It dispatches from `rebuildIf(before)`, which every `press()` branch already returns through — one edit
rather than eight, inheriting `press()`'s `if (this.busy) return` so the lock-in flash stays silent.
**`press()` alone is not the whole seam**, though: FlowScene's touch card handler assigns `this.state`
directly on a first tap, so a `press`-only hook would leave first-tap selection silent on exactly the
devices Phase 18 exists for. Both call a shared helper.

### `audio-view.ts` — `GameAudio`, the only thing that touches `this.sound`

- **`play(cue)` is guarded twice**: `cache.audio.exists(key)` and a `try/catch`. A missing or
  undecodable sound is a silent no-op, never an exception inside the game loop.
- **`startBed` defers through `UNLOCKED`.** Phaser installs WebAudio's unlock listeners on
  `document.body` for touchstart/touchend/mousedown/mouseup/keydown, so the Phase 18 pad, the title tap
  Zone and the keyboard all unlock it with no extra wiring — and the rotate overlay cannot interfere,
  because those listeners are on `body`, independent of `game.input.enabled`.
- **`destroy()` is load-bearing, not tidiness.** The SoundManager is game-global, so a deferred bed
  start outlives the scene that armed it: FlowScene can shut down holding a pending
  `once(UNLOCKED, …)` that the next gesture — in MatchScene — fires, starting the **menu bed on top of
  the ambience**. `unlock()` also strips every gesture listener in its `resume()` **rejection** branch
  without setting `unlocked`, so the event may never arrive at all. And `sound.stop()` does not remove
  the instance from the manager's global `sounds` array, so every Esc → Flow → match round trip
  accumulates dead beds. So `destroy()` `off()`s its exact handler, guards a `disposed` flag the
  deferred callback checks, and uses **`manager.remove(bed)`**.
- **Mute is `sound.mute`, which is global** (one SoundManager per game), so it survives every scene
  transition for free. Mirrored to `localStorage`. Bound to **`N`** — `M` is P2's super, and
  `Q E F G , . / Enter Esc R` are taken (`B` and `1-4` are DEV-only and stay off-limits so one key
  cannot mean two things depending on the build).
- `pauseOnBlur` stays at its default `true`: the bed pausing on a tab switch is wanted.

#### Camera and placement

MatchScene runs two cameras, so the button is created **before** the camera block and named in
`cameras.main.ignore([...])` — an object in neither list renders twice, in both renders never, and
`e2e/camera-group.spec.ts` asserts every object's `cameraFilter`. **FlowScene has only one camera** and
its deepest object is at depth 10, so depth alone is sufficient there.

**Bottom-centre is NOT free**, and an earlier draft of this plan said it was. That draft had checked
`touchLayout()`'s pad clusters (`x ∈ [56, 304] ∪ [width−304, width−56]`, rows `y = 480/570/660`) and
nothing else. Bottom-centre in fact holds two existing objects on mutually exclusive paths: the desktop
keyboard legend (`MatchScene.ts:257`) and the touch `⎋ MENU` button (`MatchScene.ts:300`). A 128 px
plate at depth 107 would cover both — and win the hit test, so on a phone it would eat the only way out
of a match. **Measuring the claim against the wrong thing**, which is this repo's own named defect
class, in the phase plan that quotes the rule.

So the anchor is measured against the bounds of every screen-space object in both modes at 1280 and
1696, and pinned by an e2e overlap assertion that fails if any pair intersects.

### The boot gate — read out of the Phaser 4.2.1 source, not assumed

- **`this.load.audio` silently no-ops on a device with no audio at all.** The factory opens with
  `if (audioConfig.noAudio || (!deviceAudio.webAudio && !deviceAudio.audioData)) { return this; }`
  (`loader/filetypes/AudioFile.js`) — the file is never queued, so the key never reaches `cache.audio`,
  and an unconditional assert would **brick the game on a no-audio device**. The audio branch is
  skipped under that same condition, and the predicate is extracted and unit-tested on both sides —
  the 404 case only ever exercises the opposite branch, so a wrong condition would ship silently.
- **A corrupt HTTP-200 file is invisible to `failed[]`.** A `decodeAudioData` rejection calls
  `File.onProcessError` → `loader.fileProcessComplete(file)`, which does not emit `FILE_LOAD_ERROR` and
  does not increment `totalFailed`; those happen only on the transport path `nextFile(file, false)`
  (`LoaderPlugin.js:1056-1064`). The cache check is the only net — exactly the case the existing
  texture check was written for.
- **Queuing in `preload()` rather than `create()` is the stronger choice.** BootScene subscribes
  `FILE_LOAD_ERROR` in `create()`, after the preload pass, so even a plain **404** never reaches
  `failed[]`. That is what makes the mutation "remove the `cache.audio.exists` check" genuinely turn
  the boot-refusal spec red; queued in `create()`, `failed[]` would catch the 404 too and the spec
  would be decoration.
- **Stated limit: the guarantee is WebAudio-shaped.** On a **locked HTML5 fallback**,
  `HTML5AudioFile` sets the element's `src` and calls `onLoad()` *without* `load()`, deferring the real
  fetch to unlock — so `cache.audio.exists(key)` can be true for a 404 there. The gate degrades to
  best-effort on that path. The failure direction is the safe one (boots quiet rather than refusing to
  start), and HTML5 is only reached when WebAudio is absent.

### Bundle and format

**MP3 only, no OGG twin** — shipping both doubles the download for nothing. Stated limit: Phaser skips
a URL whose `canPlayType('audio/mpeg')` is false, so a browser with working audio but no MP3 support
would fail the boot gate rather than play quietly. MP3 has been patent-free and universal since ~2017;
accepted, not overlooked.

**Budget 1.2 MB at 96 kbps stereo beds.** The approved option said 128 kbps, which the plan review
caught as arithmetically impossible: 90 s × 128 kbps = **1.44 MB of beds alone**, before a single SFX.
The label and the body of that option contradicted each other and nobody multiplied. Corrected: 30 s +
60 s at 96 kbps ≈ 1.08 MB, plus ~9 s of trimmed SFX at 64 kbps mono ≈ 72 KB, **≈ 1.15 MB**.
`check:audio` enforces the total as a hard byte budget.

Context for the number: `public/` is already **19 MB** (sprites 8.5, backgrounds 7.6), so this is about
+6%, not the tripling audio usually is.

### Provenance

Higgsfield **CLI**. The plan said `mirelo_text_to_audio` for SFX; what shipped is **`seed_audio`** —
see the measurement below. `sonilo_music` for the menu bed, as planned. Same discipline as Phases 03–07 (`X.prompt.txt` + `X.job.json` beside the master;
redirect stdout only; drive from bash, never Python `subprocess`).

Not the MCP `generate_audio` tool: its own description says it "only generates speech", declines
general SFX/music, and it emits no `.job.json` to commit.

Preflighted with `higgsfield generate cost`, which creates no job: mirelo **0.25 cr/s**, sonilo
**0.0625 cr/s**.

Planned 18.25 credits on mirelo pricing. **Actually spent: 25.35** (850.00 → 824.65), inside the
40-credit ceiling.

**`higgsfield generate cost` under-reports these audio models by roughly 6×.** It quoted 0.2 credits
for a `seed_audio` job; 17 jobs cost 25.35, i.e. ~1.5 each. The preflight is not usable for budgeting
audio — recorded in `docs/art-pipeline.md` so the next phase does not plan against it.

---

## Codex review of the plan — 1 blocker, 4 high, 3 medium

Run read-only with the plan text **inlined** (the plan file lives outside the workspace root, where
Codex hangs silently on a path — a Phase 18 lesson). Every finding was re-derived against the source
before being acted on.

| # | Sev | Finding | Response |
|---|---|---|---|
| 1 | **BLOCKER** | The 1.2 MB ceiling is arithmetically impossible: 90 s of beds at 128 kbps is 1.44 MB before a single SFX | Real. Beds dropped to 96 kbps → ≈1.15 MB total, enforced by `check:audio` |
| 2 | HIGH | A **locked HTML5** fallback caches a 404 as loaded — `src` set, `onLoad()` called without `load()` | Real, and the HTML5 path had not been looked at. Guarantee restated as WebAudio + unlocked-HTML5, degradation named rather than engineered around |
| 3 | HIGH | Deferred bed starts outlive their scene, and `stop()` leaks the instance in the manager's global array | Real. Added `destroy()` with handler `off()`, a `disposed` flag and `manager.remove()` |
| 4 | HIGH | `CueDirector`'s retained transition state is unsafe across scene re-entry and round resets | Half already found independently (the 90-tick `roundStart` lag). Codex added the re-entry axis: MatchScene is reused. Director constructs in `init()`; first sample baselines |
| 5 | HIGH | "Bottom-centre is empty" is false — legend and `⎋ MENU` both live there; at depth 107 the plate wins the hit test and eats the only way out of a match on a phone | Real, and the worst one. Anchor is now measured and pinned by an overlap assertion |
| 6 | MEDIUM | Flow's touch card handler bypasses the `press()` cue seam | Real — first-tap selection would be silent on touch. Shared helper |
| 7 | MEDIUM | The no-audio exemption is source-correct but only its opposite branch was going to be tested | Real. Predicate extracted and unit-tested both ways |
| 8 | MEDIUM | Four Playwright cases could pass vacuously | All four tightened (see the acceptance list) |
| — | Note | A TS union cannot be enumerated at runtime | Right — `CueKey` derived from `CUE_KEYS`, one decoration test deleted |

**Confirmed correct, no change:** the WebAudio decode-failure path; `masterMuteNode`; global mute
surviving `scene.start`; preload-then-check ordering; capturing the attack key on `PendingResult`; the
CSP analysis; `audio.objects` belonging only in `cameras.main.ignore`.

The review's closing note stands as the real gate: **every "expected RED" is an intention until
observed.**

---

## Acceptance criteria

- [x] `npm run build`, `npm test`, `npm run test:e2e` green, output shown — 383 unit, 124 browser
- [x] A spec asserts BootScene refuses to route when an audio asset 404s — naming the intercepted key,
      and asserting the route actually fired
- [x] A spec drives a match and asserts cues were requested for a landed hit, a block and a KO, read
      off a DEV seam, asserting a real value (`typeof === "number"`), never `undefined === undefined`
- [x] Muting silences everything, verified via `masterMuteNode.gain` **and** a play count that rose
      while muted, **and** that a non-bed cue is still playing (so the silence is the gain, not a stop)
- [x] The mute control overlaps nothing at 1280 / 1696, touch and desktop
- [x] `npm run preview` serves the production CSP and audio still plays — 14/14 responses 200
- [x] Every committed audio file has a provenance row in `docs/asset-manifest.md`
- [x] Added bundle KB stated below — 1045 KB
- [x] Each new test watched FAIL before being kept — 20 mutations, six of which exposed a decoration
      test rather than the code

---

## Gate log — measured, not claimed

```
$ npm run build            ✓ tsc --noEmit && vite build, 5.16s
$ npm test                 21 files, 383 tests passed
$ npm run check:audio      14/14 in the peak window, worst-case mix -1.8 dBFS, 1045 KB of 1200, exit 0
$ python scripts/build-audio.py --selftest    OK
$ npx playwright test      124 passed, 0 failed   (was 112 before this phase)
$ npm run preview          CSP served with `media-src 'self'`; 14/14 audio responses 200; 0 console errors
```

**Added bundle weight: 1045 KB** across 14 MP3s. `public/` was 19 MB before (sprites 8.5, backgrounds
7.6), so this is about **+5%** of the download rather than the tripling audio usually is. MP3 only — no
OGG twin, which would double it for browsers that do not need it.

### Per-cue measurements

Reported per cue rather than summarised, because **listening was impossible** and these numbers are the
only evidence there is. `crest` is peak-minus-RMS: a percussive hit should be high, a bed low.

| key | duration | peak | crest | KB |
|---|---|---|---|---|
| `hitLight` | 0.50 s | −2.5 dBFS | 13.7 dB | 5 |
| `hitHeavy` | 0.60 s | −2.2 dBFS | 10.9 dB | 5 |
| `block` | 0.50 s | −2.6 dBFS | 13.6 dB | 5 |
| `whiff` | 0.50 s | −2.4 dBFS | 15.0 dB | 5 |
| `jump` | 0.60 s | −2.6 dBFS | 22.4 dB | 5 |
| `land` | 0.80 s | −2.4 dBFS | 16.9 dB | 7 |
| `ko` | 2.20 s | −2.3 dBFS | 12.2 dB | 18 |
| `super` | 3.60 s | −1.8 dBFS | 12.3 dB | 29 |
| `roundStart` | 0.73 s | −2.1 dBFS | 17.0 dB | 6 |
| `roundEnd` | 1.53 s | −2.0 dBFS | 18.4 dB | 12 |
| `menuMove` | 0.35 s | −2.4 dBFS | 13.0 dB | 3 |
| `menuConfirm` | 0.80 s | −2.4 dBFS | 15.9 dB | 7 |
| `ambience` | 30.04 s | −2.4 dBFS | 13.6 dB | 235 |
| `menuMusic` | 60.02 s | −1.9 dBFS | 13.0 dB | 704 |

**What could not be verified, stated rather than buried:** whether each cue *sounds like* the thing it
is named after. Duration, peak, crest and transient count are all in range, and none of them can tell a
punch from a door slam. This is the audio analogue of `crouchHeavy` shipping a chest-height punch for
two phases under a prompt that said "low sweeping attack".

### The model choice was measured, not assumed

The approved plan named `mirelo_text_to_audio` — the model whose display name is literally "Mirelo Text
to Audio". One 0.5-credit probe on the `hitLight` prompt killed it:

| | `mirelo_text_to_audio` | `seed_audio` |
|---|---|---|
| peak | **−29.0 dBFS** | −4.3 dBFS |
| crest factor | **12.9 dB** | 21.1 dB |
| envelope | flat −39..−51 dB throughout | silence → burst → decay → silence |
| verdict | noise, no transient | three usable takes of a punch |

Mirelo returned a *flat noise floor* for a punch. The roster was generated on `seed_audio` instead.
Probing one cue before the batch is what made that a 0.5-credit mistake rather than a 20-credit one.

### Three defects the gates caught on their own first runs

1. **Every shipped file pinned at 0.0 dBFS.** The peak gate flagged all thirteen immediately. The
   obvious hypothesis was MP3 encoder overshoot; a target sweep disproved it (real overshoot ±0.25 dB).
   The cause was **the instrument**: `decode()` used `s16le`, which CLAMPS, and the masters are HOT —
   `hitHeavy-raw.mp3` measures **+2.00 dBFS**. Read through a clamping decode it reported 0.0, so the
   normaliser under-corrected by exactly the amount the file was over. Now `f32le`.
2. **`menuMove` came back as silence** — −37.9 dBFS peak, 15.0 dB crest, unrecoverable by
   normalisation (which would only have lifted its noise floor). Prompt rewritten, retake measured
   −6.6 dBFS / 21.5 dB. The rejected take's job record is kept as `menuMove.rejected-take-1.job.json`.
3. **A KO clipped** — see the diff review below.

### Every new test was watched failing

Twenty mutations, each applied, run, and reverted.

| Mutation | Result |
|---|---|
| cooldown map zeroed | **RED** same-cue-inside-the-gap |
| `hitLight`/`hitHeavy` collapsed to one cue | **RED** attack-key split |
| `special` no longer excluded from `whiff` | **RED** whiff-on-special |
| priority sort removed | **RED** ko-beats-hit cap |
| cooldown stamped before the cap rather than after | **RED** dropped-cue-keeps-its-turn |
| `phase === "fight"` gate dropped | **RED** phantom-`land`-after-an-airborne-KO |
| first observation treated as a transition | **RED** scene re-entry |
| `audioAssetsRequired` inverted | **RED** its own both-sides case |
| `menuCue` reports a step change as a move | **RED** confirm case |
| `whiff` back to a state comparison | **RED** whole-attack-inside-one-frame |
| BootScene's `cache.audio.exists` check removed | **RED** 404 boot refusal |
| both guards removed from `play()` | **RED** missing-cue-must-not-throw |
| `setMuted` stops writing `sound.mute` | **RED** mute-silences-the-graph |
| in-memory mute fallback removed | **RED** dead-`localStorage` |
| `loadMuted` ignores the memo | **RED** dead-`localStorage` |
| `destroy()` downgraded to `bed.stop()` | **RED** bed leak |
| FlowScene's `audio.menu(...)` call deleted | **RED** menu-makes-a-sound |
| `CUE_VOLUME` raised to 0.8 / 1.0 | **RED** clipping gate (+1.8 / +3.6 dBFS) |
| button moved back to bottom-centre | **RED** overlap cases |
| audio fed an empty batch rather than the drained one | **RED** cue-request case |

**Six of these were GREEN the first time**, and in every case the test was fixed rather than the table.

### Tests that were decoration until they were rewritten

- **The bed-leak case never started a bed.** It ran without a gesture, so the context was locked, no
  bed existed, and nothing could leak — `destroy()` downgraded to `stop()` stayed green. It now unlocks
  first and asserts a bed is actually playing before measuring.
- **The lifecycle case never changed scene.** It called `game.scene.start(...)` on the *global*
  manager, which starts the target without stopping the current one — both scenes stayed live, no
  SHUTDOWN fired, and the teardown it claimed to exercise never ran. It goes through the scene plugin
  now, as the game does.
- **"survives a scene change and a reload" only reloaded.** Its second `ready()` was a `page.goto`.
- **"sound is still playing while muted" was satisfied by the looping bed**, which plays either way. It
  counts non-bed sounds now.
- **The clipping gate checked its own copy of the volume.** `CUE_VOLUME` was duplicated in
  `build-audio.py`, so raising it in the TypeScript left the gate green — R-14's exact shape, inside
  the gate written to prevent that class. It parses the value out of `audio-view.ts` now.
- **The `localStorage` fallback had no test** until one was written that actually breaks storage with
  `addInitScript`, and asserts it is broken before relying on the assertion.

### One guard was deleted, then restored, and the round trip is the lesson

`play()`'s `cache.audio.exists` check would not go red. Probes said playing an uncached key through
Phaser was a complete no-op: no throw, no warning, no counter, no leaked Sound. So it was deleted as
unfalsifiable insurance, per Phase 19's rule.

That was wrong, and one more mutation caught it. Removing the `try/catch` **as well** turned the spec
red with `Error: Audio key "ko" not found in cache`. **Phaser throws.** Every earlier probe had run
with the catch still in place, so the exception was swallowed before the probe could observe it —
**measuring a guard from behind the guard tells you nothing.** Both guards are back: `exists` as the
cheap path (a cue whose file vanished fires as often as its event does, and building 60 exceptions a
second to discard them is a poor way to be quiet), the `catch` as the net for what `exists` cannot see.

Stated limit: `plays` counting *successful* plays rather than requests cannot be proven from outside —
both spellings return zero for a missing cue, because neither reaches the counter.

---

## Codex review of the diff — 1 HIGH, 8 MEDIUM, 4 LOW, every one real

Run read-only against the working tree. Every finding was re-derived and measured before being acted
on; none was applied blind. Nothing was dismissed.

### HIGH — a KO clipped, measurably

A KO fires `hitHeavy` + `ko` + `roundEnd` on the **same frame** (the hit lands, the defender dies, the
round ends). Cues ship near −2 dBFS and were played at full volume. Summing the three actual shipped
files: **+3.9 dBFS** — past the destination ceiling, i.e. audible distortion on the single moment the
game most wants to sound good. Reproduced independently before fixing.

Fixed by playing cues at `CUE_VOLUME = 0.5`, which puts the same stack at **−1.8 dBFS** with the bed
underneath. The measurement is now a **hard gate**: `check:audio` recomputes that worst case from the
shipped files and the volume it parses out of `audio-view.ts`, so the number cannot quietly stop being
enough when a cue is regenerated louder.

### MEDIUM — a whole attack could fit inside one render frame, silently

`World.advance` clamps a stalled frame to 0.25 s = **15 sim ticks**, and the brawler's light attack is
exactly `4 + 3 + 8 = 15` ticks. So one slow frame can start the move, run it, and return the fighter to
`idle` — and a director comparing only end-of-frame STATE sees idle → idle and plays nothing at all.

Fixed by deriving `whiff` and `jump` from **`World.consumedInputs`**, the sim's own record of what it
acted on, OR-accumulated across every tick of the advance. Correct at any batch length, and it needed
no new sim event. `land` stays a transition, because being grounded persists and cannot be missed.

### MEDIUM — the "loop crossfade" was a hole

A 1.5 s fade-in + fade-out pair was applied to the music bed to smooth its 6.9 dB loop seam. On a
*single* stream that is not a crossfade — with nothing to overlap, it just drives both ends to silence.
Measured on the shipped file: head **−47.4 dB**, tail **−52.7 dB**, against −16.2 dB mid-track. A ~35 dB
hole every loop, in the name of fixing a 6.9 dB step. Removed; the untouched seam is the better of the
two, and a real `acrossfade` is not worth shortening the loop for 6.9 dB.

### MEDIUM — the super's charge was being cut off

`first_event()` trimmed from the first window within 12 dB of the peak — the RELEASE. `super` is the
one cue with a wind-up by prompt, and its charge sits below that line: a steady −20..−13 dB region runs
from 9.0 s into the −8 dB burst at 11.5 s, while the trim began at **10.77 s**. Fixed with a capped
backward walk. The first attempt at that fix collapsed `super` to **0.13 s**, because the decay end was
then computed from the extended start; release and lead-in are now separate indices, with a fixture on
the wind-up shape that the old 8 dB-separated fixture could not have caught.

### MEDIUM — the regeneration script could not regenerate

`gen-audio.sh` skipped whenever the *job record* existed, never downloaded `result_url`, and omitted
the music bed. On a fresh clone every record exists and every master is gitignored — so it would have
regenerated nothing, fetched nothing, and `build-audio.py` would have refused. Rewritten: the skip is
keyed on the master, an existing record is **reused** (`generate get <id>` restores a URL for free
rather than re-billing), and both beds are included.

### MEDIUM — mute reverted itself when storage was unavailable

`GameAudio` is per-scene, the setting is per-game, and `localStorage` carried the handover. In
private-mode Safari `setItem` throws; the failure was swallowed, so the next scene's `GameAudio` read
`false` and wrote it to the game-global manager. The sound came back on its own after being turned off
deliberately. Fixed with a module-level in-memory intent, written *before* the storage attempt.

### MEDIUM ×2 — two browser cases proved nothing (bed leak, lifecycle) and one had no coverage (menu cues)

All three addressed above under "tests that were decoration".

### LOW — parser and gate gaps

The key regex silently dropped keys containing digits/underscores/hyphens while keeping their
neighbours (a gate checking a subset while reporting success); the check walked only *declared* keys,
so an abandoned MP3 could ship forever, invisible to the byte budget. Both fixed — stray files are now
flagged.

### Confirmed correct by the review, unchanged

Sim purity and the `attackOf()` narrowing; the boot-gate predicate against Phaser's own loader
condition; scene-lifecycle teardown ordering; the camera lists; the flag/mechanism split for mute; and
the CSP change.

## Independent QA — two passes, both agent-written, neither given the plan or the diff

Both were handed the acceptance criteria and the harness rules and nothing else, deliberately: Phase 19's
QA pass found a defect the committed suite could not see precisely *because* it wrote its own cases.
Between them, 52 cases, all green, all seven criteria PASS. The second pass exists because the first ran
in a context window already ~70% consumed, so its judgement may have been degraded and its coverage
shallower than it read — and a re-run was cheap next to shipping on a tired verdict.

Neither pass found a product defect. That is a weak result on its own, so what matters is **what the
second pass measured that nothing else had**:

- **The shipped files actually decode.** The first pass proved 14 assets exist and are non-empty over
  HTTP — which a 14-byte file would also satisfy. The second ran every one through a real
  `AudioContext.decodeAudioData` in-browser and sampled the PCM for non-silence. All 14 decode, all 14
  carry signal. Still no claim about whether a cue *sounds* like its name.
- **Determinism was measured rather than assumed.** "Audio must not desync the sim" had never been
  tested; "no `pageerror` was thrown" does not prove it. An identical scripted match was driven twice,
  muted vs genuinely unlocked, including a frame firing `hit` + `ko` + `roundEnd` together, with full
  fighter/match state diffed at four checkpoints. Bit-identical. It is guaranteed by construction —
  `audio.fight()` runs strictly after `world.advance()` and never touches `world` — but construction
  arguments are what this project keeps catching itself trusting.
- **The no-audio-hardware branch was forced by a real fixture for the first time.** `AudioContext`,
  `webkitAudioContext` and `Audio` were removed before boot, the fixture verified as landed
  (`device.audio.webAudio === false && audioData === false`), and the game still boots and plays. That
  branch of `audioAssetsRequired()` had only unit coverage; an inverted condition bricks every no-audio
  device and nothing else would go red.
- **Mute under adversarial states** — mid-super-freeze, behind the end-menu scrim, under the armed quit
  prompt. It toggles, and the tap does not fall through to what is drawn beneath it. Each case asserts
  its precondition was actually reached first, which is what caught two of its own fixture bugs.

### The two notes they raised, and why neither is a Phase 20 defect

**One-shot cue cleanup is coupled to the render loop.** `WebAudioSound`'s `source.onended` only sets a
flag; nothing converts that into `COMPLETE` — which drives the self-destroy — until the SoundManager's
per-step update runs. Measured live: three real seconds with zero frames pumped left four instances
alive; one 5-frame pump collapsed them to one (the bed). Bounded by the cues in flight, self-healing on
the next processed tick, invisible in continuous play. Real mechanism, no action.

**A hanging asset request hangs boot forever** — no loader timeout is configured. Re-derived rather than
accepted: `loader.timeout` is set nowhere, and `BootScene` queues audio through the *same* `this.load.*`
pass as the registry JSON, both atlases, the stage layers, every spritesheet and every portrait. So this
is a property every asset class has had since Phase 02, not something audio introduced. The QA agent
framed it as an audio-adjacent gap; it is not audio-specific at all. Recorded, not fixed — out of scope,
and the failure direction (title screen waits) is the safe one.

### Their own fixture bugs, named as such

Six across the two passes, every one in the harness rather than the product — worth listing because "QA
found nothing" and "QA's harness was broken" look identical in a summary. The sharpest: a determinism
draft used the harness `press()` helper to make an unlock gesture in only one of the two branches, and
`press()` pumps 8 frames as a side effect — so it read an 8-tick divergence in `timerTicks` that had
nothing to do with audio. Fixed by dispatching a raw `keydown` on `document.body` (the target Phaser's
own unlock listeners use), which unlocks without ticking the loop. Others: a `FlowState` field name typo;
an unlock poll that never pumped a frame, so Phaser could never consume the transition; a super pressed
before the intro ended and silently gated; a missing `match.wins` so the end menu never appeared; and a
flat 3 s wait that undershot `super.mp3`'s real 3.6 s.

Both QA specs (`e2e/qa20-audio.spec.ts`, 40 cases; `e2e/qa20b-audio-deep.spec.ts`, 12) are deliberately
**not committed**: agent-written, never mutation-tested, ~5 minutes of suite time for coverage that
largely overlaps the committed 13. What they proved is recorded here, which is the durable half.
