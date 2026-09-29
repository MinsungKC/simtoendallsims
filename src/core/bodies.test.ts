import { describe, expect, it } from "vitest";
import { chassisRects, defaultRobot, derive } from "./robot";
import { createWorld, stepWorld, tipSpeed, type GameObject } from "./world";

const cfg = defaultRobot();
const base = { fieldSize: 144, obstacles: [], goals: [], toggles: [] as never[] };
const pin = (o: Partial<GameObject> = {}) => ({ id: 1, kind: "pin", team: "neutral" as const, x: 0, y: 12, r: 1, mass: 0.073, drag: 30, tip: { height: 6.5, baseR: 0.65, half: 2.2, lyingR: 1 }, ...o }) as Omit<GameObject, "vx" | "vy" | "state">;
const cup = (o: Partial<GameObject> = {}) => ({ id: 2, kind: "cup", team: "neutral" as const, x: 0, y: 12, r: 1.575, mass: 0.078, drag: 30, tip: { height: 6.5, baseR: 1.575, half: 1.675, lyingR: 1.575 }, ...o }) as Omit<GameObject, "vx" | "vy" | "state">;

describe("chassis cutouts", () => {
  it("no cutouts = the plain box; a front slot leaves a U-shaped union of boxes with the right area", () => {
    expect(chassisRects({ length: 15, width: 15 })).toEqual([{ cx: 0, cy: 0, w: 15, h: 15 }]);
    const rs = chassisRects({ length: 15, width: 15, cutouts: [{ x: 0, y: 6.5, w: 6, h: 2 }] });
    expect(rs.reduce((a, r) => a + r.w * r.h, 0)).toBeCloseTo(225 - 12, 6);
    expect(rs.length).toBeGreaterThan(1);
  });
  it("a Goal-sized slot lets the robot drive a Goal-sized obstacle into the notch", () => {
    const goal = { x: 0, y: 30, w: 5.6, h: 5.6, label: "g" };
    const run = (cutouts: { x: number; y: number; w: number; h: number }[]) => {
      const c = { ...cfg, cutouts };
      const w = createWorld({ ...base, objects: [], obstacles: [goal] }, { x: 0, y: 0, heading: 0 });
      const d = derive(c);
      for (let i = 0; i < 1500; i++) stepWorld(w, c, 0.5, 0.5, 0.005, d);
      return w.robot.y;
    };
    const plain = run([]);
    const notched = run([{ x: 0, y: 6.5, w: 6.2, h: 2 }]);
    expect(notched - plain).toBeGreaterThan(1.5); // gets 2" closer with the notch straddling the obstacle
  });
});

describe("loose-object dynamics", () => {
  it("a hard knock tips a standing Pin over, away from the robot; a gentle one does not", () => {
    const vt = tipSpeed(pin().tip!);
    expect(vt).toBeGreaterThan(8); expect(vt).toBeLessThan(25); // in/s: pins are tippy
    expect(tipSpeed(cup().tip!)).toBeGreaterThan(vt); // a fat Cup is harder to tip than a slim Pin
    const drive = (speed: number) => {
      const w = createWorld({ ...base, objects: [pin()] }, { x: 0, y: -4, heading: 0 });
      w.robot.vy = 0; w.robot.vx = speed;
      const d = derive(cfg);
      for (let i = 0; i < 300; i++) stepWorld(w, cfg, speed / 60, speed / 60, 0.005, d);
      return w.objects[0];
    };
    const hard = drive(80);
    expect(hard.lying).toBe(true);
    expect(Math.abs((hard.angle! + 360) % 360) < 40 || Math.abs((hard.angle! + 360) % 360) > 320).toBe(true); // top end points away (+y)
    expect(drive(3).lying).toBeFalsy();
  });
  it("an off-center hit spins a lying Pin, and it keeps rolling across its axis longer than it slides along it", () => {
    const w = createWorld({ ...base, objects: [pin({ lying: true, half: 2.2, angle: 0, y: 30, x: 0 })] }, { x: 0, y: -50, heading: 0 });
    const o = w.objects[0];
    // a sideways shove near one end
    o.vx = 20; o.w = 0;
    const d = derive(cfg);
    for (let i = 0; i < 200; i++) stepWorld(w, cfg, 0, 0, 0.005, d);
    const rolled = o.x;
    const w2 = createWorld({ ...base, objects: [pin({ lying: true, half: 2.2, angle: 0, y: 30, x: 0 })] }, { x: 0, y: -50, heading: 0 });
    w2.objects[0].vy = 20;
    for (let i = 0; i < 200; i++) stepWorld(w2, cfg, 0, 0, 0.005, d);
    expect(rolled).toBeGreaterThan(w2.objects[0].y - 30 + 3); // rolls farther than it slides
  });
  it("hitting a lying Pin's end with a wall or another body gives it angular velocity", () => {
    const w = createWorld({ ...base, objects: [pin({ lying: true, half: 2.2, angle: 0, x: 0, y: 30 }), cup({ id: 3, x: 3, y: 33.8, lying: true, half: 1.675, angle: 90 })] }, { x: 0, y: -50, heading: 0 });
    w.objects[1].vx = -30;
    const d = derive(cfg);
    let spun = false;
    for (let i = 0; i < 100; i++) { stepWorld(w, cfg, 0, 0, 0.005, d); if (Math.abs(w.objects[0].w ?? 0) > 0.5) spun = true; }
    expect(spun).toBe(true);
  });
  it("a tipped Cup throws out the Pin standing in it", () => {
    const c = cup({ id: 2 });
    const p = pin({ id: 1, x: 0, y: 12, nestedIn: 2 });
    const w = createWorld({ ...base, objects: [c, p] }, { x: 0, y: -4, heading: 0 });
    w.robot.vx = 0; w.robot.vy = 0;
    const d = derive(cfg);
    for (let i = 0; i < 400; i++) stepWorld(w, cfg, 1, 1, 0.005, d);
    expect(w.objects[0].lying).toBe(true);
    expect(w.objects[1].state).toBe("field");
  });
});

describe("front and rear pickup, scoring side", () => {
  const rear = { ...cfg, intake: null, rearIntake: { reach: 4, width: 10, capacity: 4, standingOnly: true } };
  const front = { ...cfg, intake: { reach: 4, width: 12, capacity: 4 }, rearIntake: null };
  const at = (c: typeof cfg, o: Partial<GameObject>) => {
    const w = createWorld({ ...base, objects: [pin({ x: 0, y: -11, ...o })] }, { x: 0, y: 0, heading: 0 }); // 3.5" behind the tail
    w.mech.rear = 1; w.mech.intake = 1;
    for (let i = 0; i < 20; i++) stepWorld(w, c, 0, 0, 0.005);
    return w.objects[0].state;
  };
  it("the rear takes a standing pin but not one lying on its side; the front takes either", () => {
    expect(at(rear, {})).toBe("held");
    expect(at(rear, { lying: true, half: 2.2, angle: 90 })).toBe("field");
    const fr = (o: Partial<GameObject>) => { const w = createWorld({ ...base, objects: [pin({ y: 11, ...o })] }, { x: 0, y: 0, heading: 0 }); w.mech.intake = 1; for (let i = 0; i < 20; i++) stepWorld(w, front, 0, 0, 0.005); return w.objects[0].state; };
    expect(fr({})).toBe("held");
    expect(fr({ lying: true, half: 2.2, angle: 90 })).toBe("held");
  });
});
