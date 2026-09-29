import { closestOnPoly, type Vec } from "./geometry";
import { obstaclePoly, type Obstacle } from "./world";

/**
 * Grid path planning for the robot's CENTER. Every obstacle is inflated by its keep-out (the robot's turning radius for Goals, less for
 * loose pieces) and the walls by the robot's half-width, then A* finds a route on a 1" grid and line-of-sight smoothing pulls it taut.
 * Unlike nudging a hand-drawn line, this cannot leave a leg cutting a corner: every leg of the result is checked against the grid.
 */
export interface NavOptions {
  obstacles: Obstacle[];
  fieldSize: number;
  /** default keep-out for obstacles without their own */
  radius: number;
  /** distance the center keeps from the walls */
  wall: number;
}

interface Grid { n: number; half: number; blocked: Uint8Array }

const gridCache = new Map<string, Grid>();

function build(o: NavOptions): Grid {
  const key = `${o.fieldSize}|${o.radius}|${o.wall}|${o.obstacles.map((b) => `${b.x.toFixed(1)},${b.y.toFixed(1)},${b.w},${b.h},${b.keepOut ?? ""}${b.soft ? "s" : ""},${b.verts ? b.verts.length : 0}`).join(";")}`;
  const hit = gridCache.get(key);
  if (hit) return hit;
  const n = Math.round(o.fieldSize), half = o.fieldSize / 2;
  const blocked = new Uint8Array(n * n);
  const cell = (i: number) => -half + i + 0.5;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = cell(i), y = cell(j);
    if (Math.abs(x) > half - o.wall || Math.abs(y) > half - o.wall) blocked[j * n + i] = 1;
  }
  for (const ob of o.obstacles) {
    const poly = obstaclePoly(ob);
    const k = ob.keepOut ?? o.radius;
    const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
    const i0 = Math.max(0, Math.floor(Math.min(...xs) - k + half - 1)), i1 = Math.min(n - 1, Math.ceil(Math.max(...xs) + k + half + 1));
    const j0 = Math.max(0, Math.floor(Math.min(...ys) - k + half - 1)), j1 = Math.min(n - 1, Math.ceil(Math.max(...ys) + k + half + 1));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = closestOnPoly(poly, cell(i), cell(j));
      if (c.inside || Math.hypot(cell(i) - c.x, cell(j) - c.y) < k) { if (ob.soft) { if (blocked[j * n + i] === 0) blocked[j * n + i] = 2; } else blocked[j * n + i] = 1; }
    }
  }
  const g = { n, half, blocked };
  if (gridCache.size > 12) gridCache.clear();
  gridCache.set(key, g);
  return g;
}

const idx = (g: Grid, x: number, y: number): [number, number] => [Math.min(g.n - 1, Math.max(0, Math.floor(x + g.half))), Math.min(g.n - 1, Math.max(0, Math.floor(y + g.half)))];

/** Path for the robot center from a to b, or null if the goal is walled off. The ends are always allowed (a start hard against a wall, a target at a Goal). */
export function findPath(a: Vec, b: Vec, o: NavOptions, freeR = 6): Vec[] | null {
  const g0 = build(o);
  const g: Grid = { ...g0, blocked: g0.blocked.slice() };
  const carve = (p: Vec) => { const [ci, cj] = idx(g, p.x, p.y); const r = Math.ceil(freeR); for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) if (i >= 0 && j >= 0 && i < g.n && j < g.n && Math.hypot(i - ci, j - cj) <= freeR) g.blocked[j * g.n + i] = 0; };
  carve(a); carve(b);
  const [si, sj] = idx(g, a.x, a.y), [ti, tj] = idx(g, b.x, b.y);
  const N = g.n;
  const dist = new Float64Array(N * N).fill(Infinity);
  const prev = new Int32Array(N * N).fill(-1);
  const open: [number, number][] = [[0, sj * N + si]];
  dist[sj * N + si] = 0;
  const h = (i: number, j: number) => Math.hypot(i - ti, j - tj);
  const push = (f: number, k: number) => { open.push([f, k]); let c = open.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (open[p][0] <= open[c][0]) break; [open[p], open[c]] = [open[c], open[p]]; c = p; } };
  const pop = () => { const top = open[0]; const last = open.pop()!; if (open.length) { open[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < open.length && open[l][0] < open[m][0]) m = l; if (r < open.length && open[r][0] < open[m][0]) m = r; if (m === c) break; [open[m], open[c]] = [open[c], open[m]]; c = m; } } return top; };
  const goal = tj * N + ti;
  let found = false;
  while (open.length) {
    const [, k] = pop();
    if (k === goal) { found = true; break; }
    const ci = k % N, cj = (k / N) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N || g.blocked[nj * N + ni] === 1) continue;
      if (di && dj && (g.blocked[cj * N + ni] === 1 || g.blocked[nj * N + ci] === 1)) continue; // no squeezing through a diagonal gap
      const step = di && dj ? Math.SQRT2 : 1;
      const nd = dist[k] + step * (g.blocked[nj * N + ni] === 2 ? 15 : 1); // pushing through loose pieces is allowed but expensive
      const nk = nj * N + ni;
      if (nd < dist[nk]) { dist[nk] = nd; prev[nk] = k; push(nd + h(ni, nj), nk); }
    }
  }
  if (!found) return null;
  const cells: Vec[] = [];
  for (let k = goal; k !== -1; k = prev[k]) cells.push({ x: (k % N) - g.half + 0.5, y: ((k / N) | 0) - g.half + 0.5 });
  cells.reverse();
  cells[0] = { ...a }; cells[cells.length - 1] = { ...b };
  // string pulling: keep only the corners that line of sight requires
  const clear = (p: Vec, q: Vec) => { const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) * 2)); for (let s = 0; s <= n; s++) { const [i, j] = idx(g, p.x + ((q.x - p.x) * s) / n, p.y + ((q.y - p.y) * s) / n); if (g.blocked[j * N + i] === 1) return false; } return true; };
  const softAlong = (p: Vec, q: Vec) => { const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) * 2)); let c = 0; for (let s = 0; s <= n; s++) { const [i, j] = idx(g, p.x + ((q.x - p.x) * s) / n, p.y + ((q.y - p.y) * s) / n); if (g.blocked[j * N + i] === 2) c++; } return c / 2; };
  const softCells = (from: number, to: number) => { let c = 0; for (let k = from; k <= to; k++) { const [i, j] = idx(g, cells[k].x, cells[k].y); if (g.blocked[j * N + i] === 2) c++; } return c; };
  const out: Vec[] = [cells[0]];
  let at = 0;
  while (at < cells.length - 1) {
    let far = cells.length - 1;
    while (far > at + 1 && (!clear(cells[at], cells[far]) || softAlong(cells[at], cells[far]) > softCells(at, far) + 1)) far--;
    out.push(cells[far]);
    at = far;
  }
  return out;
}

/** Index of the first point of `pts` that sits in a blocked cell (ignoring the free zone around the first and last points), or -1. */
export function firstBlocked(pts: Vec[], o: NavOptions, freeR = 6): number {
  if (pts.length < 2) return -1;
  const g = build(o);
  const a = pts[0], b = pts[pts.length - 1];
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    if (Math.hypot(p.x - a.x, p.y - a.y) <= freeR || Math.hypot(p.x - b.x, p.y - b.y) <= freeR) continue;
    const [i, j] = idx(g, p.x, p.y);
    if (g.blocked[j * g.n + i] === 1) return k;
  }
  return -1;
}

/** Shortest-path distances (inches, soft pieces cost extra) from `from` to every cell; read with `.at(x, y)`. */
export function distanceField(from: Vec, o: NavOptions, freeR = 6): { at: (x: number, y: number) => number } {
  const g0 = build(o);
  const g: Grid = { ...g0, blocked: g0.blocked.slice() };
  const [ci, cj] = idx(g, from.x, from.y);
  for (let j = cj - freeR; j <= cj + freeR; j++) for (let i = ci - freeR; i <= ci + freeR; i++) if (i >= 0 && j >= 0 && i < g.n && j < g.n && Math.hypot(i - ci, j - cj) <= freeR) g.blocked[j * g.n + i] = 0;
  const N = g.n;
  const dist = new Float64Array(N * N).fill(Infinity);
  const heap: [number, number][] = [[0, cj * N + ci]];
  dist[cj * N + ci] = 0;
  const push = (f: number, k: number) => { heap.push([f, k]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop()!; if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  while (heap.length) {
    const [d, k] = pop();
    if (d > dist[k]) continue;
    const i0 = k % N, j0 = (k / N) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i0 + di, nj = j0 + dj;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N || g.blocked[nj * N + ni] === 1) continue;
      if (di && dj && (g.blocked[j0 * N + ni] === 1 || g.blocked[nj * N + i0] === 1)) continue;
      const nd = d + (di && dj ? Math.SQRT2 : 1) * (g.blocked[nj * N + ni] === 2 ? 15 : 1);
      if (nd < dist[nj * N + ni]) { dist[nj * N + ni] = nd; push(nd, nj * N + ni); }
    }
  }
  return { at: (x, y) => { const [i, j] = idx(g, x, y); return dist[j * N + i]; } };
}
