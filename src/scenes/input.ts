import * as Phaser from "phaser";
import type { InputSnapshot } from "../sim/types";
import type { TouchHeld } from "../render/touch";

const KC = Phaser.Input.Keyboard.KeyCodes;

interface Binding {
  left: number;
  right: number;
  up: number;
  down: number;
  light: number;
  heavy: number;
  block: number;
  special: number;
}

// ponytail: hardcoded two-player layout. Rebindable config is a build-on-later item.
// Block is a dedicated key (not hold-back). Left/Right Shift can't be split (Phaser dispatches by
// keyCode; both are 16), so P1=Q, P2=/ — reachable from each hand's cluster.
// The meter special is its own key too: P1=E (above the WASD cluster, next to the block key Q),
// P2=M (left of P2's , / . attack pair). Both were free — B, 1-4, ENTER, ESC and R are taken by the
// scenes' own debug/menu bindings.
const P1: Binding = { left: KC.A, right: KC.D, up: KC.W, down: KC.S, light: KC.F, heavy: KC.G, block: KC.Q, special: KC.E };
const P2: Binding = { left: KC.LEFT, right: KC.RIGHT, up: KC.UP, down: KC.DOWN, light: KC.COMMA, heavy: KC.PERIOD, block: KC.FORWARD_SLASH, special: KC.M };

type Keys = Record<keyof Binding, Phaser.Input.Keyboard.Key>;

// EdgeLatch lives in its own Phaser-free module so it can be unit-tested in the node env; re-exported
// here so every existing `from "./input"` call site is unchanged.
export { EdgeLatch } from "./edge-latch";

export class InputReader {
  private keys: [Keys, Keys];
  private prev = [
    { up: false, light: false, heavy: false, special: false },
    { up: false, light: false, heavy: false, special: false },
  ];

  constructor(scene: Phaser.Scene) {
    const kb = scene.input.keyboard!;
    const make = (b: Binding): Keys => ({
      left: kb.addKey(b.left),
      right: kb.addKey(b.right),
      up: kb.addKey(b.up),
      down: kb.addKey(b.down),
      light: kb.addKey(b.light),
      heavy: kb.addKey(b.heavy),
      block: kb.addKey(b.block),
      special: kb.addKey(b.special),
    });
    this.keys = [make(P1), make(P2)];
  }

  /**
   * `touchHeld` is P1's on-screen pad (Phase 18), OR'd into the HELD flags before the edge
   * computation below — never alongside it. That is the whole integration: there is still exactly one
   * place in the codebase that turns "held this frame, not held last frame" into `*Pressed`, so touch
   * inherits the correct one-frame rising edge instead of re-deriving it and drifting. P2 is never
   * touch-driven: on a touch device P2 is always the CPU.
   */
  read(touchHeld?: Partial<TouchHeld>): [InputSnapshot, InputSnapshot] {
    return [this.readOne(0, touchHeld), this.readOne(1)];
  }

  private readOne(i: 0 | 1, t?: Partial<TouchHeld>): InputSnapshot {
    const k = this.keys[i];
    const up = k.up.isDown || t?.up === true;
    const light = k.light.isDown || t?.light === true;
    const heavy = k.heavy.isDown || t?.heavy === true;
    const special = k.special.isDown || t?.special === true;
    const p = this.prev[i];
    const snap: InputSnapshot = {
      left: k.left.isDown || t?.left === true,
      right: k.right.isDown || t?.right === true,
      up,
      down: k.down.isDown || t?.down === true,
      light,
      heavy,
      block: k.block.isDown || t?.block === true,
      special,
      upPressed: up && !p.up,
      lightPressed: light && !p.light,
      heavyPressed: heavy && !p.heavy,
      specialPressed: special && !p.special,
    };
    p.up = up;
    p.light = light;
    p.heavy = heavy;
    p.special = special;
    return snap;
  }
}
