import * as Phaser from "phaser";
import type { Fighter } from "../sim/fighter";
import type { CharacterData, StateName } from "../sim/types";
import { attackFrameRate } from "./anim-timing";
import { textureKey, type RenderMeta } from "./characters";
import { STATE_NAMES } from "../sim/validate-character";

/** Drives one fighter's Phaser sprite from sim state: one animation per StateName, feet-anchored,
 *  mirrored by facing, depth-ordered by frontIndex, and frozen during hitstop to match the sim. */
export class FighterSprite {
  readonly sprite: Phaser.GameObjects.Sprite;
  private lastState: StateName | null = null;
  private paused = false;
  /** Render frames left on the block flash. Counted down in update() rather than held on a timer
   *  because update() is the ONLY writer of the tint — anything tinting from outside is overwritten
   *  by the guard-tint branch on the very next frame. */
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
    data: CharacterData,
  ) {
    // Register one animation per state, idempotently — keys are global, so a mirror matchup
    // (same id on both sides) must not recreate them.
    for (const state of STATE_NAMES) {
      const key = textureKey(id, state);
      if (scene.anims.exists(key)) continue;
      const meta = render.sheets[state];
      scene.anims.create({
        key,
        frames: scene.anims.generateFrameNumbers(key, { start: 0, end: meta.frames - 1 }),
        frameRate: attackFrameRate(state, meta, data),
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

    // Guard-armed cue: tint only while a guard box is actually active (f.guarding, NOT f.guardIntent
    // — intent is set even during hitstun/attack, which would advertise protection that isn't there).
    // Legible BEFORE any hit lands, unlike a post-contact flash. ponytail: a tint is the cheapest
    // legible cue; swap for a shield sprite if it needs to read louder.
    // A landed block flashes white for a few frames and outranks the guard tint; then it falls back
    // to blue-while-guarding. ponytail: frame-counted, not ms — good enough for a 4-frame pop.
    // In Phaser 4 tint COLOR and tint MODE are separate settings and setTintFill() is a deprecated
    // no-op — a white MULTIPLY tint is a no-op too, so the flash must switch the mode to FILL and
    // switch it back, or the fighter stays a white silhouette forever.
    if (this.blockFlash > 0) {
      this.blockFlash--;
      this.sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    } else if (f.guarding) {
      this.sprite.setTint(0x7fb2ff).setTintMode(Phaser.TintModes.MULTIPLY);
    } else {
      this.sprite.clearTint();
      this.sprite.setTintMode(Phaser.TintModes.MULTIPLY);
    }

    if (f.state !== this.lastState) {
      this.sprite.play(textureKey(this.id, f.state));
      this.lastState = f.state;
      this.paused = false;
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
