import { describe, expect, it } from "vitest";
import registry from "../../public/configs/character-gym.json";
import { VIEW_WIDTH } from "../sim/constants";
import {
  MODE_OPTIONS, SELECTABLE_IDS, advance, back, bothLocked, characterCardWidth, cpuPick, initialFlow,
  isCpu, lock, modeOf, modeOptions, moveChar, moveMenu, setChar, toMatchConfig,
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

describe("the selectable roster", () => {
  // `_`-prefixed keys are metadata, dropped the same way render/characters.ts:loadRegistry drops
  // them. Filtering differently here would invent a failure that the game never has.
  const shipped = Object.keys(registry).filter((k) => !k.startsWith("_"));

  it("offers every fighter the registry ships — a built fighter nobody can pick is the Phase 11 bug", () => {
    expect([...SELECTABLE_IDS].sort()).toEqual([...shipped].sort());
  });

  it("fits the whole card row inside the viewport", () => {
    const n = SELECTABLE_IDS.length;
    const row = n * characterCardWidth(n) + (n - 1) * 60;
    expect(row).toBeLessThanOrEqual(VIEW_WIDTH);
  });

  it("keeps the shipped three cards at the hand-authored 300px, and shrinks rather than overflow", () => {
    expect(characterCardWidth(2)).toBe(300);
    expect(characterCardWidth(3)).toBe(300); // 3*300 + 2*60 = 1020 <= 1280
    expect(characterCardWidth(4)).toBeLessThan(300); // 4*300 + 3*60 = 1380 would hang off the canvas
    expect(4 * characterCardWidth(4) + 3 * 60).toBeLessThanOrEqual(VIEW_WIDTH);
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

  // The old rule was `wrap(taken + 1, count)` — always the card immediately right of the player. On a
  // two-card roster that is the only legal answer, so it looked correct for two phases; with three it
  // means the CPU can NEVER pick the monk unless the player happens to sit on the jiujitsu. The pick
  // is now a uniform draw over the untaken cards, sampled by the caller so this module stays pure.
  it("can reach EVERY untaken card on a three-card roster, not just the next one", () => {
    const s = lock(chars(1), 0); // player on card 0, so free = [1, 2]
    expect(cpuPick(s, 3, 0).cursors[1]).toBe(1);
    expect(cpuPick(s, 3, 0.99).cursors[1]).toBe(2);
  });

  it("splits the roll range evenly between the two free cards", () => {
    const s = lock(chars(1), 0);
    expect(cpuPick(s, 3, 0.49).cursors[1]).toBe(1);
    expect(cpuPick(s, 3, 0.5).cursors[1]).toBe(2);
  });

  it("skips the player's own card wherever it sits, including the last one", () => {
    const last = lock(chars(1, { cursors: [2, 0] }), 0);
    expect(cpuPick(last, 3, 0).cursors[1]).toBe(0);
    expect(cpuPick(last, 3, 0.99).cursors[1]).toBe(1);
    const middle = lock(chars(1, { cursors: [1, 0] }), 0);
    expect(cpuPick(middle, 3, 0).cursors[1]).toBe(2);
    expect(cpuPick(middle, 3, 0.99).cursors[1]).toBe(0);
  });

  // roll is half-open [0, 1). An exact 1 would index one past the last free card, wrap back onto the
  // player's own card and hand both players the same fighter — the one thing this function exists to
  // prevent. Clamped rather than trusted, because the caller is a float generator.
  it("never hands both players the same card, at either end of the roll range", () => {
    for (const roll of [0, 0.5, 0.999999, 1, 1.5, -0.5, NaN]) {
      for (const count of [2, 3, 4]) {
        for (const at of [0, 1]) {
          const s = lock(chars(1, { cursors: [at, 0] }), 0);
          const picked = cpuPick(s, count, roll);
          expect(picked.cursors[1], `roll ${roll} count ${count} player ${at}`).not.toBe(at);
          expect(picked.cursors[1]).toBeGreaterThanOrEqual(0);
          expect(picked.cursors[1]).toBeLessThan(count);
        }
      }
    }
  });

  it("locks the CPU even on a one-card roster, rather than picking the player's own fighter", () => {
    const s = lock(chars(1), 0);
    const picked = cpuPick(s, 1, 0.9);
    expect(bothLocked(picked)).toBe(true);
    expect(picked.cursors[0]).toBe(0);
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

describe("touch mode (Phase 18)", () => {
  /** Two people cannot share one handset. Offering local PvP on a phone offers a mode that cannot
   *  be played — and the CPU cards are the only ones that can. */
  it("drops local 1v1 from the mode screen on a touch device, and only there", () => {
    expect(modeOptions(true).map((o) => o.mode)).toEqual(["cpu", "cpu", "cpu"]);
    expect(modeOptions(true).some((o) => o.label === "1 vs 1")).toBe(false);
    expect(modeOptions(false)).toEqual(MODE_OPTIONS);
  });

  /** `modeIndex` is a RAW index. If the drawing, the wrap and `modeOf` do not all read the same
   *  array, index 1 means "CPU easy" to one of them and "1 vs 1" to another. */
  it("wraps the cursor over three cards on touch and four on desktop", () => {
    let t: FlowState = { ...initialFlow(true), step: "mode" };
    expect(modeOf(t).mode).toBe("cpu");
    t = moveMenu(moveMenu(moveMenu(t, 1, 0), 1, 0), 1, 0);
    expect(t.modeIndex).toBe(0); // three steps is a full lap
    expect(modeOf(moveMenu({ ...initialFlow(true), step: "mode" }, -1, 0)).difficulty).toBe("hard");

    let d: FlowState = { ...initialFlow(), step: "mode" };
    d = moveMenu(moveMenu(moveMenu(d, 1, 0), 1, 0), 1, 0);
    expect(d.modeIndex).toBe(3);
    expect(modeOf(d).difficulty).toBe("hard");
  });

  it("a touch flow is always a CPU match, whichever card is picked", () => {
    for (let i = 0; i < 3; i++) expect(isCpu({ ...initialFlow(true), step: "mode", modeIndex: i })).toBe(true);
  });

  /** `back()` rebuilds the state object; losing `touch` there would silently restore PvP one Esc
   *  into the flow. */
  it("carries the touch flag through advance and back", () => {
    const s = advance(advance(initialFlow(true)));
    expect(s.touch).toBe(true);
    expect(back(s).touch).toBe(true);
    expect(back(back(s)).touch).toBe(true);
  });

  it("still boots a real match config from a touch flow", () => {
    const s = cpuPick(lock({ ...chars(2, { touch: true }), stageIndex: 1 }, 0), 2);
    expect(toMatchConfig(s, ROSTER, STAGES)).toEqual({
      mode: "cpu",
      difficulty: "hard", // index 2 of the FILTERED list
      stageId: "sunset",
      fighters: ["brawler", "jiujitsu"],
    });
  });
});

describe("setChar — a tap is positional where a key is directional", () => {
  it("puts the cursor straight on a free card", () => {
    expect(setChar(chars(), 0, 2, 3).cursors).toEqual([2, 1]);
  });

  it("swaps with an unlocked opponent, exactly as moving onto them does", () => {
    expect(setChar(chars(), 0, 1, 3).cursors).toEqual([1, 0]);
  });

  it("refuses a locked opponent's card rather than doubling up", () => {
    const s = chars(0, { locked: [false, true] });
    expect(setChar(s, 0, 1, 3)).toBe(s);
  });

  it("freezes a locked player, and does nothing outside the chars step", () => {
    const locked = chars(0, { locked: [true, false] });
    expect(setChar(locked, 0, 2, 3)).toBe(locked);
    const mode = { ...initialFlow(), step: "mode" as const };
    expect(setChar(mode, 0, 2, 3)).toBe(mode);
  });

  it("does not mutate the state it is given", () => {
    const s = chars();
    const before = JSON.stringify(s);
    setChar(s, 0, 2, 3);
    expect(JSON.stringify(s)).toBe(before);
  });
});
