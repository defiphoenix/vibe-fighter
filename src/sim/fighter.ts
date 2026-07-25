import type { AttackStateName, Box, CharacterConfig, FrameBoxes, InputSnapshot, StateName } from "./types";
import { isAttackState } from "./types";
import { DT, GROUND_Y } from "./constants";

/** States in which a fighter can start a new action. Exported: cpu.ts gates its reaction timer on it. */
export const ACTIONABLE: ReadonlySet<StateName> = new Set(["idle", "walkF", "walkB", "crouch", "block", "blockCrouch"]);
const STUN: ReadonlySet<StateName> = new Set(["hitstun", "blockstun", "knockdown"]);

/** Resolved local box set for the current tick. */
export interface ActiveBoxes {
  hurt: Box[];
  push: Box;
  hit: Box[];
  guard: Box[];
}

export class Fighter {
  readonly cfg: CharacterConfig;
  readonly index: 0 | 1;

  x = 0;
  y = GROUND_Y;
  vx = 0;
  vy = 0;
  facing: 1 | -1 = 1;
  grounded = true;

  state: StateName = "idle";
  stateFrame = 0;
  stunTimer = 0; // remaining ticks of a stun/attack lock counted separately where needed

  health: number;
  guardIntent = false; // dedicated block key held this tick, grounded (NOT hold-away; separate from FSM)
  crouchIntent = false;

  hasHit = false; // dedup: did the current active attack already connect? reset on a new attack

  /** Which input EDGES this fighter's think() actually ACTED ON this tick (started an attack/jump).
   *  The render latch clears only these, so an edge think() ignored because the fighter was locked in
   *  an attack/stun stays buffered until it can act — without this a light→heavy drops the heavy that
   *  was pressed during the light. Reset every tick in world.tick(), set here on consumption. */
  consumed = { up: false, light: false, heavy: false };

  /** Multiplier on the damage this fighter DEALS. 1 = the authored numbers; the render layer lowers
   *  it for a CPU opponent (see cpu.ts DAMAGE_SCALE). Deliberately NOT touched by reset(): it is a
   *  match-long handicap, not per-round state. */
  damageScale = 1;

  constructor(cfg: CharacterConfig, index: 0 | 1) {
    this.cfg = cfg;
    this.index = index;
    this.health = cfg.stats.maxHealth;
  }

  reset(x: number, facing: 1 | -1): void {
    this.x = x;
    this.y = GROUND_Y;
    this.vx = 0;
    this.vy = 0;
    this.facing = facing;
    this.grounded = true;
    this.state = "idle";
    this.stateFrame = 0;
    this.stunTimer = 0;
    this.health = this.cfg.stats.maxHealth;
    this.guardIntent = false;
    this.crouchIntent = false;
    this.hasHit = false;
  }

  get isKO(): boolean {
    return this.state === "ko";
  }

  /** True only when a guard box is actually active this tick (block key held, grounded, and the
   *  current animation frame carries a guard box). guardIntent alone is set even during
   *  hitstun/attack, so render/UI cues must use THIS, not guardIntent, or they advertise protection
   *  that isn't there.
   *
   *  Derived from the box DATA rather than from a duplicated state list: guard is per-frame now, so
   *  a state list would be a second claim about the same thing and the two could drift. The builder
   *  is what guarantees the data can't say yes on an attack frame (see isGuardableState). */
  get guarding(): boolean {
    return this.grounded && this.guardIntent && this.guardBoxes().length > 0;
  }

  /** The current frame's guard boxes for the stance being held, IGNORING whether block is pressed.
   *  The debug overlay draws these faint to show where a guard WOULD protect; combat gets the gated
   *  version through activeBoxes(). */
  guardBoxes(): Box[] {
    const f = this.currentFrame();
    return this.crouchIntent ? f.guardCrouch : f.guardStand;
  }

  /** The frame the sim is on, with the one clamp that every box read shares — a state can be held
   *  past its last authored slot (stunTimer outliving the art). */
  private currentFrame(): FrameBoxes {
    const spec = this.cfg.states[this.state];
    return spec.frames[Math.min(this.stateFrame, spec.frames.length - 1)];
  }

  /** Step 3: FSM decisions from input. facing is from the previous tick's solve. */
  think(input: InputSnapshot): void {
    if (this.isKO) return;

    const forwardHeld = this.facing > 0 ? input.right : input.left;
    const backHeld = this.facing > 0 ? input.left : input.right;
    this.crouchIntent = input.down && this.grounded;
    // Guard is now an explicit key (not hold-back). backHeld still drives backward walking below.
    this.guardIntent = input.block && this.grounded;

    // Stun states: locked, no control; timer ticks in advanceTimers().
    if (STUN.has(this.state)) return;

    // Attack states: locked until animation completes.
    if (isAttackState(this.state)) return;

    // Attacks work grounded OR airborne; the variant (ground/air/crouch) is chosen in startAttack.
    // Stance for the attack variant comes from when the press HAPPENED (downAtPress), falling back to
    // the live `down` — a buffered crouch normal must not come out standing just because the tick
    // that consumed it landed after `down` was released.
    const attackDown = input.downAtPress ?? input.down;
    if (input.lightPressed) { this.consumed.light = true; return this.startAttack("light", attackDown); }
    if (input.heavyPressed) { this.consumed.heavy = true; return this.startAttack("heavy", attackDown); }

    // Airborne: no other ground actions (no air walk/crouch/block/double-jump).
    if (!this.grounded) return;

    if (input.upPressed) {
      this.consumed.up = true;
      this.vy = -this.cfg.stats.jumpVelocity;
      this.grounded = false;
      this.setState("jumpRise");
      // keep current vx as jump momentum
      return;
    }

    const speed = this.cfg.stats.walkSpeed;
    if (this.guardIntent) {
      // ponytail: plant while blocking (guard is stationary + legible). crouchIntent still selects
      // low vs high guard via activeBoxes. Walk-back-while-block is the alternative if desired later.
      // Phase 13b: dedicated held-guard states carry the block art; crouchIntent picks high vs low.
      this.setState(this.crouchIntent ? "blockCrouch" : "block");
      this.vx = 0;
    } else if (this.crouchIntent) {
      this.setState("crouch");
      this.vx = 0;
    } else if (forwardHeld) {
      this.setState("walkF");
      this.vx = speed * this.facing;
    } else if (backHeld) {
      this.setState("walkB");
      this.vx = -speed * this.facing;
    } else {
      this.setState("idle");
      this.vx = 0;
    }
  }

  /** Pick the attack variant from stance: crouch (grounded+down) > air (!grounded) > ground.
   *  `down` is the press-time stance (see think), NOT necessarily this tick's crouchIntent. */
  private startAttack(strength: "light" | "heavy", down: boolean): void {
    let state: AttackStateName;
    if (this.grounded && down) {
      state = strength === "light" ? "crouchLight" : "crouchHeavy";
    } else if (!this.grounded) {
      state = strength === "light" ? "airLight" : "airHeavy";
    } else {
      state = strength === "light" ? "attackLight" : "attackHeavy";
    }
    this.setState(state);
    if (this.grounded) this.vx = 0; // grounded attacks plant; air attacks keep jump momentum
    this.hasHit = false;
  }

  private setState(s: StateName): void {
    if (this.state !== s) {
      this.state = s;
      this.stateFrame = 0;
    }
  }

  /** Step 4: integrate physics for one tick. */
  integrate(): void {
    if (this.isKO) {
      // slump: friction, gravity handled by ground clamp
    }
    if (!this.grounded) {
      this.vy += this.cfg.stats.gravity * DT;
    }
    // friction for uncontrolled ground states (knockback decay)
    if (this.grounded && (STUN.has(this.state) || this.isKO)) {
      this.vx *= 0.82;
      if (Math.abs(this.vx) < 2) this.vx = 0;
    }
    this.x += this.vx * DT;
    this.y += this.vy * DT;

    if (this.y >= GROUND_Y) {
      this.y = GROUND_Y;
      this.vy = 0;
      if (!this.grounded) {
        this.grounded = true;
        this.onLand();
      }
    }
  }

  private onLand(): void {
    if (this.isKO) return;
    if (STUN.has(this.state)) {
      // landed from a knockback: brief knockdown then recover
      this.setState("knockdown");
      this.stunTimer = Math.max(this.stunTimer, 18);
    } else {
      this.setState("idle");
    }
  }

  /** Step 3b: advance animation frame + stun/attack timers (skipped during hitstop). */
  advanceTimers(): void {
    if (this.isKO) return;

    if (STUN.has(this.state)) {
      this.stunTimer--;
      if (this.stunTimer <= 0 && this.grounded) {
        // A fighter who blocks a hit and keeps holding guard leaves blockstun through idle for one
        // tick, then think() re-enters block/blockCrouch from frame 0. That used to replay a raise-
        // guard wind-up, but the block sheets now OPEN already braced (frame 0 = the held guard pose),
        // so the re-entry replays guard→guard with no visible pop. State selection precedes combat, so
        // guard is never dropped regardless.
        this.setState("idle");
      }
      return;
    }

    if (isAttackState(this.state)) {
      const spec = this.cfg.states[this.state];
      this.stateFrame++;
      if (this.stateFrame >= spec.frames.length) {
        this.setState(this.grounded ? "idle" : "jumpFall");
      }
      return;
    }

    if (!this.grounded) {
      this.setState(this.vy < 0 ? "jumpRise" : "jumpFall");
      return;
    }

    // looping locomotion states
    const spec = this.cfg.states[this.state];
    this.stateFrame++;
    if (this.stateFrame >= spec.frames.length) {
      this.stateFrame = spec.loop ? 0 : spec.frames.length - 1;
    }
  }

  /** Apply an incoming hit or block result (called by combat, step 9). */
  applyHit(damage: number, stun: number, kbx: number, kby: number, blocked: boolean): void {
    this.health = Math.max(0, this.health - damage);
    this.vx = kbx; // world-space knockback (already signed by combat)
    if (!blocked && kby !== 0) {
      this.vy = kby;
      this.grounded = false;
    }
    if (this.health <= 0) {
      this.setState("ko");
      this.stunTimer = 999;
      this.vx = kbx;
      return;
    }
    this.setState(blocked ? "blockstun" : "hitstun");
    this.stateFrame = 0;
    this.stunTimer = stun;
  }

  /** Resolved local boxes for this tick (step 7 reads these). */
  activeBoxes(): ActiveBoxes {
    const frame = this.currentFrame();
    return {
      hurt: frame.hurt,
      push: frame.push,
      hit: frame.hit,
      guard: this.guarding ? this.guardBoxes() : [],
    };
  }
}
