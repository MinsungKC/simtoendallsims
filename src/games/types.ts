import type { MotorBudgetRules } from "../core/motors";
import type { GameObject, GameRules, GoalState, Obstacle, ToggleState, World, WorldInit } from "../core/world";
import type { Vec } from "../core/geometry";
import type { RobotConfig } from "../core/robot";
import type { Routine } from "../core/routine";
import type { Recording } from "../core/runtime";

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
  /** Extra information (Autonomous Win Point status, ...) */
  notes?: string[];
}

/** Drawn field regions (Midfield, Load Zones, ...). */
export interface FieldPoly {
  verts: Vec[];
  label?: string;
  fill?: string;
  stroke?: string;
}

export interface RuleFinding {
  level: "error" | "warn";
  text: string;
  /** Step index the finding relates to (-1 = whole routine) */
  step?: number;
}

export interface RuleContext {
  routine: Routine;
  cfg: RobotConfig;
  recording: Recording;
  world: World;
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
  /** Static, interactive game elements (Goals with stacks, Toggles) and their rules */
  goals?: Omit<GoalState, "stack">[];
  toggles?: ToggleState[];
  rules?: GameRules;
  polys?: FieldPoly[];
  /** Object held by the robot at the start of the match (a Preload) */
  preload?: (alliance: "red" | "blue") => Omit<GameObject, "vx" | "vy" | "state"> | null;
  /** Post-run rule checks (Autonomous Line, protected Goals, start legality, ...) */
  check?: (ctx: RuleContext) => RuleFinding[];
  /** Field elements whose position/size were reconstructed rather than read from the manual */
  provenance?: { item: string; source: string; confidence: "manual" | "community" | "assumed" }[];
}

export function worldInit(g: GameModule, alliance: "red" | "blue" = "red"): WorldInit {
  const preload = g.preload?.(alliance);
  return {
    fieldSize: g.fieldSize.value,
    objects: preload ? [...g.objects, preload] : g.objects,
    obstacles: g.obstacles,
    goals: g.goals,
    toggles: g.toggles,
    rules: g.rules,
  };
}

/** Field layout that users can import/export as JSON to correct the practice layouts. */
export interface CustomField {
  objects: GameModule["objects"];
  obstacles: Obstacle[];
  zones: ScoringZone[];
}
