import * as Phaser from "phaser";
import { CueDirector, menuCue, audioPath, BED_KEYS } from "./audio-cues";
import type { BedKey, ConsumedView, CueKey, FighterAudioView } from "./audio-cues";
import { PAD_ATLAS } from "./touch";
import type { MatchPhase } from "../sim/match";
import type { SimEvent } from "../sim/types";
import type { FlowState } from "../scenes/flow-state";

/**
 * The Phaser side of Phase 20 — the ONLY thing in the project that touches `this.sound`.
 *
 * It owns the mute button as well as playback, so a scene wires one object rather than two: one
 * `objects` array for the camera lists, one `layout(width)`, one `destroy()`.
 *
 * The decision of WHAT to play lives next door in the Phaser-free `audio-cues.ts`; this file is only
 * the adapter that plays it.
 */

/** Diameter of the mute button on screen. The atlas frame is 128px, so it is drawn at 0.44. */
const BTN_D = 56;

/**
 * Where the mute button sits, measured rather than assumed.
 *
 * `y = 240` is inside the only horizontal corridor free in BOTH input modes: the HUD's bottom edge is
 * y=208 and the centre banner (`hud.ts` `centerText`) starts near y=270, so 212..268 is clear. The
 * touch pad's TOP row is y=428 (`touchLayout`), well below. `x = width - 60` keeps it out of the
 * centre column, where the round timer and the round banner already stack.
 *
 * The first draft of this phase put it bottom-centre "because the pad leaves the middle clear". The
 * pad does — but the desktop keyboard legend (`MatchScene.ts`) and the touch `⎋ MENU` button both live
 * exactly there, and at depth 107 this plate would have covered the only way out of a match on a
 * phone. Measuring the claim against the pad alone is the same defect class this project keeps
 * re-shipping; `e2e/phase20-audio.spec.ts` now asserts the non-overlap instead of trusting this
 * comment.
 */
const BTN_MARGIN_X = 60;
const BTN_Y = 240;

/** Above the super cut-in (104-106) and the match-end scrim (99), deliberately. A mute control that
 *  vanishes during a freeze or behind the end menu is not a mute control. */
const BTN_DEPTH = 107;

const STORE_KEY = "vf.muted";

/**
 * Playback volume for every one-shot cue.
 *
 * Not a taste setting — a clipping fix, measured. Cues ship normalised to about -2 dBFS, and a KO
 * fires `hitHeavy` + `ko` + `roundEnd` on the SAME frame (the hit lands, the defender dies, the round
 * ends). Summed at full volume those three peak at **+3.9 dBFS**: past the destination ceiling, which
 * is audible distortion on exactly the moment the game most wants to sound good.
 *
 * At 0.5, with the ambience bed at its current 0.6 underneath, that stack peaks at **-1.15 dBFS**
 * (the gate prints it rounded, as -1.1) — inside the -1.0 ceiling `scripts/build-audio.py` gates on,
 * with 0.15 dB to spare.
 * `scripts/build-audio.py --check` re-computes the worst case from the shipped files on every run and
 * PARSES both this constant and the bed level out of this file, so neither number can silently stop
 * being enough. That headroom is why the beds cannot simply be turned up further: 0.65 on the
 * ambience lands exactly on the ceiling, and past it a KO clips.
 */
const CUE_VOLUME = 0.5;

/**
 * Playback volume for the two looping beds.
 *
 * Raised from 0.35/0.4 after both were reported inaudible on desktop and on a phone without maxing the
 * device volume. **The ternary below must stay literal and inline**: `scripts/build-audio.py` parses
 * the ambience value straight out of this file's source with
 * `volume: key === "menuMusic" \? [0-9.]+ : ([0-9.]+)` and exits if it does not match. That is
 * deliberate — holding a second copy of the number in the gate is the R-14 defect shape, and it was
 * briefly real: with a hardcoded copy, raising the volume here left the clipping gate perfectly green
 * because it was checking itself.
 *
 * Measured on the shipped files: ambience at 0.6 puts the worst-case KO stack at -1.15 dBFS, +3.5 dB
 * louder than the old 0.4. 0.65 would land on exactly -1.00 — the ceiling itself, no margin — so 0.6
 * is the top of the usable range, not a preference. menuMusic is not in the gated stack (menu cues and
 * fight cues never coexist) and rises +4.7 dB from 0.35; its own pessimistic worst case, summed
 * COHERENTLY with `menuConfirm` at CUE_VOLUME, is -1.31 dBFS.
 */

/** Labels are WORDS, not invented glyphs — the same call `touch.ts` made for the pad, and for the same
 *  reason: a musical-note glyph is a font gamble and a crossed-out one is worse. The label shows the
 *  current STATE, and the plate dims when muted so the two cues agree. */
const LABEL = { on: "SND", off: "OFF" };

/**
 * Module-level fallback for the mute intent, and it is not belt-and-braces.
 *
 * `GameAudio` is per-SCENE but the setting is per-GAME, so the intent has to survive one instance
 * being destroyed and the next being constructed. `localStorage` normally carries that — but it throws
 * in private-mode Safari and with third-party storage blocked, and both helpers swallow the failure.
 *
 * Without this, the failure mode is silent and wrong: a player mutes, `setItem` throws, the mute holds
 * for the rest of the match, and then Esc → menu constructs a new `GameAudio` that reads `false` from
 * storage and writes it back to the game-global manager. The sound comes back on its own, having been
 * turned off deliberately.
 */
let mutedMemo: boolean | null = null;

function loadMuted(): boolean {
  try {
    const v = localStorage.getItem(STORE_KEY);
    if (v !== null) return v === "1";
  } catch { /* storage unavailable; fall through to whatever this session last chose */ }
  return mutedMemo ?? false;
}

function saveMuted(v: boolean): void {
  mutedMemo = v;  // FIRST, so the in-memory intent is right even if the write below throws
  try {
    localStorage.setItem(STORE_KEY, v ? "1" : "0");
  } catch { /* see loadMuted */ }
}

export class GameAudio {
  readonly objects: Phaser.GameObjects.GameObject[];
  private readonly plate: Phaser.GameObjects.Image;
  private readonly glyph: Phaser.GameObjects.Text;
  private readonly director = new CueDirector();

  private bed?: Phaser.Sound.BaseSound;
  private bedKey?: BedKey;
  private pendingBed?: BedKey;
  /**
   * The ONE retained cue instance, and it is retained for one reason: nothing else in this class can
   * stop a sound it started. `sound.play(key)` adds an instance, wires `once(COMPLETE, destroy)` and
   * returns a BOOLEAN — the instance is unreachable, so a cue plays to its end no matter what happens
   * to the move that asked for it. `super.mp3` is 3.6 s against a ~1.5 s special, so an interrupted
   * super rang out over a move that had stopped.
   *
   * Only this cue. The impacts are meant to overlap and layer, and tracking them would mean managing
   * a pool to no purpose.
   *
   * `sound.stopByKey("super")` looks like the cheaper answer and is not: `stop()` tears down the
   * buffer source, so `onended` -> `hasEnded` -> `COMPLETE` never fires, `pendingRemove` stays false,
   * and `BaseSoundManager.update()` never splices it. Every interrupted super would leak a dead Sound
   * into the game-global array for the session.
   *
   * Built EAGERLY in the constructor rather than on first use, which is not an optimisation: a
   * lazily-added instance is created after any baseline an e2e takes and never destroyed, which turns
   * the existing "one-shot cues self-destruct" leak assertion red on a correct fix. One instance for
   * this object's whole life, one `remove()` in `destroy()`, inside every baseline.
   */
  private superSound?: Phaser.Sound.BaseSound;
  /** Kept so `destroy()` can remove the EXACT listener. `off(event)` with no handler would also strip
   *  a listener some other scene armed on the same game-global manager. */
  private unlockHandler?: () => void;
  private disposed = false;
  private width: number;

  /**
   * The muted INTENT, and the source of truth for it.
   *
   * `scene.sound.mute` cannot be that source, because on WebAudio it is not a stored flag at all: the
   * setter does `masterMuteNode.gain.setValueAtTime(v ? 0 : 1, 0)` and the getter returns
   * `gain.value === 0`. **A suspended AudioContext never applies that scheduled change**, so before the
   * first user gesture the write is silently discarded and the read comes back wrong.
   *
   * Measured in headless Chromium at boot: `locked: true`, `context.state: "suspended"`, and after
   * `sound.mute = true` both `sound.mute` and the gain were still `false` / `1`.
   *
   * That is a real defect, not a test artefact: a player who mutes on the title screen before touching
   * anything would lose the setting AND see a button labelled with the state it failed to reach. So
   * the flag lives here, `sound.mute` is treated as the MECHANISM, and the intent is re-applied when
   * the context unlocks.
   */
  private mutedFlag: boolean;

  /** DEV/e2e seam counters. `plays` counts SUCCESSFUL `sound.play()` calls, never cue requests: a
   *  counter bumped at the top of `play()` would keep rising even if every call bailed on the missing
   *  -key guard, which is precisely the failure it exists to detect. */
  private log: CueKey[] = [];
  private plays = 0;
  /** Counts SUCCESSFUL stops, for the same reason `plays` counts successful plays: a counter bumped on
   *  intent would keep rising with no sound having changed. */
  private stops = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.width = scene.scale.gameSize.width;
    this.mutedFlag = loadMuted();
    scene.sound.mute = this.mutedFlag;   // a no-op while the context is suspended; re-applied on unlock
    this.armUnlock();
    // Behind the same two guards `play()` documents, and for the same reasons: `sound.add` on an
    // uncached key THROWS, and a device with no audio at all boots with an empty audio cache by
    // design (see `audioAssetsRequired`). On such a device this stays undefined and `play("super")`
    // returns at its own `cache.audio.exists` check without reaching either path — there is no sound
    // to start and none to stop.
    if (scene.cache.audio.exists("super")) {
      try {
        this.superSound = scene.sound.add("super", { volume: CUE_VOLUME });
      } catch { /* an un-addable cue is not worth a crash; the fallback path covers it */ }
    }

    this.plate = scene.add.image(0, BTN_Y, PAD_ATLAS, "pad-action")
      .setDisplaySize(BTN_D, BTN_D)
      .setDepth(BTN_DEPTH)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on("pointerup", () => this.toggle());
    this.glyph = scene.add.text(0, BTN_Y, "", {
      fontFamily: "monospace", fontSize: "15px", color: "#ffffff",
      stroke: "#000000", strokeThickness: 3,
    }).setOrigin(0.5).setDepth(BTN_DEPTH).setScrollFactor(0);

    this.objects = [this.plate, this.glyph];
    this.paint();
    this.layout(this.width);

    if (import.meta.env.DEV) {
      (window as unknown as { __audio: unknown }).__audio = {
        log: () => [...this.log],
        plays: () => this.plays,
        muted: () => this.muted,
        gain: () => (this.scene.sound as unknown as { masterMuteNode?: GainNode }).masterMuteNode?.gain.value ?? null,
        bed: () => this.bedKey ?? null,
        bedPlaying: () => this.bed?.isPlaying ?? false,
        /**
         * The level the LIVE bed instance is carrying, so a value edited in source but never applied
         * fails here.
         *
         * Reads `currentConfig.volume`, deliberately NOT the `volume` getter. That getter returns
         * `volumeNode.gain.value` while its setter is `gain.setValueAtTime(v, 0)` — the exact trap
         * `mutedFlag` documents for `sound.mute`: on a context that has not resumed yet the write is
         * merely SCHEDULED and the read comes back as the pre-scheduled 1. Measured here — the bed
         * spec read 1.0 instead of 0.6 whenever it won the race against the unlock.
         */
        bedVolume: () =>
          (this.bed as Phaser.Sound.BaseSound & { currentConfig?: { volume?: number } } | undefined)
            ?.currentConfig?.volume ?? null,
        /** The seam that proves a cue was STOPPED. A play counter cannot — it only counts up. This is
         *  Phaser's own flag on Phaser's own instance: it reports that the sound is not sounding, not
         *  that our code called something. */
        superPlaying: () => this.superSound?.isPlaying ?? false,
        stops: () => this.stops,
        locked: () => this.scene.sound.locked,
        button: () => this.plate.getBounds(),
        play: (cue: CueKey) => this.play(cue),
        stop: (cue: CueKey) => this.stopCue(cue),
        clear: () => { this.log = []; this.plays = 0; this.stops = 0; },
        toggle: () => this.toggle(),
      };
    }
  }

  // --- layout ------------------------------------------------------------------------------------

  layout(width: number): void {
    this.width = width;
    const x = width - BTN_MARGIN_X;
    this.plate.setX(x);
    this.glyph.setX(x);
  }

  // --- playback ----------------------------------------------------------------------------------

  /**
   * Play one cue, or quietly do nothing.
   *
   * A sound that 404'd or failed to decode must never throw INTO the game loop: `update()` runs the
   * fixed-timestep advance, so an exception there stops the MATCH, not just the sound.
   *
   * Both guards are real, and it took a wrong turn to establish that. `sound.play()` on an uncached
   * key **throws** `Error: Audio key "x" not found in cache` — measured by removing the catch and
   * watching the spec go red. An earlier round of measuring concluded the opposite ("Phaser is a
   * complete no-op here") because every probe still ran with this catch in place, so the exception was
   * being swallowed before the probe could see it. Measuring a guard from behind the guard tells you
   * nothing.
   *
   * The `exists` check is therefore not redundant, it is the CHEAP path: a cue whose file went missing
   * fires as often as its event does, and constructing an exception 60 times a second to discard it is
   * a poor way to be quiet. The catch stays as the net for what `exists` cannot see — a context
   * revoked or closed after boot.
   *
   * Stated limit: `plays` counting SUCCESSFUL plays rather than requests cannot be proven from
   * outside. Both spellings return zero for a missing cue, since neither reaches the counter. What is
   * proven is that a missing cue never throws and never counts.
   */
  play(cue: CueKey): void {
    if (!this.scene.cache.audio.exists(cue)) return;
    // The tracked `super` instance replays rather than spawning a second one. Phaser allows it:
    // `BaseSound.play()` does not refuse while already playing, and `WebAudioSound.play()` tears the
    // old buffer source down and starts a new one.
    //
    // That replay is audible as a restart, not a layer: the sample is 3.6 s and the cooldown in
    // `audio-cues.ts` is 800 ms, so a second super cuts ~2.8 s off the first one's tail. That is the
    // deliberate trade for one instance — a super announcing itself over the previous super's tail is
    // the wrong sound anyway, and layering would need a pool this cue does not justify.
    const tracked = cue === "super" ? this.superSound : undefined;
    try {
      if (tracked ? !tracked.play() : !this.scene.sound.play(cue, { volume: CUE_VOLUME })) return;
    } catch {
      return;
    }
    this.plays++;
    if (import.meta.env.DEV) this.log.push(cue);
  }

  /**
   * Cut a cue whose move stopped happening. Only `super` has a handle to cut — every other cue is a
   * short impact meant to ring out, and asking to stop one is a silent no-op rather than an error.
   *
   * Guarded like `play()`: `stop()` on a revoked or closed context can throw, and this is called from
   * the same `update()` path, where an exception stops the MATCH rather than just the sound.
   */
  private stopCue(cue: CueKey): void {
    if (cue !== "super" || !this.superSound) return;
    try {
      if (!this.superSound.stop()) return;   // false when it was not playing; nothing changed
    } catch {
      return;
    }
    this.stops++;
  }

  /** Decide and play this frame's fight cues. `events` must be the batch the scene ALREADY drained —
   *  `drainEvents()` empties the world, so a second call here would hand the camera a full batch and
   *  this module an empty one. */
  fight(
    events: readonly SimEvent[],
    fighters: readonly [FighterAudioView, FighterAudioView],
    consumed: readonly [ConsumedView, ConsumedView],
    phase: MatchPhase,
    nowMs: number,
    interrupted: readonly [boolean, boolean] = [false, false],
  ): void {
    const { play, stop } = this.director.fight(events, fighters, consumed, phase, nowMs, interrupted);
    // STOP before PLAY. Both can name `super` on one frame — one player's is stuffed as the other's
    // begins — and they share a single instance, so playing first would start the new sting and then
    // immediately cut it.
    for (const c of stop) this.stopCue(c);
    for (const c of play) this.play(c);
  }

  /** Decide and play a menu transition. Called from FlowScene's single state-commit helper, so it
   *  covers keyboard AND first-tap touch selection. */
  menu(before: FlowState, after: FlowState, nowMs: number): void {
    for (const c of this.director.menu(menuCue(before, after), nowMs)) this.play(c);
  }

  // --- the looping beds --------------------------------------------------------------------------

  /**
   * Start a looping bed, deferring past the browser's autoplay lock if necessary.
   *
   * Phaser installs WebAudio's unlock listeners on `document.body` for
   * touchstart/touchend/mousedown/mouseup/keydown, so the Phase 18 pad, the title tap Zone and the
   * keyboard all unlock it with nothing extra wired here — and the rotate overlay cannot interfere,
   * because those listeners are on `body` rather than the canvas and do not go through
   * `game.input.enabled`.
   */
  startBed(key: BedKey): void {
    if (this.disposed || !this.scene.cache.audio.exists(key)) return;
    if (this.scene.sound.locked) {
      this.pendingBed = key;
      this.armUnlock();
    } else {
      this.beginBed(key);
    }
  }

  private beginBed(key: BedKey): void {
    if (this.disposed || this.bed) return;
    try {
      this.bed = this.scene.sound.add(key, { loop: true, volume: key === "menuMusic" ? 0.6 : 0.6 });
      this.bedKey = key;
      this.bed.play();
    } catch { /* a bed that will not start is not worth a crash */ }
  }

  /**
   * One handler for everything the autoplay lock deferred: re-assert the mute intent (the constructor
   * and `setMuted` both wrote into a suspended graph that ignored them) and start any bed that was
   * waiting.
   *
   * The `disposed` guard is the whole reason this is a NAMED handler rather than an inline arrow. The
   * SoundManager is game-global, so this callback outlives the scene that armed it: FlowScene can shut
   * down with it still pending, and the next gesture — by then inside MatchScene — would start the
   * MENU bed on top of the ambience.
   */
  private armUnlock(): void {
    if (this.unlockHandler || !this.scene.sound.locked) return;
    this.unlockHandler = (): void => {
      this.unlockHandler = undefined;
      if (this.disposed) return;
      // NOTE: there is deliberately no `sound.mute = this.mutedFlag` here.
      //
      // It was written, and then it would not fail: removing it left the gain reaching 0 anyway. The
      // reason is that `setValueAtTime(0, 0)` on a SUSPENDED context is still SCHEDULED — once the
      // context resumes its currentTime is already past 0, so the event applies on its own. What a
      // suspended context breaks is only the GETTER, which is why `mutedFlag` exists and why a re-apply
      // here is not needed. Unfalsifiable insurance is just code (Phase 19's lesson, same shape).
      const k = this.pendingBed;
      this.pendingBed = undefined;
      if (k) this.beginBed(k);
    };
    this.scene.sound.once(Phaser.Sound.Events.UNLOCKED, this.unlockHandler);
  }

  /**
   * Stop AND remove the bed.
   *
   * `stop()` alone is not enough: it leaves the instance in the manager's game-global `sounds` array,
   * so every Esc -> Flow -> match round trip would accumulate another dead bed. `remove()` destroys it.
   */
  stopBed(): void {
    if (this.bed) {
      try { this.scene.sound.remove(this.bed); } catch { /* already gone */ }
      this.bed = undefined;
      this.bedKey = undefined;
    }
  }

  // --- mute --------------------------------------------------------------------------------------

  /** The INTENT, which is authoritative — see `mutedFlag`. Never `scene.sound.mute`, which lies while
   *  the AudioContext is suspended. */
  get muted(): boolean {
    return this.mutedFlag;
  }

  /** `sound.mute` is game-global (one SoundManager per game), so the MECHANISM survives every
   *  `scene.start` with nothing to hand over, and `localStorage` carries the intent across a reload.
   *  A write made while the graph was asleep still lands on its own — `setValueAtTime(v, 0)` on a
   *  suspended context stays SCHEDULED and applies once it resumes, which is why `armUnlock`
   *  deliberately does NOT re-apply the mute (see the note inside it). What a suspended context
   *  breaks is the GETTER, and that is what `mutedFlag` is for. */
  setMuted(v: boolean): void {
    this.mutedFlag = v;
    this.scene.sound.mute = v;
    saveMuted(v);
    this.armUnlock();
    this.paint();
  }

  toggle(): void {
    this.setMuted(!this.muted);
  }

  private paint(): void {
    const m = this.muted;
    this.glyph.setText(m ? LABEL.off : LABEL.on);
    this.plate.setAlpha(m ? 0.55 : 1);
    this.glyph.setAlpha(m ? 0.6 : 1);
  }

  // --- teardown ----------------------------------------------------------------------------------

  /** Called from the owning scene's SHUTDOWN. Order matters: disarm the pending unlock FIRST, so a
   *  gesture landing mid-teardown cannot start a bed we are in the middle of removing. */
  destroy(): void {
    this.disposed = true;
    if (this.unlockHandler) {
      this.scene.sound.off(Phaser.Sound.Events.UNLOCKED, this.unlockHandler);
      this.unlockHandler = undefined;
    }
    this.stopBed();
    // Same rule as the bed, and the same reason: the SoundManager is game-global, so `stop()` alone
    // would leave this instance in `sound.sounds` to accumulate one more on every Esc -> Flow -> match
    // round trip. `remove()` destroys it and splices it out.
    if (this.superSound) {
      try { this.scene.sound.remove(this.superSound); } catch { /* already gone */ }
      this.superSound = undefined;
    }
    if (import.meta.env.DEV) delete (window as unknown as { __audio?: unknown }).__audio;
  }
}

export { BED_KEYS, audioPath };
