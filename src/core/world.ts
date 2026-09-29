import { chassisRects, derive, IN, scoreSpecOf, zoneTakes, type DerivedRobot, type RobotConfig } from "./robot";
import { defaultEnv, initialState, step as stepRobot, type Environment, type SimState } from "./physics";
import { closestOnObb, closestOnPoly, corners, forwardOf, polyContact, rectVerts, RAD, rightOf, type Obb, type Vec } from "./geometry";

export type Team = "red" | "blue" | "neutral";
export type ObjectState = "field" | "held" | "carried" | "stacked" | "nested";

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
  /** Two-colored objects (Override Pins): colors of the two halves */
  halves?: [string, string];
  /** Which half sits in the lower socket when placed: false = halves[0] */
  flip?: boolean;
  /** Override Cups: the opaque half is the upper socket */
  opaqueUp?: boolean;
  /** Starts the match held by the robot (a Preload) */
  held?: boolean;
  /** Starts the match already Placed in this goal (bottom to top, in object order) */
  stackedIn?: string;
  /** A Pin standing nested inside this Cup (by id): rides with the Cup and is picked up with it */
  nestedIn?: number;
  /** Drawn orientation, degrees (0 = +y, clockwise): for a lying Pin, the direction its halves[0] end points */
  angle?: number;
  /** Lying on its side: collides as a capsule (a spine of half-length `half` swept by radius `r`) and is drawn lengthwise */
  lying?: boolean;
  half?: number;
  /** Angular velocity while lying, rad/s (counter-clockwise +) */
  w?: number;
  /** Shape of the upright object: it tips over (and then lies as a capsule) when knocked hard enough. Undefined = never tips. */
  tip?: { height: number; baseR: number; half: number; lyingR: number };
}

export interface Obstacle {
  /** Route planning only: keep the robot's center at least this far away (default: the planner's clearance) */
  keepOut?: number;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  /** Convex polygon (CCW or CW). When present it replaces the x/y/w/h rectangle for collisions. */
  verts?: Vec[];
  /** e.g. "goal:tall-0", "loader", "toggle" - lets rule checks tell obstacles apart */
  tag?: string;
}

export function obstaclePoly(o: Obstacle): Vec[] {
  return o.verts ?? rectVerts(o.x, o.y, o.w, o.h);
}

export interface StackItem {
  id: number;
  kind: string;
  halves?: [string, string];
  opaqueUp?: boolean;
  /** For pins: which half sits lower in the stack */
  flip?: boolean;
}

/** A receptacle that objects can be nested into and stacked on (Override Goals). */
export interface GoalState {
  id: string;
  x: number;
  y: number;
  /** game-specific type, e.g. "tall" | "short" | "alliance" */
  kind: string;
  alliance?: "red" | "blue";
  /** Height of the goal rim, in */
  height: number;
  /** Placement reach: how close the robot's front must be to place onto it, in */
  reach: number;
  stack: StackItem[];
}

export interface ToggleState {
  id: string;
  x: number;
  y: number;
  wall: "N" | "E" | "S" | "W";
  state: "yellow" | "red" | "blue";
}

export interface WorldEvent {
  t: number;
  type: "place" | "toggle" | "pickup" | "reject" | "tip" | "hit";
  id?: number;
  goal?: string;
  toggle?: string;
  color?: string;
  x?: number;
  y?: number;
  text?: string;
}

/** Game-specific rules the generic engine calls into. */
export interface GameRules {
  /** Can `item` be added on top of this goal's current stack? */
  canStack(goal: GoalState, item: GameObject): boolean;
  /** Max held objects per kind (Override: 1 pin + 1 cup). Kinds not listed are unlimited. */
  possession?: Record<string, number>;
}

export interface MechState {
  /** +1 intake in, -1 outtake, 0 off */
  intake: number;
  /** rear intake: +1 on, 0 off */
  rear: number;
  clamp: boolean;
}

export interface World {
  t: number;
  robot: SimState;
  objects: GameObject[];
  obstacles: Obstacle[];
  goals: GoalState[];
  toggles: ToggleState[];
  events: WorldEvent[];
  rules?: GameRules;
  alliance: "red" | "blue";
  /** Half extents of the robot footprint (for scoring / rule checks) */
  robotBox: { hl: number; hw: number };
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
  goals?: Omit<GoalState, "stack">[];
  toggles?: ToggleState[];
  rules?: GameRules;
}

export function createWorld(init: WorldInit, start: { x: number; y: number; heading: number }): World {
  const objects = init.objects.map((o) => ({
    ...o, vx: 0, vy: 0,
    state: o.held ? ("held" as const) : o.stackedIn ? ("stacked" as const) : o.nestedIn !== undefined ? ("nested" as const) : ("field" as const),
  }));
  const goals = (init.goals ?? []).map((g) => ({ ...g, stack: [] as StackItem[] }));
  for (const o of objects) {
    if (!o.stackedIn) continue;
    const g = goals.find((q) => q.id === o.stackedIn);
    if (g) { g.stack.push({ id: o.id, kind: o.kind, halves: o.halves, opaqueUp: o.opaqueUp, flip: o.flip }); o.x = g.x; o.y = g.y; }
  }
  return {
    t: 0,
    robot: initialState(start.x, start.y, start.heading),
    objects,
    obstacles: init.obstacles.map((o) => ({ ...o })),
    goals,
    toggles: (init.toggles ?? []).map((t) => ({ ...t })),
    events: [],
    rules: init.rules,
    alliance: "red",
    robotBox: { hl: 7.5, hw: 7.5 },
    held: objects.filter((o) => o.held).map((o) => o.id),
    mech: { intake: 0, rear: 0, clamp: false },
    env: { ...defaultEnv, fieldSize: init.fieldSize },
    contacts: 0,
  };
}

/** Point on a lying object's spine nearest to (x, y); a standing object's spine is its center. */
export function spinePoint(o: Pick<GameObject, "x" | "y" | "lying" | "half" | "angle">, x: number, y: number): Vec {
  if (!o.lying || !o.half) return { x: o.x, y: o.y };
  const a = (o.angle ?? 0) * RAD;
  const dx = Math.sin(a), dy = Math.cos(a);
  const t = Math.max(-o.half, Math.min(o.half, (x - o.x) * dx + (y - o.y) * dy));
  return { x: o.x + dx * t, y: o.y + dy * t };
}

/** Half extents of an object along x / y (for wall contact). */
function extents(o: GameObject): { ex: number; ey: number } {
  if (!o.lying || !o.half) return { ex: o.r, ey: o.r };
  const a = (o.angle ?? 0) * RAD;
  return { ex: Math.abs(Math.sin(a)) * o.half + o.r, ey: Math.abs(Math.cos(a)) * o.half + o.r };
}

/** The chassis as convex boxes in world space (one box unless the robot has cutouts). */
export function robotPieces(s: SimState, cfg: RobotConfig): Obb[] {
  const f = forwardOf(s.heading), r = rightOf(s.heading);
  return chassisRects(cfg).map((c) => ({ x: s.x + f.x * c.cy + r.x * c.cx, y: s.y + f.y * c.cy + r.y * c.cx, heading: s.heading, hl: c.h / 2, hw: c.w / 2 }));
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

function noteReject(w: World, key: string, text: string): void {
  let m = lastHit.get(w);
  if (!m) { m = new Map(); lastHit.set(w, m); }
  const t0 = m.get(key);
  if (t0 !== undefined && w.t - t0 < 1.5) return;
  m.set(key, w.t);
  w.events.push({ t: w.t, type: "reject", text });
}

const lastHit = new WeakMap<object, Map<string, number>>();
/** Log the robot running into something (once per 0.4 s per thing) so routes can be checked and repaired. */
function noteHit(w: World, key: string, label: string, x: number, y: number, id?: number): void {
  let m = lastHit.get(w);
  if (!m) { m = new Map(); lastHit.set(w, m); }
  const t0 = m.get(key);
  if (t0 !== undefined && w.t - t0 < 0.4) return;
  m.set(key, w.t);
  w.events.push({ t: w.t, type: "hit", text: label, id, x, y });
}

function resolveRobotStatics(w: World, cfg: RobotConfig, d: DerivedRobot): void {
  const half = w.env.fieldSize / 2;
  for (let iter = 0; iter < 3; iter++) {
    const pieces = robotPieces(w.robot, cfg);
    for (const c of pieces.flatMap(corners)) {
      if (c.x > half) { w.robot = staticContact(w.robot, cfg, d, c.x, c.y, -1, 0, c.x - half); w.contacts++; }
      if (c.x < -half) { w.robot = staticContact(w.robot, cfg, d, c.x, c.y, 1, 0, -half - c.x); w.contacts++; }
      if (c.y > half) { w.robot = staticContact(w.robot, cfg, d, c.x, c.y, 0, -1, c.y - half); w.contacts++; }
      if (c.y < -half) { w.robot = staticContact(w.robot, cfg, d, c.x, c.y, 0, 1, -half - c.y); w.contacts++; }
    }
    for (const o of w.obstacles) {
      for (const pc of robotPieces(w.robot, cfg)) {
        const m = polyContact(corners(pc), obstaclePoly(o));
        if (m) { w.robot = staticContact(w.robot, cfg, d, m.px, m.py, m.nx, m.ny, m.depth); w.contacts++; if (m.depth > 0.05) noteHit(w, `o:${o.label}`, o.label, m.px, m.py); }
      }
    }
  }
}

// ---- loose-object rigid-body dynamics -------------------------------------------------------------------------------
/** Height (in) at which a robot's intake/bumper meets an upright object; sets how hard a knock tips it. */
const CONTACT_HEIGHT = 2.5;
const SLIDE_DECEL = 30; // in/s^2 dragging along a lying object's axis (sliding)
const ROLL_DECEL = 4; // in/s^2 across its axis (rolling)
const SPIN_DECEL = 5; // rad/s^2 of yaw friction on a lying object

/** Speed (in/s) of a horizontal knock at CONTACT_HEIGHT that tips an upright object of this shape over its base edge. */
export function tipSpeed(t: NonNullable<GameObject["tip"]>): number {
  const H = t.height * IN, r = t.baseR * IN, hc = CONTACT_HEIGHT * IN;
  const dh = Math.hypot(H / 2, r) - H / 2;
  const i = (3 * r * r + H * H) / 12 + r * r + (H / 2) * (H / 2); // about the base edge, per unit mass
  return (Math.sqrt(2 * 9.81 * dh * i) / hc) / IN;
}

function inertiaLying(o: GameObject): number {
  // kg*in^2: a rod of the full length plus a little for its width
  const len = 2 * ((o.half ?? 0) + o.r);
  return o.mass * (len * len / 12 + (o.r * o.r) / 4);
}

/** Tip an upright object over, away from (dx, dy). Anything standing inside a Cup is thrown out with it. */
function tipOver(w: World, o: GameObject, dx: number, dy: number): void {
  if (!o.tip || o.lying || o.state !== "field") return;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const shift = Math.max(0, o.tip.height / 2 - o.tip.baseR);
  o.x += ux * shift; o.y += uy * shift;
  o.lying = true;
  o.half = o.tip.half;
  o.r = o.tip.lyingR;
  // the top end falls away from the push; a flipped Pin has its halves[0] end up
  const ang = (Math.atan2(ux, uy) / RAD) + (o.flip ? 180 : 0);
  o.angle = ang;
  o.w = 0;
  w.events.push({ t: w.t, type: "tip", id: o.id });
  for (const q of w.objects) {
    if (q.nestedIn !== o.id || q.state !== "nested") continue;
    q.state = "field"; q.nestedIn = undefined;
    q.x = o.x + ux * (o.tip.height / 2 + 1); q.y = o.y + uy * (o.tip.height / 2 + 1);
    q.vx = o.vx; q.vy = o.vy;
    if (q.tip) { q.lying = true; q.half = q.tip.half; q.r = q.tip.lyingR; q.angle = ang + (q.flip ? 180 : 0) + 0; q.w = 0; }
  }
}

/** Impulse between a loose object and something immovable at contact point (px, py); n points from the surface toward the object. */
function staticImpulse(o: GameObject, px: number, py: number, nx: number, ny: number, e: number): void {
  const rx = px - o.x, ry = py - o.y;
  const w = o.lying ? o.w ?? 0 : 0;
  const vn = (o.vx - w * ry) * nx + (o.vy + w * rx) * ny;
  if (vn >= 0) return;
  const rn = rx * ny - ry * nx;
  const invI = o.lying ? 1 / inertiaLying(o) : 0;
  const j = (-(1 + e) * vn) / (1 / o.mass + rn * rn * invI);
  o.vx += (j * nx) / o.mass; o.vy += (j * ny) / o.mass;
  if (o.lying) o.w = w + j * rn * invI;
}

function resolveObjects(w: World, cfg: RobotConfig, d: DerivedRobot, dt: number): void {
  const half = w.env.fieldSize / 2;
  const pieces = robotPieces(w.robot, cfg);
  for (const o of w.objects) {
    if (o.state !== "field" || o.fixed) continue;
    // ground friction: a lying object slides along its axis and rolls across it; a standing one just slides
    if (o.lying) {
      const a = (o.angle ?? 0) * RAD, ax = Math.sin(a), ay = Math.cos(a);
      let vpar = o.vx * ax + o.vy * ay, vperp = o.vx * ay - o.vy * ax;
      vpar = Math.sign(vpar) * Math.max(0, Math.abs(vpar) - SLIDE_DECEL * dt);
      vperp = Math.sign(vperp) * Math.max(0, Math.abs(vperp) - ROLL_DECEL * dt);
      o.vx = vpar * ax + vperp * ay; o.vy = vpar * ay - vperp * ax;
      const wz = o.w ?? 0;
      o.w = Math.sign(wz) * Math.max(0, Math.abs(wz) - SPIN_DECEL * dt);
      o.angle = (o.angle ?? 0) - ((o.w ?? 0) * dt) / RAD; // w is counter-clockwise; heading is clockwise
    } else {
      const sp = Math.hypot(o.vx, o.vy);
      if (sp > 0) {
        const ns = Math.max(0, sp - o.drag * dt);
        o.vx *= ns / sp;
        o.vy *= ns / sp;
      }
    }
    o.x += o.vx * dt;
    o.y += o.vy * dt;
    // walls: contact at the end of the body that reaches furthest
    const { ex, ey } = extents(o);
    const spineDir = { x: Math.sin((o.angle ?? 0) * RAD), y: Math.cos((o.angle ?? 0) * RAD) };
    const endToward = (sx: number, sy: number) => {
      if (!o.lying || !o.half) return { x: o.x, y: o.y };
      const t = (spineDir.x * sx + spineDir.y * sy) >= 0 ? 1 : -1;
      return { x: o.x + spineDir.x * o.half * t, y: o.y + spineDir.y * o.half * t };
    };
    if (o.x + ex > half) { const e = endToward(1, 0); o.x = half - ex; staticImpulse(o, e.x + o.r, e.y, -1, 0, 0.3); }
    if (o.x - ex < -half) { const e = endToward(-1, 0); o.x = -half + ex; staticImpulse(o, e.x - o.r, e.y, 1, 0, 0.3); }
    if (o.y + ey > half) { const e = endToward(0, 1); o.y = half - ey; staticImpulse(o, e.x, e.y + o.r, 0, -1, 0.3); }
    if (o.y - ey < -half) { const e = endToward(0, -1); o.y = -half + ey; staticImpulse(o, e.x, e.y - o.r, 0, 1, 0.3); }
    // static obstacles (any convex polygon). A lying object is tested at the spine point nearest the obstacle.
    for (const ob of w.obstacles) {
      const poly = obstaclePoly(ob);
      let ref = spinePoint(o, o.x, o.y);
      if (o.lying) { const c0 = closestOnPoly(poly, ref.x, ref.y); ref = spinePoint(o, c0.x, c0.y); }
      const cp = closestOnPoly(poly, ref.x, ref.y);
      let dx = ref.x - cp.x, dy = ref.y - cp.y;
      const dist = Math.hypot(dx, dy);
      if (cp.inside || dist < o.r) {
        let px = ref.x, py = ref.y;
        if (cp.inside || dist < 1e-6) {
          // centre is inside: push out through the nearest edge
          let bestD = Infinity, bn = { x: 1, y: 0 }, bp = { x: ref.x, y: ref.y };
          const ctr = poly.reduce((acc, q) => ({ x: acc.x + q.x / poly.length, y: acc.y + q.y / poly.length }), { x: 0, y: 0 });
          for (let k = 0; k < poly.length; k++) {
            const a = poly[k], b = poly[(k + 1) % poly.length];
            const ex2 = b.x - a.x, ey2 = b.y - a.y;
            const len = Math.hypot(ex2, ey2) || 1;
            let nx = ey2 / len, ny = -ex2 / len;
            const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            if ((c.x - ctr.x) * nx + (c.y - ctr.y) * ny < 0) { nx = -nx; ny = -ny; }
            const dd = Math.abs((ref.x - a.x) * nx + (ref.y - a.y) * ny);
            if (dd < bestD) { bestD = dd; bn = { x: nx, y: ny }; bp = { x: ref.x + nx * dd, y: ref.y + ny * dd }; }
          }
          dx = bn.x; dy = bn.y;
          px = bp.x + dx * o.r; py = bp.y + dy * o.r;
        } else {
          dx /= dist; dy /= dist;
          px = cp.x + dx * o.r; py = cp.y + dy * o.r;
        }
        o.x += px - ref.x; o.y += py - ref.y;
        const speed = -(o.vx * dx + o.vy * dy);
        staticImpulse(o, cp.x, cp.y, dx, dy, 0.3);
        if (o.tip && !o.lying && speed > tipSpeed(o.tip) * 1.5) tipOver(w, o, -dx, -dy);
      }
    }
    // robot vs object: every chassis piece (a notched chassis can straddle a Goal or hold a Pin in its slot)
    for (const piece of pieces) {
      let ref = spinePoint(o, piece.x, piece.y);
      if (o.lying) { const c0 = closestOnObb(piece, ref.x, ref.y); ref = spinePoint(o, c0.x, c0.y); }
      const cp = closestOnObb(piece, ref.x, ref.y);
      let nx = ref.x - cp.x, ny = ref.y - cp.y;
      const dist = Math.hypot(nx, ny);
      if (!(cp.inside || dist < o.r)) continue;
      let px: number, py: number;
      if (cp.inside || dist < 1e-6) {
        const f = forwardOf(piece.heading), r = rightOf(piece.heading);
        const lf = (ref.x - piece.x) * f.x + (ref.y - piece.y) * f.y;
        const lr = (ref.x - piece.x) * r.x + (ref.y - piece.y) * r.y;
        if (piece.hl - Math.abs(lf) < piece.hw - Math.abs(lr)) { const sg = Math.sign(lf) || 1; nx = f.x * sg; ny = f.y * sg; }
        else { const sg = Math.sign(lr) || 1; nx = r.x * sg; ny = r.y * sg; }
        px = cp.x + nx * o.r; py = cp.y + ny * o.r;
      } else {
        nx /= dist; ny /= dist;
        px = cp.x + nx * o.r; py = cp.y + ny * o.r;
      }
      o.x += px - ref.x; o.y += py - ref.y;
      resolveRobotObject(w, cfg, d, o, cp.x, cp.y, nx, ny);
    }
  }
  // object-object (lying objects collide along their spine)
  const n = w.objects.length;
  for (let i = 0; i < n; i++) {
    const a = w.objects[i];
    if (a.state !== "field") continue;
    for (let j = i + 1; j < n; j++) {
      const b = w.objects[j];
      if (b.state !== "field") continue;
      const reach = a.r + b.r + (a.lying ? a.half ?? 0 : 0) + (b.lying ? b.half ?? 0 : 0);
      if (Math.abs(b.x - a.x) > reach || Math.abs(b.y - a.y) > reach) continue;
      let pa = spinePoint(a, b.x, b.y), pb = spinePoint(b, pa.x, pa.y);
      pa = spinePoint(a, pb.x, pb.y); pb = spinePoint(b, pa.x, pa.y);
      const dx = pb.x - pa.x, dy = pb.y - pa.y;
      const rr = a.r + b.r;
      const dist = Math.hypot(dx, dy);
      if (dist >= rr || dist < 1e-9) continue;
      const nx = dx / dist, ny = dy / dist;
      const overlap = rr - dist;
      const ia = a.fixed ? 0 : 1 / a.mass, ib = b.fixed ? 0 : 1 / b.mass;
      const tot = ia + ib;
      if (tot === 0) continue;
      a.x -= nx * overlap * (ia / tot); a.y -= ny * overlap * (ia / tot);
      b.x += nx * overlap * (ib / tot); b.y += ny * overlap * (ib / tot);
      // contact impulse with torque on lying bodies (n points from a to b)
      const cx = (pa.x + pb.x) / 2, cy = (pa.y + pb.y) / 2;
      const ra = { x: cx - a.x, y: cy - a.y }, rb = { x: cx - b.x, y: cy - b.y };
      const wa = a.lying ? a.w ?? 0 : 0, wb = b.lying ? b.w ?? 0 : 0;
      const vrel = (b.vx - wb * rb.y - (a.vx - wa * ra.y)) * nx + (b.vy + wb * rb.x - (a.vy + wa * ra.x)) * ny;
      if (vrel < 0) {
        const rna = ra.x * ny - ra.y * nx, rnb = rb.x * ny - rb.y * nx;
        const iIa = a.lying && !a.fixed ? 1 / inertiaLying(a) : 0, iIb = b.lying && !b.fixed ? 1 / inertiaLying(b) : 0;
        const jn = (-(1 + 0.2) * vrel) / (ia + ib + rna * rna * iIa + rnb * rnb * iIb);
        a.vx -= jn * ia * nx; a.vy -= jn * ia * ny; if (a.lying) a.w = wa - jn * rna * iIa;
        b.vx += jn * ib * nx; b.vy += jn * ib * ny; if (b.lying) b.w = wb + jn * rnb * iIb;
        const sp = -vrel;
        if (a.tip && !a.lying && sp > tipSpeed(a.tip) * 1.5) tipOver(w, a, -nx, -ny);
        if (b.tip && !b.lying && sp > tipSpeed(b.tip) * 1.5) tipOver(w, b, nx, ny);
      }
    }
  }
}

/** n points from the robot toward the object; (cx, cy) is the contact point on the chassis. */
function resolveRobotObject(w: World, cfg: RobotConfig, d: DerivedRobot, o: GameObject, cx: number, cy: number, nx: number, ny: number): void {
  const b = robotBody(w.robot);
  const m = cfg.mass;
  const I = d.inertia;
  const rx = (cx - w.robot.x) * IN, ry = (cy - w.robot.y) * IN;
  // robot contact-point velocity, m/s
  const vrx = b.vx * IN - b.wz * ry;
  const vry = b.vy * IN + b.wz * rx;
  const orx = (cx - o.x) * IN, ory = (cy - o.y) * IN;
  const ow = o.lying ? o.w ?? 0 : 0;
  const vox = o.vx * IN - ow * ory, voy = o.vy * IN + ow * orx;
  const vn = (vox - vrx) * nx + (voy - vry) * ny; // object relative to robot along n
  if (vn >= 0) return; // separating
  if (-vn / IN > 8) noteHit(w, `p:${o.id}`, o.kind, cx, cy, o.id);
  const rn = rx * ny - ry * nx;
  const mo = o.fixed ? 1e9 : o.mass;
  const Io = o.lying ? o.mass * (Math.pow(2 * (o.half ?? 0) + 2 * o.r, 2) * IN * IN / 12 + (o.r * o.r * IN * IN) / 4) : Infinity;
  const rno = orx * ny - ory * nx;
  const invSum = 1 / m + (rn * rn) / I + 1 / mo + (o.lying ? (rno * rno) / Io : 0);
  const j = (-(1 + 0.15) * vn) / invSum;
  // object gets +j n, robot gets -j n
  o.vx += ((j * nx) / mo) / IN;
  o.vy += ((j * ny) / mo) / IN;
  if (o.lying) o.w = ow + (j * rno) / Io;
  b.vx -= (j * nx) / m / IN;
  b.vy -= (j * ny) / m / IN;
  b.wz -= (j * rn) / I;
  w.robot = writeBody(w.robot, b);
  if (o.tip && !o.lying && -vn / IN > tipSpeed(o.tip)) tipOver(w, o, nx, ny);
}

function updateMechanisms(w: World, cfg: RobotConfig): void {
  const s = w.robot;
  // Pins standing inside a Cup ride with it
  for (const o of w.objects) {
    if (o.state !== "nested" || o.nestedIn === undefined) continue;
    const cup = w.objects.find((q) => q.id === o.nestedIn);
    if (cup && cup.state === "field") { o.x = cup.x; o.y = cup.y; }
  }
  const f = forwardOf(s.heading), r = rightOf(s.heading);
  // carried objects follow the robot rigidly
  for (const o of w.objects) {
    if (o.state === "carried" && o.carry) {
      o.x = s.x + f.x * o.carry.f + r.x * o.carry.r;
      o.y = s.y + f.y * o.carry.f + r.y * o.carry.r;
      o.vx = 0; o.vy = 0;
    }
  }
  // intake capture zones: front (any orientation unless configured otherwise) and rear (standing objects by default)
  const zones: { on: boolean; spec: NonNullable<RobotConfig["intake"]>; dir: 1 | -1 }[] = [
    { on: w.mech.intake > 0, spec: cfg.intake as never, dir: 1 },
    { on: w.mech.rear > 0, spec: cfg.rearIntake as never, dir: -1 },
  ];
  for (const zn of zones) {
    if (!zn.on || !zn.spec) continue;
    const along = cfg.length / 2 - (zn.spec.inset ?? 0) + zn.spec.reach / 2;
    const side = zn.spec.x ?? 0;
    const zone: Obb = {
      x: s.x + f.x * zn.dir * along + r.x * side,
      y: s.y + f.y * zn.dir * along + r.y * side,
      heading: s.heading,
      hl: zn.spec.reach / 2,
      hw: zn.spec.width / 2,
    };
    const zname = zn.dir > 0 ? "front" : "back";
    for (const o of w.objects) {
      if (o.state !== "field" || o.carriable || o.fixed) continue;
      if (!closestOnObb(zone, o.x, o.y).inside) continue;
      const inner = w.objects.find((q) => q.state === "nested" && q.nestedIn === o.id);
      // say why when a piece is sitting in the pickup zone but is not taken (otherwise it just looks broken)
      let why: string | null = null;
      if (!zoneTakes(zn.spec, !!o.lying)) why = `the ${zname} pickup only takes ${o.lying ? "standing" : "lying"} pieces and this ${o.kind} is ${o.lying ? "lying" : "standing"}`;
      else if (!canHold(w, cfg, o.kind)) why = w.held.length >= maxHold(cfg) ? "the robot is full" : `the robot can only hold ${w.rules?.possession?.[o.kind] ?? "so many"} ${o.kind}${(w.rules?.possession?.[o.kind] ?? 2) === 1 ? "" : "s"} (it already holds one - score it first)`;
      else if (inner && (!canHold(w, cfg, inner.kind) || w.held.length + 2 > maxHold(cfg))) why = `this ${o.kind} has a ${inner.kind} standing in it and the robot has no room for both (score what it holds first)`;
      if (why) { noteReject(w, `r:${o.id}`, `pick up the ${o.kind} with the ${zname} pickup: ${why}`); continue; }
      o.state = "held";
      if (o.lying) o.lying = false;
      w.held.push(o.id);
      w.events.push({ t: w.t, type: "pickup", id: o.id });
      if (inner) { inner.state = "held"; inner.nestedIn = undefined; w.held.push(inner.id); w.events.push({ t: w.t, type: "pickup", id: inner.id }); }
    }
  }
  if (w.mech.intake < 0 && cfg.intake) ejectHeld(w, cfg, 1);
}

function heldOfKind(w: World, kind: string): number {
  return w.held.reduce((n, id) => n + (w.objects.find((o) => o.id === id)?.kind === kind ? 1 : 0), 0);
}

/** Intake capacity check: overall capacity plus the game's per-kind possession limits (Override SG6). */
export function maxHold(cfg: RobotConfig): number {
  return Math.max(cfg.intake?.capacity ?? 0, cfg.rearIntake?.capacity ?? 0);
}

export function canHold(w: World, cfg: RobotConfig, kind: string): boolean {
  if (w.held.length >= maxHold(cfg)) return false;
  const lim = w.rules?.possession?.[kind];
  return lim === undefined || heldOfKind(w, kind) < lim;
}

/** Robot front-center point (where mechanisms interact with the field). */
export function frontPoint(w: World, cfg: RobotConfig, back = false): Vec {
  const f = forwardOf(w.robot.heading);
  const k = back ? -1 : 1;
  return { x: w.robot.x + f.x * k * (cfg.length / 2), y: w.robot.y + f.y * k * (cfg.length / 2) };
}

/**
 * Place one held object onto the goal in front of the robot (nest it into / onto the stack). Returns a
 * human-readable failure reason, or null on success. Which object is tried first: `prefer` kind, then held order.
 */
export function placeHeld(w: World, cfg: RobotConfig, prefer?: string): string | null {
  if (prefer === "all") {
    let placed = 0, why: string | null = null;
    for (let i = 0; i < 6 && w.held.length; i++) { why = placeHeld(w, cfg, undefined); if (why) break; placed++; }
    return placed > 0 ? null : why;
  }
  if (w.held.length === 0) return "nothing held to place";
  const sc = scoreSpecOf(cfg);
  const back = sc.side === "back";
  const f = forwardOf(w.robot.heading), rr = rightOf(w.robot.heading);
  const along = (cfg.length / 2 - (sc.inset ?? 0)) * (back ? -1 : 1);
  const fp = { x: w.robot.x + f.x * along + rr.x * (sc.x ?? 0), y: w.robot.y + f.y * along + rr.y * (sc.x ?? 0) };
  const side = back ? "behind" : "in front of";
  let goal: GoalState | null = null, gd = Infinity;
  for (const g of w.goals) {
    const d = Math.hypot(g.x - fp.x, g.y - fp.y);
    const ahead = ((g.x - w.robot.x) * f.x + (g.y - w.robot.y) * f.y) * (back ? -1 : 1);
    if (d <= (sc.reach ?? g.reach) && ahead > 0 && d < gd) { goal = g; gd = d; }
  }
  if (!goal) { w.events.push({ t: w.t, type: "reject", text: `no goal within reach ${side} the robot` }); return `no goal within reach ${side} the robot`; }
  if (goal.alliance && goal.alliance !== w.alliance) { w.events.push({ t: w.t, type: "reject", goal: goal.id, text: "opposing Alliance Goal (SG9)" }); return `that is the opposing Alliance's Goal (rule SG9)`; }
  if (cfg.maxStack !== undefined && goal.stack.length >= cfg.maxStack) { w.events.push({ t: w.t, type: "reject", goal: goal.id, text: "stack taller than the robot can reach" }); return "the stack is taller than the robot can reach"; }
  const order = [...w.held].sort((a, b) => {
    const ka = w.objects.find((o) => o.id === a)?.kind === prefer ? 0 : 1;
    const kb = w.objects.find((o) => o.id === b)?.kind === prefer ? 0 : 1;
    return ka - kb;
  });
  for (const id of order) {
    const o = w.objects.find((q) => q.id === id)!;
    if (w.rules && !w.rules.canStack(goal, o)) continue;
    goal.stack.push({ id: o.id, kind: o.kind, halves: o.halves, opaqueUp: o.opaqueUp, flip: o.flip });
    o.state = "stacked";
    o.x = goal.x; o.y = goal.y; o.vx = 0; o.vy = 0;
    w.held = w.held.filter((h) => h !== id);
    w.events.push({ t: w.t, type: "place", id: o.id, goal: goal.id });
    return null;
  }
  w.events.push({ t: w.t, type: "reject", goal: goal.id, text: "the held object cannot go on this stack" });
  return "the held object cannot go on this stack (a Pin goes in an empty Goal or a Cup's open socket; a Cup goes over a Pin)";
}

/** Set the Toggle nearest the robot's front to a color. Returns a failure reason or null. */
export function setToggle(w: World, cfg: RobotConfig, color: "yellow" | "red" | "blue"): string | null {
  const fp = frontPoint(w, cfg);
  let best: ToggleState | null = null, bd = Infinity;
  for (const t of w.toggles) {
    // toggles are 25.8 in bars along a wall: distance to the bar's segment
    const half = 12.9;
    const along = t.wall === "N" || t.wall === "S" ? { x: 1, y: 0 } : { x: 0, y: 1 };
    const px = fp.x - t.x, py = fp.y - t.y;
    const proj = Math.max(-half, Math.min(half, px * along.x + py * along.y));
    const d = Math.hypot(px - along.x * proj, py - along.y * proj);
    if (d < bd) { bd = d; best = t; }
  }
  if (!best || bd > 6) { w.events.push({ t: w.t, type: "reject", text: "no Toggle within reach" }); return "no Toggle within reach of the robot's front"; }
  best.state = color;
  w.events.push({ t: w.t, type: "toggle", toggle: best.id, color });
  return null;
}

/** Release up to `count` held objects out the front of the robot. */
export function ejectHeld(w: World, cfg: RobotConfig, count = 1): void {
  const s = w.robot;
  const f = forwardOf(s.heading);
  for (let i = 0; i < count && w.held.length > 0; i++) {
    const id = w.held.shift()!;
    const o = w.objects.find((q) => q.id === id);
    if (!o) continue;
    const dist = cfg.length / 2 + o.r + 1 + i * 2.5;
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
