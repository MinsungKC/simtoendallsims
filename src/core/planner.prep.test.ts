import { describe, expect, it } from "vitest";
import { planRoutes, prepareTasks, topThree, type PlanTask } from "./planner";
import { defaultRobot } from "./robot";
import { worldInit } from "../games/types";
import { override } from "../games/override";

const cfg = defaultRobot();
const routine = { name: "p", gameId: "override", alliance: "red" as const, start: { x: -64.5, y: 38, heading: 180 }, steps: [] };
const world = worldInit(override, "red");
const goal = (id: string, x: number, y: number): PlanTask => ({ id, label: `Goal ${id}`, x, y, targetKind: "goal", action: "place", side: "auto", approach: "auto", refId: id });
const pickup = (o: (typeof override.objects)[number], label: string): PlanTask => ({ id: `p${o.id}`, label, x: o.x, y: o.y, targetKind: "object", action: "pickup", side: "auto", approach: "auto", refId: o.id, pieceKind: o.kind });
const args = { game: override, world, cfg, routine };

describe("task preparation knows what the robot is holding (it starts with the Preload)", () => {
  const yellowPin = override.objects.find((o) => o.kind === "pin" && o.x === -24 && o.y === -24 && o.nestedIn !== undefined)!;
  const yellowCup = override.objects.find((o) => o.kind === "cup" && o.x === -24 && o.y === -24)!;
  it("a Pin pickup while holding the Preload gets an automatic 'score the Preload first' stop", () => {
    const loose = override.objects.find((o) => o.kind === "pin" && o.lying)!;
    const r = prepareTasks({ ...args, tasks: [pickup(loose, "Pin")] });
    expect(r.errors).toEqual([]);
    expect(r.tasks).toHaveLength(2);
    expect(r.tasks[0].action).toBe("place");
    expect(r.notes.join(" ")).toContain("start with");
  });
  it("scoring the Preload on a neutral Goal that already holds a Pin is explained, not silently 'no route'", () => {
    const r = prepareTasks({ ...args, tasks: [goal("short-W", -48, 24)] });
    expect(r.errors.join(" ")).toContain("short-W");
    expect(r.errors.join(" ")).toContain("Cup");
  });
  it("Preload on the empty red Goal is fine; a Cup then a Pin-holding Goal is fine too", () => {
    expect(prepareTasks({ ...args, tasks: [goal("red-W", -48, -24)] }).errors).toEqual([]);
    const cup = override.objects.find((o) => o.kind === "cup" && o.x < -69 && Math.abs(o.y - 27.4) < 0.1)!;
    const r = prepareTasks({ ...args, tasks: [goal("red-W", -48, -24), pickup(cup, "Cup"), goal("short-W", -48, 24)] });
    expect(r.errors).toEqual([]);
  });
  it("opposing Goals and empty hands are reported", () => {
    expect(prepareTasks({ ...args, tasks: [goal("blue-N", 24, 48)] }).errors.join(" ")).toContain("opposing");
    expect(prepareTasks({ ...args, tasks: [goal("red-W", -48, -24), goal("red-S", -24, -48)] }).errors.join(" ")).toContain("isn't holding");
    void yellowPin; void yellowCup;
  });
});

describe("planning end to end", () => {
  it("a Pin pickup + score plan finds working routes (Preload is placed automatically first)", async () => {
    const loose = override.objects.find((o) => o.kind === "pin" && o.nestedIn !== undefined && o.x === -24 && o.y === -24)!;
    const cup = override.objects.find((o) => o.kind === "cup" && o.x === -24 && o.y === -24)!;
    void loose;
    const prep = prepareTasks({ ...args, tasks: [pickup(cup, "Cup + Pin"), goal("short-W", -48, 24)] });
    expect(prep.errors).toEqual([]);
    const res = await planRoutes({ routine, tasks: prep.tasks, cfg, game: override, world, obstacles: override.obstacles });
    const top = topThree(res);
    // print why candidates fail if none work
    expect(top.length, JSON.stringify(res.slice(0, 4).map((r) => r.problems))).toBeGreaterThan(0);
  }, 120000);
});
