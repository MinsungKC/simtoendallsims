import type { NavOptions } from "./nav";
import { buildGroup, dist } from "./legs";
import { bestChains, calibrate, legPath, type Pose, type StopSpec } from "./timeplan";
import { scoreSpecOf, zoneTakes, type RobotConfig } from "./robot";
import { uid, type ActionType, type ActionSpec, type MotionSpec, type Routine, type Step } from "./routine";
import { simulate, type Recording } from "./runtime";
import { optimizeTimeouts } from "./tune";
import type { Obstacle, WorldInit } from "./world";
import type { GameModule } from "../games/types";
import { normalize } from "./common-plan";
import { DEFAULT_AVOID, avoidList, repairBySim, routeHits } from "./repair";
import { createWorld, maxHold, tipSpeed, type GameObject } from "./world";

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
  /** loose pieces the robot bumped on the way (allowed, but ranked lower) */
  pushes: number;
}


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

const ACTION_SECONDS = { pickup: 0.25, place: 0.3, toggle: 0.3, none: 0 } as const;

/** Every arrival pose worth considering for each stop: usable ends of the robot x approach directions (16, or the one the user fixed). */
function stopSpecs(tasks: PlanTask[], cfg: RobotConfig, fieldSize: number): StopSpec[] {
  const lim = fieldSize / 2 - cfg.width / 2;
  const cl = (v: number) => Math.max(-lim, Math.min(lim, v));
  return tasks.map((t) => {
    const poses: Pose[] = [];
    if (t.targetKind === "point") {
      poses.push({ x: cl(t.x), y: cl(t.y), h: t.approach === "auto" ? null : normalize(t.approach), theta: t.approach === "auto" ? 0 : t.approach, side: t.side === "back" ? "back" : "front" });
    } else {
      for (const side of sidesFor(t, cfg)) {
        const thetas = t.approach === "auto" ? Array.from({ length: 16 }, (_, i) => i * 22.5) : [t.approach];
        const d = standoff(t, cfg, side);
        for (const theta of thetas) {
          const r = (theta * Math.PI) / 180;
          // the robot can't stand inside the wall: pieces hugging the perimeter are reached from beside them
          poses.push({ x: Math.round(cl(t.x - Math.sin(r) * d) * 4) / 4, y: Math.round(cl(t.y - Math.cos(r) * d) * 4) / 4, h: Math.round(normalize(theta + (side === "back" ? 180 : 0))), theta, side });
        }
      }
    }
    return { poses, action: ACTION_SECONDS[t.action] };
  });
}

/** Turn the chosen poses into steps: face the leg, drive it, and at the stop face the required heading and act. "fast" chains gentle corners. */
function buildFromChain(base: Routine, tasks: PlanTask[], chain: Pose[], cfg: RobotConfig, navs: NavOptions[], style: "boomerang" | "pursuit" | "chained" | "safe", approachCap: (t: PlanTask) => number): Routine {
  const fast = style !== "safe";
  const steps: Step[] = [];
  const uidStep = (motion: MotionSpec, actions: ActionSpec[] = [], label?: string): Step => ({ id: uid(), motion, actions, label });
  let cur = { x: base.start.x, y: base.start.y, h: base.start.heading };
  tasks.forEach((task, ti) => {
    const pose = chain[ti];
    const path = legPath(cur, pose, navs[ti], cfg);
    const spdTravel = task.speed ?? (fast ? 127 : 110);
    const cap = approachCap(task); // a standing Pin or Cup knocked at speed tips over and the pickup then can't take it
    const built = buildGroup({ cur, pose, path, style, speed: spdTravel, cap: task.action === "pickup" ? cap : 127, pass: task.pass, nav: navs[ti] });
    const group: Step[] = built.steps;
    const h = built.heading;
    if (!group.length) group.push(uidStep({ type: "wait", ms: 50 } as MotionSpec));
    const first: ActionSpec[] = [], last: ActionSpec[] = [];
    const side = pose.side;
    if (task.action === "pickup") {
      first.push({ id: uid("a"), type: side === "front" ? "intakeIn" : "rearIntakeIn", when: { kind: "start" } });
      last.push({ id: uid("a"), type: side === "front" ? "intakeStop" : "rearIntakeStop", when: { kind: "end" } });
    } else if (task.action === "place") last.push({ id: uid("a"), type: "place", when: { kind: "end" } });
    else if (task.action === "toggle") last.push({ id: uid("a"), type: "toggleSet", arg: task.toggleColor ?? base.alliance, when: { kind: "end" } });
    for (const e of task.extra ?? []) (e.when === "start" ? first : last).push({ id: uid("a"), type: e.type, arg: e.arg, when: { kind: e.when } });
    group[0].actions.push(...first);
    group[group.length - 1].actions.push(...last);
    steps.push(...group);
    cur = { x: pose.x, y: pose.y, h: pose.h ?? h };
  });
  return { ...base, steps };
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
  const out: PlanCandidate[] = [];
  const limit = a.game.autonSeconds.value;
  // what the route must keep clear of: Goals/Loaders firmly, loose pieces softly (except the ones it is going to pick up)
  const allObjects = a.world.objects as { x: number; y: number; r: number; lying?: boolean; half?: number; stackedIn?: string; nestedIn?: number }[];
  const fieldSize0 = a.game.fieldSize.value;
  // legs into a pickup are allowed to reach the piece being picked up; every other leg keeps clear of it (and of all other loose pieces)
  const navObstaclesFor = (ti: number) => avoidList(a.obstacles, allObjects.filter((o) => !(tasks[ti].action === "pickup" && Math.hypot(tasks[ti].x - o.x, tasks[ti].y - o.y) < 9)), DEFAULT_AVOID, a.routine, cfg);
  const navObstacles = avoidList(a.obstacles, allObjects, DEFAULT_AVOID, a.routine, cfg);
  void fieldSize0;
  const fieldSize = a.game.fieldSize.value;
  // planning distances use a slim robot (so arrival poses next to a Goal are reachable); the routes actually driven use the full turning radius
  const navPlan: NavOptions = { obstacles: navObstacles, fieldSize, radius: cfg.width / 2 + 0.5, wall: cfg.width / 2 };
  const navDrive: NavOptions[] = tasks.map((_, ti) => ({ obstacles: navObstaclesFor(ti), fieldSize, radius: Math.hypot(cfg.length, cfg.width) / 2 + 1, wall: cfg.width / 2 }));
  // the same legs ignoring loose pieces (only Goals/Loaders/walls are steered around): often much shorter, and bumping a ring or two costs only a little
  const directList = avoidList(a.obstacles, [], DEFAULT_AVOID, a.routine, cfg);
  const navDirect: NavOptions[] = tasks.map(() => ({ obstacles: directList, fieldSize, radius: Math.hypot(cfg.length, cfg.width) / 2 + 1, wall: cfg.width / 2 }));
  const chains = bestChains(a.routine.start, stopSpecs(tasks, cfg, fieldSize), cfg, navPlan, 3);
  const need = { pickup: tasks.filter((t) => t.action === "pickup").length, place: tasks.filter((t) => t.action === "place").length, toggle: tasks.filter((t) => t.action === "toggle").length };
  const evaluate = (r: Routine, style: string): PlanCandidate => {
    const rec = simulate(r, cfg, a.world, { seed: a.seed });
    // timeouts sized from the run itself (they never change how long a step that finished takes, so no second simulation)
    const routine = rec.duration <= limit + 5 && !rec.steps.some((x) => x.timedOut) ? optimizeTimeouts(r, rec.steps) : r;
    const problems: string[] = [];
    for (const s of rec.steps) if (s.timedOut) problems.push(`step ${s.index + 1} timed out`);
    const ev = (t: string) => rec.events.filter((e) => e.type === t).length;
    if (ev("pickup") < need.pickup) problems.push("did not pick everything up");
    if (ev("place") < need.place) problems.push("could not place");
    if (ev("toggle") < need.toggle) problems.push("could not reach the toggle");
    for (const w of rec.warnings) if (/failed|hit its/i.test(w.text) && !problems.some((p) => p.includes(w.text.slice(0, 12)))) problems.push(w.text);
    for (const e of rec.events) if (e.type === "reject" && !problems.includes(e.text ?? "")) problems.push(`could not ${e.text}`);
    for (const f of a.game.check?.({ routine, cfg, recording: rec, world: rec.world }) ?? []) if (f.level === "error") problems.push(f.text);
    let pushes = rec.events.filter((e) => e.type === "tip").length;
    for (const h of routeHits(rec)) { if (h.label === "toggle") continue; if (h.id !== undefined) pushes++; else problems.push(`hits ${h.label} in step ${h.step + 1}`); }
    if (rec.duration > limit + 0.05) problems.push(`takes ${rec.duration.toFixed(1)} s (limit ${limit} s)`);
    return { routine, recording: rec, duration: rec.duration, style, ok: problems.length === 0, problems, pushes };
  };
  const cal = calibrate(cfg);
  const approachCap = (t: PlanTask): number => {
    if (t.action !== "pickup") return 127;
    const o = (a.world.objects as { id: number; tip?: NonNullable<GameObject["tip"]>; lying?: boolean }[]).find((q) => q.id === t.refId);
    if (!o?.tip || o.lying) return 127;
    return Math.max(20, Math.min(127, Math.round(((tipSpeed(o.tip) * 0.7) / cal.v) * 127)));
  };
  const styles: ("boomerang" | "pursuit" | "chained" | "safe")[] = a.simple ? ["safe"] : ["boomerang", "pursuit", "chained", "safe"];
  const total = chains.length * styles.length * 2 + 3;
  let done = 0;
  const variants: [NavOptions[], string][] = [[navDrive, ""], [navDirect, ", straight past loose pieces"]];
  for (const chain of chains) for (const style of styles) for (const [navs, tag] of variants) {
    if (a.shouldStop?.()) break;
    const r = buildFromChain(a.routine, tasks, chain.poses, cfg, navs, style, approachCap);
    const sides = [...new Set(chain.poses.map((p) => p.side))].join("+");
    out.push(evaluate(r, `${style === "boomerang" ? "smooth boomerang per stop" : style === "pursuit" ? "pure pursuit curves" : style === "chained" ? "chained corners" : "stop-and-turn"}, ${sides}, ~${chain.time.toFixed(1)} s predicted${tag}`));
    a.onProgress?.(++done / total);
    await new Promise((res) => setTimeout(res, 0));
  }
  // second pass: the fastest candidates whose only problem is running into things get repaired by simulation
  const onlyHits = out.filter((c) => !c.ok && c.problems.every((p) => p.startsWith("hits "))).sort((x, y) => x.duration - y.duration).slice(0, 3);
  for (let k = 0; k < onlyHits.length; k++) {
    if (a.shouldStop?.()) break;
    const c = onlyHits[k];
    const rep = await repairBySim(c.routine, cfg, DEFAULT_AVOID, a.game.fieldSize.value, (r) => simulate(r, cfg, a.world, { seed: a.seed }), a.world.obstacles, a.world.objects as never, undefined, 3);
    if (rep.changed) out.push(evaluate(rep.routine, `${c.style}, re-routed around obstacles`));
    a.onProgress?.((done + k + 1) / total);
  }
  return out.sort((x, y) => Number(y.ok) - Number(x.ok) || x.duration + 0.5 * x.pushes - (y.duration + 0.5 * y.pushes));
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
