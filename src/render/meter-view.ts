import { METER_MAX, meterFull } from "../sim/fighter";

/** How much of the slot an UNREADY meter may fill.
 *
 *  The super refuses below `METER_MAX` and gives no feedback at all when it does, so the bar is the
 *  only thing telling the player whether the move is available — and it was lying. Meter is paid as
 *  `+damage`, and the ground heavy pays the brawler 15 but jiujitsu and monk 14, so seven clean
 *  heavies leave those two on 98/100 (measured, not reasoned: 14,28,42,56,70,84,98). A straight
 *  `meter / METER_MAX` drew 98% of the slot — full width to the eye — and the ONLY difference from
 *  ready was the fill colour, which nothing on screen explains. Pressing the super then did nothing
 *  whatsoever, which reads as a broken move rather than an empty bar.
 *
 *  Compressing the unready range into the first 92% keeps the fill monotonic (progress still reads
 *  as progress) while making the last step to ready a jump you cannot miss. */
export const UNREADY_SPAN = 0.92;

export interface MeterView {
  /** Fraction of the slot to fill, entrance scaling included. */
  fillFrac: number;
  /** The SIM's answer: the super would come out on this tick's meter. Not a drawing instruction. */
  ready: boolean;
  /**
   * Whether to draw the ready cue — gold fill, pulse, `MAX` label.
   *
   * NOT the same as `ready`, and the difference is a defect that was caught in review. `ready` ignores
   * the entrance because it is about the sim's number, but the entrance scales the drawn bar from zero
   * — and `Fighter.meter` survives `reset()`, so a fighter who banks a full bar in round 1 starts
   * round 2's entrance ready with `fillFrac` at exactly 0 for the first 18 ticks. Keying the cue off
   * `ready` alone floated "MAX" over a visibly EMPTY meter for ~300 ms at the top of every later round:
   * the same "the cue disagrees with what is drawn" bug this module exists to fix, moved to the round
   * transition. The cue therefore waits until the bar it is labelling has actually finished charging.
   */
  showMax: boolean;
}

/** Phaser-free so the boundary can be tested in vitest's node env, like `hud-entrance.ts` and
 *  `anim-timing.ts`. `ready` defers to the sim's own `meterFull` rather than respelling `>= METER_MAX`,
 *  because the HUD and the sim disagreeing about that number is the whole defect. */
export function meterView(meter: number, entranceFrac = 1, max = METER_MAX): MeterView {
  const ready = max === METER_MAX ? meterFull(meter) : meter >= max;
  const raw = Math.max(0, Math.min(1, meter / max));
  const fillFrac = (ready ? 1 : raw * UNREADY_SPAN) * entranceFrac;
  return { ready, fillFrac, showMax: ready && fillFrac >= 1 };
}
