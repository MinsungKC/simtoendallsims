import { describe, expect, it } from "vitest";
import { preflight } from "./preflight";
import { defaultRobot } from "./robot";
import { defaultMotion, type Routine } from "./routine";
import { blank, override, highStakes } from "../games";

const cfg = defaultRobot();
const routine = (over: Partial<Routine> = {}): Routine => ({ name: "t", gameId: "blank", alliance: "red", start: { x: 0, y: 0, heading: 0 }, steps: [], ...over });

describe("preflight", () => {
  it("passes a sane setup", () => {
    expect(preflight(routine(), cfg, blank)).toEqual([]);
  });
  it("flags an over-cap drivetrain (8x11W under Override's 55W drivetrain cap)", () => {
    const r = preflight(routine(), { ...cfg, motorsPerSide: 4, otherMotorsW: 0 }, override);
    expect(r.some((p) => p.level === "error" && p.text.includes("subsystem cap"))).toBe(true);
  });
  it("flags oversize robots and off-field starts", () => {
    expect(preflight(routine(), { ...cfg, length: 19 }, blank).some((p) => p.text.includes("starting size"))).toBe(true);
    expect(preflight(routine({ start: { x: 70, y: 0, heading: 0 } }), cfg, blank).some((p) => p.text.includes("outside the field"))).toBe(true);
  });
  it("flags targets off the field and dead-end chaining", () => {
    const r = routine({ steps: [
      { id: "a", motion: defaultMotion("moveToPoint", { x: 80, y: 0, heading: 0 }), actions: [] },
      { id: "b", motion: { ...defaultMotion("moveToPoint", { x: 0, y: 10, heading: 0 }), minSpeed: 50 } as never, actions: [] },
    ] });
    const p = preflight(r, cfg, blank);
    expect(p.some((x) => x.step === 0 && x.text.includes("outside the field"))).toBe(true);
    expect(p.some((x) => x.step === 1 && x.text.includes("earlyExit"))).toBe(true);
  });
  it("warns when starting on top of a game object", () => {
    const g = highStakes.objects[0];
    expect(preflight(routine({ start: { x: g.x, y: g.y, heading: 0 } }), cfg, highStakes).some((p) => p.text.includes("overlaps"))).toBe(true);
  });
});
