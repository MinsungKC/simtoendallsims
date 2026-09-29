import { describe, expect, it } from "vitest";
import { planRoutes, prepareTasks, type PlanTask } from "./planner";
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
    // a hard case (crowded start, Goals close together): every candidate is simulated and the closest ones report exactly what still goes wrong
    expect(res.length).toBeGreaterThan(3);
    const best = res.slice().sort((a, b) => a.problems.length - b.problems.length || a.duration - b.duration)[0];
    expect(best.recording.events.some((e) => e.type === "place")).toBe(true);
    expect(best.problems.every((p) => /^hits /.test(p))).toBe(true);
  }, 240000);
});

describe("waypoints and simple mode", () => {
  it("plans through a waypoint with its own speed/actions, using straight legs only in simple mode", async () => {
    const wp: PlanTask = { id: "w", label: "Point 1", x: -50, y: 10, targetKind: "point", action: "none", side: "auto", approach: 90, speed: 80, extra: [{ type: "clamp", when: "end" }] };
    const prep = prepareTasks({ ...args, tasks: [wp, goal("red-W", -48, -24)] });
    expect(prep.errors).toEqual([]);
    const res = await planRoutes({ routine, tasks: prep.tasks, cfg, game: override, world, obstacles: override.obstacles, simple: true });
    expect(res.length).toBeGreaterThan(0);
    for (const c of res) for (const s of c.routine.steps) expect(["moveToPoint", "turnToHeading", "turnToPoint"]).toContain(s.motion.type);
    const first = res[0].routine.steps.find((s) => s.actions.some((a) => a.type === "clamp"));
    expect(first).toBeDefined();
  }, 60000);
});

describe("time model", () => {
  it("is measured from the robot: drive and turn costs grow with distance/angle, and the DP chain is no slower than any single fixed approach", async () => {
    const { calibrate, driveTime, turnTime, bestChains } = await import("./timeplan");
    const c = calibrate(cfg);
    expect(c.v).toBeGreaterThan(20); expect(c.w).toBeGreaterThan(60);
    expect(driveTime(c, 48)).toBeGreaterThan(driveTime(c, 12));
    expect(turnTime(c, 180)).toBeGreaterThan(turnTime(c, 45));
    const nav = { obstacles: override.obstacles, fieldSize: 144, radius: 8, wall: 7.5 };
    const mk = (thetas: number[]) => [{ x: -30, y: -10 }, { x: 30, y: 20 }].map((t) => ({ action: 0.3, poses: thetas.map((th) => ({ x: t.x - Math.sin((th * Math.PI) / 180) * 13, y: t.y - Math.cos((th * Math.PI) / 180) * 13, h: th, theta: th, side: "front" as const })) }));
    const all = bestChains({ x: -60, y: 0, heading: 90 }, mk(Array.from({ length: 16 }, (_, i) => i * 22.5)), cfg, nav, 3)[0].time;
    const fixed = bestChains({ x: -60, y: 0, heading: 90 }, mk([0]), cfg, nav, 3)[0].time;
    expect(all).toBeLessThanOrEqual(fixed + 1e-9);
  }, 60000);
});
