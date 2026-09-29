import type { ControllerGains, RobotConfig } from "./robot";
import { runSingleMotion } from "./runtime";
import { defaultMotion } from "./routine";

export interface TuneResult {
  lateral: ControllerGains;
  angular: ControllerGains;
  horizontalDrift: number;
  /** cost of the winning settings (lower is better) and of the input settings, for the UI */
  score: { before: number; after: number };
}

/** LemLib guidance: ~2 for an all-omni "drift" drive, ~8 for center traction wheels. */
export function suggestHorizontalDrift(cfg: RobotConfig): number {
  const n = cfg.wheels.length || 1;
  const traction = cfg.wheels.filter((w) => w.type === "traction").length / n;
  return Math.round((2 + 6 * traction) * 10) / 10;
}

interface Trial { settle: number; err: number; overshoot: number; timedOut: boolean; slipped: boolean }

function lateralTrial(cfg: RobotConfig, dist: number): Trial {
  const rec = runSingleMotion(cfg, { ...defaultMotion("moveToPoint", { x: 0, y: dist, heading: 0 }), timeout: 4000 } as never);
  const f = rec.frames[rec.frames.length - 1];
  let maxY = 0;
  for (const fr of rec.frames) maxY = Math.max(maxY, fr.y);
  const t = rec.steps[0];
  return {
    settle: t.end - t.start,
    err: Math.hypot(f.x, f.y - dist),
    overshoot: Math.max(0, maxY - dist),
    timedOut: t.timedOut,
    slipped: rec.frames.some((fr) => fr.slip),
  };
}

function angularTrial(cfg: RobotConfig, deg: number): Trial {
  const rec = runSingleMotion(cfg, { ...defaultMotion("turnToHeading", { x: 0, y: 0, heading: deg }), timeout: 3000 } as never);
  const f = rec.frames[rec.frames.length - 1];
  let maxH = 0;
  for (const fr of rec.frames) maxH = Math.max(maxH, fr.heading);
  const t = rec.steps[0];
  return {
    settle: t.end - t.start,
    err: Math.abs(f.heading - deg),
    overshoot: Math.max(0, maxH - deg),
    timedOut: t.timedOut,
    slipped: rec.frames.some((fr) => fr.slip),
  };
}

function cost(trials: Trial[], errWeight: number, overshootWeight: number): number {
  let c = 0;
  for (const t of trials) c += t.settle + errWeight * t.err + overshootWeight * t.overshoot + (t.timedOut ? 3 : 0);
  return c / trials.length;
}

/**
 * Search PID gains against the physics model + LemLib controller port. The result is a STARTING POINT:
 * the real robot differs (battery, wear, floor, exact mass distribution) and needs on-robot tuning.
 */
export function autoTune(cfg: RobotConfig, onProgress?: (p: number) => void): TuneResult {
  const base: RobotConfig = { ...cfg, horizontalDrift: suggestHorizontalDrift(cfg) };
  const evalLateral = (kP: number, kD: number) => {
    const c = { ...base, lateral: { ...base.lateral, kP, kD } };
    return cost([lateralTrial(c, 24), lateralTrial(c, 48)], 1.0, 0.6);
  };
  const evalAngular = (kP: number, kD: number) => {
    const c = { ...base, angular: { ...base.angular, kP, kD } };
    return cost([angularTrial(c, 90), angularTrial(c, 180)], 0.15, 0.05);
  };

  const before = { lateral: evalLateral(cfg.lateral.kP, cfg.lateral.kD), angular: evalAngular(cfg.angular.kP, cfg.angular.kD) };

  let progress = 0;
  const total = 36 + 36;
  const tick = () => onProgress?.(++progress / total);

  const latP = [4, 6, 8, 10, 14, 20];
  const latD = [0, 2, 3, 5, 8, 12];
  let bestLat = { kP: cfg.lateral.kP, kD: cfg.lateral.kD, c: Infinity };
  for (const kP of latP) for (const kD of latD) { const c = evalLateral(kP, kD); tick(); if (c < bestLat.c) bestLat = { kP, kD, c }; }

  const angP = [1, 1.5, 2, 3, 4, 6];
  const angD = [4, 8, 10, 14, 20, 30];
  let bestAng = { kP: cfg.angular.kP, kD: cfg.angular.kD, c: Infinity };
  for (const kP of angP) for (const kD of angD) { const c = evalAngular(kP, kD); tick(); if (c < bestAng.c) bestAng = { kP, kD, c }; }

  return {
    lateral: { ...base.lateral, kP: bestLat.kP, kD: bestLat.kD },
    angular: { ...base.angular, kP: bestAng.kP, kD: bestAng.kD },
    horizontalDrift: base.horizontalDrift,
    score: { before: before.lateral + before.angular, after: bestLat.c + bestAng.c },
  };
}
