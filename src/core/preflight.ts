import { corners } from "./geometry";
import { motorBudget } from "./motors";
import type { RobotConfig } from "./robot";
import type { Routine } from "./routine";
import { samplePath } from "./path";
import type { Obstacle } from "./world";
import type { GameModule } from "../games/types";

export interface Preflight { level: "error" | "warn"; text: string; step?: number }

/** Static checks that don't need a simulation: legality, geometry, and things that will obviously go wrong. */
export function preflight(routine: Routine, cfg: RobotConfig, game: GameModule, obstacles: Obstacle[] = game.obstacles, objects: { x: number; y: number; r: number; kind: string }[] = game.objects): Preflight[] {
  const out: Preflight[] = [];
  const half = game.fieldSize.value / 2;
  const b = motorBudget({ count: cfg.motorsPerSide * 2, watts: cfg.motorWatts }, cfg.otherMotorsW, game.robotRules);
  for (const p of b.problems) out.push({ level: "error", text: `${p}${game.robotRules.verified ? "" : " (cap UNVERIFIED - check the manual)"}` });

  const size = game.startingSize;
  if (size && (cfg.length > size.value || cfg.width > size.value)) out.push({ level: "error", text: `Robot ${cfg.length}"x${cfg.width}" exceeds the ${size.value}" starting size${size.verified ? "" : " (UNVERIFIED)"}` });
  for (const w of cfg.wheels) if (Math.abs(w.x) > cfg.length / 2) out.push({ level: "warn", text: `A wheel at ${w.x}" is outside the ${cfg.length}" body` });
  if (cfg.trackWidth > cfg.width) out.push({ level: "warn", text: `Track width ${cfg.trackWidth}" is wider than the robot (${cfg.width}")` });

  const start = { x: routine.start.x, y: routine.start.y, heading: routine.start.heading, hl: cfg.length / 2, hw: cfg.width / 2 };
  for (const c of corners(start)) {
    if (Math.abs(c.x) > half + 1e-6 || Math.abs(c.y) > half + 1e-6) { out.push({ level: "error", text: "Start pose puts part of the robot outside the field" }); break; }
  }
  for (const o of obstacles) {
    if (Math.abs(routine.start.x - o.x) < o.w / 2 + cfg.width / 2 && Math.abs(routine.start.y - o.y) < o.h / 2 + cfg.length / 2) { out.push({ level: "warn", text: `Start pose may overlap ${o.label}` }); break; }
  }
  for (const o of objects) {
    if (Math.hypot(o.x - routine.start.x, o.y - routine.start.y) < Math.max(cfg.length, cfg.width) / 2 + o.r - 1) { out.push({ level: "warn", text: `Start pose overlaps a ${o.kind}` }); break; }
  }

  routine.steps.forEach((s, i) => {
    const m = s.motion;
    if ("x" in m && "y" in m && (Math.abs(m.x) > half || Math.abs(m.y) > half)) out.push({ level: "error", text: `Target (${m.x}, ${m.y}) is outside the field`, step: i });
    if (m.type === "follow") {
      if (samplePath(m.path).some((p) => Math.abs(p.x) > half || Math.abs(p.y) > half)) out.push({ level: "warn", text: "Path leaves the field", step: i });
      if (m.lookahead < 4) out.push({ level: "warn", text: "Lookahead under 4 in is jittery on real robots", step: i });
    }
    if ("minSpeed" in m && m.minSpeed > 0 && m.earlyExit === 0) out.push({ level: "warn", text: "minSpeed > 0 with no earlyExit range: the motion can only end by timeout", step: i });
    if ("timeout" in m && m.timeout < 300) out.push({ level: "warn", text: "Very short timeout", step: i });
    const hasIntakeAction = s.actions.some((a) => ["intakeIn", "intakeOut", "intakeStop", "eject"].includes(a.type));
    if (hasIntakeAction && !cfg.intake) out.push({ level: "warn", text: "Step uses the intake but the robot has none configured", step: i });
  });
  const firstMotion = routine.steps.findIndex((s) => s.motion.type !== "setPose" && s.motion.type !== "wait");
  if (firstMotion >= 0 && routine.steps.slice(0, firstMotion).every((s) => s.motion.type !== "setPose")) {
    // LemLib requires setPose before moving; generated code does this automatically, so this is informational
  }
  return out;
}
