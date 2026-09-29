import { derive } from "../core/robot";
import { buildPathPoints } from "../core/path";
import type { ActionSpec, MotionSpec, Step } from "../core/routine";
import type { Recording } from "../core/runtime";
import { actionCpp, describeMotion, ident, indent, motorList, num, pathIndices, splitActions } from "./common";
import { GENERIC_RUNTIME } from "./genericRuntime";
import type { GenInput, GenResult } from "./types";

export const GENERIC_VERSION = "PROS 4.2.x, no external libraries";

function gearName(c: number): string {
  return c === 100 ? "red" : c === 200 ? "green" : "blue";
}

const gains = (g: { kP: number; kI: number; kD: number; windupRange: number; smallError: number; smallErrorTimeout: number; largeError: number; largeErrorTimeout: number; slew: number }) =>
  `{${num(g.kP)}, ${num(g.kI)}, ${num(g.kD)}, ${num(g.windupRange)}, ${num(g.smallError)}, ${g.smallErrorTimeout}, ${num(g.largeError)}, ${g.largeErrorTimeout}, ${num(g.slew)}}`;

function opts(fields: [string, string, boolean][]): string {
  const used = fields.filter((f) => f[2]).map(([k, v]) => `.${k} = ${v}`);
  return used.length ? `, {${used.join(", ")}}` : "";
}

function delayFor(a: ActionSpec, stepIndex: number, rec: Recording | undefined): number {
  if (a.when.kind === "delay") return a.when.ms;
  return Math.round(rec?.triggers.find((t) => t.step === stepIndex && t.actionId === a.id)?.offsetMs ?? 0);
}

export function generateGeneric(input: GenInput): GenResult {
  const { routine, cfg, ports, recording } = input;
  const d = derive(cfg);
  const fn = ident(input.fnName ?? "run_auton");
  const hasIntake = ports.intake.length > 0;
  const usesClamp = routine.steps.some((s) => s.actions.some((a) => a.type === "clamp" || a.type === "unclamp"));
  const paths = pathIndices(routine);
  const warnings: string[] = [];
  const notes = [
    "Drop src/main.cpp into a fresh PROS 4 project (`pros conduct new-project <dir> v5`). No other libraries are needed.",
    "The motion code is a C++ port of the same control laws the simulator runs (PID + exit conditions + slew, boomerang, pure pursuit). Gains are physics-derived starting points - tune on the robot.",
    "Motions are blocking. Mechanism actions that must happen DURING a move run in a pros::Task that waits the time the simulator reached that point - re-time them on the real robot.",
    "Verify tracking-wheel directions with the brain readout: pushing the robot forward must increase Y, pushing it right must increase X. Reverse a sensor port (negative) if not.",
  ];

  const vt = cfg.odom.trackingWheels.map((w, i) => ({ w, p: ports.tracking[i] ?? { port: 11 + i } })).filter((x) => x.w.axis === "vertical");
  const hz = cfg.odom.trackingWheels.map((w, i) => ({ w, p: ports.tracking[i] ?? { port: 11 + i } })).filter((x) => x.w.axis === "horizontal");
  if (vt.length > 1 || hz.length > 1) warnings.push("The generic target supports one vertical and one horizontal tracking wheel; extras are ignored.");
  if (!cfg.odom.useImu) warnings.push("The generic target always uses the IMU for heading.");
  const tracker = (axis: "vertical" | "horizontal", x: (typeof vt)[number] | undefined): string[] => {
    const up = axis.toUpperCase();
    if (!x) return [`constexpr bool HAS_${up} = false;`, `constexpr double ${up}_OFFSET = 0;`, `inline double read_${axis}() { return 0; }`];
    const dia = num(x.w.diameter);
    const out = [`constexpr bool HAS_${up} = true;`, `constexpr double ${up}_OFFSET = ${num(x.w.offset)};`];
    if (x.p.adi) {
      out.push(`static pros::adi::Encoder ${axis}_sensor('${x.p.adi[0]}', '${x.p.adi[1]}'${x.p.reversed ? ", true" : ""});`);
      out.push(`inline double read_${axis}() { return ${axis}_sensor.get_value() * (${dia} * M_PI / 360); }`);
    } else {
      out.push(`static pros::Rotation ${axis}_sensor(${x.p.reversed ? -Math.abs(x.p.port) : x.p.port});`);
      out.push(`inline double read_${axis}() { return ${axis}_sensor.get_position() * 0.01 * (${dia} * M_PI / 360); }`);
    }
    return out;
  };
  const sensors = [
    `constexpr double WHEEL_DIAMETER = ${num(cfg.wheelDiameter)}; // in (actual size)`,
    `constexpr double TRACK_WIDTH = ${num(cfg.trackWidth)}; // in`,
    `constexpr double GEAR_RATIO = ${num(d.ratio, 6)}; // wheel turns per motor turn = ${cfg.drivingTeeth}/${cfg.drivenTeeth}`,
    `constexpr double HORIZONTAL_DRIFT = ${num(cfg.horizontalDrift)};`,
    `constexpr pros::motor_brake_mode_e_t BRAKE_MODE = pros::E_MOTOR_BRAKE_${cfg.brake === "coast" ? "COAST" : cfg.brake === "hold" ? "HOLD" : "BRAKE"};`,
    ...tracker("vertical", vt[0]),
    ...tracker("horizontal", hz[0]),
    `inline void reset_trackers() {${vt[0] ? (vt[0].p.adi ? " vertical_sensor.reset();" : " vertical_sensor.reset_position();") : ""}${hz[0] ? (hz[0].p.adi ? " horizontal_sensor.reset();" : " horizontal_sensor.reset_position();") : ""} }`,
  ].join("\n");
  const runtime = GENERIC_RUNTIME.replace("__LATERAL__", gains(cfg.lateral)).replace("__ANGULAR__", gains(cfg.angular)).replace("__SENSORS__", sensors).replace("__HEADING__", "heading += dImu;");

  const L: string[] = [];
  L.push('#include "main.h"');
  L.push("#include <algorithm>");
  L.push("#include <cmath>");
  L.push("#include <vector>");
  L.push("");
  L.push("// Generated by SimToEndAllSims (generic PROS target) - routine: " + routine.name);
  L.push("");
  L.push("pros::Controller controller(pros::E_CONTROLLER_MASTER);");
  L.push(`pros::MotorGroup left_motors(${motorList(ports.left)}, pros::MotorGears::${gearName(cfg.cartridge)});`);
  L.push(`pros::MotorGroup right_motors(${motorList(ports.right)}, pros::MotorGears::${gearName(cfg.cartridge)});`);
  if (hasIntake) L.push(`pros::MotorGroup intake(${motorList(ports.intake)}, pros::MotorGears::${gearName(ports.intakeCartridge)});`);
  if (usesClamp) L.push(`pros::adi::DigitalOut clamp_piston('${ports.clamp}');`);
  L.push(`pros::Imu imu(${ports.imu});`);
  L.push(runtime);

  // path data
  for (const s of routine.steps) {
    if (s.motion.type !== "follow") continue;
    const idx = paths.get(s.id)!;
    const pts = buildPathPoints(s.motion.path, cfg.trackWidth);
    L.push(`static const gen::PathPt path_${idx}[] = {`);
    for (let i = 0; i < pts.length; i += 1) L.push(`    {${num(pts[i].x)}, ${num(pts[i].y)}, ${num(pts[i].speed, 1)}},`);
    L.push("};");
    L.push("");
  }

  const taskFns: string[] = [];
  const stepCode = (step: Step, i: number): string[] => {
    const m: MotionSpec = step.motion;
    const out = [`// ${i + 1}. ${describeMotion(m)}`];
    const { start, mid, end } = splitActions(step);
    for (const a of start) out.push(...actionCpp(a, hasIntake));
    if (mid.length && m.type !== "setPose" && m.type !== "wait") {
      const body: string[] = [];
      let elapsed = 0;
      for (const a of mid) {
        const t = delayFor(a, i, recording);
        body.push(`pros::delay(${Math.max(0, t - elapsed)}); // ${a.when.kind === "distance" ? `~when the simulated robot had traveled ${num((a.when as { value: number }).value, 1)}` : "delay"} (re-time on robot)`);
        elapsed = Math.max(elapsed, t);
        body.push(...actionCpp(a, hasIntake));
      }
      out.push(`pros::Task step${i + 1}_actions([]() {`, ...indent(body, 4), "});");
    } else for (const a of mid) out.push(...actionCpp(a, hasIntake));
    switch (m.type) {
      case "setPose": out.push(`gen::set_pose(${num(m.x)}, ${num(m.y)}, ${num(m.heading)});`); break;
      case "wait": out.push(`pros::delay(${m.ms});`); break;
      case "moveToPoint":
        out.push(`gen::move_to_point(${num(m.x)}, ${num(m.y)}, ${m.timeout}${opts([["forwards", "false", !m.forwards], ["maxSpeed", num(m.maxSpeed), m.maxSpeed !== 127], ["minSpeed", num(m.minSpeed), m.minSpeed !== 0], ["earlyExit", num(m.earlyExit), m.earlyExit !== 0]])});`);
        break;
      case "moveToPose":
        out.push(`gen::move_to_pose(${num(m.x)}, ${num(m.y)}, ${num(m.heading)}, ${m.timeout}${opts([["forwards", "false", !m.forwards], ["horizontalDrift", num(m.horizontalDrift), m.horizontalDrift !== 0], ["lead", num(m.lead), m.lead !== 0.6], ["maxSpeed", num(m.maxSpeed), m.maxSpeed !== 127], ["minSpeed", num(m.minSpeed), m.minSpeed !== 0], ["earlyExit", num(m.earlyExit), m.earlyExit !== 0]])});`);
        break;
      case "turnToHeading":
        out.push(`gen::turn_to_heading(${num(m.heading)}, ${m.timeout}${opts([["direction", `gen::Dir::${m.direction === "cw" ? "CW" : "CCW"}`, m.direction !== "auto"], ["maxSpeed", num(m.maxSpeed), m.maxSpeed !== 127], ["minSpeed", num(m.minSpeed), m.minSpeed !== 0], ["earlyExit", num(m.earlyExit), m.earlyExit !== 0]])});`);
        break;
      case "turnToPoint":
        out.push(`gen::turn_to_point(${num(m.x)}, ${num(m.y)}, ${m.timeout}${opts([["maxSpeed", num(m.maxSpeed), m.maxSpeed !== 127], ["minSpeed", num(m.minSpeed), m.minSpeed !== 0], ["earlyExit", num(m.earlyExit), m.earlyExit !== 0], ["forwards", "false", !m.forwards]])});`);
        break;
      case "swingToHeading":
        out.push(`gen::swing_to_heading(${num(m.heading)}, gen::Lock::${m.lock === "left" ? "LEFT" : "RIGHT"}, ${m.timeout}${opts([["maxSpeed", num(m.maxSpeed), m.maxSpeed !== 127], ["minSpeed", num(m.minSpeed), m.minSpeed !== 0], ["earlyExit", num(m.earlyExit), m.earlyExit !== 0]])});`);
        break;
      case "follow": {
        const idx = paths.get(step.id)!;
        out.push(`gen::follow(path_${idx}, sizeof(path_${idx}) / sizeof(path_${idx}[0]), ${num(m.lookahead)}, ${m.timeout}, ${m.forwards ? "true" : "false"});`);
        break;
      }
    }
    for (const a of end) out.push(...actionCpp(a, hasIntake));
    return out;
  };

  L.push("void initialize() {");
  L.push("    pros::lcd::initialize();");
  L.push("    gen::init();");
  L.push("    pros::Task screen_task([]() {");
  L.push("        while (true) {");
  L.push("            const gen::Pose p = gen::get_pose();");
  L.push('            pros::lcd::print(0, "X: %f", p.x);');
  L.push('            pros::lcd::print(1, "Y: %f", p.y);');
  L.push('            pros::lcd::print(2, "Theta: %f", p.theta);');
  L.push("            pros::delay(50);");
  L.push("        }");
  L.push("    });");
  L.push("}");
  L.push("");
  L.push("void disabled() {}");
  L.push("void competition_initialize() {}");
  L.push("");
  L.push(`void ${fn}() {`);
  if (!routine.steps.length || routine.steps[0].motion.type !== "setPose") L.push(`    gen::set_pose(${num(routine.start.x)}, ${num(routine.start.y)}, ${num(routine.start.heading)});`);
  routine.steps.forEach((s, i) => L.push(...indent(stepCode(s, i))));
  L.push("}");
  L.push("");
  L.push("void autonomous() {");
  L.push(`    ${fn}();`);
  L.push("}");
  L.push("");
  L.push("void opcontrol() {");
  if (usesClamp) L.push("    bool clamp_on = false;");
  L.push("    left_motors.set_brake_mode_all(gen::BRAKE_MODE);");
  L.push("    right_motors.set_brake_mode_all(gen::BRAKE_MODE);");
  L.push("    while (true) {");
  if (ports.controller === "tank") {
    L.push("        left_motors.move(controller.get_analog(ANALOG_LEFT_Y));");
    L.push("        right_motors.move(controller.get_analog(ANALOG_RIGHT_Y));");
  } else {
    L.push("        const int throttle = controller.get_analog(ANALOG_LEFT_Y);");
    L.push("        const int turn = controller.get_analog(ANALOG_RIGHT_X);");
    L.push("        left_motors.move(throttle + turn);");
    L.push("        right_motors.move(throttle - turn);");
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
  void taskFns;
  if (cfg.odom.trackingWheels.length === 0 && cfg.wheels.every((w) => w.type === "omni")) warnings.push("All-omni drivetrain with drive-motor odometry drifts several inches; add tracking wheels.");
  return { target: "generic-pros", title: "Generic PROS (no library)", version: GENERIC_VERSION, files: [{ path: "src/main.cpp", content: L.join("\n") }], notes, warnings };
}
