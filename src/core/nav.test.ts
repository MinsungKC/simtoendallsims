import { describe, expect, it } from "vitest";
import { findPath } from "./nav";
import { closestOnPoly } from "./geometry";
import { obstaclePoly, type Obstacle } from "./world";

const goal: Obstacle = { x: 0, y: 0, w: 5.6, h: 5.6, label: "g" };
const o = { obstacles: [goal], fieldSize: 144, radius: 11, wall: 7.5 };

describe("grid navigation", () => {
  it("goes around a Goal that sits on the straight line, with every leg clear of it", () => {
    const p = findPath({ x: -40, y: 0 }, { x: 40, y: 0 }, o)!;
    expect(p.length).toBeGreaterThan(2);
    for (let k = 1; k < p.length; k++) for (let s = 0; s <= 20; s++) {
      const q = { x: p[k - 1].x + ((p[k].x - p[k - 1].x) * s) / 20, y: p[k - 1].y + ((p[k].y - p[k - 1].y) * s) / 20 };
      const c = closestOnPoly(obstaclePoly(goal), q.x, q.y);
      expect(c.inside ? 0 : Math.hypot(q.x - c.x, q.y - c.y)).toBeGreaterThan(10);
    }
    expect(p[0]).toEqual({ x: -40, y: 0 }); expect(p.at(-1)).toEqual({ x: 40, y: 0 });
  });
  it("is a straight line when nothing is in the way, and returns null when walled off", () => {
    expect(findPath({ x: -40, y: 30 }, { x: 40, y: 30 }, o)).toHaveLength(2);
    const wall: Obstacle[] = [{ x: 0, y: 0, w: 4, h: 200, label: "w" }];
    expect(findPath({ x: -40, y: 0 }, { x: 40, y: 0 }, { ...o, obstacles: wall })).toBeNull();
  });
});
