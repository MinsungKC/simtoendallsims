import { describe, expect, it } from "vitest";
import { override, stackHalves, quadrantOf, sideOfLine, GOAL_ACROSS_FLATS, GOAL_HEIGHT, PIN, CUP, LOAD_ZONE, goalOutline, loaderOutline } from "./override";
import { worldInit } from "./types";
import { createWorld, placeHeld, setToggle, spinePoint, stepWorld, type World } from "../core/world";
import { defaultRobot, derive } from "../core/robot";
import { simulate } from "../core/runtime";
import { defaultMotion, type MotionSpec, type Routine } from "../core/routine";

const cfg = defaultRobot();

function world(alliance: "red" | "blue" = "red", at = { x: 0, y: -60, heading: 0 }): World {
  const w = createWorld(worldInit(override, alliance), at);
  w.alliance = alliance;
  w.robotBox = { hl: cfg.length / 2, hw: cfg.width / 2 };
  return w;
}

describe("Override layout matches the manual's bill of materials", () => {
  const pins = override.objects.filter((o) => o.kind === "pin");
  const cups = override.objects.filter((o) => o.kind === "cup");
  const pair = (a: string, b: string) => pins.filter((p) => [p.halves![0], p.halves![1]].sort().join() === [a, b].sort().join()).length;
  it("has 4 red/blue, 8 red/yellow, 8 blue/yellow and 17 yellow/yellow Pins on the Field", () => {
    expect(pair("red", "blue")).toBe(4);
    expect(pair("red", "yellow")).toBe(8);
    expect(pair("blue", "yellow")).toBe(8);
    expect(pair("yellow", "yellow")).toBe(17);
  });
  it("has 36 Cups on the Field: 24 gray side up and 12 clear side up", () => {
    expect(cups).toHaveLength(36);
    expect(cups.filter((c) => c.opaqueUp).length).toBe(24);
  });
  it("has 9 Goals (1 tall, 4 short, 2 red, 2 blue), 4 Toggles and 4 Loaders", () => {
    expect(override.goals).toHaveLength(9);
    expect(override.goals!.filter((g) => g.kind === "tall")).toHaveLength(1);
    expect(override.goals!.filter((g) => g.kind === "short")).toHaveLength(4);
    expect(override.goals!.filter((g) => g.alliance === "red")).toHaveLength(2);
    expect(override.goals!.filter((g) => g.alliance === "blue")).toHaveLength(2);
    expect(override.toggles).toHaveLength(4);
    expect(override.obstacles.filter((o) => o.tag === "loader")).toHaveLength(4);
  });
  it("uses the manual's Goal heights and Cup/Pin sizes", () => {
    expect(GOAL_HEIGHT.tall).toBeCloseTo(8.77, 1);
    expect(GOAL_HEIGHT.short).toBeCloseTo(5.77, 1);
    expect(GOAL_HEIGHT.alliance).toBeCloseTo(3.25, 2);
    expect(cups[0].r * 2).toBeCloseTo(3.15, 2);
    expect(CUP.height).toBe(6.5);
    expect(PIN.length).toBe(6.5);
    // a lying Pin's collision spine plus its radius covers the 6.5" body up to the rounded ends (2 x (2.2 + 1.0) = 6.4")
    expect(2 * (PIN.half + PIN.r)).toBeCloseTo(PIN.length, 0);
  });
  it("puts each Alliance's Goals in its own two Quadrants, on the Alliance's side of the Autonomous Line", () => {
    for (const g of override.goals!.filter((q) => q.alliance)) expect(sideOfLine(g.x, g.y)).toBe(g.alliance);
    expect(new Set(override.goals!.filter((g) => g.alliance === "red").map((g) => quadrantOf(g.x, g.y)))).toEqual(new Set(["W", "S"]));
    expect(new Set(override.goals!.filter((g) => g.alliance === "blue").map((g) => quadrantOf(g.x, g.y)))).toEqual(new Set(["N", "E"]));
  });
  it("Goals are true octagons of the documented footprint", () => {
    const o = override.obstacles.find((q) => q.tag === "goal:tall")!;
    expect(o.verts).toHaveLength(8);
    const xs = o.verts!.map((v) => v.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(GOAL_ACROSS_FLATS, 2); // flats face the axes
  });
  it("each legal start is one Robot per Quadrant, on its own side of the line, touching the Perimeter", () => {
    expect(new Set(override.starts.map((s) => quadrantOf(s.x, s.y))).size).toBe(4);
    for (const s of override.starts) {
      expect(sideOfLine(s.x, s.y)).toBe(s.alliance);
      expect(Math.max(Math.abs(s.x), Math.abs(s.y)) + cfg.length / 2).toBeGreaterThanOrEqual(72);
    }
  });
});

describe("layout taken from the official top-down graphic", () => {
  const pins = override.objects.filter((o) => o.kind === "pin");
  const cups = override.objects.filter((o) => o.kind === "cup");
  it("36 Cups: 24 touch the Perimeter in eight triples, 12 sit on the interior diagonals", () => {
    const wall = cups.filter((c) => Math.max(Math.abs(c.x), Math.abs(c.y)) > 69);
    expect(wall).toHaveLength(24);
    for (const c of wall) expect(Math.max(Math.abs(c.x), Math.abs(c.y)) + c.r).toBeCloseTo(72, 0);
    // adjacent Cups in a triple are 3.2" apart (touching), the middle one 24.2" from the wall's middle
    const north = wall.filter((c) => c.y > 69).map((c) => c.x).sort((a, b) => a - b);
    expect(north.map((x) => +x.toFixed(1))).toEqual([-27.4, -24.2, -21, 21, 24.2, 27.4]);
    for (const c of cups.filter((q) => !wall.includes(q))) expect(Math.abs(Math.abs(c.x) - Math.abs(c.y)) < 0.01 || Math.abs(c.x) + Math.abs(c.y) === 24 || c.x === 0 || c.y === 0).toBe(true);
  });
  it("16 Pins lie in four radial rings on the Autonomous Line, yellow end at the Cup and the colored end out", () => {
    const lying = pins.filter((p) => p.lying);
    expect(lying).toHaveLength(16);
    for (const p of lying) {
      expect(p.halves![0]).toBe("yellow");
      expect(p.half).toBeCloseTo(PIN.half);
      const cup = cups.find((c) => Math.hypot(c.x - p.x, c.y - p.y) < 5.2 && Math.abs(Math.abs(c.x) - Math.abs(c.y)) < 0.01 && !c.opaqueUp)!;
      expect(cup).toBeDefined();
      // the pin's far end (halves[1]) points away from the Cup
      const a = (p.angle! * Math.PI) / 180;
      const away = (p.x - cup.x) * Math.sin(a) + (p.y - cup.y) * Math.cos(a);
      expect(away).toBeGreaterThan(4);
      // its near end starts at the Cup's rim, not inside it
      const near = Math.hypot(p.x - Math.sin(a) * p.half! - cup.x, p.y - Math.cos(a) * p.half! - cup.y);
      expect(near - p.r).toBeGreaterThanOrEqual(cup.r - 0.2);
    }
    // north/east tips are blue, south/west tips red
    for (const p of lying) expect(p.halves![1]).toBe(p.angle === 0 || p.angle === 90 ? "blue" : "red");
  });
  it("12 Pins stand in Cups (8 yellow in wall triples, 4 yellow on the diagonal) plus 4 red/blue on the Midfield corners", () => {
    const nested = pins.filter((p) => p.nestedIn !== undefined);
    expect(nested).toHaveLength(16);
    for (const p of nested) { const c = cups.find((q) => q.id === p.nestedIn)!; expect(c.x).toBe(p.x); expect(c.y).toBe(p.y); }
    const mid = nested.filter((p) => p.halves!.includes("red"));
    expect(mid).toHaveLength(4);
    for (const p of mid) expect(Math.abs(p.x) + Math.abs(p.y)).toBe(24);
  });
  it("five yellow Pins start Placed in the four short Goals and the tall Goal; Alliance Goals start empty; score is 0", () => {
    const w = world();
    const pre = w.goals.filter((g) => g.stack.length);
    expect(pre.map((g) => g.id).sort()).toEqual(["short-E", "short-N", "short-S", "short-W", "tall"]);
    for (const g of pre) expect(g.stack.map((i) => i.kind)).toEqual(["pin"]);
    expect(w.goals.filter((g) => g.alliance).every((g) => g.stack.length === 0)).toBe(true);
    const s = override.score(w);
    expect([s.red, s.blue]).toEqual([0, 0]);
  });
  it("Goals are chamfered squares (octagons) and Loaders are trapezoids narrowing away from the wall", () => {
    const g = goalOutline(0, 0);
    expect(g).toHaveLength(8);
    const l = loaderOutline(-1, 60.2);
    expect(l).toHaveLength(4);
    expect(Math.abs(l[0].x)).toBe(72);
    expect(Math.abs(l[1].x)).toBeCloseTo(68.2);
    expect(l[3].y - l[0].y).toBeGreaterThan(l[2].y - l[1].y); // wider at the wall
    expect(LOAD_ZONE.depth).toBe(24);
  });
  it("Toggles ride on the Perimeter: they are not obstacles inside the Field", () => {
    expect(override.obstacles.some((o) => o.tag === "toggle")).toBe(false);
    expect(override.toggles!.every((t) => Math.max(Math.abs(t.x), Math.abs(t.y)) === 72)).toBe(true);
  });
});

describe("lying Pins and nested Pins in play", () => {
  it("a lying Pin collides along its whole length, and stops at the wall with its tip, not its center", () => {
    const w = createWorld({ ...worldInit(override), objects: [{ id: 1, kind: "pin", team: "neutral", x: 60, y: 0, r: PIN.r, mass: PIN.mass, drag: 30, lying: true, half: PIN.half, angle: 90, halves: ["yellow", "red"] }], goals: [], obstacles: [] }, { x: 0, y: -40, heading: 0 });
    w.objects[0].vx = 80;
    let maxTip = 0;
    for (let i = 0; i < 400; i++) { stepWorld(w, cfg, 0, 0, 0.005); maxTip = Math.max(maxTip, w.objects[0].x + PIN.half + PIN.r); }
    expect(maxTip).toBeLessThanOrEqual(72.001); // never through the wall
    expect(maxTip).toBeGreaterThan(71.9); // and reached it with the tip, 3.2" past the center
    expect(spinePoint(w.objects[0], 0, 0).y).toBeCloseTo(0);
  });
  it("driving into the end of a lying Pin pushes it before the robot reaches its center", () => {
    const pin = { id: 1, kind: "pin", team: "neutral" as const, x: 0, y: 12, r: PIN.r, mass: PIN.mass, drag: 30, lying: true, half: PIN.half, angle: 0, halves: ["yellow", "red"] as [string, string] };
    const w = createWorld({ ...worldInit(override), objects: [pin], goals: [], obstacles: [], rules: undefined }, { x: 0, y: -10, heading: 0 });
    w.robotBox = { hl: cfg.length / 2, hw: cfg.width / 2 };
    const d = derive(cfg);
    let touchedAt = 0;
    for (let i = 0; i < 400 && !touchedAt; i++) { stepWorld(w, cfg, 0.6, 0.6, 0.005, d); if (w.objects[0].y > 12.05) touchedAt = w.robot.y; }
    // the pin's near end is 12 - 2.2 - 1.0 = 8.8; the robot's front (7.5 ahead of center) meets it around y = 1.3, far before y = 4.5
    expect(touchedAt).toBeGreaterThan(-1);
    expect(touchedAt).toBeLessThan(3);
  });
  it("picking up a Cup that has a Pin standing in it takes both", () => {
    const yellowStack = override.objects.find((o) => o.kind === "cup" && o.x === 24 && o.y === 24)!;
    const w = createWorld(worldInit(override, "red"), { x: 24, y: 24 - 12, heading: 0 });
    w.robotBox = { hl: cfg.length / 2, hw: cfg.width / 2 };
    w.held.length = 0;
    for (const o of w.objects) if (o.held) { o.held = false; o.state = "field"; o.x = 0; o.y = -60; }
    const d = derive(cfg);
    w.mech.intake = 1;
    for (let i = 0; i < 400; i++) stepWorld(w, cfg, 0.5, 0.5, 0.005, d);
    const inner = w.objects.find((o) => o.nestedIn === undefined && o.kind === "pin" && Math.hypot(o.x - 24, o.y - 24) < 0.5 && o.state === "held");
    void inner;
    expect(w.objects.find((o) => o.id === yellowStack.id)!.state).toBe("held");
    expect(w.held.length).toBe(2);
  });
});

describe("collisions with the real shapes", () => {
  it("the robot cannot drive through the octagonal center Goal", () => {
    const w = world("red", { x: 0, y: -40, heading: 0 });
    const d = derive(cfg);
    for (let i = 0; i < 600; i++) stepWorld(w, cfg, 1, 1, 0.005, d);
    expect(w.robot.y + cfg.length / 2).toBeLessThan(-GOAL_ACROSS_FLATS / 2 + 1);
  });
  it("loose objects are stopped by a Goal instead of passing through it", () => {
    const w = createWorld({ ...worldInit(override), objects: [{ id: 1, kind: "cup", team: "neutral", x: 0, y: -14, r: 1.575, mass: 0.078, drag: 30 }] }, { x: 60, y: 60, heading: 0 });
    w.objects[0].vy = 60;
    for (let i = 0; i < 400; i++) stepWorld(w, cfg, 0, 0, 0.005);
    expect(w.objects[0].y).toBeLessThan(-GOAL_ACROSS_FLATS / 2);
  });
  it("the Perimeter stops the robot at the wall (Toggles ride on top of it, outside the tiles)", () => {
    const w = world("red", { x: 40, y: 50, heading: 0 });
    w.robot.heading = 0;
    const d = derive(cfg);
    for (let i = 0; i < 1200; i++) stepWorld(w, cfg, 1, 1, 0.005, d);
    expect(w.robot.y + cfg.length / 2).toBeLessThanOrEqual(72);
  });
});

describe("nesting and stacking (SC2)", () => {
  const rules = override.rules!;
  const goal = { id: "g", x: 0, y: 0, kind: "short", height: 5.8, reach: 11, stack: [] as never[] };
  const pin = { id: 1, kind: "pin", halves: ["red", "yellow"] as [string, string], team: "red" as const } as never;
  const cup = { id: 2, kind: "cup", opaqueUp: false, team: "neutral" as const } as never;
  it("a Pin goes into an empty Goal; a Cup cannot; then Cup over Pin, Pin over Cup", () => {
    expect(rules.canStack(goal, pin)).toBe(true);
    expect(rules.canStack(goal, cup)).toBe(false);
    const g1 = { ...goal, stack: [{ id: 1, kind: "pin" }] as never };
    expect(rules.canStack(g1, pin)).toBe(false);
    expect(rules.canStack(g1, cup)).toBe(true);
    const g2 = { ...goal, stack: [{ id: 1, kind: "pin" }, { id: 2, kind: "cup" }] as never };
    expect(rules.canStack(g2, pin)).toBe(true);
    expect(rules.canStack(g2, cup)).toBe(false);
  });
  it("possession is limited to one Pin and one Cup (SG6)", () => {
    expect(rules.possession).toEqual({ pin: 1, cup: 1 });
  });
  it("place action nests the held Pin into the Goal ahead; the preload is a Pin of the Alliance color", () => {
    const w = world("red", { x: -60, y: -24, heading: 90 }); // red West Goal at (-48,-24), robot facing it
    expect(w.held).toHaveLength(1);
    expect(w.objects.find((o) => o.id === w.held[0])!.halves).toEqual(["red", "yellow"]);
    expect(placeHeld(w, cfg)).toBeNull();
    expect(w.goals.find((g) => g.id === "red-W")!.stack).toHaveLength(1);
    expect(w.held).toHaveLength(0);
  });
  it("refuses to place on the opposing Alliance's Goal (SG9)", () => {
    const w = world("red", { x: 64.5, y: 24, heading: 270 }); // blue East Goal at (48,24)
    expect(placeHeld(w, cfg)).toContain("opposing");
  });
  it("refuses when no Goal is within reach", () => {
    expect(placeHeld(world("red", { x: -50, y: 0, heading: 0 }), cfg)).toContain("no goal");
  });
});

describe("scoring (SC3, SC5, SC6)", () => {
  const stack = (w: World, id: string, items: { kind: string; halves?: [string, string]; opaqueUp?: boolean; flip?: boolean }[]) => {
    w.goals.find((g) => g.id === id)!.stack = items.map((it, i) => ({ id: 100 + i, ...it }));
  };
  it("a lone red/yellow Pin in a Goal: red half 5, yellow half unowned", () => {
    const w = world("red");
    stack(w, "red-W", [{ kind: "pin", halves: ["red", "yellow"] }]);
    const s = override.score(w);
    expect(s.red).toBe(5);
    expect(s.blue).toBe(0);
  });
  it("the Quadrant's Toggle decides who Owns yellow halves (10 pts each)", () => {
    const w = world("red");
    stack(w, "short-W", [{ kind: "pin", halves: ["yellow", "yellow"] }]);
    expect(override.score(w).red + override.score(w).blue).toBe(0); // Toggle neutral: no one Owns it
    w.toggles.find((t) => t.wall === "W")!.state = "blue";
    expect(override.score(w).blue).toBe(20);
    w.toggles.find((t) => t.wall === "W")!.state = "red";
    expect(override.score(w).red).toBe(20);
  });
  it("a Cup's opaque half hides the Pin half nested inside it (SC3)", () => {
    // Pin, then a gray-side-up Cup (opaque half up: the lower socket covering the Pin is clear), then a Pin in the opaque upper socket
    const halves = stackHalves({ stack: [
      { id: 1, kind: "pin", halves: ["red", "blue"] },
      { id: 2, kind: "cup", opaqueUp: true },
      { id: 3, kind: "pin", halves: ["yellow", "red"] },
    ] as never });
    expect(halves.map((h) => `${h.color}:${h.visible ? "v" : "h"}`)).toEqual(["red:v", "blue:v", "yellow:h", "red:v"]);
    // clear side up: the lower socket is the opaque one and hides the lower Pin's top half
    const flipped = stackHalves({ stack: [
      { id: 1, kind: "pin", halves: ["red", "blue"] },
      { id: 2, kind: "cup", opaqueUp: false },
      { id: 3, kind: "pin", halves: ["yellow", "red"] },
    ] as never });
    expect(flipped.map((h) => `${h.color}:${h.visible ? "v" : "h"}`)).toEqual(["red:v", "blue:h", "yellow:v", "red:v"]);
  });
  it("a Robot ending in the Midfield scores 8 and Owns yellow Pins in the center Goal", () => {
    const w = world("red", { x: 10, y: 10, heading: 0 });
    stack(w, "tall", [{ kind: "pin", halves: ["yellow", "yellow"] }]);
    const s = override.score(w);
    expect(s.red).toBe(8 + 20);
    const off = world("red", { x: 0, y: -60, heading: 0 });
    stack(off, "tall", [{ kind: "pin", halves: ["yellow", "yellow"] }]);
    expect(override.score(off).red).toBe(0);
  });
  it("Autonomous Win Point: 6 scored Pins, 2 Goals with 2+, and off the Perimeter", () => {
    const w = world("red", { x: -30, y: -30, heading: 0 });
    const tower = [{ kind: "pin", halves: ["red", "red"] }, { kind: "cup", opaqueUp: true }, { kind: "pin", halves: ["red", "red"] }, { kind: "cup", opaqueUp: true }, { kind: "pin", halves: ["red", "red"] }];
    stack(w, "red-W", tower as never);
    stack(w, "red-S", [{ kind: "pin", halves: ["red", "red"] }]);
    const s = override.score(w);
    expect(s.notes!.join(" ")).toContain("Autonomous Win Point (standard events): MET");
    const perimeter = world("red", { x: -64.5, y: -30, heading: 0 });
    const tower2 = tower;
    stack(perimeter, "red-W", tower2 as never);
    stack(perimeter, "red-S", [{ kind: "pin", halves: ["red", "red"] }]);
    expect(override.score(perimeter).notes!.join(" ")).toContain("not met");
  });
  it("setToggle flips the nearest wall Toggle only when the robot's front is at it", () => {
    const w = world("red", { x: 0, y: 60, heading: 0 }); // front at y=67.5, Toggle N bar at y ~ 71
    expect(setToggle(w, cfg, "red")).toBeNull();
    expect(w.toggles.find((t) => t.wall === "N")!.state).toBe("red");
    expect(setToggle(world("red", { x: 0, y: 0, heading: 0 }), cfg, "red")).toContain("no Toggle");
  });
});

describe("end-to-end: a routine that scores and gets rule-checked", () => {
  const mv = (type: MotionSpec["type"], p: { x: number; y: number; heading: number }, patch: object = {}) => ({ ...defaultMotion(type, p), ...patch }) as MotionSpec;
  const run = (steps: Routine["steps"], start = { x: -60, y: -24, heading: 90 }, alliance: "red" | "blue" = "red") => {
    const routine: Routine = { name: "t", gameId: "override", alliance, start, steps };
    const rec = simulate(routine, cfg, worldInit(override, alliance));
    return { rec, findings: override.check!({ routine, cfg, recording: rec, world: rec.world }), score: override.score(rec.world) };
  };
  it("places the preload on the red Goal and scores it", () => {
    const { rec, score } = run([{ id: "p", motion: mv("wait", { x: 0, y: 0, heading: 0 }, { ms: 200 }), actions: [{ id: "a", type: "place", when: { kind: "start" } }] }]);
    expect(rec.events.some((e) => e.type === "place")).toBe(true);
    expect(score.red).toBe(5);
  });
  it("flags crossing the Autonomous Line onto the opposing side", () => {
    const { findings } = run([{ id: "m", motion: mv("moveToPoint", { x: 40, y: 40, heading: 0 }, { timeout: 5000 }), actions: [] }], { x: -64.5, y: 38, heading: 90 });
    expect(findings.some((f) => f.text.includes("Autonomous Line") && f.level === "error")).toBe(true);
  });
  it("flags a start pose touching a Goal or on the wrong side", () => {
    const touching = run([], { x: -48, y: -24, heading: 0 }).findings;
    expect(touching.some((f) => f.text.includes("touches"))).toBe(true);
    const wrongSide = run([], { x: 40, y: 40, heading: 0 }).findings;
    expect(wrongSide.some((f) => f.text.includes("Autonomous Line"))).toBe(true);
  });
  it("flags contact with an opposing Alliance Goal (SG9)", () => {
    const { findings } = run([{ id: "m", motion: mv("moveToPoint", { x: 30, y: 30, heading: 0 }, { timeout: 5000 }), actions: [] }], { x: 36, y: 40, heading: 0 }, "blue");
    expect(findings.some((f) => f.text.includes("SG9") || f.text.includes("Autonomous Line") || f.text.includes("Start pose"))).toBe(true);
  });
  it("reports a failed Place when there is no Goal in front", () => {
    const { rec } = run([{ id: "p", motion: mv("wait", { x: 0, y: 0, heading: 0 }, { ms: 100 }), actions: [{ id: "a", type: "place", when: { kind: "start" } }] }], { x: -64.5, y: 10, heading: 0 });
    expect(rec.warnings.some((w) => w.text.includes("Place failed"))).toBe(true);
  });
});

describe("Override demo routine (used by the UI)", () => {
  it("places the preload, fetches a Cup and stacks it, with no rule errors", async () => {
    const { overrideDemo } = await import("../ui/store");
    const routine = overrideDemo("red");
    const rec = simulate(routine, cfg, worldInit(override, "red"));
    const findings = override.check!({ routine, cfg, recording: rec, world: rec.world });
    expect(findings.filter((f) => f.level === "error")).toEqual([]);
    expect(rec.warnings.map((w) => w.text)).toEqual([]);
    const goal = rec.world.goals.find((g) => g.id === "short-W")!;
    // the yellow Pin that starts in the Goal, a Cup over it, and the Preload nested in the Cup
    expect(goal.stack.map((s) => s.kind)).toEqual(["pin", "cup", "pin"]);
    expect(rec.world.toggles.find((t) => t.wall === "W")!.state).toBe("red");
    // three yellow halves are visible and Owned through the red West Toggle
    expect(override.score(rec.world).red).toBe(30);
    expect(rec.duration).toBeLessThan(15);
  });
  it("the blue version is the red one turned 180 degrees (the field's symmetry) and runs just as cleanly", async () => {
    const { overrideDemo } = await import("../ui/store");
    const routine = overrideDemo("blue");
    expect(routine.alliance).toBe("blue");
    expect(routine.start).toEqual({ x: 64.5, y: -38, heading: 0 });
    const rec = simulate(routine, cfg, worldInit(override, "blue"));
    expect(override.check!({ routine, cfg, recording: rec, world: rec.world }).filter((f) => f.level === "error")).toEqual([]);
    expect(rec.warnings.map((w) => w.text)).toEqual([]);
    expect(rec.world.goals.find((g) => g.id === "short-E")!.stack.map((s) => s.kind)).toEqual(["pin", "cup", "pin"]);
    expect(rec.world.toggles.find((t) => t.wall === "E")!.state).toBe("blue");
    expect(override.score(rec.world).blue).toBe(30);
  });
});
