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

/** How far past his own body the fighter strikes. */
function effectiveReach(id: string, attack: (typeof GROUND_ATTACKS)[number]): number {
  const d = reg[id].data;
  const hit = (d.attacks as any)[attack].hit;
  const crouching = attack.startsWith("crouch");
  const pushHalf = (crouching ? d.boxes.pushCrouch.w : d.boxes.pushStand.w) / 2;
  return hit.x + hit.w - pushHalf;
}

describe("reach parity across the roster", () => {
  it("has the full roster", () => {
    expect(FIGHTERS).toEqual(expect.arrayContaining(["brawler", "jiujitsu", "monk"]));
  });

  for (const attack of GROUND_ATTACKS) {
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
