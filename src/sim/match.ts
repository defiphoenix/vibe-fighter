import { ROUND_TIME, ROUNDS_TO_WIN, TICK_HZ, INTRO_TICKS, ROUND_END_TICKS } from "./constants";

export type MatchPhase = "intro" | "fight" | "roundEnd" | "matchEnd";

export class MatchState {
  phase: MatchPhase = "intro";
  introTicks = INTRO_TICKS;
  endTicks = 0;
  timerTicks = ROUND_TIME * TICK_HZ;
  round = 1;
  wins: [number, number] = [0, 0];
  lastRoundWinner: 0 | 1 | null = null; // null = draw
  matchWinner: 0 | 1 | null = null;

  /** seconds left on the clock, for HUD */
  get secondsLeft(): number {
    return Math.ceil(this.timerTicks / TICK_HZ);
  }

  beginRound(): void {
    this.phase = "intro";
    this.introTicks = INTRO_TICKS;
    this.timerTicks = ROUND_TIME * TICK_HZ;
    this.lastRoundWinner = null;
  }

  /** Record a round result; returns true if the match is now over. */
  endRound(winner: 0 | 1 | null): boolean {
    this.lastRoundWinner = winner;
    if (winner !== null) this.wins[winner]++;
    if (this.wins[0] >= ROUNDS_TO_WIN || this.wins[1] >= ROUNDS_TO_WIN) {
      this.matchWinner = this.wins[0] > this.wins[1] ? 0 : 1;
      this.phase = "matchEnd";
      return true;
    }
    this.phase = "roundEnd";
    this.endTicks = ROUND_END_TICKS;
    return false;
  }
}
