import { Fighter } from "./fighter";
import { toWorld, overlaps } from "./geometry";
import { ATTACK_STATE_TO_KEY, isAttackState } from "./types";
import type { AttackSpec, SimEvent } from "./types";

interface PendingResult {
  attacker: Fighter;
  defender: Fighter;
  spec: AttackSpec;
  blocked: boolean;
  awayDir: 1 | -1;
}

function attackSpecOf(f: Fighter): AttackSpec | null {
  return isAttackState(f.state) ? f.cfg.attacks[ATTACK_STATE_TO_KEY[f.state]] : null;
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
    if (attacker.hasHit) continue;
    const spec = attackSpecOf(attacker);
    if (!spec) continue;
    const atkBoxes = snapshot.find((s) => s.self === attacker)!.boxes;
    if (atkBoxes.hit.length === 0) continue;

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
    pending.push({ attacker, defender, spec, blocked, awayDir });
  }

  let hitstop = 0;
  for (const r of pending) {
    r.attacker.hasHit = true;
    hitstop = Math.max(hitstop, r.spec.hitstop);
    // The attacker's handicap scales what it deals. A clean hit floors at 1 so a connect always
    // registers; chip is allowed to floor at 0.
    // ponytail: at the SHIPPED numbers that chip floor never fires — light chip is 1 and
    // round(1 * 0.55) is still 1, so blocking a CPU light costs the same on easy as on hard, and
    // only heavy chip moves (3 -> 2 on easy/normal). The handicap is a DIRECT-damage lever in
    // practice (light 6 -> 3/4/5, heavy 15 -> 8/11/13). Chip is small enough that this doesn't
    // matter; make chip a real difficulty lever only if blocking ever becomes the way to lose.
    const scale = r.attacker.damageScale;
    if (r.blocked) {
      const kbx = r.spec.knockback.x * 0.5 * r.awayDir;
      r.defender.applyHit(Math.max(0, Math.round(r.spec.chip * scale)), r.spec.blockstun, kbx, 0, true);
      events.push({ type: "block", player: r.defender.index, x: r.defender.x, y: r.defender.y });
      // Chip can KO through a block. world.checkRoundOver ends the round either way, but without
      // this the render layer never sees a `ko` event and the KO flash silently doesn't fire.
      if (r.defender.isKO) events.push({ type: "ko", player: r.defender.index });
    } else {
      const kbx = r.spec.knockback.x * r.awayDir;
      const damage = Math.max(1, Math.round(r.spec.damage * scale));
      r.defender.applyHit(damage, r.spec.hitstun, kbx, r.spec.knockback.y, false);
      // The SCALED number goes in the payload: MatchScene reads it for hit-feedback intensity.
      events.push({ type: "hit", player: r.defender.index, x: r.defender.x, y: r.defender.y, data: { damage } });
      if (r.defender.isKO) events.push({ type: "ko", player: r.defender.index });
    }
  }

  return { events, hitstop };
}
