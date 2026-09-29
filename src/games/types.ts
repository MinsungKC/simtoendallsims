import type { MotorBudgetRules } from "../core/motors";

/** A value that has (or hasn't) been checked against the official manual. */
export interface Sourced<T> {
  value: T;
  verified: boolean;
  source?: string;
}

export interface GameModule {
  id: string;
  name: string;
  season: string;
  manualVersion: string | null;
  /** Field is square, centered on the origin: x right, y up, inches */
  fieldSize: Sourced<number>;
  autonSeconds: Sourced<number>;
  driverSeconds: Sourced<number>;
  robotRules: MotorBudgetRules & { verified: boolean };
  /** Max starting size, inches (null = unknown/none) */
  startingSize: Sourced<number> | null;
  /** Static, axis-aligned collision boxes (goals, barriers...). Filled in M4. */
  obstacles: { x: number; y: number; w: number; h: number; label: string }[];
  notes: string[];
}
