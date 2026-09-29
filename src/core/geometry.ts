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
