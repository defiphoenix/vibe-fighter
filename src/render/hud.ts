import * as Phaser from "phaser";
import { World } from "../sim/world";
import { VIEW_WIDTH } from "../sim/constants";

// ponytail: HUD sizing knobs — bumped smaller on request; tweak these four + the font sizes below.
const BAR_W = 360;
const BAR_H = 24;
const MARGIN = 32;
const TOP = 26;

export class Hud {
  private g: Phaser.GameObjects.Graphics;
  private timerText: Phaser.GameObjects.Text;
  private centerText: Phaser.GameObjects.Text;
  private p1Pips: Phaser.GameObjects.Text;
  private p2Pips: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    // HUD is screen-space: pin every element with setScrollFactor(0) so the follow-camera
    // (world wider than viewport) never drags the bars/timer off-screen.
    this.g = scene.add.graphics().setDepth(100).setScrollFactor(0);
    const font = { fontFamily: "monospace", color: "#ffffff" };
    this.timerText = scene.add.text(VIEW_WIDTH / 2, TOP, "", { ...font, fontSize: "30px" }).setOrigin(0.5, 0).setDepth(101).setScrollFactor(0);
    this.centerText = scene.add.text(VIEW_WIDTH / 2, 300, "", { ...font, fontSize: "60px", color: "#ffdd44" }).setOrigin(0.5).setDepth(101).setScrollFactor(0);
    this.p1Pips = scene.add.text(MARGIN, TOP + BAR_H + 6, "", { ...font, fontSize: "18px", color: "#66ccff" }).setDepth(101).setScrollFactor(0);
    this.p2Pips = scene.add.text(VIEW_WIDTH - MARGIN, TOP + BAR_H + 6, "", { ...font, fontSize: "18px", color: "#ff8866" }).setOrigin(1, 0).setDepth(101).setScrollFactor(0);
  }

  private bar(x: number, frac: number, flip: boolean, blink: boolean): void {
    // background
    this.g.fillStyle(0x000000, 0.55);
    this.g.fillRect(x, TOP, BAR_W, BAR_H);
    // fill color by health, blink when low
    let color = 0x44dd44;
    if (frac < 0.5) color = 0xdddd33;
    if (frac < 0.25) color = 0xdd3333;
    if (blink && frac < 0.25) return; // skip fill this frame → blink
    const w = BAR_W * Phaser.Math.Clamp(frac, 0, 1);
    this.g.fillStyle(color, 1);
    if (flip) this.g.fillRect(x + BAR_W - w, TOP, w, BAR_H);
    else this.g.fillRect(x, TOP, w, BAR_H);
    this.g.lineStyle(2, 0xffffff, 0.9);
    this.g.strokeRect(x, TOP, BAR_W, BAR_H);
  }

  update(world: World, timeMs: number): void {
    this.g.clear();
    const [a, b] = world.fighters;
    const blink = Math.floor(timeMs / 120) % 2 === 0;
    this.bar(MARGIN, a.health / a.cfg.stats.maxHealth, false, blink);
    this.bar(VIEW_WIDTH - MARGIN - BAR_W, b.health / b.cfg.stats.maxHealth, true, blink);

    const m = world.match;
    this.timerText.setText(String(m.secondsLeft));
    this.p1Pips.setText("P1 " + "●".repeat(m.wins[0]));
    this.p2Pips.setText("●".repeat(m.wins[1]) + " P2");

    let center = "";
    if (m.phase === "intro") center = m.introTicks > 30 ? `ROUND ${m.round}` : "FIGHT!";
    else if (m.phase === "roundEnd") center = m.lastRoundWinner === null ? "DRAW" : `P${m.lastRoundWinner + 1} WINS`;
    else if (m.phase === "matchEnd") center = m.matchWinner === null ? "DRAW" : `P${m.matchWinner + 1} WINS THE MATCH!`;
    this.centerText.setText(center);
  }
}
