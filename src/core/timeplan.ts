import { distanceField, findPath, type NavOptions } from "./nav";
import { normalize } from "./common-plan";
import type { RobotConfig } from "./robot";
import { defaultMotion } from "./routine";
import { runSingleMotion } from "./runtime";

/**
 * Time-optimal planning for a tank-drive robot, as a shortest-path problem over (stop, arrival pose):
 *
 *   time(leg) = turn(first) + drive(distance) + turn(last)
 *   drive(d)  = t0 + d / v          turn(a) = tw0 + a / w
 *
 * v, t0, w, tw0 are MEASURED for this robot with its controller gains (four quick simulations), so gain tuning, gearing, mass and wheel
 * choice all show up in the numbers. d is the length of the shortest route around Goals/walls on a grid. Every stop offers many arrival
 * poses (16 approach directions x usable ends of the robot); dynamic programming over the ordered stops picks the cheapest chain, so the
 * planner chooses the approach that saves the most time overall (for example arriving at a Goal already pointing toward the next piece).
 */
export interface Calib { v: number; t0: number; w: number; tw0: number }

const cache = new WeakMap<object, Calib>();

export function calibrate(cfg: RobotConfig): Calib {
  const hit = cache.get(cfg);
  if (hit) return hit;
  const time = (m: ReturnType<typeof defaultMotion>) => runSingleMotion(cfg, { ...m, timeout: 6000 } as never).duration;
  const d1 = 20, d2 = 56, a1 = 45, a2 = 180;
  const td1 = time(defaultMotion("moveToPoint", { x: 0, y: d1, heading: 0 })), td2 = time(defaultMotion("moveToPoint", { x: 0, y: d2, heading: 0 }));
  const ta1 = time(defaultMotion("turnToHeading", { x: 0, y: 0, heading: a1 })), ta2 = time(defaultMotion("turnToHeading", { x: 0, y: 0, heading: a2 }));
  const v = Math.max(5, (d2 - d1) / Math.max(0.05, td2 - td1));
  const w = Math.max(20, (a2 - a1) / Math.max(0.05, ta2 - ta1));
  const c = { v, t0: Math.max(0, td1 - d1 / v), w, tw0: Math.max(0, ta1 - a1 / w) };
  cache.set(cfg, c);
  return c;
}

export const driveTime = (c: Calib, d: number): number => (d < 0.5 ? 0 : c.t0 + d / c.v);
export const turnTime = (c: Calib, deg: number): number => (Math.abs(deg) < 2 ? 0 : c.tw0 + Math.abs(deg) / c.w);

const bearing = (a: { x: number; y: number }, b: { x: number; y: number }) => (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI;
const angleDiff = (a: number, b: number) => Math.abs(normalize(a - b));

/** One way to arrive at a stop. `h` is the heading the robot must have there (null = whatever the last leg leaves it with). */
export interface Pose { x: number; y: number; h: number | null; theta: number; side: "front" | "back" }

export interface StopSpec {
  /** candidate arrival poses */
  poses: Pose[];
  /** seconds spent doing the job here (pick up / score), added to every option equally but kept for ranking clarity */
  action: number;
}

export interface Chain { poses: Pose[]; time: number }

/**
 * Cheapest chains through the stops, best first: the optimum, plus the best chain that starts each first-stop option differently
 * (so the caller can simulate genuinely different alternatives, not five copies of one route).
 */
export function bestChains(start: { x: number; y: number; heading: number }, stops: StopSpec[], cfg: RobotConfig, nav: NavOptions, keep = 6): Chain[] {
  const cal = calibrate(cfg);
  // distances from each option of stop i to every cell: transitions read the cost from the destination's field
  const fields = stops.map((s) => s.poses.map((p) => distanceField(p, nav)));
  const leg = (from: { x: number; y: number; h: number }, to: Pose, field: { at: (x: number, y: number) => number }, endsFree: boolean): number => {
    // a stop tucked into a goal's cutout sits inside its blocked footprint: measure from the nearest free ground instead
    let d = field.at(from.x, from.y);
    if (!Number.isFinite(d)) for (const r of [3, 5, 7]) for (let k = 0; k < 8; k++) d = Math.min(d, field.at(from.x + r * Math.cos((k * Math.PI) / 4), from.y + r * Math.sin((k * Math.PI) / 4)) + r);
    if (!Number.isFinite(d)) return Infinity;
    const chord = Math.hypot(to.x - from.x, to.y - from.y);
    const lead = chord < 0.5 ? from.h : bearing(from, to);
    // drive forward, or in reverse if that saves the turn
    const fwd = angleDiff(from.h, lead), rev = angleDiff(from.h, lead + 180);
    const useRev = rev + (to.h === null ? 0 : angleDiff(lead + 180, to.h)) + 8 < fwd + (to.h === null ? 0 : angleDiff(lead, to.h));
    const t1 = useRev ? rev : fwd;
    const legH = useRev ? lead + 180 : lead;
    const t2 = to.h === null || endsFree ? 0 : angleDiff(legH, to.h);
    // the fastest way to run a leg is ONE boomerang move (turning happens while driving): the fixed cost of a motion (exit timers) is paid
    // once, and the turns only add their rotation time. Very short hops that are all turn pay the turn's fixed cost instead.
    const rot = (t1 + t2) / cal.w;
    return (d >= 0.5 ? cal.t0 + d / cal.v + rot : (t1 + t2 > 2 ? cal.tw0 + rot : 0)) + (useRev ? 0.05 : 0);
  };
  type Node = { t: number; prev: number; pose: Pose };
  // layered DP with the top `keep` entries per node kept so alternatives survive
  let prevLayer: { t: number; chain: Pose[]; end: { x: number; y: number; h: number } }[] = [{ t: 0, chain: [], end: { x: start.x, y: start.y, h: start.heading } }];
  void ({} as Node);
  for (let i = 0; i < stops.length; i++) {
    const next: { t: number; chain: Pose[]; end: { x: number; y: number; h: number } }[] = [];
    stops[i].poses.forEach((p, k) => {
      const cands: { t: number; chain: Pose[]; end: { x: number; y: number; h: number } }[] = [];
      for (const st of prevLayer) {
        const c = leg(st.end, p, fields[i][k], false);
        if (Number.isFinite(c)) cands.push({ t: st.t + c + stops[i].action, chain: [...st.chain, p], end: { x: p.x, y: p.y, h: p.h ?? bearing(st.end, p) } });
      }
      cands.sort((a, b) => a.t - b.t);
      next.push(...cands.slice(0, 2));
    });
    next.sort((a, b) => a.t - b.t);
    prevLayer = next.slice(0, 64);
    if (!prevLayer.length) return [];
  }
  // distinct alternatives: different first-stop poses / sides
  const out: Chain[] = [];
  const seen = new Set<string>();
  for (const c of prevLayer) {
    const key = c.chain.map((p) => `${p.side}${Math.round(p.theta / 45)}`).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ poses: c.chain, time: c.t });
    if (out.length >= keep) break;
  }
  return out;
}

/** The turn-then-drive legs from `from` to `to` around obstacles, as points (grid route, string-pulled). */
export function legPath(from: { x: number; y: number }, to: { x: number; y: number }, nav: NavOptions, cfg: RobotConfig): { x: number; y: number }[] {
  return findPath(from, to, nav) ?? findPath(from, to, { ...nav, radius: cfg.width / 2 + 1 }) ?? [from, to];
}
