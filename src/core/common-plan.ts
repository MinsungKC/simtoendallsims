import type { RobotConfig } from "./robot";
import type { Routine } from "./routine";
import { buildPathPoints } from "./path";

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

