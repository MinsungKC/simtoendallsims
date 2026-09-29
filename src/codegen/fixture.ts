import { defaultRobot } from "../core/robot";
import { defaultMotion, type MotionSpec, type Routine } from "../core/routine";
import { defaultPorts } from "./types";

export function fixtureRoutine(): Routine {
  const at = (x: number, y: number, heading = 0) => ({ x, y, heading });
  const mv = (type: MotionSpec["type"], p: { x: number; y: number; heading: number }, patch: object = {}) => ({ ...defaultMotion(type, p), ...patch }) as MotionSpec;
  return {
    name: "Test Route",
    gameId: "blank",
    alliance: "red",
    start: at(-48, -58, 0),
    steps: [
      { id: "s0", motion: defaultMotion("setPose", at(-48, -58, 0)), actions: [] },
      { id: "s1", motion: mv("moveToPoint", at(-48, -30), { maxSpeed: 100, timeout: 2500 }), actions: [
        { id: "a1", type: "intakeIn", when: { kind: "start" } },
        { id: "a2", type: "clamp", when: { kind: "distance", value: 20 } },
      ] },
      { id: "s2", motion: mv("turnToHeading", at(0, 0, 90), { direction: "cw" }), actions: [] },
      { id: "s3", motion: mv("moveToPose", at(-24, -24, 135), { lead: 0.5, forwards: false, minSpeed: 40, earlyExit: 4 }), actions: [
        { id: "a3", type: "intakeStop", when: { kind: "end" } },
      ] },
      { id: "s4", motion: defaultMotion("swingToHeading", at(0, 0, 180)), actions: [] },
      { id: "s5", motion: defaultMotion("turnToPoint", at(0, 24)), actions: [] },
      { id: "s6", motion: defaultMotion("follow", at(-24, -24)), actions: [{ id: "a4", type: "eject", when: { kind: "delay", ms: 400 } }] },
      { id: "s7", motion: defaultMotion("wait", at(0, 0)), actions: [{ id: "a5", type: "unclamp", when: { kind: "end" } }, { id: "a6", type: "custom", code: "// custom code here", when: { kind: "end" } }, { id: "a7", type: "place", when: { kind: "end" } }, { id: "a8", type: "toggleSet", arg: "blue", when: { kind: "end" } }] },
    ],
  };
}

export function fixtureInput() {
  const cfg = defaultRobot();
  cfg.odom.trackingWheels = [
    { axis: "vertical", diameter: 2.75, offset: -2.5, sensor: "rotation" },
    { axis: "horizontal", diameter: 2.75, offset: -5.75, sensor: "rotation" },
  ];
  return { routine: fixtureRoutine(), cfg, ports: defaultPorts(cfg) };
}
