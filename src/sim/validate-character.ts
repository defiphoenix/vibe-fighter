// NOTE: these two carry a `.js` extension while the rest of src/ does not. They are the tail of the
// chain vite.config.ts -> vite/gym-save-plugin.ts -> here, and Vite 8's `configLoader: "native"`
// (planned to become the default) cannot resolve an extensionless import in that chain. Extensions
// here are the forward-compatible fix; suppressing the warning would have hidden the signal.
import type { AttackKey, AttackStateName, StateName } from "./types.js";
import { ATTACK_STATE_TO_KEY, isAttackState, isGuardableState } from "./types.js";

/** Mirrors PLAY_LAG_TICKS in render/anim-timing.ts. Duplicated, not imported: sim/ must not depend
 *  on render/. anim-timing.test.ts pins the two together. */
const PLAY_LAG_TICKS = 1;

// Shared, pure validator for character-gym.json entries. Used by BootScene (throw on any error)
// and the dev-only Vite write-back middleware (reject a bad save). One source of truth so the two
// paths can't drift. Operates on untyped input — every access is guarded.

export const STATE_NAMES: StateName[] = [
  "idle", "walkF", "walkB", "crouch", "block", "blockCrouch", "jumpRise", "jumpFall",
  "attackLight", "attackHeavy", "airLight", "airHeavy", "crouchLight", "crouchHeavy", "special",
  "hitstun", "blockstun", "knockdown", "ko",
];

const NON_ATTACK: Exclude<StateName, AttackStateName>[] = [
  "idle", "walkF", "walkB", "crouch", "block", "blockCrouch", "jumpRise", "jumpFall", "hitstun", "blockstun", "knockdown", "ko",
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
  // Phase 15 multi-hit. count >= 1 because 0 windows is an attack with no hit box at all, spelled
  // obscurely; gap may be 0 (back-to-back windows are still separate ids, so still separate hits).
  if (v.repeat !== undefined) {
    if (!isObj(v.repeat)) errs.push(`${where}.repeat: not an object`);
    else {
      if (!isPosInt(v.repeat.count)) errs.push(`${where}.repeat.count: positive integer required`);
      if (!isFiniteNum(v.repeat.gap) || !Number.isInteger(v.repeat.gap) || (v.repeat.gap as number) < 0) {
        errs.push(`${where}.repeat.gap: non-negative integer required`);
      }
    }
  }
  if (v.freeze !== undefined && (!isFiniteNum(v.freeze) || !Number.isInteger(v.freeze) || (v.freeze as number) < 0)) {
    errs.push(`${where}.freeze: non-negative integer required`);
  }
  checkBox(v.hit, `${where}.hit`, errs);
  // effects must be non-negative (negative damage/chip would HEAL the victim past max health).
  for (const k of ["damage", "hitstun", "blockstun", "hitstop", "chip"]) {
    if (!isFiniteNum(v[k])) errs.push(`${where}.${k}: not a finite number`);
    else if ((v[k] as number) < 0) errs.push(`${where}.${k}: must be >= 0`);
  }
  if (!isObj(v.knockback) || !isFiniteNum(v.knockback.x) || !isFiniteNum(v.knockback.y)) errs.push(`${where}.knockback: needs finite x,y`);
}

/**
 * `render.sheets.<state>.hit` — the measured contact frame, optional.
 *
 * Rules, in the order they can fail:
 *  - non-attack sheets have no active window to align to, so the field is meaningless there;
 *  - it indexes render frames, so it must be an integer inside the sheet;
 *  - it must be > 0, because frames 0..hit-1 are the wind-up segment and a hit of 0 leaves that
 *    segment empty — which is just the uniform timing, spelled the long way;
 *  - and `startup` must exceed the renderer's one-tick play lag, or that segment has no time in it.
 *    `startup: 0` is legal for an attack (checkAttack only requires non-negative).
 */
function checkHitFrame(
  sh: Record<string, unknown>,
  state: StateName,
  data: unknown,
  p: (m: string) => void,
): void {
  if (sh.hit === undefined) return;
  const where = `render.sheets.${state}.hit`;
  if (!isAttackState(state)) return void p(`${where}: only attack sheets can declare a contact frame`);
  if (!isFiniteNum(sh.hit) || !Number.isInteger(sh.hit)) return void p(`${where}: integer required`);
  const frames = isFiniteNum(sh.frames) ? sh.frames : 0;
  if (sh.hit <= 0 || sh.hit >= frames) return void p(`${where}: must be in 1..${frames - 1} (got ${sh.hit})`);
  const attacks = isObj(data) && isObj(data.attacks) ? data.attacks : undefined;
  const atk = attacks?.[ATTACK_STATE_TO_KEY[state]];
  const startup = isObj(atk) && isFiniteNum(atk.startup) ? atk.startup : 0;
  // Strictly greater than the render's one-tick play lag, not merely non-zero: anim-timing budgets
  // the wind-up `startup - PLAY_LAG_TICKS` ticks, so startup 1 would declare a contact frame that
  // the renderer then silently refuses to use. Keep the two contracts in step.
  if (startup <= PLAY_LAG_TICKS) p(`${where}: needs startup > ${PLAY_LAG_TICKS} to spread over frames 0..${sh.hit - 1} (got ${startup})`);
}

/** Assembled frame count + active windows (empty for a non-attack) for a state, from the authored
 *  data. A `repeat` attack has one window per hit, so this is a LIST — mirrors attackState() in
 *  character-builder.ts, which lays the frames out the same way. */
function stateShape(data: Record<string, unknown>, state: StateName): { len: number; active: [number, number][] } | null {
  const attacks = isObj(data.attacks) ? data.attacks : {};
  const frames = isObj(data.frames) ? data.frames : {};
  if (isAttackState(state)) {
    const a = attacks[ATTACK_STATE_TO_KEY[state]];
    if (!isObj(a) || !isFiniteNum(a.startup) || !isFiniteNum(a.active) || !isFiniteNum(a.recovery)) return null;
    const s = a.startup as number, ac = a.active as number, r = a.recovery as number;
    const rep = isObj(a.repeat) ? a.repeat : undefined;
    const count = isPosInt(rep?.count) ? (rep.count as number) : 1;
    const gap = isFiniteNum(rep?.gap) ? (rep.gap as number) : 0;
    const active: [number, number][] = [];
    let at = s;
    for (let w = 0; w < count; w++) {
      if (w > 0) at += gap;
      active.push([at, at + ac]);
      at += ac;
    }
    return { len: at + r, active };
  }
  const n = frames[state];
  if (!isFiniteNum(n)) return null;
  return { len: n as number, active: [] };
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

  // render sheets: exactly the 18 states (STATE_NAMES), each well-formed
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
        checkHitFrame(sh, s, data, p);
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
            // ANY of the windows — a `repeat` special has one per hit, and a hit override is legal
            // inside each of them (that is how a later window gets different reach).
            const inActive = shape?.active.some(([lo, hi]) => frame >= lo && frame < hi);
            if (!inActive) p(`overrides.${key}: hit override on frame ${frame} is outside the attack active window`);
          }
          // Guard, same shape of rule as `hit` above: the box has to be well-formed AND the state has
          // to be one that can carry a guard box at all. `Fighter.guarding` is derived from this data,
          // so a guard box on an attack frame would make the attacker blockable mid-punch. The builder
          // drops these too (config.ts assembles with no validator in front) — this is what stops a
          // hand edit being silently swallowed.
          for (const g of ["guardStand", "guardCrouch"] as const) {
            if (ov[g] === undefined) continue;
            checkBoxArray(ov[g], `overrides.${key}[${frame}].${g}`, errs);
            if (!isGuardableState(key as StateName)) p(`overrides.${key}: ${g} override on a state that cannot guard`);
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
