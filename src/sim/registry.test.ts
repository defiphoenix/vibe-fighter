import { describe, it, expect } from "vitest";
import { World } from "./world";
import { assembleCharacter } from "./character-builder";
import { validateRegistry } from "./validate-character";
import { emptyInput, type CharacterData, type InputSnapshot } from "./types";
import registry from "../../public/configs/character-gym.json";

const RAW = registry as unknown as Record<string, { render: unknown; data: CharacterData }>;

const IDS = Object.keys(RAW).filter((k) => !k.startsWith("_"));
const STATES = ["idle", "walkF", "walkB", "crouch", "jumpRise", "jumpFall", "attackLight", "attackHeavy", "airLight", "airHeavy", "crouchLight", "crouchHeavy", "hitstun", "blockstun", "knockdown", "ko"];

const mk = (over: Partial<InputSnapshot> = {}): InputSnapshot => ({ ...emptyInput(), ...over });
const lightPress = mk({ light: true, lightPressed: true });

describe("shipped character registry", () => {
  it("is the three-fighter roster and validates clean", () => {
    expect(IDS.sort()).toEqual(["brawler", "jiujitsu", "monk"]);
    expect(validateRegistry(RAW)).toEqual([]);
  });

  it("every fighter assembles into 16 states + all six attacks + guards", () => {
    for (const id of IDS) {
      const c = assembleCharacter(id, RAW[id].data);
      expect(Object.keys(c.states).sort()).toEqual([...STATES].sort());
      expect(c.attacks.light.kind).toBe("light");
      expect(c.attacks.heavy.kind).toBe("heavy");
      expect(c.attacks.airLight.kind).toBe("airLight");
      expect(c.attacks.crouchHeavy.kind).toBe("crouchHeavy");
      expect(c.guardStand.length).toBeGreaterThan(0);
      expect(c.guardCrouch.length).toBeGreaterThan(0);
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
  key: "light" | "heavy" | "crouchLight" | "crouchHeavy",
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
  const press = mk({ [heavy ? "heavy" : "light"]: true, [heavy ? "heavyPressed" : "lightPressed"]: true, down: low });
  const hold = mk({ down: low });
  const guard =
    stance === "none" ? mk()
      : stance === "duck" ? mk({ down: true })
        : mk({ block: true, down: stance === "crouch" });
  const start = w.fighters[1].health;
  for (let i = 0; i < 40; i++) w.tick([i === 0 ? press : hold, guard]);
  return start - w.fighters[1].health;
}

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
          for (const gap of GAPS) {
            const raw = shippedExchange(atk, def, m.key, "none", gap);
            if (raw === 0) continue; // out of reach at this spacing — nothing to block
            expect(raw, `unguarded @${gap}`).toBe(damage);
            expect(shippedExchange(atk, def, m.key, m.blockedBy, gap), `${m.blockedBy} guard @${gap}`).toBe(chip);
            expect(shippedExchange(atk, def, m.key, wrong, gap), `${wrong} guard @${gap}`).toBe(damage);
          }
        });
      }
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
