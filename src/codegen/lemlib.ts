import { derive } from "../core/robot";
import { toLemLibPathFile } from "../core/path";
import type { MotionSpec, Step } from "../core/routine";
import { actionCpp, describeMotion, indent, motorList, num, pathAssetName, pathIndices, splitActions } from "./common";
import type { GenFile, GenInput, GenResult } from "./types";

export const LEMLIB_VERSION = "v0.5.x (stable branch, PROS 4.2.x)";

function wheelConst(d: number): string {
  const table: [number, string][] = [
    [2.125, "lemlib::Omniwheel::NEW_2"],
    [2.75, "lemlib::Omniwheel::NEW_275"],
    [3.25, "lemlib::Omniwheel::NEW_325"],
    [4, "lemlib::Omniwheel::NEW_4"],
    [4.18, "lemlib::Omniwheel::OLD_4"],
  ];
  for (const [v, c] of table) if (Math.abs(d - v) < 1e-6) return c;
  return num(d);
}

function gearName(c: number): string {
  return c === 100 ? "red" : c === 200 ? "green" : "blue";
}

/** `{.a = 1, .b = 2}` with only non-default fields, or "" when all defaults. */
function params(fields: [string, string, boolean][]): string {
  const used = fields.filter(([, , nonDefault]) => nonDefault).map(([k, v]) => `.${k} = ${v}`);
  return used.length ? `{${used.join(", ")}}` : "";
}

function callMotion(m: MotionSpec, pathIdx: number | undefined): string[] {
  const withParams = (head: string, p: string) => (p ? `${head}, ${p});` : `${head});`);
  switch (m.type) {
    case "setPose": return [`chassis.setPose(${num(m.x)}, ${num(m.y)}, ${num(m.heading)});`];
    case "moveToPoint":
      return [withParams(`chassis.moveToPoint(${num(m.x)}, ${num(m.y)}, ${m.timeout}`, params([
        ["forwards", "false", !m.forwards], ["maxSpeed", num(m.maxSpeed), m.maxSpeed !== 127], ["minSpeed", num(m.minSpeed), m.minSpeed !== 0], ["earlyExitRange", num(m.earlyExit), m.earlyExit !== 0],
      ]))];
    case "moveToPose":
      return [withParams(`chassis.moveToPose(${num(m.x)}, ${num(m.y)}, ${num(m.heading)}, ${m.timeout}`, params([
        ["forwards", "false", !m.forwards], ["horizontalDrift", num(m.horizontalDrift), m.horizontalDrift !== 0], ["lead", num(m.lead), m.lead !== 0.6],
        ["maxSpeed", num(m.maxSpeed), m.maxSpeed !== 127], ["minSpeed", num(m.minSpeed), m.minSpeed !== 0], ["earlyExitRange", num(m.earlyExit), m.earlyExit !== 0],
      ]))];
    case "turnToHeading":
      return [withParams(`chassis.turnToHeading(${num(m.heading)}, ${m.timeout}`, params([
        ["direction", m.direction === "cw" ? "lemlib::AngularDirection::CW_CLOCKWISE" : "lemlib::AngularDirection::CCW_COUNTERCLOCKWISE", m.direction !== "auto"],
        ["maxSpeed", num(m.maxSpeed), m.maxSpeed !== 127], ["minSpeed", num(m.minSpeed), m.minSpeed !== 0], ["earlyExitRange", num(m.earlyExit), m.earlyExit !== 0],
      ]))];
    case "turnToPoint":
      return [withParams(`chassis.turnToPoint(${num(m.x)}, ${num(m.y)}, ${m.timeout}`, params([
        ["forwards", "false", !m.forwards], ["maxSpeed", num(m.maxSpeed), m.maxSpeed !== 127], ["minSpeed", num(m.minSpeed), m.minSpeed !== 0], ["earlyExitRange", num(m.earlyExit), m.earlyExit !== 0],
      ]))];
    case "swingToHeading":
      return [withParams(`chassis.swingToHeading(${num(m.heading)}, lemlib::DriveSide::${m.lock === "left" ? "LEFT" : "RIGHT"}, ${m.timeout}`, params([
        ["maxSpeed", num(m.maxSpeed), m.maxSpeed !== 127], ["minSpeed", num(m.minSpeed), m.minSpeed !== 0], ["earlyExitRange", num(m.earlyExit), m.earlyExit !== 0],
      ]))];
    case "follow":
      return [`chassis.follow(${pathAssetName(pathIdx ?? 1)}, ${num(m.lookahead)}, ${m.timeout}, ${m.forwards ? "true" : "false"});`];
    case "wait": return [`pros::delay(${m.ms});`];
  }
}

function stepCode(step: Step, index: number, pathIdx: number | undefined, hasIntake: boolean): string[] {
  const out: string[] = [`// ${index + 1}. ${describeMotion(step.motion)}`];
  const { start, mid, end } = splitActions(step);
  const isMove = step.motion.type !== "setPose" && step.motion.type !== "wait";
  for (const a of start) out.push(...actionCpp(a, hasIntake));
  out.push(...callMotion(step.motion, pathIdx));
  if (isMove) {
    for (const a of mid) {
      const w = a.when;
      if (w.kind === "distance") out.push(`chassis.waitUntil(${num(w.value)}); // ${step.motion.type === "turnToHeading" || step.motion.type === "turnToPoint" || step.motion.type === "swingToHeading" ? "degrees turned" : "inches traveled"}`);
      else if (w.kind === "delay") out.push(`pros::delay(${w.ms});`);
      out.push(...actionCpp(a, hasIntake));
    }
    out.push("chassis.waitUntilDone();");
  } else {
    for (const a of mid) out.push(...actionCpp(a, hasIntake));
  }
  for (const a of end) out.push(...actionCpp(a, hasIntake));
  return out;
}

export function generateLemLib(input: GenInput): GenResult {
  const { routine, cfg, ports } = input;
  const d = derive(cfg);
  const fn = input.fnName ?? "autonomous";
  const hasIntake = ports.intake.length > 0;
  const usesClamp = routine.steps.some((s) => s.actions.some((a) => a.type === "clamp" || a.type === "unclamp"));
  const paths = pathIndices(routine);
  const warnings: string[] = [];
  const notes: string[] = [
    "Install LemLib: `pros c fetch LemLib@0.5.x` then `pros c apply LemLib` (see https://github.com/LemLib/LemLib).",
    "Paths go in the project's `static/` folder. Add `#include \"lemlib/api.hpp\"` to `main.h` if you don't use this main.cpp.",
    "Motor ports, IMU port and tracking-wheel ports come from the Ports panel - check every port and reversal against your robot.",
    "PID gains are derived from the physics model: they are a STARTING POINT. Tune on the real robot (LemLib tutorial 4).",
    "LemLib runs motions asynchronously; each generated step ends with waitUntilDone() so steps run in order.",
  ];

  const L: string[] = [];
  L.push('#include "main.h"');
  L.push('#include "lemlib/api.hpp" // IWYU pragma: keep');
  L.push("");
  L.push("// Generated by SimToEndAllSims - routine: " + routine.name);
  L.push("");
  L.push("pros::Controller controller(pros::E_CONTROLLER_MASTER);");
  L.push("");
  L.push("// drivetrain motors (negative port = reversed)");
  L.push(`pros::MotorGroup left_motors(${motorList(ports.left)}, pros::MotorGears::${gearName(cfg.cartridge)});`);
  L.push(`pros::MotorGroup right_motors(${motorList(ports.right)}, pros::MotorGears::${gearName(cfg.cartridge)});`);
  if (hasIntake) L.push(`pros::MotorGroup intake(${motorList(ports.intake)}, pros::MotorGears::${gearName(ports.intakeCartridge)});`);
  if (usesClamp) L.push(`pros::adi::DigitalOut clamp_piston('${ports.clamp}');`);
  L.push("");
  L.push(`pros::Imu imu(${ports.imu});`);

  // tracking wheels
  const vertical: string[] = [];
  const horizontal: string[] = [];
  cfg.odom.trackingWheels.forEach((tw, i) => {
    const tp = ports.tracking[i] ?? { port: 11 + i };
    const nameBase = `${tw.axis}_${vertical.length + horizontal.length + 1}`;
    if (tp.adi) {
      const rev = tp.reversed ? ", true" : "";
      L.push(`pros::adi::Encoder ${nameBase}_encoder('${tp.adi[0]}', '${tp.adi[1]}'${rev});`);
    } else {
      L.push(`pros::Rotation ${nameBase}_encoder(${tp.reversed ? -Math.abs(tp.port) : tp.port});`);
    }
    L.push(`lemlib::TrackingWheel ${nameBase}_wheel(&${nameBase}_encoder, ${wheelConst(tw.diameter)}, ${num(tw.offset)});`);
    (tw.axis === "vertical" ? vertical : horizontal).push(`&${nameBase}_wheel`);
  });
  L.push("");
  L.push("// drivetrain settings");
  L.push("lemlib::Drivetrain drivetrain(&left_motors, // left motor group");
  L.push("                              &right_motors, // right motor group");
  L.push(`                              ${num(cfg.trackWidth)}, // track width (in)`);
  L.push(`                              ${wheelConst(cfg.wheelDiameter)}, // wheel diameter`);
  L.push(`                              ${num(d.wheelRpm)}, // wheel rpm = ${cfg.cartridge} x ${cfg.drivingTeeth}/${cfg.drivenTeeth}`);
  L.push(`                              ${num(cfg.horizontalDrift)} // horizontal drift`);
  L.push(");");
  L.push("");
  const cs = (g: typeof cfg.lateral) => [
    `${num(g.kP)}, // kP`, `${num(g.kI)}, // kI`, `${num(g.kD)}, // kD`, `${num(g.windupRange)}, // anti windup`,
    `${num(g.smallError)}, // small error range`, `${g.smallErrorTimeout}, // small error timeout (ms)`,
    `${num(g.largeError)}, // large error range`, `${g.largeErrorTimeout}, // large error timeout (ms)`, `${num(g.slew)} // slew`,
  ];
  const block = (name: string, g: typeof cfg.lateral) => {
    const lines = cs(g);
    L.push(`lemlib::ControllerSettings ${name}(${lines[0]}`);
    for (let i = 1; i < lines.length; i++) L.push(`${" ".repeat(`lemlib::ControllerSettings ${name}(`.length)}${lines[i]}`);
    L.push(");");
    L.push("");
  };
  block("lateral_controller", cfg.lateral);
  block("angular_controller", cfg.angular);
  const v1 = vertical[0] ?? "nullptr", v2 = vertical[1] ?? "nullptr", h1 = horizontal[0] ?? "nullptr", h2 = horizontal[1] ?? "nullptr";
  L.push("lemlib::OdomSensors sensors(" + v1 + ", // vertical tracking wheel 1 (nullptr = drive motor encoders)");
  L.push("                            " + v2 + ", // vertical tracking wheel 2");
  L.push("                            " + h1 + ", // horizontal tracking wheel 1");
  L.push("                            " + h2 + ", // horizontal tracking wheel 2");
  L.push(`                            ${cfg.odom.useImu ? "&imu" : "nullptr"} // inertial sensor`);
  L.push(");");
  L.push("");
  L.push("lemlib::Chassis chassis(drivetrain, lateral_controller, angular_controller, sensors);");
  L.push("");
  for (const idx of paths.values()) L.push(`ASSET(${pathAssetName(idx)}); // static/path_${idx}.txt`);
  if (paths.size) L.push("");
  L.push("void initialize() {");
  L.push("    pros::lcd::initialize();");
  L.push("    chassis.calibrate(); // calibrate sensors");
  L.push("    pros::Task screen_task([&]() {");
  L.push("        while (true) {");
  L.push('            pros::lcd::print(0, "X: %f", chassis.getPose().x);');
  L.push('            pros::lcd::print(1, "Y: %f", chassis.getPose().y);');
  L.push('            pros::lcd::print(2, "Theta: %f", chassis.getPose().theta);');
  L.push("            pros::delay(50);");
  L.push("        }");
  L.push("    });");
  L.push("}");
  L.push("");
  L.push("void disabled() {}");
  L.push("void competition_initialize() {}");
  L.push("");
  L.push(`void ${fn}() {`);
  const startStep = routine.steps.length && routine.steps[0].motion.type === "setPose";
  if (!startStep) L.push(...indent([`chassis.setPose(${num(routine.start.x)}, ${num(routine.start.y)}, ${num(routine.start.heading)});`]));
  routine.steps.forEach((s, i) => {
    L.push(...indent(stepCode(s, i, paths.get(s.id), hasIntake)));
  });
  L.push("}");
  L.push("");
  if (fn !== "autonomous") {
    L.push("void autonomous() {");
    L.push(`    ${fn}();`);
    L.push("}");
    L.push("");
  }
  L.push("void opcontrol() {");
  if (usesClamp) L.push("    bool clamp_on = false;");
  L.push("    while (true) {");
  if (ports.controller === "tank") {
    L.push("        chassis.tank(controller.get_analog(ANALOG_LEFT_Y), controller.get_analog(ANALOG_RIGHT_Y));");
  } else {
    L.push("        chassis.arcade(controller.get_analog(ANALOG_LEFT_Y), controller.get_analog(ANALOG_RIGHT_X));");
  }
  if (hasIntake) {
    L.push("        if (controller.get_digital(DIGITAL_R1)) intake.move(127);");
    L.push("        else if (controller.get_digital(DIGITAL_R2)) intake.move(-127);");
    L.push("        else intake.move(0);");
  }
  if (usesClamp) {
    L.push("        if (controller.get_digital_new_press(DIGITAL_L1)) {");
    L.push("            clamp_on = !clamp_on;");
    L.push("            clamp_piston.set_value(clamp_on);");
    L.push("        }");
  }
  L.push("        pros::delay(10);");
  L.push("    }");
  L.push("}");
  L.push("");

  const files: GenFile[] = [{ path: "src/main.cpp", content: L.join("\n") }];
  for (const s of routine.steps) {
    if (s.motion.type === "follow") {
      const idx = paths.get(s.id)!;
      files.push({ path: `static/path_${idx}.txt`, content: toLemLibPathFile(s.motion.path, cfg.trackWidth), note: "LemLib v0.5 path file (path.jerryio-compatible)" });
    }
  }
  if (cfg.odom.trackingWheels.length === 0 && cfg.wheels.every((w) => w.type === "omni")) {
    warnings.push("All-omni drivetrain using only drive-motor encoders for odometry: expect several inches of drift. Add a horizontal tracking wheel (LemLib tutorial 2).");
  }
  if (routine.steps.some((s) => s.motion.type === "moveToPose" || s.motion.type === "follow") && cfg.horizontalDrift === 0) {
    warnings.push("horizontalDrift is 0: LemLib falls back to unlimited cornering speed. Set ~2 (all-omni) to ~8 (center traction).");
  }
  return { target: "lemlib", title: "LemLib (PROS)", version: LEMLIB_VERSION, files, notes, warnings };
}
