import { describe, expect, it } from "vitest";
import { generateGeneric } from "./generic";
import { fixtureInput } from "./fixture";
import { compileCheck, haveRefs, REFS } from "./compile";
import type { Recording } from "../core/runtime";
import { join } from "node:path";

describe("generic PROS generator", () => {
  const input = fixtureInput();
  // fixed trigger timings keep the golden snapshot independent of physics tuning
  const recording = { triggers: [{ step: 1, actionId: "a2", offsetMs: 900, distance: 20 }, { step: 6, actionId: "a4", offsetMs: 400, distance: 0 }] } as unknown as Recording;
  const res = generateGeneric({ ...input, recording });
  const main = res.files[0].content;

  it("embeds the physics-derived gains and constants", () => {
    expect(main).toContain("constexpr Gains LATERAL = {10, 0, 3, 3, 1, 100, 3, 500, 20};");
    expect(main).toContain("constexpr double GEAR_RATIO = 0.75;");
    expect(main).toContain("constexpr double TRACK_WIDTH = 12.5;");
    expect(main).toContain("pros::Rotation vertical_sensor(11);");
  });
  it("emits each motion", () => {
    expect(main).toContain("gen::move_to_point(-48, -30, 2500, {.maxSpeed = 100});");
    expect(main).toContain("gen::turn_to_heading(90, 2000, {.direction = gen::Dir::CW});");
    expect(main).toContain("gen::move_to_pose(-24, -24, 135, 4000, {.forwards = false, .lead = 0.5, .minSpeed = 40, .earlyExit = 4});");
    expect(main).toContain("gen::swing_to_heading(180, gen::Lock::LEFT, 2000);");
    expect(main).toContain("gen::follow(path_1, sizeof(path_1) / sizeof(path_1[0]), 12, 4000, true);");
  });
  it("matches the golden snapshot", () => {
    expect(main).toMatchSnapshot();
  });
  it.skipIf(!haveRefs)("compiles against the real PROS 4.2.2 headers", () => {
    const r = compileCheck(res.files, [join(REFS, "pros/include")], ["src/main.cpp"]);
    expect(r.log).toBe("");
    expect(r.ok).toBe(true);
  });
});
