import { describe, it, expect } from "vitest";
import registry from "../../public/configs/character-gym.json";
import type { CharacterData } from "./types";

// The monk felt like "his moves don't reach" even though his attacks executed and connected: his art
// is a WIDE low stance, so his pushboxes are bigger (stand 60 / crouch 76 vs 56 / 60), which parks him
// further from the opponent and makes the same nominal hit box land short. Raw hit-box reach is
// therefore the wrong thing to compare between characters — what matters is reach MINUS the fighter's
// own pushbox half, i.e. how far past his own body he actually strikes.
//
// This pins the compensation: a wider-bodied character must get correspondingly longer hit boxes so no
// fighter is out-ranged purely by being broad. Change a pushbox or a hit width and this test tells you
// whether the roster is still fair.

/* eslint-disable @typescript-eslint/no-explicit-any */
const reg = registry as unknown as Record<string, { data: CharacterData }>;
const FIGHTERS = Object.keys(reg).filter((k) => (reg[k] as any)?.data); // skip the `_doc` metadata key

const GROUND_ATTACKS = ["light", "heavy", "crouchLight", "crouchHeavy"] as const;
// The AIR normals were never covered, and the gap was real: measured on the shipped registry the monk
// struck 80 vs 82 on airLight and 105 vs 107 on airHeavy — out-ranged on both, which is the exact
// thing this file exists to prevent. Small, but the test not looking is why it survived.
const AIR_ATTACKS = ["airLight", "airHeavy"] as const;
type AttackName = (typeof GROUND_ATTACKS)[number] | (typeof AIR_ATTACKS)[number];

/** How far past his own body the fighter strikes.
 *
 *  The pushbox is picked by the attack's own `body`, not by its name: an AIR normal has
 *  `body: "air"` and is measured against `pushStand`, because that is the profile
 *  `character-builder.ts` gives it. Assuming crouch-vs-stand from the name would silently measure the
 *  air normals against the wrong body. */
function effectiveReach(id: string, attack: AttackName): number {
  const d = reg[id].data;
  const atk = (d.attacks as any)[attack];
  const pushHalf = (atk.body === "crouch" ? d.boxes.pushCrouch.w : d.boxes.pushStand.w) / 2;
  return atk.hit.x + atk.hit.w - pushHalf;
}

describe("reach parity across the roster", () => {
  it("has the full roster", () => {
    expect(FIGHTERS).toEqual(expect.arrayContaining(["brawler", "jiujitsu", "monk"]));
  });

  for (const attack of [...GROUND_ATTACKS, ...AIR_ATTACKS]) {
    it(`no fighter is out-ranged on ${attack} by being wide-bodied`, () => {
      const reaches = FIGHTERS.map((id) => ({ id, r: effectiveReach(id, attack) }));
      const best = Math.max(...reaches.map((x) => x.r));
      // The monk carries the widest pushboxes, so he is the one this can silently punish.
      const monk = reaches.find((x) => x.id === "monk")!;
      expect(monk.r, `monk.${attack} effective reach vs roster best ${best}`).toBeGreaterThanOrEqual(best);
    });
  }

  it("the monk's wider pushbox is the thing being compensated (guards the premise)", () => {
    // If this ever fails the monk stopped being the wide one and the compensation above needs redoing.
    expect(reg.monk.data.boxes.pushStand.w).toBeGreaterThan(reg.brawler.data.boxes.pushStand.w);
    expect(reg.monk.data.boxes.pushCrouch.w).toBeGreaterThan(reg.brawler.data.boxes.pushCrouch.w);
  });
});
