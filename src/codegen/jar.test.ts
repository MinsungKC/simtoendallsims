import { describe, expect, it } from "vitest";
import { generateJar } from "./jar";
import { fixtureInput } from "./fixture";
import { compileCheck, haveRefs, REFS } from "./compile";
import type { Recording } from "../core/runtime";
import { join, resolve } from "node:path";

describe("JAR-Template generator", () => {
  const input = fixtureInput();
  // fixed trigger timings keep the golden snapshot independent of physics tuning
  const recording = { triggers: [{ step: 1, actionId: "a2", offsetMs: 900, distance: 20 }, { step: 6, actionId: "a4", offsetMs: 400, distance: 0 }] } as unknown as Recording;
  const res = generateJar({ ...input, recording });
  const autons = res.files.find((f) => f.path === "src/autons.cpp")!.content;
  const main = res.files.find((f) => f.path === "src/main.cpp")!.content;

  it("configures the Drive from the physical robot", () => {
    expect(main).toContain("TANK_TWO_ROTATION,");
    expect(main).toContain("3.25,  // wheel diameter");
    expect(main).toContain("0.75,  // external ratio");
    expect(main).toContain("2.5");
    expect(main).toContain("5.75  // sideways tracker center distance");
  });
  it("converts controller gains to volts (x12/127)", () => {
    expect(autons).toContain("chassis.set_drive_constants(10, 0.945, 0, 0.283, 0);");
  });
  it("maps the motions and mechanism threads", () => {
    expect(autons).toContain("chassis.set_coordinates(-48, -58, 0);");
    expect(autons).toContain("chassis.right_swing_to_angle(180, "); // lock left => right side moves => JAR right_swing
    expect(autons).toContain("thread auton_1_step2_actions_thread(auton_1_step2_actions);");
    expect(autons).toContain("clamp_piston.open();");
  });
  it("warns about unsupported features", () => {
    expect(res.warnings.some((w) => w.includes("reverse"))).toBe(true);
    expect(res.warnings.some((w) => w.includes("pure pursuit"))).toBe(true);
  });
  it("matches the golden snapshot", () => {
    expect(autons).toMatchSnapshot();
    expect(main).toMatchSnapshot();
  });
  it.skipIf(!haveRefs)("type-checks against the real JAR-Template headers (VEX SDK stubbed)", () => {
    const base = join(REFS, "JAR-Template");
    const r = compileCheck(res.files, [resolve("scripts/vex-stub")], ["src/main.cpp", "src/autons.cpp", "src/robot-config.cpp"], base);
    expect(r.log).toBe("");
    expect(r.ok).toBe(true);
  });
});
