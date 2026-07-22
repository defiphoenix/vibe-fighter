import * as Phaser from "phaser";
import type { CharacterConfig, CharacterData, StateName } from "../sim/types";
import { assembleCharacter } from "../sim/character-builder";
import { validateRegistry, STATE_NAMES } from "../sim/validate-character";

/** One animation sheet's render metadata (playback frames — decoupled from sim box-slot frames). */
export interface SheetMeta {
  path: string;
  frames: number;
  fps: number;
  loop: boolean;
  /** ATTACK sheets only: the render frame on which the strike actually connects (measured from the
   *  art by `scripts/check-attack-sync.py`). Lets `anim-timing.ts` time the animation so that frame
   *  starts on the sim's first ACTIVE tick. Optional — a sheet the measurement can't call keeps the
   *  old uniform timing rather than getting a guessed value. */
  hit?: number;
}

/** Loader-only render metadata for a fighter (never reaches the sim). */
export interface RenderMeta {
  frameWidth: number;
  frameHeight: number;
  anchor: [number, number];
  sheets: Record<StateName, SheetMeta>;
}

export interface FighterEntry {
  render: RenderMeta;
  data: CharacterData;
}

export type CharacterRegistry = Record<string, FighterEntry>;

/** Phaser texture key for a fighter's per-state sheet. Globally unique so keys never collide. */
export const textureKey = (id: string, state: StateName): string => `${id}-${state}`;

/** Read + validate the cached character-gym.json. Throws fail-fast (like buildStage) so a bad
 *  registry never boots a broken match. Returns only the fighter entries (`_`-keys dropped). */
export function loadRegistry(jsonCache: Phaser.Cache.BaseCache): CharacterRegistry {
  const raw = jsonCache.get("characters");
  if (!raw) throw new Error("characters: character-gym.json not loaded");
  const errs = validateRegistry(raw);
  if (errs.length) throw new Error(`characters: invalid registry\n  ${errs.join("\n  ")}`);
  const reg: CharacterRegistry = {};
  for (const id of Object.keys(raw as object)) {
    if (id.startsWith("_")) continue;
    reg[id] = (raw as Record<string, FighterEntry>)[id];
  }
  return reg;
}

/** Assemble a fighter's pure sim CharacterConfig from its registry entry. */
export function buildConfig(id: string, entry: FighterEntry): CharacterConfig {
  return assembleCharacter(id, entry.data);
}

/** Every (id, state, sheet) triple in the registry — for the two-phase spritesheet preload. */
export function eachSheet(reg: CharacterRegistry): { id: string; state: StateName; sheet: SheetMeta }[] {
  const out: { id: string; state: StateName; sheet: SheetMeta }[] = [];
  for (const id of Object.keys(reg)) {
    for (const state of STATE_NAMES) out.push({ id, state, sheet: reg[id].render.sheets[state] });
  }
  return out;
}
