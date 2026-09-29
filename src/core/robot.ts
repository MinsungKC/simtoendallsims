import { motorSpec, type Cartridge, type MotorSpec, type MotorWatts } from "./motors";

export type WheelType = "omni" | "traction";
export type BrakeMode = "coast" | "brake" | "hold";

export interface WheelSpec {
  type: WheelType;
  /** Longitudinal offset from robot center, inches (+ = front) */
  x: number;
}

/** Actual (not marketed) wheel diameters, inches. Values from LemLib's Omniwheel table. */
export const WHEEL_CATALOG = [
  { id: "omni-2.75", label: 'Omni 2.75"', diameter: 2.75 },
  { id: "omni-3.25", label: 'Omni 3.25"', diameter: 3.25 },
  { id: "omni-4-new", label: 'Omni 4" (new)', diameter: 4.0 },
  { id: "omni-4-old", label: 'Omni 4" (old, 4.18")', diameter: 4.18 },
  { id: "omni-2-new", label: 'Omni 2" (new)', diameter: 2.125 },
] as const;

export interface TrackingWheelSpec {
  /** "vertical" rolls forward/back; "horizontal" rolls sideways */
  axis: "vertical" | "horizontal";
  diameter: number; // in
  /** Offset from tracking center, inches. Vertical: + right. Horizontal: + front (LemLib convention) */
  offset: number;
  /** "rotation" (V5 Rotation Sensor, 0.088 deg/tick) or "encoder" (ADI, 2 deg/tick... 360 ticks/rev) */
  sensor: "rotation" | "encoder";
}

export interface OdomConfig {
  trackingWheels: TrackingWheelSpec[];
  useImu: boolean;
  /** IMU error model (UNVERIFIED tuning values) */
  imuDriftDegPerSec: number;
  imuNoiseDeg: number;
  /** Gyro scale error, e.g. 0.002 = reads 0.2% too high */
  imuScaleError: number;
  /** Tracking wheel diameter/measurement error fraction */
  wheelScaleError: number;
}

/** Controller gains in LemLib's ControllerSettings layout */
export interface ControllerGains {
  kP: number;
  kI: number;
  kD: number;
  windupRange: number;
  smallError: number;
  smallErrorTimeout: number;
  largeError: number;
  largeErrorTimeout: number;
  slew: number;
}

export interface RobotConfig {
  name: string;
  /** Motors per side (total drive motors = 2x) */
  motorsPerSide: number;
  motorWatts: MotorWatts;
  cartridge: Cartridge;
  /** wheel rpm = cartridge rpm x drivingTeeth / drivenTeeth (36:48 on a 600 rpm cartridge = 450 rpm) */
  drivingTeeth: number;
  drivenTeeth: number;
  wheelDiameter: number; // in (ACTUAL diameter)
  trackWidth: number; // in, center-to-center of the left/right wheels
  length: number; // in
  width: number; // in
  /** Rectangular notches cut out of the chassis outline (goal aligners, pin slots, ...). Empty/undefined = a plain box. */
  cutouts?: Cutout[];
  mass: number; // kg
  /** Moment of inertia about the vertical axis, kg·m². null = derive from a uniform box */
  inertia: number | null;
  /** Wheels on ONE side (mirrored to the other) */
  wheels: WheelSpec[];
  brake: BrakeMode;
  odom: OdomConfig;
  lateral: ControllerGains;
  angular: ControllerGains;
  /** LemLib horizontalDrift (moveToPose/pure pursuit slip limiter) */
  horizontalDrift: number;
  /** Other (non-drive) motor watts on the robot, for the budget check */
  otherMotorsW: number;
  /** Calibration: multiplies all tire friction coefficients (1 = defaults). Lower it if the real robot slips more. */
  grip: number;
  /** Calibration: drivetrain efficiency after gearbox/chain losses (0.5-1). Lower it if the real robot is slower. */
  efficiency: number;
  /** Intake capture zone in front of the robot (robot frame), inches. null = none */
  intake: IntakeSpec | null;
  /** Second capture zone on the back of the robot. null/undefined = none. */
  rearIntake?: IntakeSpec | null;
  /** Which end of the robot scores (Place action reaches out of it). Default front. Prefer `scoring` for full control. */
  scoreSide?: "front" | "back";
  /** Where the scoring mechanism is: which end, sideways offset, and how far INSIDE the frame it sits (e.g. in a goal-aligner cutout). */
  scoring?: ScoreSpec;
  /** Tallest stack (pieces) the scoring mechanism can add to. Undefined = unlimited. */
  maxStack?: number;
}

/** A rectangular notch in the chassis, robot frame: x = right of center, y = ahead of center, w across, h along. */
export interface Cutout { x: number; y: number; w: number; h: number }

export interface ChassisRect { cx: number; cy: number; w: number; h: number }

const rectCache = new Map<string, ChassisRect[]>();

/**
 * The chassis outline as a union of convex rectangles: the length x width box minus every cutout. Overlapping/edge-touching cutouts
 * are fine; cutouts that leave nothing are ignored (the outline never goes empty).
 */
export function chassisRects(cfg: Pick<RobotConfig, "length" | "width" | "cutouts">): ChassisRect[] {
  const cuts = cfg.cutouts ?? [];
  if (!cuts.length) return [{ cx: 0, cy: 0, w: cfg.width, h: cfg.length }];
  const key = `${cfg.length}|${cfg.width}|${JSON.stringify(cuts)}`;
  const hit = rectCache.get(key);
  if (hit) return hit;
  const hw = cfg.width / 2, hl = cfg.length / 2;
  const clampX = (v: number) => Math.max(-hw, Math.min(hw, v)), clampY = (v: number) => Math.max(-hl, Math.min(hl, v));
  const xs = new Set([-hw, hw]), ys = new Set([-hl, hl]);
  for (const c of cuts) { xs.add(clampX(c.x - c.w / 2)); xs.add(clampX(c.x + c.w / 2)); ys.add(clampY(c.y - c.h / 2)); ys.add(clampY(c.y + c.h / 2)); }
  const X = [...xs].sort((a, b) => a - b), Y = [...ys].sort((a, b) => a - b);
  const inCut = (x: number, y: number) => cuts.some((c) => Math.abs(x - c.x) < c.w / 2 && Math.abs(y - c.y) < c.h / 2);
  // rows of merged cells, then merge identical rows vertically
  const rows: { y0: number; y1: number; runs: [number, number][] }[] = [];
  for (let j = 0; j + 1 < Y.length; j++) {
    const runs: [number, number][] = [];
    for (let i = 0; i + 1 < X.length; i++) {
      if (X[i + 1] - X[i] < 1e-6 || Y[j + 1] - Y[j] < 1e-6 || inCut((X[i] + X[i + 1]) / 2, (Y[j] + Y[j + 1]) / 2)) continue;
      const last = runs[runs.length - 1];
      if (last && Math.abs(last[1] - X[i]) < 1e-9) last[1] = X[i + 1]; else runs.push([X[i], X[i + 1]]);
    }
    if (runs.length) rows.push({ y0: Y[j], y1: Y[j + 1], runs });
  }
  const out: ChassisRect[] = [];
  const open = new Map<string, { x0: number; x1: number; y0: number; y1: number }>();
  for (const row of rows) {
    const seen = new Set<string>();
    for (const [x0, x1] of row.runs) {
      const k = `${x0.toFixed(6)}|${x1.toFixed(6)}`;
      seen.add(k);
      const o = open.get(k);
      if (o && Math.abs(o.y1 - row.y0) < 1e-9) o.y1 = row.y1; else { if (o) out.push({ cx: (o.x0 + o.x1) / 2, cy: (o.y0 + o.y1) / 2, w: o.x1 - o.x0, h: o.y1 - o.y0 }); open.set(k, { x0, x1, y0: row.y0, y1: row.y1 }); }
    }
    for (const [k, o] of [...open]) if (!seen.has(k)) { out.push({ cx: (o.x0 + o.x1) / 2, cy: (o.y0 + o.y1) / 2, w: o.x1 - o.x0, h: o.y1 - o.y0 }); open.delete(k); }
  }
  for (const o of open.values()) out.push({ cx: (o.x0 + o.x1) / 2, cy: (o.y0 + o.y1) / 2, w: o.x1 - o.x0, h: o.y1 - o.y0 });
  const res = out.length ? out : [{ cx: 0, cy: 0, w: cfg.width, h: cfg.length }];
  if (rectCache.size > 50) rectCache.clear();
  rectCache.set(key, res);
  return res;
}

/** The scoring point: where a Goal has to be for the Place action to work, in the robot frame. */
export interface ScoreSpec {
  side: "front" | "back";
  /** sideways offset of the point, + = right of center (as seen from the robot) */
  x?: number;
  /** how far inside the frame edge the point sits, in (a mechanism in a cutout: the Goal reaches into the chassis) */
  inset?: number;
  /** how far from the point a Goal's center may be, in (default: the game's Goal reach) */
  reach?: number;
}

export function scoreSpecOf(cfg: Pick<RobotConfig, "scoring" | "scoreSide">): ScoreSpec {
  return cfg.scoring ?? { side: cfg.scoreSide ?? "front" };
}

export interface IntakeSpec {
  /** sideways offset of the pickup zone's center, + = right (default 0) */
  x?: number;
  /** how far the zone starts INSIDE the frame edge, in (pickup mechanism sitting in a cutout). Default 0 = starts at the edge. */
  inset?: number;
  /** Depth ahead of the front edge, inches */
  reach: number;
  /** Width of the capture zone, inches */
  width: number;
  /** Max objects held */
  capacity: number;
  /** Only picks up objects that are standing upright (not lying on their side). Default false = any orientation. */
  standingOnly?: boolean;
}

export const IN = 0.0254;

export function defaultOdom(): OdomConfig {
  return {
    trackingWheels: [],
    useImu: true,
    imuDriftDegPerSec: 0.01,
    imuNoiseDeg: 0.02,
    imuScaleError: 0.001,
    wheelScaleError: 0.003,
  };
}

export function defaultRobot(): RobotConfig {
  return {
    name: "6-wheel 4-motor drive",
    motorsPerSide: 2,
    motorWatts: 11,
    cartridge: 600,
    drivingTeeth: 36,
    drivenTeeth: 48,
    wheelDiameter: 3.25,
    trackWidth: 12.5,
    length: 15,
    width: 15,
    cutouts: [],
    mass: 6.5,
    inertia: null,
    wheels: [
      { type: "omni", x: 5 },
      { type: "traction", x: 0 },
      { type: "omni", x: -5 },
    ],
    brake: "brake",
    odom: defaultOdom(),
    lateral: { kP: 10, kI: 0, kD: 3, windupRange: 3, smallError: 1, smallErrorTimeout: 100, largeError: 3, largeErrorTimeout: 500, slew: 20 },
    angular: { kP: 2, kI: 0, kD: 10, windupRange: 3, smallError: 1, smallErrorTimeout: 100, largeError: 3, largeErrorTimeout: 500, slew: 0 },
    horizontalDrift: 8,
    otherMotorsW: 33,
    grip: 1,
    efficiency: 0.88,
    intake: { reach: 4, width: 12, capacity: 6 },
  };
}

export interface DerivedRobot {
  motor: MotorSpec;
  ratio: number; // wheel speed / motor-output speed
  wheelRadius: number; // m
  inertia: number; // kg·m²
  /** Wheel rpm (LemLib "drivetrain rpm", EZ-Template "Wheel RPM") */
  wheelRpm: number;
  /** Free (no-load) linear speed, in/s */
  freeSpeed: number;
  /** Free turn rate, deg/s */
  freeTurnRate: number;
}

export function derive(cfg: RobotConfig): DerivedRobot {
  const motor = motorSpec(cfg.motorWatts, cfg.cartridge);
  const ratio = cfg.drivingTeeth / cfg.drivenTeeth;
  const wheelRadius = (cfg.wheelDiameter / 2) * IN;
  const l = cfg.length * IN;
  const w = cfg.width * IN;
  const inertia = cfg.inertia ?? (cfg.mass * (l * l + w * w)) / 12;
  const wheelOmega = motor.freeSpeed * ratio;
  const freeSpeed = (wheelOmega * wheelRadius) / IN;
  const freeTurnRate = ((2 * freeSpeed) / cfg.trackWidth) * (180 / Math.PI);
  return { motor, ratio, wheelRadius, inertia, wheelRpm: cfg.cartridge * ratio, freeSpeed, freeTurnRate };
}
