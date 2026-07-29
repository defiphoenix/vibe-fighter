import * as Phaser from "phaser";
import { TouchPadState, touchLayout, type TouchButtonSpec, type TouchHeld } from "./touch";

// Rooftop-dusk palette, same values FlowScene and the HUD use — a control pad in a different palette
// reads as a debug overlay bolted onto the game.
const PLATE = 0x120a1c;
const ACTION = 0xfd9146; // DUSK_ORANGE
const MOVE = 0xc9b8d4;
const PRESSED = 0xffffff;

/**
 * The on-screen pad: eight vector buttons that feed `InputSnapshot` through the SAME path the
 * keyboard uses.
 *
 * All the rules — which contact owns which button, multi-touch, slide-off, and turning a tap into
 * exactly one rising edge — live in the Phaser-free `touch.ts` so vitest can reach them. This class
 * is the adapter: it draws circles, forwards pointer events, and owns the camera/depth bookkeeping.
 *
 * **Depth 96/97**, deliberately BELOW the end scrim (99), the HUD (100/101), the Esc prompt (102),
 * the end menu (103) and the super cut-in (104-106). The pad sits at the bottom of the screen and the
 * HUD at the top so they never overlap spatially, but during a super freeze the cut-in IS the screen
 * and must cover it. `objects` must go into exactly ONE camera's ignore list —
 * `e2e/camera-group.spec.ts` audits every object's `cameraFilter`, and an object in neither list
 * renders twice.
 *
 * Input is read via SCENE-level pointer events, not per-button `setInteractive()`: a Game Object hit
 * test would put the multi-touch and slide rules inside Phaser, where the node-env tests cannot see
 * them. The UI camera has no scroll and no zoom, so `pointer.x/y` in game space ARE layout coords.
 */
export class TouchPad {
  private g: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[];
  readonly objects: Phaser.GameObjects.GameObject[];
  private state = new TouchPadState();
  private layout: TouchButtonSpec[] = touchLayout();
  private scene: Phaser.Scene;
  private shown = true;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.g = scene.add.graphics().setDepth(96).setScrollFactor(0);
    this.labels = this.layout.map((b) =>
      scene.add
        .text(b.x, b.y, b.label, {
          fontFamily: "monospace",
          // The two glyph buttons carry a big arrow; the word buttons have to fit inside the circle.
          fontSize: b.label.length <= 1 ? "40px" : "15px",
          color: "#ffffff",
          stroke: "#000000",
          strokeThickness: 3,
        })
        .setOrigin(0.5, 0.5)
        .setDepth(97)
        .setScrollFactor(0),
    );
    this.objects = [this.g, ...this.labels];

    // Phaser removes these with the scene (InputPlugin.shutdown drops every listener), so there is
    // nothing to unsubscribe on a scene restart.
    scene.input.addPointer(3); // default 2 cannot express direction + attack + block at once
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => this.state.down(p.id, p.x, p.y));
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => this.state.move(p.id, p.x, p.y));
    scene.input.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer) => this.state.up(p.id));
    // `InputPlugin.processUpEvents` emits scene-level POINTER_UP only when `pointer.upElement` is the
    // canvas, and POINTER_UP_OUTSIDE otherwise (InputPlugin.js:2064-2075) — and on a letterboxed phone
    // the black bars are outside the canvas ELEMENT, so without this a thumb that lifts in the bar
    // would leave its button held forever. Chromium's emulation reports the canvas even for a release
    // in the bar, so no NATURAL gesture in the specs reaches this line; `mobile-touch.spec.ts` drives
    // the event directly instead, and deleting this line turns that case red.
    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, (p: Phaser.Input.Pointer) => this.state.up(p.id));

    this.draw({} as TouchHeld);
  }

  setVisible(v: boolean): void {
    if (v === this.shown) return;
    this.shown = v;
    this.g.setVisible(v);
    for (const t of this.labels) t.setVisible(v);
    // Making the Graphics invisible does NOT unsubscribe the scene-level listeners, so without this a
    // hidden pad keeps collecting contacts and hands them to the sim the moment it reappears.
    this.state.setActive(v);
  }

  /** Held flags for this frame. Call ONCE per update, before `InputReader.read`. */
  consume(): TouchHeld {
    // Belt-and-braces under the two `up` subscriptions: anything Phaser no longer considers down is
    // released here, whatever terminal event we did not think of (pointercancel, a gesture
    // interrupted by the OS, a scene torn down mid-touch).
    const live: number[] = [];
    for (const p of this.scene.input.manager.pointers) if (p.isDown) live.push(p.id);
    this.state.reconcile(live);
    const held = this.state.consume();
    if (this.shown) this.draw(held);
    return held;
  }

  private draw(held: Partial<TouchHeld>): void {
    this.g.clear();
    for (const b of this.layout) {
      const isAction = b.id === "light" || b.id === "heavy" || b.id === "block" || b.id === "special";
      const on = held[b.id] === true;
      this.g.fillStyle(on ? (isAction ? ACTION : MOVE) : PLATE, on ? 0.55 : 0.42);
      this.g.fillCircle(b.x, b.y, b.r);
      this.g.lineStyle(on ? 5 : 3, on ? PRESSED : isAction ? ACTION : MOVE, on ? 1 : 0.85);
      this.g.strokeCircle(b.x, b.y, b.r);
    }
  }
}
