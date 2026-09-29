import { derive, IN, type DerivedRobot, type RobotConfig } from "./robot";
import { defaultEnv, initialState, step as stepRobot, type Environment, type SimState } from "./physics";
import { aabb, closestOnObb, corners, forwardOf, obbContact, RAD, rightOf, type Obb, type Vec } from "./geometry";

export type Team = "red" | "blue" | "neutral";
export type ObjectState = "field" | "held" | "carried";

export interface GameObject {
  id: number;
  kind: string;
  team: Team;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number; // radius, in
  mass: number; // kg
  /** Sliding deceleration, in/s^2 */
  drag: number;
  state: ObjectState;
  /** When carried: offset from robot center in robot frame (forward, right), inches */
  carry?: { f: number; r: number };
  /** Can be clamped/carried by the robot (mobile goals) */
  carriable?: boolean;
  /** Fixed in place (stakes etc.) - never moves */
  fixed?: boolean;
}

export interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

export interface MechState {
  /** +1 intake in, -1 outtake, 0 off */
  intake: number;
  clamp: boolean;
}

export interface World {
  t: number;
  robot: SimState;
  objects: GameObject[];
  obstacles: Obstacle[];
  held: number[];
  mech: MechState;
  env: Environment;
  /** Number of wall/obstacle contact events (for "collision" warnings in the UI) */
  contacts: number;
}

export interface WorldInit {
  fieldSize: number;
  objects: Omit<GameObject, "vx" | "vy" | "state">[];
  obstacles: Obstacle[];
}

export function createWorld(init: WorldInit, start: { x: number; y: number; heading: number }): World {
  return {
    t: 0,
    robot: initialState(start.x, start.y, start.heading),
    objects: init.objects.map((o) => ({ ...o, vx: 0, vy: 0, state: "field" as const })),
    obstacles: init.obstacles.map((o) => ({ ...o })),
    held: [],
    mech: { intake: 0, clamp: false },
    env: { ...defaultEnv, fieldSize: init.fieldSize },
    contacts: 0,
  };
}

export function robotObb(s: SimState, cfg: RobotConfig): Obb {
  return { x: s.x, y: s.y, heading: s.heading, hl: cfg.length / 2, hw: cfg.width / 2 };
}

const E_WALL = 0.08;
const MU_WALL = 0.45;

interface Body {
  vx: number; // world in/s
  vy: number;
  wz: number; // rad/s, counter-clockwise +
}

function robotBody(s: SimState): Body {
  const t = s.heading * RAD;
  return {
    vx: s.vx * Math.sin(t) + s.vy * Math.cos(t),
    vy: s.vx * Math.cos(t) - s.vy * Math.sin(t),
    wz: -s.w * RAD,
  };
}

function writeBody(s: SimState, b: Body): SimState {
  const t = s.heading * RAD;
  return {
    ...s,
    vx: b.vx * Math.sin(t) + b.vy * Math.cos(t),
    vy: b.vx * Math.cos(t) - b.vy * Math.sin(t),
    w: -b.wz / RAD,
  };
}

/** Impulse contact between the robot and a static surface. n points from the surface toward the robot. */
function staticContact(s: SimState, cfg: RobotConfig, d: DerivedRobot, px: number, py: number, nx: number, ny: number, depth: number): SimState {
  const b = robotBody(s);
  const m = cfg.mass;
  const I = d.inertia;
  // work in meters
  const rx = (px - s.x) * IN, ry = (py - s.y) * IN;
  const vcx = b.vx * IN - b.wz * ry;
  const vcy = b.vy * IN + b.wz * rx;
  const vn = vcx * nx + vcy * ny;
  let out = s;
  if (vn < 0) {
    const rn = rx * ny - ry * nx;
    const j = (-(1 + E_WALL) * vn) / (1 / m + (rn * rn) / I);
    b.vx += (j * nx) / m / IN;
    b.vy += (j * ny) / m / IN;
    b.wz += (j * rn) / I;
    // friction
    const tx = -ny, ty = nx;
    const vcx2 = b.vx * IN - b.wz * ry;
    const vcy2 = b.vy * IN + b.wz * rx;
    const vt = vcx2 * tx + vcy2 * ty;
    const rt = rx * ty - ry * tx;
    let jt = -vt / (1 / m + (rt * rt) / I);
    jt = Math.max(-MU_WALL * j, Math.min(MU_WALL * j, jt));
    b.vx += (jt * tx) / m / IN;
    b.vy += (jt * ty) / m / IN;
    b.wz += (jt * rt) / I;
    out = writeBody(s, b);
  }
  // positional correction
  return { ...out, x: out.x + nx * depth * 0.9, y: out.y + ny * depth * 0.9 };
}

function resolveRobotStatics(w: World, cfg: RobotConfig, d: DerivedRobot): void {
  const half = w.env.fieldSize / 2;
  for (let iter = 0; iter < 3; iter++) {
    for (const c of corners(robotObb(w.robot, cfg))) {
      if (c.x > half) { w.robot = staticContact(w.robot, cfg, d, c.x, c.y, -1, 0, c.x - half); w.contacts++; }
      if (c.x < -half) { w.robot = staticContact(w.robot, cfg, d, c.x, c.y, 1, 0, -half - c.x); w.contacts++; }
      if (c.y > half) { w.robot = staticContact(w.robot, cfg, d, c.x, c.y, 0, -1, c.y - half); w.contacts++; }
      if (c.y < -half) { w.robot = staticContact(w.robot, cfg, d, c.x, c.y, 0, 1, -half - c.y); w.contacts++; }
    }
    for (const o of w.obstacles) {
      const m = obbContact(robotObb(w.robot, cfg), aabb(o.x, o.y, o.w, o.h));
      if (m) { w.robot = staticContact(w.robot, cfg, d, m.px, m.py, m.nx, m.ny, m.depth); w.contacts++; }
    }
  }
}

function resolveObjects(w: World, cfg: RobotConfig, d: DerivedRobot, dt: number): void {
  const half = w.env.fieldSize / 2;
  const robot = robotObb(w.robot, cfg);
  for (const o of w.objects) {
    if (o.state !== "field" || o.fixed) continue;
    // sliding friction
    const sp = Math.hypot(o.vx, o.vy);
    if (sp > 0) {
      const ns = Math.max(0, sp - o.drag * dt);
      o.vx *= ns / sp;
      o.vy *= ns / sp;
    }
    o.x += o.vx * dt;
    o.y += o.vy * dt;
    // walls
    if (o.x + o.r > half) { o.x = half - o.r; o.vx = -Math.abs(o.vx) * 0.3; }
    if (o.x - o.r < -half) { o.x = -half + o.r; o.vx = Math.abs(o.vx) * 0.3; }
    if (o.y + o.r > half) { o.y = half - o.r; o.vy = -Math.abs(o.vy) * 0.3; }
    if (o.y - o.r < -half) { o.y = -half + o.r; o.vy = Math.abs(o.vy) * 0.3; }
    // static obstacles
    for (const ob of w.obstacles) {
      const box = aabb(ob.x, ob.y, ob.w, ob.h);
      const cp = closestOnObb(box, o.x, o.y);
      let dx = o.x - cp.x, dy = o.y - cp.y;
      const dist = Math.hypot(dx, dy);
      if (cp.inside || dist < o.r) {
        if (cp.inside || dist < 1e-6) {
          // push out through the nearest face
          const px = ob.w / 2 - Math.abs(o.x - ob.x), py = ob.h / 2 - Math.abs(o.y - ob.y);
          if (px < py) { dx = Math.sign(o.x - ob.x) || 1; dy = 0; o.x = ob.x + dx * (ob.w / 2 + o.r); }
          else { dx = 0; dy = Math.sign(o.y - ob.y) || 1; o.y = ob.y + dy * (ob.h / 2 + o.r); }
        } else {
          dx /= dist; dy /= dist;
          o.x = cp.x + dx * o.r; o.y = cp.y + dy * o.r;
        }
        const vn = o.vx * dx + o.vy * dy;
        if (vn < 0) { o.vx -= (1.3) * vn * dx; o.vy -= (1.3) * vn * dy; }
      }
    }
    // robot vs object (two-body impulse; the object is a point mass with no spin)
    const cp = closestOnObb(robot, o.x, o.y);
    let nx = o.x - cp.x, ny = o.y - cp.y;
    let dist = Math.hypot(nx, ny);
    if (cp.inside || dist < o.r) {
      if (cp.inside || dist < 1e-6) {
        const f = forwardOf(robot.heading), r = rightOf(robot.heading);
        const lf = (o.x - robot.x) * f.x + (o.y - robot.y) * f.y;
        const lr = (o.x - robot.x) * r.x + (o.y - robot.y) * r.y;
        if (robot.hl - Math.abs(lf) < robot.hw - Math.abs(lr)) { const sg = Math.sign(lf) || 1; nx = f.x * sg; ny = f.y * sg; }
        else { const sg = Math.sign(lr) || 1; nx = r.x * sg; ny = r.y * sg; }
        dist = 0;
        o.x = cp.x + nx * o.r; o.y = cp.y + ny * o.r;
      } else {
        nx /= dist; ny /= dist;
        o.x = cp.x + nx * o.r; o.y = cp.y + ny * o.r;
      }
      resolveRobotObject(w, cfg, d, o, cp.x, cp.y, nx, ny);
    }
  }
  // object-object
  const n = w.objects.length;
  for (let i = 0; i < n; i++) {
    const a = w.objects[i];
    if (a.state !== "field") continue;
    for (let j = i + 1; j < n; j++) {
      const b = w.objects[j];
      if (b.state !== "field") continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const rr = a.r + b.r;
      if (Math.abs(dx) > rr || Math.abs(dy) > rr) continue;
      const dist = Math.hypot(dx, dy);
      if (dist >= rr || dist < 1e-9) continue;
      const nx = dx / dist, ny = dy / dist;
      const overlap = rr - dist;
      const ia = a.fixed ? 0 : 1 / a.mass, ib = b.fixed ? 0 : 1 / b.mass;
      const tot = ia + ib;
      if (tot === 0) continue;
      a.x -= nx * overlap * (ia / tot); a.y -= ny * overlap * (ia / tot);
      b.x += nx * overlap * (ib / tot); b.y += ny * overlap * (ib / tot);
      const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (vn < 0) {
        const jn = (-(1 + 0.2) * vn) / tot;
        a.vx -= jn * ia * nx; a.vy -= jn * ia * ny;
        b.vx += jn * ib * nx; b.vy += jn * ib * ny;
      }
    }
  }
}

/** n points from the robot toward the object. */
function resolveRobotObject(w: World, cfg: RobotConfig, d: DerivedRobot, o: GameObject, cx: number, cy: number, nx: number, ny: number): void {
  const b = robotBody(w.robot);
  const m = cfg.mass;
  const I = d.inertia;
  const rx = (cx - w.robot.x) * IN, ry = (cy - w.robot.y) * IN;
  // robot contact-point velocity, m/s
  const vrx = b.vx * IN - b.wz * ry;
  const vry = b.vy * IN + b.wz * rx;
  const vox = o.vx * IN, voy = o.vy * IN;
  const vn = (vox - vrx) * nx + (voy - vry) * ny; // object relative to robot along n
  if (vn >= 0) return; // separating
  const rn = rx * ny - ry * nx;
  const mo = o.fixed ? 1e9 : o.mass;
  const invSum = 1 / m + (rn * rn) / I + 1 / mo;
  const j = (-(1 + 0.15) * vn) / invSum;
  // object gets +j n, robot gets -j n
  o.vx += ((j * nx) / mo) / IN;
  o.vy += ((j * ny) / mo) / IN;
  b.vx -= (j * nx) / m / IN;
  b.vy -= (j * ny) / m / IN;
  b.wz -= (j * rn) / I;
  w.robot = writeBody(w.robot, b);
}

function updateMechanisms(w: World, cfg: RobotConfig): void {
  const s = w.robot;
  const f = forwardOf(s.heading), r = rightOf(s.heading);
  // carried objects follow the robot rigidly
  for (const o of w.objects) {
    if (o.state === "carried" && o.carry) {
      o.x = s.x + f.x * o.carry.f + r.x * o.carry.r;
      o.y = s.y + f.y * o.carry.f + r.y * o.carry.r;
      o.vx = 0; o.vy = 0;
    }
  }
  // intake capture zone
  if (w.mech.intake > 0 && cfg.intake) {
    const zone: Obb = {
      x: s.x + f.x * (cfg.length / 2 + cfg.intake.reach / 2),
      y: s.y + f.y * (cfg.length / 2 + cfg.intake.reach / 2),
      heading: s.heading,
      hl: cfg.intake.reach / 2,
      hw: cfg.intake.width / 2,
    };
    for (const o of w.objects) {
      if (w.held.length >= cfg.intake.capacity) break;
      if (o.state !== "field" || o.carriable || o.fixed) continue;
      if (closestOnObb(zone, o.x, o.y).inside) {
        o.state = "held";
        w.held.push(o.id);
      }
    }
  }
  if (w.mech.intake < 0 && cfg.intake) ejectHeld(w, cfg, 1);
}

/** Release up to `count` held objects out the front of the robot. */
export function ejectHeld(w: World, cfg: RobotConfig, count = 1): void {
  const s = w.robot;
  const f = forwardOf(s.heading);
  for (let i = 0; i < count && w.held.length > 0; i++) {
    const id = w.held.shift()!;
    const o = w.objects.find((q) => q.id === id);
    if (!o) continue;
    const dist = cfg.length / 2 + o.r + 1;
    o.state = "field";
    o.x = s.x + f.x * dist;
    o.y = s.y + f.y * dist;
    const spd = 25;
    const t = s.heading * RAD;
    o.vx = s.vx * Math.sin(t) + s.vy * Math.cos(t) + f.x * spd;
    o.vy = s.vx * Math.cos(t) - s.vy * Math.sin(t) + f.y * spd;
  }
}

/** Clamp/unclamp: on clamp, grab the nearest carriable object whose center is within reach of the front. */
export function setClamp(w: World, cfg: RobotConfig, on: boolean): void {
  if (on === w.mech.clamp) return;
  w.mech.clamp = on;
  const s = w.robot;
  const f = forwardOf(s.heading), r = rightOf(s.heading);
  if (on) {
    let best: GameObject | null = null;
    let bestD = Infinity;
    const reach: Vec = { x: s.x + f.x * (cfg.length / 2 + 2), y: s.y + f.y * (cfg.length / 2 + 2) };
    for (const o of w.objects) {
      if (!o.carriable || o.state !== "field") continue;
      const dd = Math.hypot(o.x - reach.x, o.y - reach.y);
      if (dd < o.r + 6 && dd < bestD) { best = o; bestD = dd; }
    }
    if (best) {
      best.state = "carried";
      const dx = best.x - s.x, dy = best.y - s.y;
      best.carry = { f: dx * f.x + dy * f.y, r: dx * r.x + dy * r.y };
    }
  } else {
    for (const o of w.objects) if (o.state === "carried") { o.state = "field"; o.carry = undefined; }
  }
}

/** Advance the whole world by dt with commanded drive outputs in [-1, 1]. */
export function stepWorld(
  w: World,
  cfg: RobotConfig,
  left: number,
  right: number,
  dt: number,
  d: DerivedRobot = derive(cfg),
  hold: { left?: boolean; right?: boolean } = {},
): void {
  w.robot = stepRobot(w.robot, cfg, left, right, dt, w.env, d, hold);
  resolveRobotStatics(w, cfg, d);
  resolveObjects(w, cfg, d, dt);
  updateMechanisms(w, cfg);
  w.t += dt;
}
