import { motorSpec, type Cartridge, type MotorSpec, type MotorWatts } from "./motors";

export type WheelType = "omni" | "traction";

export interface WheelSpec {
  type: WheelType;
  /** Longitudinal offset from robot center, inches (+ = front) */
  x: number;
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
  wheelDiameter: number; // in
  trackWidth: number; // in, center-to-center of the left/right wheels
  length: number; // in
  width: number; // in
  mass: number; // kg
  /** Moment of inertia about the vertical axis, kg·m². null = derive from a uniform box */
  inertia: number | null;
  /** Wheels on ONE side (mirrored to the other) */
  wheels: WheelSpec[];
}

export const IN = 0.0254;

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
  };
}

export interface DerivedRobot {
  motor: MotorSpec;
  ratio: number; // wheel speed / motor-output speed
  wheelRadius: number; // m
  inertia: number; // kg·m²
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
  return { motor, ratio, wheelRadius, inertia, freeSpeed, freeTurnRate };
}
