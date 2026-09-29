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
  /** Intake capture zone in front of the robot (robot frame), inches. null = none */
  intake: IntakeSpec | null;
}

export interface IntakeSpec {
  /** Depth ahead of the front edge, inches */
  reach: number;
  /** Width of the capture zone, inches */
  width: number;
  /** Max objects held */
  capacity: number;
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
