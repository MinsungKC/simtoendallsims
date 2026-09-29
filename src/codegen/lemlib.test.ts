import { describe, expect, it } from "vitest";
import { generateLemLib } from "./lemlib";
import { fixtureInput } from "./fixture";
import { compileCheck, haveRefs, REFS } from "./compile";
import { join } from "node:path";

describe("LemLib generator", () => {
  const input = fixtureInput();
  const res = generateLemLib(input);
  const main = res.files.find((f) => f.path === "src/main.cpp")!.content;

  it("emits the drivetrain config from the physical robot", () => {
    expect(main).toContain("pros::MotorGroup left_motors({-1, -2}, pros::MotorGears::blue);");
    expect(main).toContain("lemlib::Omniwheel::NEW_325, // wheel diameter");
    expect(main).toContain("450, // wheel rpm = 600 x 36/48");
    expect(main).toContain("12.5, // track width (in)");
  });
  it("emits tracking wheels with LemLib offsets", () => {
    expect(main).toContain("lemlib::TrackingWheel vertical_1_wheel(&vertical_1_encoder, lemlib::Omniwheel::NEW_275, -2.5);");
    expect(main).toContain("lemlib::TrackingWheel horizontal_2_wheel(&horizontal_2_encoder, lemlib::Omniwheel::NEW_275, -5.75);");
    expect(main).toContain("&horizontal_2_wheel, // horizontal tracking wheel 1");
  });
  it("maps every motion type", () => {
    expect(main).toContain("chassis.moveToPoint(-48, -30, 2500, {.maxSpeed = 100});");
    expect(main).toContain("chassis.turnToHeading(90, 2000, {.direction = lemlib::AngularDirection::CW_CLOCKWISE});");
    expect(main).toContain("chassis.moveToPose(-24, -24, 135, 4000, {.forwards = false, .lead = 0.5, .minSpeed = 40, .earlyExitRange = 4});");
    expect(main).toContain("chassis.swingToHeading(180, lemlib::DriveSide::LEFT, 2000);");
    expect(main).toContain("chassis.turnToPoint(0, 24, 2000);");
    expect(main).toContain("chassis.follow(path_1_txt, 12, 4000, true);");
  });
  it("sequences actions like the simulator: start / waitUntil / delay / end", () => {
    const i1 = main.indexOf("intake.move(127);");
    const i2 = main.indexOf("chassis.moveToPoint(-48, -30");
    const i3 = main.indexOf("chassis.waitUntil(20);");
    const i4 = main.indexOf("clamp_piston.set_value(true);");
    expect(i1).toBeGreaterThan(0);
    expect(i1).toBeLessThan(i2);
    expect(i2).toBeLessThan(i3);
    expect(i3).toBeLessThan(i4);
    expect(main).toContain("pros::delay(400);");
    expect(main).toContain("// custom code here");
  });
  it("writes the path asset in LemLib v0.5 format", () => {
    const p = res.files.find((f) => f.path === "static/path_1.txt")!;
    expect(p.content).toContain("endData");
  });
  it("matches the golden snapshot", () => {
    expect(main).toMatchSnapshot();
  });

  it.skipIf(!haveRefs)("compiles against the real PROS 4.2.2 + LemLib stable headers", () => {
    const r = compileCheck(res.files, [join(REFS, "pros/include"), join(REFS, "LemLib/include")], ["src/main.cpp"]);
    expect(r.log).toBe("");
    expect(r.ok).toBe(true);
  });
});
