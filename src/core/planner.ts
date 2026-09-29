import { avoidObstacles } from "./autoroute";
import { fitStroke } from "./fit";
import { pathLength } from "./path";
import type { RobotConfig } from "./robot";
import { defaultMotion, uid, type ActionSpec, type MotionSpec, type Routine, type Step } from "./routine";
import { simulate, type Recording } from "./runtime";
import { optimizeTimeouts } from "./tune";
import type { Obstacle, WorldInit } from "./world";
import type { GameModule } from "../games/types";
import { normalize } from "./common-plan";

export type TaskAction = "pickup" | "place" | "toggle";

/** One stop the user wants: go to this element, end facing a chosen way, do this. Order in the list = order of the route. */
export interface PlanTask {
  id: string;
  label: string;
  x: number;
  y: number;
  targetKind: "goal" | "object" | "toggle";
  action: TaskAction;
  /** Which end of the robot does the job: auto tries what the robot's mechanisms allow */
  side: "auto" | "front" | "back";
  /** Direction (deg, 0 = up the field, clockwise) the robot points along as it arrives at the element; "auto" tries several */
  approach: "auto" | number;
  toggleColor?: "red" | "blue" | "yellow";
  /** True when the piece lies on its side (a rear roller that takes only standing pieces can't get it) */
  lying?: boolean;
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
  if (task.action === "place") return [cfg.scoreSide ?? "front"];
  if (task.action === "toggle") return ["front"];
  const out: ("front" | "back")[] = [];
  if (cfg.intake && !(cfg.intake.standingOnly && task.lying)) out.push("front");
  if (cfg.rearIntake && !(cfg.rearIntake.standingOnly && task.lying)) out.push("back");
  return out.length ? out : ["front"];
}

/** Robot-center distance from the element along the approach line, for this job. */
function standoff(task: PlanTask, cfg: RobotConfig, side: "front" | "back"): number {
  const L = cfg.length / 2;
  if (task.action === "place") return L + 5.5;
  if (task.action === "toggle") return L + 1.5;
  const spec = side === "front" ? cfg.intake : cfg.rearIntake;
  return L + (spec ? spec.reach * 0.5 : 2);
}

interface Variant { style: "pose" | "point" | "curve"; speed: number; offset: number; sideRank: number }

function buildRoutine(base: Routine, tasks: PlanTask[], cfg: RobotConfig, obstacles: Obstacle[], fieldSize: number, v: Variant): Routine | null {
  const steps: Step[] = [];
  let cur = { x: base.start.x, y: base.start.y, heading: base.start.heading };
  const clearance = cfg.width / 2 + 1;
  for (const task of tasks) {
    const options = sidesFor(task, cfg);
    const side = options[Math.min(v.sideRank, options.length - 1)];
    const nat = bearing(cur, task);
    const theta = task.approach === "auto" ? nat + v.offset : task.approach;
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
    if (task.action === "pickup") {
      first.push({ id: uid("a"), type: side === "front" ? "intakeIn" : "rearIntakeIn", when: { kind: "start" } });
      last.push({ id: uid("a"), type: side === "front" ? "intakeStop" : "rearIntakeStop", when: { kind: "end" } });
    } else if (task.action === "place") last.push({ id: uid("a"), type: "place", when: { kind: "end" } });
    else last.push({ id: uid("a"), type: "toggleSet", arg: task.toggleColor ?? base.alliance, when: { kind: "end" } });
    const timeoutFor = (len: number) => Math.max(1500, Math.ceil(((len / 12) * 1000 + 1500) / 100) * 100);
    const group: Step[] = [];
    if (v.style === "curve") {
      const segs = fitStroke(safe);
      const m = defaultMotion("follow", { x: cur.x, y: cur.y, heading: cur.heading });
      if (m.type !== "follow" || !segs.length) return null;
      m.forwards = forwards;
      m.path.segments = segs.map((sg) => ({ p: sg.p.map((q) => ({ x: Math.round(q.x * 100) / 100, y: Math.round(q.y * 100) / 100 })) as typeof sg.p }));
      m.path.maxSpeed = v.speed; m.path.minSpeed = Math.min(60, v.speed);
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
        if (m.type === "moveToPoint") { m.forwards = forwards; m.maxSpeed = v.speed; m.minSpeed = 45; m.earlyExit = 6; m.timeout = timeoutFor(dist(prev, p)); group.push(mk(m)); }
        prev = p;
      }
      const len = dist(prev, target);
      if (v.style === "pose") {
        const m = defaultMotion("moveToPose", { x: target.x, y: target.y, heading });
        if (m.type !== "moveToPose") return null;
        m.forwards = forwards; m.lead = 0.5; m.maxSpeed = v.speed; m.timeout = timeoutFor(len);
        group.push(mk(m));
      } else {
        const m = defaultMotion("moveToPoint", { x: target.x, y: target.y, heading: 0 });
        if (m.type !== "moveToPoint") return null;
        m.forwards = forwards; m.maxSpeed = v.speed; m.timeout = timeoutFor(len);
        group.push(mk(m));
        group.push(mk({ ...defaultMotion("turnToHeading", { x: 0, y: 0, heading }), timeout: 2000 } as MotionSpec));
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

export interface PlanArgs {
  routine: Routine;
  tasks: PlanTask[];
  cfg: RobotConfig;
  game: GameModule;
  world: WorldInit;
  obstacles: Obstacle[];
  seed?: number;
  /** Called after each candidate with progress 0..1 */
  onProgress?: (p: number) => void;
  shouldStop?: () => boolean;
}

/** Try many ways of driving the task list, simulate each, and return every candidate best-first (working ones ahead of failed ones). */
export async function planRoutes(a: PlanArgs): Promise<PlanCandidate[]> {
  const { tasks, cfg } = a;
  const variants: Variant[] = [];
  const autoApproach = tasks.some((t) => t.approach === "auto");
  const twoSides = tasks.some((t) => sidesFor(t, cfg).length > 1);
  for (const sideRank of twoSides ? [0, 1] : [0])
    for (const offset of autoApproach ? [0, 35, -35] : [0])
      for (const speed of [127, 90])
        for (const style of ["pose", "point", "curve"] as const) variants.push({ style, speed, offset, sideRank });
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
