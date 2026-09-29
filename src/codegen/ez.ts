import { derive } from "../core/robot";
import { buildPathPoints } from "../core/path";
import type { MotionSpec, Step } from "../core/routine";
import { actionCpp, mechanismStubs, describeMotion, ident, indent, motorList, num, splitActions } from "./common";
import type { GenInput, GenResult } from "./types";

export const EZ_VERSION = "3.2.x (stable; 4.0 is a breaking beta and is not targeted)";

const dir = (forwards: boolean) => (forwards ? "fwd" : "rev");
const IN = (v: number) => `${num(v)}_in`;
const DEG = (v: number) => `${num(v)}_deg`;

/** Waypoints for EZ pure pursuit: roughly every `spacing` inches, always including the last point. */
function pursuitWaypoints(m: Extract<MotionSpec, { type: "follow" }>, trackWidth: number, spacing = 8) {
  const pts = buildPathPoints(m.path, trackWidth);
  const out: { x: number; y: number; speed: number }[] = [];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (acc >= spacing || i === pts.length - 1) {
      out.push({ x: pts[i].x, y: pts[i].y, speed: Math.max(30, Math.round(pts[i].speed || m.path.minSpeed)) });
      acc = 0;
    }
  }
  return out;
}

function stepCode(step: Step, i: number, trackWidth: number, hasIntake: boolean, hasRear: boolean, startPose: { x: number; y: number }): string[] {
  const m = step.motion;
  const out: string[] = [`// ${i + 1}. ${describeMotion(m)}`];
  const { start, mid, end } = splitActions(step);
  for (const a of start) out.push(...actionCpp(a, hasIntake, hasRear));
  const slew = (dist: number) => (dist > 12 ? ", true" : "");
  let set: string[] = [];
  let unit: "in" | "deg" | "index" = "in";
  let indexFor = (_d: number) => 0;
  switch (m.type) {
    case "setPose":
      set = [`chassis.odom_xyt_set(${IN(m.x)}, ${IN(m.y)}, ${DEG(m.heading)});`, `chassis.drive_imu_reset(${num(m.heading)});`];
      break;
    case "moveToPoint":
      set = [`chassis.pid_odom_set({{${IN(m.x)}, ${IN(m.y)}}, ${dir(m.forwards)}, ${num(m.maxSpeed)}}${slew(Math.hypot(m.x - startPose.x, m.y - startPose.y))});`];
      break;
    case "moveToPose":
      set = [`chassis.pid_odom_set({{${IN(m.x)}, ${IN(m.y)}, ${DEG(m.heading)}}, ${dir(m.forwards)}, ${num(m.maxSpeed)}}${slew(Math.hypot(m.x - startPose.x, m.y - startPose.y))});`];
      break;
    case "turnToHeading":
      set = [m.direction === "auto" ? `chassis.pid_turn_set(${DEG(m.heading)}, ${num(m.maxSpeed)});` : `chassis.pid_turn_set(${DEG(m.heading)}, ${num(m.maxSpeed)}, ez::${m.direction === "cw" ? "cw" : "ccw"});`];
      unit = "deg";
      break;
    case "turnToPoint":
      set = [`chassis.pid_turn_set({${IN(m.x)}, ${IN(m.y)}}, ${dir(m.forwards)}, ${num(m.maxSpeed)});`];
      unit = "deg";
      break;
    case "swingToHeading":
      // LemLib/our "lock" = the side that stays put; EZ names the side that MOVES.
      set = [`chassis.pid_swing_set(ez::${m.lock === "left" ? "RIGHT_SWING" : "LEFT_SWING"}, ${DEG(m.heading)}, ${num(m.maxSpeed)});`];
      unit = "deg";
      break;
    case "follow": {
      const wps = pursuitWaypoints(m, trackWidth);
      const lines = wps.map((p, k) => `${k === 0 ? "{" : " "}{{${IN(p.x)}, ${IN(p.y)}}, ${dir(m.forwards)}, ${p.speed}}${k === wps.length - 1 ? "}" : ","}`);
      set = ["chassis.pid_odom_set(" + lines[0], ...lines.slice(1).map((l) => "                     " + l)];
      set[set.length - 1] += ", true);";
      unit = "index";
      const total = wps.reduce((a, p, k) => a + (k ? Math.hypot(p.x - wps[k - 1].x, p.y - wps[k - 1].y) : 0), 0);
      indexFor = (d) => {
        let acc = 0;
        for (let k = 1; k < wps.length; k++) {
          acc += Math.hypot(wps[k].x - wps[k - 1].x, wps[k].y - wps[k - 1].y);
          if (acc >= Math.min(d, total)) return k;
        }
        return wps.length - 1;
      };
      break;
    }
    case "wait":
      set = [`pros::delay(${m.ms});`];
      break;
  }
  out.push(...set);
  if (m.type === "setPose" || m.type === "wait") {
    for (const a of mid) out.push(...actionCpp(a, hasIntake, hasRear));
  } else {
    for (const a of mid) {
      const w = a.when;
      if (w.kind === "distance") {
        if (unit === "index") out.push(`chassis.pid_wait_until_index(${indexFor(w.value)}); // waypoint ~${num(w.value, 1)} in along the path`);
        else out.push(`chassis.pid_wait_until(${unit === "deg" ? DEG(w.value) : IN(w.value)});`);
      } else if (w.kind === "delay") out.push(`pros::delay(${w.ms});`);
      out.push(...actionCpp(a, hasIntake, hasRear));
    }
    out.push("chassis.pid_wait();");
  }
  for (const a of end) out.push(...actionCpp(a, hasIntake, hasRear));
  return out;
}

export function generateEz(input: GenInput): GenResult {
  const { routine, cfg, ports } = input;
  const d = derive(cfg);
  const fn = ident(input.fnName ?? "auton_1");
  const hasIntake = ports.intake.length > 0;
  const hasRear = ports.rearIntake.length > 0;
  const usesClamp = routine.steps.some((s) => s.actions.some((a) => a.type === "clamp" || a.type === "unclamp"));
  const warnings: string[] = [];
  const notes = [
    "Start from the EZ-Template 3.2.x example project (https://ez-robotics.github.io/EZ-Template/) and replace src/main.cpp, src/autons.cpp, include/autons.hpp and include/subsystems.hpp.",
    "Drive and turn PID constants are the physics-tuned LemLib gains (both libraries use power-per-inch/degree with a per-loop derivative). Heading, odom-angular and boomerang constants keep EZ's defaults. Tune with EZ's live PID tuner (press X in opcontrol).",
    "EZ-Template's odometry uses tracking wheels if set, otherwise the drive motors. EZ moves are non-blocking; every step ends with pid_wait().",
  ];

  const trackers: string[] = [];
  const setters: string[] = [];
  cfg.odom.trackingWheels.forEach((tw, i) => {
    const tp = ports.tracking[i] ?? { port: 11 + i };
    const name = `${tw.axis === "vertical" ? "vert" : "horiz"}_tracker_${i + 1}`;
    const port = tp.reversed ? -Math.abs(tp.port) : tp.port;
    if (tp.adi) trackers.push(`ez::tracking_wheel ${name}({'${tp.adi[0]}', '${tp.adi[1]}'}, ${num(tw.diameter)}, ${num(Math.abs(tw.offset))});`);
    else trackers.push(`ez::tracking_wheel ${name}(${port}, ${num(tw.diameter)}, ${num(Math.abs(tw.offset))});`);
    const side = tw.axis === "vertical" ? (tw.offset < 0 ? "left" : "right") : tw.offset < 0 ? "back" : "front";
    setters.push(`chassis.odom_tracker_${side}_set(&${name});`);
  });
  if (cfg.odom.trackingWheels.length === 0 && cfg.wheels.every((w) => w.type === "omni")) {
    warnings.push("All-omni drivetrain with drive-motor odometry drifts several inches; add tracking wheels.");
  }
  if (routine.steps.some((s) => s.motion.type === "moveToPose" && !s.motion.forwards)) {
    warnings.push("EZ boomerang with `rev`: check the final heading on your robot - EZ's theta convention for reversed poses is not documented in the example project.");
  }
  if (routine.steps.some((s) => s.motion.type === "moveToPose" && s.motion.lead !== 0.6)) {
    warnings.push("moveToPose `lead` has no per-move equivalent in EZ-Template; it uses chassis.odom_boomerang_dlead_set() globally (default 0.625).");
  }
  if (routine.steps.some((s) => "minSpeed" in s.motion && (s.motion.minSpeed ?? 0) > 0)) {
    warnings.push("minSpeed/earlyExit chaining: use pid_wait_quick_chain() manually in EZ-Template where you want blended motions.");
  }

  const A: string[] = [];
  A.push('#include "main.h"');
  A.push("");
  A.push("// Generated by SimToEndAllSims - routine: " + routine.name);
  A.push("");
  A.push(...mechanismStubs(routine));
  A.push("void default_constants() {");
  const l = cfg.lateral, a = cfg.angular;
  A.push(`  chassis.pid_drive_constants_set(${num(l.kP)}, ${num(l.kI)}, ${num(l.kD)});         // fwd/rev, also used for odom`);
  A.push("  chassis.pid_heading_constants_set(11.0, 0.0, 20.0);        // holds heading while driving straight (EZ default)");
  A.push(`  chassis.pid_turn_constants_set(${num(a.kP)}, ${num(Math.max(a.kI, 0.05))}, ${num(a.kD)}, 15.0);  // turn in place`);
  A.push(`  chassis.pid_swing_constants_set(${num(a.kP * 2)}, 0.0, ${num(a.kD * 6.5)});           // swing (EZ-scaled from the turn gains)`);
  A.push("  chassis.pid_odom_angular_constants_set(6.5, 0.0, 52.5);    // angular control for odom motions (EZ default)");
  A.push("  chassis.pid_odom_boomerang_constants_set(5.8, 0.0, 32.5);  // boomerang angular control (EZ default)");
  A.push("");
  A.push(`  chassis.pid_turn_exit_condition_set(90_ms, ${num(a.smallError)}_deg, 250_ms, ${num(a.largeError)}_deg, 500_ms, 500_ms);`);
  A.push(`  chassis.pid_swing_exit_condition_set(90_ms, ${num(a.smallError)}_deg, 250_ms, ${num(a.largeError)}_deg, 500_ms, 500_ms);`);
  A.push(`  chassis.pid_drive_exit_condition_set(90_ms, ${num(l.smallError)}_in, 250_ms, ${num(l.largeError)}_in, 500_ms, 500_ms);`);
  A.push(`  chassis.pid_odom_turn_exit_condition_set(90_ms, ${num(a.smallError)}_deg, 250_ms, ${num(a.largeError)}_deg, 500_ms, 750_ms);`);
  A.push(`  chassis.pid_odom_drive_exit_condition_set(90_ms, ${num(l.smallError)}_in, 250_ms, ${num(l.largeError)}_in, 500_ms, 750_ms);`);
  A.push("  chassis.pid_turn_chain_constant_set(3_deg);");
  A.push("  chassis.pid_swing_chain_constant_set(5_deg);");
  A.push("  chassis.pid_drive_chain_constant_set(3_in);");
  A.push("");
  A.push("  chassis.slew_turn_constants_set(3_deg, 70);");
  A.push("  chassis.slew_drive_constants_set(3_in, 70);");
  A.push("  chassis.slew_swing_constants_set(3_in, 80);");
  A.push("");
  A.push("  chassis.odom_turn_bias_set(0.9);");
  A.push("  chassis.odom_look_ahead_set(7_in);");
  A.push("  chassis.odom_boomerang_distance_set(16_in);");
  A.push("  chassis.odom_boomerang_dlead_set(0.625);");
  A.push("");
  A.push("  chassis.pid_angle_behavior_set(ez::shortest);");
  A.push("}");
  A.push("");
  A.push(`void ${fn}() {`);
  const first = routine.steps[0];
  if (!first || first.motion.type !== "setPose") {
    A.push(...indent([`chassis.odom_xyt_set(${IN(routine.start.x)}, ${IN(routine.start.y)}, ${DEG(routine.start.heading)});`, `chassis.drive_imu_reset(${num(routine.start.heading)});`]));
  }
  let cur = { x: routine.start.x, y: routine.start.y };
  routine.steps.forEach((s, i) => {
    A.push(...indent(stepCode(s, i, cfg.trackWidth, hasIntake, hasRear, cur)));
    const m = s.motion;
    if ("x" in m && "y" in m) cur = { x: m.x, y: m.y };
  });
  A.push("}");
  A.push("");

  const M: string[] = [];
  M.push('#include "main.h"');
  M.push("");
  M.push("// Chassis constructor");
  M.push("ez::Drive chassis(");
  M.push(`    ${motorList(ports.left)},  // left chassis ports (negative = reversed)`);
  M.push(`    ${motorList(ports.right)},  // right chassis ports (negative = reversed)`);
  M.push(`    ${ports.imu},  // IMU port`);
  M.push(`    ${num(cfg.wheelDiameter)},  // wheel diameter (actual size)`);
  M.push(`    ${num(d.wheelRpm)});  // wheel RPM = cartridge ${cfg.cartridge} x ${cfg.drivingTeeth}/${cfg.drivenTeeth}`);
  M.push("");
  for (const t of trackers) M.push(t);
  if (trackers.length) M.push("");
  M.push("void initialize() {");
  M.push("  ez::ez_template_print();");
  M.push("  pros::delay(500);");
  M.push("");
  for (const s of setters) M.push(`  ${s}`);
  if (setters.length) M.push("");
  M.push("  chassis.opcontrol_curve_buttons_toggle(true);");
  M.push("  chassis.opcontrol_drive_activebrake_set(0.0);");
  M.push("  chassis.opcontrol_curve_default_set(0.0, 0.0);");
  M.push("");
  M.push("  default_constants();");
  M.push("");
  M.push("  ez::as::auton_selector.autons_add({");
  M.push(`      {"${routine.name.replace(/["\\\n]/g, " ")}\\n\\nGenerated by SimToEndAllSims", ${fn}},`);
  M.push("  });");
  M.push("");
  M.push("  chassis.initialize();");
  M.push("  ez::as::initialize();");
  M.push('  master.rumble(chassis.drive_imu_calibrated() ? "." : "---");');
  M.push("}");
  M.push("");
  M.push("void disabled() {}");
  M.push("void competition_initialize() {}");
  M.push("");
  M.push("void autonomous() {");
  M.push("  chassis.pid_targets_reset();");
  M.push("  chassis.drive_imu_reset();");
  M.push("  chassis.drive_sensor_reset();");
  M.push("  chassis.drive_brake_set(MOTOR_BRAKE_HOLD);");
  M.push("");
  M.push("  ez::as::auton_selector.selected_auton_call();");
  M.push("}");
  M.push("");
  M.push("void opcontrol() {");
  M.push(`  chassis.drive_brake_set(MOTOR_BRAKE_${cfg.brake === "coast" ? "COAST" : cfg.brake === "hold" ? "HOLD" : "BRAKE"});`);
  if (usesClamp) M.push("  bool clamp_on = false;");
  M.push("  while (true) {");
  M.push(ports.controller === "tank" ? "    chassis.opcontrol_tank();" : "    chassis.opcontrol_arcade_standard(ez::SPLIT);");
  if (hasIntake) {
    M.push("    if (master.get_digital(DIGITAL_R1)) intake.move(127);");
    M.push("    else if (master.get_digital(DIGITAL_R2)) intake.move(-127);");
    M.push("    else intake.move(0);");
  }
  if (usesClamp) {
    M.push("    if (master.get_digital_new_press(DIGITAL_L1)) {");
    M.push("      clamp_on = !clamp_on;");
    M.push("      clamp_piston.set_value(clamp_on);");
    M.push("    }");
  }
  M.push("    pros::delay(ez::util::DELAY_TIME);");
  M.push("  }");
  M.push("}");
  M.push("");

  const H = ["#pragma once", "", "void default_constants();", `void ${fn}();`, ""];
  const S = ['#pragma once', "", '#include "EZ-Template/api.hpp"', '#include "api.h"', "", "extern Drive chassis;", ""];
  if (hasRear) S.push(`inline pros::MotorGroup rear_intake(${motorList(ports.rearIntake)}, pros::MotorGears::${ports.intakeCartridge === 100 ? "red" : ports.intakeCartridge === 200 ? "green" : "blue"});`);
  if (hasIntake) S.push(`inline pros::MotorGroup intake(${motorList(ports.intake)}, pros::MotorGears::${ports.intakeCartridge === 100 ? "red" : ports.intakeCartridge === 200 ? "green" : "blue"});`);
  if (usesClamp) S.push(`inline pros::adi::DigitalOut clamp_piston('${ports.clamp}');`);
  S.push("");

  return {
    target: "ez-template",
    title: "EZ-Template (PROS)",
    version: EZ_VERSION,
    files: [
      { path: "src/main.cpp", content: M.join("\n") },
      { path: "src/autons.cpp", content: A.join("\n") },
      { path: "include/autons.hpp", content: H.join("\n") },
      { path: "include/subsystems.hpp", content: S.join("\n") },
    ],
    notes,
    warnings,
  };
}
