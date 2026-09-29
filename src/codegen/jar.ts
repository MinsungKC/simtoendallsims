import { derive } from "../core/robot";
import { buildPathPoints } from "../core/path";
import type { ActionSpec, MotionSpec, Step } from "../core/routine";
import type { Recording } from "../core/runtime";
import { bearing, describeMotion, ident, indent, num, planPoses, splitActions, speedToVolts, type Planned } from "./common";
import type { GenInput, GenResult } from "./types";

export const JAR_VERSION = "JAR-Template v1.2.x (VEXcode, github.com/JacksonAreaRobotics/JAR-Template)";

const PORT = (n: number) => `PORT${Math.abs(n)}`;
const K = 12 / 127; // LemLib/PROS power units -> volts

function vexRatio(c: number): string {
  return c === 100 ? "ratio36_1" : c === 200 ? "ratio18_1" : "ratio6_1";
}

function actionVex(a: ActionSpec, hasIntake: boolean): string[] {
  const i = (s: string) => (hasIntake ? [s] : [`// ${s.replace(/;$/, "")}  (no intake configured)`]);
  switch (a.type) {
    case "intakeIn": return i("intake.spin(fwd, 12, volt);");
    case "intakeOut": return i("intake.spin(reverse, 12, volt);");
    case "intakeStop": return i("intake.stop();");
    case "eject": return hasIntake ? ["intake.spin(reverse, 12, volt);", "wait(250, msec);", "intake.stop();"] : ["// eject (no intake configured)"];
    case "clamp": return ["clamp_piston.open();"];
    case "unclamp": return ["clamp_piston.close();"];
    case "custom": return (a.code ?? "// custom action").split("\n");
  }
}

function triggerDelayMs(a: ActionSpec, stepIndex: number, rec: Recording | undefined): { ms: number; estimated: boolean } {
  if (a.when.kind === "delay") return { ms: a.when.ms, estimated: false };
  const hit = rec?.triggers.find((t) => t.step === stepIndex && t.actionId === a.id);
  return { ms: Math.round(hit?.offsetMs ?? 0), estimated: true };
}

export function generateJar(input: GenInput): GenResult {
  const { routine, cfg, ports, recording } = input;
  const d = derive(cfg);
  const fn = ident(input.fnName ?? "auton_1");
  const hasIntake = ports.intake.length > 0;
  const usesClamp = routine.steps.some((s) => s.actions.some((a) => a.type === "clamp" || a.type === "unclamp"));
  const warnings: string[] = [];
  const notes = [
    "Start from the JAR-Template project (VEXcode). Replace src/main.cpp, src/autons.cpp, src/robot-config.cpp, include/autons.h and include/robot-config.h with the generated files (keep the JAR-Template/ folders).",
    "JAR-Template motions are blocking. Mechanism actions that must happen DURING a move are generated as vex::threads that wait the time the simulator reached that point - re-time them on the real robot.",
    "PID gains are the physics-tuned LemLib gains converted to volts (x12/127). They are a STARTING POINT - tune on the robot.",
    "This target cannot be compile-checked here (needs the VEXcode SDK); it was written against the JAR-Template headers.",
  ];

  // ---- tracking setup
  const vt = cfg.odom.trackingWheels.map((w, i) => ({ w, p: ports.tracking[i] ?? { port: 11 + i }, i })).filter((x) => x.w.axis === "vertical");
  const hz = cfg.odom.trackingWheels.map((w, i) => ({ w, p: ports.tracking[i] ?? { port: 11 + i }, i })).filter((x) => x.w.axis === "horizontal");
  const fwd = vt[0], side = hz[0];
  const adi = (x: { p: { adi?: [string, string] } } | undefined) => !!x?.p.adi;
  let setup = "ZERO_TRACKER_ODOM";
  if (fwd && !side) setup = adi(fwd) ? "TANK_ONE_FORWARD_ENCODER" : "TANK_ONE_FORWARD_ROTATION";
  else if (!fwd && side) setup = adi(side) ? "TANK_ONE_SIDEWAYS_ENCODER" : "TANK_ONE_SIDEWAYS_ROTATION";
  else if (fwd && side) setup = adi(fwd) && adi(side) ? "TANK_TWO_ENCODER" : "TANK_TWO_ROTATION";
  if (vt.length > 1 || hz.length > 1) warnings.push("JAR-Template supports at most one forward and one sideways tracker; extra tracking wheels are ignored.");
  const trackerPort = (x: typeof fwd | undefined, enc: boolean) => {
    if (!x) return enc ? "1" : "PORT1";
    if (x.p.adi) return String(x.p.adi[0].toUpperCase().charCodeAt(0) - 64);
    return PORT(x.p.port);
  };
  const fwdDia = fwd ? (fwd.p.reversed ? -fwd.w.diameter : fwd.w.diameter) : 2.75;
  const fwdCenter = fwd ? fwd.w.offset : cfg.trackWidth / 2; // + = right side of robot
  const sideDia = side ? (side.p.reversed ? -side.w.diameter : side.w.diameter) : 2.75;
  const sideCenter = side ? -side.w.offset : 0; // JAR: + = behind center; ours: + = front
  const isEnc = (x: typeof fwd | undefined) => adi(x);

  // ---- robot-config
  const lNames = ports.left.map((_, i) => `L${i + 1}`);
  const rNames = ports.right.map((_, i) => `R${i + 1}`);
  const RC: string[] = ["#include \"vex.h\"", "", "using namespace vex;", "", "// A global instance of brain used for printing to the V5 Brain screen.", "brain Brain;", ""];
  const RH: string[] = ["using namespace vex;", "", "extern brain Brain;", ""];
  ports.left.forEach((p, i) => { RC.push(`motor ${lNames[i]} = motor(${PORT(p)}, ${vexRatio(cfg.cartridge)}, ${p < 0 ? "true" : "false"});`); RH.push(`extern motor ${lNames[i]};`); });
  ports.right.forEach((p, i) => { RC.push(`motor ${rNames[i]} = motor(${PORT(p)}, ${vexRatio(cfg.cartridge)}, ${p < 0 ? "true" : "false"});`); RH.push(`extern motor ${rNames[i]};`); });
  if (hasIntake) {
    const names = ports.intake.map((_, i) => `I${i + 1}`);
    ports.intake.forEach((p, i) => { RC.push(`motor ${names[i]} = motor(${PORT(p)}, ${vexRatio(ports.intakeCartridge)}, ${p < 0 ? "true" : "false"});`); RH.push(`extern motor ${names[i]};`); });
    RC.push(`motor_group intake = motor_group(${names.join(", ")});`);
    RH.push("extern motor_group intake;");
  }
  if (usesClamp) { RC.push(`pneumatics clamp_piston = pneumatics(Brain.ThreeWirePort.${ports.clamp.toUpperCase()});`); RH.push("extern pneumatics clamp_piston;"); }
  RC.push("controller Controller1 = controller(primary);", "", "void vexcodeInit(void) {", "  // nothing to initialize", "}", "");
  RH.push("extern controller Controller1;", "", "void vexcodeInit(void);", "");

  // ---- autons.cpp
  const usesOdom = routine.steps.some((s) => ["moveToPoint", "moveToPose", "turnToPoint", "follow"].includes(s.motion.type));
  const { before } = planPoses(routine, cfg);
  const l = cfg.lateral, a = cfg.angular;
  const A: string[] = ['#include "vex.h"', "", "// Generated by SimToEndAllSims - routine: " + routine.name, ""];
  A.push("void default_constants() {");
  A.push("  // (maxVoltage, kP, kI, kD, startI) - gains are LemLib-tuned values x 12/127");
  A.push(`  chassis.set_drive_constants(10, ${num(l.kP * K)}, ${num(l.kI * K)}, ${num(l.kD * K)}, 0);`);
  A.push("  chassis.set_heading_constants(6, .4, 0, 1, 0);");
  A.push(`  chassis.set_turn_constants(12, ${num(a.kP * K)}, ${num(Math.max(a.kI, 0.02) * K)}, ${num(a.kD * K)}, 15);`);
  A.push(`  chassis.set_swing_constants(12, ${num(a.kP * K)}, ${num(Math.max(a.kI, 0.02) * K)}, ${num(a.kD * K)}, 15);`);
  A.push("");
  A.push("  // (settle_error, settle_time, timeout)");
  A.push(`  chassis.set_drive_exit_conditions(${num(l.largeError / 2)}, ${l.smallErrorTimeout * 3}, 5000);`);
  A.push(`  chassis.set_turn_exit_conditions(${num(a.smallError)}, ${a.smallErrorTimeout * 3}, 3000);`);
  A.push(`  chassis.set_swing_exit_conditions(${num(a.smallError)}, ${a.smallErrorTimeout * 3}, 3000);`);
  A.push("}");
  A.push("");
  A.push("void odom_constants() {");
  A.push("  default_constants();");
  A.push("  chassis.heading_max_voltage = 10;");
  A.push("  chassis.drive_max_voltage = 8;");
  A.push(`  chassis.drive_settle_error = ${num(l.largeError)};`);
  A.push(`  chassis.boomerang_lead = ${num(Math.min(0.9, routine.steps.reduce((v, s) => (s.motion.type === "moveToPose" ? s.motion.lead : v), 0.5)))};`);
  A.push("  chassis.drive_min_voltage = 0;");
  A.push("}");
  A.push("");

  // action threads
  const threadFns: string[] = [];
  const stepBody = (step: Step, i: number, pre: Planned): string[] => {
    const m = step.motion;
    const out: string[] = [`// ${i + 1}. ${describeMotion(m)}`];
    const { start, mid, end } = splitActions(step);
    for (const x of start) out.push(...actionVex(x, hasIntake));
    if (mid.length && m.type !== "setPose" && m.type !== "wait") {
      const fnName = `${fn}_step${i + 1}_actions`;
      const body: string[] = [];
      let elapsed = 0;
      for (const x of mid) {
        const t = triggerDelayMs(x, i, recording);
        const wait = Math.max(0, t.ms - elapsed);
        elapsed = Math.max(elapsed, t.ms);
        body.push(`wait(${wait}, msec); // ${x.when.kind === "distance" ? `~when the simulated robot had traveled ${num((x.when as { value: number }).value, 1)} (re-time on robot)` : "delay"}`);
        body.push(...actionVex(x, hasIntake));
      }
      threadFns.push(`void ${fnName}() {`, ...indent(body, 2), "}", "");
      out.push(`thread ${fnName}_thread(${fnName});`);
    } else for (const x of mid) out.push(...actionVex(x, hasIntake));

    const maxV = speedToVolts(m && "maxSpeed" in m ? m.maxSpeed : 127);
    const minV = speedToVolts(m && "minSpeed" in m ? m.minSpeed : 0);
    const hV = Math.min(maxV, 10);
    switch (m.type) {
      case "setPose": out.push(`chassis.set_coordinates(${num(m.x)}, ${num(m.y)}, ${num(m.heading)});`); break;
      case "wait": out.push(`wait(${m.ms}, msec);`); break;
      case "moveToPoint":
        if (m.forwards) out.push(`chassis.drive_to_point(${num(m.x)}, ${num(m.y)}, ${num(minV)}, ${num(maxV)}, ${num(hV)}, ${num(l.largeError)}, ${l.smallErrorTimeout * 3}, ${m.timeout});`);
        else {
          const dist = Math.hypot(m.x - pre.x, m.y - pre.y);
          out.push(`chassis.turn_to_point(${num(m.x)}, ${num(m.y)}, 180); // back of the robot faces the point`);
          out.push(`chassis.drive_distance(${num(-dist)}, ${num(bearing(pre, m) + 180)}, ${num(maxV)}, ${num(hV)}, ${num(l.largeError / 2)}, ${l.smallErrorTimeout * 3}, ${m.timeout});`);
        }
        break;
      case "moveToPose":
        if (!m.forwards) warnings.push(`Step ${i + 1}: JAR-Template's drive_to_pose cannot drive in reverse; generated as a forward move - use LemLib for reversed boomerang moves.`);
        out.push(`chassis.drive_to_pose(${num(m.x)}, ${num(m.y)}, ${num(m.heading)}, ${num(m.lead)}, 2, ${num(minV)}, ${num(maxV)}, ${num(hV)}, ${num(l.largeError)}, ${l.smallErrorTimeout * 3}, ${m.timeout});`);
        break;
      case "turnToHeading":
        if (m.direction !== "auto") warnings.push(`Step ${i + 1}: JAR-Template turns the shortest way; forced ${m.direction.toUpperCase()} direction is not supported.`);
        out.push(`chassis.turn_to_angle(${num(m.heading)}, ${num(maxV)}, ${num(a.smallError)}, ${a.smallErrorTimeout * 3}, ${m.timeout});`);
        break;
      case "turnToPoint":
        out.push(`chassis.turn_to_point(${num(m.x)}, ${num(m.y)}, ${m.forwards ? 0 : 180}, ${num(maxV)}, ${num(a.smallError)}, ${a.smallErrorTimeout * 3}, ${m.timeout});`);
        break;
      case "swingToHeading":
        // JAR names the side that MOVES; our `lock` is the side that stays put.
        out.push(`chassis.${m.lock === "left" ? "right" : "left"}_swing_to_angle(${num(m.heading)}, ${num(maxV)}, ${num(a.smallError)}, ${a.smallErrorTimeout * 3}, ${m.timeout}, ${num(a.kP * K)}, ${num(Math.max(a.kI, 0.02) * K)}, ${num(a.kD * K)}, 15);`);
        break;
      case "follow": {
        if (!m.forwards) warnings.push(`Step ${i + 1}: reversed path following is not supported by JAR-Template; generated forward.`);
        const pts = buildPathPoints(m.path, cfg.trackWidth);
        const way: typeof pts = [];
        let acc = 0;
        for (let k = 1; k < pts.length; k++) {
          acc += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
          if (acc >= 10 || k === pts.length - 1) { way.push(pts[k]); acc = 0; }
        }
        warnings.push(`Step ${i + 1}: JAR-Template has no pure pursuit; the path is approximated by ${way.length} chained drive_to_point moves.`);
        way.forEach((p, k) => {
          const last = k === way.length - 1;
          out.push(`chassis.drive_to_point(${num(p.x)}, ${num(p.y)}, ${last ? 0 : num(speedToVolts(Math.max(30, p.speed)) * 0.6)}, ${num(speedToVolts(Math.max(30, p.speed)))}, ${num(hV)}${last ? `, ${num(l.largeError)}, ${l.smallErrorTimeout * 3}, ${m.timeout}` : `, ${num(l.largeError * 2)}, 0, ${m.timeout}`});`);
        });
        break;
      }
    }
    for (const x of end) out.push(...actionVex(x, hasIntake));
    return out;
  };

  const bodyLines: string[] = [];
  routine.steps.forEach((s, i) => bodyLines.push(...indent(stepBody(s, i, before[i]), 2)));
  A.push(...threadFns);
  A.push(`void ${fn}() {`);
  A.push(usesOdom ? "  odom_constants();" : "  default_constants();");
  if (!routine.steps.length || routine.steps[0].motion.type !== "setPose") A.push(`  chassis.set_coordinates(${num(routine.start.x)}, ${num(routine.start.y)}, ${num(routine.start.heading)});`);
  A.push(...bodyLines);
  A.push("}");
  A.push("");
  const AH = ["#pragma once", "#include \"JAR-Template/drive.h\"", "", "class Drive;", "", "extern Drive chassis;", "", "void default_constants();", "void odom_constants();", `void ${fn}();`, ""];

  // ---- main.cpp
  const M: string[] = ['#include "vex.h"', "", "using namespace vex;", "competition Competition;", ""];
  M.push("Drive chassis(");
  M.push(`    ${setup},`);
  M.push(`    motor_group(${lNames.join(", ")}),  // left motors`);
  M.push(`    motor_group(${rNames.join(", ")}),  // right motors`);
  M.push(`    ${PORT(ports.imu)},  // inertial sensor`);
  M.push(`    ${num(cfg.wheelDiameter)},  // wheel diameter (actual size)`);
  M.push(`    ${num(d.ratio)},  // external ratio = driving teeth / driven teeth (${cfg.drivingTeeth}/${cfg.drivenTeeth})`);
  M.push("    360,  // gyro scale");
  M.push("    PORT1, -PORT2, PORT3, -PORT4,  // holonomic drives only (unused for tank)");
  M.push(`    ${trackerPort(fwd, isEnc(fwd))},  // forward tracker port`);
  M.push(`    ${num(fwdDia)},  // forward tracker diameter`);
  M.push(`    ${num(fwdCenter)},  // forward tracker center distance (+ = right of center)`);
  M.push(`    ${trackerPort(side, isEnc(side))},  // sideways tracker port`);
  M.push(`    ${num(sideDia)},  // sideways tracker diameter`);
  M.push(`    ${num(sideCenter)}  // sideways tracker center distance (+ = behind center)`);
  M.push(");");
  M.push("");
  M.push("void pre_auton() {");
  M.push("  vexcodeInit();");
  M.push("  default_constants();");
  M.push("  Brain.Screen.clearScreen();");
  M.push(`  Brain.Screen.printAt(5, 20, "${routine.name.replace(/["\\\n]/g, " ")}");`);
  M.push("}");
  M.push("");
  M.push("void autonomous(void) {");
  M.push(`  ${fn}();`);
  M.push("}");
  M.push("");
  M.push("void usercontrol(void) {");
  M.push("  while (1) {");
  M.push(ports.controller === "tank" ? "    chassis.control_tank();" : "    chassis.control_arcade();");
  if (hasIntake) {
    M.push("    if (Controller1.ButtonR1.pressing()) intake.spin(fwd, 12, volt);");
    M.push("    else if (Controller1.ButtonR2.pressing()) intake.spin(reverse, 12, volt);");
    M.push("    else intake.stop();");
  }
  if (usesClamp) {
    M.push("    if (Controller1.ButtonL1.pressing()) clamp_piston.open();");
    M.push("    else if (Controller1.ButtonL2.pressing()) clamp_piston.close();");
  }
  M.push("    wait(20, msec);");
  M.push("  }");
  M.push("}");
  M.push("");
  M.push("int main() {");
  M.push("  Competition.autonomous(autonomous);");
  M.push("  Competition.drivercontrol(usercontrol);");
  M.push("  pre_auton();");
  M.push("  while (true) {");
  M.push("    wait(100, msec);");
  M.push("  }");
  M.push("}");
  M.push("");

  if (cfg.odom.trackingWheels.length === 0 && cfg.wheels.every((w) => w.type === "omni")) warnings.push("All-omni drivetrain with drive-motor odometry drifts several inches; add tracking wheels.");
  return {
    target: "jar-template",
    title: "JAR-Template (VEXcode)",
    version: JAR_VERSION,
    files: [
      { path: "src/main.cpp", content: M.join("\n") },
      { path: "src/autons.cpp", content: A.join("\n") },
      { path: "include/autons.h", content: AH.join("\n") },
      { path: "src/robot-config.cpp", content: RC.join("\n") },
      { path: "include/robot-config.h", content: RH.join("\n") },
    ],
    notes,
    warnings,
  };
}

export type { MotionSpec };
