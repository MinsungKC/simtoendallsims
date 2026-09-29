import { describe, expect, it } from "vitest";
import { generateEz } from "./ez";
import { fixtureInput } from "./fixture";
import { compileCheck, haveRefs, REFS } from "./compile";
import { join } from "node:path";

describe("EZ-Template generator", () => {
  const res = generateEz(fixtureInput());
  const autons = res.files.find((f) => f.path === "src/autons.cpp")!.content;
  const main = res.files.find((f) => f.path === "src/main.cpp")!.content;

  it("builds the chassis from the physical robot", () => {
    expect(main).toContain("{-1, -2},  // left chassis ports");
    expect(main).toContain("3.25,  // wheel diameter");
    expect(main).toContain("450);  // wheel RPM");
  });
  it("registers tracking wheels", () => {
    expect(main).toContain("ez::tracking_wheel vert_tracker_1(11, 2.75, 2.5);");
    expect(main).toContain("chassis.odom_tracker_left_set(&vert_tracker_1);");
    expect(main).toContain("chassis.odom_tracker_back_set(&horiz_tracker_2);");
  });
  it("maps motions to EZ calls", () => {
    expect(autons).toContain("chassis.pid_odom_set({{-48_in, -30_in}, fwd, 100}, true);");
    expect(autons).toContain("chassis.pid_turn_set(90_deg, 127, ez::cw);");
    expect(autons).toContain("chassis.pid_odom_set({{-24_in, -24_in, 135_deg}, rev, 127}");
    expect(autons).toContain("chassis.pid_swing_set(ez::RIGHT_SWING, 180_deg, 127);"); // lock left => right side moves
    expect(autons).toContain("chassis.pid_turn_set({0_in, 24_in}, fwd, 127);");
    expect(autons).toContain("chassis.pid_wait_until(20_in);");
  });
  it("matches the golden snapshot", () => {
    expect(autons).toMatchSnapshot();
    expect(main).toMatchSnapshot();
  });
  it.skipIf(!haveRefs)("compiles inside the real EZ-Template 3.2.x example project", () => {
    const base = join(REFS, "EZ-Template/EZ-Template-Example-Project");
    const r = compileCheck(res.files, [], ["src/main.cpp", "src/autons.cpp"], base);
    expect(r.log).toBe("");
    expect(r.ok).toBe(true);
  });
});
