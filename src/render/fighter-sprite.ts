import * as Phaser from "phaser";
import type { Fighter } from "../sim/fighter";
import type { CharacterData, StateName } from "../sim/types";
import {
  stateFrameRate, stunFrameRate, attackFrameDurations, attackStartFrame, stunStartFrame, PLAY_LAG_TICKS,
} from "./anim-timing";
import { TICK_HZ } from "../sim/constants";
import { textureKey, type RenderMeta } from "./characters";
import { STATE_NAMES } from "../sim/validate-character";

/** Drives one fighter's Phaser sprite from sim state: one animation per StateName, feet-anchored,
 *  mirrored by facing, depth-ordered by frontIndex, and frozen during hitstop to match the sim. */
export class FighterSprite {
  readonly sprite: Phaser.GameObjects.Sprite;
  private lastState: StateName | null = null;
  /** The stun episode the current animation belongs to. A combo's 2nd+ hit re-enters `hitstun` from
   *  `hitstun`, so the state NAME is unchanged and the check below would not re-play — the defender
   *  froze on the last hurt frame for the rest of the combo. See Fighter.stunEpoch. */
  private lastStunEpoch = -1;
  private paused = false;
  /** Render frames left on the block flash. Counted down in update() rather than held on a timer
   *  because update() is the ONLY writer of the tint — anything tinting from outside is overwritten
   *  by update()'s clearTint on the very next frame. */
  private blockFlash = 0;

  constructor(
    scene: Phaser.Scene,
    readonly id: string,
    private render: RenderMeta,
    /** stats.scale — the SAME factor character-builder applies to the collision boxes, so art and
     *  boxes rescale together. Required (not defaulted) so a missed call site is a typecheck error
     *  rather than a silent art/box desync. */
    scale: number,
    /** The sim-side character data, used ONLY to time the attack animations (see below). */
    private data: CharacterData,
  ) {
    // Register one animation per state, idempotently — keys are global, so a mirror matchup
    // (same id on both sides) must not recreate them.
    for (const state of STATE_NAMES) {
      const key = textureKey(id, state);
      if (scene.anims.exists(key)) continue;
      const meta = render.sheets[state];
      const frames = scene.anims.generateFrameNumbers(key, { start: 0, end: meta.frames - 1 });
      // Attacks with a MEASURED contact frame get explicit per-frame durations, so the frame the
      // sprite actually strikes on begins on the sim's first active tick (see anim-timing.ts).
      // In Phaser 4 a frame's `duration` REPLACES msPerFrame rather than adding to it
      // (Animation.js getNextTick: `currentFrame.duration || msPerFrame`) — and only while the
      // playback frameRate still equals the animation's, so never pass a per-play `frameRate`
      // override to play() or these durations silently stop applying. `frameRate` below stays the
      // base for every other frame and for sheets with no measurement.
      const durations = attackFrameDurations(state, meta, data);
      if (durations) frames.forEach((f, i) => { f.duration = durations[i]; });
      scene.anims.create({
        key,
        frames,
        frameRate: stateFrameRate(state, meta, data),
        repeat: meta.loop ? -1 : 0,
      });
    }
    const [ox, oy] = render.anchor;
    this.sprite = scene.add.sprite(0, 0, textureKey(id, "idle")).setOrigin(ox, oy).setScale(scale);
  }

  /** Per-frame update from the sim. `isFront` toggles depth 11/9 (Phaser sorts by numeric depth);
   *  `frozen` (hitstop) pauses playback so the animation doesn't run while the sim is stopped. */
  update(f: Fighter, isFront: boolean, frozen: boolean): void {
    this.sprite.setPosition(f.x, f.y).setFlipX(f.facing < 0).setDepth(isFront ? 11 : 9);

    // A landed block flashes the fighter white for a few frames as hit feedback. Phase 13b: the
    // steady blue "guard-armed" tint was REMOVED — the dedicated block/blockCrouch pose (arms up) is
    // the guard cue now, so tinting the whole fighter blue while holding guard just read as "the
    // character turned blue". ponytail: if guard needs to read louder, add a shield sprite, not a tint.
    // In Phaser 4 tint COLOR and tint MODE are separate settings and setTintFill() is a deprecated
    // no-op — a white MULTIPLY tint is a no-op too, so the flash must switch the mode to FILL and
    // switch it back, or the fighter stays a white silhouette forever.
    if (this.blockFlash > 0) {
      this.blockFlash--;
      this.sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    } else {
      this.sprite.clearTint();
      this.sprite.setTintMode(Phaser.TintModes.MULTIPLY);
    }

    // ...or the sim restarted the stun WITHOUT changing the state name — a combo's 2nd+ hit re-enters
    // `hitstun` from `hitstun`, and keying off the state alone left the defender parked on the last
    // frame of the one-shot hurt sheet for the rest of the combo. See Fighter.stunEpoch.
    if (f.state !== this.lastState || f.stunEpoch !== this.lastStunEpoch) {
      const key = textureKey(this.id, f.state);
      // A stun's length is decided by the attack that caused it, so it isn't known until the state is
      // entered and can't be baked into the registered animation (see stunFrameRate). Overriding the
      // rate here DISABLES the per-frame durations — Animation.getNextTick only honours them while
      // `state.frameRate === currentAnim.frameRate` — which is safe because only ATTACK sheets carry
      // durations and stunFrameRate returns null for every attack state.
      const meta = this.render.sheets[f.state];
      const rate = stunFrameRate(f.state, meta, f.stunTimer);
      // A state whose window cannot afford every drawn pose starts partway in, so the poses it DOES
      // draw last long enough to read (see attackStartFrame / stunStartFrame). Passing startFrame
      // through the config object keeps `state.frameRate === anim.frameRate`, so the per-frame
      // durations still apply — only a `frameRate` override disables those, and only stuns pass one.
      if (rate !== null) {
        this.sprite.play({ key, frameRate: rate, startFrame: stunStartFrame(f.state, meta, f.stunTimer) });
      } else {
        const startFrame = attackStartFrame(f.state, meta, this.data);
        if (startFrame > 0) this.sprite.play({ key, startFrame });
        else this.sprite.play(key);
      }
      this.lastState = f.state;
      this.lastStunEpoch = f.stunEpoch;
      this.paused = false;
      // Catch the animation up to where the SIM already is. `World.advance` runs a whole batch of
      // fixed ticks before the scene renders — up to 15 on a stalled frame (MAX_FRAME) — so on a
      // frame hitch an attack can enter its state AND run past its active window before play() is
      // ever called, which would draw the wind-up while the hit box was already live: exactly the
      // defect the measured contact frames exist to remove. On a healthy frame stateFrame is 1 here
      // and this contributes nothing, which is the constant PLAY_LAG_TICKS already accounts for.
      const behind = (f.stateFrame - PLAY_LAG_TICKS) * (1000 / TICK_HZ);
      if (behind > 0) this.sprite.anims.update(0, behind);
    }
    if (frozen && !this.paused) { this.sprite.anims.pause(); this.paused = true; }
    else if (!frozen && this.paused) { this.sprite.anims.resume(); this.paused = false; }
  }

  /** A hit was blocked by THIS fighter — flash white for a few frames. Called from the scene's event
   *  drain; the tint itself is applied in update(), the only writer of the tint. */
  flashBlock(frames = 4): void {
    this.blockFlash = frames;
  }

  /** Drop any in-flight render effect. Call on a round/match restart: the flash is render-local state
   *  with no sim owner, so a rematch pressed on a blocking frame would otherwise render the freshly
   *  reset fighter white for the leftover frames. */
  clearFx(): void {
    this.blockFlash = 0;
  }

  /** Gym-only: show one authored sim frame statically (no playback). Render frames are decoupled
   *  from sim box-slot frames, so map by proportion: visual = floor(stateFrame*renderN/simN). */
  showFrame(state: StateName, stateFrame: number, simFrames: number): void {
    const renderN = this.render.sheets[state].frames;
    const denom = Math.max(1, simFrames);
    const visual = Math.min(renderN - 1, Math.max(0, Math.floor((stateFrame * renderN) / denom)));
    this.sprite.anims.stop();
    this.lastState = null; // force a fresh play() when the scene resumes live animation
    this.sprite.setTexture(textureKey(this.id, state), visual);
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
