import { derive, type RobotConfig } from "./robot";
import { LemLibOdom, SensorSuite, type Pose } from "./odom";
import * as L from "./lemlib";
import { buildPathPoints } from "./path";
import type { ActionSpec, MotionSpec, Routine, Step } from "./routine";
import { createWorld, ejectHeld, placeHeld, setClamp, setToggle, stepWorld, type World, type WorldInit, type WorldEvent } from "./world";
import type { SimState } from "./physics";

export const PHYSICS_DT = 0.005;
const FRAME_EVERY = 4; // recorded frame every 20 ms

export interface Frame {
  t: number;
  /** true state */
  x: number; y: number; heading: number; vx: number; vy: number; w: number;
  /** what the robot's odometry believes */
  ex: number; ey: number; etheta: number;
  wheelVL: number; wheelVR: number;
  cmdL: number; cmdR: number;
  battery: number; current: number;
  slip: boolean;
  step: number;
  /** flattened [x, y, stateCode] per object; state 0 field, 1 held, 2 carried, 3 stacked in a Goal */
  objs: number[];
  held: number;
}

export interface Warning {
  t: number;
  step: number;
  text: string;
  level?: "error" | "warn";
}

export interface StepTiming { index: number; start: number; end: number; timedOut: boolean }

export interface TriggerFire { step: number; actionId: string; offsetMs: number; distance: number }

export interface Recording {
  triggers: TriggerFire[];
  frames: Frame[];
  warnings: Warning[];
  steps: StepTiming[];
  duration: number;
  contacts: number;
  /** final world (objects) for scoring */
  world: World;
  /** pickups, placements, toggle changes and rejected actions, in time order */
  events: WorldEvent[];
}

export interface RunOptions {
  seed?: number;
  /** Difference between where the robot really starts and where the routine assumes (placement error) */
  placementError?: { x: number; y: number; heading: number };
  /** Stop the simulation at this time (seconds) */
  maxTime?: number;
  /** Pneumatic actuation delay, s */
  clampDelay?: number;
  /** Controller ticks (10 ms each) between computing a motor command and the motors applying it. Real PROS
   *  commands reach the motors on the next update, so 1 is realistic; 0 gives an unrealistically ideal plant. */
  latencyTicks?: number;
}

interface PendingAction { a: ActionSpec; fireAt: number }

/** Deterministic headless run of a routine on the simulated robot. */
export function simulate(routine: Routine, cfg: RobotConfig, init: WorldInit, opts: RunOptions = {}): Recording {
  const d = derive(cfg);
  const pe = opts.placementError ?? { x: 0, y: 0, heading: 0 };
  const world = createWorld(init, { x: routine.start.x + pe.x, y: routine.start.y + pe.y, heading: routine.start.heading + pe.heading });
  world.alliance = routine.alliance;
  world.robotBox = { hl: cfg.length / 2, hw: cfg.width / 2 };
  const grip = cfg.grip ?? 1;
  world.env = {
    ...world.env,
    driveEfficiency: cfg.efficiency ?? world.env.driveEfficiency,
    friction: {
      traction: { long: world.env.friction.traction.long * grip, lat: world.env.friction.traction.lat * grip },
      omni: { long: world.env.friction.omni.long * grip, lat: world.env.friction.omni.lat * grip },
    },
  };
  const sensors = new SensorSuite(cfg, opts.seed ?? 1, { heading: world.robot.heading });
  const odom = new LemLibOdom(cfg, sensors);
  odom.setPose(routine.start.x, routine.start.y, routine.start.heading, world.robot);

  const frames: Frame[] = [];
  const warnings: Warning[] = [];
  const timings: StepTiming[] = [];
  const triggers: TriggerFire[] = [];
  const maxTime = opts.maxTime ?? 60;
  const clampDelay = opts.clampDelay ?? 0.12;
  const dt = { trackWidth: cfg.trackWidth, horizontalDrift: cfg.horizontalDrift };

  let simStep = 0;
  let cmdL = 0, cmdR = 0;
  let holdL = false, holdR = false;
  const latency = Math.max(0, Math.round(opts.latencyTicks ?? 1));
  const queue: { l: number; r: number; hl: boolean; hr: boolean }[] = [];
  const applyCommand = (l: number, r: number, hl: boolean, hr: boolean) => {
    queue.push({ l, r, hl, hr });
    while (queue.length > latency + 1) queue.shift();
    const c = queue.length > latency ? queue[queue.length - 1 - latency] : { l: 0, r: 0, hl: false, hr: false };
    cmdL = c.l; cmdR = c.r; holdL = c.hl; holdR = c.hr;
  };
  let nowMs = 0;
  let stepIdx = -1;
  let pending: PendingAction[] = [];
  const delayed: { fireAt: number; fn: () => void }[] = [];

  const record = () => {
    const s = world.robot;
    const est = odom.getPose();
    const objs: number[] = [];
    for (const o of world.objects) objs.push(o.x, o.y, o.state === "field" ? 0 : o.state === "held" ? 1 : o.state === "carried" ? 2 : 3);
    frames.push({
      t: world.t, x: s.x, y: s.y, heading: s.heading, vx: s.vx, vy: s.vy, w: s.w,
      ex: est.x, ey: est.y, etheta: est.theta,
      wheelVL: s.wheelVL, wheelVR: s.wheelVR, cmdL, cmdR,
      battery: s.batteryV, current: s.currentA, slip: s.slipL || s.slipR,
      step: stepIdx, objs, held: world.held.length,
    });
  };

  const advance = (): void => {
    stepWorld(world, cfg, cmdL / 127, cmdR / 127, PHYSICS_DT, d, { left: holdL, right: holdR });
    sensors.accumulate(world.robot, PHYSICS_DT);
    simStep++;
    for (let i = delayed.length - 1; i >= 0; i--) {
      if (world.t >= delayed[i].fireAt) { delayed[i].fn(); delayed.splice(i, 1); }
    }
    if (simStep % 2 === 0) { odom.update(world.robot); nowMs += LOOP_MS_10; }
    if (simStep % FRAME_EVERY === 0) record();
  };
  const LOOP_MS_10 = L.LOOP_MS;

  const fireAction = (a: ActionSpec): void => {
    switch (a.type) {
      case "intakeIn": world.mech.intake = 1; break;
      case "intakeOut": world.mech.intake = -1; break;
      case "intakeStop": world.mech.intake = 0; break;
      case "eject": ejectHeld(world, cfg, 1); break;
      case "place": {
        const why = placeHeld(world, cfg, a.arg && a.arg !== "any" ? a.arg : undefined);
        if (why) warnings.push({ t: world.t, step: stepIdx, text: `Place failed: ${why}` });
        break;
      }
      case "toggleSet": {
        const why = setToggle(world, cfg, (a.arg as "red" | "blue" | "yellow") ?? routine.alliance);
        if (why) warnings.push({ t: world.t, step: stepIdx, text: `Toggle failed: ${why}` });
        break;
      }
      case "clamp": delayed.push({ fireAt: world.t + clampDelay, fn: () => setClamp(world, cfg, true) }); break;
      case "unclamp": setClamp(world, cfg, false); break;
      case "custom": break; // user code: not simulated
    }
  };

  const runMotion = (step: Step, motion: L.Motion | null, waitMs: number): void => {
    const startT = world.t;
    const startMs = nowMs;
    pending = step.actions.map((a) => ({ a, fireAt: 0 }));
    const endActions = pending.filter((p) => p.a.when.kind === "end");
    // start-triggered actions fire immediately; the rest fire strictly in list order, exactly like the
    // generated code (waitUntil / delay are sequential statements)
    for (const p of pending) if (p.a.when.kind === "start") { fireAction(p.a); p.fireAt = -1; }
    const queue = pending.filter((p) => p.a.when.kind === "distance" || p.a.when.kind === "delay");
    let qi = 0;
    const fireQueued = (): void => {
      const p = queue[qi];
      p.fireAt = -1;
      triggers.push({ step: stepIdx, actionId: p.a.id, offsetMs: nowMs - startMs, distance: motion ? Math.max(0, motion.distTraveled) : 0 });
      fireAction(p.a);
      qi++;
    };
    const timing: StepTiming = { index: stepIdx, start: startT, end: startT, timedOut: false };
    timings.push(timing);
    let done = false;
    while (!done && world.t < maxTime) {
      // one controller tick per 10 ms (every 2 physics steps)
      const pose: Pose = odom.getPose();
      if (motion) {
        const out = motion.tick(pose, nowMs);
        applyCommand(out.left, out.right, !!out.holdLeft, !!out.holdRight);
        done = out.done;
      } else {
        applyCommand(0, 0, false, false);
        done = nowMs - startMs >= waitMs;
      }
      while (qi < queue.length) {
        const w = queue[qi].a.when;
        const hit = (w.kind === "distance" && motion && motion.distTraveled > w.value) || (w.kind === "delay" && nowMs - startMs >= w.ms);
        if (!hit) break;
        fireQueued();
      }
      advance(); advance();
    }
    applyCommand(0, 0, false, false);
    if (latency === 0) { cmdL = 0; cmdR = 0; holdL = false; holdR = false; }
    // any triggers that never fired still run at the end (matching generated code, which emits them
    // after waitUntilDone if distance was never reached would hang -> flag it)
    while (qi < queue.length) {
      const p = queue[qi];
      warnings.push({ t: world.t, step: stepIdx, text: `Action "${p.a.type}" trigger (${describeTrigger(p.a.when)}) was never reached during the motion - in generated code it would fire after the motion ends` });
      fireQueued();
    }
    for (const p of endActions) fireAction(p.a);
    timing.end = world.t;
    const budget = motionTimeout(step.motion);
    if (budget !== null && (timing.end - timing.start) * 1000 >= budget - 20) {
      timing.timedOut = true;
      warnings.push({ t: world.t, step: stepIdx, text: `Motion hit its ${budget} ms timeout instead of settling (raise the timeout, loosen exit ranges, or retune gains)` });
    }
  };

  // record initial frame
  record();
  for (let i = 0; i < routine.steps.length && world.t < maxTime; i++) {
    stepIdx = i;
    const step = routine.steps[i];
    const m = step.motion;
    if (m.type === "setPose") {
      odom.setPose(m.x, m.y, m.heading, world.robot);
      runMotion(step, null, 0);
      continue;
    }
    if (m.type === "wait") { runMotion(step, null, m.ms); continue; }
    runMotion(step, buildMotion(m, cfg, dt), 0);
  }
  // let things settle a moment
  stepIdx = routine.steps.length;
  for (let i = 0; i < 100 && world.t < maxTime; i++) advance();
  record();

  if (frames.length && frames[frames.length - 1].t > 15.001) {
    warnings.push({ t: 15, step: -1, text: `Routine runs ${frames[frames.length - 1].t.toFixed(1)} s - autonomous period is 15 s` });
  }
  return { frames, warnings, steps: timings, triggers, duration: world.t, contacts: world.contacts, world, events: world.events };
}

function describeTrigger(t: ActionSpec["when"]): string {
  switch (t.kind) {
    case "start": return "start";
    case "end": return "end";
    case "distance": return `after ${t.value} in`;
    case "delay": return `after ${t.ms} ms`;
  }
}

export function motionTimeout(m: MotionSpec): number | null {
  return "timeout" in m ? m.timeout : null;
}

export function buildMotion(m: MotionSpec, cfg: RobotConfig, dt: L.Drivetrain): L.Motion {
  switch (m.type) {
    case "moveToPoint":
      return L.moveToPoint(m.x, m.y, m.timeout, cfg.lateral, cfg.angular, dt, { forwards: m.forwards, maxSpeed: m.maxSpeed, minSpeed: m.minSpeed, earlyExitRange: m.earlyExit });
    case "moveToPose":
      return L.moveToPose(m.x, m.y, m.heading, m.timeout, cfg.lateral, cfg.angular, dt, { forwards: m.forwards, maxSpeed: m.maxSpeed, minSpeed: m.minSpeed, earlyExitRange: m.earlyExit, lead: m.lead, horizontalDrift: m.horizontalDrift });
    case "turnToHeading":
      return L.turnToHeading(m.heading, m.timeout, cfg.angular, { direction: m.direction, maxSpeed: m.maxSpeed, minSpeed: m.minSpeed, earlyExitRange: m.earlyExit });
    case "turnToPoint":
      return L.turnToPoint(m.x, m.y, m.timeout, cfg.angular, { forwards: m.forwards, maxSpeed: m.maxSpeed, minSpeed: m.minSpeed, earlyExitRange: m.earlyExit });
    case "swingToHeading":
      return L.swingToHeading(m.heading, m.lock, m.timeout, cfg.angular, { maxSpeed: m.maxSpeed, minSpeed: m.minSpeed, earlyExitRange: m.earlyExit });
    case "follow":
      return L.follow(buildPathPoints(m.path, cfg.trackWidth), m.lookahead, m.timeout, m.forwards, cfg.lateral, dt);
    default:
      throw new Error(`no motion for ${m.type}`);
  }
}

/** Convenience for tests/tuning: run a single motion from a start pose in an empty field. */
export function runSingleMotion(cfg: RobotConfig, motion: MotionSpec, start = { x: 0, y: 0, heading: 0 }, opts: RunOptions = {}): Recording {
  const routine: Routine = {
    name: "test", gameId: "blank", alliance: "red", start,
    steps: [{ id: "a", motion, actions: [] }],
  };
  return simulate(routine, cfg, { fieldSize: 144, objects: [], obstacles: [] }, opts);
}

export type { SimState };
