import { firstBlocked, findPath } from "./nav";
import { planPoses } from "./common-plan";
import { samplePath } from "./path";
import { zoneTakes, type RobotConfig } from "./robot";
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
      out.push({ x: p.x, y: p.y, w: 2 * h, h: 2 * h, label: "piece", tag: "piece", soft: true, keepOut: Math.max(3, cfg.width / 2 - 1) });
    }
  }
  return out;
}

export interface RepairTune {
  /** grow the turning-radius keep-out (1 = the robot's half-diagonal) */
  scale: number;
  /** 0: keep motion types; 1: replace boomerang poses by drive + turn; 2: also slow down */
  level: number;
}

/**
 * Re-route steps so the robot's path stays clear of `obstacles`, using grid path planning (never a corner-cutting nudge). Straight and
 * boomerang legs get stop-and-go detour legs; a curve that crosses something becomes straight legs. Detours made earlier are replaced,
 * not stacked. Targets themselves are never moved. Returns how many steps changed.
 */
export function repairRoutine(r: Routine, cfg: RobotConfig, obstacles: Obstacle[], s: AvoidSettings, fieldSize: number, only?: string, tune: RepairTune = { scale: 1, level: 0 }, perStep?: Map<string, RepairTune>): { routine: Routine; changed: number } {
  // detours made for a step earlier are replaced when that step is re-planned (never stacked); other steps keep theirs
  const redo = new Set<string>(perStep ? [...perStep.keys()] : only ? [only] : r.steps.map((st) => st.id));
  const base: Routine = { ...r, steps: r.steps.filter((st) => !(st.label?.startsWith("detour:") && redo.has(st.label.slice(7)))) };
  const poses = planPoses(base, cfg);
  const wall = cfg.width / 2;
  const navFor = (t: RepairTune) => ({ obstacles, fieldSize: s.walls ? fieldSize : 100000, radius: robotRadius(cfg) * t.scale + s.margin, wall });
  const steps: Step[] = [];
  let changed = 0;
  const detour = (from: { x: number; y: number }, p: { x: number; y: number }, forwards: boolean, speed: number, forStep: string): Step => {
    const mv = defaultMotion("moveToPoint", { x: Math.round(p.x * 4) / 4, y: Math.round(p.y * 4) / 4, heading: 0 });
    if (mv.type === "moveToPoint") { mv.forwards = forwards; mv.maxSpeed = speed; mv.minSpeed = 0; mv.timeout = Math.max(1500, Math.ceil(((dist(from, p) / 12) * 1000 + 1500) / 100) * 100); }
    return { id: uid(), motion: mv, actions: [], label: `detour:${forStep}` };
  };
  // moveToPoint turns WHILE it drives, so a robot facing the wrong way swings a wide arc into whatever is beside it: face the leg first
  const turnFirst = (from: { x: number; y: number }, to: { x: number; y: number }, heading: number, forwards: boolean, forStep: string): Step | null => {
    const want = (Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI + (forwards ? 0 : 180);
    let d = (want - heading) % 360; if (d > 180) d -= 360; if (d < -180) d += 360;
    if (Math.abs(d) < 25 || dist(from, to) < 3) return null;
    const mv = defaultMotion("turnToPoint", { x: to.x, y: to.y, heading: 0 });
    if (mv.type !== "turnToPoint") return null;
    mv.forwards = forwards; mv.timeout = 2500;
    return { id: uid(), motion: mv, actions: [], label: `detour:${forStep}` };
  };
  const turnNeeded = (from: { x: number; y: number; heading: number }, to: { x: number; y: number }, forwards: boolean) => { const want = (Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI + (forwards ? 0 : 180); let d = (want - from.heading) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return Math.abs(d) >= 25 && dist(from, to) >= 3; };
  const headingTo = (from: { x: number; y: number }, to: { x: number; y: number }, forwards: boolean) => (Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI + (forwards ? 0 : 180);
  base.steps.forEach((st, i) => {
    const t = perStep?.get(st.id) ?? tune;
    const m = st.motion;
    if ((only && st.id !== only && !perStep?.has(st.id)) || (m.type !== "moveToPoint" && m.type !== "moveToPose" && m.type !== "follow")) { steps.push(st); return; }
    const from = poses.before[i];
    const speed = t.level >= 2 ? 70 : 100;
    const nav = navFor(t);
    if (m.type === "follow") {
      const pts = samplePath(m.path);
      if (pts.length < 3 || firstBlocked(pts, nav) < 0) { steps.push(st); return; }
      const end = pts[pts.length - 1];
      const path = findPath(pts[0], end, nav) ?? findPath(pts[0], end, { ...nav, radius: cfg.width / 2 + s.margin });
      if (!path) { steps.push(st); return; }
      changed++;
      let prev: { x: number; y: number } = pts[0];
      let hd = from.heading;
      for (const p of [...path.slice(1, -1), end]) { const tf = turnFirst(prev, p, hd, m.forwards, st.id); if (tf) steps.push(tf); hd = headingTo(prev, p, m.forwards); if (p !== end) steps.push(detour(prev, p, m.forwards, speed, st.id)); prev = p; }
      const last = defaultMotion("moveToPoint", { x: Math.round(end.x * 4) / 4, y: Math.round(end.y * 4) / 4, heading: 0 });
      if (last.type === "moveToPoint") { last.forwards = m.forwards; last.maxSpeed = speed; last.minSpeed = 0; last.timeout = Math.max(m.timeout, 2000); steps.push({ ...st, motion: last }); }
      return;
    }
    const target = { x: m.x, y: m.y };
    const path = findPath(from, target, nav) ?? findPath(from, target, { ...nav, radius: cfg.width / 2 + s.margin });
    const straight = !path || path.length <= 2;
    const convert = m.type === "moveToPose" && t.level >= 1;
    if (straight && !convert && m.type !== "moveToPoint") { steps.push(st); return; }
    if (straight && !convert && !turnNeeded(from, target, m.forwards)) { steps.push(st); return; }
    if (!straight || m.type === "moveToPoint") {
      let prev: { x: number; y: number } = from;
      let hd = from.heading;
      const legs = straight ? [target] : [...path!.slice(1, -1), target];
      for (const p of legs) {
        const tf = turnFirst(prev, p, hd, m.forwards, st.id);
        if (tf) steps.push(tf);
        hd = headingTo(prev, p, m.forwards);
        if (p !== target) steps.push(detour(prev, p, m.forwards, speed, st.id));
        prev = p;
      }
    }
    changed++;
    if (convert) {
      const mv = defaultMotion("moveToPoint", { x: m.x, y: m.y, heading: 0 });
      if (mv.type === "moveToPoint") { mv.forwards = m.forwards; mv.maxSpeed = Math.min(m.maxSpeed, speed); mv.minSpeed = 0; mv.timeout = m.timeout; }
      steps.push({ ...st, motion: mv, actions: st.actions.filter((a) => a.when.kind !== "end") });
      steps.push({ id: uid(), motion: { ...defaultMotion("turnToHeading", { x: m.x, y: m.y, heading: m.heading }), timeout: 2000 } as never, actions: st.actions.filter((a) => a.when.kind === "end") });
    } else steps.push(t.level >= 2 && "maxSpeed" in m ? { ...st, motion: { ...m, maxSpeed: Math.min(m.maxSpeed, speed) } } : st);
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

export interface SimRepair { routine: Routine; iterations: number; remaining: RouteHit[]; changed: number; notes: string[]; timedOut: number[]; endError: number }

/**
 * Fix by simulating, and get smarter each round. For every step that still hits something the planner tries, in order:
 *  - drive into a piece near the step's end with no intake running -> turn the right intake on for that step (a hit becomes a pickup);
 *  - reach a Goal while holding something with no Place -> add the Place;
 *  - otherwise re-plan the step's path around what was hit, then with a bigger safety radius and drive+turn instead of a boomerang,
 *    then slower.
 * Steps are stop-and-go so the robot really ends where each leg says. Targets are never moved.
 */
export async function repairBySim(
  r: Routine, cfg: RobotConfig, s: AvoidSettings, fieldSize: number,
  sim: (r: Routine) => import("./runtime").Recording, baseObstacles: Obstacle[], pieces: (PieceLike & { id?: number })[], onProgress?: (i: number) => void, maxIter = 8,
): Promise<SimRepair> {
  let cur = r;
  let changed = 0;
  let hits: RouteHit[] = [];
  const notes: string[] = [];
  const extra: Obstacle[] = [];
  const attempts = new Map<string, number>();
  const radius = robotRadius(cfg);
  let rec = sim(cur);
  for (let it = 0; it < maxIter; it++) {
    hits = routeHits(rec);
    onProgress?.(it + 1);
    const jammed = rec.steps.filter((x) => x.timedOut).map((x) => x.index);
    if (!hits.length && !jammed.length) break;
    const poses = planPoses(cur, cfg);
    const perStep = new Map<string, RepairTune>();
    let didSomething = false;
    const troubled = new Set<number>([...hits.map((h) => h.step), ...jammed]);
    for (const si of troubled) {
      const step = cur.steps[si];
      if (!step) continue;
      const stepHits = hits.filter((h) => h.step === si);
      const end = poses.after[si];
      // smarter than avoiding: is the robot brushing something it should be taking / scoring in?
      let handled = false;
      const m = step.motion;
      for (const h of stepHits) {
        if (h.id !== undefined && !step.actions.some((a) => a.type === "intakeIn" || a.type === "rearIntakeIn") && Math.hypot(h.x - end.x, h.y - end.y) < 7) {
          const p = pieces.find((q) => q.id === h.id);
          const back = "forwards" in m && !m.forwards;
          const zone = back ? cfg.rearIntake : cfg.intake;
          if (p && zone && zoneTakes(zone, !!p.lying)) {
            step.actions.push({ id: uid("a"), type: back ? "rearIntakeIn" : "intakeIn", when: { kind: "start" } }, { id: uid("a"), type: back ? "rearIntakeStop" : "intakeStop", when: { kind: "end" } });
            notes.push(`Step ${si + 1} runs into a ${h.label}: added the ${back ? "back" : "front"} intake there so it picks it up.`);
            handled = true; didSomething = true; changed++;
          }
        } else if (h.id === undefined && baseObstacles.some((o) => o.label === h.label && o.tag?.startsWith("goal:")) && Math.hypot(h.x - end.x, h.y - end.y) < 9 && !step.actions.some((a) => a.type === "place")) {
          const f = rec.frames.find((x) => x.t >= h.t) ?? rec.frames[rec.frames.length - 1];
          if (f.held > 0) { step.actions.push({ id: uid("a"), type: "place", when: { kind: "end" } }); notes.push(`Step ${si + 1} reaches ${h.label} while holding something: added Place.`); handled = true; didSomething = true; changed++; }
        }
      }
      if (handled && !jammed.includes(si)) continue;
      const n = (attempts.get(step.id) ?? 0) + 1;
      attempts.set(step.id, n);
      perStep.set(step.id, { scale: 1 + 0.15 * (n - 1), level: Math.min(2, n - 1) });
      for (const h of stepHits) {
        const ob = baseObstacles.find((o) => o.label === h.label);
        if (ob && !extra.some((e) => e.label === ob.label)) extra.push({ ...ob, keepOut: radius + s.margin + 1 });
        else if (h.id !== undefined) { const p = pieces.find((q) => q.id === h.id); if (p && !extra.some((e) => e.label === `piece${h.id}`)) { const hh = p.r + (p.lying ? p.half ?? 0 : 0); extra.push({ x: p.x, y: p.y, w: 2 * hh, h: 2 * hh, label: `piece${h.id}`, tag: "piece", soft: true, keepOut: radius * 0.9 + s.margin }); } }
      }
    }
    if (perStep.size) {
      const list = [...avoidList(baseObstacles, pieces, s, cur, cfg), ...extra];
      const res = repairRoutine(cur, cfg, list, s, fieldSize, undefined, { scale: 1, level: 0 }, perStep);
      if (res.changed) { cur = res.routine; changed += res.changed; didSomething = true; }
    }
    await new Promise((res) => setTimeout(res, 0));
    if (!didSomething) break;
    rec = sim(cur);
  }
  hits = routeHits(rec);
  const last = cur.steps.length ? planPoses(cur, cfg).after.at(-1)! : cur.start;
  const f = rec.frames[rec.frames.length - 1];
  return { routine: cur, iterations: maxIter, remaining: hits, changed, notes, timedOut: rec.steps.filter((x) => x.timedOut).map((x) => x.index), endError: Math.hypot(f.x - last.x, f.y - last.y) };
}
