import type { AttackKey, AttackStateName, StateName } from "./types";
import { ATTACK_STATE_TO_KEY, isAttackState } from "./types";

// Shared, pure validator for character-gym.json entries. Used by BootScene (throw on any error)
// and the dev-only Vite write-back middleware (reject a bad save). One source of truth so the two
// paths can't drift. Operates on untyped input — every access is guarded.

export const STATE_NAMES: StateName[] = [
  "idle", "walkF", "walkB", "crouch", "jumpRise", "jumpFall",
  "attackLight", "attackHeavy", "airLight", "airHeavy", "crouchLight", "crouchHeavy",
  "hitstun", "blockstun", "knockdown", "ko",
];

const NON_ATTACK: Exclude<StateName, AttackStateName>[] = [
  "idle", "walkF", "walkB", "crouch", "jumpRise", "jumpFall", "hitstun", "blockstun", "knockdown", "ko",
];

// The four air/crouch variants must use the matching body template; the two ground normals are left
// free to use either stand or crouch. Both ship as "stand" — `body` is the ATTACKER's own
// vulnerability profile, and a standing animation needs a standing hurt box (the heavy shipped as
// "crouch" against a standing punch, leaving the top 40% of the fighter invulnerable). It does NOT
// decide high/low: that is the HIT box's y band vs the defender's guard boxes. Enforced in checkAttack.
const ATTACK_EXPECTED_BODY: Partial<Record<AttackKey, "air" | "crouch">> = {
  airLight: "air", airHeavy: "air", crouchLight: "crouch", crouchHeavy: "crouch",
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPosInt = (v: unknown): v is number => isFiniteNum(v) && Number.isInteger(v) && v > 0;

function checkBox(v: unknown, where: string, errs: string[]): void {
  if (!isObj(v)) return void errs.push(`${where}: not a box object`);
  for (const k of ["x", "y", "w", "h"]) if (!isFiniteNum(v[k])) errs.push(`${where}.${k}: not a finite number`);
  if (isFiniteNum(v.w) && v.w <= 0) errs.push(`${where}.w: must be > 0`);
  if (isFiniteNum(v.h) && v.h <= 0) errs.push(`${where}.h: must be > 0`);
}

function checkBoxArray(v: unknown, where: string, errs: string[]): void {
  if (!Array.isArray(v)) return void errs.push(`${where}: not an array`);
  v.forEach((b, i) => checkBox(b, `${where}[${i}]`, errs));
}

function checkAttack(v: unknown, where: string, errs: string[], expectBody?: "air" | "crouch"): void {
  if (!isObj(v)) return void errs.push(`${where}: missing`);
  if (!["stand", "crouch", "air"].includes(v.body as string)) errs.push(`${where}.body: must be stand|crouch|air`);
  if (expectBody && v.body !== expectBody) errs.push(`${where}.body: must be "${expectBody}" for this attack`);
  for (const k of ["startup", "active", "recovery"]) {
    if (!isFiniteNum(v[k]) || (v[k] as number) < 0 || !Number.isInteger(v[k])) errs.push(`${where}.${k}: non-negative integer required`);
  }
  if (isFiniteNum(v.active) && (v.active as number) < 1) errs.push(`${where}.active: must be >= 1`);
  checkBox(v.hit, `${where}.hit`, errs);
  // effects must be non-negative (negative damage/chip would HEAL the victim past max health).
  for (const k of ["damage", "hitstun", "blockstun", "hitstop", "chip"]) {
    if (!isFiniteNum(v[k])) errs.push(`${where}.${k}: not a finite number`);
    else if ((v[k] as number) < 0) errs.push(`${where}.${k}: must be >= 0`);
  }
  if (!isObj(v.knockback) || !isFiniteNum(v.knockback.x) || !isFiniteNum(v.knockback.y)) errs.push(`${where}.knockback: needs finite x,y`);
}

/** Assembled frame count + active window (or null) for a state, from the authored data. */
function stateShape(data: Record<string, unknown>, state: StateName): { len: number; active: [number, number] | null } | null {
  const attacks = isObj(data.attacks) ? data.attacks : {};
  const frames = isObj(data.frames) ? data.frames : {};
  if (isAttackState(state)) {
    const a = attacks[ATTACK_STATE_TO_KEY[state]];
    if (!isObj(a) || !isFiniteNum(a.startup) || !isFiniteNum(a.active) || !isFiniteNum(a.recovery)) return null;
    const s = a.startup as number, ac = a.active as number, r = a.recovery as number;
    return { len: s + ac + r, active: [s, s + ac] };
  }
  const n = frames[state];
  if (!isFiniteNum(n)) return null;
  return { len: n as number, active: null };
}

/** Validate one `{ render, data }` fighter entry. Returns human-readable errors ([] = valid). */
export function validateFighterEntry(id: string, entry: unknown): string[] {
  const errs: string[] = [];
  const p = (m: string) => errs.push(`[${id}] ${m}`);
  if (!isObj(entry)) return [`[${id}] entry is not an object`];

  const data = entry.data;
  const render = entry.render;
  if (!isObj(data)) return [`[${id}] missing data`];
  if (!isObj(render)) p("missing render");

  // stats
  if (!isObj(data.stats)) p("missing stats");
  else {
    for (const k of ["walkSpeed", "jumpVelocity", "gravity"]) if (!isFiniteNum(data.stats[k])) p(`stats.${k}: not a finite number`);
    if (!isFiniteNum(data.stats.maxHealth) || (data.stats.maxHealth as number) <= 0) p("stats.maxHealth: must be > 0");
    // scale multiplies every collision box (character-builder) — 0 collapses them all and makes the
    // Gym's inverse divide by zero; a negative yields negative w/h, which toWorld normalises
    // horizontally but NOT vertically, so overlap tests would silently go wrong.
    if (!isFiniteNum(data.stats.scale) || (data.stats.scale as number) <= 0) p("stats.scale: must be > 0");
  }

  // boxes
  if (!isObj(data.boxes)) p("missing boxes");
  else {
    const b = data.boxes;
    checkBox(b.pushStand, "boxes.pushStand", errs);
    checkBox(b.pushCrouch, "boxes.pushCrouch", errs);
    checkBoxArray(b.hurtStand, "boxes.hurtStand", errs);
    checkBoxArray(b.hurtCrouch, "boxes.hurtCrouch", errs);
    checkBoxArray(b.hurtAir, "boxes.hurtAir", errs);
    checkBoxArray(b.guardStand, "boxes.guardStand", errs);
    checkBoxArray(b.guardCrouch, "boxes.guardCrouch", errs);
    for (const k of ["knockdown", "ko"] as const) {
      if (!isObj(b[k])) p(`boxes.${k}: missing`);
      else { checkBoxArray((b[k] as Record<string, unknown>).hurt, `boxes.${k}.hurt`, errs); checkBox((b[k] as Record<string, unknown>).push, `boxes.${k}.push`, errs); }
    }
  }

  // attacks: all six slots (ground light/heavy + air + crouch), each with the right body template
  if (!isObj(data.attacks)) p("missing attacks");
  else for (const key of Object.values(ATTACK_STATE_TO_KEY)) {
    checkAttack((data.attacks as Record<string, unknown>)[key], `attacks.${key}`, errs, ATTACK_EXPECTED_BODY[key]);
  }

  // non-attack frame counts
  if (!isObj(data.frames)) p("missing frames");
  else for (const s of NON_ATTACK) if (!isPosInt(data.frames[s])) p(`frames.${s}: positive integer required`);

  // render sheets: exactly the 16 states (STATE_NAMES), each well-formed
  if (isObj(render)) {
    for (const k of ["frameWidth", "frameHeight"]) if (!isPosInt(render[k])) p(`render.${k}: positive integer required`);
    if (!Array.isArray(render.anchor) || render.anchor.length !== 2 || !render.anchor.every(isFiniteNum)) {
      p("render.anchor: must be [x,y] finite numbers");
    }
    const sheets = render.sheets;
    if (!isObj(sheets)) p("render.sheets: missing");
    else {
      for (const s of STATE_NAMES) {
        const sh = sheets[s];
        if (!isObj(sh)) { p(`render.sheets.${s}: missing`); continue; }
        if (typeof sh.path !== "string" || sh.path.length === 0) p(`render.sheets.${s}.path: required`);
        if (!isPosInt(sh.frames)) p(`render.sheets.${s}.frames: positive integer required`);
        if (!isFiniteNum(sh.fps) || (sh.fps as number) <= 0) p(`render.sheets.${s}.fps: must be > 0`);
        if (typeof sh.loop !== "boolean") p(`render.sheets.${s}.loop: boolean required`);
      }
      for (const k of Object.keys(sheets)) if (!STATE_NAMES.includes(k as StateName)) p(`render.sheets.${k}: unknown state`);
    }
  }

  // overrides: frame bounds, no duplicates, hit only inside an attack active window
  if (data.overrides !== undefined) {
    if (!isObj(data.overrides)) p("overrides: not an object");
    else {
      for (const key of Object.keys(data.overrides)) {
        if (!STATE_NAMES.includes(key as StateName)) { p(`overrides.${key}: unknown state`); continue; }
        const list = (data.overrides as Record<string, unknown>)[key];
        if (!Array.isArray(list)) { p(`overrides.${key}: not an array`); continue; }
        const shape = stateShape(data, key as StateName);
        const seen = new Set<number>();
        for (const ov of list) {
          if (!isObj(ov) || !isFiniteNum(ov.frame)) { p(`overrides.${key}: bad override entry`); continue; }
          const frame = ov.frame as number;
          if (!Number.isInteger(frame)) { p(`overrides.${key}: frame ${frame} must be an integer`); continue; }
          if (seen.has(frame)) p(`overrides.${key}: duplicate frame ${frame}`);
          seen.add(frame);
          if (shape && (frame < 0 || frame >= shape.len)) p(`overrides.${key}: frame ${frame} out of range (0..${shape.len - 1})`);
          if (ov.hurt !== undefined) checkBoxArray(ov.hurt, `overrides.${key}[${frame}].hurt`, errs);
          if (ov.push !== undefined) checkBox(ov.push, `overrides.${key}[${frame}].push`, errs);
          if (ov.hit !== undefined) {
            checkBoxArray(ov.hit, `overrides.${key}[${frame}].hit`, errs);
            const inActive = shape?.active && frame >= shape.active[0] && frame < shape.active[1];
            if (!inActive) p(`overrides.${key}: hit override on frame ${frame} is outside the attack active window`);
          }
        }
      }
    }
  }

  return errs;
}

/** Validate a whole registry file `{ _doc?, <id>: entry }`. */
export function validateRegistry(raw: unknown): string[] {
  if (!isObj(raw)) return ["registry: not an object"];
  const ids = Object.keys(raw).filter((k) => !k.startsWith("_"));
  if (ids.length === 0) return ["registry: no fighter entries"];
  return ids.flatMap((id) => validateFighterEntry(id, raw[id]));
}
