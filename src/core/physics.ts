import { derive, IN, type DerivedRobot, type RobotConfig, type WheelType } from "./robot";

/**
 * Robot pose/velocity state. Field inches, origin at field center, x right, y up.
 * Heading in degrees, 0 = +y, clockwise positive (LemLib / EZ-Template convention).
 * Body frame: vx = forward, vy = right (in/s). w = yaw rate, deg/s, clockwise +.
 */
export interface SimState {
  x: number;
  y: number;
  heading: number;
  vx: number;
  vy: number;
  w: number;
  t: number;
  /** Cumulative wheel-surface travel per side, inches (what the motor encoders read; includes slip) */
  travelL: number;
  travelR: number;
  /** Wheel-surface speed per side, in/s */
  wheelVL: number;
  wheelVR: number;
  /** Last step telemetry */
  voltageL: number;
  voltageR: number;
  batteryV: number;
  currentA: number;
  slipL: boolean;
  slipR: boolean;
}

export interface Environment {
  fieldSize: number;
  /** Tire-floor friction by wheel type (tuning values, UNVERIFIED against real tiles) */
  friction: Record<WheelType, { long: number; lat: number }>;
  /** Fully charged V5 battery open-circuit voltage */
  batteryOpen: number;
  batteryResistance: number; // ohm (pack + wiring, UNVERIFIED)
  rollingResistance: number; // fraction of weight
  /** Viscous drivetrain drag, N per (m/s) per motor side */
  viscousDrag: number;
  driveEfficiency: number;
  /** Kinetic/static friction ratio once tires break loose */
  kineticRatio: number;
}

export const defaultEnv: Environment = {
  fieldSize: 144,
  friction: {
    traction: { long: 1.0, lat: 0.9 },
    omni: { long: 0.75, lat: 0.08 },
  },
  batteryOpen: 12.6,
  batteryResistance: 0.09,
  rollingResistance: 0.015,
  viscousDrag: 1.2,
  driveEfficiency: 0.88,
  kineticRatio: 0.85,
};

const G = 9.81;
const RAD = Math.PI / 180;
/** Physics sub-step limit (s) - lateral tire model is stiff */
const MAX_SUBSTEP = 0.001;
/** Lateral slip speed scale for the smooth Coulomb friction model, m/s */
const V0 = 0.05;

export function initialState(x = 0, y = 0, heading = 0): SimState {
  return {
    x, y, heading, vx: 0, vy: 0, w: 0, t: 0,
    travelL: 0, travelR: 0, wheelVL: 0, wheelVR: 0,
    voltageL: 0, voltageR: 0, batteryV: 12.6, currentA: 0, slipL: false, slipR: false,
  };
}

/** Per-wheel vertical loads on one side (N per wheel), assuming even weight distribution. */
export function wheelLoad(cfg: RobotConfig): number {
  const n = cfg.wheels.length * 2;
  return n === 0 ? 0 : (cfg.mass * G) / n;
}

/** Max longitudinal traction force of ONE side, N */
export function sideTractionLimit(cfg: RobotConfig, env: Environment): number {
  const n = wheelLoad(cfg);
  let sum = 0;
  for (const w of cfg.wheels) sum += env.friction[w.type].long * n;
  return sum;
}

export interface SideResult {
  force: number; // N on the robot, tire-ground
  current: number; // A
  wheelSpeed: number; // m/s surface speed
  slipping: boolean;
}

/**
 * One drive side. `cmd` in [-1, 1] (PROS move(x) = x/127 of 12 V). `vGround` = ground speed of the
 * side's contact patches (m/s). If the motor wants more force than the tires can transmit, the wheel
 * spins up to the speed where motor force equals kinetic friction (encoders then over-read).
 */
export function sideDrive(
  cmd: number,
  vGround: number,
  cfg: RobotConfig,
  d: DerivedRobot,
  env: Environment,
  batteryV: number,
  hold = false,
): SideResult {
  const u = Math.max(-1, Math.min(1, cmd));
  const brake = hold ? "hold" : cfg.brake;
  const coast = Math.abs(u) < 1e-9 && brake === "coast";
  const volts = Math.sign(u) * Math.min(Math.abs(u) * 12, batteryV);
  const vFreeWheel = d.motor.freeSpeed * d.ratio * d.wheelRadius; // m/s at 12 V
  const k0 = (cfg.motorsPerSide * d.motor.stallTorque * d.ratio * env.driveEfficiency) / d.wheelRadius;
  const iStall = cfg.motorsPerSide * d.motor.stallCurrent;
  // "hold" brake: the motor's position loop resists motion far more strongly than a plain short-circuit brake.
  const backEmfGain = Math.abs(u) < 1e-9 && brake === "hold" ? 6 : 1;
  const fMotor = (vw: number) => {
    if (coast) return 0;
    const f = k0 * (volts / 12 - (backEmfGain * vw) / vFreeWheel);
    return Math.max(-k0, Math.min(k0, f));
  };
  const limit = sideTractionLimit(cfg, env);

  let force = fMotor(vGround);
  let wheelSpeed = vGround;
  let slipping = false;
  if (Math.abs(force) > limit) {
    slipping = true;
    force = Math.sign(force) * limit * env.kineticRatio;
    // solve k0 (V/12 - vw/vf) = force  ->  vw
    wheelSpeed = vFreeWheel * (volts / 12 - force / k0);
  }
  const current = coast ? 0 : Math.abs(volts / 12 - wheelSpeed / vFreeWheel) * iStall;
  return { force, current, wheelSpeed, slipping };
}

/**
 * Advance the tank drive by `dt`. `left`/`right` are commanded outputs in [-1, 1]. Deterministic.
 * Internally sub-steps at <= 1 ms. Returns pose/velocity WITHOUT contact resolution - the caller
 * (World) resolves collisions. `external` is an optional world-frame force+torque applied this step.
 */
export function step(
  s: SimState,
  cfg: RobotConfig,
  left: number,
  right: number,
  dt: number,
  env: Environment = defaultEnv,
  d: DerivedRobot = derive(cfg),
  hold: { left?: boolean; right?: boolean } = {},
): SimState {
  const n = Math.max(1, Math.ceil(dt / MAX_SUBSTEP));
  const h = dt / n;
  let st = s;
  for (let i = 0; i < n; i++) st = subStep(st, cfg, left, right, h, env, d, hold);
  return st;
}

function subStep(
  s: SimState,
  cfg: RobotConfig,
  left: number,
  right: number,
  h: number,
  env: Environment,
  d: DerivedRobot,
  hold: { left?: boolean; right?: boolean },
): SimState {
  const m = cfg.mass;
  const track = cfg.trackWidth * IN;
  let vx = s.vx * IN;
  let vy = s.vy * IN;
  let w = s.w * RAD;

  // Clockwise yaw: the left side moves faster.
  const gL = vx + (w * track) / 2;
  const gR = vx - (w * track) / 2;
  const L = sideDrive(left, gL, cfg, d, env, s.batteryV, hold.left);
  const R = sideDrive(right, gR, cfg, d, env, s.batteryV, hold.right);

  const drag = env.viscousDrag * 2;
  const rolling = env.rollingResistance * m * G;
  const rollF = -Math.tanh(vx / 0.02) * rolling - drag * vx;

  let Fx = L.force + R.force + rollF;
  let torque = ((L.force - R.force) * track) / 2;

  // Lateral tire forces: smooth Coulomb friction at each wheel; positions give yaw torque (scrub).
  const nLoad = wheelLoad(cfg);
  let Fy = 0;
  for (const wh of cfg.wheels) {
    const mu = env.friction[wh.type].lat;
    const x = wh.x * IN;
    const vLat = vy + w * x; // right-positive lateral speed of the wheel
    const f = -mu * nLoad * Math.tanh(vLat / V0) * 2; // both sides
    Fy += f;
    torque += f * x;
  }
  // Yaw damping from tire deformation/gearbox is small vs scrub; add tiny viscous term for stability
  torque -= 0.002 * w;

  const ax = Fx / m + w * vy;
  const ay = Fy / m - w * vx;
  const alpha = torque / d.inertia;

  vx += ax * h;
  vy += ay * h;
  w += alpha * h;

  const heading = s.heading + (w * h) / RAD;
  const mid = (s.heading + heading) / 2;
  const th = mid * RAD;
  const wx = vx * Math.sin(th) + vy * Math.cos(th);
  const wy = vx * Math.cos(th) - vy * Math.sin(th);

  const current = L.current + R.current;
  const batteryV = Math.max(6, env.batteryOpen - env.batteryResistance * current);

  return {
    x: s.x + (wx / IN) * h,
    y: s.y + (wy / IN) * h,
    heading,
    vx: vx / IN,
    vy: vy / IN,
    w: w / RAD,
    t: s.t + h,
    travelL: s.travelL + (L.wheelSpeed / IN) * h,
    travelR: s.travelR + (R.wheelSpeed / IN) * h,
    wheelVL: L.wheelSpeed / IN,
    wheelVR: R.wheelSpeed / IN,
    voltageL: Math.sign(left) * Math.min(Math.abs(left) * 12, s.batteryV),
    voltageR: Math.sign(right) * Math.min(Math.abs(right) * 12, s.batteryV),
    batteryV,
    currentA: current,
    slipL: L.slipping,
    slipR: R.slipping,
  };
}
