import { describe, expect, it } from "vitest";
import { motorBudget, motorSpec } from "./motors";
import { defaultRobot, derive, type RobotConfig } from "./robot";
import { initialState, step } from "./physics";
import { createWorld, stepWorld, ejectHeld, setClamp } from "./world";

const direct = (): RobotConfig => ({ ...defaultRobot(), cartridge: 200, drivingTeeth: 1, drivenTeeth: 1 });

function drive(cfg: RobotConfig, l: number, r: number, secs: number, field = 10000) {
  const d = derive(cfg);
  const w = createWorld({ fieldSize: field, objects: [], obstacles: [] }, { x: 0, y: 0, heading: 0 });
  for (let i = 0; i < secs * 200; i++) stepWorld(w, cfg, l, r, 0.005, d);
  return w;
}

describe("motors", () => {
  it("11W motor peak power is 11 W for every cartridge", () => {
    for (const c of [100, 200, 600] as const) {
      const m = motorSpec(11, c);
      expect((m.stallTorque * m.freeSpeed) / 4).toBeCloseTo(11, 0);
    }
  });
  it("4x11W drive is legal under a 55W subsystem cap, 8x11W is not", () => {
    const rules = { totalCapW: 88, drivetrainCapW: 55 };
    expect(motorBudget({ count: 4, watts: 11 }, 33, rules).legal).toBe(true);
    const b = motorBudget({ count: 8, watts: 11 }, 0, rules);
    expect(b.legal).toBe(false);
    expect(b.problems).toHaveLength(1);
  });
  it("flags total-cap overflow", () => {
    expect(motorBudget({ count: 6, watts: 11 }, 33, { totalCapW: 88, drivetrainCapW: null }).legal).toBe(false);
  });
});

describe("derived values", () => {
  it("600rpm cart, 36:48, 3.25in wheels free speed matches hand calc", () => {
    const cfg = defaultRobot();
    const expected = (600 * (36 / 48) * Math.PI * 3.25) / 60;
    expect(derive(cfg).freeSpeed).toBeCloseTo(expected, 3);
    expect(derive(cfg).wheelRpm).toBeCloseTo(450, 6);
  });
});

describe("drive physics", () => {
  const cfg = direct();
  const free = derive(cfg).freeSpeed;

  it("reaches 85-100% of free speed at full power (real robots run a bit under free speed)", () => {
    const w = drive(cfg, 1, 1, 3);
    expect(w.robot.vx).toBeLessThan(free);
    expect(w.robot.vx).toBeGreaterThan(free * 0.85);
    expect(Math.abs(w.robot.x)).toBeLessThan(1e-3);
  });

  it("accelerates to 90% of top speed in a plausible 0.1-1.5 s", () => {
    const d = derive(cfg);
    const w = createWorld({ fieldSize: 10000, objects: [], obstacles: [] }, { x: 0, y: 0, heading: 0 });
    let top = drive(cfg, 1, 1, 4).robot.vx;
    let t90 = -1;
    for (let i = 0; i < 800; i++) {
      stepWorld(w, cfg, 1, 1, 0.005, d);
      if (t90 < 0 && w.robot.vx >= 0.9 * top) t90 = w.t;
    }
    expect(t90).toBeGreaterThan(0.1);
    expect(t90).toBeLessThan(1.5);
  });

  it("is deterministic", () => {
    expect(drive(cfg, 0.7, 0.4, 2).robot).toEqual(drive(cfg, 0.7, 0.4, 2).robot);
  });

  it("turns clockwise when left is faster", () => {
    expect(drive(cfg, 1, -1, 0.5).robot.heading).toBeGreaterThan(20);
  });

  it("center traction wheels resist in-place turning more than all-omni (scrub)", () => {
    const traction = { ...cfg, wheels: cfg.wheels.map((w) => ({ ...w, type: "traction" as const })) };
    const omni = { ...cfg, wheels: cfg.wheels.map((w) => ({ ...w, type: "omni" as const })) };
    expect(drive(traction, 1, -1, 1).robot.w).toBeLessThan(drive(omni, 1, -1, 1).robot.w);
  });

  it("all-omni drive slides sideways in an arc more than a traction drive", () => {
    const traction = { ...cfg, wheels: cfg.wheels.map((w) => ({ ...w, type: "traction" as const })) };
    const omni = { ...cfg, wheels: cfg.wheels.map((w) => ({ ...w, type: "omni" as const })) };
    const arcOmni = drive(omni, 1, 0.5, 1);
    const arcTrac = drive(traction, 1, 0.5, 1);
    expect(Math.abs(arcOmni.robot.vy)).toBeGreaterThan(Math.abs(arcTrac.robot.vy));
  });

  it("wheels slip when torque exceeds traction, and encoders over-read ground travel", () => {
    const heavyOmni = {
      ...cfg,
      motorsPerSide: 4,
      cartridge: 100 as const,
      mass: 3,
      wheels: cfg.wheels.map((w) => ({ ...w, type: "omni" as const })),
    };
    const d = derive(heavyOmni);
    const w = createWorld({ fieldSize: 10000, objects: [], obstacles: [] }, { x: 0, y: 0, heading: 0 });
    let slipped = false;
    for (let i = 0; i < 200; i++) {
      stepWorld(w, heavyOmni, 1, 1, 0.005, d);
      if (w.robot.slipL) slipped = true;
    }
    expect(slipped).toBe(true);
    expect(w.robot.travelL).toBeGreaterThan(w.robot.y);
  });

  it("stops at the wall without penetrating and loses most of its speed", () => {
    const w = drive(cfg, 1, 1, 6, 144);
    expect(w.robot.y + cfg.length / 2).toBeLessThanOrEqual(72 + 0.5);
    expect(w.robot.vx).toBeLessThan(5);
    expect(w.contacts).toBeGreaterThan(0);
  });

  it("coasts to rest with zero command and brake mode stops faster than coast", () => {
    const stopTime = (brake: "coast" | "brake") => {
      const c = { ...cfg, brake };
      const d = derive(c);
      let s = { ...initialState(), vx: 30 };
      let t = 0;
      while (Math.abs(s.vx) > 1 && t < 10) { s = step(s, c, 0, 0, 0.005, undefined, d); t += 0.005; }
      return t;
    };
    expect(stopTime("brake")).toBeLessThan(stopTime("coast"));
  });
});

describe("objects", () => {
  const obj = (x: number, y: number) => ({ id: 1, kind: "block", team: "neutral" as const, x, y, r: 2, mass: 0.1, drag: 40 });
  it("pushes a free object across the field", () => {
    const cfg = direct();
    const w = createWorld({ fieldSize: 144, objects: [obj(0, 20)], obstacles: [] }, { x: 0, y: 0, heading: 0 });
    const d = derive(cfg);
    for (let i = 0; i < 400; i++) stepWorld(w, cfg, 1, 1, 0.005, d);
    expect(w.objects[0].y).toBeGreaterThan(20);
  });
  it("intake captures an object in front and eject releases it", () => {
    const cfg = direct();
    const w = createWorld({ fieldSize: 144, objects: [obj(0, 10)], obstacles: [] }, { x: 0, y: 0, heading: 0 });
    w.mech.intake = 1;
    stepWorld(w, cfg, 0, 0, 0.005);
    expect(w.held).toEqual([1]);
    ejectHeld(w, cfg);
    expect(w.objects[0].state).toBe("field");
    expect(w.held).toHaveLength(0);
  });
  it("clamp carries a mobile goal with the robot", () => {
    const cfg = direct();
    const goal = { ...obj(0, 12), r: 6, mass: 1.5, carriable: true };
    const w = createWorld({ fieldSize: 144, objects: [goal], obstacles: [] }, { x: 0, y: 0, heading: 0 });
    const d = derive(cfg);
    setClamp(w, cfg, true);
    expect(w.objects[0].state).toBe("carried");
    for (let i = 0; i < 200; i++) stepWorld(w, cfg, 0.6, 0.6, 0.005, d);
    expect(w.objects[0].y).toBeGreaterThan(20);
  });
  it("obstacles block the robot", () => {
    const cfg = direct();
    const w = createWorld({ fieldSize: 144, objects: [], obstacles: [{ x: 0, y: 30, w: 20, h: 4, label: "wall" }] }, { x: 0, y: 0, heading: 0 });
    const d = derive(cfg);
    for (let i = 0; i < 800; i++) stepWorld(w, cfg, 1, 1, 0.005, d);
    expect(w.robot.y + cfg.length / 2).toBeLessThan(30 - 2 + 0.6);
  });
});
