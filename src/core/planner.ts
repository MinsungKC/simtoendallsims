import { avoidObstacles } from "./autoroute";
import { fitStroke } from "./fit";
import { pathLength } from "./path";
import { scoreSpecOf, zoneTakes, type RobotConfig } from "./robot";
import { defaultMotion, uid, type ActionType, type ActionSpec, type MotionSpec, type Routine, type Step } from "./routine";
import { simulate, type Recording } from "./runtime";
import { optimizeTimeouts } from "./tune";
import type { Obstacle, WorldInit } from "./world";
import type { GameModule } from "../games/types";
import { normalize } from "./common-plan";
import { createWorld, maxHold, type GameObject } from "./world";

export type TaskAction = "pickup" | "place" | "toggle" | "none";

/** One stop the user wants: go to this element, end facing a chosen way, do this. Order in the list = order of the route. */
export interface PlanTask {
  id: string;
  label: string;
  x: number;
  y: number;
  targetKind: "goal" | "object" | "toggle" | "point";
  action: TaskAction;
  /** Which end of the robot does the job: auto tries what the robot's mechanisms allow */
  side: "auto" | "front" | "back";
  /** Direction (deg, 0 = up the field, clockwise) the robot points along as it arrives at the element; "auto" tries several */
  approach: "auto" | number;
  toggleColor?: "red" | "blue" | "yellow";
  /** True when the piece lies on its side (a rear roller that takes only standing pieces can't get it) */
  lying?: boolean;
  /** The Goal id or piece id clicked, so the planner knows what will be held / what a Goal already contains */
  refId?: string | number;
  pieceKind?: string;
  /** Speed 0-127 for the legs into this stop (default: the planner's choice) */
  speed?: number;
  /** Drive through without stopping (chains into the next leg) */
  pass?: boolean;
  /** Extra actions to run at this stop, on top of what the job implies */
  extra?: { type: ActionType; arg?: string; when: "start" | "end" }[];
}

export interface PlanCandidate {
  routine: Routine;
  recording: Recording;
  duration: number;
  style: string;
  ok: boolean;
  problems: string[];
}

const bearing = (a: { x: number; y: number }, b: { x: number; y: number }) => (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function sidesFor(task: PlanTask, cfg: RobotConfig): ("front" | "back")[] {
  if (task.side !== "auto") return [task.side];
  if (task.targetKind === "point") return ["front"];
  if (task.action === "place") return [scoreSpecOf(cfg).side];
  if (task.action === "toggle") return ["front"];
  const out: ("front" | "back")[] = [];
  if (cfg.intake && zoneTakes(cfg.intake, !!task.lying)) out.push("front");
  if (cfg.rearIntake && zoneTakes(cfg.rearIntake, !!task.lying)) out.push("back");
  return out.length ? out : ["front"];
}

/** Robot-center distance from the element along the approach line, for this job. */
function standoff(task: PlanTask, cfg: RobotConfig, side: "front" | "back"): number {
  const L = cfg.length / 2;
  if (task.targetKind === "point") return 0;
  if (task.action === "place") { const sc = scoreSpecOf(cfg); return sc.inset ? L - sc.inset + 1 : L + 5.5; }
  if (task.action === "toggle") return L + 1.5;
  const spec = side === "front" ? cfg.intake : cfg.rearIntake;
  return spec ? L - (spec.inset ?? 0) + spec.reach * 0.5 : L + 2;
}

interface Variant { style: "pose" | "point" | "curve"; speed: number; offset: number; sideRank: number }

function buildRoutine(base: Routine, tasks: PlanTask[], cfg: RobotConfig, obstacles: Obstacle[], fieldSize: number, v: Variant): Routine | null {
  const steps: Step[] = [];
  let cur = { x: base.start.x, y: base.start.y, heading: base.start.heading };
  const clearance = Math.hypot(cfg.length, cfg.width) / 2 + 1;
  for (const task of tasks) {
    const options = sidesFor(task, cfg);
    const side = options[Math.min(v.sideRank, options.length - 1)];
    const nat = bearing(cur, task);
    const theta = task.approach === "auto" ? nat + (task.targetKind === "point" ? 0 : v.offset) : task.approach;
    const d = standoff(task, cfg, side);
    const r = (theta * Math.PI) / 180;
    const lim = fieldSize / 2 - cfg.width / 2;
    const cl = (v: number) => Math.max(-lim, Math.min(lim, v));
    // the robot can't stand inside the wall: pieces hugging the perimeter are reached from beside them
    const target = { x: Math.round(cl(task.x - Math.sin(r) * d) * 4) / 4, y: Math.round(cl(task.y - Math.cos(r) * d) * 4) / 4 };
    const heading = Math.round(normalize(theta + (side === "back" ? 180 : 0)));
    const forwards = side === "front";
    // route around solid elements, keeping only the bends
    const n = Math.max(2, Math.ceil(dist(cur, target) / 2));
    const line = Array.from({ length: n + 1 }, (_, i) => ({ x: cur.x + ((target.x - cur.x) * i) / n, y: cur.y + ((target.y - cur.y) * i) / n }));
    const safe = avoidObstacles(line, { obstacles, fieldSize, clearance: task.action === "toggle" ? 0.5 : clearance });
    safe[safe.length - 1] = target;
    const mk = (m: MotionSpec, actions: ActionSpec[] = []): Step => ({ id: uid(), motion: m, actions });
    const first: ActionSpec[] = [];
    const last: ActionSpec[] = [];
    if (task.action === "none") { /* a waypoint: only the user's own actions */ }
    else if (task.action === "pickup") {
      first.push({ id: uid("a"), type: side === "front" ? "intakeIn" : "rearIntakeIn", when: { kind: "start" } });
      last.push({ id: uid("a"), type: side === "front" ? "intakeStop" : "rearIntakeStop", when: { kind: "end" } });
    } else if (task.action === "place") last.push({ id: uid("a"), type: "place", when: { kind: "end" } });
    else last.push({ id: uid("a"), type: "toggleSet", arg: task.toggleColor ?? base.alliance, when: { kind: "end" } });
    for (const e of task.extra ?? []) (e.when === "start" ? first : last).push({ id: uid("a"), type: e.type, arg: e.arg, when: { kind: e.when } });
    const spd = task.speed ?? v.speed;
    const timeoutFor = (len: number) => Math.max(1500, Math.ceil(((len / 12) * 1000 + 1500) / 100) * 100);
    const group: Step[] = [];
    if (v.style === "curve") {
      const segs = fitStroke(safe);
      const m = defaultMotion("follow", { x: cur.x, y: cur.y, heading: cur.heading });
      if (m.type !== "follow" || !segs.length) return null;
      m.forwards = forwards;
      m.path.segments = segs.map((sg) => ({ p: sg.p.map((q) => ({ x: Math.round(q.x * 100) / 100, y: Math.round(q.y * 100) / 100 })) as typeof sg.p }));
      m.path.maxSpeed = spd; m.path.minSpeed = Math.min(60, spd);
      m.timeout = timeoutFor(pathLength(m.path));
      group.push(mk(m));
      group.push(mk({ ...defaultMotion("turnToHeading", { x: 0, y: 0, heading }), timeout: 2000 } as MotionSpec));
    } else {
      // bends first (intermediate points don't stop), then the approach itself
      let idx = [0, safe.length - 1];
      if (safe.length > 3) idx = simplifyIdx(safe, 1.6);
      let prev: { x: number; y: number } = cur;
      for (const i of idx.slice(1, -1)) {
        const p = safe[i];
        if (dist(prev, p) < 4) continue;
        const m = defaultMotion("moveToPoint", { x: p.x, y: p.y, heading: 0 });
        if (m.type === "moveToPoint") { m.forwards = forwards; m.maxSpeed = spd; m.minSpeed = 45; m.earlyExit = 6; m.timeout = timeoutFor(dist(prev, p)); group.push(mk(m)); }
        prev = p;
      }
      const len = dist(prev, target);
      if (v.style === "pose") {
        const m = defaultMotion("moveToPose", { x: target.x, y: target.y, heading });
        if (m.type !== "moveToPose") return null;
        m.forwards = forwards; m.lead = 0.5; m.maxSpeed = spd; m.timeout = timeoutFor(len);
        if (task.pass) { m.minSpeed = 45; m.earlyExit = 6; }
        group.push(mk(m));
      } else {
        const m = defaultMotion("moveToPoint", { x: target.x, y: target.y, heading: 0 });
        if (m.type !== "moveToPoint") return null;
        m.forwards = forwards; m.maxSpeed = spd; m.timeout = timeoutFor(len);
        if (task.pass) { m.minSpeed = 45; m.earlyExit = 6; }
        group.push(mk(m));
        if (!task.pass && (task.approach !== "auto" || task.targetKind !== "point")) group.push(mk({ ...defaultMotion("turnToHeading", { x: 0, y: 0, heading }), timeout: 2000 } as MotionSpec));
      }
    }
    group[0].actions.push(...first);
    group[group.length - 1].actions.push(...last);
    steps.push(...group);
    cur = { x: target.x, y: target.y, heading };
  }
  return { ...base, steps };
}

function simplifyIdx(pts: { x: number; y: number }[], tol: number): number[] {
  const keep = new Set([0, pts.length - 1]);
  const rec = (a: number, b: number) => {
    let worst = -1, wd = 0;
    const A = pts[a], B = pts[b], L = dist(A, B) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((B.x - A.x) * (A.y - pts[i].y) - (A.x - pts[i].x) * (B.y - A.y)) / L; if (d > wd) { wd = d; worst = i; } }
    if (worst >= 0 && wd > tol) { keep.add(worst); rec(a, worst); rec(worst, b); }
  };
  rec(0, pts.length - 1);
  return [...keep].sort((x, y) => x - y);
}

/**
 * Walk the task list with the robot's hands: what it holds at the start (the Preload), what each pickup adds, what each place uses.
 * Fixes what it can (a pickup blocked by the Preload gets a "score the Preload first" stop in front of it) and explains what it can't,
 * so "no route" is never a mystery.
 */
export function prepareTasks(a: { tasks: PlanTask[]; game: GameModule; world: WorldInit; cfg: RobotConfig; routine: Routine }): { tasks: PlanTask[]; notes: string[]; errors: string[] } {
  const w = createWorld(a.world, a.routine.start);
  w.alliance = a.routine.alliance;
  const rules = a.game.rules;
  const inv: GameObject[] = w.held.map((id) => w.objects.find((o) => o.id === id)!).filter(Boolean);
  const goals = w.goals.map((g) => ({ ...g, stack: [...g.stack] }));
  const notes: string[] = [], errors: string[] = [];
  const out: PlanTask[] = [];
  let at = { x: a.routine.start.x, y: a.routine.start.y };
  const canTake = (kind: string) => {
    const lim = rules?.possession?.[kind];
    return inv.length < maxHold(a.cfg) && (lim === undefined || inv.filter((o) => o.kind === kind).length < lim);
  };
  const accepts = (g: (typeof goals)[number], o: GameObject) => (!g.alliance || g.alliance === a.routine.alliance) && (rules ? rules.canStack(g as never, o) : true);
  const bestGoal = (o: GameObject) => goals.filter((g) => accepts(g, o)).sort((p, q) => Number(q.alliance === a.routine.alliance) - Number(p.alliance === a.routine.alliance) || dist(p, at) - dist(q, at))[0];
  const placeInto = (g: (typeof goals)[number], o: GameObject) => { g.stack.push({ id: o.id, kind: o.kind, halves: o.halves, opaqueUp: o.opaqueUp, flip: o.flip }); inv.splice(inv.indexOf(o), 1); };
  const nameOf = (o: GameObject) => (o.kind === "pin" ? `${o.halves?.join("/") ?? ""} Pin` : o.kind);

  for (const t of a.tasks) {
    if (t.action === "pickup") {
      const obj = t.refId !== undefined ? w.objects.find((o) => o.id === t.refId) : undefined;
      const inner = obj ? w.objects.find((o) => o.nestedIn === obj.id) : undefined;
      const kinds = [obj?.kind ?? t.pieceKind, inner?.kind].filter(Boolean) as string[];
      for (const kind of kinds) {
        let guard = 0;
        while (!canTake(kind) && guard++ < 4) {
          const blocking = inv.find((o) => o.kind === kind) ?? inv[0];
          const g = blocking ? bestGoal(blocking) : undefined;
          if (!blocking || !g) { errors.push(`Stop "${t.label}": the robot is full (${inv.map(nameOf).join(", ") || "nothing"}) and there is no Goal that will take what it holds.`); break; }
          out.push({ id: uid("t"), label: `Score ${nameOf(blocking)} on ${g.id}`, x: g.x, y: g.y, targetKind: "goal", action: "place", side: "auto", approach: "auto", refId: g.id });
          notes.push(`Added a stop to score the ${nameOf(blocking)} you start with on ${g.id} before "${t.label}" - the robot can only hold ${rules?.possession?.[kind] ?? "a limited number of"} ${kind}${(rules?.possession?.[kind] ?? 2) === 1 ? "" : "s"} at a time.`);
          placeInto(g, blocking);
          at = { x: g.x, y: g.y };
        }
      }
      if (obj) { inv.push(obj); if (inner) inv.push(inner); }
      else if (t.pieceKind) inv.push({ kind: t.pieceKind } as GameObject);
    } else if (t.action === "place") {
      const g = goals.find((q) => q.id === t.refId) ?? goals.slice().sort((p, q) => dist(p, t) - dist(q, t))[0];
      if (!g) { errors.push(`Stop "${t.label}": no Goal there.`); out.push(t); continue; }
      if (g.alliance && g.alliance !== a.routine.alliance) errors.push(`Stop "${t.label}": that is the opposing Alliance's Goal - you may not score in it.`);
      else if (!inv.length) errors.push(`Stop "${t.label}": the robot isn't holding anything by then. Add a pickup before it (you start holding only the Preload).`);
      else {
        const item = inv.find((o) => accepts(g, o));
        if (!item) errors.push(`Stop "${t.label}": ${g.id} can't take ${inv.map(nameOf).join(" or ")} right now. A Pin goes into an empty Goal or onto a Cup; a Cup goes over a Pin. It holds ${g.stack.length ? g.stack.map((s) => s.kind).join(" + ") : "nothing"}. Try another Goal, or pick up a Cup first.`);
        else placeInto(g, item);
      }
      at = { x: g.x, y: g.y };
    }
    out.push(t);
    at = { x: t.x, y: t.y };
  }
  return { tasks: out, notes, errors };
}

export interface PlanArgs {
  routine: Routine;
  tasks: PlanTask[];
  cfg: RobotConfig;
  game: GameModule;
  world: WorldInit;
  obstacles: Obstacle[];
  seed?: number;
  /** Simple mode: straight legs only (no boomerang or curves) */
  simple?: boolean;
  /** Called after each candidate with progress 0..1 */
  onProgress?: (p: number) => void;
  shouldStop?: () => boolean;
}

/** Try many ways of driving the task list, simulate each, and return every candidate best-first (working ones ahead of failed ones). */
export async function planRoutes(a: PlanArgs): Promise<PlanCandidate[]> {
  const { tasks, cfg } = a;
  const variants: Variant[] = [];
  const autoApproach = tasks.some((t) => t.approach === "auto" && t.targetKind !== "point");
  const twoSides = tasks.some((t) => sidesFor(t, cfg).length > 1);
  for (const sideRank of twoSides ? [0, 1] : [0])
    for (const offset of autoApproach ? [0, 35, -35] : [0])
      for (const speed of [127, 90])
        for (const style of (a.simple ? ["point"] : ["pose", "point", "curve"]) as ("pose" | "point" | "curve")[]) variants.push({ style, speed, offset, sideRank });
  const out: PlanCandidate[] = [];
  const limit = a.game.autonSeconds.value;
  const need = { pickup: tasks.filter((t) => t.action === "pickup").length, place: tasks.filter((t) => t.action === "place").length, toggle: tasks.filter((t) => t.action === "toggle").length };
  for (let i = 0; i < variants.length; i++) {
    if (a.shouldStop?.()) break;
    const v = variants[i];
    const r = buildRoutine(a.routine, tasks, cfg, a.obstacles, a.game.fieldSize.value, v);
    if (r) {
      let rec = simulate(r, cfg, a.world, { seed: a.seed });
      let routine = r;
      if (rec.duration <= limit + 5) { routine = optimizeTimeouts(r, rec.steps); rec = simulate(routine, cfg, a.world, { seed: a.seed }); }
      const problems: string[] = [];
      for (const s of rec.steps) if (s.timedOut) problems.push(`step ${s.index + 1} timed out`);
      const ev = (t: string) => rec.events.filter((e) => e.type === t).length;
      if (ev("pickup") < need.pickup) problems.push("did not pick everything up");
      if (ev("place") < need.place) problems.push("could not place");
      if (ev("toggle") < need.toggle) problems.push("could not reach the toggle");
      for (const w of rec.warnings) if (/failed|hit its/i.test(w.text) && !problems.some((p) => p.includes(w.text.slice(0, 12)))) problems.push(w.text);
      for (const f of a.game.check?.({ routine, cfg, recording: rec, world: rec.world }) ?? []) if (f.level === "error") problems.push(f.text);
      if (rec.duration > limit + 0.05) problems.push(`takes ${rec.duration.toFixed(1)} s (limit ${limit} s)`);
      out.push({ routine, recording: rec, duration: rec.duration, style: `${v.style === "pose" ? "boomerang" : v.style === "point" ? "point + turn" : "curve"}, speed ${v.speed}${v.offset ? `, approach ${v.offset > 0 ? "+" : ""}${v.offset}°` : ""}`, ok: problems.length === 0, problems });
    }
    a.onProgress?.((i + 1) / variants.length);
    await new Promise((res) => setTimeout(res, 0));
  }
  return out.sort((x, y) => Number(y.ok) - Number(x.ok) || x.duration - y.duration);
}

/** Best three that work, without near-duplicates (same shape within 0.05 s). */
export function topThree(c: PlanCandidate[]): PlanCandidate[] {
  const out: PlanCandidate[] = [];
  for (const x of c) {
    if (!x.ok) continue;
    if (out.some((y) => Math.abs(y.duration - x.duration) < 0.05)) continue;
    out.push(x);
    if (out.length === 3) break;
  }
  return out;
}
