import type { AttackStateName, Box, CharacterConfig, FrameBoxes, InputSnapshot, StateName } from "./types";
import { ATTACK_STATE_TO_KEY, isAttackState } from "./types";
import { DT, GROUND_Y } from "./constants";

/** States in which a fighter can start a new action. Exported: cpu.ts gates its reaction timer on it. */
export const ACTIONABLE: ReadonlySet<StateName> = new Set(["idle", "walkF", "walkB", "crouch", "block", "blockCrouch"]);
const STUN: ReadonlySet<StateName> = new Set(["hitstun", "blockstun", "knockdown"]);

/** A full meter. Earned in combat, spent whole on one special — there are no partial stocks. */
export const METER_MAX = 100;

/** THE test for "the super will come out", used by `think` below AND by the HUD through
 *  `render/meter-view.ts`. One function rather than two spellings of `>= METER_MAX`, because the HUD
 *  and the sim disagreeing about this exact number is R-14: a fighter whose heavy pays 14 rests on 98,
 *  the bar drew 98% of its slot and read as full, and the super refused in silence. */
export const meterFull = (meter: number): boolean => meter >= METER_MAX;

/** Pick a normal's variant from stance: crouch (grounded+down) > air (!grounded) > ground.
 *  `down` is the press-time stance (see think), NOT necessarily this tick's crouchIntent. */
function variantFor(strength: "light" | "heavy", grounded: boolean, down: boolean): AttackStateName {
  if (grounded && down) return strength === "light" ? "crouchLight" : "crouchHeavy";
  if (!grounded) return strength === "light" ? "airLight" : "airHeavy";
  return strength === "light" ? "attackLight" : "attackHeavy";
}

/** Resolved local box set for the current tick. */
export interface ActiveBoxes {
  hurt: Box[];
  push: Box;
  hit: Box[];
  guard: Box[];
  /** Which hit window the live hit boxes belong to (undefined when `hit` is empty). Combat's dedup key. */
  hitId?: number;
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

  /** Monotonic id of the current stun EPISODE, bumped by every applyHit. Exists because a combo's
   *  2nd+ hit lands while the defender is already in `hitstun`: the state NAME does not change, so a
   *  render layer keying off the state alone never restarts the hurt animation and the defender
   *  freezes on its last frame for the rest of the combo. `stunTimer` rising is not a usable
   *  substitute — a multi-tick advance batch can decrement it and a re-hit restore it to exactly the
   *  previously observed value, showing no change at all. Never reset (not even by `reset()`): the
   *  renderer compares it against the last value it saw, and restarting at 0 could collide with what
   *  is already on screen and skip the re-play. */
  stunEpoch = 0;

  health: number;
  guardIntent = false; // dedicated block key held this tick, grounded (NOT hold-away; separate from FSM)
  crouchIntent = false;

  /** Dedup: the id of the last hit WINDOW that connected. A normal has one window (id 0) so it still
   *  lands once; a `repeat` special has one id per window, so it lands once per window. Ids restart at
   *  0 for every attack, which is why startAttack() clearing this is load-bearing — a stale 0 from the
   *  previous move would swallow the next move's first window. */
  lastHitId = -1;

  /** Super meter, 0..METER_MAX. Filled in combat.ts by damage dealt and taken. Deliberately NOT
   *  cleared by reset() (which runs on every round transition — the meter carries between rounds, as
   *  the genre expects); World.restart() zeroes it for a fresh match. */
  meter = 0;

  /** Ticks of super freeze this fighter's just-started special owes the world. Set by startAttack,
   *  read-and-cleared once by world.tick() — if it lingered it would re-freeze after the countdown. */
  pendingFreeze = 0;

  /** Which input EDGES this fighter's think() actually ACTED ON this tick (started an attack/jump).
   *  The render latch clears only these, so an edge think() ignored because the fighter was locked in
   *  an attack/stun stays buffered until it can act — without this a light→heavy drops the heavy that
   *  was pressed during the light. Reset every tick in world.tick(), set here on consumption. */
  consumed = { up: false, light: false, heavy: false, special: false };

  /** Was this fighter knocked OUT of a special this tick? Set by `applyHit` when the hit arrives while
   *  the fighter is still in `special`; reset every tick in world.tick() and OR-accumulated per advance
   *  into `World.interruptedSpecials`, exactly like `consumed` above.
   *
   *  It is a SIM field rather than a render-side state comparison for one reason: a render frame can
   *  drain 15 ticks, so from outside, "the special finished and its owner was hit two ticks later" and
   *  "the special was interrupted" are the same observation — `special` at the start of the frame,
   *  `hitstun` at the end, with the `idle` in between never sampled. Only the tick that applies the hit
   *  can tell them apart, because only it can see the state the hit actually landed on. */
  interruptedSpecial = false;

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
    this.lastHitId = -1;
    this.pendingFreeze = 0;
    // meter is NOT cleared: reset() runs on every round transition and the bar carries. See restart().
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

    // The meter special (Phase 15). Grounded-only and all-or-nothing: a full bar or nothing happens.
    //
    // Checked BEFORE the normals so a super outranks a normal pressed on the same frame — the genre's
    // answer, and also the thing that stops the edge leaking: the normals `return`, so a special left
    // unconsumed behind one would stay latched and then fire by itself the moment that very normal's
    // damage topped the bar up.
    //
    // Consumed on every GROUNDED press, including a refused one — the render latch only clears what the
    // sim reports consuming, and a press on a short bar has been answered ("nothing happens"), so
    // holding it would make the special self-trigger later. AIRBORNE is the opposite case and the
    // branch is skipped entirely: the fighter simply cannot act on it yet, so the edge stays buffered
    // and comes out on landing — exactly how `upPressed` behaves behind the same gate below.
    if (input.specialPressed && this.grounded) {
      this.consumed.special = true;
      if (meterFull(this.meter)) {
        this.meter = 0;
        return this.startAttack("special");
      }
    }

    // Attacks work grounded OR airborne; the variant (ground/air/crouch) is chosen in startAttack.
    // Stance for the attack variant comes from when the press HAPPENED (downAtPress), falling back to
    // the live `down` — a buffered crouch normal must not come out standing just because the tick
    // that consumed it landed after `down` was released.
    const attackDown = input.downAtPress ?? input.down;
    if (input.lightPressed) { this.consumed.light = true; return this.startAttack(variantFor("light", this.grounded, attackDown)); }
    if (input.heavyPressed) { this.consumed.heavy = true; return this.startAttack(variantFor("heavy", this.grounded, attackDown)); }



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

  /** Enter an attack state. THE single entry point for every attack — normals and the special alike —
   *  because it is also the only place `lastHitId` is cleared, and a missed clear silently eats the
   *  next move's first hit window. */
  private startAttack(state: AttackStateName): void {
    this.setState(state);
    if (this.grounded) this.vx = 0; // grounded attacks plant; air attacks keep jump momentum
    this.lastHitId = -1;
    this.pendingFreeze = this.cfg.attacks[ATTACK_STATE_TO_KEY[state]].freeze ?? 0;
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
    // Bumped FIRST so the KO branch below, which returns early, still counts as an episode.
    this.stunEpoch++;
    // Same reason, same place: read the state BEFORE either branch overwrites it, so being KO'd out of
    // a super still reports as the interruption it is. Keyed off the state, never off `blocked` —
    // what makes this an interruption is the move it landed on, not how it was received.
    if (this.state === "special") this.interruptedSpecial = true;
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
      hitId: frame.hitId,
      guard: this.guarding ? this.guardBoxes() : [],
    };
  }
}
