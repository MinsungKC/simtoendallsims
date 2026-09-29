import { describe, expect, it } from "vitest";
import { repairRoutine, DEFAULT_AVOID } from "./repair";
import { toStraightLines } from "./simple";
import { defaultRobot } from "./robot";
import { defaultMotion, type Routine } from "./routine";
import { samplePath } from "./path";
import { closestOnPoly } from "./geometry";
import { obstaclePoly, type Obstacle } from "./world";

const cfg = defaultRobot();
const goal: Obstacle = { x: 0, y: 0, w: 5.6, h: 5.6, label: "g", tag: "goal:g" };
const route = (steps: Routine["steps"]): Routine => ({ name: "r", gameId: "override", alliance: "red", start: { x: -40, y: 0, heading: 90 }, steps });

describe("fix path", () => {
  it("bends a straight leg through a Goal around it and leaves the target alone", () => {
    const r = route([{ id: "a", motion: { ...defaultMotion("moveToPoint", { x: 40, y: 0, heading: 0 }) }, actions: [] }]);
    const { routine, changed } = repairRoutine(r, cfg, [goal], DEFAULT_AVOID, 144);
    expect(changed).toBe(1);
    expect(routine.steps.length).toBeGreaterThan(1);
    const last = routine.steps.at(-1)!.motion;
    expect(last.type === "moveToPoint" && [last.x, last.y]).toEqual([40, 0]);
    for (const s of routine.steps.slice(0, -1)) if (s.motion.type === "moveToPoint") { const c = closestOnPoly(obstaclePoly(goal), s.motion.x, s.motion.y); expect(Math.hypot(s.motion.x - c.x, s.motion.y - c.y)).toBeGreaterThan(7); }
  });
  it("pushes a curve that crosses a Goal away and keeps its ends", () => {
    const m = defaultMotion("follow", { x: -40, y: 0, heading: 90 });
    if (m.type !== "follow") throw new Error();
    m.path.segments = [{ p: [{ x: -40, y: 0 }, { x: -13, y: 0 }, { x: 13, y: 0 }, { x: 40, y: 0 }] }];
    const { routine, changed } = repairRoutine(route([{ id: "f", motion: m, actions: [] }]), cfg, [goal], DEFAULT_AVOID, 144);
    expect(changed).toBe(1);
    const fm = routine.steps[0].motion;
    if (fm.type !== "follow") throw new Error();
    for (const p of samplePath(fm.path)) { const c = closestOnPoly(obstaclePoly(goal), p.x, p.y); expect(c.inside).toBe(false); }
    expect(fm.path.segments[0].p[0]).toEqual({ x: -40, y: 0 });
    expect(fm.path.segments.at(-1)!.p[3]).toEqual({ x: 40, y: 0 });
  });
  it("does nothing when the box to avoid is unticked", () => {
    const r = route([{ id: "a", motion: defaultMotion("moveToPoint", { x: 40, y: 0, heading: 0 }), actions: [] }]);
    expect(repairRoutine(r, cfg, [], DEFAULT_AVOID, 144).changed).toBe(0);
  });
});

describe("simple mode", () => {
  it("turns curves and poses into straight legs and turns", () => {
    const f = defaultMotion("follow", { x: -40, y: 0, heading: 90 });
    const p = defaultMotion("moveToPose", { x: 20, y: 30, heading: 180 });
    const out = toStraightLines(route([{ id: "f", motion: f, actions: [] }, { id: "p", motion: p, actions: [{ id: "a", type: "place", when: { kind: "end" } }] }]), cfg);
    expect(out.steps.every((s) => ["moveToPoint", "turnToHeading"].includes(s.motion.type))).toBe(true);
    expect(out.steps.at(-1)!.motion.type).toBe("turnToHeading");
    expect(out.steps.at(-1)!.actions).toHaveLength(1);
  });
});
