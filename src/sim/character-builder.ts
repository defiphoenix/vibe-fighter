import type {
  AttackData,
  AttackKey,
  AttackSpec,
  Box,
  CharacterConfig,
  CharacterData,
  FrameBoxes,
  StateName,
  StateSpec,
} from "./types";
import { ATTACK_STATE_TO_KEY, isGuardableState } from "./types";

// Pure frame-box builders (moved out of config.ts so both the JSON loader and the sim tests
// reconstruct a CharacterConfig from compact CharacterData). No Phaser, no I/O, deterministic.

const cloneBox = (b: Box): Box => ({ x: b.x, y: b.y, w: b.w, h: b.h });
const cloneBoxes = (bs: Box[]): Box[] => bs.map(cloneBox);

/** Guard starts EMPTY on every frame; seedGuard fills the guardable states in one later pass, so
 *  the body templates below stay purely about hurt/push/hit. */
function fb(hurt: Box[], push: Box, hit: Box[] = [], hitId?: number): FrameBoxes {
  const f: FrameBoxes = {
    hurt: cloneBoxes(hurt), push: cloneBox(push), hit: cloneBoxes(hit), guardStand: [], guardCrouch: [],
  };
  if (hitId !== undefined) f.hitId = hitId;
  return f;
}

/** n independent copies of a frame (never aliased — the Gym overwrites single frames). */
function seq(n: number, frame: FrameBoxes): FrameBoxes[] {
  return Array.from({ length: n }, () => fb(frame.hurt, frame.push, frame.hit, frame.hitId));
}

function simpleState(n: number, loop: boolean, frame: FrameBoxes): StateSpec {
  return { frames: seq(n, frame), loop };
}

/** Body during every frame; hit box only during the active window(s).
 *  Phase 15: `repeat` lays the active window down `count` times separated by `gap` bare frames, and
 *  tags each window with its own `hitId` so combat can dedup PER WINDOW instead of per attack. With
 *  no `repeat` this is byte-identical to the single-window layout it replaced (one window, id 0). */
function attackState(body: FrameBoxes, a: AttackData): StateSpec {
  const frames: FrameBoxes[] = [];
  const count = a.repeat?.count ?? 1;
  const gap = a.repeat?.gap ?? 0;
  for (let i = 0; i < a.startup; i++) frames.push(fb(body.hurt, body.push));
  for (let w = 0; w < count; w++) {
    if (w > 0) for (let i = 0; i < gap; i++) frames.push(fb(body.hurt, body.push));
    for (let i = 0; i < a.active; i++) frames.push(fb(body.hurt, body.push, [a.hit], w));
  }
  for (let i = 0; i < a.recovery; i++) frames.push(fb(body.hurt, body.push));
  return { frames, loop: false };
}

function toSpec(a: AttackData, kind: AttackKey): AttackSpec {
  const spec: AttackSpec = {
    kind,
    startup: a.startup,
    active: a.active,
    recovery: a.recovery,
    damage: a.damage,
    hitstun: a.hitstun,
    blockstun: a.blockstun,
    hitstop: a.hitstop,
    knockback: { x: a.knockback.x, y: a.knockback.y },
    chip: a.chip,
  };
  // Copied explicitly, like every field above — an omission here silently drops the super freeze.
  if (a.repeat) spec.repeat = { count: a.repeat.count, gap: a.repeat.gap };
  if (a.freeze !== undefined) spec.freeze = a.freeze;
  return spec;
}

/** Every DISTINCT hit box a state can produce, across all its frames — the total reach of the move.
 *  The debug overlay draws these faint on the frames where no hit box is live. Not "the first frame
 *  that has one": attackState() seeds every active frame with the same box, but a per-frame override
 *  may legally replace hit[] on a single active frame, so a later frame can have different reach.
 *  Pure (no Phaser) so it's unit-testable; returns the config's own box objects — read only. */
export function allHitBoxes(cfg: CharacterConfig, state: StateName): Box[] {
  const seen = new Set<string>();
  const out: Box[] = [];
  for (const f of cfg.states[state].frames) {
    for (const b of f.hit) {
      const key = `${b.x},${b.y},${b.w},${b.h}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(b);
    }
  }
  return out;
}

/** Reconstruct a full CharacterConfig from compact authorable data. Pure. */
export function assembleCharacter(id: string, data: CharacterData): CharacterConfig {
  const b = data.boxes;
  const stand = fb(b.hurtStand, b.pushStand);
  const crouch = fb(b.hurtCrouch, b.pushCrouch);
  const air = fb(b.hurtAir, b.pushStand);
  const bodyFor = (which: AttackData["body"]) =>
    which === "crouch" ? crouch : which === "air" ? air : stand;

  const states: Record<StateName, StateSpec> = {
    idle: simpleState(data.frames.idle, true, stand),
    walkF: simpleState(data.frames.walkF, true, stand),
    walkB: simpleState(data.frames.walkB, true, stand),
    crouch: simpleState(data.frames.crouch, true, crouch),
    // Phase 13b held-guard poses: one-shot into a braced hold (loop:false), NOT looping — a looping
    // guard sheet reads as popping in and out of block. Guard boxes are seeded by the loop below.
    block: simpleState(data.frames.block, false, stand),
    blockCrouch: simpleState(data.frames.blockCrouch, false, crouch),
    jumpRise: simpleState(data.frames.jumpRise, false, air),
    jumpFall: simpleState(data.frames.jumpFall, false, air),
    attackLight: attackState(bodyFor(data.attacks.light.body), data.attacks.light),
    attackHeavy: attackState(bodyFor(data.attacks.heavy.body), data.attacks.heavy),
    airLight: attackState(bodyFor(data.attacks.airLight.body), data.attacks.airLight),
    airHeavy: attackState(bodyFor(data.attacks.airHeavy.body), data.attacks.airHeavy),
    crouchLight: attackState(bodyFor(data.attacks.crouchLight.body), data.attacks.crouchLight),
    crouchHeavy: attackState(bodyFor(data.attacks.crouchHeavy.body), data.attacks.crouchHeavy),
    special: attackState(bodyFor(data.attacks.special.body), data.attacks.special),
    hitstun: simpleState(data.frames.hitstun, false, stand),
    blockstun: simpleState(data.frames.blockstun, false, stand),
    knockdown: simpleState(data.frames.knockdown, false, fb(b.knockdown.hurt, b.knockdown.push)),
    ko: simpleState(data.frames.ko, false, fb(b.ko.hurt, b.ko.push)),
  };

  // Seed the stance guard onto every frame that is allowed to carry one. Doing it as its own pass
  // (rather than threading a guard pair through the body templates) keeps "which states can guard"
  // in one readable place, next to the rule that enforces it on overrides below.
  for (const key of Object.keys(states) as StateName[]) {
    if (!isGuardableState(key)) continue;
    for (const f of states[key].frames) {
      f.guardStand = cloneBoxes(b.guardStand);
      f.guardCrouch = cloneBoxes(b.guardCrouch);
    }
  }

  // Apply per-frame overrides.
  if (data.overrides) {
    for (const key of Object.keys(data.overrides) as StateName[]) {
      const list = data.overrides[key];
      if (!list) continue;
      const frames = states[key].frames;
      const guardable = isGuardableState(key);
      for (const ov of list) {
        const f = frames[ov.frame];
        if (!f) continue;
        if (ov.hurt) f.hurt = cloneBoxes(ov.hurt);
        if (ov.push) f.push = cloneBox(ov.push);
        if (ov.hit) f.hit = cloneBoxes(ov.hit);
        // A guard box outside the guardable set would make `Fighter.guarding` — which is derived
        // from box data — true mid-attack. The validator rejects this so no human edit is silently
        // swallowed; the builder drops it because config.ts assembles with no validator in front.
        if (guardable && ov.guardStand) f.guardStand = cloneBoxes(ov.guardStand);
        if (guardable && ov.guardCrouch) f.guardCrouch = cloneBoxes(ov.guardCrouch);
      }
    }
  }

  // Build every attack spec from the single state->key mapping (no per-key drift).
  const attacks = {} as Record<AttackKey, AttackSpec>;
  for (const key of Object.values(ATTACK_STATE_TO_KEY)) {
    attacks[key] = toSpec(data.attacks[key], key);
  }

  // stats.scale rescales the whole fighter: art (FighterSprite.setScale) AND collision geometry.
  // Applied LAST, in one traversal of the assembled graph, so overrides are authored in the same
  // unscaled space as the base boxes (author once, scale once). Everything here is already a fresh
  // clone, so this never mutates the caller's CharacterData. Knockback/walkSpeed stay unscaled —
  // they're independent tuning knobs. The validator guarantees scale > 0.
  const s = data.stats.scale;
  if (s !== 1) {
    const scaleBox = (box: Box): void => { box.x *= s; box.y *= s; box.w *= s; box.h *= s; };
    for (const spec of Object.values(states)) {
      for (const f of spec.frames) {
        f.hurt.forEach(scaleBox);
        scaleBox(f.push);
        f.hit.forEach(scaleBox);
        f.guardStand.forEach(scaleBox);
        f.guardCrouch.forEach(scaleBox);
      }
    }
  }

  return { id, stats: { ...data.stats }, states, attacks };
}
