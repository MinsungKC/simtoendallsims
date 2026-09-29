import { closestOnPoly, type Vec } from "./geometry";
import { smoothStroke } from "./fit";
import { defaultMotion, type MotionSpec } from "./routine";
import { obstaclePoly, type Obstacle } from "./world";
import { normalize } from "./common-plan";

export interface AutoRouteOptions {
  /** Solid field elements the route must not run into (Goals, Loaders, ...) */
  obstacles: Obstacle[];
  fieldSize: number;
  /** Half of the robot's width plus a margin: how far the path center stays from an obstacle or wall */
  clearance: number;
  /** The robot's back leads (drive in reverse), e.g. to pick up or score with the rear */
  reverse: boolean;
  /** Where the robot is before this stroke (the route stays connected to it) */
  from: { x: number; y: number };
}

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

/** Push every point out of the inflated obstacles and inside the walls, then relax so the detour is a smooth bend. */
export function avoidObstacles(path: Vec[], o: Pick<AutoRouteOptions, "obstacles" | "fieldSize" | "clearance">): Vec[] {
  const polys = o.obstacles.map(obstaclePoly);
  const lim = o.fieldSize / 2 - o.clearance;
  let pts = path.map((p) => ({ ...p }));
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      for (const poly of polys) {
        const cp = closestOnPoly(poly, p.x, p.y);
        const d = cp.inside ? 0 : dist(p, cp);
        if (d >= o.clearance) continue;
        let dx = p.x - cp.x, dy = p.y - cp.y;
        if (cp.inside || d < 1e-6) {
          const cx = poly.reduce((a, q) => a + q.x, 0) / poly.length, cy = poly.reduce((a, q) => a + q.y, 0) / poly.length;
          dx = p.x - cx; dy = p.y - cy;
          const l = Math.hypot(dx, dy) || 1;
          // leave through the boundary along the ray from the center
          let out = { x: cp.x, y: cp.y };
          for (let t = 0; t < 40; t++) { const q = { x: cx + (dx / l) * t, y: cy + (dy / l) * t }; if (closestOnPoly(poly, q.x, q.y).inside) out = q; else break; }
          p.x = out.x + (dx / l) * o.clearance; p.y = out.y + (dy / l) * o.clearance;
        } else {
          p.x = cp.x + (dx / d) * o.clearance; p.y = cp.y + (dy / d) * o.clearance;
        }
      }
      p.x = Math.max(-lim, Math.min(lim, p.x)); p.y = Math.max(-lim, Math.min(lim, p.y));
    }
    // relax interior points toward their neighbours' average so pushed points blend into a bend (endpoints stay)
    if (pass < 3) pts = pts.map((p, i) => (i === 0 || i === pts.length - 1 ? p : { x: (pts[i - 1].x + 2 * p.x + pts[i + 1].x) / 4, y: (pts[i - 1].y + 2 * p.y + pts[i + 1].y) / 4 }));
  }
  return pts;
}

function simplify(pts: Vec[], tol: number): number[] {
  const keep = new Set<number>([0, pts.length - 1]);
  const rec = (a: number, b: number) => {
    let worst = -1, wd = 0;
    const A = pts[a], B = pts[b], L = dist(A, B) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((B.x - A.x) * (A.y - pts[i].y) - (A.x - pts[i].x) * (B.y - A.y)) / L;
      if (d > wd) { wd = d; worst = i; }
    }
    if (worst >= 0 && wd > tol) { keep.add(worst); rec(a, worst); rec(worst, b); }
  };
  rec(0, pts.length - 1);
  return [...keep].sort((x, y) => x - y);
}

const heading = (a: Vec, b: Vec) => (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI;

/**
 * Turn a freehand pen stroke into waypoints: a smoothed, obstacle-avoiding line reduced to a few key points, each a
 * move-to-pose whose heading follows the line (the boomerang controller curves between them). Intermediate points chain without
 * stopping; the last one settles.
 */
export function routeFromStroke(stroke: Vec[], o: AutoRouteOptions): MotionSpec[] {
  const smooth = smoothStroke([o.from, ...stroke], 2);
  if (smooth.length < 2) return [];
  const safe = avoidObstacles(smooth, o);
  let idx = simplify(safe, 1.6);
  // no leg longer than 30", so every heading stays close to the drawn curve
  const dense: number[] = [];
  for (let k = 0; k < idx.length; k++) {
    dense.push(idx[k]);
    if (k + 1 < idx.length) {
      let last = idx[k];
      for (let i = idx[k] + 1; i < idx[k + 1]; i++) if (dist(safe[last], safe[i]) >= 30) { dense.push(i); last = i; }
    }
  }
  idx = [...new Set(dense)].sort((a, b) => a - b);
  // drop points that crowd the previous one (< 6")
  const pick: number[] = [idx[0]];
  for (const i of idx.slice(1, -1)) if (dist(safe[pick[pick.length - 1]], safe[i]) >= 9) pick.push(i);
  pick.push(idx[idx.length - 1]);
  const out: MotionSpec[] = [];
  for (let k = 1; k < pick.length; k++) {
    const i = pick[k], p = safe[i];
    // heading of the curve at this point: chord from the previous to the next sample around it
    const a = safe[Math.max(0, i - 2)], b = safe[Math.min(safe.length - 1, i + 2)];
    const travel = heading(a, b);
    const h = Math.round(normalize(o.reverse ? travel + 180 : travel));
    const last = k === pick.length - 1;
    const m = defaultMotion("moveToPose", { x: Math.round(p.x * 4) / 4, y: Math.round(p.y * 4) / 4, heading: h });
    if (m.type !== "moveToPose") continue;
    m.forwards = !o.reverse;
    m.lead = 0.5;
    if (!last) { m.minSpeed = 40; m.earlyExit = 6; }
    const legLen = dist(safe[pick[k - 1]], p);
    m.timeout = Math.max(1500, Math.ceil(((legLen / 15) * 1000 + 1500) / 100) * 100);
    out.push(m);
  }
  return out;
}
