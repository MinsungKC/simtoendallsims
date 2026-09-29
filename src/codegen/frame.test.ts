import { describe, expect, it } from "vitest";
import { generate } from "./index";
import { fixtureInput } from "./fixture";
import { compileCheck, haveRefs, REFS } from "./compile";
import { join } from "node:path";

/** Give the fixture a start that is neither at the origin nor facing +y so the frame matters. */
function input() {
  const i = fixtureInput();
  i.routine.start = { x: -48, y: -58, heading: 90 };
  (i.routine.steps[0].motion as { x: number; y: number; heading: number }).x = -48;
  (i.routine.steps[0].motion as { x: number; y: number; heading: number }).heading = 90;
  return i;
}

describe("generated code is relative to the starting position by default", () => {
  it("LemLib: setPose(0, 0, heading) and targets offset by the start", () => {
    const res = generate("lemlib", input());
    const main = res.files.find((f) => f.path === "src/main.cpp")!.content;
    expect(main).toContain("chassis.setPose(0, 0, 90);");
    expect(main).toContain("chassis.moveToPoint(0, 28, 2500, {.maxSpeed = 100});"); // was (-48, -30)
    expect(res.notes[0]).toContain("relative to the starting position");
    expect(main).not.toContain("moveToPoint(-48");
  });
  it("EZ-Template, JAR-Template and generic PROS start at 0,0 too", () => {
    const ez = generate("ez-template", input()).files.map((f) => f.content).join("\n");
    expect(ez).toContain("chassis.odom_xyt_set(0_in, 0_in, 90_deg);");
    const jar = generate("jar-template", input()).files.map((f) => f.content).join("\n");
    expect(jar).toContain("chassis.set_coordinates(0, 0, 90);");
    const gen = generate("generic-pros", input()).files.map((f) => f.content).join("\n");
    expect(gen).toContain("gen::set_pose(0, 0, 90);");
  });
  it("'start-rotated' makes the start heading 0 as well", () => {
    const res = generate("lemlib", { ...input(), frame: "start-rotated" });
    const main = res.files.find((f) => f.path === "src/main.cpp")!.content;
    expect(main).toContain("chassis.setPose(0, 0, 0);");
    // the first target is 28" north of the start; a robot facing east has that on its left, so x = -28 in its own frame
    expect(main).toContain("chassis.moveToPoint(-28, 0, 2500");
  });
  it("frame 'field' keeps field coordinates", () => {
    const res = generate("lemlib", { ...input(), frame: "field" });
    const main = res.files.find((f) => f.path === "src/main.cpp")!.content;
    expect(main).toContain("chassis.setPose(-48, -58, 90);");
    expect(res.notes[0]).toContain("field coordinates");
  });
  it.skipIf(!haveRefs)("the relative LemLib project still compiles against the real headers", () => {
    const res = generate("lemlib", input());
    const r = compileCheck(res.files, [join(REFS, "pros/include"), join(REFS, "LemLib/include")], ["src/main.cpp"]);
    expect(r.log).toBe("");
    expect(r.ok).toBe(true);
  });
});
