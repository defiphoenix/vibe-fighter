import { describe, it, expect } from "vitest";
import { World } from "../sim/world";
import { FIGHTER_A, FIGHTER_B } from "../sim/config";
import { EdgeLatch } from "./edge-latch";
import { emptyInput, type InputSnapshot } from "../sim/types";
import { GROUND_Y } from "../sim/constants";

// Integration test for the input-buffer fix (reported as "attacks don't always work in the
// Playground, especially the monk"). It mirrors the MatchScene/PlaygroundScene adapter loop EXACTLY:
//   latch.apply -> world.advance(one tick) -> latch.consume(world.consumedInputs)
// so it exercises the real sim+latch path in the node env (no Phaser). Root cause was the old
// `if (ticks > 0) latch.clear()`: tick() returns true for EVERY fight tick, even one where the
// fighter was locked in an attack and think() ignored the press — so the heavy pressed during the
// light's 15-frame animation was cleared unconsumed and never came out.

function fight(): World {
  const w = new World(FIGHTER_A, FIGHTER_B);
  w.match.phase = "fight";
  w.match.introTicks = 0;
  return w;
}

/** One render frame == one tick (dt = 1/60), driven through the real adapter path. */
function frame(w: World, latch: EdgeLatch, press: Partial<InputSnapshot> = {}): string {
  const inputs: [InputSnapshot, InputSnapshot] = [
    latch.apply(0, { ...emptyInput(), ...press }),
    emptyInput(),
  ];
  w.advance(1 / 60, inputs);
  latch.consume(0, w.consumedInputs[0]);
  return w.fighters[0].state;
}

describe("attack input buffering (latch consume)", () => {
  it("a heavy pressed while the light is still animating still comes out", () => {
    const w = fight();
    const latch = new EdgeLatch();
    // attackLight is 15 frames (startup 4 + active 3 + recovery 8).
    expect(frame(w, latch, { lightPressed: true })).toBe("attackLight");
    // Press heavy a few frames into the light — think() ignores it (fighter is locked), so it must
    // stay buffered rather than be thrown away.
    frame(w, latch); // frame 2 of the light
    frame(w, latch, { heavyPressed: true }); // heavy pressed mid-light
    const seen: string[] = [];
    for (let i = 0; i < 40; i++) seen.push(frame(w, latch));
    expect(seen).toContain("attackHeavy"); // the buffered heavy fired once the light recovered
  });

  it("a single attack press produces exactly ONE attack, never a re-fire", () => {
    const w = fight();
    const latch = new EdgeLatch();
    const states: string[] = [frame(w, latch, { heavyPressed: true })];
    for (let i = 0; i < 60; i++) states.push(frame(w, latch)); // then nothing held
    // Count how many times the state ENTERS attackHeavy. If the consumed edge weren't cleared it
    // would re-fire the instant the fighter returned to idle.
    let episodes = 0;
    for (let i = 0; i < states.length; i++) {
      if (states[i] === "attackHeavy" && (i === 0 || states[i - 1] !== "attackHeavy")) episodes++;
    }
    expect(episodes).toBe(1);
    expect(states[states.length - 1]).toBe("idle"); // and it ends back at rest, not looping attacks
  });

  it("one press fires only ONCE when an action recovers mid-batch (air normal that lands)", () => {
    // The multi-tick replay Codex flagged: within ONE advance() the raw snapshot is reused every
    // tick. A fighter 1px above the ground presses light -> starts airLight -> lands the SAME tick
    // (onLand -> idle). Without masking the still-set lightPressed then fires a second, GROUNDED
    // normal on the next tick of the same batch — two attacks from one press.
    const w = fight();
    w.fighters[0].x = 400; // far from the dummy: whiff, no hitstop to muddy timing
    w.fighters[1].x = 1200;
    w.fighters[0].grounded = false;
    w.fighters[0].y = GROUND_Y - 1; // just above the floor, so it lands on the first tick
    w.fighters[0].vy = 200; // moving down
    const latch = new EdgeLatch();
    const inputs: [InputSnapshot, InputSnapshot] = [
      latch.apply(0, { ...emptyInput(), lightPressed: true }),
      emptyInput(),
    ];
    w.advance(3 / 60, inputs); // 3 ticks in one batch — room for the land + a would-be replay
    latch.consume(0, w.consumedInputs[0]);
    // Masked: idle after the air normal + landing. Unmasked (the bug): a second grounded attackLight.
    expect(w.fighters[0].state).toBe("idle");
  });

  it("a press buffered during the intro still fires on the first fight tick (unchanged)", () => {
    const w = new World(FIGHTER_A, FIGHTER_B); // starts in intro
    const latch = new EdgeLatch();
    w.match.introTicks = 3;
    // Press during intro: no think runs, nothing consumed, the edge must survive.
    frame(w, latch, { heavyPressed: true });
    let state = "";
    for (let i = 0; i < 6; i++) state = frame(w, latch);
    // After the intro elapses the buffered heavy comes out.
    expect(["attackHeavy", "idle"]).toContain(state); // fired then possibly recovered within the window
    // Prove it actually fired at some point.
    const w2 = new World(FIGHTER_A, FIGHTER_B);
    const l2 = new EdgeLatch();
    w2.match.introTicks = 2;
    const seq = [frame(w2, l2, { heavyPressed: true })];
    for (let i = 0; i < 10; i++) seq.push(frame(w2, l2));
    expect(seq).toContain("attackHeavy");
  });
});
