import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { frameIndex, lerpFrame, makeZip, bearingDeg } from "./helpers";
import type { Frame } from "../core/runtime";

const frame = (t: number, x: number): Frame => ({
  t, x, y: 0, heading: 0, vx: 0, vy: 0, w: 0, ex: x, ey: 0, etheta: 0, wheelVL: 0, wheelVR: 0, cmdL: 0, cmdR: 0,
  battery: 12, current: 0, slip: false, step: 0, objs: [x, 0, 0, 0], held: 0,
});

describe("playback helpers", () => {
  const frames = [frame(0, 0), frame(0.02, 2), frame(0.04, 4)];
  it("finds the frame at or before a time", () => {
    expect(frameIndex(frames, 0)).toBe(0);
    expect(frameIndex(frames, 0.03)).toBe(1);
    expect(frameIndex(frames, 99)).toBe(2);
  });
  it("interpolates poses and object positions", () => {
    const f = lerpFrame(frames, 0.01);
    expect(f.x).toBeCloseTo(1);
    expect(f.objs[0]).toBeCloseTo(1);
    expect(f.objs[2]).toBe(0);
  });
  it("bearing follows the 0 = +y clockwise convention", () => {
    expect(bearingDeg({ x: 0, y: 0 }, { x: 0, y: 5 })).toBeCloseTo(0);
    expect(bearingDeg({ x: 0, y: 0 }, { x: 5, y: 0 })).toBeCloseTo(90);
    expect(bearingDeg({ x: 0, y: 0 }, { x: -5, y: 0 })).toBeCloseTo(-90);
  });
});

describe("makeZip", () => {
  const files = [{ path: "src/main.cpp", content: "int main(){}\n// héllo" }, { path: "static/path_1.txt", content: "1, 2, 3\n" }];
  it("writes a valid zip (python zipfile reads it back)", () => {
    const dir = mkdtempSync(join(tmpdir(), "zip-"));
    const zip = join(dir, "t.zip");
    writeFileSync(zip, makeZip(files));
    const py = spawnSync("python3", ["-c", "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print('|'.join(n+':'+z.read(n).decode() for n in z.namelist()))", zip]);
    if (py.error) return; // python not available
    expect(py.status).toBe(0);
    expect(py.stdout.toString()).toContain("src/main.cpp:int main(){}");
    expect(py.stdout.toString()).toContain("héllo");
    expect(py.stdout.toString()).toContain("static/path_1.txt:1, 2, 3");
    void execFileSync;
  });
});
