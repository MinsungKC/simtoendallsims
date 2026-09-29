/**
 * Auton routine data model. This is the single source of truth: the editor edits it, the simulator
 * executes it (through the LemLib-faithful controllers), and the code generators emit it.
 * Coordinates: inches, field center origin, x right, y up. Heading degrees, 0 = +y, clockwise +.
 */

export type Trigger =
  | { kind: "start" }
  | { kind: "end" }
  | { kind: "distance"; value: number } // inches traveled (turns: degrees turned) in the step - LemLib waitUntil()
  | { kind: "delay"; ms: number };

export type ActionType = "intakeIn" | "intakeOut" | "intakeStop" | "rearIntakeIn" | "rearIntakeStop" | "clamp" | "unclamp" | "eject" | "place" | "toggleSet" | "custom";

export interface ActionSpec {
  id: string;
  type: ActionType;
  when: Trigger;
  /** custom: raw C++ emitted verbatim */
  code?: string;
  /** place: prefer "pin" | "cup" | "any"; toggleSet: "red" | "blue" | "yellow" */
  arg?: string;
  label?: string;
}

export interface BezierSegment {
  /** 4 control points: p0 start, p1, p2, p3 end */
  p: [Vec, Vec, Vec, Vec];
}
export interface Vec { x: number; y: number }

export interface PathSpec {
  segments: BezierSegment[];
  /** Target cruise speed, 0-127 (LemLib path speed units) */
  maxSpeed: number;
  /** Minimum speed the path is allowed to slow to in curves */
  minSpeed: number;
  /** Max deceleration rate used when planning the speed profile (path.jerryio units: power^2 per inch scale) */
  decel: number;
  /** Spacing of generated points, inches */
  spacing: number;
}

interface Common {
  /** step timeout, ms */
  timeout: number;
}

export type MotionSpec =
  | { type: "setPose"; x: number; y: number; heading: number }
  | ({ type: "moveToPoint"; x: number; y: number; forwards: boolean; maxSpeed: number; minSpeed: number; earlyExit: number } & Common)
  | ({ type: "moveToPose"; x: number; y: number; heading: number; forwards: boolean; lead: number; maxSpeed: number; minSpeed: number; earlyExit: number; horizontalDrift: number } & Common)
  | ({ type: "turnToHeading"; heading: number; direction: "auto" | "cw" | "ccw"; maxSpeed: number; minSpeed: number; earlyExit: number } & Common)
  | ({ type: "turnToPoint"; x: number; y: number; forwards: boolean; maxSpeed: number; minSpeed: number; earlyExit: number } & Common)
  | ({ type: "swingToHeading"; heading: number; lock: "left" | "right"; maxSpeed: number; minSpeed: number; earlyExit: number } & Common)
  | ({ type: "follow"; path: PathSpec; lookahead: number; forwards: boolean } & Common)
  | { type: "wait"; ms: number };

export interface Step {
  id: string;
  motion: MotionSpec;
  actions: ActionSpec[];
  label?: string;
}

export interface Routine {
  name: string;
  gameId: string;
  alliance: "red" | "blue";
  start: { x: number; y: number; heading: number };
  steps: Step[];
}

let counter = 0;
export function uid(prefix = "s"): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

export function emptyRoutine(gameId = "blank"): Routine {
  return { name: "Auton 1", gameId, alliance: "red", start: { x: -48, y: -60, heading: 0 }, steps: [] };
}

export function defaultMotion(type: MotionSpec["type"], at: { x: number; y: number; heading: number }): MotionSpec {
  switch (type) {
    case "setPose": return { type, x: at.x, y: at.y, heading: at.heading };
    case "moveToPoint": return { type, x: at.x, y: at.y, forwards: true, maxSpeed: 127, minSpeed: 0, earlyExit: 0, timeout: 3000 };
    case "moveToPose": return { type, x: at.x, y: at.y, heading: at.heading, forwards: true, lead: 0.6, maxSpeed: 127, minSpeed: 0, earlyExit: 0, horizontalDrift: 0, timeout: 4000 };
    case "turnToHeading": return { type, heading: at.heading, direction: "auto", maxSpeed: 127, minSpeed: 0, earlyExit: 0, timeout: 2000 };
    case "turnToPoint": return { type, x: at.x, y: at.y, forwards: true, maxSpeed: 127, minSpeed: 0, earlyExit: 0, timeout: 2000 };
    case "swingToHeading": return { type, heading: at.heading, lock: "left", maxSpeed: 127, minSpeed: 0, earlyExit: 0, timeout: 2000 };
    case "follow":
      return {
        type, forwards: true, lookahead: 12, timeout: 4000,
        path: {
          segments: [{ p: [{ x: at.x, y: at.y }, { x: at.x, y: at.y + 12 }, { x: at.x + 12, y: at.y + 24 }, { x: at.x + 24, y: at.y + 24 }] }],
          maxSpeed: 100, minSpeed: 30, decel: 3000, spacing: 2,
        },
      };
    case "wait": return { type, ms: 500 };
  }
}

/** Mirror a pose across the field's vertical axis (red <-> blue). */
export function mirrorX(v: { x: number; y: number }): { x: number; y: number } {
  return { x: -v.x, y: v.y };
}
export function mirrorHeading(h: number): number {
  return -h;
}

export function mirrorRoutine(r: Routine): Routine {
  const m = (s: Step): Step => {
    const mo = s.motion;
    let motion: MotionSpec = mo;
    switch (mo.type) {
      case "setPose": motion = { ...mo, x: -mo.x, heading: -mo.heading }; break;
      case "moveToPoint":
      case "turnToPoint": motion = { ...mo, x: -mo.x }; break;
      case "moveToPose": motion = { ...mo, x: -mo.x, heading: -mo.heading }; break;
      case "turnToHeading": motion = { ...mo, heading: -mo.heading, direction: mo.direction === "cw" ? "ccw" : mo.direction === "ccw" ? "cw" : "auto" }; break;
      case "swingToHeading": motion = { ...mo, heading: -mo.heading, lock: mo.lock === "left" ? "right" : "left" }; break;
      case "follow":
        motion = { ...mo, path: { ...mo.path, segments: mo.path.segments.map((sg) => ({ p: sg.p.map((q) => ({ x: -q.x, y: q.y })) as BezierSegment["p"] })) } };
        break;
      case "wait": break;
    }
    return { ...s, motion };
  };
  return {
    ...r,
    alliance: r.alliance === "red" ? "blue" : "red",
    start: { x: -r.start.x, y: r.start.y, heading: -r.start.heading },
    steps: r.steps.map(m),
  };
}

/**
 * The other Alliance's version of a routine on a field that is symmetric under a 180-degree turn (Override): the red and blue
 * Goals swap places under a rotation, not under a left-right flip. Turning direction and swing sides are unchanged (a rotation
 * keeps handedness).
 */
export function rotateRoutine(r: Routine): Routine {
  const p = (v: { x: number; y: number }) => ({ x: -v.x, y: -v.y });
  const h = (a: number) => { let d = (a + 180) % 360; if (d > 180) d -= 360; if (d <= -180) d += 360; return d; };
  const m = (s: Step): Step => {
    const mo = s.motion;
    let motion: MotionSpec = mo;
    switch (mo.type) {
      case "setPose": motion = { ...mo, ...p(mo), heading: h(mo.heading) }; break;
      case "moveToPoint":
      case "turnToPoint": motion = { ...mo, ...p(mo) }; break;
      case "moveToPose": motion = { ...mo, ...p(mo), heading: h(mo.heading) }; break;
      case "turnToHeading":
      case "swingToHeading": motion = { ...mo, heading: h(mo.heading) }; break;
      case "follow": motion = { ...mo, path: { ...mo.path, segments: mo.path.segments.map((sg) => ({ p: sg.p.map(p) as BezierSegment["p"] })) } }; break;
      case "wait": break;
    }
    return { ...s, motion };
  };
  return { ...r, alliance: r.alliance === "red" ? "blue" : "red", start: { ...p(r.start), heading: h(r.start.heading) }, steps: r.steps.map(m) };
}
