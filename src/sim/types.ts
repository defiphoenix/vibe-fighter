// Pure simulation types. NO Phaser imports anywhere under src/sim.

/** Axis-aligned box in fighter-local space: +x = forward (facing dir), +y = UP from feet.
 *  Rectangle spans x..x+w (forward) and y..y+h (up). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Boxes for one animation frame. Any array may be empty (e.g. hit[] only on active frames). */
export interface FrameBoxes {
  hurt: Box[];
  push: Box;
  hit: Box[];
}

export type StateName =
  | "idle"
  | "walkF"
  | "walkB"
  | "crouch"
  | "jumpRise"
  | "jumpFall"
  | "attackLight"
  | "attackHeavy"
  | "airLight"
  | "airHeavy"
  | "crouchLight"
  | "crouchHeavy"
  | "hitstun"
  | "blockstun"
  | "knockdown"
  | "ko";

/** The six attack data slots. Ground normals keep the legacy "light"/"heavy" keys so existing
 *  character data stays valid; air/crouch variants are keyed by their state name. */
export type AttackKey = "light" | "heavy" | "airLight" | "airHeavy" | "crouchLight" | "crouchHeavy";

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

export interface StateSpec {
  /** number of animation frames; stateFrame indexes frames[] */
  frames: FrameBoxes[];
  loop: boolean;
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
}

export interface FighterStats {
  walkSpeed: number; // px/s
  jumpVelocity: number; // px/s upward
  gravity: number; // px/s^2 downward
  maxHealth: number;
  scale: number;
}

export interface CharacterConfig {
  id: string;
  stats: FighterStats;
  states: Record<StateName, StateSpec>;
  attacks: Record<AttackKey, AttackSpec>;
  /** guard boxes overlaid when guardIntent is held (separate from locomotion state) */
  guardStand: Box[];
  guardCrouch: Box[];
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
}

/** A signature per-frame box tweak applied after base assembly (what the Gym writes).
 *  guardStand/guardCrouch are authored/stored but NOT yet consumed per-frame by the sim
 *  (guard is a global stance overlay — see assembleCharacter). */
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
  // rising edges (pressed this tick)
  upPressed: boolean;
  lightPressed: boolean;
  heavyPressed: boolean;
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
    upPressed: false,
    lightPressed: false,
    heavyPressed: false,
  };
}

/** World-space axis-aligned rectangle for overlap tests. */
export interface AABB {
  left: number;
  right: number;
  top: number; // smaller y (screen y-down)
  bottom: number; // larger y
}

export type SimEventType = "hit" | "block" | "ko" | "roundStart" | "roundEnd" | "matchEnd";

export interface SimEvent {
  type: SimEventType;
  player?: 0 | 1; // subject (e.g. who got hit / who won)
  x?: number;
  y?: number;
  data?: Record<string, number | string | boolean>;
}
