export interface Vec { x: number; y: number }

export const RAD = Math.PI / 180;

/** Oriented box. Heading uses the sim convention (deg, 0 = +y, clockwise +). Half-extents in `hl` (forward) and `hw` (right). */
export interface Obb {
  x: number;
  y: number;
  heading: number;
  hl: number;
  hw: number;
}

export function forwardOf(heading: number): Vec {
  const t = heading * RAD;
  return { x: Math.sin(t), y: Math.cos(t) };
}
export function rightOf(heading: number): Vec {
  const t = heading * RAD;
  return { x: Math.cos(t), y: -Math.sin(t) };
}

export function corners(b: Obb): Vec[] {
  const f = forwardOf(b.heading);
  const r = rightOf(b.heading);
  const pts: Vec[] = [];
  for (const [a, c] of [[1, 1], [1, -1], [-1, -1], [-1, 1]] as const) {
    pts.push({ x: b.x + f.x * a * b.hl + r.x * c * b.hw, y: b.y + f.y * a * b.hl + r.y * c * b.hw });
  }
  return pts;
}

export function aabb(cx: number, cy: number, w: number, h: number): Obb {
  // heading 0: forward = +y (extent h/2), right = +x (extent w/2)
  return { x: cx, y: cy, heading: 0, hl: h / 2, hw: w / 2 };
}

export interface Manifold {
  /** Unit normal pointing from B toward A */
  nx: number;
  ny: number;
  depth: number;
  /** Contact point (world) */
  px: number;
  py: number;
}

/** SAT between two oriented boxes. Returns null if separated. */
export function obbContact(A: Obb, B: Obb): Manifold | null {
  const axes: Vec[] = [forwardOf(A.heading), rightOf(A.heading), forwardOf(B.heading), rightOf(B.heading)];
  const ca = corners(A);
  const cb = corners(B);
  let best: { depth: number; nx: number; ny: number } | null = null;
  for (const ax of axes) {
    const pa = ca.map((p) => p.x * ax.x + p.y * ax.y);
    const pb = cb.map((p) => p.x * ax.x + p.y * ax.y);
    const minA = Math.min(...pa), maxA = Math.max(...pa);
    const minB = Math.min(...pb), maxB = Math.max(...pb);
    const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
    if (overlap <= 0) return null;
    if (!best || overlap < best.depth) {
      const centerDir = (A.x - B.x) * ax.x + (A.y - B.y) * ax.y;
      const sgn = centerDir >= 0 ? 1 : -1;
      best = { depth: overlap, nx: ax.x * sgn, ny: ax.y * sgn };
    }
  }
  if (!best) return null;
  // Contact point: the vertex that penetrates deepest into the other box along the normal.
  let bestPen = -Infinity;
  let pt = { x: A.x, y: A.y };
  for (const p of ca) {
    const pen = -((p.x - B.x) * best.nx + (p.y - B.y) * best.ny); // A vertex against B side
    if (pen > bestPen) { bestPen = pen; pt = p; }
  }
  for (const p of cb) {
    const pen = (p.x - A.x) * best.nx + (p.y - A.y) * best.ny;
    if (pen > bestPen) { bestPen = pen; pt = p; }
  }
  return { nx: best.nx, ny: best.ny, depth: best.depth, px: pt.x, py: pt.y };
}

/** Closest point on an OBB to p, in world coordinates, plus whether p is inside. */
export function closestOnObb(b: Obb, px: number, py: number): { x: number; y: number; inside: boolean } {
  const f = forwardOf(b.heading);
  const r = rightOf(b.heading);
  const dx = px - b.x, dy = py - b.y;
  const lf = dx * f.x + dy * f.y;
  const lr = dx * r.x + dy * r.y;
  const cf = Math.max(-b.hl, Math.min(b.hl, lf));
  const cr = Math.max(-b.hw, Math.min(b.hw, lr));
  const inside = Math.abs(lf) <= b.hl && Math.abs(lr) <= b.hw;
  return { x: b.x + f.x * cf + r.x * cr, y: b.y + f.y * cf + r.y * cr, inside };
}

export function angleDiff(a: number, b: number): number {
  // shortest signed difference a - b in degrees, in (-180, 180]
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

// ---------------------------------------------------------------- convex polygons

/** Regular polygon with `n` sides. `acrossFlats` is the distance between opposite flat sides. A flat faces +x when phase = 0. */
export function regularPolygon(cx: number, cy: number, n: number, acrossFlats: number, phaseDeg = 0): Vec[] {
  const circum = acrossFlats / 2 / Math.cos(Math.PI / n);
  const pts: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) * 2 * Math.PI) / n + (phaseDeg * Math.PI) / 180;
    pts.push({ x: cx + circum * Math.cos(a), y: cy + circum * Math.sin(a) });
  }
  return pts;
}

export function rectVerts(cx: number, cy: number, w: number, h: number): Vec[] {
  return [
    { x: cx - w / 2, y: cy - h / 2 }, { x: cx + w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy + h / 2 }, { x: cx - w / 2, y: cy + h / 2 },
  ];
}

export function centroid(v: Vec[]): Vec {
  let x = 0, y = 0;
  for (const p of v) { x += p.x; y += p.y; }
  return { x: x / v.length, y: y / v.length };
}

function project(v: Vec[], ax: Vec): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const p of v) { const d = p.x * ax.x + p.y * ax.y; if (d < lo) lo = d; if (d > hi) hi = d; }
  return [lo, hi];
}

/** SAT between two convex polygons (any winding). Normal points from B toward A. */
export function polyContact(A: Vec[], B: Vec[]): Manifold | null {
  let best: { depth: number; nx: number; ny: number } | null = null;
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      let ax = q.y - p.y, ay = -(q.x - p.x);
      const len = Math.hypot(ax, ay);
      if (len < 1e-9) continue;
      ax /= len; ay /= len;
      const [minA, maxA] = project(A, { x: ax, y: ay });
      const [minB, maxB] = project(B, { x: ax, y: ay });
      const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
      if (overlap <= 0) return null;
      if (!best || overlap < best.depth) best = { depth: overlap, nx: ax, ny: ay };
    }
  }
  if (!best) return null;
  const ca = centroid(A), cb = centroid(B);
  if ((ca.x - cb.x) * best.nx + (ca.y - cb.y) * best.ny < 0) { best.nx = -best.nx; best.ny = -best.ny; }
  let bestPen = -Infinity;
  let pt = ca;
  for (const p of A) {
    const pen = -((p.x - cb.x) * best.nx + (p.y - cb.y) * best.ny);
    if (pen > bestPen) { bestPen = pen; pt = p; }
  }
  for (const p of B) {
    const pen = (p.x - ca.x) * best.nx + (p.y - ca.y) * best.ny;
    if (pen > bestPen) { bestPen = pen; pt = p; }
  }
  return { nx: best.nx, ny: best.ny, depth: best.depth, px: pt.x, py: pt.y };
}

export function pointInConvex(v: Vec[], px: number, py: number): boolean {
  let sign = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    const cr = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
    if (Math.abs(cr) < 1e-12) continue;
    const s = cr > 0 ? 1 : -1;
    if (sign === 0) sign = s; else if (s !== sign) return false;
  }
  return true;
}

/** Closest point on a convex polygon's boundary/interior to p. */
export function closestOnPoly(v: Vec[], px: number, py: number): { x: number; y: number; inside: boolean } {
  if (pointInConvex(v, px, py)) return { x: px, y: py, inside: true };
  let best = { x: v[0].x, y: v[0].y }, bd = Infinity;
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const cx = a.x + dx * t, cy = a.y + dy * t;
    const d = Math.hypot(px - cx, py - cy);
    if (d < bd) { bd = d; best = { x: cx, y: cy }; }
  }
  return { ...best, inside: false };
}

/** Do two convex polygons overlap at all? */
export function polysOverlap(A: Vec[], B: Vec[]): boolean {
  return polyContact(A, B) !== null;
}
