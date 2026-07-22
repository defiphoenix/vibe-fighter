import * as Phaser from "phaser";
import type { InputSnapshot } from "../sim/types";

const KC = Phaser.Input.Keyboard.KeyCodes;

interface Binding {
  left: number;
  right: number;
  up: number;
  down: number;
  light: number;
  heavy: number;
  block: number;
}

// ponytail: hardcoded two-player layout. Rebindable config is a build-on-later item.
// Block is a dedicated key (not hold-back). Left/Right Shift can't be split (Phaser dispatches by
// keyCode; both are 16), so P1=Q, P2=/ — reachable from each hand's cluster.
const P1: Binding = { left: KC.A, right: KC.D, up: KC.W, down: KC.S, light: KC.F, heavy: KC.G, block: KC.Q };
const P2: Binding = { left: KC.LEFT, right: KC.RIGHT, up: KC.UP, down: KC.DOWN, light: KC.COMMA, heavy: KC.PERIOD, block: KC.FORWARD_SLASH };

type Keys = Record<keyof Binding, Phaser.Input.Keyboard.Key>;

// EdgeLatch lives in its own Phaser-free module so it can be unit-tested in the node env; re-exported
// here so every existing `from "./input"` call site is unchanged.
export { EdgeLatch } from "./edge-latch";

export class InputReader {
  private keys: [Keys, Keys];
  private prev = [
    { up: false, light: false, heavy: false },
    { up: false, light: false, heavy: false },
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
    });
    this.keys = [make(P1), make(P2)];
  }

  read(): [InputSnapshot, InputSnapshot] {
    return [this.readOne(0), this.readOne(1)];
  }

  private readOne(i: 0 | 1): InputSnapshot {
    const k = this.keys[i];
    const up = k.up.isDown;
    const light = k.light.isDown;
    const heavy = k.heavy.isDown;
    const p = this.prev[i];
    const snap: InputSnapshot = {
      left: k.left.isDown,
      right: k.right.isDown,
      up,
      down: k.down.isDown,
      light,
      heavy,
      block: k.block.isDown,
      upPressed: up && !p.up,
      lightPressed: light && !p.light,
      heavyPressed: heavy && !p.heavy,
    };
    p.up = up;
    p.light = light;
    p.heavy = heavy;
    return snap;
  }
}
