import { fitStroke } from "./fit";
import { firstBlocked, findPath, type NavOptions } from "./nav";
import { pathLength, samplePath } from "./path";
import { normalize } from "./common-plan";
import type { RobotConfig } from "./robot";
import { defaultMotion, uid, type MotionSpec, type Step } from "./routine";

export type MoveStyle = "boomerang" | "pursuit" | "chained" | "safe";

export const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
export const bearing = (a: { x: number; y: number }, b: { x: number; y: number }) => (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI;
export const angleDiff = (a: number, b: number) => Math.abs(normalize(a - b));
export const timeoutFor = (len: number) => Math.max(1500, Math.ceil(((len / 12) * 1000 + 1500) / 100) * 100);

/** Grid route from a to b around Goals/walls at the full turning radius (or the half-width if that is walled off), else a straight line. */
export function routeBetween(from: { x: number; y: number }, to: { x: number; y: number }, nav: NavOptions, cfg: RobotConfig): { x: number; y: number }[] {
  return findPath(from, to, nav) ?? findPath(from, to, { ...nav, radius: cfg.width / 2 + 1 }) ?? [from, to];
}

export interface GroupArgs {
  cur: { x: number; y: number; h: number };
  /** where to end; h = the heading the robot must have there (null = whatever the last leg leaves) */
  pose: { x: number; y: number; h: number | null };
  path: { x: number; y: number }[];
  style: MoveStyle;
  /** travel speed 0-127 */
  speed: number;
  /** cap for the final approach (standing pieces tip at speed) */
  cap: number;
  /** drive through without stopping */
  pass?: boolean;
  nav: NavOptions;
  /** force a direction: true = drive forwards, false = in reverse; undefined = whichever needs less turning / ends on the wanted heading */
  forwards?: boolean;
}

/**
 * One way of getting from `cur` to `pose`: a boomerang move, a pure-pursuit curve, or turn-then-drive legs (chained or stop-and-go).
 * Boomerang and pursuit run forwards or backwards so they finish pointing the way the job needs. Returns the steps and the heading left.
 */
export function buildGroup(a: GroupArgs): { steps: Step[]; heading: number } {
  const { cur, pose, path, style, cap, nav } = a;
  const fast = style !== "safe";
  const group: Step[] = [];
  const uidStep = (motion: MotionSpec): Step => ({ id: uid(), motion, actions: [] });
  let h = cur.h;
  let pursued = false;
  if (style === "pursuit" && !a.pass && dist(cur, pose) > 12) {
    const dense: { x: number; y: number }[] = [];
    for (let k = 0; k + 1 < path.length; k++) { const n = Math.max(1, Math.ceil(dist(path[k], path[k + 1]) / 2)); for (let q = 0; q < n; q++) dense.push({ x: path[k].x + ((path[k + 1].x - path[k].x) * q) / n, y: path[k].y + ((path[k + 1].y - path[k].y) * q) / n }); }
    dense.push({ x: pose.x, y: pose.y });
    const segs = fitStroke(dense, 1.2);
    const fm = defaultMotion("follow", { x: cur.x, y: cur.y, heading: cur.h });
    if (fm.type === "follow" && segs.length) {
      fm.path.segments = segs.map((sg) => ({ p: sg.p.map((q) => ({ x: Math.round(q.x * 100) / 100, y: Math.round(q.y * 100) / 100 })) as typeof sg.p }));
      const pts = samplePath(fm.path);
      const first = segs[0].p, lastSeg = segs[segs.length - 1].p;
      const startTan = bearing(first[0], first[1].x === first[0].x && first[1].y === first[0].y ? first[2] : first[1]);
      const endTan = bearing(lastSeg[2].x === lastSeg[3].x && lastSeg[2].y === lastSeg[3].y ? lastSeg[1] : lastSeg[2], lastSeg[3]);
      const forwards = a.forwards ?? (pose.h !== null ? angleDiff(endTan, pose.h) <= 90 : angleDiff(h, startTan) <= 90);
      if (firstBlocked(pts, nav) < 0) {
        const want = forwards ? startTan : startTan + 180;
        if (angleDiff(h, want) > 20) group.push(uidStep({ ...defaultMotion("turnToHeading", { x: 0, y: 0, heading: Math.round(normalize(want)) }), timeout: 2000 } as MotionSpec));
        fm.forwards = forwards; fm.lookahead = 10;
        fm.path.maxSpeed = Math.min(a.speed, cap); fm.path.minSpeed = Math.min(40, fm.path.maxSpeed);
        fm.timeout = timeoutFor(pathLength(fm.path)) + 800;
        group.push(uidStep(fm));
        h = forwards ? endTan : endTan + 180;
        pursued = true;
      }
    }
  }
  for (let k = 1; !pursued && k < path.length; k++) {
    const from = path[k - 1], to = path[k];
    if (dist(from, to) < 0.5) continue;
    const lead = bearing(from, to);
    const fwd = angleDiff(h, lead), rev = angleDiff(h, lead + 180);
    const back = a.forwards !== undefined ? !a.forwards : rev + 8 < fwd;
    const legH = back ? lead + 180 : lead;
    const turn = angleDiff(h, legH);
    const last = k === path.length - 1;
    if (style === "boomerang" && last && pose.h !== null && !a.pass) {
      const fwdOk = a.forwards ?? angleDiff(lead, pose.h) <= 90;
      const bm = defaultMotion("moveToPose", { x: Math.round(to.x * 4) / 4, y: Math.round(to.y * 4) / 4, heading: pose.h });
      if (bm.type === "moveToPose") { bm.forwards = fwdOk; bm.lead = 0.4; bm.maxSpeed = Math.min(a.speed, cap); bm.timeout = timeoutFor(dist(from, to)) + 1500; group.push(uidStep(bm)); h = pose.h; continue; }
    }
    const gentle = fast && !last && turn < 25;
    if (turn > 6 && !gentle) group.push(uidStep({ ...defaultMotion("turnToPoint", { x: to.x, y: to.y, heading: 0 }), forwards: !back, timeout: 2500 } as MotionSpec));
    const mv = defaultMotion("moveToPoint", { x: Math.round(to.x * 4) / 4, y: Math.round(to.y * 4) / 4, heading: 0 });
    if (mv.type !== "moveToPoint") continue;
    mv.forwards = !back; mv.maxSpeed = last ? Math.min(a.speed, cap) : a.speed; mv.timeout = timeoutFor(dist(from, to)) + (last && cap < a.speed ? 1200 : 0);
    if (gentle || (fast && !last && a.pass) || (last && a.pass)) { mv.minSpeed = 45; mv.earlyExit = 6; }
    group.push(uidStep(mv));
    h = legH;
  }
  if (pose.h !== null && angleDiff(h, pose.h) > 2 && !a.pass) { group.push(uidStep({ ...defaultMotion("turnToHeading", { x: 0, y: 0, heading: Math.round(pose.h) }), timeout: 2000 } as MotionSpec)); h = pose.h; }
  return { steps: group, heading: h };
}
