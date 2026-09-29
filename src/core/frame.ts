import type { BezierSegment, MotionSpec, Routine, Step } from "./routine";
import { normalize } from "./common-plan";

/**
 * Coordinate frame the generated code uses.
 *  - "start":         origin = the robot's starting position, so it starts at (0, 0) and keeps its heading
 *                     (axes stay parallel to the field, so positive y is still field-north).
 *  - "start-rotated": origin = the starting position AND heading 0 = the way the robot faces at the start.
 *                     Everything is expressed in the robot's own starting frame; the routine works wherever you line up.
 *  - "field":         field coordinates (origin at field center), exactly as drawn in the editor.
 */
export type CodeFrame = "start" | "start-rotated" | "field";

export const CODE_FRAMES: { id: CodeFrame; label: string; hint: string }[] = [
  { id: "start", label: "Start = (0, 0), keep heading", hint: "setPose(0, 0, heading). Axes stay parallel to the field." },
  { id: "start-rotated", label: "Start = (0, 0, 0°)", hint: "Fully relative: forward at the start is +y. Line the robot up anywhere." },
  { id: "field", label: "Field coordinates", hint: "Origin at field center, exactly as drawn." },
];

/** Re-express a routine in another frame. Pure; the input is not modified. */
export function toFrame(r: Routine, frame: CodeFrame): Routine {
  if (frame === "field") return r;
  const o = r.start;
  const rot = frame === "start-rotated";
  const h0 = (o.heading * Math.PI) / 180;
  const fx = Math.sin(h0), fy = Math.cos(h0); // start-forward
  const rx = Math.cos(h0), ry = -Math.sin(h0); // start-right
  const pt = (p: { x: number; y: number }) => {
    const dx = p.x - o.x, dy = p.y - o.y;
    return rot ? { x: dx * rx + dy * ry, y: dx * fx + dy * fy } : { x: dx, y: dy };
  };
  const hd = (h: number) => (rot ? normalize(h - o.heading) : h);
  const m = (s: Step): Step => {
    const mo: MotionSpec = s.motion;
    let motion: MotionSpec = mo;
    switch (mo.type) {
      case "setPose": motion = { ...mo, ...pt(mo), heading: hd(mo.heading) }; break;
      case "moveToPoint":
      case "turnToPoint": motion = { ...mo, ...pt(mo) }; break;
      case "moveToPose": motion = { ...mo, ...pt(mo), heading: hd(mo.heading) }; break;
      case "turnToHeading":
      case "swingToHeading": motion = { ...mo, heading: hd(mo.heading) }; break;
      case "follow":
        motion = { ...mo, path: { ...mo.path, segments: mo.path.segments.map((sg) => ({ p: sg.p.map(pt) as BezierSegment["p"] })) } };
        break;
      case "wait": break;
    }
    return { ...s, motion };
  };
  return { ...r, start: { ...pt(o), heading: hd(o.heading) }, steps: r.steps.map(m) };
}

/** Where to put the robot, in words, for the generated code's notes. */
export function frameNote(r: Routine, frame: CodeFrame): string {
  const { x, y, heading } = r.start;
  const at = `(${x.toFixed(1)}, ${y.toFixed(1)}) facing ${heading.toFixed(1)}°`;
  if (frame === "field") return `Coordinates are field coordinates (origin at field center). Place the robot at ${at}.`;
  if (frame === "start") return `Coordinates are relative to the starting position: the robot starts at (0, 0) facing ${heading.toFixed(1)}°. In the editor that spot is ${at}; place the robot there (or anywhere facing the same way) and the routine plays the same.`;
  return `Coordinates are relative to the starting pose: the robot starts at (0, 0, 0°) and +y is the way it faces. In the editor that spot is ${at}; you can line the robot up anywhere and the routine plays the same.`;
}
