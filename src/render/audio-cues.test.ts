import { describe, it, expect } from "vitest";
import {
  AUDIO_KEYS, BED_KEYS, CUE_KEYS, CueDirector, audioAssetsRequired, audioPath, menuCue,
} from "./audio-cues";
import type { ConsumedView, CueKey, FighterAudioView } from "./audio-cues";
import type { SimEvent, StateName } from "../sim/types";
import type { MatchPhase } from "../sim/match";
import { initialFlow, moveMenu, advance, moveChar, lock } from "../scenes/flow-state";

const F = (state: StateName, grounded = true): FighterAudioView => ({ state, grounded });
const IDLE: [FighterAudioView, FighterAudioView] = [F("idle"), F("idle")];

/** What the sim consumed this advance. `c(0, {light: true})` = P1 started a light. */
const NOTHING: ConsumedView = { up: false, light: false, heavy: false, special: false };
const NONE: [ConsumedView, ConsumedView] = [NOTHING, NOTHING];
const c = (who: 0 | 1, v: Partial<ConsumedView>): [ConsumedView, ConsumedView] => {
  const out: [ConsumedView, ConsumedView] = [{ ...NOTHING }, { ...NOTHING }];
  Object.assign(out[who], v);
  return out;
};

const hit = (attack: string): SimEvent =>
  ({ type: "hit", player: 1, data: { damage: 9, hitId: 0, attack } });

/** Drive the director, with the first call absorbed as the baseline the real scene also spends. */
function seeded(phase: MatchPhase = "fight") {
  const d = new CueDirector();
  played(d, [], IDLE, NONE, phase, 0);
  return d;
}

/** `fight()` reports what to PLAY and what to CUT. Everything below this line predates the cut and
 *  asserts only on the played cues; the cut has its own suite at the bottom of the file. */
const played = (d: CueDirector, ...a: Parameters<CueDirector["fight"]>): CueKey[] => d.fight(...a).play;

describe("cue keys", () => {
  it("AUDIO_KEYS is exactly the cues plus the beds, and every key has a distinct path", () => {
    expect(AUDIO_KEYS).toEqual([...CUE_KEYS, ...BED_KEYS]);
    expect(new Set(AUDIO_KEYS).size).toBe(AUDIO_KEYS.length);
    expect(audioPath("ko")).toBe("audio/ko.mp3");
  });
});

describe("audioAssetsRequired", () => {
  // BOTH sides. The 404 boot spec only ever exercises the `true` branch, so an inverted condition
  // here would ship silently and brick every device that has no audio hardware at all.
  it("requires the assets whenever the device can play anything", () => {
    expect(audioAssetsRequired({ noAudio: false, webAudio: true, audioData: true })).toBe(true);
    expect(audioAssetsRequired({ noAudio: false, webAudio: true, audioData: false })).toBe(true);
    expect(audioAssetsRequired({ noAudio: false, webAudio: false, audioData: true })).toBe(true);
  });

  it("does NOT require them when Phaser would refuse to queue them", () => {
    // Exactly the condition in loader/filetypes/AudioFile.js. If this branch is wrong, BootScene
    // throws on a machine whose only fault is having no sound card.
    expect(audioAssetsRequired({ noAudio: true, webAudio: true, audioData: true })).toBe(false);
    expect(audioAssetsRequired({ noAudio: false, webAudio: false, audioData: false })).toBe(false);
  });
});

describe("CueDirector — event cues", () => {
  it("splits light from heavy on the ATTACK KEY, not on damage", () => {
    // The ground heavy pays the brawler 15 and the monk 14, so any absolute damage threshold is
    // R-13's shape. All four of these carry the same `damage: 9`.
    const d = seeded();
    expect(played(d, [hit("light")], IDLE, NONE, "fight", 100)).toContain("hitLight");
    expect(played(d, [hit("crouchLight")], IDLE, NONE, "fight", 200)).toContain("hitLight");
    expect(played(d, [hit("heavy")], IDLE, NONE, "fight", 300)).toContain("hitHeavy");
    expect(played(d, [hit("airHeavy")], IDLE, NONE, "fight", 400)).toContain("hitHeavy");
  });

  it("treats a special's hit windows as heavy — its activation already fired `super`", () => {
    const d = seeded();
    expect(played(d, [hit("special")], IDLE, NONE, "fight", 100)).toContain("hitHeavy");
    expect(played(d, [{ type: "special", player: 0 }], IDLE, NONE, "fight", 1000)).toContain("super");
  });

  it("maps block, ko and the round events", () => {
    const d = seeded();
    expect(played(d, [{ type: "block", player: 1, data: { attack: "heavy" } }], IDLE, NONE, "fight", 100)).toEqual(["block"]);
    expect(played(d, [{ type: "ko", player: 1 }], IDLE, NONE, "fight", 200)).toEqual(["ko"]);
    expect(played(d, [{ type: "roundStart" }], IDLE, NONE, "fight", 900)).toEqual(["roundStart"]);
    expect(played(d, [{ type: "roundEnd", player: 0 }], IDLE, NONE, "fight", 1500)).toEqual(["roundEnd"]);
  });

  it("collapses a two-fighter trade to ONE cue", () => {
    const d = seeded();
    const both = played(d, [hit("heavy"), hit("heavy")], IDLE, NONE, "fight", 100);
    expect(both).toEqual(["hitHeavy"]);
  });

  it("caps a batch at MAX_PER_FRAME, keeping the highest-priority cues", () => {
    // A 15-tick advance really can carry this much at once. Five sounds on one frame is a click.
    const d = seeded();
    const out = played(d, 
      [{ type: "ko", player: 1 }, hit("heavy"), hit("light"),
       { type: "block", player: 0, data: { attack: "light" } }, { type: "special", player: 0 }],
      IDLE, NONE, "fight", 100,
    );
    expect(out).toHaveLength(3);
    expect(out).toEqual(["ko", "super", "hitHeavy"]);
    expect(out).not.toContain("block");
  });
});

describe("CueDirector — cooldowns", () => {
  it("refuses the same cue inside its gap and allows it outside", () => {
    const d = seeded();
    expect(played(d, [hit("light")], IDLE, NONE, "fight", 1000)).toEqual(["hitLight"]);
    expect(played(d, [hit("light")], IDLE, NONE, "fight", 1030)).toEqual([]);   // 30ms < 60ms gap
    expect(played(d, [hit("light")], IDLE, NONE, "fight", 1070)).toEqual(["hitLight"]);
  });

  it("does not burn a cue's cooldown when the cap dropped it", () => {
    // A cue thrown away for being 4th must still be allowed on the very next frame; stamping it on
    // the way out would silently mute whatever loses one crowded frame.
    const d = seeded();
    const first = played(d, 
      [{ type: "ko", player: 1 }, { type: "special", player: 0 }, hit("heavy"),
       { type: "block", player: 1, data: { attack: "light" } }],
      IDLE, NONE, "fight", 1000,
    );
    expect(first).not.toContain("block");
    expect(played(d, [{ type: "block", player: 1, data: { attack: "light" } }], IDLE, NONE, "fight", 1001)).toEqual(["block"]);
  });
});

describe("CueDirector — transitions", () => {
  it("fires jump when the sim CONSUMED the jump, and land on the grounded transition", () => {
    const d = seeded();
    expect(played(d, [], [F("jumpRise", false), F("idle")], c(0, { up: true }), "fight", 100)).toEqual(["jump"]);
    expect(played(d, [], [F("jumpFall", false), F("idle")], NONE, "fight", 300)).toEqual([]);  // still airborne
    // Landing has no input to consume, so it stays a transition — and cannot be lost to batching,
    // because being grounded persists.
    expect(played(d, [], [F("idle"), F("idle")], NONE, "fight", 500)).toEqual(["land"]);
    expect(played(d, [], [F("idle"), F("idle")], NONE, "fight", 700)).toEqual([]);
  });

  it("fires whiff from the CONSUMED attack edge, and never for the special", () => {
    const d = seeded();
    expect(played(d, [], IDLE, c(0, { light: true }), "fight", 100)).toEqual(["whiff"]);
    expect(played(d, [], IDLE, NONE, "fight", 500)).toEqual([]);
    expect(played(d, [], IDLE, c(1, { heavy: true }), "fight", 600)).toEqual(["whiff"]);
    // The special's own cue is `super`, fired from the event. A whoosh on top would double it up.
    expect(played(d, [], IDLE, c(0, { special: true }), "fight", 900)).toEqual([]);
  });

  it("still fires whiff when a WHOLE attack fits inside one render frame", () => {
    // The defect this replaced a state comparison to fix. `World.advance` clamps a stalled frame to
    // 0.25 s = 15 sim ticks, and the brawler's light is exactly 4 + 3 + 8 = 15 ticks — so one slow
    // frame starts it, runs it and returns the fighter to idle. A director comparing only end-of-frame
    // state sees idle -> idle and plays nothing at all.
    const d = seeded();
    expect(played(d, [], IDLE, c(0, { light: true }), "fight", 100)).toEqual(["whiff"]);
  });

  it("stays silent outside the FIGHT phase, and does not bank a transition across it", () => {
    // The concrete bug: a fighter KO'd IN THE AIR leaves grounded=false, then `resetRound()` stands
    // the next round's fighter up. Ungated, that is a phantom `land` at the top of round 2 — and
    // keying the re-seed off the `roundStart` EVENT cannot fix it, because that event is pushed when
    // the intro ENDS, ~90 ticks after the positions actually reset.
    const d = new CueDirector();
    played(d, [], [F("ko", false), F("idle")], NONE, "fight", 0);          // baseline: airborne KO
    expect(played(d, [], [F("idle"), F("idle")], NONE, "roundEnd", 100)).toEqual([]);
    expect(played(d, [], [F("idle"), F("idle")], NONE, "intro", 200)).toEqual([]);
    // ...and by the time the fight starts there is no stale transition left to misread.
    expect(played(d, [], [F("idle"), F("idle")], NONE, "fight", 300)).toEqual([]);
  });

  it("baselines its FIRST observation instead of reading it as a transition", () => {
    // MatchScene is a REUSED scene object (Esc -> Flow -> match), so a director whose first sample
    // counted as a transition would fire on scene entry.
    const d = new CueDirector();
    expect(played(d, [], [F("attackHeavy", false), F("jumpRise", false)], NONE, "fight", 0)).toEqual([]);
  });

  it("still reports event cues outside the fight phase", () => {
    // Only MOVEMENT is gated. `roundStart` arrives on the tick the intro ends and must be heard.
    const d = seeded("intro");
    expect(played(d, [{ type: "roundStart" }], IDLE, NONE, "intro", 100)).toEqual(["roundStart"]);
  });
});

describe("menuCue", () => {
  const s0 = initialFlow(false);

  it("calls a step change and a lock a CONFIRM", () => {
    expect(menuCue(s0, advance(s0))).toBe("menuConfirm");
    const chars = advance(advance(advance(s0)));
    expect(menuCue(chars, lock(chars, 0))).toBe("menuConfirm");
  });

  it("calls a cursor move a MOVE", () => {
    const mode = advance(s0);
    expect(menuCue(mode, moveMenu(mode, 1, 2))).toBe("menuMove");
    const chars = advance(advance(mode));
    expect(menuCue(chars, moveChar(chars, 0, 1, 3))).toBe("menuMove");
  });

  it("is silent when nothing changed", () => {
    expect(menuCue(s0, s0)).toBeNull();
    expect(menuCue(s0, { ...s0 })).toBeNull();
  });

  it("routes through the same cooldown as everything else", () => {
    const d = new CueDirector();
    expect(d.menu("menuMove" as CueKey, 1000)).toEqual(["menuMove"]);
    expect(d.menu("menuMove" as CueKey, 1020)).toEqual([]);
    expect(d.menu("menuMove" as CueKey, 1050)).toEqual(["menuMove"]);
    expect(d.menu(null, 2000)).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------------
// Cutting the super sting when the move it announced stops happening.
//
// The `super` sample is 3.6 s and the special is ~1.5 s, so the sting outlives even a super that
// COMPLETES — which is exactly why "was it interrupted?" has to be answered, not guessed at from how
// long the sound has been going.
// -------------------------------------------------------------------------------------------------

const SUPER = (player: 0 | 1): SimEvent => ({ type: "special", player });
const NO_INT: [boolean, boolean] = [false, false];
const INT = (who: 0 | 1): [boolean, boolean] => (who === 0 ? [true, false] : [false, true]);
/** P0 mid-super, P1 idle. */
const SUPERING: [FighterAudioView, FighterAudioView] = [F("special"), F("idle")];

describe("CueDirector — cutting an interrupted super", () => {
  it("cuts the sting when the sim reports the special was interrupted", () => {
    const d = seeded();
    expect(d.fight([SUPER(0)], SUPERING, NONE, "fight", 100, NO_INT).play).toContain("super");
    const out = d.fight([], [F("hitstun"), F("idle")], NONE, "fight", 200, INT(0));
    expect(out.stop).toEqual(["super"]);
  });

  it("does NOT cut when the special completes — INCLUDING when its owner is hit right afterwards", () => {
    // The case a render-side state comparison gets wrong, and the whole reason the sim carries the
    // flag: `special` -> `hitstun` across one frame is ambiguous, `interrupted` is not.
    const d = seeded();
    expect(d.fight([SUPER(0)], SUPERING, NONE, "fight", 100, NO_INT).play).toContain("super");
    // ...several frames of the move, still going.
    expect(d.fight([], SUPERING, NONE, "fight", 200, NO_INT).stop).toEqual([]);
    // ...it finishes.
    expect(d.fight([], IDLE, NONE, "fight", 300, NO_INT).stop).toEqual([]);
    // ...and NOW its owner is hit. The sim reports no interruption, because there was none.
    expect(d.fight([hit("light")], [F("hitstun"), F("idle")], NONE, "fight", 400, NO_INT).stop).toEqual([]);
  });

  it("does not cut when a DIFFERENT attack ends in a stun", () => {
    const d = seeded();
    expect(d.fight([], [F("attackHeavy"), F("idle")], NONE, "fight", 100, NO_INT).stop).toEqual([]);
    expect(d.fight([], [F("hitstun"), F("idle")], NONE, "fight", 200, NO_INT).stop).toEqual([]);
  });

  it("re-arms for a second super, and does not leave the first one latched", () => {
    // The assertion shape matters. "a second cut eventually happens" stays GREEN with the watch reset
    // deleted: the stale P0 watch fires a spurious cut on P1's activation frame and the sequence still
    // ENDS with the expected one. Counting every stop, and pinning P1's activation frame to none, is
    // what actually catches it.
    const d = seeded();
    const stops: CueKey[][] = [];
    stops.push(d.fight([SUPER(0)], SUPERING, NONE, "fight", 100, NO_INT).stop);
    stops.push(d.fight([], [F("hitstun"), F("idle")], NONE, "fight", 200, INT(0)).stop);   // cut #1
    const p1Activation = d.fight([SUPER(1)], [F("idle"), F("special")], NONE, "fight", 2000, NO_INT).stop;
    stops.push(p1Activation);
    stops.push(d.fight([], [F("idle"), F("hitstun")], NONE, "fight", 2100, INT(1)).stop);  // cut #2

    expect(p1Activation).toEqual([]);                                  // nothing stale fired here
    expect(stops.flat()).toEqual(["super", "super"]);                  // exactly two, in order
  });

  it("does not cut while the OTHER fighter's super is still running", () => {
    // One shared sound instance: two supers on one frame means one sting, and it belongs to whichever
    // move is still going.
    const d = seeded();
    d.fight([SUPER(0), SUPER(1)], [F("special"), F("special")], NONE, "fight", 100, NO_INT);
    // P0 is stuffed. P1 is still mid-super, so the sting stays.
    expect(d.fight([], [F("hitstun"), F("special")], NONE, "fight", 200, INT(0)).stop).toEqual([]);
    // P1 goes down too. Now there is nothing left for it to belong to.
    expect(d.fight([], [F("hitstun"), F("hitstun")], NONE, "fight", 300, INT(1)).stop).toEqual(["super"]);
  });

  it("cuts a still-armed super when a new round starts", () => {
    // Neither the round timer nor `World.restart()` (mid-match Enter) routes through `applyHit`, so
    // neither sets the sim flag — but the match the super belonged to is gone.
    const d = seeded();
    d.fight([SUPER(0)], SUPERING, NONE, "fight", 100, NO_INT);
    expect(d.fight([], IDLE, NONE, "intro", 200, NO_INT).stop).toEqual(["super"]);
    // ...and it does not keep firing every intro frame afterwards.
    expect(d.fight([], IDLE, NONE, "intro", 300, NO_INT).stop).toEqual([]);
  });

  it("cuts a super frozen mid-move by a TIMEOUT that ends the match", () => {
    // A timeout does not route through `applyHit`, so the sim reports nothing — and non-fight phases
    // stop advancing fighter timers, so the owner is stuck in `special` for good. Without `matchEnd`
    // in the phase list the tail rings over the match-end menu and no `intro` ever arrives to clear
    // it, because the next intro only comes if the player chooses a rematch.
    const d = seeded();
    d.fight([SUPER(0)], SUPERING, NONE, "fight", 100, NO_INT);
    expect(d.fight([{ type: "roundEnd" }], SUPERING, NONE, "roundEnd", 200, NO_INT).stop).toEqual([]);
    expect(d.fight([], SUPERING, NONE, "matchEnd", 300, NO_INT).stop).toEqual(["super"]);
    expect(d.fight([], SUPERING, NONE, "matchEnd", 400, NO_INT).stop).toEqual([]);
  });

  it("does not burn the super's cooldown on a cut it never played", () => {
    // `admit` stamps every cue it returns, so dropping the super AFTER admit would spend its 800 ms
    // gap on a sound nobody heard — and silence the next real super. Same defect the per-frame cap
    // already documents.
    const d = seeded();
    const stuffed = d.fight([SUPER(0)], [F("hitstun"), F("idle")], NONE, "fight", 100, INT(0));
    expect(stuffed.stop).toEqual(["super"]);
    expect(stuffed.play).not.toContain("super");
    // A real super 200 ms later — well inside the 800 ms cooldown — must still be heard.
    expect(d.fight([SUPER(1)], [F("idle"), F("special")], NONE, "fight", 300, NO_INT).play).toContain("super");
  });

  it("does NOT cut a super that scores the KO, whose phase goes to roundEnd mid-move", () => {
    // This is what forbids the blunter "the phase left `fight`" rule. The owner is still in `special`
    // when the round ends, and this sting is the one the whole cue exists for.
    const d = seeded();
    d.fight([SUPER(0)], SUPERING, NONE, "fight", 100, NO_INT);
    expect(d.fight([{ type: "ko", player: 1 }], SUPERING, NONE, "roundEnd", 200, NO_INT).stop).toEqual([]);
    expect(d.fight([], SUPERING, NONE, "roundEnd", 300, NO_INT).stop).toEqual([]);
  });

  it("cuts when the super is activated AND interrupted inside the SAME advance", () => {
    // `interruptedSpecials` is per-advance, so this frame is the only one that will ever report it,
    // and by end-of-frame the fighter is already in `hitstun` — there is no `special` state left to
    // observe. A watch armed after the resolve pass would miss the report entirely and then read the
    // next frame as a clean completion, leaving the sting to play out over a super that never came.
    //
    // This is also what distinguishes arming from the EVENT rather than from the STATE: state-based
    // arming never arms here at all.
    const d = seeded();
    const out = d.fight([SUPER(0)], [F("hitstun"), F("idle")], NONE, "fight", 100, INT(0));
    expect(out.stop).toEqual(["super"]);
    // ...and it is NOT also played. The adapter stops before it plays, so leaving the play in would
    // stop a sound that had not started (a no-op) and then start the sting anyway — for a move that
    // was already over by the time the frame ended.
    expect(out.play).not.toContain("super");
  });

  it("still plays the OTHER fighter's fresh super on a frame that cuts one", () => {
    // The drop above must key off the cut actually being emitted, not off "a special event arrived
    // alongside an interruption". Here P0 is stuffed as P1 fires: the still-running P1 super vetoes
    // the cut, so nothing is dropped and the new sting plays.
    const d = seeded();
    d.fight([SUPER(0)], SUPERING, NONE, "fight", 100, NO_INT);
    const out = d.fight([SUPER(1)], [F("hitstun"), F("special")], NONE, "fight", 2000, INT(0));
    expect(out.stop).toEqual([]);
    expect(out.play).toContain("super");
  });

  it("defaults to no interruption when the caller omits the argument", () => {
    // FlowScene and every pre-existing test call `fight()` without it.
    const d = seeded();
    d.fight([SUPER(0)], SUPERING, NONE, "fight", 100);
    expect(d.fight([], [F("hitstun"), F("idle")], NONE, "fight", 200).stop).toEqual([]);
  });
});
