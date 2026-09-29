import { describe, expect, it } from "vitest";
import { toFrame, frameNote } from "./frame";
import { defaultRobot } from "./robot";
import { defaultMotion, rotateRoutine, type MotionSpec, type Routine } from "./routine";
import { simulate } from "./runtime";
import { normalize } from "./common-plan";

const cfg = defaultRobot();
cfg.odom.trackingWheels = [];
const big = { fieldSize: 2000, objects: [], obstacles: [] };

function routine(): Routine {
  const at = (x: number, y: number, heading = 0) => ({ x, y, heading });
  const mv = (type: MotionSpec["type"], p: { x: number; y: number; heading: number }, patch: object = {}) => ({ ...defaultMotion(type, p), ...patch }) as MotionSpec;
  return {
    name: "frame", gameId: "blank", alliance: "red",
    start: at(-40, 30, 90),
    steps: [
      { id: "a", motion: mv("moveToPoint", at(-10, 30), { timeout: 4000 }), actions: [] },
      { id: "b", motion: mv("turnToHeading", at(0, 0, 200), { timeout: 3000 }), actions: [] },
      { id: "c", motion: mv("moveToPose", at(0, 0, 180), { timeout: 5000 }), actions: [] },
      { id: "d", motion: mv("follow", at(0, 0, 180), { timeout: 5000 }), actions: [] },
    ],
  };
}

describe("code frames", () => {
  it("'start' puts the robot at (0, 0) and keeps its heading; axes stay parallel to the field", () => {
    const r = toFrame(routine(), "start");
    expect(r.start).toEqual({ x: 0, y: 0, heading: 90 });
    const m = r.steps[0].motion;
    expect(m.type === "moveToPoint" && [m.x, m.y]).toEqual([30, 0]); // 30" east of the start, same row
    const t = r.steps[1].motion;
    expect(t.type === "turnToHeading" && t.heading).toBe(200);
  });
  it("'start-rotated' also makes the start heading 0, so forward at the start is +y", () => {
    const r = toFrame(routine(), "start-rotated");
    expect(r.start.x).toBeCloseTo(0); expect(r.start.y).toBeCloseTo(0); expect(r.start.heading).toBe(0);
    const m = r.steps[0].motion;
    // start faces +x (heading 90); the first target is 30" straight ahead
    expect(m.type === "moveToPoint" && m.x).toBeCloseTo(0);
    expect(m.type === "moveToPoint" && m.y).toBeCloseTo(30);
    const t = r.steps[1].motion;
    expect(t.type === "turnToHeading" && t.heading).toBe(110);
  });
  it("'field' leaves the routine alone", () => {
    const r = routine();
    expect(toFrame(r, "field")).toBe(r);
  });
  it.each(["start", "start-rotated"] as const)("the robot ends up in the same place (%s frame): simulate both and compare", (frame) => {
    const r = routine();
    const rel = toFrame(r, frame);
    const a = simulate(r, cfg, big).frames.at(-1)!;
    const b = simulate(rel, cfg, big).frames.at(-1)!;
    // map the field-frame result into the relative frame and compare
    const dx = a.x - r.start.x, dy = a.y - r.start.y;
    const h0 = (r.start.heading * Math.PI) / 180;
    const ex = frame === "start" ? dx : dx * Math.cos(h0) - dy * Math.sin(h0);
    const ey = frame === "start" ? dy : dx * Math.sin(h0) + dy * Math.cos(h0);
    const eh = frame === "start" ? a.heading : a.heading - r.start.heading;
    expect(b.x).toBeCloseTo(ex, 0);
    expect(b.y).toBeCloseTo(ey, 0);
    expect(Math.abs(normalize(b.heading - eh))).toBeLessThan(0.5);
  });
  it("describes where to put the robot", () => {
    expect(frameNote(routine(), "start")).toContain("(0, 0) facing 90.0°");
    expect(frameNote(routine(), "field")).toContain("(-40.0, 30.0)");
  });
});

describe("rotating a routine to the other Alliance (Override's symmetry is a 180 degree turn)", () => {
  it("negates positions, adds 180 to headings, and is its own inverse", () => {
    const r = routine();
    const t = rotateRoutine(r);
    expect(t.alliance).toBe("blue");
    expect(t.start).toEqual({ x: 40, y: -30, heading: -90 });
    const m = t.steps[0].motion;
    expect(m.type === "moveToPoint" && [m.x, m.y]).toEqual([10, -30]);
    const back = rotateRoutine(t);
    expect(back.start).toEqual(r.start);
    back.steps.forEach((st, k) => {
      const a = st.motion, b = r.steps[k].motion;
      if ("x" in a && "x" in b) expect([a.x, a.y]).toEqual([b.x, b.y]);
      if ("heading" in a && "heading" in b) expect(Math.abs(normalize(a.heading - b.heading))).toBeLessThan(1e-9);
    });
  });
});
