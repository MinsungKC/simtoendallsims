import { describe, expect, it } from "vitest";
import { routeFromStroke, avoidObstacles } from "./autoroute";
import { closestOnPoly } from "./geometry";
import { obstaclePoly, type Obstacle } from "./world";

const goal: Obstacle = { x: 0, y: 0, w: 5.6, h: 5.6, label: "g" };
const base = { obstacles: [goal], fieldSize: 144, clearance: 8.5, reverse: false, from: { x: -40, y: 0 } };
const line = Array.from({ length: 81 }, (_, i) => ({ x: -40 + i, y: 0.01 * i }));

describe("pen routes", () => {
  it("bends a stroke that runs through a Goal around it, keeping the robot's clearance", () => {
    const safe = avoidObstacles(line, base);
    for (const p of safe) { const c = closestOnPoly(obstaclePoly(goal), p.x, p.y); expect(c.inside).toBe(false); expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeGreaterThan(8.5 - 0.6); }
    expect(safe[0]).toEqual(line[0]); // the start point is not moved
  });
  it("turns a stroke into a few waypoints whose headings follow the drawn line; reverse leads with the back", () => {
    const wp = routeFromStroke(line, { ...base, obstacles: [] });
    expect(wp.length).toBeGreaterThanOrEqual(2);
    expect(wp.length).toBeLessThan(6);
    for (const m of wp) { expect(m.type).toBe("moveToPose"); if (m.type === "moveToPose") { expect(m.heading).toBeGreaterThan(80); expect(m.heading).toBeLessThan(100); expect(m.forwards).toBe(true); } }
    const last = wp.at(-1)!;
    expect(last.type === "moveToPose" && last.x).toBeCloseTo(40, 0);
    if (wp[0].type === "moveToPose") expect(wp[0].minSpeed).toBeGreaterThan(0); // chains without stopping
    if (last.type === "moveToPose") expect(last.minSpeed).toBe(0);
    const back = routeFromStroke(line, { ...base, obstacles: [], reverse: true });
    const b = back[0];
    if (b.type === "moveToPose") { expect(b.forwards).toBe(false); expect(Math.abs(b.heading)).toBeGreaterThan(260 - 360 + 170 - 90); expect(b.heading).toBeLessThan(-80); }
  });
});
