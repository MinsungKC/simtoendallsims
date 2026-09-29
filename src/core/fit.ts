import type { BezierSegment, Vec } from "./routine";

/**
 * Turn a freehand stroke into a smooth chain of cubic Beziers (Schneider's least-squares curve fitting, the algorithm behind
 * most vector-drawing "smooth" tools). Joins are tangent-continuous, so the robot never has to stop or kink at a segment boundary.
 */
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
const len = (a: Vec) => Math.hypot(a.x, a.y);
const unit = (a: Vec): Vec => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };

type Cubic = [Vec, Vec, Vec, Vec];

/** Drop jitter: moving-average smoothing that keeps the endpoints, then even resampling every `spacing` inches. */
export function smoothStroke(raw: Vec[], spacing = 1.5, window = 2): Vec[] {
  const pts: Vec[] = [];
  for (const p of raw) if (!pts.length || len(sub(p, pts[pts.length - 1])) > 0.05) pts.push(p);
  if (pts.length < 3) return pts;
  const sm = pts.map((_, i) => {
    if (i === 0 || i === pts.length - 1) return pts[i];
    let sx = 0, sy = 0, n = 0;
    for (let k = -window; k <= window; k++) { const j = i + k; if (j < 0 || j >= pts.length) continue; sx += pts[j].x; sy += pts[j].y; n++; }
    return { x: sx / n, y: sy / n };
  });
  const out: Vec[] = [sm[0]];
  let carry = 0;
  for (let i = 1; i < sm.length; i++) {
    let a = sm[i - 1];
    const b = sm[i];
    let d = len(sub(b, a));
    while (carry + d >= spacing) {
      const t = (spacing - carry) / d;
      a = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      out.push(a);
      d = len(sub(b, a));
      carry = 0;
    }
    carry += d;
  }
  const last = sm[sm.length - 1];
  if (len(sub(out[out.length - 1], last)) > 0.3) out.push(last); else out[out.length - 1] = last;
  return out;
}

const bez = (c: Cubic, t: number): Vec => {
  const u = 1 - t;
  return add(add(mul(c[0], u * u * u), mul(c[1], 3 * u * u * t)), add(mul(c[2], 3 * u * t * t), mul(c[3], t * t * t)));
};
const bezD1 = (c: Cubic, t: number): Vec => {
  const u = 1 - t;
  return add(add(mul(sub(c[1], c[0]), 3 * u * u), mul(sub(c[2], c[1]), 6 * u * t)), mul(sub(c[3], c[2]), 3 * t * t));
};
const bezD2 = (c: Cubic, t: number): Vec => {
  const u = 1 - t;
  return add(mul(add(sub(c[2], mul(c[1], 2)), c[0]), 6 * u), mul(add(sub(c[3], mul(c[2], 2)), c[1]), 6 * t));
};

function chordParams(p: Vec[]): number[] {
  const u = [0];
  for (let i = 1; i < p.length; i++) u.push(u[i - 1] + len(sub(p[i], p[i - 1])));
  const total = u[u.length - 1] || 1;
  return u.map((v) => v / total);
}

function generate(p: Vec[], u: number[], t1: Vec, t2: Vec): Cubic {
  const first = p[0], last = p[p.length - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < p.length; i++) {
    const t = u[i], b = 1 - t;
    const b0 = b * b * b, b1 = 3 * t * b * b, b2 = 3 * t * t * b, b3 = t * t * t;
    const a1 = mul(t1, b1), a2 = mul(t2, b2);
    c00 += dot(a1, a1); c01 += dot(a1, a2); c11 += dot(a2, a2);
    const tmp = sub(p[i], add(mul(first, b0 + b1), mul(last, b2 + b3)));
    x0 += dot(a1, tmp); x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  const seg = len(sub(last, first));
  let al = Math.abs(det) > 1e-12 ? (x0 * c11 - x1 * c01) / det : 0;
  let ar = Math.abs(det) > 1e-12 ? (c00 * x1 - c01 * x0) / det : 0;
  if (al < seg * 1e-3 || ar < seg * 1e-3) al = ar = seg / 3;
  return [first, add(first, mul(t1, al)), add(last, mul(t2, ar)), last];
}

function maxError(p: Vec[], c: Cubic, u: number[]): { err: number; at: number } {
  let err = 0, at = Math.floor(p.length / 2);
  for (let i = 1; i < p.length - 1; i++) {
    const e = len(sub(bez(c, u[i]), p[i]));
    if (e >= err) { err = e; at = i; }
  }
  return { err, at };
}

function reparam(p: Vec[], c: Cubic, u: number[]): number[] {
  return u.map((t, i) => {
    const d = sub(bez(c, t), p[i]);
    const d1 = bezD1(c, t), d2 = bezD2(c, t);
    const den = dot(d1, d1) + dot(d, d2);
    return Math.abs(den) < 1e-9 ? t : Math.min(1, Math.max(0, t - dot(d, d1) / den));
  });
}

function fit(p: Vec[], t1: Vec, t2: Vec, tol: number, out: Cubic[]): void {
  if (p.length === 2) {
    const d = len(sub(p[1], p[0])) / 3;
    out.push([p[0], add(p[0], mul(t1, d)), add(p[1], mul(t2, d)), p[1]]);
    return;
  }
  let u = chordParams(p);
  let c = generate(p, u, t1, t2);
  let { err, at } = maxError(p, c, u);
  if (err < tol) { out.push(c); return; }
  if (err < tol * 4) {
    for (let k = 0; k < 6; k++) {
      u = reparam(p, c, u);
      c = generate(p, u, t1, t2);
      ({ err, at } = maxError(p, c, u));
      if (err < tol) { out.push(c); return; }
    }
  }
  at = Math.max(1, Math.min(p.length - 2, at));
  const mid = unit(sub(p[at - 1], p[at + 1]));
  fit(p.slice(0, at + 1), t1, mid, tol, out);
  fit(p.slice(at), mul(mid, -1), t2, tol, out);
}

/** Fit a smoothed stroke; `tol` is the max deviation (inches) allowed from the drawn line. */
export function fitStroke(stroke: Vec[], tol = 0.8): BezierSegment[] {
  const p = smoothStroke(stroke);
  if (p.length < 2) return [];
  const k = Math.min(3, p.length - 1);
  const t1 = unit(sub(p[k], p[0])), t2 = unit(sub(p[p.length - 1 - k], p[p.length - 1]));
  const out: Cubic[] = [];
  fit(p, t1, t2, tol, out);
  return out.map((c) => ({ p: c }));
}
