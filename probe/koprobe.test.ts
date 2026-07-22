import { it } from "vitest";
import { World } from "../src/sim/world";
import { FIGHTER_A, FIGHTER_B } from "../src/sim/config";
import { emptyInput, type InputSnapshot } from "../src/sim/types";
import { DT } from "../src/sim/constants";
import { CpuController, DAMAGE_SCALE, type Difficulty } from "../src/sim/cpu";
const NONE: [InputSnapshot, InputSnapshot] = [emptyInput(), emptyInput()];
it("probe", () => {
  for (const d of ["easy", "normal", "hard"] as Difficulty[]) {
    const w = new World(FIGHTER_A, FIGHTER_B);
    w.match.phase = "fight"; w.match.introTicks = 0;
    w.fighters[0].reset(848 - 130, 1); w.fighters[1].reset(848 + 130, -1);
    w.fighters[1].damageScale = DAMAGE_SCALE[d];
    const cpu = new CpuController(1, d, 7);
    let t = 0;
    while (!w.fighters[0].isKO && t < 20000) { w.advance(DT, NONE, cpu); t++; }
    console.log(`PROBE ${d} ticks=${t} sec=${(t / 60).toFixed(1)}`);
  }
});
