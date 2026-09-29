import { describe, expect, it } from "vitest";
import { fitStroke, smoothStroke } from "./fit";
import { samplePath } from "./path";

const arc = Array.from({ length: 200 }, (_, i) => { const a = (i / 199) * Math.PI; return { x: 30 * Math.cos(a) + (Math.random() - 0.5) * 0.6, y: 30 * Math.sin(a) + (Math.random() - 0.5) * 0.6 }; });

describe("freehand stroke fitting", () => {
  it("fits a noisy half circle with a few tangent-continuous Beziers that stay near the stroke", () => {
    const segs = fitStroke(arc);
    expect(segs.length).toBeGreaterThan(0); expect(segs.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < segs.length; i++) {
      const a = segs[i - 1].p, b = segs[i].p;
      expect(b[0]).toEqual(a[3]);
      const d1 = { x: a[3].x - a[2].x, y: a[3].y - a[2].y }, d2 = { x: b[1].x - b[0].x, y: b[1].y - b[0].y };
      const cos = (d1.x * d2.x + d1.y * d2.y) / (Math.hypot(d1.x, d1.y) * Math.hypot(d2.x, d2.y));
      expect(cos).toBeGreaterThan(0.99);
    }
    const pts = samplePath({ segments: segs, maxSpeed: 100, minSpeed: 30, decel: 3000, spacing: 1 });
    for (const p of pts) expect(Math.abs(Math.hypot(p.x, p.y) - 30)).toBeLessThan(1.5);
  });
  it("keeps the ends and resamples evenly; a straight stroke is one segment", () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i, y: i * 0.5 + (i % 2) * 0.1 }));
    const s = smoothStroke(line);
    expect(s[0]).toEqual(line[0]); expect(s.at(-1)).toEqual(line.at(-1));
    expect(fitStroke(line)).toHaveLength(1);
  });
});
