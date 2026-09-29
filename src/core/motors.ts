/** V5 smart motor model. Coordinates/units: SI internally (N·m, rad/s), inches elsewhere. */

export type MotorWatts = 11 | 5.5;
export type Cartridge = 100 | 200 | 600;

export interface MotorSpec {
  /** Stall torque at the output shaft, N·m */
  stallTorque: number;
  /** Free speed at the output shaft, rad/s */
  freeSpeed: number;
  /** Stall current, A */
  stallCurrent: number;
}

const RPM_TO_RADS = (2 * Math.PI) / 60;

/**
 * 11W V5 motor: 2.1 N·m stall @ 200 rpm (green). Other cartridges trade speed for torque at
 * constant power (Pmax = T·w/4 = 11 W, checked in tests).
 * UNVERIFIED: stall current (2.5 A) and the 5.5 W model (modelled as half the torque at the
 * same free speed, so Pmax = 5.5 W).
 */
export function motorSpec(watts: MotorWatts, cartridge: Cartridge): MotorSpec {
  const stall11 = 2.1 * (200 / cartridge);
  const scale = watts === 11 ? 1 : 0.5;
  return {
    stallTorque: stall11 * scale,
    freeSpeed: cartridge * RPM_TO_RADS,
    stallCurrent: 2.5 * scale,
  };
}

export interface MotorBudgetRules {
  /** Total robot motor power cap, W */
  totalCapW: number;
  /** Drivetrain ("Subsystem 1") cap, W, or null when the game has none */
  drivetrainCapW: number | null;
}

export interface MotorBudget {
  totalW: number;
  drivetrainW: number;
  legal: boolean;
  problems: string[];
}

export function motorBudget(
  driveMotors: { count: number; watts: MotorWatts },
  otherMotorsW: number,
  rules: MotorBudgetRules,
): MotorBudget {
  const drivetrainW = driveMotors.count * driveMotors.watts;
  const totalW = drivetrainW + otherMotorsW;
  const problems: string[] = [];
  if (totalW > rules.totalCapW) problems.push(`Total ${totalW} W exceeds ${rules.totalCapW} W cap`);
  if (rules.drivetrainCapW !== null && drivetrainW > rules.drivetrainCapW)
    problems.push(`Drivetrain ${drivetrainW} W exceeds ${rules.drivetrainCapW} W subsystem cap`);
  return { totalW, drivetrainW, legal: problems.length === 0, problems };
}
