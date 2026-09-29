import { derive, type RobotConfig } from "./robot";
import type { SimState } from "./physics";

/** Small deterministic PRNG so noisy sensors stay reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: () => number): number {
  const u = Math.max(1e-12, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** V5 motor encoder ticks per motor-output revolution (red 36:1, green 18:1, blue 6:1). */
export const TICKS_PER_REV = { 100: 1800, 200: 900, 600: 300 } as const;

/**
 * Simulated sensors: IMU, drive-motor encoders (IME) and tracking wheels. Integrates the TRUE robot
 * motion into raw sensor readings (with quantization / drift / scale error), like the real devices.
 */
export class SensorSuite {
  private rng: () => number;
  private vert: number[];
  private horiz: number[];
  private t = 0;
  private imuBias: number;
  private imuOffset = 0;

  constructor(private cfg: RobotConfig, seed = 1, start: { heading: number } = { heading: 0 }) {
    this.rng = mulberry32(seed);
    this.vert = cfg.odom.trackingWheels.filter((w) => w.axis === "vertical").map(() => 0);
    this.horiz = cfg.odom.trackingWheels.filter((w) => w.axis === "horizontal").map(() => 0);
    // Each IMU has its own drift direction/magnitude.
    this.imuBias = (this.rng() * 2 - 1) * cfg.odom.imuDriftDegPerSec;
    this.imuOffset = start.heading;
  }

  /** Call every physics step with the true state. */
  accumulate(s: SimState, dt: number): void {
    const w = (s.w * Math.PI) / 180;
    let vi = 0, hi = 0;
    for (const tw of this.cfg.odom.trackingWheels) {
      const scale = 1 + this.cfg.odom.wheelScaleError;
      if (tw.axis === "vertical") this.vert[vi++] += (s.vx - w * tw.offset) * dt * scale;
      // LemLib's odometry (odom.cpp: x += localX * -cos(heading)) treats a positive horizontal reading as
      // motion to the robot's LEFT, so the simulated sensor reports leftward travel as positive.
      else this.horiz[hi++] += -(s.vy + w * tw.offset) * dt * scale;
    }
    this.t += dt;
  }

  /** IMU rotation, degrees, clockwise +, unwrapped (PROS get_rotation), relative to start heading. */
  imuRotation(s: SimState): number {
    const o = this.cfg.odom;
    const raw = (s.heading - this.imuOffset) * (1 + o.imuScaleError) + this.imuBias * this.t;
    return raw + gauss(this.rng) * o.imuNoiseDeg;
  }

  /** Drive IME distance for one side in inches (wheel travel as computed from the configured ratio). */
  imeDistance(s: SimState, side: "L" | "R"): number {
    const travel = side === "L" ? s.travelL : s.travelR;
    const d = derive(this.cfg);
    const circ = Math.PI * this.cfg.wheelDiameter;
    const rotations = travel / (circ * d.ratio);
    const ticks = Math.floor(rotations * TICKS_PER_REV[this.cfg.cartridge]);
    return (ticks / TICKS_PER_REV[this.cfg.cartridge]) * circ * d.ratio * (1 + this.cfg.odom.wheelScaleError);
  }

  trackingDistance(index: number, axis: "vertical" | "horizontal"): number {
    const spec = this.cfg.odom.trackingWheels.filter((w) => w.axis === axis)[index];
    const raw = (axis === "vertical" ? this.vert : this.horiz)[index];
    if (!spec) return 0;
    const circ = Math.PI * spec.diameter;
    // V5 Rotation Sensor: 0.088 deg/tick. ADI optical shaft encoder: 360 ticks/rev.
    const tick = spec.sensor === "rotation" ? (circ * 0.088) / 360 : circ / 360;
    return Math.round(raw / tick) * tick;
  }
}

/** Pose as LemLib reports it: inches, heading degrees (0 = +y, clockwise +). */
export interface Pose { x: number; y: number; theta: number }

/**
 * Port of LemLib v0.5's odometry (src/lemlib/chassis/odom.cpp): IMU heading (when present), one
 * vertical + one horizontal tracking wheel, falling back to the drive motors' IMEs.
 */
export class LemLibOdom {
  private x = 0;
  private y = 0;
  private theta = 0; // rad, clockwise from +y
  private prevV1 = 0; private prevV2 = 0; private prevH1 = 0; private prevH2 = 0; private prevImu = 0;
  private prevVertical = 0; private prevHorizontal = 0;

  constructor(private cfg: RobotConfig, private sensors: SensorSuite) {}

  setPose(x: number, y: number, headingDeg: number, s: SimState): void {
    this.x = x; this.y = y; this.theta = (headingDeg * Math.PI) / 180;
    // LemLib::setPose does not reset raw sensors; deltas continue from the current readings.
    this.prevImu = (this.sensors.imuRotation(s) * Math.PI) / 180;
    this.snapshot(s);
  }

  private raws(s: SimState) {
    const tw = this.cfg.odom.trackingWheels;
    const vs = tw.filter((w) => w.axis === "vertical");
    const hs = tw.filter((w) => w.axis === "horizontal");
    const track = this.cfg.trackWidth;
    // vertical1/2: real tracking wheels if configured, else drive IMEs at +/- trackWidth/2
    const v1 = vs[0]
      ? { raw: this.sensors.trackingDistance(0, "vertical"), off: vs[0].offset, ime: false }
      : { raw: this.sensors.imeDistance(s, "L"), off: -track / 2, ime: true };
    const v2 = vs[1]
      ? { raw: this.sensors.trackingDistance(1, "vertical"), off: vs[1].offset, ime: false }
      : { raw: this.sensors.imeDistance(s, "R"), off: track / 2, ime: true };
    const h1 = hs[0] ? { raw: this.sensors.trackingDistance(0, "horizontal"), off: hs[0].offset } : null;
    const h2 = hs[1] ? { raw: this.sensors.trackingDistance(1, "horizontal"), off: hs[1].offset } : null;
    return { v1, v2, h1, h2 };
  }

  private snapshot(s: SimState): void {
    const r = this.raws(s);
    this.prevV1 = r.v1.raw; this.prevV2 = r.v2.raw;
    this.prevH1 = r.h1?.raw ?? 0; this.prevH2 = r.h2?.raw ?? 0;
    const vw = !r.v1.ime ? r.v1 : !r.v2.ime ? r.v2 : r.v1;
    this.prevVertical = vw.raw;
    this.prevHorizontal = (r.h1 ?? r.h2)?.raw ?? 0;
  }

  /** One 10 ms tracking update. */
  update(s: SimState): void {
    const r = this.raws(s);
    const imuRaw = this.cfg.odom.useImu ? (this.sensors.imuRotation(s) * Math.PI) / 180 : null;
    const dV1 = r.v1.raw - this.prevV1;
    const dV2 = r.v2.raw - this.prevV2;
    const dH1 = r.h1 ? r.h1.raw - this.prevH1 : 0;
    const dH2 = r.h2 ? r.h2.raw - this.prevH2 : 0;
    const dImu = imuRaw !== null ? imuRaw - this.prevImu : 0;
    this.prevV1 = r.v1.raw; this.prevV2 = r.v2.raw;
    if (r.h1) this.prevH1 = r.h1.raw;
    if (r.h2) this.prevH2 = r.h2.raw;
    if (imuRaw !== null) this.prevImu = imuRaw;

    let heading = this.theta;
    if (r.h1 && r.h2) heading -= (dH1 - dH2) / (r.h1.off - r.h2.off);
    else if (!r.v1.ime && !r.v2.ime) heading -= (dV1 - dV2) / (r.v1.off - r.v2.off);
    else if (imuRaw !== null) heading += dImu;
    else heading -= (dV1 - dV2) / (r.v1.off - r.v2.off);
    const dHeading = heading - this.theta;
    const avg = this.theta + dHeading / 2;

    const vw = !r.v1.ime ? r.v1 : !r.v2.ime ? r.v2 : r.v1;
    const hw = r.h1 ?? r.h2;
    const dY = vw.raw - this.prevVertical;
    const dX = hw ? hw.raw - this.prevHorizontal : 0;
    this.prevVertical = vw.raw;
    if (hw) this.prevHorizontal = hw.raw;
    const vOff = vw.off;
    const hOff = hw ? hw.off : 0;

    let localX: number, localY: number;
    if (dHeading === 0) { localX = dX; localY = dY; }
    else {
      localX = 2 * Math.sin(dHeading / 2) * (dX / dHeading + hOff);
      localY = 2 * Math.sin(dHeading / 2) * (dY / dHeading + vOff);
    }
    this.x += localY * Math.sin(avg);
    this.y += localY * Math.cos(avg);
    this.x += localX * -Math.cos(avg);
    this.y += localX * Math.sin(avg);
    this.theta = heading;
  }

  getPose(): Pose {
    return { x: this.x, y: this.y, theta: (this.theta * 180) / Math.PI };
  }
}
