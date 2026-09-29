/**
 * TypeScript port of LemLib v0.5.x motion algorithms (github.com/LemLib/LemLib, branch `stable`,
 * src/lemlib/chassis/motions/*.cpp, pid.cpp, exitcondition.cpp, util.cpp). The simulator runs the same
 * control laws the real robot runs, at the same 10 ms period, against the simulated (noisy) odometry.
 *
 * Powers are PROS `move()` units, -127..127. Poses passed to `tick` are LemLib's default getPose():
 * inches and heading in degrees (0 = +y, clockwise +).
 */
import type { ControllerGains } from "./robot";
import type { Pose } from "./odom";

export const LOOP_MS = 10;

const sgn = (v: number) => (v < 0 ? -1 : 1);
const degToRad = (d: number) => (d * Math.PI) / 180;
const radToDeg = (r: number) => (r * 180) / Math.PI;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function slew(target: number, current: number, maxChange: number): number {
  if (maxChange === 0) return target;
  let change = target - current;
  if (change > maxChange) change = maxChange;
  else if (change < -maxChange) change = -maxChange;
  return current + change;
}

export type Direction = "auto" | "cw" | "ccw";

function sanitize(angle: number, radians: boolean): number {
  const m = radians ? 2 * Math.PI : 360;
  return (((angle % m) + m) % m + m) % m;
}

/** C's fmod keeps the sign of the dividend, unlike JS-style modulo helpers above. */
const fmod = (a: number, b: number) => a % b;

export function angleError(target: number, position: number, radians = true, direction: Direction = "auto"): number {
  target = sanitize(target, radians);
  position = sanitize(position, radians);
  const max = radians ? 2 * Math.PI : 360;
  const raw = target - position;
  if (direction === "cw") return raw < 0 ? raw + max : raw;
  if (direction === "ccw") return raw > 0 ? raw - max : raw;
  // std::remainder: IEEE remainder (quotient rounded half-to-even)
  const q = raw / max;
  let n = Math.round(q);
  if (Math.abs(q % 1) === 0.5 && n % 2 !== 0) n -= Math.sign(q);
  return raw - n * max;
}

export class PID {
  private integral = 0;
  private prevError = 0;
  constructor(private g: ControllerGains, private signFlipReset = true) {}
  update(error: number): number {
    this.integral += error;
    if (sgn(error) !== sgn(this.prevError) && this.signFlipReset) this.integral = 0;
    if (Math.abs(error) > this.g.windupRange && this.g.windupRange !== 0) this.integral = 0;
    const derivative = error - this.prevError;
    this.prevError = error;
    return error * this.g.kP + this.integral * this.g.kI + derivative * this.g.kD;
  }
  reset(): void { this.integral = 0; this.prevError = 0; }
}

export class ExitCondition {
  private start = -1;
  done = false;
  constructor(private range: number, private timeMs: number) {}
  update(input: number, now: number): boolean {
    if (Math.abs(input) > this.range) this.start = -1;
    else if (this.start === -1) this.start = now;
    else if (now >= this.start + this.timeMs) this.done = true;
    return this.done;
  }
  reset(): void { this.start = -1; this.done = false; }
}

export interface MotionOutput {
  left: number; // -127..127
  right: number;
  done: boolean;
  /** Hold-brake this side (swing turns lock one side) */
  holdLeft?: boolean;
  holdRight?: boolean;
}

export interface Motion {
  /** LemLib's `distTraveled`; -1 once finished */
  distTraveled: number;
  tick(pose: Pose, now: number): MotionOutput;
}

export interface Drivetrain { trackWidth: number; horizontalDrift: number }

const DONE: MotionOutput = { left: 0, right: 0, done: true };

// ---- pose helpers in LemLib's "standard" convention (radians, 0 = +x, ccw +)

interface P { x: number; y: number; theta: number }
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
const angleTo = (a: P, b: P) => Math.atan2(b.y - a.y, b.x - a.x);
function stdPose(p: Pose): P {
  return { x: p.x, y: p.y, theta: Math.PI / 2 - degToRad(p.theta) };
}

function getCurvature(pose: P, other: P): number {
  const side = sgn(Math.sin(pose.theta) * (other.x - pose.x) - Math.cos(pose.theta) * (other.y - pose.y));
  const a = -Math.tan(pose.theta);
  const c = Math.tan(pose.theta) * pose.x - pose.y;
  const x = Math.abs(a * other.x + other.y + c) / Math.sqrt(a * a + 1);
  const d = Math.hypot(other.x - pose.x, other.y - pose.y);
  return side * ((2 * x) / (d * d));
}

// ---------------------------------------------------------------- turnToHeading / turnToPoint / swings

export interface TurnParams {
  direction?: Direction;
  maxSpeed?: number;
  minSpeed?: number;
  earlyExitRange?: number;
  /** turnToPoint / swingToPoint: face the point with the robot's back */
  forwards?: boolean;
}

type TurnTarget = { kind: "heading"; theta: number } | { kind: "point"; x: number; y: number };

class TurnLike implements Motion {
  distTraveled = 0;
  private pid: PID;
  private large: ExitCondition;
  private small: ExitCondition;
  private started = -1;
  private startTheta: number | null = null;
  private settling = false;
  private prevRaw: number | null = null;
  private prevDelta: number | null = null;
  private prevPower = 0;
  private p: Required<Omit<TurnParams, "forwards">> & { forwards: boolean };

  constructor(
    private target: TurnTarget,
    private timeout: number,
    params: TurnParams,
    private g: ControllerGains,
    private swingLock: "left" | "right" | null,
  ) {
    this.p = {
      direction: params.direction ?? "auto",
      maxSpeed: params.maxSpeed ?? 127,
      minSpeed: Math.abs(params.minSpeed ?? 0),
      earlyExitRange: params.earlyExitRange ?? 0,
      forwards: params.forwards ?? true,
    };
    this.pid = new PID(g);
    this.large = new ExitCondition(g.largeError, g.largeErrorTimeout);
    this.small = new ExitCondition(g.smallError, g.smallErrorTimeout);
  }

  tick(poseIn: Pose, now: number): MotionOutput {
    if (this.started < 0) this.started = now;
    if (now - this.started >= this.timeout || this.large.done || this.small.done) return this.finish();
    const pose = { ...poseIn };
    if (this.startTheta === null) this.startTheta = pose.theta;
    let targetTheta: number;
    if (this.target.kind === "heading") {
      targetTheta = this.target.theta;
    } else {
      pose.theta = this.p.forwards ? fmod(pose.theta, 360) : fmod(pose.theta - 180, 360);
      const dx = this.target.x - pose.x, dy = this.target.y - pose.y;
      targetTheta = fmod(radToDeg(Math.PI / 2 - Math.atan2(dy, dx)), 360);
    }
    if (this.swingLock && this.target.kind === "heading") pose.theta = fmod(pose.theta, 360);
    this.distTraveled = Math.abs(angleError(pose.theta, this.startTheta, false));

    const raw = angleError(targetTheta, pose.theta, false);
    if (this.prevRaw === null) this.prevRaw = raw;
    if (sgn(raw) !== sgn(this.prevRaw)) this.settling = true;
    this.prevRaw = raw;
    const delta = this.settling ? angleError(targetTheta, pose.theta, false) : angleError(targetTheta, pose.theta, false, this.p.direction);
    if (this.prevDelta === null) this.prevDelta = delta;
    if (this.p.minSpeed !== 0 && Math.abs(delta) < this.p.earlyExitRange) return this.finish();
    if (this.p.minSpeed !== 0 && sgn(delta) !== sgn(this.prevDelta)) return this.finish();

    let power = this.pid.update(delta);
    this.large.update(delta, now);
    this.small.update(delta, now);
    power = clamp(power, -this.p.maxSpeed, this.p.maxSpeed);
    if (Math.abs(delta) > 20) power = slew(power, this.prevPower, this.g.slew);
    if (power < 0 && power > -this.p.minSpeed) power = -this.p.minSpeed;
    else if (power > 0 && power < this.p.minSpeed) power = this.p.minSpeed;
    this.prevPower = power;

    if (this.swingLock === "left") return { left: 0, right: -power, done: false, holdLeft: true };
    if (this.swingLock === "right") return { left: power, right: 0, done: false, holdRight: true };
    return { left: power, right: -power, done: false };
  }

  private finish(): MotionOutput {
    this.distTraveled = -1;
    return DONE;
  }
}

export const turnToHeading = (theta: number, timeout: number, g: ControllerGains, p: TurnParams = {}): Motion =>
  new TurnLike({ kind: "heading", theta }, timeout, p, g, null);
export const turnToPoint = (x: number, y: number, timeout: number, g: ControllerGains, p: TurnParams = {}): Motion =>
  new TurnLike({ kind: "point", x, y }, timeout, p, g, null);
export const swingToHeading = (theta: number, lock: "left" | "right", timeout: number, g: ControllerGains, p: TurnParams = {}): Motion =>
  new TurnLike({ kind: "heading", theta }, timeout, p, g, lock);
export const swingToPoint = (x: number, y: number, lock: "left" | "right", timeout: number, g: ControllerGains, p: TurnParams = {}): Motion =>
  new TurnLike({ kind: "point", x, y }, timeout, p, g, lock);

// ---------------------------------------------------------------- moveToPoint / moveToPose

export interface MoveParams {
  forwards?: boolean;
  maxSpeed?: number;
  minSpeed?: number;
  earlyExitRange?: number;
  /** moveToPose */
  lead?: number;
  horizontalDrift?: number;
}

class MoveTo implements Motion {
  distTraveled = 0;
  private lPid: PID;
  private aPid: PID;
  private lLarge: ExitCondition; private lSmall: ExitCondition;
  private aLarge: ExitCondition; private aSmall: ExitCondition;
  private started = -1;
  private last: P | null = null;
  private close = false;
  private lateralSettled = false;
  private prevSameSide = false;
  private prevSide: boolean | null = null;
  private prevLat = 0;
  private prevAng = 0;
  private target: P | null = null;
  private maxSpeed: number;
  private p: { forwards: boolean; minSpeed: number; earlyExitRange: number; lead: number; drift: number };

  constructor(
    private x: number, private y: number, private theta: number | null,
    private timeout: number, params: MoveParams,
    private lg: ControllerGains, private ag: ControllerGains, dt: Drivetrain,
  ) {
    this.lPid = new PID(lg); this.aPid = new PID(ag);
    this.lLarge = new ExitCondition(lg.largeError, lg.largeErrorTimeout);
    this.lSmall = new ExitCondition(lg.smallError, lg.smallErrorTimeout);
    this.aLarge = new ExitCondition(ag.largeError, ag.largeErrorTimeout);
    this.aSmall = new ExitCondition(ag.smallError, ag.smallErrorTimeout);
    this.maxSpeed = params.maxSpeed ?? 127;
    this.p = {
      forwards: params.forwards ?? true,
      minSpeed: params.minSpeed ?? 0,
      earlyExitRange: Math.abs(params.earlyExitRange ?? 0),
      lead: params.lead ?? 0.6,
      drift: params.horizontalDrift ? params.horizontalDrift : dt.horizontalDrift,
    };
  }

  tick(poseIn: Pose, now: number): MotionOutput {
    if (this.started < 0) this.started = now;
    const pose = stdPose(poseIn);
    if (this.last === null) {
      this.last = pose;
      this.target = { x: this.x, y: this.y, theta: 0 };
      if (this.theta === null) this.target.theta = angleTo(pose, this.target);
      else {
        this.target.theta = Math.PI / 2 - degToRad(this.theta);
        if (!this.p.forwards) this.target.theta = fmod(this.target.theta + Math.PI, 2 * Math.PI);
      }
    }
    const target = this.target!;
    const pose2 = this.theta === null ? this.tickPointCondition() : this.tickPoseCondition();
    if (now - this.started >= this.timeout || pose2) return this.finish();

    this.distTraveled += dist(pose, this.last);
    this.last = pose;
    const distTarget = dist(pose, target);
    if (distTarget < 7.5 && !this.close) {
      this.close = true;
      this.maxSpeed = Math.max(Math.abs(this.prevLat), 60);
    }
    return this.theta === null ? this.pointBody(pose, target, now) : this.poseBody(pose, target, now);
  }

  private tickPointCondition(): boolean {
    return (this.lSmall.done || this.lLarge.done) && this.close;
  }
  private tickPoseCondition(): boolean {
    return this.lateralSettled && (this.aLarge.done || this.aSmall.done) && this.close;
  }

  private pointBody(pose: P, target: P, now: number): MotionOutput {
    const side = (pose.y - target.y) * -Math.sin(target.theta) <= (pose.x - target.x) * Math.cos(target.theta) + this.p.earlyExitRange;
    if (this.prevSide === null) this.prevSide = side;
    const sameSide = side === this.prevSide;
    if (!sameSide && this.p.minSpeed !== 0) return this.finish();
    this.prevSide = side;

    const adjusted = this.p.forwards ? pose.theta : pose.theta + Math.PI;
    const angErr = angleError(adjusted, angleTo(pose, target));
    const latErr = dist(pose, target) * Math.cos(angleError(pose.theta, angleTo(pose, target)));
    this.lSmall.update(latErr, now); this.lLarge.update(latErr, now);
    let lat = this.lPid.update(latErr);
    let ang = this.aPid.update(radToDeg(angErr));
    if (this.close) ang = 0;
    ang = clamp(ang, -this.maxSpeed, this.maxSpeed);
    ang = slew(ang, this.prevAng, this.ag.slew);
    lat = clamp(lat, -this.maxSpeed, this.maxSpeed);
    if (!this.close) lat = slew(lat, this.prevLat, this.lg.slew);
    if (this.p.forwards && !this.close) lat = Math.max(lat, 0);
    else if (!this.p.forwards && !this.close) lat = Math.min(lat, 0);
    if (this.p.forwards && lat < Math.abs(this.p.minSpeed) && lat > 0) lat = Math.abs(this.p.minSpeed);
    if (!this.p.forwards && -lat < Math.abs(this.p.minSpeed) && lat < 0) lat = -Math.abs(this.p.minSpeed);
    this.prevAng = ang; this.prevLat = lat;
    return this.mix(lat, ang);
  }

  private poseBody(pose: P, target: P, now: number): MotionOutput {
    if (this.lLarge.done && this.lSmall.done) this.lateralSettled = true;
    const distTarget = dist(pose, target);
    let carrot: P = {
      x: target.x - Math.cos(target.theta) * this.p.lead * distTarget,
      y: target.y - Math.sin(target.theta) * this.p.lead * distTarget,
      theta: target.theta,
    };
    if (this.close) carrot = target;
    const robotSide = (pose.y - target.y) * -Math.sin(target.theta) <= (pose.x - target.x) * Math.cos(target.theta) + this.p.earlyExitRange;
    const carrotSide = (carrot.y - target.y) * -Math.sin(target.theta) <= (carrot.x - target.x) * Math.cos(target.theta) + this.p.earlyExitRange;
    const sameSide = robotSide === carrotSide;
    if (!sameSide && this.prevSameSide && this.close && this.p.minSpeed !== 0) return this.finish();
    this.prevSameSide = sameSide;

    const adjusted = this.p.forwards ? pose.theta : pose.theta + Math.PI;
    const angErr = this.close ? angleError(adjusted, target.theta) : angleError(adjusted, angleTo(pose, carrot));
    let latErr = dist(pose, carrot);
    if (this.close) latErr *= Math.cos(angleError(pose.theta, angleTo(pose, carrot)));
    else latErr *= sgn(Math.cos(angleError(pose.theta, angleTo(pose, carrot))));

    this.lSmall.update(latErr, now); this.lLarge.update(latErr, now);
    this.aSmall.update(radToDeg(angErr), now); this.aLarge.update(radToDeg(angErr), now);
    let lat = this.lPid.update(latErr);
    let ang = this.aPid.update(radToDeg(angErr));
    ang = clamp(ang, -this.maxSpeed, this.maxSpeed);
    lat = clamp(lat, -this.maxSpeed, this.maxSpeed);
    if (!this.close) lat = slew(lat, this.prevLat, this.lg.slew);

    const radius = 1 / Math.abs(getCurvature(pose, carrot));
    const maxSlip = Math.sqrt(this.p.drift * radius * 9.8);
    lat = clamp(lat, -maxSlip, maxSlip);
    const overturn = Math.abs(ang) + Math.abs(lat) - this.maxSpeed;
    if (overturn > 0) lat -= lat > 0 ? overturn : -overturn;
    if (this.p.forwards && !this.close) lat = Math.max(lat, 0);
    else if (!this.p.forwards && !this.close) lat = Math.min(lat, 0);
    if (this.p.forwards && lat < Math.abs(this.p.minSpeed) && lat > 0) lat = Math.abs(this.p.minSpeed);
    if (!this.p.forwards && -lat < Math.abs(this.p.minSpeed) && lat < 0) lat = -Math.abs(this.p.minSpeed);
    this.prevAng = ang; this.prevLat = lat;
    return this.mix(lat, ang);
  }

  private mix(lat: number, ang: number): MotionOutput {
    let l = lat + ang, r = lat - ang;
    const ratio = Math.max(Math.abs(l), Math.abs(r)) / this.maxSpeed;
    if (ratio > 1) { l /= ratio; r /= ratio; }
    return { left: l, right: r, done: false };
  }

  private finish(): MotionOutput {
    this.distTraveled = -1;
    return DONE;
  }
}

export const moveToPoint = (x: number, y: number, timeout: number, lg: ControllerGains, ag: ControllerGains, dt: Drivetrain, p: MoveParams = {}): Motion =>
  new MoveTo(x, y, null, timeout, p, lg, ag, dt);
export const moveToPose = (x: number, y: number, theta: number, timeout: number, lg: ControllerGains, ag: ControllerGains, dt: Drivetrain, p: MoveParams = {}): Motion =>
  new MoveTo(x, y, theta, timeout, p, lg, ag, dt);

// ---------------------------------------------------------------- pure pursuit (follow)

export interface PathPoint { x: number; y: number; speed: number }

function circleIntersect(p1: P, p2: P, pose: P, lookahead: number): number {
  const d = { x: p2.x - p1.x, y: p2.y - p1.y };
  const f = { x: p1.x - pose.x, y: p1.y - pose.y };
  const a = d.x * d.x + d.y * d.y;
  const b = 2 * (f.x * d.x + f.y * d.y);
  const c = f.x * f.x + f.y * f.y - lookahead * lookahead;
  let disc = b * b - 4 * a * c;
  if (disc >= 0) {
    disc = Math.sqrt(disc);
    const t1 = (-b - disc) / (2 * a);
    const t2 = (-b + disc) / (2 * a);
    if (t2 >= 0 && t2 <= 1) return t2;
    if (t1 >= 0 && t1 <= 1) return t1;
  }
  return -1;
}

class Follow implements Motion {
  distTraveled = 0;
  private i = 0;
  private last: P | null = null;
  private lastLookahead: { p: P; idx: number };
  private prevVel = 0;

  constructor(private path: PathPoint[], private lookahead: number, private timeout: number, private forwards: boolean, private lg: ControllerGains, private dt: Drivetrain) {
    this.lastLookahead = { p: { x: path[0]?.x ?? 0, y: path[0]?.y ?? 0, theta: 0 }, idx: 0 };
  }

  tick(poseIn: Pose): MotionOutput {
    if (this.path.length === 0 || this.i >= this.timeout / LOOP_MS) return this.finish();
    this.i++;
    // follow() uses getPose(true): radians heading (0 = +y, cw +), NOT standard
    const headingRad = degToRad(poseIn.theta) - (this.forwards ? 0 : Math.PI);
    const pose: P = { x: poseIn.x, y: poseIn.y, theta: headingRad };
    if (this.last === null) this.last = pose;
    this.distTraveled += dist(pose, this.last);
    this.last = pose;

    let closest = 0, best = Infinity;
    for (let k = 0; k < this.path.length; k++) {
      const d = Math.hypot(pose.x - this.path[k].x, pose.y - this.path[k].y);
      if (d < best) { best = d; closest = k; }
    }
    if (this.path[closest].speed === 0) return this.finish();

    // lookahead point
    const start = Math.max(closest, this.lastLookahead.idx);
    let la = this.lastLookahead;
    for (let k = start; k < this.path.length - 1; k++) {
      const a: P = { x: this.path[k].x, y: this.path[k].y, theta: 0 };
      const b: P = { x: this.path[k + 1].x, y: this.path[k + 1].y, theta: 0 };
      const t = circleIntersect(a, b, pose, this.lookahead);
      if (t !== -1) { la = { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, theta: 0 }, idx: k }; break; }
    }
    this.lastLookahead = la;

    const heading = Math.PI / 2 - pose.theta;
    // findLookaheadCurvature
    const side = sgn(Math.sin(heading) * (la.p.x - pose.x) - Math.cos(heading) * (la.p.y - pose.y));
    const a = -Math.tan(heading);
    const c = Math.tan(heading) * pose.x - pose.y;
    const x = Math.abs(a * la.p.x + la.p.y + c) / Math.sqrt(a * a + 1);
    const d = Math.hypot(la.p.x - pose.x, la.p.y - pose.y);
    const curvature = side * ((2 * x) / (d * d));

    let targetVel = this.path[closest].speed;
    targetVel = slew(targetVel, this.prevVel, this.lg.slew);
    this.prevVel = targetVel;
    let l = targetVel * (2 + curvature * this.dt.trackWidth) / 2;
    let r = targetVel * (2 - curvature * this.dt.trackWidth) / 2;
    const ratio = Math.max(Math.abs(l), Math.abs(r)) / 127;
    if (ratio > 1) { l /= ratio; r /= ratio; }
    return this.forwards ? { left: l, right: r, done: false } : { left: -r, right: -l, done: false };
  }

  private finish(): MotionOutput {
    this.distTraveled = -1;
    return DONE;
  }
}

export const follow = (path: PathPoint[], lookahead: number, timeout: number, forwards: boolean, lg: ControllerGains, dt: Drivetrain): Motion =>
  new Follow(path, lookahead, timeout, forwards, lg, dt);
