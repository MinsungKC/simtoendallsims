import type { PathSpec, Vec } from "./routine";
import type { PathPoint } from "./lemlib";

function bezier(p: [Vec, Vec, Vec, Vec], t: number): Vec {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p[0].x + b * p[1].x + c * p[2].x + d * p[3].x, y: a * p[0].y + b * p[1].y + c * p[2].y + d * p[3].y };
}
export function bezierLength(p: [Vec, Vec, Vec, Vec], n = 60): number {
  let len = 0;
  let prev = p[0];
  for (let i = 1; i <= n; i++) {
    const q = bezier(p, i / n);
    len += Math.hypot(q.x - prev.x, q.y - prev.y);
    prev = q;
  }
  return len;
}

/** Sample points at uniform arc-length spacing. */
export function samplePath(path: PathSpec): Vec[] {
  const pts: Vec[] = [];
  for (let si = 0; si < path.segments.length; si++) {
    const seg = path.segments[si].p;
    const len = bezierLength(seg);
    const n = Math.max(2, Math.ceil(len / Math.max(0.25, path.spacing)));
    // arc-length lookup
    const lut: number[] = [0];
    let prev = seg[0];
    const fine = n * 8;
    for (let i = 1; i <= fine; i++) {
      const q = bezier(seg, i / fine);
      lut.push(lut[i - 1] + Math.hypot(q.x - prev.x, q.y - prev.y));
      prev = q;
    }
    const total = lut[fine];
    let j = 0;
    for (let i = si === 0 ? 0 : 1; i <= n; i++) {
      const target = (i / n) * total;
      while (j < fine && lut[j + 1] < target) j++;
      const f = lut[j + 1] > lut[j] ? (target - lut[j]) / (lut[j + 1] - lut[j]) : 0;
      pts.push(bezier(seg, (j + f) / fine));
    }
  }
  return pts;
}

/** Curvature (1/in) at sampled points, from neighboring points (Menger curvature). */
function curvatures(pts: Vec[]): number[] {
  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return 0;
    const a = pts[i - 1], c = pts[i + 1];
    const ab = Math.hypot(p.x - a.x, p.y - a.y), bc = Math.hypot(c.x - p.x, c.y - p.y), ca = Math.hypot(a.x - c.x, a.y - c.y);
    const area2 = Math.abs((p.x - a.x) * (c.y - a.y) - (p.y - a.y) * (c.x - a.x));
    return ab * bc * ca === 0 ? 0 : (2 * area2) / (ab * bc * ca);
  });
}

/**
 * Build LemLib path points: (x, y, speed 0..127). Speed drops in tight curves, then a backward pass
 * enforces the deceleration limit so the robot reaches 0 at the end (as path.jerryio does). The final
 * point has speed 0 - LemLib's follow() stops when the closest point's speed is 0.
 */
export function buildPathPoints(path: PathSpec, trackWidth = 12): PathPoint[] {
  const pts = samplePath(path);
  if (pts.length < 2) return [];
  const k = curvatures(pts);
  const speeds = pts.map((_, i) => {
    // slow the outer wheel from exceeding max speed: v(1 + k*track/2) <= max
    const s = path.maxSpeed / (1 + Math.abs(k[i]) * trackWidth * 0.5);
    return Math.max(path.minSpeed, Math.min(path.maxSpeed, s));
  });
  speeds[speeds.length - 1] = 0;
  for (let i = speeds.length - 2; i >= 0; i--) {
    const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    const allowed = Math.sqrt(speeds[i + 1] ** 2 + 2 * path.decel * d / 100);
    speeds[i] = Math.min(speeds[i], Math.max(allowed, path.minSpeed));
  }
  // a nonzero final approach speed avoids stalling before the end: keep last real point >= minSpeed
  speeds[speeds.length - 1] = 0;
  return pts.map((p, i) => ({ x: p.x, y: p.y, speed: speeds[i] }));
}

/** Serialize in the format LemLib v0.5's follow() reads (and path.jerryio's "LemLib v0.5" export writes). */
export function toLemLibPathFile(path: PathSpec, trackWidth = 12): string {
  const pts = buildPathPoints(path, trackWidth);
  const fmt = (n: number) => Number(n.toFixed(3)).toString();
  let out = pts.map((p) => `${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.speed)}`).join("\n") + "\n";
  // "ghost point" 20 in past the end so the robot stops smoothly
  if (pts.length >= 3) {
    const a = pts[pts.length - 3], b = pts[pts.length - 2];
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const scale = (d + 20) / d;
    out += `${fmt(a.x + (b.x - a.x) * scale)}, ${fmt(a.y + (b.y - a.y) * scale)}, 0\n`;
  }
  out += "endData\n";
  out += `${path.decel}\n${path.maxSpeed}\n200\n`;
  for (const s of path.segments) {
    const p = s.p;
    out += `${fmt(p[0].x)}, ${fmt(p[0].y)}, ${fmt(p[1].x)}, ${fmt(p[1].y)}, ${fmt(p[2].x)}, ${fmt(p[2].y)}, ${fmt(p[3].x)}, ${fmt(p[3].y)}\n`;
  }
  return out;
}

export function pathLength(path: PathSpec): number {
  return path.segments.reduce((a, s) => a + bezierLength(s.p), 0);
}
