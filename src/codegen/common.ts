import type { ActionSpec, MotionSpec, Routine, Step } from "../core/routine";

/** Trim trailing zeros: 12.50 -> 12.5, 3.000 -> 3 */
export function num(n: number, digits = 3): string {
  const s = Number(n.toFixed(digits)).toString();
  return s === "-0" ? "0" : s;
}

export function ident(name: string): string {
  const s = name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^([0-9])/, "_$1");
  return s || "auton";
}

export { bearing, normalize, planPoses, type Planned } from "../core/common-plan";

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
export function actionCpp(a: ActionSpec, hasIntake: boolean, hasRear = false): string[] {
  const rear = (s: string) => (hasRear ? [s] : [`// ${s.replace(/;$/, "")}  (no rear intake ports set)`]);
  const intake = (s: string) => (hasIntake ? [s] : [`// ${s.replace(/;$/, "")}  (no intake configured)`]);
  switch (a.type) {
    case "intakeIn": return intake("intake.move(127);");
    case "intakeOut": return intake("intake.move(-127);");
    case "intakeStop": return intake("intake.move(0);");
    case "rearIntakeIn": return rear("rear_intake.move(127);");
    case "rearIntakeStop": return rear("rear_intake.move(0);");
    case "eject": return hasIntake ? ["intake.move(-127);", "pros::delay(250);", "intake.move(0);"] : ["// eject (no intake configured)"];
    case "clamp": return ["clamp_piston.set_value(true);"];
    case "unclamp": return ["clamp_piston.set_value(false);"];
    case "place": return ["place_on_goal();"];
    case "toggleSet": return [`set_toggle_${a.arg ?? "red"}();`];
    case "custom": return (a.code ?? "// custom action").split("\n");
  }
}

/** Stub definitions for mechanism functions the routine calls, so generated code always compiles. */
export function mechanismStubs(r: Routine): string[] {
  const names = new Map<string, string>();
  for (const s of r.steps) {
    for (const a of s.actions) {
      if (a.type === "place") names.set("place_on_goal", "score the held object onto the Goal in front of the robot (the simulator nests it onto the stack)");
      if (a.type === "toggleSet") names.set(`set_toggle_${a.arg ?? "red"}`, `flip the Toggle in front of the robot to ${a.arg ?? "red"}`);
    }
  }
  if (!names.size) return [];
  const out = ["// Mechanism stubs - fill these in with your robot's code."];
  for (const [n, doc] of names) out.push(`// TODO: ${doc}`, `void ${n}() {}`, "");
  return out;
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
