import type { RobotConfig } from "../core/robot";
import type { Routine } from "../core/routine";
import type { Recording } from "../core/runtime";

export type TargetId = "lemlib" | "ez-template" | "jar-template" | "generic-pros";

export interface TrackingPorts {
  /** V5 Rotation Sensor smart port (1-21), negative = reversed. Ignored if `adi` is set */
  port: number;
  /** Optional ADI encoder pair, e.g. ["C","D"] */
  adi?: [string, string];
  reversed?: boolean;
}

/** User-editable hardware wiring; codegen only emits what the sim can't know. */
export interface Ports {
  /** PROS convention: negative port = reversed motor */
  left: number[];
  right: number[];
  imu: number;
  intake: number[];
  intakeCartridge: 100 | 200 | 600;
  /** ADI port letter for the clamp piston */
  clamp: string;
  tracking: TrackingPorts[]; // parallel to cfg.odom.trackingWheels
  controller: "arcade" | "tank";
}

export function defaultPorts(cfg: RobotConfig): Ports {
  const n = cfg.motorsPerSide;
  return {
    left: Array.from({ length: n }, (_, i) => -(i + 1)),
    right: Array.from({ length: n }, (_, i) => n + i + 1),
    imu: 10,
    intake: cfg.intake ? [9] : [],
    intakeCartridge: 600,
    clamp: "A",
    tracking: cfg.odom.trackingWheels.map((_, i) => ({ port: 11 + i })),
    controller: "arcade",
  };
}

export interface GenFile {
  path: string;
  content: string;
  /** Extra project files the user must add (e.g. path assets) are still regular files */
  note?: string;
}

export interface GenResult {
  target: TargetId;
  title: string;
  /** Library version the code was written against */
  version: string;
  files: GenFile[];
  /** Things the user must do (install library, tune...) */
  notes: string[];
  /** Places the target library can't express what the routine asks for */
  warnings: string[];
}

export interface GenInput {
  routine: Routine;
  cfg: RobotConfig;
  ports: Ports;
  /** Simulation recording, used by targets without async motions to time mechanism triggers */
  recording?: Recording;
  /** Gains derived for the target library (or the sim's LemLib gains) */
  fnName?: string;
}
