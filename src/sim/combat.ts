import { Fighter, METER_MAX } from "./fighter";
import { toWorld, overlaps } from "./geometry";
import { ATTACK_STATE_TO_KEY, isAttackState } from "./types";
import type { AttackKey, AttackSpec, SimEvent } from "./types";

interface PendingResult {
  attacker: Fighter;
  defender: Fighter;
  spec: AttackSpec;
  blocked: boolean;
  awayDir: 1 | -1;
  /** The hit window that produced this connect — what the attacker records so the SAME window can't
   *  land twice, while the NEXT window of a multi-hit special still can. */
  hitId: number;
  /** WHICH attack landed, carried into the event so the render layer can tell a light from a heavy.
   *
   *  Captured HERE, beside `spec`, and deliberately not re-read during resolution: an earlier half of
   *  a trade can already have called `applyHit()` on this same fighter, flipping it to `hitstun` or
   *  `ko`, so `attacker.state` in the resolve loop is not reliably an attack state any more.
   *
   *  The render layer cannot recover this itself either — a 15-tick `advance` batch is drained one
   *  frame later, by which time the attacker has moved on. */
  attack: AttackKey;
}

/** The attack the fighter is currently in, and WHICH one it is. Returning the key alongside the spec
 *  means the two can never disagree, and it type-narrows `state` so nothing downstream has to cast. */
function attackOf(f: Fighter): { spec: AttackSpec; key: AttackKey } | null {
  if (!isAttackState(f.state)) return null;
  const key = ATTACK_STATE_TO_KEY[f.state];
  const spec = f.cfg.attacks[key];
  return spec ? { spec, key } : null;
}

/** Meter is earned by DOING something right, never by being hit: the attacker banks what a clean hit
 *  dealt, and a fighter who successfully BLOCKS banks this fraction of what that hit would have dealt
 *  him. Guarding is rewarded, landing it is rewarded more, and eating a hit pays nothing — so the
 *  meter tracks who is playing well rather than who is taking a beating. A blocked attacker earns
 *  nothing either: chip is damage, but it is not a successful hit. */
const BLOCK_METER_SHARE = 0.5;

/** `amount` is always the damage ACTUALLY applied (rounded and difficulty-scaled) — reading the spec's
 *  raw field instead would let a fractional authored damage leak non-integers into the sim. */
function gainMeter(f: Fighter, amount: number): void {
  f.meter = Math.min(METER_MAX, f.meter + amount);
}

function anyOverlap(
  boxesA: { x: number; y: number; w: number; h: number }[],
  ax: number,
  ay: number,
  adir: 1 | -1,
  boxesB: { x: number; y: number; w: number; h: number }[],
  bx: number,
  by: number,
  bdir: 1 | -1,
): boolean {
  for (const ba of boxesA) {
    const wa = toWorld(ba, ax, ay, adir);
    for (const bb of boxesB) {
      const wb = toWorld(bb, bx, by, bdir);
      if (overlaps(wa, wb)) return true;
    }
  }
  return false;
}

/** Steps 7–9: snapshot all active contacts, then resolve them together (simultaneous trades land). */
export function resolveCombat(a: Fighter, b: Fighter): { events: SimEvent[]; hitstop: number } {
  const events: SimEvent[] = [];
  const snapshot = [
    { self: a, boxes: a.activeBoxes() },
    { self: b, boxes: b.activeBoxes() },
  ];
  const pending: PendingResult[] = [];

  for (const attacker of [a, b]) {
    const current = attackOf(attacker);
    if (!current) continue;
    const { spec, key: attack } = current;
    const atkBoxes = snapshot.find((s) => s.self === attacker)!.boxes;
    if (atkBoxes.hit.length === 0) continue;
    // Dedup is per hit WINDOW, not per attack: a normal has one window so it still lands once, while
    // a `repeat` special lands once per window. The builder tags the frames; nothing here counts.
    const hitId = atkBoxes.hitId;
    if (hitId === undefined || attacker.lastHitId === hitId) continue;

    const defender = attacker === a ? b : a;
    if (defender.isKO) continue;
    const defBoxes = snapshot.find((s) => s.self === defender)!.boxes;

    // (1) geometry: does the hit box touch the hurt box at all? else it whiffs.
    const connects = anyOverlap(
      atkBoxes.hit,
      attacker.x,
      attacker.y,
      attacker.facing,
      defBoxes.hurt,
      defender.x,
      defender.y,
      defender.facing,
    );
    if (!connects) continue;

    // (2) guard: was the right stance up? (hit box overlaps an active guard box)
    const blocked = anyOverlap(
      atkBoxes.hit,
      attacker.x,
      attacker.y,
      attacker.facing,
      defBoxes.guard,
      defender.x,
      defender.y,
      defender.facing,
    );

    const awayDir: 1 | -1 = defender.x >= attacker.x ? 1 : -1;
    pending.push({ attacker, defender, spec, blocked, awayDir, hitId, attack });
  }

  let hitstop = 0;
  for (const r of pending) {
    r.attacker.lastHitId = r.hitId;
    hitstop = Math.max(hitstop, r.spec.hitstop);
    // The attacker's handicap scales what it deals. A clean hit floors at 1 so a connect always
    // registers; chip is allowed to floor at 0.
    // ponytail: at the SHIPPED numbers that chip floor never fires — light chip is 1 and
    // round(1 * 0.55) is still 1, so blocking a CPU light costs the same on easy as on hard, and
    // only heavy chip moves (3 -> 2 on easy/normal). The handicap is a DIRECT-damage lever in
    // practice (light 6 -> 3/4/5, heavy 15 -> 8/11/13). Chip is small enough that this doesn't
    // matter; make chip a real difficulty lever only if blocking ever becomes the way to lose.
    const scale = r.attacker.damageScale;
    // What a clean connect would apply. The hit branch spends it as damage; the block branch only
    // sizes the blocker's meter reward off it, so a stronger attack is worth more to block.
    const damage = Math.max(1, Math.round(r.spec.damage * scale));
    if (r.blocked) {
      const kbx = r.spec.knockback.x * 0.5 * r.awayDir;
      const chip = Math.max(0, Math.round(r.spec.chip * scale));
      r.defender.applyHit(chip, r.spec.blockstun, kbx, 0, true);
      gainMeter(r.defender, Math.floor(damage * BLOCK_METER_SHARE));
      events.push({ type: "block", player: r.defender.index, x: r.defender.x, y: r.defender.y, data: { attack: r.attack } });
      // Chip can KO through a block. world.checkRoundOver ends the round either way, but without
      // this the render layer never sees a `ko` event and the KO flash silently doesn't fire.
      if (r.defender.isKO) events.push({ type: "ko", player: r.defender.index });
    } else {
      const kbx = r.spec.knockback.x * r.awayDir;
      r.defender.applyHit(damage, r.spec.hitstun, kbx, r.spec.knockback.y, false);
      gainMeter(r.attacker, damage);
      // The SCALED number goes in the payload: MatchScene reads it for hit-feedback intensity.
      // hitId lets the render layer tell one window of a multi-hit special from the next.
      events.push({ type: "hit", player: r.defender.index, x: r.defender.x, y: r.defender.y, data: { damage, hitId: r.hitId, attack: r.attack } });
      if (r.defender.isKO) events.push({ type: "ko", player: r.defender.index });
    }
  }

  return { events, hitstop };
}
