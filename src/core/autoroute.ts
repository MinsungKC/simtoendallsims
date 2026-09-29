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
  // soft, small keep-outs (loose pieces) first and the big ones (Goals) last, so a Goal's clearance wins a conflict
  const ordered = [...o.obstacles].sort((a, b) => (a.keepOut ?? o.clearance) - (b.keepOut ?? o.clearance));
  const polys = ordered.map(obstaclePoly);
  const clr = ordered.map((ob) => ob.keepOut ?? o.clearance);
  const lim = o.fieldSize / 2 - o.clearance;
  let pts = path.map((p) => ({ ...p }));
  for (let pass = 0; pass < 7; pass++) {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      for (let pi = 0; pi < polys.length; pi++) {
        const poly = polys[pi];
        const clearance = clr[pi];
        const cp = closestOnPoly(poly, p.x, p.y);
        const d = cp.inside ? 0 : dist(p, cp);
        if (d >= clearance) continue;
        let dx = p.x - cp.x, dy = p.y - cp.y;
        if (cp.inside || d < 1e-6) {
          const cx = poly.reduce((a, q) => a + q.x, 0) / poly.length, cy = poly.reduce((a, q) => a + q.y, 0) / poly.length;
          // leave sideways: perpendicular to the path here, on the side the point already leans toward
          const a0 = pts[Math.max(0, i - 1)], b0 = pts[Math.min(pts.length - 1, i + 1)];
          let tx = b0.x - a0.x, ty = b0.y - a0.y;
          const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
          let nx = -ty, ny = tx;
          if ((p.x - cx) * nx + (p.y - cy) * ny < 0) { nx = -nx; ny = -ny; }
          let out = { x: p.x, y: p.y };
          for (let t = 0; t < 60; t += 0.25) { const q = { x: p.x + nx * t, y: p.y + ny * t }; out = q; if (!closestOnPoly(poly, q.x, q.y).inside) break; }
          p.x = out.x + nx * clearance; p.y = out.y + ny * clearance;
        } else {
          // a point on (or close to) the line through the obstacle's middle would just slide along the path when pushed radially:
          // send it sideways instead, to the side it already leans toward
          const a0 = pts[Math.max(0, i - 1)], b0 = pts[Math.min(pts.length - 1, i + 1)];
          let tx = b0.x - a0.x, ty = b0.y - a0.y;
          const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
          const cx0 = poly.reduce((acc, q) => acc + q.x, 0) / poly.length, cy0 = poly.reduce((acc, q) => acc + q.y, 0) / poly.length;
          const lateral = (p.x - cx0) * -ty + (p.y - cy0) * tx;
          if (Math.abs(lateral) < clearance * 0.5) {
            const sg = lateral < 0 ? -1 : 1;
            let out = { x: p.x, y: p.y };
            for (let t = 0; t < 60; t += 0.25) { const q = { x: p.x - ty * sg * t, y: p.y + tx * sg * t }; out = q; if (closestOnPoly(poly, q.x, q.y).inside === false && dist(q, closestOnPoly(poly, q.x, q.y)) >= clearance) break; }
            p.x = out.x; p.y = out.y;
          } else { p.x = cp.x + (dx / d) * clearance; p.y = cp.y + (dy / d) * clearance; }
        }
      }
      p.x = Math.max(-lim, Math.min(lim, p.x)); p.y = Math.max(-lim, Math.min(lim, p.y));
    }
    // relax interior points toward their neighbours' average so pushed points blend into a bend (endpoints stay)
    if (pass < 5) pts = pts.map((p, i) => (i === 0 || i === pts.length - 1 ? p : { x: (pts[i - 1].x + 2 * p.x + pts[i + 1].x) / 4, y: (pts[i - 1].y + 2 * p.y + pts[i + 1].y) / 4 }));
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

/** A freehand stroke as straight legs: smoothed, pushed clear of obstacles, reduced to its corners. Returns the points AFTER `from`. */
export function polylineFromStroke(stroke: Vec[], o: Pick<AutoRouteOptions, "obstacles" | "fieldSize" | "clearance" | "from">, tol = 2.5, minLeg = 6): Vec[] {
  const smooth = smoothStroke([o.from, ...stroke], 2);
  if (smooth.length < 2) return [];
  const safe = avoidObstacles(smooth, o);
  let idx = simplify(safe, tol);
  // corner-cutting guard: a straight leg between two kept points may still clip an obstacle the curve went around.
  // Where it does, bring back the sample point that hugs the obstacle most, until every leg keeps its clearance.
  const polys = o.obstacles.map(obstaclePoly);
  const kos = o.obstacles.map((ob) => ob.keepOut ?? o.clearance);
  // clearance beyond each obstacle's own keep-out (negative = too close)
  const clearAt = (q: Vec): number => { let w = Infinity; polys.forEach((poly, pi) => { const c = closestOnPoly(poly, q.x, q.y); w = Math.min(w, (c.inside ? 0 : dist(q, c)) - kos[pi] + o.clearance); }); return w; };
  // slack = how much closer to an obstacle the straight leg gets than the avoided curve it replaces (0 = no worse)
  const legSlack = (i0: number, i1: number): number => {
    const a = safe[i0], b = safe[i1];
    const n = Math.max(1, Math.ceil(dist(a, b)));
    let worst = Infinity;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const ref = safe[i0 + Math.round(t * (i1 - i0))];
      worst = Math.min(worst, clearAt(q) - Math.min(clearAt(ref), o.clearance) + 2);
    }
    return worst;
  };
  for (let guard = 0; guard < 60; guard++) {
    let fixed = true;
    for (let k = 0; k + 1 < idx.length && fixed; k++) {
      if (legSlack(idx[k], idx[k + 1]) >= 0 || idx[k + 1] - idx[k] < 2) continue;
      // add the sample between them that is farthest from the chord on the safe side
      let best = idx[k] + 1, bd = -1;
      for (let i = idx[k] + 1; i < idx[k + 1]; i++) { const d = Math.abs((safe[idx[k + 1]].x - safe[idx[k]].x) * (safe[idx[k]].y - safe[i].y) - (safe[idx[k]].x - safe[i].x) * (safe[idx[k + 1]].y - safe[idx[k]].y)); if (d > bd) { bd = d; best = i; } }
      idx = [...idx.slice(0, k + 1), best, ...idx.slice(k + 1)];
      fixed = false;
    }
    if (fixed) break;
  }
  const out: Vec[] = [];
  let prev = safe[idx[0]];
  for (const i of idx.slice(1)) {
    const p = safe[i];
    if (i !== idx[idx.length - 1] && dist(prev, p) < minLeg) continue;
    out.push({ x: Math.round(p.x * 4) / 4, y: Math.round(p.y * 4) / 4 });
    prev = p;
  }
  return out;
}

export { simplify as simplifyPolyline };
