// Pure simulation types. NO Phaser imports anywhere under src/sim.

/** Axis-aligned box in fighter-local space: +x = forward (facing dir), +y = UP from feet.
 *  Rectangle spans x..x+w (forward) and y..y+h (up). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Boxes for one animation frame. Any array may be empty (e.g. hit[] only on active frames).
 *  Guard is carried as BOTH stances rather than one resolved array: the fighter's crouch INTENT
 *  picks between them at read time (`Fighter.guardBoxes`), which is what lets a crouch-blocker keep
 *  low guard through `blockstun` — a state with one body and no stance of its own. */
export interface FrameBoxes {
  hurt: Box[];
  push: Box;
  hit: Box[];
  guardStand: Box[];
  guardCrouch: Box[];
  /** Which HIT WINDOW this frame belongs to (Phase 15), or undefined when `hit` is empty. Combat
   *  dedups on this, so a multi-hit special lands once per window instead of once per attack. It has
   *  to live on the frame: `Fighter` walks frames and has no startup/active counters to derive it
   *  from. Ids restart at 0 for every attack — `Fighter.startAttack` clearing `lastHitId` is what
   *  keeps a previous move's window from swallowing the next move's first hit. */
  hitId?: number;
}

export type StateName =
  | "idle"
  | "walkF"
  | "walkB"
  | "crouch"
  | "block"
  | "blockCrouch"
  | "jumpRise"
  | "jumpFall"
  | "attackLight"
  | "attackHeavy"
  | "airLight"
  | "airHeavy"
  | "crouchLight"
  | "crouchHeavy"
  | "special"
  | "hitstun"
  | "blockstun"
  | "knockdown"
  | "ko";

/** The seven attack data slots. Ground normals keep the legacy "light"/"heavy" keys so existing
 *  character data stays valid; air/crouch variants and the meter special are keyed by their state name. */
export type AttackKey =
  | "light"
  | "heavy"
  | "airLight"
  | "airHeavy"
  | "crouchLight"
  | "crouchHeavy"
  | "special";

/** Single source of truth mapping each attack STATE to its data key. Consumed by the FSM
 *  (fighter.ts), combat lookup (combat.ts), facing/depth (world.ts), the builder and the validator,
 *  so "which states are attacks" is defined in exactly one place. */
export const ATTACK_STATE_TO_KEY = {
  attackLight: "light",
  attackHeavy: "heavy",
  airLight: "airLight",
  airHeavy: "airHeavy",
  crouchLight: "crouchLight",
  crouchHeavy: "crouchHeavy",
  special: "special",
} as const satisfies Record<string, AttackKey>;

export type AttackStateName = keyof typeof ATTACK_STATE_TO_KEY;

export function isAttackState(s: StateName): s is AttackStateName {
  return Object.prototype.hasOwnProperty.call(ATTACK_STATE_TO_KEY, s);
}

/** Ground locomotion — the states `think` assigns when the fighter CHOSE to walk. Used by
 *  world.ts's depth rule as a movement-intent signal that survives the tick order (see updateDepth). */
export function isWalkState(s: StateName): boolean {
  return s === "walkF" || s === "walkB";
}

/** States whose frames CARRY a guard box. Phase 13b: a guarding fighter is now planted in a dedicated
 *  `block`/`blockCrouch` state (the FSM guard branch), so those two — plus `blockstun`, which has no
 *  stance of its own and relies on `crouchIntent` to keep a crouch-blocker's low guard up while
 *  stunned — are exactly the states where a guard box is live. idle/walk/crouch dropped out: a fighter
 *  is never guarding while in them. Read by BOTH the builder (which refuses to apply a guard override
 *  outside this set) and the validator (which rejects one) — `guarding` is derived from box data now,
 *  so a guard box authored onto an attack frame would otherwise make a fighter blockable mid-punch. */
const GUARDABLE: ReadonlySet<StateName> = new Set<StateName>([
  "block", "blockCrouch", "blockstun",
]);

export function isGuardableState(s: StateName): boolean {
  return GUARDABLE.has(s);
}

export interface StateSpec {
  /** number of animation frames; stateFrame indexes frames[] */
  frames: FrameBoxes[];
  loop: boolean;
}

/** A multi-hit attack's extra hit windows (Phase 15). The active window is laid down `count` times,
 *  separated by `gap` idle frames, so the number of hits a special lands is AUTHORED, not emergent.
 *  Absent = one window = every normal, unchanged. */
export interface RepeatSpec {
  count: number;
  gap: number;
}

export interface AttackSpec {
  kind: AttackKey;
  startup: number; // frames before active
  active: number; // frames the hit box is live
  recovery: number; // frames after active
  damage: number;
  hitstun: number;
  blockstun: number;
  hitstop: number;
  knockback: { x: number; y: number };
  chip: number;
  repeat?: RepeatSpec;
  /** Ticks the whole world freezes when this attack STARTS — the super freeze the cut-in plays over.
   *  Distinct from `hitstop`, which freezes on a connect. */
  freeze?: number;
}

export interface FighterStats {
  walkSpeed: number; // px/s
  jumpVelocity: number; // px/s upward
  gravity: number; // px/s^2 downward
  maxHealth: number;
  scale: number;
}

/** Guard boxes are NOT here: they live per-frame in `FrameBoxes` (Phase 13). `CharacterData.boxes`
 *  keeps the stance template that seeds them, so there is exactly one assembled place to read a
 *  guard box from and it cannot drift from the frame it claims to describe. */
export interface CharacterConfig {
  id: string;
  stats: FighterStats;
  states: Record<StateName, StateSpec>;
  attacks: Record<AttackKey, AttackSpec>;
}

// ---- Authorable character data (JSON-friendly; the render edge loads it, a pure builder
//      reconstructs the CharacterConfig above). Kept in sim/ because the builder is pure. ----

/** One attack, as authored: frame windows + the single hit box + on-hit effects. */
export interface AttackData {
  body: "stand" | "crouch" | "air"; // which body template the attack frames use
  startup: number;
  active: number;
  recovery: number;
  hit: Box;
  damage: number;
  hitstun: number;
  blockstun: number;
  hitstop: number;
  knockback: { x: number; y: number };
  chip: number;
  repeat?: RepeatSpec;
  freeze?: number;
}

/** Total sim ticks an attack occupies. The ONE place the repeat arithmetic lives — the builder lays
 *  frames out with it, the validator derives the state shape from it, and the render layer derives
 *  the animation's frame rate from it. `scripts/check-attack-sync.py` and `scripts/audit-animations.py`
 *  mirror this formula in Python; keep all three in step. */
export function attackSimTicks(a: AttackData): number {
  const count = a.repeat?.count ?? 1;
  const gap = a.repeat?.gap ?? 0;
  return a.startup + count * a.active + (count - 1) * gap + a.recovery;
}

/** A signature per-frame box tweak applied after base assembly (what the Gym writes).
 *  guardStand/guardCrouch are honoured only on a state `isGuardableState` accepts; the builder drops
 *  them anywhere else and the validator rejects them there. */
export interface FrameOverride {
  frame: number;
  hurt?: Box[];
  push?: Box;
  hit?: Box[];
  guardStand?: Box[];
  guardCrouch?: Box[];
}

/** Compact, hand-authorable fighter definition. Box arrays reconstruct into full StateSpecs. */
export interface CharacterData {
  stats: FighterStats;
  boxes: {
    pushStand: Box;
    pushCrouch: Box;
    hurtStand: Box[];
    hurtCrouch: Box[];
    hurtAir: Box[];
    knockdown: { hurt: Box[]; push: Box };
    ko: { hurt: Box[]; push: Box };
    guardStand: Box[];
    guardCrouch: Box[];
  };
  attacks: Record<AttackKey, AttackData>;
  /** frame (box-slot) counts for the non-attack states; attack counts come from the windows. */
  frames: {
    idle: number;
    walkF: number;
    walkB: number;
    crouch: number;
    block: number;
    blockCrouch: number;
    jumpRise: number;
    jumpFall: number;
    hitstun: number;
    blockstun: number;
    knockdown: number;
    ko: number;
  };
  overrides?: Partial<Record<StateName, FrameOverride[]>>;
}

/** Raw per-player input for one tick: held flags + pressed (rising) edges. */
export interface InputSnapshot {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  light: boolean;
  heavy: boolean;
  block: boolean; // dedicated block key held (guard is explicit, not hold-back)
  special: boolean; // dedicated meter-special key held
  // rising edges (pressed this tick)
  upPressed: boolean;
  lightPressed: boolean;
  heavyPressed: boolean;
  specialPressed: boolean;
  /** Was `down` held at the instant the buffered attack edge was PRESSED? Render frames and sim ticks
   *  don't line up, so an attack press is latched until an actionable tick eats it — by then `down`
   *  may already be released, and the crouch normal comes out standing. Read ONLY by attack-variant
   *  selection (never by crouchIntent or the guard stance, which must stay live). Undefined = "no
   *  buffered press, use the live `down`". */
  downAtPress?: boolean;
}

export function emptyInput(): InputSnapshot {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    light: false,
    heavy: false,
    block: false,
    special: false,
    upPressed: false,
    lightPressed: false,
    heavyPressed: false,
    specialPressed: false,
  };
}

/** World-space axis-aligned rectangle for overlap tests. */
export interface AABB {
  left: number;
  right: number;
  top: number; // smaller y (screen y-down)
  bottom: number; // larger y
}

export type SimEventType = "hit" | "block" | "ko" | "special" | "roundStart" | "roundEnd" | "matchEnd";

export interface SimEvent {
  type: SimEventType;
  player?: 0 | 1; // subject (e.g. who got hit / who won)
  x?: number;
  y?: number;
  data?: Record<string, number | string | boolean>;
}
