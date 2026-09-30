import { describe, expect, it } from "vitest";
import { fixRoute } from "./fixroute";
import { DEFAULT_AVOID } from "./repair";
import { defaultRobot } from "./robot";
import { defaultMotion, type Routine } from "./routine";
import { simulate } from "./runtime";
import { worldInit } from "../games/types";
import { override } from "../games/override";

const cfg = defaultRobot();
describe("fix route reaches targets", () => {
  it("every step ends within tolerance of its aimed point", async () => {
    const g = override;
    const init = worldInit(g, "red");
    const r: Routine = { name: "r", gameId: "override", alliance: "red", start: { x: -48, y: -48, heading: 0 }, steps: [
      { id: "a", motion: { ...defaultMotion("moveToPoint", { x: -48, y: -10, heading: 0 }) }, actions: [] },
      { id: "b", motion: { ...defaultMotion("moveToPoint", { x: -20, y: 0, heading: 0 }) }, actions: [] },
    ] };
    const res = await fixRoute({ routine: r, cfg, avoid: DEFAULT_AVOID, fieldSize: init.fieldSize, sim: (x) => simulate(x, cfg, init, { seed: 1 }), obstacles: init.obstacles, pieces: init.objects as never });
    expect(res.reports.length).toBe(2);
    for (const rep of res.reports) expect(rep.posError).toBeLessThan(5);
  }, 60000);
});
