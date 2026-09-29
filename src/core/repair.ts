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

export interface RouteHit { step: number; t: number; label: string; id?: number; x: number; y: number }

/** Unintended contacts in a finished run: what the robot ran into, and in which step. Pieces it went on to pick up, and Goals it then scored in, are intended. */
export function routeHits(rec: import("./runtime").Recording): RouteHit[] {
  const out: RouteHit[] = [];
  const pickups = rec.events.filter((q) => q.type === "pickup").map((q) => { const f = rec.frames.find((x) => x.t >= q.t) ?? rec.frames[rec.frames.length - 1]; return { t: q.t, x: f.x, y: f.y }; });
  const stepAt = (t: number) => rec.steps.find((s) => t >= s.start - 1e-6 && t <= s.end + 1e-6)?.index ?? rec.steps.at(-1)?.index ?? 0;
  for (const e of rec.events) {
    if (e.type !== "hit") continue;
    const later = rec.events.filter((q) => q.t >= e.t - 0.05 && q.t <= e.t + 1.5);
    if (e.id !== undefined && later.some((q) => q.type === "pickup" && q.id === e.id)) continue;
    if (e.id === undefined && later.some((q) => q.type === "place" && q.goal === e.text)) continue;
    if (later.some((q) => q.type === "toggle") && /toggle/i.test(e.text ?? "")) continue;
    // brushing the neighbours of a piece while going in to pick it up is part of picking it up
    if (e.id !== undefined && pickups.some((p) => Math.abs(p.t - e.t) < 2.5 && Math.hypot((e.x ?? 0) - p.x, (e.y ?? 0) - p.y) < 14)) continue;
    out.push({ step: stepAt(e.t), t: e.t, label: e.text ?? "something", id: e.id, x: e.x ?? 0, y: e.y ?? 0 });
  }
  return out;
}

export interface SimRepair { routine: Routine; iterations: number; remaining: RouteHit[]; changed: number }

/**
 * Fix by simulating: run the route, see what it actually hit, keep those things out of the affected steps, and repeat until it runs clean
 * (or nothing more can be moved). Targets of a step are never moved, so a hit right at a target is reported, not "fixed".
 */
export async function repairBySim(
  r: Routine, cfg: RobotConfig, s: AvoidSettings, fieldSize: number,
  sim: (r: Routine) => import("./runtime").Recording, baseObstacles: Obstacle[], pieces: PieceLike[], onProgress?: (i: number) => void, maxIter = 6,
): Promise<SimRepair> {
  let cur = r;
  let changed = 0;
  let hits: RouteHit[] = [];
  const extra: Obstacle[] = [];
  const radius = robotRadius(cfg);
  for (let it = 0; it < maxIter; it++) {
    const rec = sim(cur);
    hits = routeHits(rec);
    onProgress?.(it + 1);
    if (!hits.length) return { routine: cur, iterations: it, remaining: [], changed };
    for (const h of hits) {
      const ob = baseObstacles.find((o) => o.label === h.label);
      if (ob) { if (!extra.includes(ob)) extra.push({ ...ob, keepOut: radius + s.margin + 1 }); }
      else if (h.id !== undefined) { const p = pieces.find((q) => (q as PieceLike & { id?: number }).id === h.id); if (p && !extra.some((e) => e.label === `piece${h.id}`)) { const hh = p.r + (p.lying ? p.half ?? 0 : 0); extra.push({ x: p.x, y: p.y, w: 2 * hh, h: 2 * hh, label: `piece${h.id}`, tag: "piece", keepOut: radius * 0.9 + s.margin }); } }
    }
    const list = [...avoidList(baseObstacles, pieces, s, cur, cfg), ...extra];
    let any = false;
    for (const step of new Set(hits.map((h) => h.step))) {
      const id = cur.steps[step]?.id;
      if (!id) continue;
      const res = repairRoutine(cur, cfg, list, s, fieldSize, id);
      if (res.changed) { cur = res.routine; changed += res.changed; any = true; }
    }
    await new Promise((res) => setTimeout(res, 0));
    if (!any) break;
  }
  return { routine: cur, iterations: maxIter, remaining: hits, changed };
}
