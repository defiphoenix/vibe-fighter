import * as Phaser from "phaser";
import { STAGE_HEIGHT } from "../sim/constants";
import { liveWidth } from "./viewport";
import { superCutIn } from "./super-cutin";
import { portraitKey } from "./characters";

/** Screen-space owner of the super cut-in's three objects, shared by MatchScene and PlaygroundScene.
 *
 *  Both scenes need it — the Playground IS where you try the special on the dummy — and duplicating
 *  the object/camera/depth bookkeeping in two scenes is exactly how an object ends up on one camera
 *  in one scene and both in the other. The animation itself is `super-cutin.ts` (Phaser-free, unit
 *  tested); this class only applies those numbers to Game Objects.
 *
 *  Depth 104: above the HUD (100/101) and the Esc quit prompt (102), because for the length of the
 *  freeze this IS the screen. `objects` must go into exactly ONE camera's ignore list — an object in
 *  neither renders twice, and `e2e/camera-group.spec.ts` audits every object's cameraFilter.
 */
export class CutInView {
  private scrim: Phaser.GameObjects.Rectangle;
  private portrait: Phaser.GameObjects.Image;
  private sweep: Phaser.GameObjects.Rectangle;
  readonly objects: Phaser.GameObjects.GameObject[];

  /** Ticks the current freeze was armed with; 0 = nothing playing. */
  private freezeTicks = 0;
  /** The portrait is drawn at ~1:1 from the 448x600 card — an UPSCALE at this height, so the
   *  no-mipmaps-on-NPOT softness that forced the HUD's own portrait bake does not apply here. */
  private readonly portraitH = STAGE_HEIGHT * 0.92;

  /** Current game width. The cut-in owns the whole screen, so it is the one thing here that must
   *  follow a viewport change exactly — a scrim cut to 1280 on a 1559-wide phone leaves a bright
   *  unscrimmed strip down the side of a full-screen effect. */
  private viewW: number;

  constructor(scene: Phaser.Scene) {
    this.viewW = liveWidth(scene.scale.gameSize.width);
    this.scrim = scene.add.rectangle(0, 0, this.viewW, STAGE_HEIGHT, 0x0a0410)
      .setOrigin(0, 0).setDepth(104).setScrollFactor(0).setAlpha(0).setVisible(false);
    this.portrait = scene.add.image(0, STAGE_HEIGHT, "")
      .setOrigin(0.5, 1).setDepth(105).setScrollFactor(0).setVisible(false);
    // A hard bright bar rather than a gradient: one Rectangle, no shader, and it reads as a light
    // wipe at this speed. ponytail: a real gradient sweep is a Filter, which is Phase 16 territory.
    this.sweep = scene.add.rectangle(0, 0, 90, STAGE_HEIGHT, 0xffffff)
      .setOrigin(0.5, 0).setDepth(106).setScrollFactor(0).setAlpha(0).setVisible(false);
    this.objects = [this.scrim, this.portrait, this.sweep];
  }

  /** Re-anchor to a new game width. */
  layout(width: number): void {
    this.viewW = width;
    this.scrim.setSize(width, STAGE_HEIGHT);
  }

  /** Arm the cut-in for a fighter. `freezeTicks` is the super freeze the sim just started, which is
   *  also the countdown `update` reads — so if the freeze is cut short (a KO, a restart) the cut-in
   *  ends with it instead of hanging on screen. */
  play(fighterId: string, freezeTicks: number): void {
    const key = portraitKey(fighterId);
    if (freezeTicks <= 0 || !this.portrait.scene.textures.exists(key)) return;
    // FIRST wins. Both fighters can fire a super on the same tick, which drains two `special` events
    // into one view; without this the second overwrites the first's texture and countdown and only
    // P2's portrait is ever seen. One shared freeze, one portrait — deterministic either way, and
    // first-armed matches the event order the sim emits.
    if (this.freezeTicks > 0) return;
    this.freezeTicks = freezeTicks;
    this.portrait.setTexture(key);
    this.portrait.setScale(this.portraitH / this.portrait.height);
  }

  /** `remaining` is `World.hitstop`. Call every frame; cheap and self-clearing. */
  update(remaining: number): void {
    if (this.freezeTicks <= 0) return;
    const s = superCutIn(this.freezeTicks, remaining);
    if (s.done) return void this.stop();

    const w = this.portrait.displayWidth;
    this.portrait.setVisible(true).setAlpha(s.alpha).setX(w / 2 + s.x * w);
    this.scrim.setVisible(true).setAlpha(s.alpha * 0.72);
    // The sweep only exists mid-cross; at 0 and 1 it would sit parked on an edge.
    const crossing = s.sweep > 0 && s.sweep < 1;
    this.sweep.setVisible(crossing).setAlpha(crossing ? s.alpha * 0.5 : 0).setX(s.sweep * this.viewW);
  }

  /** Hide everything and disarm. Safe to call at any time — a scene restart or a KO mid-freeze. */
  stop(): void {
    this.freezeTicks = 0;
    this.scrim.setVisible(false).setAlpha(0);
    this.portrait.setVisible(false).setAlpha(0);
    this.sweep.setVisible(false).setAlpha(0);
  }

  /** DEV seam for the e2e: measured off the real objects, never bookkeeping. */
  snapshot(): { playing: boolean; alpha: number; x: number; key: string } {
    return {
      playing: this.freezeTicks > 0 && this.portrait.visible,
      alpha: this.portrait.alpha,
      x: this.portrait.x,
      key: this.portrait.texture.key,
    };
  }
}
