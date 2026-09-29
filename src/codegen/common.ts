import type { RobotConfig } from "../core/robot";
import type { ActionSpec, MotionSpec, Routine, Step } from "../core/routine";
import { buildPathPoints } from "../core/path";

/** Trim trailing zeros: 12.50 -> 12.5, 3.000 -> 3 */
export function num(n: number, digits = 3): string {
  const s = Number(n.toFixed(digits)).toString();
  return s === "-0" ? "0" : s;
}

export function ident(name: string): string {
  const s = name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^([0-9])/, "_$1");
  return s || "auton";
}

/** Pose the robot is expected to be at before each step, assuming every motion lands exactly on target. */
export interface Planned { x: number; y: number; heading: number }

export function bearing(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return (Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI;
}

export function normalize(h: number): number {
  let d = h % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export function planPoses(r: Routine, cfg: RobotConfig): { before: Planned[]; after: Planned[] } {
  let cur: Planned = { ...r.start };
  const before: Planned[] = [];
  const after: Planned[] = [];
  for (const s of r.steps) {
    before.push({ ...cur });
    const m = s.motion;
    switch (m.type) {
      case "setPose": cur = { x: m.x, y: m.y, heading: m.heading }; break;
      case "moveToPoint": {
        const b = bearing(cur, m);
        cur = { x: m.x, y: m.y, heading: m.forwards ? b : normalize(b + 180) };
        if (Math.hypot(m.x - before[before.length - 1].x, m.y - before[before.length - 1].y) < 1e-6) cur.heading = before[before.length - 1].heading;
        break;
      }
      case "moveToPose": cur = { x: m.x, y: m.y, heading: m.heading }; break;
      case "turnToHeading": case "swingToHeading": cur = { ...cur, heading: m.heading }; break;
      case "turnToPoint": { const b = bearing(cur, m); cur = { ...cur, heading: m.forwards ? b : normalize(b + 180) }; break; }
      case "follow": {
        const pts = buildPathPoints(m.path, cfg.trackWidth);
        if (pts.length >= 2) {
          const a = pts[pts.length - 2], b = pts[pts.length - 1];
          const h = bearing(a, b);
          cur = { x: b.x, y: b.y, heading: m.forwards ? h : normalize(h + 180) };
        }
        break;
      }
      case "wait": break;
    }
    after.push({ ...cur });
  }
  return { before, after };
}

/** Actions in the order the generated (sequential) code executes them within a step. */
export function splitActions(step: Step): { start: ActionSpec[]; mid: ActionSpec[]; end: ActionSpec[] } {
  return {
    start: step.actions.filter((a) => a.when.kind === "start"),
    mid: step.actions.filter((a) => a.when.kind === "distance" || a.when.kind === "delay"),
    end: step.actions.filter((a) => a.when.kind === "end"),
  };
}

export function describeMotion(m: MotionSpec): string {
  switch (m.type) {
    case "setPose": return `Set start pose (${num(m.x, 1)}, ${num(m.y, 1)}, ${num(m.heading, 1)}°)`;
    case "moveToPoint": return `${m.forwards ? "Drive" : "Reverse"} to (${num(m.x, 1)}, ${num(m.y, 1)})`;
    case "moveToPose": return `${m.forwards ? "Drive" : "Reverse"} to pose (${num(m.x, 1)}, ${num(m.y, 1)}, ${num(m.heading, 1)}°)`;
    case "turnToHeading": return `Turn to ${num(m.heading, 1)}°`;
    case "turnToPoint": return `Turn to face (${num(m.x, 1)}, ${num(m.y, 1)})`;
    case "swingToHeading": return `Swing to ${num(m.heading, 1)}° (lock ${m.lock})`;
    case "follow": return `Follow path (${m.path.segments.length} segment${m.path.segments.length === 1 ? "" : "s"})`;
    case "wait": return `Wait ${m.ms} ms`;
  }
}

/** Mechanism code that is identical in every C++ target. `intake` and `clamp` objects are declared per target. */
export function actionCpp(a: ActionSpec, hasIntake: boolean): string[] {
  const intake = (s: string) => (hasIntake ? [s] : [`// ${s.replace(/;$/, "")}  (no intake configured)`]);
  switch (a.type) {
    case "intakeIn": return intake("intake.move(127);");
    case "intakeOut": return intake("intake.move(-127);");
    case "intakeStop": return intake("intake.move(0);");
    case "eject": return hasIntake ? ["intake.move(-127);", "pros::delay(250);", "intake.move(0);"] : ["// eject (no intake configured)"];
    case "clamp": return ["clamp_piston.set_value(true);"];
    case "unclamp": return ["clamp_piston.set_value(false);"];
    case "custom": return (a.code ?? "// custom action").split("\n");
  }
}

export function indent(lines: string[], n = 4): string[] {
  const pad = " ".repeat(n);
  return lines.map((l) => (l.length ? pad + l : l));
}

export function motorList(ports: number[]): string {
  return `{${ports.join(", ")}}`;
}

export function pathAssetName(index: number): string {
  return `path_${index}_txt`;
}

/** Number of `follow` steps before index i (for stable asset naming). */
export function pathIndices(r: Routine): Map<string, number> {
  const map = new Map<string, number>();
  let n = 0;
  for (const s of r.steps) if (s.motion.type === "follow") map.set(s.id, ++n);
  return map;
}

export function speedToVolts(speed: number): number {
  return Math.round((speed / 127) * 12 * 10) / 10;
}
