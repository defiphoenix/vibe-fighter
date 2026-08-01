import type { SimEvent, StateName, AttackKey } from "../sim/types";
import type { MatchPhase } from "../sim/match";
import type { FlowState } from "../scenes/flow-state";

/**
 * Which sim event becomes which sound, with what cooldown and what priority.
 *
 * Phaser-free on purpose, like `edge-latch.ts` / `meter-view.ts` / `viewport.ts`: this project tests
 * render logic by MOVING it out of the scene, and a mapping buried in `MatchScene.update()` is a
 * mapping no unit test can reach. `audio-view.ts` is the Phaser adapter that plays what this decides.
 *
 * Nothing here reads a clock or a random: `nowMs` is a parameter for the same reason `src/sim/` bans
 * `Date.now` — the e2e pump has to be able to drive the cooldowns deterministically.
 */

/**
 * The TYPE is derived from the VALUE, never written twice.
 *
 * A TypeScript union does not exist at runtime, so "a test asserts every CueKey has a file" is
 * literally unwritable — an earlier draft of the phase plan promised exactly that test. Deriving the
 * type from the tuple makes them agree by construction and deletes the test that could not have
 * worked.
 */
export const CUE_KEYS = [
  "hitLight", "hitHeavy", "block", "whiff", "jump", "land",
  "ko", "super", "roundStart", "roundEnd", "menuMove", "menuConfirm",
] as const;
export type CueKey = typeof CUE_KEYS[number];

/** Long-form looping beds. Not cues: they are started/stopped by a scene, never fired per frame. */
export const BED_KEYS = ["ambience", "menuMusic"] as const;
export type BedKey = typeof BED_KEYS[number];

/** The ONE list. BootScene queues from it and `scripts/build-audio.py` parses it out of this file,
 *  so a cue cannot exist without a file, nor a file without a cue. */
export const AUDIO_KEYS: readonly string[] = [...CUE_KEYS, ...BED_KEYS];

/** Web path for a cue/bed, relative to the Vite static root (`public/`). */
export const audioPath = (key: string): string => `audio/${key}.mp3`;

/**
 * Should BootScene require the audio assets to be present?
 *
 * NO on a device with no audio at all. Phaser's `load.audio` factory opens with
 * `if (noAudio || (!webAudio && !audioData)) return this;` (loader/filetypes/AudioFile.js), so the
 * file is never queued and the key never reaches `cache.audio`. An unconditional assert would then
 * refuse to boot the whole GAME on a machine whose only fault is having no sound card.
 *
 * Extracted and exported purely so it can be tested on BOTH sides: the 404 spec only ever exercises
 * the `true` branch, so an inverted condition here would ship silently and brick exactly the devices
 * that cannot report it.
 */
export function audioAssetsRequired(d: { noAudio: boolean; webAudio: boolean; audioData: boolean }): boolean {
  return !d.noAudio && (d.webAudio || d.audioData);
}

/** The heavy-weight attacks. Keyed off the attack KEY, never off a damage threshold: the ground heavy
 *  pays the brawler 15 and the monk 14, so `damage > 10` is R-13's shape — an absolute stat compared
 *  across fighters who do not share a scale. The special's per-window hits are heavy; its activation
 *  already fired `super`. */
const HEAVY_ATTACKS = new Set<AttackKey>(["heavy", "airHeavy", "crouchHeavy", "special"]);

/** Minimum gap between two firings of the SAME cue, in ms. Stops a multi-hit special or a fast
 *  flurry machine-gunning one sample into a buzz. Tuned by role, not uniformly: impacts must still
 *  read as separate hits in a combo, a KO or a super happens once. */
const COOLDOWN_MS: Record<CueKey, number> = {
  hitLight: 60, hitHeavy: 60, block: 60, whiff: 90,
  jump: 120, land: 120,
  ko: 800, super: 800, roundStart: 500, roundEnd: 500,
  menuMove: 40, menuConfirm: 120,
};

/** Highest first. Used to pick survivors when a batch overflows MAX_PER_FRAME. */
const PRIORITY: CueKey[] = [
  "ko", "super", "hitHeavy", "hitLight", "block",
  "roundEnd", "roundStart", "land", "jump", "whiff",
  "menuConfirm", "menuMove",
];
const RANK = new Map(PRIORITY.map((k, i) => [k, i]));

/**
 * How many cues one frame may fire.
 *
 * A render frame can drain a MULTI-tick `advance` batch (the e2e pumps 15 ticks at a time, and a slow
 * frame does the same in production), so "one event, one sound" can stack five impacts onto a single
 * instant. Three at once is a hit; five is a click.
 */
const MAX_PER_FRAME = 3;

/** The slice of a fighter this module needs. Deliberately not `Fighter` — that would drag the whole
 *  sim class into a module whose entire point is being cheap to construct in a test. */
export interface FighterAudioView {
  state: StateName;
  grounded: boolean;
}

/**
 * What the sim CONSUMED for this fighter during the advance just drained — `World.consumedInputs[i]`.
 *
 * Load-bearing, not convenience. A render frame can drain up to **15 sim ticks** (`World.advance`
 * clamps a stalled frame to 0.25 s), and the brawler's light attack is exactly
 * `startup 4 + active 3 + recovery 8 = 15` ticks. So a single slow frame can start that attack, run it
 * and return the fighter to `idle` — and a director that only compares end-of-frame STATE sees
 * idle → idle and plays nothing. The whole move, silent.
 *
 * `consumedInputs` is OR-accumulated across every tick of the advance and reset per advance, and the
 * FSM sets `consumed.light` on the same line that calls `startAttack`. So it answers "did an attack
 * begin during this frame" correctly at any batch length, and needs no new sim event to do it.
 */
export interface ConsumedView {
  up: boolean;
  light: boolean;
  heavy: boolean;
  special: boolean;
}

interface Tracked {
  state: StateName;
  grounded: boolean;
}

/**
 * What a frame's audio should do: cues to START, and cues to CUT.
 *
 * `stop` exists for exactly one cue today — the ~3.6 s `super` sting, whose move is 1.5 s long, so it
 * outlives even a super that COMPLETES. Every other cue is a short impact meant to overlap and layer,
 * and none of them is ever cut; see `audio-view.ts` for why only the super is given a retained handle.
 */
export interface CueDecision {
  play: CueKey[];
  stop: CueKey[];
}

export class CueDirector {
  private prev: [Tracked, Tracked] | null = null;
  private lastAt = new Map<CueKey, number>();
  /**
   * Which fighters have a super sting still owed an ending, PER FIGHTER rather than one owner.
   *
   * `world.ts`'s freeze loop runs over BOTH fighters and can push a `special` event for each on the
   * same tick. A single "who fired it" slot keeps only the last, so interrupting that one would cut
   * the single shared sound instance while the other player's super is still going.
   */
  private superWatch: [boolean, boolean] = [false, false];

  /**
   * Decide what this frame should play.
   *
   * `events` must be the SAME array the scene already drained — `drainEvents()` empties the world, so
   * calling it twice would silently give this module an empty batch and the camera the full one.
   */
  fight(
    events: readonly SimEvent[],
    fighters: readonly [FighterAudioView, FighterAudioView],
    consumed: readonly [ConsumedView, ConsumedView],
    phase: MatchPhase,
    nowMs: number,
    interrupted: readonly [boolean, boolean] = [false, false],
  ): CueDecision {
    const want = new Set<CueKey>();
    const firedSuper: Array<0 | 1> = [];

    for (const e of events) {
      switch (e.type) {
        case "hit":
          want.add(HEAVY_ATTACKS.has(e.data?.attack as AttackKey) ? "hitHeavy" : "hitLight");
          break;
        case "block": want.add("block"); break;
        case "ko": want.add("ko"); break;
        case "special":
          want.add("super");
          if (e.player !== undefined) firedSuper.push(e.player);
          break;
        case "roundStart": want.add("roundStart"); break;
        case "roundEnd": want.add("roundEnd"); break;
        default: break; // matchEnd rides roundEnd's cue; it needs no second sound
      }
    }

    // --- cut a super sting whose move stopped happening ------------------------------------------
    //
    // This frame's own `special` events arm their watches FIRST, and that order is load-bearing: one
    // advance can carry both the activation and the interruption (a special whose `freeze` is short
    // enough leaves live ticks in the same batch), and `interruptedSpecials` is per-advance, so that
    // frame is the ONLY one that ever reports it. Arming afterwards would let the watch outlive the
    // report, and the next frame — flag already reset, fighter in `hitstun` — reads as a clean
    // completion. The sting would play out over a super that never came out.
    //
    // Resolving after arming stays correct for the two-super frame, because the loop below keys off
    // `interrupted[i]` per fighter rather than off anything the arming changed.
    //
    // It also means a watch armed on THIS frame would be cut immediately by the `intro` branch below.
    // That is unreachable rather than handled, and the reason is worth writing down because it is
    // incidental: `world.ts` only pushes a `special` event while the phase is `fight`, and the phase
    // cannot reach `intro` until ROUND_END_TICKS (~120) have counted down — far more than the 15 ticks
    // `MAX_FRAME` lets one advance carry. So a `special` event and a `phase === "intro"` reading can
    // never arrive in the same call. If either of those two numbers ever moves, this stops being true
    // and the arming needs to skip the intro branch explicitly.
    for (const p of firedSuper) this.superWatch[p] = true;
    const stop: CueKey[] = [];
    let cut = false;
    if ((phase === "intro" || phase === "matchEnd") && (this.superWatch[0] || this.superWatch[1])) {
      // The match moved on without the sim ever reporting an interruption. Two ways that happens, and
      // neither routes through `applyHit`: a fresh round (the round timer expired, or Enter called
      // `World.restart()`), and a match that is simply over.
      //
      // Checked BEFORE the per-fighter pass below, and that order is load-bearing: a new round stands
      // both fighters up in `idle`, so the "no longer in the move => it finished" test would disarm
      // the watch as a clean completion and this branch would never see it.
      //
      // `roundEnd` is deliberately EXCLUDED, which is the whole reason this is a phase list and not
      // `phase !== "fight"`: a super that scores the KO drives the phase to `roundEnd` while its owner
      // is still in `special`, and cutting there would silence the sting on the one moment it exists
      // for. `matchEnd` is included because it is the terminal phase — a timeout landing mid-super
      // freezes its owner in `special` forever (non-fight phases stop advancing fighter timers), and
      // without this the tail rings over the match-end menu with no `intro` ever coming to clear it.
      cut = true;
      this.superWatch[0] = this.superWatch[1] = false;
    }
    for (let i = 0; i < 2; i++) {
      if (!this.superWatch[i]) continue;
      if (interrupted[i]) {
        // The SIM said so. Never inferred from `state`: a frame can drain 15 ticks, and "the special
        // ended and its owner was hit two ticks later" leaves exactly the same `special` -> `hitstun`
        // trail as a real interruption. Only the tick that applied the hit could tell them apart.
        cut = true;
        this.superWatch[i] = false;
      } else if (fighters[i].state !== "special") {
        // Not interrupted and out of the move => it finished. Disarm, so a hit landing later cannot
        // be read as interrupting a super that is already over.
        this.superWatch[i] = false;
      }
    }
    // ONE shared sound instance, so a still-running super vetoes the cut.
    if (cut && !this.superWatch[0] && !this.superWatch[1]) stop.push("super");
    // A super both STARTED and CUT on one frame never comes out at all, so it must not be played.
    // The adapter stops before it plays (so a super re-fired as another is stuffed is not killed by
    // its own frame), which means leaving it in would stop a sound that has not started — a no-op —
    // and then start the sting for a move that was already over. Same call `world.ts` makes when it
    // refuses to emit `special` for a super stuffed on its first frame (R-9).
    //
    // Dropped from `want` HERE rather than filtered out of `admit`'s result, and that matters:
    // `admit` stamps the cooldown for every cue it returns, so filtering afterwards would burn the
    // super's 800 ms gap on a sound nobody heard and silence the next real one. That is the exact
    // defect `admit` already documents for the per-frame cap.
    if (stop.includes("super")) want.delete("super");

    // --- movement + swing, derived from state transitions rather than events -----------------------
    //
    // Gated on the FIGHT phase, and that gate is load-bearing three times over:
    //
    //  * a fighter KO'd IN THE AIR leaves `grounded: false` behind, and `resetRound()` stands the next
    //    round's fighter up — a phantom `land` at the top of round 2;
    //  * `settleBodies` drops an airborne corpse during the round-end pause — a thud after the KO;
    //  * nothing in the intro pose-set should make a noise.
    //
    // Keying this off the `roundStart` EVENT instead does not work, and it is worth writing down why:
    // `roundStart` is pushed when the intro ENDS (`world.ts`, `introTicks <= 0`), not by
    // `beginRound()`. The positions reset ~90 ticks earlier. Re-seeding on the event would be 90 ticks
    // late and the phantom would still fire.
    //
    // The trackers keep updating outside `fight`, so by the time the fight starts `prev === current`
    // by construction and there is no transition left to misread.
    const prev = this.prev;
    if (phase === "fight") {
      for (let i = 0; i < 2; i++) {
        // The swing whoosh and the jump come from what the sim CONSUMED, not from a state comparison.
        // A state comparison samples once per RENDER frame and a frame can carry 15 sim ticks — long
        // enough for a whole light attack to start and finish unseen. See `ConsumedView`.
        //
        // On startup, NOT on a miss: detecting a real miss means waiting for the move to end, which
        // fires the sound long after the arm moved. An impact layering over a swing is what the genre
        // does. `special` is excluded — its activation is the `super` cue, which is not a whoosh.
        if (consumed[i].light || consumed[i].heavy) want.add("whiff");
        if (consumed[i].up) want.add("jump");
        // Landing has no input to consume, so it stays a transition — and unlike an attack it cannot
        // be missed by batching, because being grounded persists until the fighter leaves the floor.
        if (prev && !prev[i].grounded && fighters[i].grounded) want.add("land");
      }
    }
    // Baseline every frame, INCLUDING the first (when `prev` is null) and every non-fight frame.
    this.prev = [
      { state: fighters[0].state, grounded: fighters[0].grounded },
      { state: fighters[1].state, grounded: fighters[1].grounded },
    ];

    return { play: this.admit(want, nowMs), stop };
  }

  /** A menu cue is stateless — the caller already holds both sides of the transition. Routed through
   *  the same cooldown table so a held key cannot buzz. */
  menu(cue: CueKey | null, nowMs: number): CueKey[] {
    return cue ? this.admit(new Set([cue]), nowMs) : [];
  }

  /** Apply the cooldown, sort by priority, and cap. Cooldowns are stamped only for cues that actually
   *  survive the cap — a cue dropped for being 4th must not block its own next chance. */
  private admit(want: Set<CueKey>, nowMs: number): CueKey[] {
    const ready = [...want]
      .filter((k) => nowMs - (this.lastAt.get(k) ?? -Infinity) >= COOLDOWN_MS[k])
      .sort((a, b) => (RANK.get(a) ?? 99) - (RANK.get(b) ?? 99))
      .slice(0, MAX_PER_FRAME);
    for (const k of ready) this.lastAt.set(k, nowMs);
    return ready;
  }
}

/**
 * Menu navigation → a cue, as a pure function of the two FlowStates around a transition.
 *
 * Pure because `FlowState` already is: the whole select screen is driven by the Phaser-free functions
 * in `scenes/flow-state.ts`, so the sound can be decided the same way the state is.
 */
export function menuCue(before: FlowState, after: FlowState): CueKey | null {
  if (before === after) return null;
  if (after.step !== before.step) return "menuConfirm";
  if (after.locked[0] !== before.locked[0] || after.locked[1] !== before.locked[1]) return "menuConfirm";
  if (after.modeIndex !== before.modeIndex || after.stageIndex !== before.stageIndex) return "menuMove";
  if (after.cursors[0] !== before.cursors[0] || after.cursors[1] !== before.cursors[1]) return "menuMove";
  return null;
}
