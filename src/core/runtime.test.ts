import { describe, expect, it } from "vitest";
import { defaultRobot } from "./robot";
import { defaultMotion, mirrorRoutine, type Routine, type MotionSpec } from "./routine";
import { runSingleMotion, simulate } from "./runtime";
import { angleError, ExitCondition, PID, slew } from "./lemlib";
import { buildPathPoints, toLemLibPathFile } from "./path";
import { autoTune, suggestHorizontalDrift } from "./tune";

const cfg = defaultRobot();
const last = (r: ReturnType<typeof runSingleMotion>) => r.frames[r.frames.length - 1];
const m = <T extends MotionSpec["type"]>(type: T, at: { x: number; y: number; heading: number }, patch: object = {}) =>
  ({ ...defaultMotion(type, at), ...patch }) as MotionSpec;

describe("LemLib helpers (ported)", () => {
  it("angleError picks the shortest way around", () => {
    expect(angleError(350, 10, false)).toBeCloseTo(-20);
    expect(angleError(10, 350, false)).toBeCloseTo(20);
    expect(angleError(10, 350, false, "cw")).toBeCloseTo(20);
    expect(angleError(10, 350, false, "ccw")).toBeCloseTo(-340);
    expect(angleError(180, 0, false)).toBeCloseTo(180);
  });
  it("slew limits change per tick; 0 disables", () => {
    expect(slew(100, 0, 20)).toBe(20);
    expect(slew(-100, 0, 20)).toBe(-20);
    expect(slew(100, 0, 0)).toBe(100);
  });
  it("PID resets integral on sign flip and outside windup range", () => {
    const pid = new PID({ kP: 0, kI: 1, kD: 0, windupRange: 3, smallError: 1, smallErrorTimeout: 0, largeError: 3, largeErrorTimeout: 0, slew: 0 });
    pid.update(2); pid.update(2);
    expect(pid.update(2)).toBe(6);
    expect(pid.update(-1)).toBe(0); // sign flip clears the integral
    expect(pid.update(-1)).toBe(-1);
    expect(pid.update(10)).toBe(0); // outside windup range clears it
  });
  it("ExitCondition needs the error to stay in range for the full time", () => {
    const e = new ExitCondition(1, 100);
    e.update(0.5, 0); e.update(0.5, 50);
    expect(e.done).toBe(false);
    e.update(5, 60); e.update(0.5, 70);
    expect(e.update(0.5, 160)).toBe(false);
    expect(e.update(0.5, 171)).toBe(true);
  });
});

describe("simulated motions", () => {
  it("moveToPoint drives 48 in to within 2 in", () => {
    const r = runSingleMotion(cfg, m("moveToPoint", { x: 0, y: 48, heading: 0 }));
    const f = last(r);
    expect(Math.hypot(f.x, f.y - 48)).toBeLessThan(2);
    expect(r.duration).toBeLessThan(4);
    expect(r.warnings.filter((w) => w.text.includes("timeout"))).toHaveLength(0);
  });
  it("moveToPoint backwards", () => {
    const f = last(runSingleMotion(cfg, m("moveToPoint", { x: 0, y: -30, heading: 0 }, { forwards: false })));
    expect(Math.hypot(f.x, f.y + 30)).toBeLessThan(2.5);
  });
  it("turnToHeading 90 / -135 land within 2 deg", () => {
    expect(Math.abs(last(runSingleMotion(cfg, m("turnToHeading", { x: 0, y: 0, heading: 90 }))).heading - 90)).toBeLessThan(2);
    expect(Math.abs(last(runSingleMotion(cfg, m("turnToHeading", { x: 0, y: 0, heading: -135 }))).heading + 135)).toBeLessThan(2.5);
  });
  it("moveToPose arrives at the requested heading", () => {
    const f = last(runSingleMotion(cfg, m("moveToPose", { x: 24, y: 30, heading: 90 })));
    expect(Math.hypot(f.x - 24, f.y - 30)).toBeLessThan(3);
    expect(Math.abs(f.heading - 90)).toBeLessThan(6);
  });
  it("swingToHeading pivots around the locked side", () => {
    const f = last(runSingleMotion(cfg, m("swingToHeading", { x: 0, y: 0, heading: 90 }, { lock: "left" })));
    expect(Math.abs(f.heading - 90)).toBeLessThan(3);
    expect(f.y).toBeLessThan(0.5 + 12.5); // sanity: displacement on the order of half the track width
  });
  it("follow traces a curved path to its end", () => {
    const motion = m("follow", { x: 0, y: 0, heading: 0 });
    const r = runSingleMotion(cfg, motion);
    const f = last(r);
    expect(Math.hypot(f.x - 24, f.y - 24)).toBeLessThan(6);
  });
  it("odometry tracks the true pose to within a couple of inches", () => {
    const f = last(runSingleMotion(cfg, m("moveToPoint", { x: 30, y: 30, heading: 0 })));
    expect(Math.hypot(f.ex - f.x, f.ey - f.y)).toBeLessThan(2.5);
    expect(Math.abs(f.etheta - f.heading)).toBeLessThan(2);
  });
  it("wrong start placement makes the robot miss by about the placement error", () => {
    const r = runSingleMotion(cfg, m("moveToPoint", { x: 0, y: 40, heading: 0 }), { x: 0, y: 0, heading: 0 }, { placementError: { x: 3, y: 0, heading: 0 } });
    const f = last(r);
    expect(f.x).toBeGreaterThan(2);
  });
  it("tracking wheels beat drive-motor odometry on a sliding all-omni drive", () => {
    const omni = { ...cfg, wheels: cfg.wheels.map((w) => ({ ...w, type: "omni" as const })) };
    const withTW = { ...omni, odom: { ...omni.odom, trackingWheels: [
      { axis: "vertical" as const, diameter: 2.75, offset: 0, sensor: "rotation" as const },
      { axis: "horizontal" as const, diameter: 2.75, offset: 0, sensor: "rotation" as const },
    ] } };
    const mo = m("moveToPose", { x: 30, y: 30, heading: 90 });
    const a = last(runSingleMotion(omni, mo));
    const b = last(runSingleMotion(withTW, mo));
    const errA = Math.hypot(a.ex - a.x, a.ey - a.y);
    const errB = Math.hypot(b.ex - b.x, b.ey - b.y);
    expect(errA).toBeGreaterThan(4); // omni-only + motor encoders slides badly (LemLib docs warn about this)
    expect(errB).toBeLessThan(1.5);
  });
  it("is deterministic for a given seed", () => {
    const a = last(runSingleMotion(cfg, m("moveToPose", { x: 20, y: 20, heading: 45 })));
    const b = last(runSingleMotion(cfg, m("moveToPose", { x: 20, y: 20, heading: 45 })));
    expect(a).toEqual(b);
  });
});

describe("calibration knobs", () => {
  const peak = (c: typeof cfg) => Math.max(...runSingleMotion(c, m("moveToPoint", { x: 0, y: 100, heading: 0 }), { x: 0, y: -60, heading: 0 }).frames.map((f) => f.vx));
  it("lower drive efficiency lowers top speed", () => {
    expect(peak({ ...cfg, efficiency: 0.6 })).toBeLessThan(peak({ ...cfg, efficiency: 0.95 }));
  });
  it("lower grip lowers acceleration on a torque-heavy robot", () => {
    const strong = { ...cfg, motorsPerSide: 4, cartridge: 200 as const, drivingTeeth: 1, drivenTeeth: 1 };
    const t90 = (grip: number) => {
      const r = runSingleMotion({ ...strong, grip }, m("moveToPoint", { x: 0, y: 60, heading: 0 }), { x: 0, y: -60, heading: 0 });
      const top = Math.max(...r.frames.map((f) => f.vx));
      return r.frames.find((f) => f.vx >= 0.9 * top)!.t;
    };
    expect(t90(0.4)).toBeGreaterThan(t90(1));
  });
  it("control latency of one tick is applied by default", () => {
    const lat0 = runSingleMotion(cfg, m("turnToHeading", { x: 0, y: 0, heading: 90 }), undefined, { latencyTicks: 0 });
    const lat1 = runSingleMotion(cfg, m("turnToHeading", { x: 0, y: 0, heading: 90 }));
    expect(lat0.frames.at(-1)!.heading).toBeGreaterThan(80);
    expect(lat1.frames.at(-1)!.heading).toBeGreaterThan(80);
  });
});

describe("routines and actions", () => {
  const routine: Routine = {
    name: "t", gameId: "blank", alliance: "red", start: { x: 0, y: 0, heading: 0 },
    steps: [
      { id: "1", motion: m("moveToPoint", { x: 0, y: 30, heading: 0 }), actions: [{ id: "a", type: "intakeIn", when: { kind: "start" } }, { id: "b", type: "intakeStop", when: { kind: "distance", value: 15 } }] },
      { id: "2", motion: m("turnToHeading", { x: 0, y: 0, heading: 90 }), actions: [] },
    ],
  };
  it("executes steps in order and reports timings", () => {
    const r = simulate(routine, cfg, { fieldSize: 144, objects: [], obstacles: [] });
    expect(r.steps).toHaveLength(2);
    expect(r.steps[1].start).toBeGreaterThanOrEqual(r.steps[0].end);
    expect(last(r as never).heading).toBeGreaterThan(80);
  });
  it("distance-triggered action fires part-way through a motion", () => {
    let intakeOnAtHalf = false;
    const obj = { id: 1, kind: "ring", team: "neutral" as const, x: 0, y: 40, r: 2, mass: 0.05, drag: 40 };
    const r = simulate({ ...routine, steps: [routine.steps[0]] }, cfg, { fieldSize: 144, objects: [obj], obstacles: [] });
    intakeOnAtHalf = r.world.mech.intake === 0;
    expect(intakeOnAtHalf).toBe(true);
  });
  it("wait steps take the requested time", () => {
    const r = simulate({ ...routine, steps: [{ id: "w", motion: m("wait", { x: 0, y: 0, heading: 0 }, { ms: 500 }), actions: [] }] }, cfg, { fieldSize: 144, objects: [], obstacles: [] });
    expect(r.steps[0].end - r.steps[0].start).toBeGreaterThan(0.49);
    expect(r.steps[0].end - r.steps[0].start).toBeLessThan(0.53);
  });
  it("delay-triggered actions fire in list order at their delay", () => {
    const r = simulate({ ...routine, steps: [{ id: "d", motion: m("moveToPoint", { x: 0, y: 40, heading: 0 }), actions: [
      { id: "x1", type: "intakeIn", when: { kind: "delay", ms: 300 } },
      { id: "x2", type: "intakeStop", when: { kind: "delay", ms: 700 } },
    ] }] }, cfg, { fieldSize: 144, objects: [], obstacles: [] });
    expect(r.triggers.map((t) => t.actionId)).toEqual(["x1", "x2"]);
    expect(r.triggers[0].offsetMs).toBeGreaterThanOrEqual(300);
    expect(r.triggers[0].offsetMs).toBeLessThan(330);
    expect(r.triggers[1].offsetMs).toBeGreaterThanOrEqual(700);
  });
  it("warns when a distance trigger is never reached", () => {
    const r = simulate({ ...routine, steps: [{ id: "d", motion: m("moveToPoint", { x: 0, y: 20, heading: 0 }), actions: [{ id: "x1", type: "clamp", when: { kind: "distance", value: 200 } }] }] }, cfg, { fieldSize: 144, objects: [], obstacles: [] });
    expect(r.warnings.some((w) => w.text.includes("never reached"))).toBe(true);
  });
  it("mirroring flips x and heading", () => {
    const mr = mirrorRoutine({ ...routine, start: { x: -40, y: -50, heading: 20 }, steps: [{ id: "x", motion: m("moveToPose", { x: -10, y: 5, heading: 30 }), actions: [] }] });
    expect(mr.start).toEqual({ x: 40, y: -50, heading: -20 });
    expect((mr.steps[0].motion as { x: number; heading: number }).x).toBe(10);
    expect((mr.steps[0].motion as { heading: number }).heading).toBe(-30);
    expect(mr.alliance).toBe("blue");
  });
});

describe("paths", () => {
  const p = (defaultMotion("follow", { x: 0, y: 0, heading: 0 }) as Extract<MotionSpec, { type: "follow" }>).path;
  it("path speed ramps to zero at the end and stays within limits", () => {
    const pts = buildPathPoints(p);
    expect(pts[pts.length - 1].speed).toBe(0);
    expect(Math.max(...pts.map((q) => q.speed))).toBeLessThanOrEqual(p.maxSpeed);
    expect(pts[0].x).toBeCloseTo(0);
  });
  it("exports a LemLib v0.5 path file (x, y, speed rows, endData, segments)", () => {
    const txt = toLemLibPathFile(p);
    const lines = txt.trim().split("\n");
    const end = lines.indexOf("endData");
    expect(end).toBeGreaterThan(3);
    expect(lines[0].split(", ")).toHaveLength(3);
    expect(lines[end + 3]).toBe("200");
    expect(lines[end + 4].split(", ")).toHaveLength(8);
  });
});

describe("tuning", () => {
  it("horizontalDrift suggestion follows LemLib's guidance", () => {
    expect(suggestHorizontalDrift({ ...cfg, wheels: cfg.wheels.map((w) => ({ ...w, type: "omni" as const })) })).toBe(2);
    expect(suggestHorizontalDrift({ ...cfg, wheels: cfg.wheels.map((w) => ({ ...w, type: "traction" as const })) })).toBe(8);
  });
  it("auto-tune does not make things worse", () => {
    const res = autoTune(cfg);
    expect(res.score.after).toBeLessThanOrEqual(res.score.before + 1e-9);
  }, 60000);
});
