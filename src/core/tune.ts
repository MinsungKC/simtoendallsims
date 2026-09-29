import type { ControllerGains, RobotConfig } from "./robot";
import { runSingleMotion } from "./runtime";
import { defaultMotion } from "./routine";

export interface TuneResult {
  lateral: ControllerGains;
  angular: ControllerGains;
  horizontalDrift: number;
  /** cost of the winning settings (lower is better) and of the input settings, for the UI */
  score: { before: number; after: number };
  /** True when the search found nothing better than the current gains on smooth-auton motions, so they were left alone */
  kept?: boolean;
}

/** LemLib guidance: ~2 for an all-omni "drift" drive, ~8 for center traction wheels. */
export function suggestHorizontalDrift(cfg: RobotConfig): number {
  const n = cfg.wheels.length || 1;
  const traction = cfg.wheels.filter((w) => w.type === "traction").length / n;
  return Math.round((2 + 6 * traction) * 10) / 10;
}

interface Trial { settle: number; end: number; err: number; overshoot: number; timedOut: boolean }

/** Time (s from start) after which |error| stays below tol, judged on the TRUE state, not the controller's exit timers. */
function settleTime(values: number[], times: number[], tol: number): number {
  let last = 0;
  for (let i = 0; i < values.length; i++) if (Math.abs(values[i]) > tol) last = times[i] - times[0];
  return last;
}

function lateralTrial(cfg: RobotConfig, dist: number): Trial {
  const rec = runSingleMotion(cfg, { ...defaultMotion("moveToPoint", { x: 0, y: dist, heading: 0 }), timeout: 4000 } as never);
  const fr = rec.frames.filter((f) => f.step === 0);
  const err = fr.map((f) => Math.hypot(f.x, f.y - dist));
  const f = rec.frames[rec.frames.length - 1];
  return {
    settle: settleTime(err, fr.map((x) => x.t), 1.0),
    end: rec.duration,
    err: Math.hypot(f.x, f.y - dist),
    overshoot: Math.max(0, ...rec.frames.map((x) => x.y - dist)),
    timedOut: rec.steps[0].timedOut,
  };
}

function angularTrial(cfg: RobotConfig, deg: number): Trial {
  const rec = runSingleMotion(cfg, { ...defaultMotion("turnToHeading", { x: 0, y: 0, heading: deg }), timeout: 3000 } as never);
  const fr = rec.frames.filter((f) => f.step === 0);
  const err = fr.map((f) => f.heading - deg);
  const f = rec.frames[rec.frames.length - 1];
  return {
    settle: settleTime(err, fr.map((x) => x.t), 2.0),
    end: rec.duration,
    err: Math.abs(f.heading - deg),
    overshoot: Math.max(0, ...rec.frames.map((x) => x.heading - deg)),
    timedOut: rec.steps[0].timedOut,
  };
}

const cost = (trials: Trial[], overshootW: number, errW: number): number =>
  trials.reduce((c, t) => c + (t.end + t.settle) / 2 + overshootW * t.overshoot + errW * t.err + (t.timedOut ? 2 : 0), 0) / trials.length;

const r2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Search PID gains against the physics model + LemLib controller port. Each candidate is scored on settling time,
 * overshoot and final error over several moves, and additionally at +/-25% kP so the result isn't knife-edge.
 * The result is a STARTING POINT: the real robot differs (battery, wear, floor, mass distribution).
 */
export function autoTune(cfg: RobotConfig, onProgress?: (p: number) => void, mode: "safe" | "fast" = "safe"): TuneResult {
  // keep the user's horizontal drift: it shapes boomerang/pure-pursuit curves, and changing it silently reshapes smooth autons
  const base: RobotConfig = { ...cfg };
  const ovW = mode === "safe" ? 0.9 : 0.3; // how much overshoot past the target costs (safe: stay clear of things)
  const lat = (kP: number, kD: number) => {
    const c = { ...base, lateral: { ...base.lateral, kP, kD } };
    return cost([lateralTrial(c, 12), lateralTrial(c, 24), lateralTrial(c, 48)], ovW, 0.5);
  };
  const ang = (kP: number, kD: number) => {
    const c = { ...base, angular: { ...base.angular, kP, kD } };
    return cost([angularTrial(c, 45), angularTrial(c, 90), angularTrial(c, 180)], 0.03, 0.1);
  };
  // score at the candidate and at +/-25% of each gain, so the winner is not knife-edge on a real robot;
  // a tiny penalty on gain size prefers gentle controllers when scores tie
  const robust = (f: (kP: number, kD: number) => number, pw: number, dw: number) => (kP: number, kD: number) =>
    (f(kP, kD) * 2 + f(kP * 0.8, kD) + f(kP * 1.2, kD) + f(kP, kD * 0.8) + f(kP, kD * 1.2)) / 6 + pw * kP + dw * kD;

  const robustLat = robust(lat, 0, 0), robustAng = robust(ang, 0, 0);
  const before = { lat: robustLat(cfg.lateral.kP, cfg.lateral.kD), ang: robustAng(cfg.angular.kP, cfg.angular.kD) };

  let progress = 0;
  const total = 2 * (36 + 24);
  const tick = () => onProgress?.(Math.min(1, ++progress / total));

  const search = (
    f: (kP: number, kD: number) => number,
    kPs: number[], kDs: number[], range: { p: [number, number]; d: [number, number] },
  ) => {
    let best = { kP: kPs[0], kD: kDs[0], c: Infinity };
    for (const kP of kPs) for (const kD of kDs) { const c = f(kP, kD); tick(); if (c < best.c) best = { kP, kD, c }; }
    let scale = 0.4;
    for (let round = 0; round < 3; round++) {
      for (const fp of [1 - scale, 1, 1 + scale]) for (const fd of [1 - scale, 1, 1 + scale]) {
        if (fp === 1 && fd === 1) continue;
        const kP = r2(clamp(best.kP * fp, ...range.p));
        const kD = r2(clamp(best.kD === 0 ? (fd > 1 ? 0.5 : 0) : best.kD * fd, ...range.d));
        const c = f(kP, kD); tick();
        if (c < best.c) best = { kP, kD, c };
      }
      scale /= 2;
    }
    return best;
  };

  const bestLat = search(robustLat, mode === "safe" ? [3, 5, 8, 12, 16, 20] : [3, 5, 8, 12, 18, 28], mode === "safe" ? [0, 5, 12, 20, 35, 55] : [0, 10, 25, 45, 75, 110], mode === "safe" ? { p: [2, 20], d: [0, 60] } : { p: [2, 40], d: [0, 120] });
  const bestAng = search(robustAng, mode === "safe" ? [1, 1.6, 2.4, 3.2, 4, 5] : [1, 1.6, 2.4, 3.6, 5, 7], mode === "safe" ? [3, 6, 10, 16, 24, 38] : [3, 6, 10, 18, 30, 50], mode === "safe" ? { p: [0.5, 5], d: [1, 40] } : { p: [0.5, 8], d: [1, 60] });

  // Validate on the motions that make up smooth autons (boomerang poses, reverse, chained points): an overshoot here is a robot
  // driving through a Goal. Keep the current gains if the new ones are not at least as tidy.
  const suite = (lateral: ControllerGains, angular: ControllerGains) => {
    const c = { ...base, lateral, angular };
    let t = 0;
    for (const m of [
      { ...defaultMotion("moveToPose", { x: 30, y: 30, heading: 90 }), timeout: 5000 },
      { ...defaultMotion("moveToPose", { x: 10, y: 40, heading: 0 }), timeout: 5000 },
      { ...defaultMotion("moveToPose", { x: 20, y: -30, heading: 45 }), forwards: false, timeout: 5000 },
      { ...defaultMotion("moveToPoint", { x: 0, y: 40, heading: 0 }), minSpeed: 45, earlyExit: 6, timeout: 4000 },
    ]) {
      const rec = runSingleMotion(c, m as never);
      const f = rec.frames[rec.frames.length - 1];
      const target = "x" in m ? { x: (m as { x: number }).x, y: (m as { y: number }).y } : { x: 0, y: 0 };
      let over = 0;
      const endErr = Math.hypot(f.x - target.x, f.y - target.y);
      // farthest the path strays past the target along the travel direction
      const dir = Math.hypot(target.x, target.y) || 1;
      for (const fr of rec.frames) over = Math.max(over, (fr.x * target.x + fr.y * target.y) / dir - dir);
      t += rec.duration + 1.5 * endErr + ovW * Math.max(0, over) + (rec.steps[0].timedOut ? 3 : 0);
    }
    return t;
  };
  const candLat = { ...base.lateral, kP: r2(bestLat.kP), kD: r2(bestLat.kD) }, candAng = { ...base.angular, kP: r2(bestAng.kP), kD: r2(bestAng.kD) };
  const keep = suite(candLat, candAng) > suite(base.lateral, base.angular) * 1.02;
  if (keep) return { lateral: base.lateral, angular: base.angular, horizontalDrift: base.horizontalDrift, score: { before: before.lat + before.ang, after: before.lat + before.ang }, kept: true };
  return {
    lateral: candLat,
    angular: candAng,
    horizontalDrift: base.horizontalDrift,
    score: { before: before.lat + before.ang, after: bestLat.c + bestAng.c },
  };
}

/**
 * Timeouts sized from how long each step really takes (x1.6 plus 300 ms, at least 500 ms). Steps that already hit their timeout get
 * double, since their measured duration is the timeout itself. Returns a new routine.
 */
export function optimizeTimeouts(routine: import("./routine").Routine, steps: { index: number; start: number; end: number; timedOut?: boolean }[]): import("./routine").Routine {
  return {
    ...routine,
    steps: routine.steps.map((s, i) => {
      const t = steps.find((x) => x.index === i);
      const m = s.motion;
      if (!t || !("timeout" in m)) return s;
      const dur = (t.end - t.start) * 1000;
      const next = Math.max(500, Math.ceil((t.timedOut ? dur * 2 : dur * 1.6 + 300) / 100) * 100);
      return { ...s, motion: { ...m, timeout: next } };
    }),
  };
}
