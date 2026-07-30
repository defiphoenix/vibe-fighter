import * as Phaser from "phaser";
import {
  TouchPadState, touchLayout, frameFor, BUTTON_R, PAD_BLEED, PAD_ATLAS, PAD_FRAMES,
  type TouchButtonSpec, type TouchHeld,
} from "./touch";
import { STAGE_HEIGHT } from "../sim/constants";
import { liveWidth } from "./viewport";

// The rooftop-dusk palette that used to live here as four hex constants is now baked into
// `ui/pad-atlas.png` by `scripts/build-atlases.py --pad`, which mirrors the same values.

/**
 * The on-screen pad: eight vector buttons that feed `InputSnapshot` through the SAME path the
 * keyboard uses.
 *
 * All the rules — which contact owns which button, multi-touch, slide-off, and turning a tap into
 * exactly one rising edge — live in the Phaser-free `touch.ts` so vitest can reach them. This class
 * is the adapter: it places the art, forwards pointer events, and owns the camera/depth bookkeeping.
 *
 * The buttons are ATLAS IMAGES (Phase 19), not the vector circles this drew for Phase 18 — four
 * frames covering action/movement x idle/pressed, generated procedurally by
 * `scripts/build-atlases.py --pad`. `touchLayout()` remains the single source of truth for x/y/r, so
 * the art can never disagree with the hit test; the constructor throws if the frames say otherwise.
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
  /** One Image per button, carrying the atlas art. Replaced the single Graphics the pad used to draw
   *  eight vector circles into. */
  private buttons: Phaser.GameObjects.Image[];
  private labels: Phaser.GameObjects.Text[];
  readonly objects: Phaser.GameObjects.GameObject[];
  private state: TouchPadState;
  /** Button geometry for the CURRENT game width. Named `specs` rather than `layout` so `layout()`
   *  can be the verb — this class and `TouchPadState` each hold a copy and both are rewritten there. */
  private specs: TouchButtonSpec[];
  private scene: Phaser.Scene;
  private shown = true;
  /** Last drawn pressed-state per button, so `draw()` only touches frames that actually changed. */
  private lastHeld: Partial<TouchHeld> = {};

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.specs = touchLayout(liveWidth(scene.scale.gameSize.width), STAGE_HEIGHT);
    this.state = new TouchPadState(this.specs);

    // Validate the whole atlas up front and throw naming the frame, exactly as Hud does. Two
    // independent reasons this is not paranoia:
    //  * `Texture.get(name)` does NOT throw on a missing frame — it `console.warn`s and returns the
    //    atlas's FIRST frame (Texture.js:255-270). A renamed frame would silently draw the wrong
    //    state on every button forever, and every geometric assertion would still pass.
    //  * the drawn circle IS the hit circle. If the art's radius stops matching BUTTON_R, taps near
    //    the edge miss with nothing on screen to explain why — so the size is checked, not assumed.
    const tex = scene.textures.get(PAD_ATLAS);
    const cell = 2 * (BUTTON_R + PAD_BLEED);
    for (const frame of PAD_FRAMES) {
      if (!tex || !tex.has(frame)) throw new Error(`touch pad: missing frame "${frame}" in atlas "${PAD_ATLAS}"`);
      const f = tex.get(frame);
      if (f.width !== cell || f.height !== cell) {
        throw new Error(
          `touch pad: frame "${frame}" is ${f.width}x${f.height}, expected ${cell}x${cell} `
          + `(2 * (BUTTON_R ${BUTTON_R} + PAD_BLEED ${PAD_BLEED})) — rerun `
          + "`python scripts/build-atlases.py --pad`",
        );
      }
    }

    // Origin stays the default 0.5: the layout's x/y IS the circle's centre, so there is no origin
    // arithmetic anywhere and the art cannot drift off the hit test by half a button.
    this.buttons = this.specs.map((b) =>
      scene.add.image(b.x, b.y, PAD_ATLAS, frameFor(b.id, false)).setDepth(96).setScrollFactor(0),
    );
    this.labels = this.specs.map((b) =>
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
    // EVERY object goes in here: `MatchScene` spreads this into exactly one camera's ignore list, and
    // an object in neither list renders twice (e2e/mobile-touch.spec.ts audits every cameraFilter).
    this.objects = [...this.buttons, ...this.labels];

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

  /** Re-anchor the pad to a new game width. Writes BOTH copies of the layout — this class draws from
   *  `this.layout` and `TouchPadState` hit-tests against its own — because a pad whose art and hit
   *  test disagree is invisible to every desktop test and unplayable on the device. */
  layout(width: number): void {
    this.specs = touchLayout(width, STAGE_HEIGHT);
    this.state.setLayout(this.specs);
    for (const [i, b] of this.specs.entries()) {
      this.buttons[i].setPosition(b.x, b.y);
      this.labels[i].setPosition(b.x, b.y);
    }
    this.draw({} as TouchHeld);
  }

  setVisible(v: boolean): void {
    if (v === this.shown) return;
    this.shown = v;
    for (const b of this.buttons) b.setVisible(v);
    for (const t of this.labels) t.setVisible(v);
    // Hiding the art does NOT unsubscribe the scene-level listeners, so without this a hidden pad
    // keeps collecting contacts and hands them to the sim the moment it reappears.
    this.state.setActive(v);
    // Reset the art to idle WHILE HIDDEN, not on the way back. `consume()` skips drawing while hidden,
    // so a button that was visually down when the match ended would otherwise keep its pressed frame
    // in `lastHeld`, and the pad would reappear on a rematch showing a press nobody is making — for
    // one update, until the next `consume()` corrects it. Visual only, but it is a lie about input.
    if (!v) this.draw({} as TouchHeld);
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

  /** Swap frames for whatever CHANGED. The colours and the pressed bevel are baked into the atlas
   *  (`build-atlases.py --pad`), so this is now four possible frame names rather than a per-frame
   *  re-stroke of eight circles. `layout()` passes an empty object to force every button back to idle,
   *  which is correct: `setLayout` has just dropped the contacts. */
  private draw(held: Partial<TouchHeld>): void {
    for (const [i, b] of this.specs.entries()) {
      const on = held[b.id] === true;
      if (this.lastHeld[b.id] === on) continue;
      this.lastHeld[b.id] = on;
      this.buttons[i].setFrame(frameFor(b.id, on));
    }
  }
}
