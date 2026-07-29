import type { Difficulty } from "../sim/cpu";
import { VIEW_WIDTH } from "../sim/constants";

// Pure, Phaser-free state machine behind FlowScene (title -> mode -> stage -> chars -> match).
// It lives in its own module for the same reason edge-latch.ts does: FlowScene imports Phaser, and
// vitest runs in the node env, so anything worth testing has to sit outside that import. Every
// function here is pure — it returns a NEW state and never mutates its argument. (The one piece of
// state this flow needs, the CPU's pick randomness, therefore lives in `roll.ts` and reaches
// `cpuPick` as a plain number.)

export type Step = "title" | "mode" | "stage" | "chars";

/**
 * The roster the character screen offers, IN CARD ORDER.
 *
 * Authored rather than derived from `Object.keys(registry)`, for two reasons that only bite later:
 * the card row has a fixed geometric budget (see `characterCardWidth`), and card order is what
 * decides which fighter each player's default cursor lands on — an artifact of JSON key order is a
 * bad way to make that decision. `flow-state.test.ts` cross-checks this against the shipped registry,
 * so a fighter that EXISTS but nobody can pick is a red test rather than a silent omission. That is
 * exactly how the monk sat unselectable from Phase 11 until Phase 16 with every gate green.
 */
export const SELECTABLE_IDS = ["brawler", "jiujitsu", "monk"];

/** Outer margin either side of the card row, and the gap between two cards. */
const CARD_MARGIN = 80;
const CARD_GAP = 60;
const CARD_MAX_W = 300;

/**
 * How wide each character card may be so the whole row fits the viewport.
 *
 * Lives here, not in FlowScene, so it is the SAME arithmetic a test can exercise: a test that
 * re-computed the budget locally would stay green while the scene regressed, which is the
 * "a metric that cannot fail is decoration" trap. At n <= 3 the min() picks 300 and the layout is
 * byte-identical to the hand-authored constant it replaces; a 4th fighter shrinks the row instead of
 * hanging the outer cards off the canvas.
 */
export function characterCardWidth(count: number): number {
  const n = Math.max(count, 1);
  return Math.min(CARD_MAX_W, Math.floor((VIEW_WIDTH - CARD_MARGIN - (n - 1) * CARD_GAP) / n));
}
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

/**
 * What the mode screen actually offers (Phase 18).
 *
 * Local 1v1 needs two players on one keyboard, which a phone does not have and a handset cannot be
 * shared for — offering it on touch is offering a mode that cannot be played. Every consumer of the
 * mode list goes through here rather than reading `MODE_OPTIONS` directly, because `modeIndex` is a
 * raw index: the drawing, the movement wrap, and `modeOf` must all index the SAME array or index 1
 * means "CPU easy" to one of them and "1v1" to another.
 */
export function modeOptions(touch: boolean): ModeOption[] {
  return touch ? MODE_OPTIONS.filter((o) => o.mode !== "1v1") : MODE_OPTIONS;
}

export interface FlowState {
  step: Step;
  modeIndex: number;
  stageIndex: number;
  /** which roster card each player's cursor sits on */
  cursors: [number, number];
  locked: [boolean, boolean];
  /** touch-primary device: the mode screen drops local PvP. Fixed for the life of the flow. */
  touch: boolean;
}

/** What FlowScene hands MatchScene through scene.start("Match", cfg). */
export interface MatchConfig {
  mode: Mode;
  difficulty: Difficulty;
  stageId: string;
  fighters: [string, string];
}

const STEPS: Step[] = ["title", "mode", "stage", "chars"];

export function initialFlow(touch = false): FlowState {
  return { step: "title", modeIndex: 0, stageIndex: 0, cursors: [0, 1], locked: [false, false], touch };
}

export const modeOf = (s: FlowState): ModeOption => {
  const opts = modeOptions(s.touch);
  return opts[wrap(s.modeIndex, opts.length)];
};
export const isCpu = (s: FlowState): boolean => modeOf(s).mode === "cpu";

const wrap = (i: number, n: number): number => ((i % n) + n) % n;

/** Single-cursor movement for the mode/stage screens (either player's keys drive it). */
export function moveMenu(s: FlowState, dir: number, count: number): FlowState {
  if (s.step === "mode") return { ...s, modeIndex: wrap(s.modeIndex + dir, modeOptions(s.touch).length) };
  if (s.step === "stage") return { ...s, stageIndex: wrap(s.stageIndex + dir, count) };
  return s;
}

/**
 * Character-select movement, with the same-character lockout.
 *
 * Written for an N-card roster, and Phase 16's third card is what finally exercises it: the two-card
 * case is the DEGENERATE one and reads as a special rule only until you write the general one:
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

/**
 * Put a player's cursor on a specific card — what a TAP means, since a tap is positional where a key
 * is directional (Phase 18).
 *
 * Shares `moveChar`'s rules rather than restating them: a locked player cannot move, and landing on
 * the opponent's card either SWAPS with them or is refused if they are locked. Written as one call to
 * `moveChar` with the signed distance would not do — the swap rule is about the DESTINATION, not the
 * path — so the two branches are spelled out here and pinned by the same tests.
 */
export function setChar(s: FlowState, player: Player, index: number, count: number): FlowState {
  if (s.step !== "chars" || s.locked[player] || count < 1) return s;
  const target = wrap(index, count);
  const opp: Player = player === 0 ? 1 : 0;
  if (target === s.cursors[player]) return s;
  const cursors: [number, number] = [s.cursors[0], s.cursors[1]];
  if (target === cursors[opp]) {
    if (s.locked[opp]) return s; // their card, and they have committed to it
    cursors[opp] = cursors[player]; // swap: push them onto the card being vacated
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

/**
 * In CPU mode, park P1's opponent on a card P1 has NOT taken, then lock it.
 *
 * `roll` is a sample in **[0, 1)** the CALLER supplies — the randomness lives in `roll.ts` so this
 * module keeps its no-Math.random, no-Date.now promise and a test can pin an exact pick with an exact
 * number. The draw is uniform over the untaken cards:
 *
 *     offset = 1 + floor(roll * (count - 1));   pick = wrap(taken + offset, count)
 *
 * The predecessor was `wrap(taken + 1, count)`, i.e. always the card immediately to the player's
 * right. On the two-card roster Phase 11 shipped that is the only legal answer, so it read as correct;
 * with Phase 16's three it meant the monk was unreachable unless the player sat on the jiujitsu.
 *
 * `roll` is CLAMPED rather than trusted: an exact 1 (or a NaN from a broken generator) would push the
 * offset to `count`, wrap back onto the player's own card, and hand both players the same fighter —
 * the single thing this function exists to prevent.
 */
export function cpuPick(s: FlowState, count: number, roll = 0): FlowState {
  const n = Math.max(count, 1);
  const taken = wrap(s.cursors[0], n);
  // A one-card roster has no other card to take; lock the mirror rather than inventing an index.
  if (n < 2) return { ...s, cursors: [taken, taken], locked: [s.locked[0], true] };
  const safe = Number.isFinite(roll) ? Math.min(0.999999, Math.max(0, roll)) : 0;
  const offset = 1 + Math.floor(safe * (n - 1));
  return { ...s, cursors: [taken, wrap(taken + offset, n)], locked: [s.locked[0], true] };
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
