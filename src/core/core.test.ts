import { describe, expect, it } from "vitest";
import { motorBudget, motorSpec } from "./motors";
import { defaultRobot, derive } from "./robot";
import { defaultEnv, initialState, step } from "./physics";

function run(cfg = defaultRobot(), l: number, r: number, secs: number, env = defaultEnv) {
  const d = derive(cfg);
  let s = initialState();
  for (let i = 0; i < secs * 200; i++) s = step(s, cfg, l, r, 0.005, env, d);
  return s;
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
    const expected = ((600 * (36 / 48)) * Math.PI * 3.25) / 60; // in/s
    expect(derive(cfg).freeSpeed).toBeCloseTo(expected, 3);
  });
});

describe("drive physics", () => {
  const cfg = { ...defaultRobot(), cartridge: 200 as const, drivingTeeth: 1, drivenTeeth: 1 };
  const free = derive(cfg).freeSpeed;
  it("reaches close to (but below) free speed at full power", () => {
    const s = run(cfg, 1, 1, 3, { ...defaultEnv, fieldSize: 10000 });
    expect(s.v).toBeLessThan(free);
    expect(s.v).toBeGreaterThan(free * 0.85);
    expect(s.y).toBeGreaterThan(0);
    expect(Math.abs(s.x)).toBeLessThan(1e-6);
  });
  it("is deterministic", () => {
    expect(run(cfg, 0.7, 0.4, 2)).toEqual(run(cfg, 0.7, 0.4, 2));
  });
  it("turns clockwise when left is faster", () => {
    expect(run(cfg, 1, -1, 0.5).heading).toBeGreaterThan(20);
  });
  it("traction-heavy layout turns slower than all-omni (scrub)", () => {
    const traction = { ...cfg, wheels: cfg.wheels.map((w) => ({ ...w, type: "traction" as const })) };
    const omni = { ...cfg, wheels: cfg.wheels.map((w) => ({ ...w, type: "omni" as const })) };
    expect(run(traction, 1, -1, 1).w).toBeLessThan(run(omni, 1, -1, 1).w);
  });
  it("stays inside the field walls", () => {
    const s = run(cfg, 1, 1, 10);
    expect(s.y + cfg.length / 2).toBeLessThanOrEqual(72 + 1e-6);
    expect(s.v).toBe(0);
  });
  it("coasts to rest with zero command", () => {
    const d = derive(cfg);
    let s = { ...initialState(), v: 20 };
    for (let i = 0; i < 2000; i++) s = step(s, cfg, 0, 0, 0.005, defaultEnv, d);
    expect(Math.abs(s.v)).toBeLessThan(0.5);
  });
});
