import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateGeneric } from "./generic";
import { fixtureInput } from "./fixture";

/** Compile the generated generic main.cpp with a host PROS stub + a simple plant and run motions for real. */
function build() {
  const dir = mkdtempSync(join(tmpdir(), "grun-"));
  const input = fixtureInput();
  input.cfg.odom.trackingWheels = []; // plant only models drive-wheel odometry
  input.ports.tracking = [];
  const res = generateGeneric(input);
  const gen = res.files[0].content.replace('#include "main.h"', '#include "main.h"\n');
  const harness = readFileSync(resolve("scripts/pros-host-stub/harness.cpp"), "utf8");
  writeFileSync(join(dir, "all.cpp"), gen + "\n" + harness);
  mkdirSync(join(dir, "bin"));
  execFileSync("g++", ["-std=gnu++20", "-O1", "-w", "-I", resolve("scripts/pros-host-stub"), "-o", join(dir, "bin/run"), join(dir, "all.cpp")], { stdio: "pipe" });
  return join(dir, "bin/run");
}

function run(bin: string, ...args: string[]) {
  const out = execFileSync(bin, args).toString().trim().split(" ").map(Number);
  return { x: out[0], y: out[1], th: out[2], ex: out[3], ey: out[4], eth: out[5], ms: out[6] };
}

describe("generated generic C++ actually moves the robot (host plant)", () => {
  const bin = build();
  it("move_to_point reaches the target", () => {
    const r = run(bin, "point:0,48");
    expect(Math.hypot(r.x, r.y - 48)).toBeLessThan(2.5);
    expect(r.ms).toBeLessThan(4000);
  });
  it("reverse move_to_point reaches the target backwards", () => {
    const r = run(bin, "rpoint:0,-30");
    expect(Math.hypot(r.x, r.y + 30)).toBeLessThan(3);
  });
  it("turn_to_heading settles on the heading", () => {
    expect(Math.abs(run(bin, "turn:90").th - 90)).toBeLessThan(3);
    expect(Math.abs(run(bin, "turn:-135").th + 135)).toBeLessThan(3);
  });
  it("move_to_pose arrives at position and heading", () => {
    const r = run(bin, "pose:24,30,90");
    expect(Math.hypot(r.x - 24, r.y - 30)).toBeLessThan(3.5);
    expect(Math.abs(r.th - 90)).toBeLessThan(8);
  });
  it("swing pivots and settles", () => {
    expect(Math.abs(run(bin, "swingL:90").th - 90)).toBeLessThan(4);
  });
  it("odometry tracks the plant", () => {
    const r = run(bin, "point:20,20", "turn:180");
    expect(Math.hypot(r.ex - r.x, r.ey - r.y)).toBeLessThan(1);
    expect(Math.abs(r.eth - r.th)).toBeLessThan(1);
  });
});
