import { derive, IN, type DerivedRobot, type RobotConfig, type WheelType } from "./robot";

/** Pose: field inches, origin at center, x right, y up. Heading in degrees, 0 = +y, clockwise +. */
export interface SimState {
  x: number;
  y: number;
  heading: number;
  /** forward speed, in/s */
  v: number;
  /** turn rate, deg/s (clockwise +) */
  w: number;
  t: number;
  /** Last step telemetry */
  voltageL: number;
  voltageR: number;
  batteryV: number;
}

export interface Environment {
  fieldSize: number;
  /** Tire-floor friction coefficient by wheel type (UNVERIFIED tuning values) */
  friction: Record<WheelType, { long: number; lat: number }>;
  batteryNominal: number;
  batteryResistance: number; // ohm
  rollingResistance: number; // fraction of weight
  driveEfficiency: number;
}

export const defaultEnv: Environment = {
  fieldSize: 144,
  friction: {
    traction: { long: 1.0, lat: 0.9 },
    omni: { long: 0.8, lat: 0.1 },
  },
  batteryNominal: 12,
  batteryResistance: 0.09,
  rollingResistance: 0.02,
  driveEfficiency: 0.9,
};

const G = 9.81;
const RAD = Math.PI / 180;

export function initialState(x = 0, y = 0, heading = 0): SimState {
  return { x, y, heading, v: 0, w: 0, t: 0, voltageL: 0, voltageR: 0, batteryV: 12 };
}

/** Lateral scrub torque (N·m) resisting rotation: omni wheels slide freely, traction wheels drag. */
export function scrubTorque(cfg: RobotConfig, env: Environment): number {
  const n = cfg.wheels.length * 2;
  if (n === 0) return 0;
  const normal = (cfg.mass * G) / n;
  let sum = 0;
  for (const wheel of cfg.wheels) sum += env.friction[wheel.type].lat * normal * Math.abs(wheel.x * IN) * 2;
  return sum;
}

/** Max longitudinal force before the tires slip, N */
function tractionLimit(cfg: RobotConfig, env: Environment): number {
  const n = cfg.wheels.length * 2;
  if (n === 0) return 0;
  const normal = (cfg.mass * G) / n;
  let sum = 0;
  for (const wheel of cfg.wheels) sum += env.friction[wheel.type].long * normal * 2;
  return sum;
}

function sideForce(
  cmd: number,
  vSide: number, // m/s
  cfg: RobotConfig,
  d: DerivedRobot,
  env: Environment,
  batteryV: number,
): { force: number; current: number; volts: number } {
  const u = Math.max(-1, Math.min(1, cmd));
  const volts = u * batteryV;
  const wheelOmega = vSide / d.wheelRadius;
  const motorOmega = wheelOmega / d.ratio;
  const back = motorOmega / d.motor.freeSpeed;
  const frac = volts / env.batteryNominal - back;
  const torque = d.motor.stallTorque * frac;
  const force = (cfg.motorsPerSide * torque * d.ratio * env.driveEfficiency) / d.wheelRadius;
  const current = cfg.motorsPerSide * Math.abs(frac) * d.motor.stallCurrent;
  return { force, current, volts };
}

/**
 * Advance the tank drive one fixed step. `left`/`right` are commanded motor outputs in [-1, 1].
 * Deterministic: no randomness here (noise belongs to the odometry layer).
 */
export function step(
  s: SimState,
  cfg: RobotConfig,
  left: number,
  right: number,
  dt: number,
  env: Environment = defaultEnv,
  d: DerivedRobot = derive(cfg),
): SimState {
  const track = cfg.trackWidth * IN;
  const v = s.v * IN;
  const w = s.w * RAD;
  const vL = v + (w * track) / 2;
  const vR = v - (w * track) / 2;

  const bat = s.batteryV;
  const L = sideForce(left, vL, cfg, d, env, bat);
  const R = sideForce(right, vR, cfg, d, env, bat);

  // Traction limit is applied to total drive force.
  const limit = tractionLimit(cfg, env) / 2;
  const fL = Math.max(-limit, Math.min(limit, L.force));
  const fR = Math.max(-limit, Math.min(limit, R.force));

  const rolling = env.rollingResistance * cfg.mass * G;
  const fNet = fL + fR - Math.sign(v) * (Math.abs(v) > 1e-4 ? rolling : 0);
  // Clockwise-positive turn: right side (v decreases when turning cw) -> left force minus right force.
  let torque = ((fL - fR) * track) / 2;
  const scrub = scrubTorque(cfg, env);
  if (Math.abs(w) > 1e-3) torque -= Math.sign(w) * scrub;
  else if (Math.abs(torque) <= scrub) torque = 0;
  else torque -= Math.sign(torque) * scrub;

  let newV = v + (fNet / cfg.mass) * dt;
  // Rolling resistance must not reverse velocity.
  if (Math.sign(newV) !== Math.sign(v) && Math.abs(v) > 0 && Math.abs(fL + fR) < rolling) newV = 0;
  const newW = w + (torque / d.inertia) * dt;

  const totalCurrent = L.current + R.current;
  const batteryV = Math.max(6, env.batteryNominal - env.batteryResistance * totalCurrent);

  const heading = s.heading + ((newW * dt) / RAD);
  const mid = (s.heading + heading) / 2;
  const vin = (newV / IN) * dt;
  const next: SimState = {
    x: s.x + vin * Math.sin(mid * RAD),
    y: s.y + vin * Math.cos(mid * RAD),
    heading,
    v: newV / IN,
    w: newW / RAD,
    t: s.t + dt,
    voltageL: L.volts,
    voltageR: R.volts,
    batteryV,
  };
  return collideWalls(next, cfg, env);
}

/** Keep the robot's rectangle inside the field; kill velocity into the wall. */
export function collideWalls(s: SimState, cfg: RobotConfig, env: Environment): SimState {
  const half = env.fieldSize / 2;
  const hl = cfg.length / 2;
  const hw = cfg.width / 2;
  const th = s.heading * RAD;
  const fx = Math.sin(th), fy = Math.cos(th); // forward
  const rx = Math.cos(th), ry = -Math.sin(th); // right
  let { x, y, v } = s;
  for (const [a, b] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw]] as const) {
    const cx = x + fx * a + rx * b;
    const cy = y + fy * a + ry * b;
    if (cx > half) { x -= cx - half; v = intoWall(v, fx, 1); }
    if (cx < -half) { x -= cx + half; v = intoWall(v, fx, -1); }
    if (cy > half) { y -= cy - half; v = intoWall(v, fy, 1); }
    if (cy < -half) { y -= cy + half; v = intoWall(v, fy, -1); }
  }
  return { ...s, x, y, v };
}

/** Zero forward speed that moves into a wall whose outward normal component is n*(f). */
function intoWall(v: number, forwardComponent: number, sign: number): number {
  const into = v * forwardComponent * sign; // > 0 means moving into the wall
  return into > 0 ? 0 : v;
}
