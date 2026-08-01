import { Fighter } from "./fighter";
import { resolveSpatial } from "./spatial";
import { resolveCombat } from "./combat";
import { MatchState } from "./match";
import { emptyInput, isAttackState, isWalkState } from "./types";
import type { CharacterConfig, InputSnapshot, SimEvent } from "./types";
import { STAGE_WIDTH, GROUND_Y, START_GAP, MAX_FRAME, DT } from "./constants";

const CENTER = STAGE_WIDTH / 2;
const EMPTY = emptyInput();

/** A non-human input source for one fighter, consulted once per TICK (never per render frame).
 *  Kept as an interface so sim/ owns the contract and never has to import the controller. */
export interface CpuSeam {
  readonly index: 0 | 1;
  next(world: World): InputSnapshot;
  /** Drop per-round state. Called by the world whenever the round resets — the controller outlives
   *  the round and the transition happens inside tick(), where the render layer cannot see it. */
  reset?(): void;
}

/** The whole deterministic simulation. No Phaser here. Advance by fixed 60 Hz ticks. */
export class World {
  readonly fighters: [Fighter, Fighter];
  readonly match = new MatchState();
  hitstop = 0;
  frontIndex: 0 | 1 = 1; // which fighter renders in front (stable tie-break)
  events: SimEvent[] = []; // drained by the render layer each frame
  /** Which latched edges each fighter's think() consumed during the LAST advance() call (OR-accumulated
   *  across its ticks). The render latch clears exactly these — NOT "any fight tick ran" — so a press
   *  the fighter couldn't act on (locked in an attack/stun) stays buffered until it can. */
  readonly consumedInputs: [
    { up: boolean; light: boolean; heavy: boolean; special: boolean },
    { up: boolean; light: boolean; heavy: boolean; special: boolean },
  ] = [
    { up: false, light: false, heavy: false, special: false },
    { up: false, light: false, heavy: false, special: false },
  ];
  /** Was each fighter knocked OUT of a special during the LAST advance() call (OR-accumulated across
   *  its ticks, same shape and same lifetime as `consumedInputs` above)?
   *
   *  Read by the render layer's audio to cut the super sting when the move it announced stops
   *  happening. It has to be accumulated here rather than derived from state at the render edge: a
   *  frame can drain 15 ticks, and a frame that contains the special's last tick AND a hit landing
   *  afterwards looks exactly like an interruption from outside. See `Fighter.interruptedSpecial`. */
  readonly interruptedSpecials: [boolean, boolean] = [false, false];

  private accumulator = 0;
  /** last seam handed to advance(), so a round reset can clear it. */
  private cpuSeam?: CpuSeam;

  constructor(cfgA: CharacterConfig, cfgB: CharacterConfig) {
    this.fighters = [new Fighter(cfgA, 0), new Fighter(cfgB, 1)];
    this.resetRound();
    this.match.beginRound();
  }

  private resetRound(): void {
    this.fighters[0].reset(CENTER - START_GAP / 2, 1);
    this.fighters[1].reset(CENTER + START_GAP / 2, -1);
    this.hitstop = 0;
    this.cpuSeam?.reset?.();
  }

  /** Drive the sim from a variable render dt (render adapter calls this).
   *  Returns how many *actionable* ticks ran (ticks that actually consumed player input), so the
   *  adapter latches input edges until one is consumed — a press buffered on a non-actionable tick
   *  (intro/roundEnd/hitstop) survives until the next fight tick eats it. (matchEnd is also
   *  non-actionable, but its only exit is a rematch, which clears the latch itself.) */
  advance(dt: number, inputs: [InputSnapshot, InputSnapshot], cpu?: CpuSeam): number {
    this.accumulator += Math.min(dt, MAX_FRAME);
    if (cpu) this.cpuSeam = cpu;
    let actionable = 0;
    for (const ci of this.consumedInputs) { ci.up = false; ci.light = false; ci.heavy = false; ci.special = false; }
    this.interruptedSpecials[0] = this.interruptedSpecials[1] = false;
    // Working copy of the human snapshots so an edge consumed on one tick is masked out for the REST
    // of this batch. Without it a multi-tick advance replays the SAME physical press: e.g. an air
    // normal that lands mid-batch recovers to idle, and the still-set lightPressed fires a second,
    // grounded normal from one keypress. The render latch only clears AFTER advance() returns, so the
    // masking has to happen here, per tick.
    const cur: [InputSnapshot, InputSnapshot] = [inputs[0], inputs[1]];
    while (this.accumulator >= DT) {
      // A CPU is sampled PER TICK, not per call: one render frame can be 0, 1 or 3 ticks, and reusing
      // one snapshot across a batch would make the opponent act at the display's rate.
      //
      // It is sampled ONLY on ticks that will actually consume input. A controller carries its own
      // cooldown/reaction counters, so asking it to decide on a tick that then early-returns would
      // burn a cooldown and throw the resulting attack away — the CPU would come out of hitstop or
      // the round intro with its timers silently wound forward. It needs no EdgeLatch (it re-derives
      // its edges every tick); it does need the gate.
      const stepInputs: [InputSnapshot, InputSnapshot] = cpu && this.consumesInput()
        ? cpu.index === 0
          ? [cpu.next(this), cur[1]]
          : [cur[0], cpu.next(this)]
        : cpu
          ? cpu.index === 0 ? [EMPTY, cur[1]] : [cur[0], EMPTY]
          : cur;
      if (this.tick(stepInputs)) actionable++;
      // OR each fighter's per-tick consumption into the batch total (for the render latch), and mask
      // the consumed edge out of THIS batch's remaining ticks so one press can't fire twice.
      for (let i = 0; i < 2; i++) {
        const c = this.fighters[i].consumed;
        this.consumedInputs[i].up ||= c.up;
        this.consumedInputs[i].light ||= c.light;
        this.consumedInputs[i].heavy ||= c.heavy;
        this.consumedInputs[i].special ||= c.special;
        // OR'd here, immediately after tick() returns, which is what makes it survive the freeze: the
        // interrupting tick may itself end in KO or a fresh hitstop, and the NEXT tick clears the
        // per-fighter flag before its early return. By then this aggregate already holds it.
        this.interruptedSpecials[i] ||= this.fighters[i].interruptedSpecial;
        if (c.up || c.light || c.heavy || c.special) {
          cur[i] = {
            ...cur[i],
            upPressed: cur[i].upPressed && !c.up,
            lightPressed: cur[i].lightPressed && !c.light,
            heavyPressed: cur[i].heavyPressed && !c.heavy,
            specialPressed: cur[i].specialPressed && !c.special,
          };
        }
      }
      this.accumulator -= DT;
    }
    return actionable;
  }

  /** Will the NEXT tick run `think` (i.e. actually consume player input)? Mirrors tick()'s early
   *  returns — every non-fight phase and every hitstop frame bails before step 3. Kept next to them
   *  so the two cannot drift. */
  private consumesInput(): boolean {
    return this.match.phase === "fight" && this.hitstop === 0;
  }

  /** One fixed 60 Hz simulation step. Public so tests can drive it directly.
   *  Returns true iff this was a FIGHT tick that ran `think` — false on every phase/hitstop early
   *  return. NOTE this is "think ran", NOT "the buffered edge was acted on": think can early-return
   *  inside itself when the fighter is locked in an attack/stun. Which edges were actually consumed is
   *  reported separately per fighter via `Fighter.consumed` (accumulated into World.consumedInputs),
   *  and that — not this bool — is what the render latch clears. */
  tick(inputsRaw: [InputSnapshot, InputSnapshot]): boolean {
    const [a, b] = this.fighters;
    // Reset consumption for THIS tick before any early return, so a non-fight/hitstop/locked tick
    // reports nothing consumed and the render latch keeps buffering the edge.
    a.consumed.up = a.consumed.light = a.consumed.heavy = a.consumed.special = false;
    b.consumed.up = b.consumed.light = b.consumed.heavy = b.consumed.special = false;
    a.interruptedSpecial = b.interruptedSpecial = false;

    // --- Phase management (non-fight phases don't simulate combat, don't consume input) ---
    if (this.match.phase === "intro") {
      this.match.introTicks--;
      if (this.match.introTicks <= 0) {
        this.match.phase = "fight";
        this.events.push({ type: "roundStart", data: { round: this.match.round } });
      }
      return false;
    }
    if (this.match.phase === "roundEnd") {
      this.settleBodies(a, b); // let an airborne KO body fall/settle during the pause
      this.match.endTicks--;
      if (this.match.endTicks <= 0) {
        this.match.round++;
        this.resetRound();
        this.match.beginRound();
      }
      return false;
    }
    if (this.match.phase === "matchEnd") {
      this.settleBodies(a, b);
      return false;
    }

    // --- Step 1/2: input gating + hitstop freeze ---
    const inputs: [InputSnapshot, InputSnapshot] = this.hitstop > 0 ? [EMPTY, EMPTY] : inputsRaw;
    if (this.hitstop > 0) {
      this.hitstop--;
      return false; // freeze FSM, physics, timer, animation — input not consumed
    }

    // --- Step 3: FSM decisions (input consumed from here on → this is an actionable tick) ---
    a.think(inputs[0]);
    b.think(inputs[1]);

    // --- Step 4: physics ---
    a.integrate();
    b.integrate();

    // --- Step 5: coupled pushbox + stage bounds ---
    resolveSpatial(a, b);

    // --- Step 6: facing (from solved positions) + depth ---
    this.updateFacing(a, b);
    this.updateDepth(a, b);

    // --- Steps 7–9: contact snapshot + batch resolve ---
    const { events, hitstop } = resolveCombat(a, b);
    for (const e of events) this.events.push(e);

    // --- Step 10a: a KO ends the round immediately, even on the connecting tick ---
    if (this.checkRoundOver(a, b)) return true; // input was consumed this tick

    // --- Step 3b: freeze on the connecting frame (hitstop) or on a special's SUPER FREEZE ---
    // Both ride the same channel, so the clock-doesn't-tick-while-frozen guarantee holds for free.
    // Read AFTER the KO check on purpose: a fighter who started a special and was KO'd by an
    // already-active opposing attack this same tick gets neither the freeze nor the cut-in.
    // pendingFreeze is consumed here (not just read) — left set it would re-freeze every tick.
    let superFreeze = 0;
    for (const f of this.fighters) {
      if (f.pendingFreeze <= 0) continue;
      const armed = f.pendingFreeze;
      f.pendingFreeze = 0;
      // The move must still be HAPPENING. `think` arms this, but combat runs afterwards and can put
      // the fighter in hitstun on the same tick — a special stuffed on its first frame would
      // otherwise still stop the world and flash its owner's portrait for a move that never came
      // out. The KO check above only covers the fatal case; this covers every interruption.
      if (!isAttackState(f.state)) continue;
      superFreeze = Math.max(superFreeze, armed);
      this.events.push({ type: "special", player: f.index, x: f.x, y: f.y });
    }
    const stop = Math.max(hitstop, superFreeze);
    if (stop > 0) {
      this.hitstop = stop;
      return true; // input was consumed this tick
    }

    a.advanceTimers();
    b.advanceTimers();

    // --- Step 10b: round clock + timeout ---
    this.decrementClock(a, b);
    return true;
  }

  /** Integrate bodies with no control during frozen phases, then keep them on-stage and oriented:
   *  a KO'd/timeout body must not slide off-screen, and facing/depth should still track. */
  private settleBodies(a: Fighter, b: Fighter): void {
    a.integrate();
    b.integrate();
    resolveSpatial(a, b); // clamp to walls (MIN_X/MAX_X) + keep pushboxes apart — reuse the fight clamp
    this.updateFacing(a, b);
    this.updateDepth(a, b);
  }

  private updateFacing(a: Fighter, b: Fighter): void {
    for (const [self, opp] of [[a, b], [b, a]] as const) {
      // attackers and stunned fighters keep their facing
      if (isAttackState(self.state)) continue;
      if (self.state === "hitstun" || self.state === "blockstun" || self.state === "knockdown" || self.isKO) continue;
      if (opp.x > self.x) self.facing = 1;
      else if (opp.x < self.x) self.facing = -1;
      // equal x: preserve
    }
  }

  /** Who is drawn in front: the most recent ATTACKER, else the most recent MOVER, else unchanged.
   *
   *  The mover signal is the locomotion STATE that `think` assigns, deliberately NOT a position
   *  delta. Position is the wrong thing to measure here because this runs AFTER `integrate` and
   *  `resolveSpatial`: a walker pushing an idle opponent moves BOTH bodies, the MAX_SEPARATION cap
   *  rewrites both, and retained knockback/momentum keeps moving a fighter who never acted — most
   *  visibly a KO body sliding through `roundEnd` via `settleBodies`, which would pop the LOSER in
   *  front. A state can only be walkF/walkB if the fighter actually chose to walk this tick.
   *
   *  ponytail: jumps and knockback deliberately don't affect depth — an air attack already wins via
   *  the attacker rule, and everything else stays stable. */
  private updateDepth(a: Fighter, b: Fighter): void {
    const aAtk = isAttackState(a.state);
    const bAtk = isAttackState(b.state);
    if (aAtk !== bAtk) {
      this.frontIndex = aAtk ? 0 : 1;
      return;
    }
    if (aAtk) return; // both attacking: tie, keep the current front
    const aWalk = isWalkState(a.state);
    const bWalk = isWalkState(b.state);
    if (aWalk !== bWalk) this.frontIndex = aWalk ? 0 : 1;
    // neither or both moving: keep the current front (stable — no per-frame flicker)
  }

  /** End the round on a KO (returns true if the round/match ended this tick). */
  private checkRoundOver(a: Fighter, b: Fighter): boolean {
    if (!a.isKO && !b.isKO) return false;
    const winner: 0 | 1 | null = a.isKO && b.isKO ? null : a.isKO ? 1 : 0;
    this.finishRound(winner);
    return true;
  }

  private decrementClock(a: Fighter, b: Fighter): void {
    this.match.timerTicks--;
    if (this.match.timerTicks <= 0) {
      // Timeout: the larger REMAINING SHARE wins; equal shares = draw.
      //
      // Deliberately a fraction, not raw health (R-13). Fighters do not share a health pool — the
      // brawler carries 105 against the other two's 100 — so `a.health > b.health` handed him every
      // timeout where both had taken the same punishment, including NONE: two fighters who never
      // touched each other ended 2-0 to the brawler with both bars visibly full. It survived every
      // test because every test set both healths from the same implied pool, and it was found by
      // watching a real match time out. The health BAR is a fraction, so the tiebreak is too.
      // Cross-multiplied rather than divided: `a.health/aMax === b.health/bMax` would decide a DRAW
      // on float equality, and a draw is the one outcome where being a hair off changes the result.
      // Exact for the shipped roster, where healths and pools are integers and the products are tiny
      // (<= 105*105). The validator only requires `maxHealth` to be finite and positive, so a
      // fractional authored pool would put the DRAW case back on float equality — the win/lose cases
      // stay correct either way, and no shipped fighter authors one.
      const sa = a.health * b.cfg.stats.maxHealth;
      const sb = b.health * a.cfg.stats.maxHealth;
      const winner: 0 | 1 | null = sa === sb ? null : sa > sb ? 0 : 1;
      this.finishRound(winner);
    }
  }

  private finishRound(winner: 0 | 1 | null): void {
    const over = this.match.endRound(winner);
    this.events.push({ type: "roundEnd", player: winner ?? undefined });
    if (over) this.events.push({ type: "matchEnd", player: this.match.matchWinner ?? undefined });
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** For a full rematch from the menu. */
  restart(): void {
    this.match.wins = [0, 0];
    this.match.round = 1;
    this.match.matchWinner = null;
    this.resetRound();
    // Meter carries BETWEEN rounds (reset() deliberately leaves it), so a new match has to zero it
    // here or the rematch opens with whatever bar the last one ended on.
    for (const f of this.fighters) f.meter = 0;
    this.match.beginRound();
  }
}

export { GROUND_Y };
