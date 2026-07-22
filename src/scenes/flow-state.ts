import type { Difficulty } from "../sim/cpu";

// Pure, Phaser-free state machine behind FlowScene (title -> mode -> stage -> chars -> match).
// It lives in its own module for the same reason edge-latch.ts does: FlowScene imports Phaser, and
// vitest runs in the node env, so anything worth testing has to sit outside that import. Every
// function here is pure — it returns a NEW state and never mutates its argument.

export type Step = "title" | "mode" | "stage" | "chars";
export type Mode = "1v1" | "cpu";
export type Player = 0 | 1;

/** One card on the mode screen. CPU difficulty is a mode card, not its own screen. */
export interface ModeOption {
  label: string;
  mode: Mode;
  difficulty: Difficulty;
}

export const MODE_OPTIONS: ModeOption[] = [
  { label: "1 vs 1", mode: "1v1", difficulty: "normal" },
  { label: "CPU · EASY", mode: "cpu", difficulty: "easy" },
  { label: "CPU · NORMAL", mode: "cpu", difficulty: "normal" },
  { label: "CPU · HARD", mode: "cpu", difficulty: "hard" },
];

export interface FlowState {
  step: Step;
  modeIndex: number;
  stageIndex: number;
  /** which roster card each player's cursor sits on */
  cursors: [number, number];
  locked: [boolean, boolean];
}

/** What FlowScene hands MatchScene through scene.start("Match", cfg). */
export interface MatchConfig {
  mode: Mode;
  difficulty: Difficulty;
  stageId: string;
  fighters: [string, string];
}

const STEPS: Step[] = ["title", "mode", "stage", "chars"];

export function initialFlow(): FlowState {
  return { step: "title", modeIndex: 0, stageIndex: 0, cursors: [0, 1], locked: [false, false] };
}

export const modeOf = (s: FlowState): ModeOption => MODE_OPTIONS[s.modeIndex];
export const isCpu = (s: FlowState): boolean => modeOf(s).mode === "cpu";

const wrap = (i: number, n: number): number => ((i % n) + n) % n;

/** Single-cursor movement for the mode/stage screens (either player's keys drive it). */
export function moveMenu(s: FlowState, dir: number, count: number): FlowState {
  if (s.step === "mode") return { ...s, modeIndex: wrap(s.modeIndex + dir, MODE_OPTIONS.length) };
  if (s.step === "stage") return { ...s, stageIndex: wrap(s.stageIndex + dir, count) };
  return s;
}

/**
 * Character-select movement, with the same-character lockout.
 *
 * Written for an N-card roster even though Phase 11 ships two (Phase 16 restores the monk), because
 * the two-card case is the DEGENERATE one and reads as a special rule only until you write the
 * general one:
 *  - the opponent is unlocked -> SWAP: you take their card, they are pushed onto the one you vacated
 *    (the recipe's "moving the selection just swaps them since there's no room");
 *  - the opponent is LOCKED -> skip over their card and keep going in the same direction; with two
 *    cards that lands back on your own, which means there is nowhere to go and the move is refused.
 * A locked player cannot move at all.
 */
export function moveChar(s: FlowState, player: Player, dir: number, count: number): FlowState {
  if (s.step !== "chars" || s.locked[player] || count < 1) return s;
  const opp: Player = player === 0 ? 1 : 0;
  const cursors: [number, number] = [s.cursors[0], s.cursors[1]];
  let target = wrap(cursors[player] + dir, count);

  if (target === cursors[opp]) {
    if (s.locked[opp]) {
      const skipped = wrap(target + dir, count);
      if (skipped === cursors[player]) return s; // nowhere free to land
      target = skipped;
    } else {
      cursors[opp] = cursors[player]; // swap: push them onto the card being vacated
    }
  }
  cursors[player] = target;
  return { ...s, cursors };
}

/** Lock a player's pick. In CPU mode only player 0 locks; cpuPick decides player 1. */
export function lock(s: FlowState, player: Player): FlowState {
  if (s.step !== "chars" || s.locked[player]) return s;
  const locked: [boolean, boolean] = [s.locked[0], s.locked[1]];
  locked[player] = true;
  return { ...s, locked };
}

/** In CPU mode, park P1's opponent on a card P1 has not taken, then lock it. */
export function cpuPick(s: FlowState, count: number): FlowState {
  const taken = s.cursors[0];
  const pick = wrap(taken + 1, count);
  return { ...s, cursors: [taken, pick], locked: [s.locked[0], true] };
}

export const bothLocked = (s: FlowState): boolean => s.locked[0] && s.locked[1];

/** Forward: title -> mode -> stage -> chars. The chars step ends by starting the match, not here. */
export function advance(s: FlowState): FlowState {
  const i = STEPS.indexOf(s.step);
  if (i < 0 || i >= STEPS.length - 1) return s;
  return { ...s, step: STEPS[i + 1], locked: [false, false] };
}

/**
 * Back one step — or, on the character screen, un-lock first: pressing back with a lock down means
 * "I changed my mind about my pick", not "take me to stage select".
 *
 * Re-entering a step ALWAYS clears both locks. A lock left over from a previous visit is exactly how
 * a select screen ends up refusing to move with no visible reason.
 */
export function back(s: FlowState, player: Player = 0): FlowState {
  if (s.step === "chars" && s.locked[player]) {
    const locked: [boolean, boolean] = [s.locked[0], s.locked[1]];
    locked[player] = false;
    // A CPU pick only exists because the human locked; dropping the human's lock drops it too.
    if (isCpu(s)) locked[1] = false;
    return { ...s, locked };
  }
  const i = STEPS.indexOf(s.step);
  if (i <= 0) return s;
  return { ...s, step: STEPS[i - 1], locked: [false, false], cursors: [0, 1] };
}

/** Build the config MatchScene boots from. Throws rather than shipping a half-valid match. */
export function toMatchConfig(s: FlowState, roster: string[], stageIds: string[]): MatchConfig {
  const opt = modeOf(s);
  const stageId = stageIds[wrap(s.stageIndex, stageIds.length)];
  const a = roster[wrap(s.cursors[0], roster.length)];
  const b = roster[wrap(s.cursors[1], roster.length)];
  if (!stageId || !a || !b) throw new Error("flow: incomplete selection");
  return { mode: opt.mode, difficulty: opt.difficulty, stageId, fighters: [a, b] };
}
