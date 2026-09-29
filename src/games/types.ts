import type { MotorBudgetRules } from "../core/motors";
import type { GameObject, Obstacle, World, WorldInit } from "../core/world";

/** A value that has (or hasn't) been checked against the official manual. */
export interface Sourced<T> {
  value: T;
  verified: boolean;
  source?: string;
}

export type ZoneShape =
  | { shape: "rect"; x: number; y: number; w: number; h: number }
  | { shape: "circle"; x: number; y: number; r: number };

export interface ScoringZone {
  id: string;
  label: string;
  geom: ZoneShape;
  /** Object kinds counted here */
  accepts: string[];
  /** Points per accepted object (by object team color; neutral objects use `neutralPoints`) */
  points: number;
  /** Max objects counted */
  capacity?: number;
  /** Drawn colour hint */
  color?: string;
}

export interface StartPosition {
  label: string;
  x: number;
  y: number;
  heading: number;
  alliance: "red" | "blue";
}

export interface ScoreResult {
  red: number;
  blue: number;
  lines: { label: string; red: number; blue: number }[];
}

export interface FieldLine {
  x1: number; y1: number; x2: number; y2: number; color?: string;
}

export interface GameModule {
  id: string;
  name: string;
  season: string;
  manualVersion: string | null;
  fieldSize: Sourced<number>;
  autonSeconds: Sourced<number>;
  driverSeconds: Sourced<number>;
  robotRules: MotorBudgetRules & { verified: boolean };
  /** Max starting size, inches */
  startingSize: Sourced<number> | null;
  /** Practice layout is approximate, NOT taken from the manual */
  layoutApproximate: boolean;
  zones: ScoringZone[];
  starts: StartPosition[];
  lines: FieldLine[];
  /** Objects/obstacles at match start */
  objects: Omit<GameObject, "vx" | "vy" | "state">[];
  obstacles: Obstacle[];
  score(world: World): ScoreResult;
  notes: string[];
}

export function worldInit(g: GameModule): WorldInit {
  return { fieldSize: g.fieldSize.value, objects: g.objects, obstacles: g.obstacles };
}

/** Field layout that users can import/export as JSON to correct the practice layouts. */
export interface CustomField {
  objects: GameModule["objects"];
  obstacles: Obstacle[];
  zones: ScoringZone[];
}
