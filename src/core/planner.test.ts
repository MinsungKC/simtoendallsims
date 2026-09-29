import { describe, expect, it } from "vitest";
import { planRoutes, topThree, type PlanTask } from "./planner";
import { defaultRobot } from "./robot";
import { worldInit } from "../games/types";
import { override } from "../games/override";
import type { Routine } from "./routine";

describe("route planner", () => {
  it("finds working routes for 'pick up a cup, then place it on a goal' and ranks them by time", async () => {
    const cfg = defaultRobot();
    const routine: Routine = { name: "p", gameId: "override", alliance: "red", start: { x: -64.5, y: 38, heading: 180 }, steps: [] };
    const cup = override.objects.find((o) => o.kind === "cup" && o.x < -69 && Math.abs(o.y - 27.4) < 0.1)!;
    const tasks: PlanTask[] = [
      { id: "1", label: "Cup", x: cup.x, y: cup.y, targetKind: "object", action: "pickup", side: "auto", approach: 0 + 180 },
      { id: "2", label: "Goal", x: -48, y: -24, targetKind: "goal", action: "place", side: "auto", approach: "auto" },
    ];
    const res = await planRoutes({ routine, tasks, cfg, game: override, world: worldInit(override, "red"), obstacles: override.obstacles });
    expect(res.length).toBeGreaterThan(5);
    const top = topThree(res);
    expect(top.length).toBeGreaterThan(0);
    for (let i = 1; i < top.length; i++) expect(top[i].duration + 0.5 * top[i].pushes).toBeGreaterThanOrEqual(top[i - 1].duration + 0.5 * top[i - 1].pushes - 1e-9);
    for (const t of top) { expect(t.problems).toEqual([]); expect(t.recording.events.some((e) => e.type === "place")).toBe(true); }
  }, 60000);
});
