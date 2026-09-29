import { simplifyPolyline } from "./autoroute";
import { normalize } from "./common-plan";
import { planPoses } from "./common-plan";
import { samplePath } from "./path";
import type { RobotConfig } from "./robot";
import { defaultMotion, uid, type MotionSpec, type Routine, type Step } from "./routine";

/**
 * Simple mode: only straight legs and turns. Curves (paths, boomerang poses, swings) become moveToPoint + turnToHeading, so the
 * whole route is a polyline. Actions stay on the step that finishes each original step.
 */
export function toStraightLines(r: Routine, cfg: RobotConfig): Routine {
  const poses = planPoses(r, cfg);
  const steps: Step[] = [];
  r.steps.forEach((s, i) => {
    const m = s.motion;
    const before = poses.before[i];
    if (m.type === "follow") {
      const pts = samplePath(m.path);
      const idx = pts.length > 2 ? simplifyPolyline(pts, 2) : [0, pts.length - 1];
      const legs = idx.slice(1).map((k) => pts[k]);
      legs.forEach((p, k) => {
        const mv = defaultMotion("moveToPoint", { x: p.x, y: p.y, heading: 0 });
        if (mv.type !== "moveToPoint") return;
        mv.forwards = m.forwards; mv.maxSpeed = m.path.maxSpeed; mv.timeout = Math.max(1500, m.timeout / Math.max(1, legs.length) + 800);
        if (k < legs.length - 1) { mv.minSpeed = 45; mv.earlyExit = 6; }
        steps.push({ id: k === legs.length - 1 ? s.id : uid(), motion: mv, actions: k === legs.length - 1 ? s.actions : k === 0 ? s.actions.filter((a) => a.when.kind === "start") : [] });
      });
      if (!legs.length) steps.push(s);
    } else if (m.type === "moveToPose") {
      const mv: MotionSpec = { type: "moveToPoint", x: m.x, y: m.y, forwards: m.forwards, maxSpeed: m.maxSpeed, minSpeed: m.minSpeed, earlyExit: m.earlyExit, timeout: m.timeout };
      steps.push({ ...s, motion: mv, actions: s.actions.filter((a) => a.when.kind !== "end") });
      const turn = defaultMotion("turnToHeading", { x: m.x, y: m.y, heading: m.heading });
      steps.push({ id: uid(), motion: turn, actions: s.actions.filter((a) => a.when.kind === "end") });
      void before;
    } else if (m.type === "swingToHeading") {
      steps.push({ ...s, motion: { type: "turnToHeading", heading: m.heading, direction: "auto", maxSpeed: m.maxSpeed, minSpeed: m.minSpeed, earlyExit: m.earlyExit, timeout: m.timeout } });
    } else steps.push(s);
  });
  // a turn to the heading the robot already has is noise
  const out: Step[] = [];
  const after = planPoses({ ...r, steps }, cfg);
  steps.forEach((s, i) => {
    if (s.motion.type === "turnToHeading" && !s.actions.length && Math.abs(normalize(s.motion.heading - after.before[i].heading)) < 2) return;
    out.push(s);
  });
  return { ...r, steps: out };
}
