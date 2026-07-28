import { describe, it, expect } from "vitest";
import { World } from "./world";
import { assembleCharacter } from "./character-builder";
import { validateRegistry } from "./validate-character";
import { METER_MAX } from "./fighter";
import { emptyInput, type CharacterData, type InputSnapshot } from "./types";
import registry from "../../public/configs/character-gym.json";

const RAW = registry as unknown as Record<string, { render: unknown; data: CharacterData }>;

const IDS = Object.keys(RAW).filter((k) => !k.startsWith("_"));
const STATES = ["idle", "walkF", "walkB", "crouch", "block", "blockCrouch", "jumpRise", "jumpFall", "attackLight", "attackHeavy", "airLight", "airHeavy", "crouchLight", "crouchHeavy", "special", "hitstun", "blockstun", "knockdown", "ko"];

const mk = (over: Partial<InputSnapshot> = {}): InputSnapshot => ({ ...emptyInput(), ...over });
const lightPress = mk({ light: true, lightPressed: true });

describe("shipped character registry", () => {
  it("is the three-fighter roster and validates clean", () => {
    expect(IDS.sort()).toEqual(["brawler", "jiujitsu", "monk"]);
    expect(validateRegistry(RAW)).toEqual([]);
  });

  it("every fighter assembles into 19 states + all seven attacks + guards", () => {
    for (const id of IDS) {
      const c = assembleCharacter(id, RAW[id].data);
      expect(Object.keys(c.states).sort()).toEqual([...STATES].sort());
      expect(c.attacks.light.kind).toBe("light");
      expect(c.attacks.heavy.kind).toBe("heavy");
      expect(c.attacks.airLight.kind).toBe("airLight");
      expect(c.attacks.crouchHeavy.kind).toBe("crouchHeavy");
      expect(c.attacks.special.kind).toBe("special");
      // Phase 13b: guard is per-frame AND now lives on the dedicated held-guard states. It must be on
      // the block states + blockstun, and absent on idle/crouch (a fighter is never guarding there) and
      // on attacks.
      expect(c.states.block.frames[0].guardStand.length).toBeGreaterThan(0);
      expect(c.states.blockCrouch.frames[0].guardCrouch.length).toBeGreaterThan(0);
      expect(c.states.blockstun.frames[0].guardCrouch.length).toBeGreaterThan(0);
      expect(c.states.idle.frames[0].guardStand).toEqual([]);
      expect(c.states.crouch.frames[0].guardCrouch).toEqual([]);
      expect(c.states.attackHeavy.frames[0].guardStand).toEqual([]);
    }
  });

  it("fighters are distinct (no A/B duplication)", () => {
    const speeds = IDS.map((id) => RAW[id].data.stats.walkSpeed);
    expect(new Set(speeds).size).toBe(speeds.length); // all different
    // and at least one box geometry differs
    const crouchW = IDS.map((id) => RAW[id].data.boxes.pushCrouch.w);
    expect(new Set(crouchW).size).toBeGreaterThan(1);
  });
});

/** Damage the SHIPPED `atkId` deals to the SHIPPED `defId` with one `key` normal, from separation
 *  `gap`, while the defender holds the given guard stance. Drives the real World, so it exercises the
 *  same geometry the game boots from — the unit tests above this run on TEST_DUMMY instead. */
function shippedExchange(
  atkId: string,
  defId: string,
  key: "light" | "heavy" | "crouchLight" | "crouchHeavy" | "special",
  /** "duck" = crouching but NOT guarding, to measure whether the attack reaches a low body at all. */
  stance: "stand" | "crouch" | "none" | "duck",
  gap: number,
): number {
  const w = new World(assembleCharacter(atkId, RAW[atkId].data), assembleCharacter(defId, RAW[defId].data));
  w.match.phase = "fight";
  w.match.introTicks = 0;
  w.fighters[0].reset(640 - gap / 2, 1);
  w.fighters[1].reset(640 + gap / 2, -1);
  const heavy = key === "heavy" || key === "crouchHeavy";
  const low = key === "crouchLight" || key === "crouchHeavy";
  // The special is grounded-only and has no stance variant; it just needs a full bar to come out.
  if (key === "special") w.fighters[0].meter = METER_MAX;
  const press = key === "special"
    ? mk({ special: true, specialPressed: true })
    : mk({ [heavy ? "heavy" : "light"]: true, [heavy ? "heavyPressed" : "lightPressed"]: true, down: low });
  const hold = mk({ down: low });
  const guard =
    stance === "none" ? mk()
      : stance === "duck" ? mk({ down: true })
        : mk({ block: true, down: stance === "crouch" });
  const start = w.fighters[1].health;
  // A special needs room for its freeze (36) plus every window and hitstop; a normal is long done.
  const ticks = key === "special" ? 300 : 40;
  for (let i = 0; i < ticks; i++) w.tick([i === 0 ? press : hold, guard]);
  return start - w.fighters[1].health;
}

// Phase 15. `repeat.count` authors hit OPPORTUNITIES, not guaranteed connects: each window's knockback
// integrates before the next window resolves, so a special whose push is too strong walks the defender
// out from under its own later hits. The TEST_DUMMY fixture sets knockback.x = 0 to make the arithmetic
// exact; this runs the SHIPPED numbers, which do push (30-35), and is the thing that fails if a future
// balance tweak quietly costs a fighter a hit.
describe("shipped specials land every authored window", () => {
  for (const id of IDS) {
    it(`${id}: one special animation connects repeat.count times`, () => {
      const data = RAW[id].data;
      const spec = data.attacks.special;
      const count = spec.repeat?.count ?? 1;
      expect(count, `${id} has no multi-hit special`).toBeGreaterThan(1);

      const w = new World(assembleCharacter(id, data), assembleCharacter(id, data));
      w.match.phase = "fight";
      w.match.introTicks = 0;
      w.fighters[0].reset(640 - 45, 1);
      w.fighters[1].reset(640 + 45, -1);
      w.fighters[0].meter = METER_MAX;

      const press = mk({ special: true, specialPressed: true });
      let hits = 0;
      const start = w.fighters[1].health;
      // Long enough for the freeze (36) + the whole move + every hitstop, with room to spare.
      for (let i = 0; i < 300; i++) {
        w.tick([i === 0 ? press : mk(), mk()]);
        for (const e of w.drainEvents()) if (e.type === "hit" && e.player === 1) hits++;
      }
      expect(hits, `${id} special landed ${hits} of ${count} windows`).toBe(count);
      expect(start - w.fighters[1].health).toBe(count * spec.damage);
    });
  }
});

// The defect behind the "jiujitsu and monk have no special" report. Meter is paid as `+damage`, so a
// fighter's meter lands on multiples of its OWN numbers: the brawler's heavy pays 15 and hits 100
// exactly on the 7th, while jiujitsu and monk pay 14 and rest on 98 — two points short, with a bar that drew
// 98% of its slot and read as full. The sim was right and the HUD was lying; `meter-view.ts` fixes the
// drawing and this pins the arithmetic that made 98 a place a player actually stops.
//
// This is a CROSS-FIGHTER comparison of an absolute stat, which is exactly the shape of R-13 — the
// numbers differ per fighter, so a test written from one fighter's damage cannot see it.
describe("meter fills to a fighter's own numbers, not a shared 100", () => {
  /** Meter after `reps` clean heavies, re-planting both fighters so knockback can't walk the defender
   *  out of range. Drives the real World with the shipped registry. */
  function meterAfterHeavies(id: string, reps: number): number {
    const data = RAW[id].data;
    const w = new World(assembleCharacter(id, data), assembleCharacter(id, data));
    w.match.phase = "fight";
    w.match.introTicks = 0;
    const press = mk({ heavy: true, heavyPressed: true });
    for (let rep = 0; rep < reps; rep++) {
      w.fighters[0].reset(640 - 45, 1);
      w.fighters[1].reset(640 + 45, -1);
      for (let i = 0; i < 60; i++) w.tick([i === 0 ? press : mk(), mk()]);
    }
    return w.fighters[0].meter;
  }

  it("seven clean heavies leave the 14-damage fighters ONE short of the super", () => {
    expect(meterAfterHeavies("brawler", 7)).toBe(METER_MAX); // 15 x 7 = 105, clamped
    expect(meterAfterHeavies("jiujitsu", 7)).toBe(98);
    expect(meterAfterHeavies("monk", 7)).toBe(98);
  });

  it("and an eighth gets them there", () => {
    for (const id of IDS) expect(meterAfterHeavies(id, 8), id).toBe(METER_MAX);
  });

  it("every fighter refuses the special one point short and fires at exactly METER_MAX", () => {
    for (const id of IDS) {
      const run = (meter: number): string => {
        const data = RAW[id].data;
        const w = new World(assembleCharacter(id, data), assembleCharacter(id, data));
        w.match.phase = "fight";
        w.match.introTicks = 0;
        w.fighters[0].reset(640 - 45, 1);
        w.fighters[1].reset(640 + 45, -1);
        w.fighters[0].meter = meter;
        w.tick([mk({ special: true, specialPressed: true }), mk()]);
        return w.fighters[0].state;
      };
      expect(run(METER_MAX - 1), `${id} fired the special on a short bar`).not.toBe("special");
      expect(run(METER_MAX), `${id} refused the special on a full bar`).toBe("special");
    }
  });
});

describe("shipped registry blocking matrix", () => {
  // Which stance is SUPPOSED to stop each normal. High/low is encoded by the guard boxes' y bands:
  // both ground normals land high (the art is a standing jab and a standing straight — the heavy's
  // fist sits 113-126px above the feet on its impact frame), and only the crouch normals sweep low.
  const MOVES = [
    { key: "light", blockedBy: "stand" },
    { key: "heavy", blockedBy: "stand" },
    { key: "crouchLight", blockedBy: "crouch" },
    { key: "crouchHeavy", blockedBy: "crouch" },
  ] as const;
  // Point-blank (pushboxes touching) through comfortable poking range. The old forward-slab guard
  // boxes failed the low end of this range, which is exactly where the match is played.
  const GAPS = [58, 62, 70, 90, 110];

  for (const atk of IDS) {
    for (const def of IDS) {
      for (const m of MOVES) {
        it(`${atk} ${m.key} vs ${def}: ${m.blockedBy} guard chips, wrong guard eats it`, () => {
          const chip = RAW[atk].data.attacks[m.key].chip;
          const damage = RAW[atk].data.attacks[m.key].damage;
          const wrong = m.blockedBy === "stand" ? "crouch" : "stand";
          let connected = 0;
          for (const gap of GAPS) {
            const raw = shippedExchange(atk, def, m.key, "none", gap);
            if (raw === 0) continue; // out of reach at this spacing — nothing to block
            connected++;
            expect(raw, `unguarded @${gap}`).toBe(damage);
            expect(shippedExchange(atk, def, m.key, m.blockedBy, gap), `${m.blockedBy} guard @${gap}`).toBe(chip);
            expect(shippedExchange(atk, def, m.key, wrong, gap), `${wrong} guard @${gap}`).toBe(damage);
          }
          // Without this the whole case passes vacuously the day a move stops reaching: every gap
          // `continue`s and nothing is ever asserted.
          expect(connected, "no gap in GAPS connected at all").toBeGreaterThan(0);
        });
      }
    }
  }
});

// A box is a claim about a sprite, and each special's art makes a DIFFERENT claim — so unlike the
// normals there is no one answer for the whole roster. The brawler drives a fist forward at head
// height and the monk thrusts palms from chest to overhead: both are highs. The jiujitsu spinarooni
// is a spinning floor sweep, its striking leg measured at 22-99px above the feet on the sheet, and it
// shipped with a chest-height box (y 75-160) that a STANDING guard stopped — a sweep you block by
// standing up. This is the ground-heavy defect all over again: nothing compared the box to the art.
describe("each shipped special is the high or low its ART is", () => {
  const SPECIAL_BLOCKED_BY: Record<string, "stand" | "crouch"> = {
    brawler: "stand",  // revolving uppercut: fist drives forward at head height
    jiujitsu: "crouch", // spinarooni: legs scythe along the floor — a LOW
    monk: "stand",     // rising palm barrage: chest height and up
  };
  const GAPS = [58, 70, 90];

  for (const atk of IDS) {
    for (const def of IDS) {
      it(`${atk} special vs ${def}: only a ${SPECIAL_BLOCKED_BY[atk]} guard stops it`, () => {
        const spec = RAW[atk].data.attacks.special;
        const count = spec.repeat?.count ?? 1;
        const right = SPECIAL_BLOCKED_BY[atk];
        const wrong = right === "stand" ? "crouch" : "stand";
        let connected = 0;
        for (const gap of GAPS) {
          const raw = shippedExchange(atk, def, "special", "none", gap);
          if (raw === 0) continue;
          connected++;
          // Every window lands, guarded or not — only WHICH stance turns damage into chip changes.
          expect(raw, `unguarded @${gap}`).toBe(count * spec.damage);
          expect(shippedExchange(atk, def, "special", right, gap), `${right} guard @${gap}`).toBe(count * spec.chip);
          expect(shippedExchange(atk, def, "special", wrong, gap), `${wrong} guard @${gap}`).toBe(count * spec.damage);
        }
        expect(connected, "no gap in GAPS connected at all").toBeGreaterThan(0);
      });
    }
  }
});

describe("the ground heavy still reaches a crouching body", () => {
  // Raising the heavy's hit box to chest height (to match its standing-punch art) left only 10-15px
  // of overlap with hurtCrouch (h:110) — monk is the thinnest at 10. That margin is invisible in the
  // blocking matrix above, which only ever measures against a STANDING defender. Drop hurtCrouch's
  // height a little, or nudge heavy.hit.y up, and the heavy silently starts passing straight through
  // anyone holding down, which reads as "my heavy doesn't work" and nothing else would catch it.
  for (const id of IDS) {
    it(`${id}'s heavy hits an unguarded crouching opponent`, () => {
      const dealt = shippedExchange(id, id, "heavy", "duck", 60);
      expect(dealt).toBe(RAW[id].data.attacks.heavy.damage);
    });
  }
});

describe("the point-blank block hole this geometry fixed", () => {
  it("the OLD forward-slab guard boxes let a heavy through a correct block at contact range", () => {
    // Pins WHY guardStand/guardCrouch now start at x -32 instead of x 15. With the old thin forward
    // slab the hit box began behind the guard box once the pushboxes touched, so the "correct" block
    // simply did nothing — proving the matrix test above is not vacuous.
    const old: CharacterData = JSON.parse(JSON.stringify(RAW.jiujitsu.data));
    old.boxes.guardStand = [{ x: 15, y: 70, w: 40, h: 108 }];
    old.boxes.guardCrouch = [{ x: 15, y: 0, w: 40, h: 80 }];

    const w = new World(assembleCharacter("brawler", RAW.brawler.data), assembleCharacter("jiujitsu", old));
    w.match.phase = "fight";
    w.match.introTicks = 0;
    w.fighters[0].reset(640 - 29, 1);
    w.fighters[1].reset(640 + 29, -1);
    const start = w.fighters[1].health;
    const press = mk({ heavy: true, heavyPressed: true });
    const guard = mk({ block: true }); // heavy is a HIGH, so standing is the correct block
    for (let i = 0; i < 40; i++) w.tick([i === 0 ? press : mk(), guard]);
    expect(start - w.fighters[1].health).toBe(RAW.brawler.data.attacks.heavy.damage); // full damage: the hole

    // same exchange with the SHIPPED boxes is chip only
    expect(shippedExchange("brawler", "jiujitsu", "heavy", "stand", 58)).toBe(RAW.brawler.data.attacks.heavy.chip);
  });
});

/** Run brawler's opening light at P2 for 20 ticks; return damage dealt to P2. */
function lightDamage(defenderData: CharacterData): number {
  const w = new World(assembleCharacter("brawler", RAW.brawler.data), assembleCharacter("jiujitsu", defenderData));
  w.match.phase = "fight";
  w.match.introTicks = 0;
  w.fighters[0].reset(640 - 45, 1);
  w.fighters[1].reset(640 + 45, -1);
  const start = w.fighters[1].health;
  for (let i = 0; i < 20; i++) w.tick([i === 0 ? lightPress : mk(), mk()]);
  return start - w.fighters[1].health;
}

describe("editing a box changes live combat (acceptance)", () => {
  it("moving the defender's hurt box out of reach turns a hit into a whiff", () => {
    const hit = lightDamage(RAW.jiujitsu.data);
    expect(hit).toBeGreaterThan(0); // brawler's light connects on the stock jiujitsu

    const moved: CharacterData = JSON.parse(JSON.stringify(RAW.jiujitsu.data));
    moved.boxes.hurtStand = [{ x: 5000, y: 0, w: 60, h: 188 }]; // teleport the hurt box away
    expect(lightDamage(moved)).toBe(0); // same inputs, now a whiff
  });
});
