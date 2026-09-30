import { planPoses } from "./common-plan";
import { buildGroup, angleDiff, bearing, dist, routeBetween, type MoveStyle } from "./legs";
import type { NavOptions } from "./nav";
import { avoidList, robotRadius, routeHits, type AvoidSettings } from "./repair";
import type { RobotConfig } from "./robot";
import type { ActionSpec, Routine, Step } from "./routine";
import type { Recording } from "./runtime";
import { calibrate, driveTime, turnTime } from "./timeplan";
import { optimizeTimeouts } from "./tune";
import { tipSpeed, type GameObject, type Obstacle } from "./world";

/**
 * "Fix route" = make every step of the route END WHERE IT WAS AIMED, as fast as possible, without hitting Goals/Loaders or getting stuck.
 *
 * Each step has a goal (the point or heading it was meant to reach). Working through the route in order, from where the robot REALLY ends up
 * after the previous step, the planner builds alternative ways to reach that goal - the step as drawn, a boomerang move, a pure-pursuit curve,
 * chained corners, or stop-and-turn legs, forwards or in reverse, around Goals on a grid route - and simulates them. A candidate is valid only if the robot
 * finishes within tolerance of the goal (2 in, 5 deg), did not time out, and did not hit a Goal/Loader. The fastest valid one is kept; if none is valid the closest to the goal is
 * kept and the step is reported as not reaching it. Later steps then start from the robot's true pose, so one miss cannot snowball.
 */
export interface FixStepReport {
  index: number;
  label: string;
  reached: boolean;
  posError: number;
  headingError: number | null;
  style: string;
  seconds: number;
  hits: string[];
}

export interface FixResult { routine: Routine; reports: FixStepReport[]; notes: string[]; reachedAll: boolean; finalError: number; duration: number }

type PieceIn = { x: number; y: number; r: number; lying?: boolean; half?: number; stackedIn?: string; nestedIn?: number; id?: number; tip?: GameObject["tip"] };

interface Goal { x?: number; y?: number; h?: number }

const POS_TOL = 2, HEAD_TOL = 5;

/** What a step is supposed to achieve, from the planned (idealised) pose after it. */
function goalOf(step: Step, after: { x: number; y: number; heading: number }): Goal | null {
  const m = step.motion;
  switch (m.type) {
    case "moveToPoint": return { x: m.x, y: m.y };
    case "moveToPose": return { x: m.x, y: m.y, h: m.heading };
    case "follow": return { x: after.x, y: after.y };
    case "turnToHeading": case "swingToHeading": return { h: m.heading };
    case "turnToPoint": return { h: after.heading };
    default: return null;
  }
}

function predict(steps: Step[], from: { x: number; y: number; h: number }, cal: ReturnType<typeof calibrate>): number {
  let t = 0, h = from.h, p = { x: from.x, y: from.y };
  for (const s of steps) {
    const m = s.motion;
    if (m.type === "moveToPoint") { t += driveTime(cal, dist(p, m)); h = bearing(p, m) + (m.forwards ? 0 : 180); p = { x: m.x, y: m.y }; }
    else if (m.type === "moveToPose") { t += driveTime(cal, dist(p, m)) + (angleDiff(h, bearing(p, m)) + angleDiff(bearing(p, m), m.heading)) / cal.w; p = { x: m.x, y: m.y }; h = m.heading; }
    else if (m.type === "follow") { const pts = m.path.segments.at(-1)!.p[3]; t += driveTime(cal, dist(p, pts) * 1.1); p = { x: pts.x, y: pts.y }; }
    else if (m.type === "turnToHeading") { t += turnTime(cal, angleDiff(h, m.heading)); h = m.heading; }
    else if (m.type === "turnToPoint") { const b = bearing(p, m) + (m.forwards ? 0 : 180); t += turnTime(cal, angleDiff(h, b)); h = b; }
  }
  return t;
}

export interface FixArgs {
  routine: Routine;
  cfg: RobotConfig;
  avoid: AvoidSettings;
  fieldSize: number;
  sim: (r: Routine) => Recording;
  obstacles: Obstacle[];
  pieces: PieceIn[];
  /** fix only this step (the ones before it stay as they are) */
  only?: string;
  onProgress?: (msg: string, frac: number) => void;
}

export async function fixRoute(a: FixArgs): Promise<FixResult> {
  const { routine, cfg } = a;
  const cal = calibrate(cfg);
  const planned = planPoses(routine, cfg);
  const onlyIdx = a.only ? routine.steps.findIndex((s) => s.id === a.only) : -1;
  const lo = onlyIdx >= 0 ? onlyIdx : 0, hi = onlyIdx >= 0 ? onlyIdx : routine.steps.length - 1;
  const done: Step[] = routine.steps.slice(0, lo);
  const reports: FixStepReport[] = [];
  const notes: string[] = [];
  let actual = { x: routine.start.x, y: routine.start.y, h: routine.start.heading };
  let rec: Recording | null = done.length ? a.sim({ ...routine, steps: done }) : null;
  const poseNow = (): { x: number; y: number; h: number } => { if (!rec) return actual; const f = rec.frames[rec.frames.length - 1]; return { x: f.x, y: f.y, h: f.heading }; };

  for (let i = lo; i <= hi; i++) {
    const step = routine.steps[i];
    const goal = goalOf(step, planned.after[i]);
    if (!goal) { done.push(step); rec = null; rec = a.sim({ ...routine, steps: done }); continue; }
    a.onProgress?.(`Step ${i + 1} of ${routine.steps.length}`, (i - lo) / Math.max(1, hi - lo + 1));
    const q = poseNow();
    const n0 = done.length;

    const evaluate = (steps: Step[]) => {
      const r = { ...routine, steps: [...done, ...steps] };
      const rc = a.sim(r);
      const li = n0 + steps.length - 1;
      const t0 = rc.steps[n0]?.start ?? 0, t1 = rc.steps[li]?.end ?? rc.duration;
      const f = rc.frames.find((x) => x.t >= t1 - 1e-6) ?? rc.frames[rc.frames.length - 1];
      const posError = goal.x !== undefined ? dist(f, { x: goal.x, y: goal.y! }) : 0;
      const headingError = goal.h !== undefined ? angleDiff(f.heading, goal.h) : null;
      const timedOut = rc.steps.slice(n0, li + 1).some((s) => s.timedOut);
      const hitList = routeHits(rc).filter((h) => h.step >= n0 && h.step <= li);
      const hard = hitList.filter((h) => h.id === undefined);
      const pushes = hitList.length - hard.length;
      const reached = posError <= POS_TOL && (headingError === null || headingError <= HEAD_TOL) && !timedOut;
      return { rc, reached, valid: reached && hard.length === 0, posError, headingError, hits: [...new Set(hitList.map((h) => h.label))], seconds: t1 - t0, score: t1 - t0 + 0.4 * pushes };
    };

    // the step as drawn, with the same actions
    let best = { steps: [step], label: "as drawn", ...evaluate([step]) };

    // alternatives: only worth simulating if one is predicted to be faster (or the drawn step fails)
    const nearPiece = a.pieces.filter((p) => goal.x !== undefined && dist(p, { x: goal.x, y: goal.y! }) < 9 && !p.stackedIn);
    const intakes = step.actions.some((x) => x.type === "intakeIn" || x.type === "rearIntakeIn");
    const exempt = intakes ? nearPiece : [];
    const list = avoidList(a.obstacles, a.pieces.filter((p) => !exempt.includes(p)), a.avoid, routine, cfg);
    const nav: NavOptions = { obstacles: list, fieldSize: a.avoid.walls ? a.fieldSize : 100000, radius: robotRadius(cfg) + a.avoid.margin, wall: cfg.width / 2 };
    const tipPiece = nearPiece.find((p) => p.tip && !p.lying);
    const cap = intakes && tipPiece?.tip ? Math.max(20, Math.min(127, Math.round(((tipSpeed(tipPiece.tip) * 0.7) / cal.v) * 127))) : 127;
    const speed = "maxSpeed" in step.motion ? step.motion.maxSpeed : 127;
    const cands: { label: string; steps: Step[]; t: number }[] = [];
    if (goal.x !== undefined) {
      const to = { x: goal.x, y: goal.y! };
      const path = routeBetween(q, to, nav, cfg);
      const styles: [MoveStyle, boolean | undefined][] = [["boomerang", undefined], ["boomerang", false], ["pursuit", undefined], ["pursuit", false], ["chained", undefined], ["safe", undefined]];
      const seen = new Set<string>();
      for (const [style, forwards] of styles) {
        const pose = { x: to.x, y: to.y, h: goal.h ?? (style === "boomerang" ? Math.round(bearing(path[path.length - 2] ?? q, to)) : null) };
        const g = buildGroup({ cur: q, pose, path, style, speed: Math.min(127, speed), cap, nav, forwards });
        if (!g.steps.length) continue;
        const sig = JSON.stringify(g.steps.map((s) => [s.motion.type, "x" in s.motion ? s.motion.x : 0, "y" in s.motion ? s.motion.y : 0, "forwards" in s.motion ? s.motion.forwards : 0]));
        if (seen.has(sig)) continue;
        seen.add(sig);
        // the original step's actions ride on the new steps: starts on the first, everything else on the last
        const acts: ActionSpec[] = step.actions.map((x) => ({ ...x }));
        g.steps[0].actions.push(...acts.filter((x) => x.when.kind === "start"));
        g.steps[g.steps.length - 1].actions.push(...acts.filter((x) => x.when.kind !== "start"));
        cands.push({ label: `${style === "boomerang" ? "smooth boomerang" : style === "pursuit" ? "pure pursuit" : style === "chained" ? "chained corners" : "stop-and-turn"}${forwards === false ? " (reversed)" : ""}`, steps: g.steps, t: predict(g.steps, q, cal) });
      }
    } else if (goal.h !== undefined) {
      // a pure turn: the drawn step is the only sensible motion; it is verified, not replaced
    }
    cands.sort((x, y) => x.t - y.t);
    const predictedOrig = predict([step], q, cal);
    let tried = 0;
    for (const c of cands) {
      if (tried >= 4) break;
      if (best.valid && c.t >= predictedOrig - 0.2) continue; // the drawn step already works and this isn't predicted to beat it
      const ev = evaluate(c.steps);
      tried++;
      const better = (ev.valid && !best.valid) || (ev.valid && best.valid && ev.score < best.score - 0.05) || (!best.valid && !ev.valid && (Number(ev.reached) > Number(best.reached) || (ev.reached === best.reached && ev.posError + (ev.headingError ?? 0) < best.posError + (best.headingError ?? 0) - 0.5)));
      if (better) best = { steps: c.steps, label: c.label, ...ev };
    }
    reports.push({ index: i, label: best.label, reached: best.reached, posError: best.posError, headingError: best.headingError, style: best.label, seconds: best.seconds, hits: best.hits });
    if (!best.valid) notes.push(`Step ${i + 1}: ${best.reached ? "reaches the target but hits " + best.hits.join(", ") : `could not reach the target (ends ${best.posError.toFixed(1)} in${best.headingError !== null ? ` / ${best.headingError.toFixed(0)}°` : ""} off${best.hits.length ? ", touching " + best.hits.join(", ") : ""})`}.`);
    done.push(...best.steps);
    rec = best.rc;
  }
  const finalRoutine = optimizeTimeouts({ ...routine, steps: [...done, ...routine.steps.slice(hi + 1)] }, (rec ?? a.sim({ ...routine, steps: done })).steps);
  const finalRec = a.sim(finalRoutine);
  const lastGoal = (() => { for (let i = routine.steps.length - 1; i >= 0; i--) { const g = goalOf(routine.steps[i], planned.after[i]); if (g?.x !== undefined) return { x: g.x, y: g.y! }; } return null; })();
  const f = finalRec.frames[finalRec.frames.length - 1];
  return { routine: finalRoutine, reports, notes, reachedAll: reports.every((r) => r.reached), finalError: lastGoal ? dist(f, lastGoal) : 0, duration: finalRec.duration };
}
