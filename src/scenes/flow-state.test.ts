import { describe, expect, it } from "vitest";
import {
  MODE_OPTIONS, advance, back, bothLocked, cpuPick, initialFlow, isCpu, lock, modeOf, moveChar,
  moveMenu, toMatchConfig,
} from "./flow-state";
import type { FlowState } from "./flow-state";

const ROSTER = ["brawler", "jiujitsu"];
const STAGES = ["twilight", "sunset"];

/** Jump straight to the character screen with the given mode card selected. */
function chars(modeIndex = 0, over: Partial<FlowState> = {}): FlowState {
  return { ...initialFlow(), step: "chars", modeIndex, ...over };
}

describe("flow steps", () => {
  it("advances title -> mode -> stage -> chars and stops", () => {
    let s = initialFlow();
    expect(s.step).toBe("title");
    s = advance(s);
    expect(s.step).toBe("mode");
    s = advance(s);
    expect(s.step).toBe("stage");
    s = advance(s);
    expect(s.step).toBe("chars");
    expect(advance(s).step).toBe("chars");
  });

  it("backs out of every step and stops at the title", () => {
    let s = chars();
    s = back(s);
    expect(s.step).toBe("stage");
    s = back(s);
    expect(s.step).toBe("mode");
    s = back(s);
    expect(s.step).toBe("title");
    expect(back(s).step).toBe("title");
  });

  it("clears locks when a step is re-entered, so a stale lock can't freeze the screen", () => {
    const locked = lock(lock(chars(), 0), 1);
    expect(bothLocked(locked)).toBe(true);
    const reentered = advance(back(back(locked))); // chars -> unlock P1 -> stage -> chars
    expect(reentered.locked).toEqual([false, false]);
    expect(back(locked).locked).toEqual([false, true]); // first back only drops the presser's lock
  });

  it("does not mutate the state it is given", () => {
    const s = chars();
    const before = JSON.stringify(s);
    moveChar(s, 0, 1, ROSTER.length);
    lock(s, 0);
    advance(s);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("mode + stage cursors", () => {
  it("wraps the mode cursor over all four cards", () => {
    let s: FlowState = { ...initialFlow(), step: "mode" };
    expect(modeOf(s).mode).toBe("1v1");
    s = moveMenu(s, -1, 0);
    expect(s.modeIndex).toBe(MODE_OPTIONS.length - 1);
    expect(modeOf(s).difficulty).toBe("hard");
    expect(isCpu(s)).toBe(true);
    s = moveMenu(s, 1, 0);
    expect(s.modeIndex).toBe(0);
    expect(isCpu(s)).toBe(false);
  });

  it("wraps the stage cursor over the supplied stage count", () => {
    let s: FlowState = { ...initialFlow(), step: "stage" };
    s = moveMenu(s, 1, STAGES.length);
    expect(s.stageIndex).toBe(1);
    s = moveMenu(s, 1, STAGES.length);
    expect(s.stageIndex).toBe(0);
  });
});

describe("character select", () => {
  it("swaps the two players when P1 moves onto an unlocked P2", () => {
    const s = moveChar(chars(), 0, 1, 2);
    expect(s.cursors).toEqual([1, 0]);
  });

  it("swaps symmetrically when P2 moves", () => {
    const s = moveChar(chars(), 1, -1, 2);
    expect(s.cursors).toEqual([1, 0]);
  });

  it("refuses the move when the opponent is locked and there is nowhere free", () => {
    const s = moveChar(lock(chars(), 1), 0, 1, 2);
    expect(s.cursors).toEqual([0, 1]);
    expect(s.locked).toEqual([false, true]);
  });

  it("skips OVER a locked opponent when the roster has room (Phase 16's three fighters)", () => {
    const s = moveChar(lock(chars(0, { cursors: [0, 1] }), 1), 0, 1, 3);
    expect(s.cursors).toEqual([2, 1]);
  });

  it("freezes a locked player's own cursor", () => {
    const s = moveChar(lock(chars(), 0), 0, 1, 2);
    expect(s.cursors).toEqual([0, 1]);
  });

  it("never lets both players hold the same card", () => {
    let s = chars();
    for (const [player, dir] of [[0, 1], [1, 1], [0, -1], [1, -1], [0, 1]] as const) {
      s = moveChar(s, player, dir, 2);
      expect(s.cursors[0]).not.toBe(s.cursors[1]);
    }
  });

  it("ignores movement outside the chars step", () => {
    const s = { ...initialFlow(), step: "stage" as const };
    expect(moveChar(s, 0, 1, 2).cursors).toEqual([0, 1]);
  });
});

describe("cpu mode", () => {
  it("parks the CPU on a card the player did not take, and locks it", () => {
    const s = cpuPick(lock(chars(1), 0), 2);
    expect(s.cursors[1]).not.toBe(s.cursors[0]);
    expect(bothLocked(s)).toBe(true);
  });

  it("drops the CPU's lock when the player un-locks — the pick only existed because they locked", () => {
    const s = back(cpuPick(lock(chars(1), 0), 2), 0);
    expect(s.locked).toEqual([false, false]);
    expect(s.step).toBe("chars");
  });
});

describe("toMatchConfig", () => {
  it("carries the chosen mode, difficulty, stage and both fighters", () => {
    const s = cpuPick(lock({ ...chars(3), stageIndex: 1 }, 0), 2);
    const cfg = toMatchConfig(s, ROSTER, STAGES);
    expect(cfg).toEqual({
      mode: "cpu",
      difficulty: "hard",
      stageId: "sunset",
      fighters: ["brawler", "jiujitsu"],
    });
  });

  it("throws rather than booting a match with an empty roster", () => {
    expect(() => toMatchConfig(chars(), [], STAGES)).toThrow(/incomplete/);
  });
});
