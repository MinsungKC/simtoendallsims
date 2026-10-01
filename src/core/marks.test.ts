import { describe, expect, it } from "vitest";
import { addMark, addMarkAction, moveMark, removeMark } from "./marks";
import { buildPathPoints, distanceAlongPath, pointAtDistance } from "./path";
import type { PathSpec } from "./routine";

const path: PathSpec = { segments: [{ p: [{ x: 0, y: 0 }, { x: 0, y: 20 }, { x: 0, y: 40 }, { x: 0, y: 60 }] }], maxSpeed: 127, minSpeed: 20, decel: 4000, spacing: 1, marks: [] };

describe("points on a curve", () => {
  it("locates a distance on the curve and back", () => {
    const q = pointAtDistance(path, 30);
    expect(q.y).toBeCloseTo(30, 0);
    expect(distanceAlongPath(path, 3, 30).d).toBeCloseTo(30, 0);
  });
  it("a speed cap at a point brakes the robot into it", () => {
    const fast = buildPathPoints(path);
    const capped = buildPathPoints({ ...path, marks: [{ id: "m", d: 30, speed: 40 }] });
    const at = (pts: typeof fast, y: number) => pts.reduce((b, p) => (Math.abs(p.y - y) < Math.abs(b.y - y) ? p : b));
    expect(at(capped, 30).speed).toBeLessThanOrEqual(40);
    expect(at(capped, 28).speed).toBeLessThan(at(fast, 28).speed);
  });
  it("actions follow their point and go with it when it is removed", () => {
    let s = addMark({ marks: [], actions: [] }, 20);
    const id = s.id;
    let st = addMarkAction(s, id, "intakeIn");
    expect(st.actions[0].when).toEqual({ kind: "distance", value: 20 });
    st = moveMark(st, id, 35);
    expect(st.actions[0].when).toEqual({ kind: "distance", value: 35 });
    st = removeMark(st, id);
    expect(st.marks).toEqual([]);
    expect(st.actions).toEqual([]);
  });
});
