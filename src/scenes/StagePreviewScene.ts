import * as Phaser from "phaser";
import { STAGE_WIDTH, STAGE_HEIGHT } from "../sim/constants";
import { buildStage } from "../render/stage";
import type { StagesFile, StageHandle } from "../render/stage";

const PAN_SPEED = 480; // px per second while an arrow is held (frame-rate independent)

/** Dev-only tool to pan/tune the parallax stage live. Reached via ?scene=preview.
 *  Arrow keys pan the camera; 1/2 switch twilight/sunset (destroy + rebuild, so object count stays
 *  constant); the readout shows scrollX + the active stage's parallax factors.
 *  ponytail: dev tooling, no sim, no fighters. */
export class StagePreviewScene extends Phaser.Scene {
  private stages!: StagesFile;
  private stageIds: string[] = [];
  private current = 0;
  private handle!: StageHandle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private readout!: Phaser.GameObjects.Text;

  constructor() {
    super("StagePreview");
  }

  create(): void {
    this.stages = this.cache.json.get("stages") as StagesFile;
    this.stageIds = Object.keys(this.stages).filter((k) => !k.startsWith("_"));
    this.cameras.main.setBounds(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

    this.readout = this.add
      .text(12, 12, "", { fontFamily: "monospace", fontSize: "18px", color: "#cfe" })
      .setDepth(200)
      .setScrollFactor(0);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.input.keyboard!.on("keydown-ONE", () => this.switchStage(0));
    this.input.keyboard!.on("keydown-TWO", () => this.switchStage(1));

    this.build();

    // dev-only hook: e2e drives stage switching + reads object count without synthetic keys.
    if (import.meta.env.DEV) {
      (window as unknown as { __preview: unknown }).__preview = {
        switchStage: (i: number) => this.switchStage(i),
        childCount: () => this.children.length,
        stageId: () => this.stageIds[this.current],
      };
    }
  }

  private build(): void {
    this.handle = buildStage(this, this.stages[this.stageIds[this.current]]);
  }

  private switchStage(i: number): void {
    if (i < 0 || i >= this.stageIds.length || i === this.current) return;
    this.handle.destroy(); // tear down the old stage first so layers/props don't stack
    this.current = i;
    this.build();
  }

  update(_time: number, delta: number): void {
    const cam = this.cameras.main;
    const step = (PAN_SPEED * delta) / 1000;
    if (this.cursors.left.isDown) cam.scrollX -= step;
    if (this.cursors.right.isDown) cam.scrollX += step;
    // clamp before the readout so a press at the edge never displays an out-of-bounds value.
    cam.scrollX = Phaser.Math.Clamp(cam.scrollX, 0, STAGE_WIDTH - cam.width);

    const cfg = this.stages[this.stageIds[this.current]];
    const factors = cfg.layers.map((l) => l.scrollFactor).join("/");
    this.readout.setText(
      `stage: ${this.stageIds[this.current]}  [1/2 switch]  scrollX: ${Math.round(cam.scrollX)}  factors: ${factors}\n` +
        `arrows: pan   world ${STAGE_WIDTH} > view`,
    );
  }
}
