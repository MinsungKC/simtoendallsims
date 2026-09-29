import { avoidObstacles, simplifyPolyline } from "./autoroute";
import { planPoses } from "./common-plan";
import { fitStroke } from "./fit";
import { samplePath } from "./path";
import type { RobotConfig } from "./robot";
import { defaultMotion, uid, type Routine, type Step } from "./routine";
import type { Obstacle } from "./world";

export interface AvoidSettings { goals: boolean; loaders: boolean; walls: boolean; pieces: boolean; /** extra clearance, inches */ margin: number }
export const DEFAULT_AVOID: AvoidSettings = { goals: true, loaders: true, walls: true, pieces: true, margin: 1 };

interface PieceLike { x: number; y: number; r: number; lying?: boolean; half?: number; stackedIn?: string; nestedIn?: number }

/** Radius of the circle the chassis sweeps when it turns in place. */
export const robotRadius = (cfg: Pick<RobotConfig, "length" | "width">): number => Math.hypot(cfg.length, cfg.width) / 2;

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** The solid things to keep clear of, given what the user ticked. Pieces the route deliberately drives to (intake steps) are exempt. */
export function avoidList(obstacles: Obstacle[], pieces: PieceLike[], s: AvoidSettings, routine: Routine, cfg: RobotConfig): Obstacle[] {
  const out = obstacles.filter((o) => (o.tag?.startsWith("goal:") && s.goals) || (o.tag === "loader" && s.loaders) || (!o.tag?.startsWith("goal:") && o.tag !== "loader" && o.tag !== "toggle"));
  if (s.pieces) {
    const poses = planPoses(routine, cfg);
    const wanted = routine.steps.flatMap((st, i) => (st.actions.some((a) => a.type === "intakeIn" || a.type === "rearIntakeIn") ? [poses.after[i]] : []));
    for (const p of pieces) {
      if (p.stackedIn || p.nestedIn !== undefined) continue;
      if (wanted.some((w) => dist(w, p) < 12)) continue;
      const h = p.r + (p.lying ? p.half ?? 0 : 0);
      out.push({ x: p.x, y: p.y, w: 2 * h, h: 2 * h, label: "piece", tag: "piece", keepOut: Math.max(3, cfg.width / 2 - 1) });
    }
  }
  return out;
}

/**
 * Re-route steps so the robot's path stays clear of `obstacles`: straight legs get bends inserted, curves are pushed away and refit.
 * Targets themselves are never moved. Returns how many steps changed.
 */
export function repairRoutine(r: Routine, cfg: RobotConfig, obstacles: Obstacle[], s: AvoidSettings, fieldSize: number, only?: string): { routine: Routine; changed: number } {
  const poses = planPoses(r, cfg);
  const clearance = robotRadius(cfg) + s.margin;
  const o = { obstacles, fieldSize: s.walls ? fieldSize : 100000, clearance };
  const steps: Step[] = [];
  let changed = 0;
  r.steps.forEach((st, i) => {
    const m = st.motion;
    if ((only && st.id !== only) || (m.type !== "moveToPoint" && m.type !== "moveToPose" && m.type !== "follow")) { steps.push(st); return; }
    const from = poses.before[i];
    if (m.type === "follow") {
      const pts = samplePath(m.path);
      if (pts.length < 3) { steps.push(st); return; }
      const safe = avoidObstacles(pts, o);
      safe[0] = pts[0]; safe[safe.length - 1] = pts[pts.length - 1];
      if (safe.every((p, k) => dist(p, pts[k]) < 0.4)) { steps.push(st); return; }
      const segs = fitStroke(safe, 0.8);
      if (!segs.length) { steps.push(st); return; }
      changed++;
      steps.push({ ...st, motion: { ...m, path: { ...m.path, segments: segs.map((sg) => ({ p: sg.p.map((q) => ({ x: Math.round(q.x * 100) / 100, y: Math.round(q.y * 100) / 100 })) as typeof sg.p })) } } });
      return;
    }
    const target = { x: m.x, y: m.y };
    const n = Math.max(2, Math.ceil(dist(from, target) / 2));
    const line = Array.from({ length: n + 1 }, (_, k) => ({ x: from.x + ((target.x - from.x) * k) / n, y: from.y + ((target.y - from.y) * k) / n }));
    const safe = avoidObstacles(line, o);
    safe[0] = line[0]; safe[n] = target;
    if (safe.every((p, k) => dist(p, line[k]) < 0.4)) { steps.push(st); return; }
    const idx = simplifyPolyline(safe, 1.6);
    let prev: { x: number; y: number } = from;
    for (const k of idx.slice(1, -1)) {
      const p = safe[k];
      if (dist(prev, p) < 4) continue;
      const mv = defaultMotion("moveToPoint", { x: Math.round(p.x * 4) / 4, y: Math.round(p.y * 4) / 4, heading: 0 });
      if (mv.type !== "moveToPoint") continue;
      mv.forwards = m.forwards; mv.maxSpeed = m.maxSpeed; mv.minSpeed = 45; mv.earlyExit = 6;
      mv.timeout = Math.max(1500, Math.ceil(((dist(prev, p) / 15) * 1000 + 1500) / 100) * 100);
      steps.push({ id: uid(), motion: mv, actions: [] });
      prev = p;
    }
    changed++;
    steps.push(st);
  });
  return { routine: { ...r, steps }, changed };
}
