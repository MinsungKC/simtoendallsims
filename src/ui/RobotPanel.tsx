import { useState } from "react";
import { motorBudget } from "../core/motors";
import { WHEEL_CATALOG, derive, type RobotConfig, type WheelType } from "../core/robot";
import { autoTune, suggestHorizontalDrift } from "../core/tune";
import { Badge, Check, Num, Sel, Section } from "./atoms";
import { PRESETS } from "./presets";
import { useEditor } from "./store";

export function RobotPanel() {
  const { robot, setRobot, replaceRobot, game: getGame } = useEditor();
  const game = getGame();
  const d = derive(robot);
  const budget = motorBudget({ count: robot.motorsPerSide * 2, watts: robot.motorWatts }, robot.otherMotorsW, game.robotRules);
  const [tuning, setTuning] = useState<string | null>(null);
  const set = <K extends keyof RobotConfig>(k: K) => (v: RobotConfig[K]) => setRobot({ [k]: v } as Partial<RobotConfig>);

  const setWheelCount = (n: number) => {
    const span = Math.min(robot.length - 4, 12);
    const xs = n === 1 ? [0] : Array.from({ length: n }, (_, i) => span / 2 - (i * span) / (n - 1));
    setRobot({ wheels: xs.map((x, i) => ({ x: Math.round(x * 4) / 4, type: robot.wheels[i]?.type ?? (n === 3 && i === 1 ? "traction" : "omni") })) });
  };
  const setWheel = (i: number, patch: Partial<{ type: WheelType; x: number }>) => setRobot({ wheels: robot.wheels.map((w, j) => (j === i ? { ...w, ...patch } : w)) });

  const tune = () => {
    setTuning("Tuning… 0%");
    const done = (r: ReturnType<typeof autoTune>) => {
      setRobot({ lateral: r.lateral, angular: r.angular, horizontalDrift: r.horizontalDrift });
      setTuning(`Done. Test-motion cost ${r.score.before.toFixed(2)} → ${r.score.after.toFixed(2)} (lower is better). Lateral kP ${r.lateral.kP}, kD ${r.lateral.kD}; angular kP ${r.angular.kP}, kD ${r.angular.kD}. These are starting points for the real robot.`);
    };
    try {
      const w = new Worker(new URL("../core/tuneWorker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<{ progress?: number; result?: ReturnType<typeof autoTune> }>) => {
        if (e.data.progress !== undefined) setTuning(`Tuning… ${Math.round(e.data.progress * 100)}%`);
        if (e.data.result) { done(e.data.result); w.terminate(); }
      };
      w.onerror = () => { w.terminate(); setTimeout(() => done(autoTune(robot)), 20); };
      w.postMessage({ cfg: robot });
    } catch {
      setTimeout(() => done(autoTune(robot)), 20); // no worker support: run inline
    }
  };

  return (
    <div className="panel-body">
      <Section title="Preset">
        <select className="wide" value="" onChange={(e) => { const p = PRESETS.find((x) => x.id === e.target.value); if (p) replaceRobot(p.make()); }}>
          <option value="">Load a typical build…</option>
          {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </Section>

      <Section title="Drivetrain motors" right={<Badge kind={budget.legal ? "ok" : "bad"}>{budget.drivetrainW} W drive · {budget.totalW} W total</Badge>}>
        <Sel label="Motors per side" value={robot.motorsPerSide} options={[1, 2, 3, 4].map((n) => ({ value: n, label: `${n} (${n * 2} total)` }))} onChange={set("motorsPerSide")} />
        <Sel label="Motor" value={robot.motorWatts} options={[{ value: 11, label: "11 W" }, { value: 5.5, label: "5.5 W" }]} onChange={set("motorWatts")} />
        <p className="note">Tank-style drive (left/right sides). X-drive, H-drive, mecanum and swerve are not modelled yet.</p>
        <Sel label="Cartridge" value={robot.cartridge} options={[{ value: 100, label: "100 rpm (red)" }, { value: 200, label: "200 rpm (green)" }, { value: 600, label: "600 rpm (blue)" }]} onChange={set("cartridge")} />
        <Num label="Other motors" value={robot.otherMotorsW} onChange={set("otherMotorsW")} unit="W" min={0} hint="Intake, lift, etc. Counts against the total power cap." />
        <p className="note">
          Cap: {game.robotRules.totalCapW} W total{game.robotRules.drivetrainCapW !== null ? `, ${game.robotRules.drivetrainCapW} W drivetrain` : ""}
          {!game.robotRules.verified && " — UNVERIFIED, check the manual"}.
        </p>
        {budget.problems.map((p) => <p key={p} className="bad">{p}</p>)}
      </Section>

      <Section title="Gearing & wheels">
        <Num label="Driving teeth" value={robot.drivingTeeth} onChange={set("drivingTeeth")} min={1} />
        <Num label="Driven teeth" value={robot.drivenTeeth} onChange={set("drivenTeeth")} min={1} />
        <p className="note">Wheel speed = cartridge × driving ÷ driven = <b>{d.wheelRpm.toFixed(0)} rpm</b></p>
        <Sel label="Wheel size" value={String(WHEEL_CATALOG.some((w) => w.diameter === robot.wheelDiameter) ? robot.wheelDiameter : "custom")} options={[...WHEEL_CATALOG.map((w) => ({ value: String(w.diameter), label: w.label })), { value: "custom", label: "Custom…" }]} onChange={(v) => v !== "custom" && set("wheelDiameter")(parseFloat(v))} hint="Actual diameter, not the marketed size (LemLib's table)." />
        <Num label="Actual diameter" value={robot.wheelDiameter} onChange={set("wheelDiameter")} step={0.005} min={1} unit="in" />
        <Sel label="Wheels per side" value={robot.wheels.length} options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))} onChange={setWheelCount} />
        {robot.wheels.map((w, i) => (
          <div className="row two" key={i}>
            <span>Wheel {i + 1}</span>
            <select value={w.type} onChange={(e) => setWheel(i, { type: e.target.value as WheelType })}><option value="omni">omni</option><option value="traction">traction</option></select>
            <span className="input-unit"><input type="number" value={w.x} step={0.25} onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setWheel(i, { x: v }); }} /><em>in</em></span>
          </div>
        ))}
        <p className="note">Wheel position is forward (+) / back (−) of the robot center. Omni wheels slide sideways; traction wheels grip.</p>
      </Section>

      <Section title="Body">
        <Num label="Track width" value={robot.trackWidth} onChange={set("trackWidth")} step={0.25} min={1} unit="in" hint="Center-to-center distance of the left and right wheels." />
        <Num label="Length" value={robot.length} onChange={set("length")} step={0.5} min={1} unit="in" />
        <Num label="Width" value={robot.width} onChange={set("width")} step={0.5} min={1} unit="in" />
        <Num label="Mass" value={robot.mass} onChange={set("mass")} step={0.1} min={0.5} unit="kg" />
        <Sel label="Brake mode" value={robot.brake} options={[{ value: "coast", label: "coast" }, { value: "brake", label: "brake" }, { value: "hold", label: "hold" }]} onChange={set("brake")} />
        <p className="note">Yaw inertia {d.inertia.toFixed(4)} kg·m² (uniform box). Free speed {d.freeSpeed.toFixed(0)} in/s; loaded top speed is ~10% lower.</p>
        {game.startingSize && (robot.length > game.startingSize.value || robot.width > game.startingSize.value) && <p className="bad">Exceeds the {game.startingSize.value}" starting size{game.startingSize.verified ? "" : " (UNVERIFIED)"}.</p>}
      </Section>

      <Section title="Calibration" open={false}>
        <p className="note">Measure your real robot (top speed, time to reach it, whether wheels slip) and adjust these until the simulator matches.</p>
        <Num label="Floor grip ×" value={robot.grip} onChange={set("grip")} step={0.05} min={0.3} max={1.6} hint="Scales all tire friction. 1.0 assumes ~1.0 for traction wheels and ~0.75 for omnis on foam tiles." />
        <Num label="Drive efficiency" value={robot.efficiency} onChange={set("efficiency")} step={0.01} min={0.5} max={1} hint="Gearbox/chain losses. Real drivetrains reach roughly 85-95% of free speed." />
      </Section>

      <Section title="Mechanisms">
        <Check label="Intake" value={!!robot.intake} onChange={(v) => setRobot({ intake: v ? { reach: 4, width: 12, capacity: 6 } : null })} />
        {robot.intake && (
          <>
            <Num label="Reach" value={robot.intake.reach} onChange={(v) => setRobot({ intake: { ...robot.intake!, reach: v } })} unit="in" min={1} />
            <Num label="Width" value={robot.intake.width} onChange={(v) => setRobot({ intake: { ...robot.intake!, width: v } })} unit="in" min={1} />
            <Num label="Capacity" value={robot.intake.capacity} onChange={(v) => setRobot({ intake: { ...robot.intake!, capacity: Math.round(v) } })} min={1} />
          </>
        )}
      </Section>

      <Section title="Sensors & odometry" open={false}>
        <Check label="Use IMU for heading" value={robot.odom.useImu} onChange={(v) => setRobot({ odom: { ...robot.odom, useImu: v } })} />
        {robot.odom.trackingWheels.map((tw, i) => {
          const upd = (patch: object) => setRobot({ odom: { ...robot.odom, trackingWheels: robot.odom.trackingWheels.map((w, j) => (j === i ? { ...w, ...patch } : w)) } });
          return (
            <div key={i} className="card">
              <div className="row two">
                <span>Tracking wheel {i + 1}</span>
                <select value={tw.axis} onChange={(e) => upd({ axis: e.target.value })}><option value="vertical">vertical (forward)</option><option value="horizontal">horizontal (sideways)</option></select>
                <button onClick={() => setRobot({ odom: { ...robot.odom, trackingWheels: robot.odom.trackingWheels.filter((_, j) => j !== i) } })}>✕</button>
              </div>
              <Num label="Diameter" value={tw.diameter} onChange={(v) => upd({ diameter: v })} step={0.005} unit="in" min={1} />
              <Num label="Offset" value={tw.offset} onChange={(v) => upd({ offset: v })} step={0.25} unit="in" hint="Vertical: + right of center. Horizontal: + in front of center (LemLib convention)." />
              <Sel label="Sensor" value={tw.sensor} options={[{ value: "rotation", label: "V5 Rotation Sensor" }, { value: "encoder", label: "ADI encoder" }]} onChange={(v) => upd({ sensor: v })} />
            </div>
          );
        })}
        <button onClick={() => setRobot({ odom: { ...robot.odom, trackingWheels: [...robot.odom.trackingWheels, { axis: robot.odom.trackingWheels.some((w) => w.axis === "vertical") ? "horizontal" : "vertical", diameter: 2.75, offset: 0, sensor: "rotation" }] } })}>+ Add tracking wheel</button>
        <p className="note">Without tracking wheels LemLib/EZ use the drive motors' encoders. All-omni drives slide sideways, which those encoders can't see — the pink dashed ghost on the field shows how far odometry is off.</p>
        <Num label="IMU drift" value={robot.odom.imuDriftDegPerSec} onChange={(v) => setRobot({ odom: { ...robot.odom, imuDriftDegPerSec: v } })} step={0.005} unit="°/s" />
        <Num label="IMU noise" value={robot.odom.imuNoiseDeg} onChange={(v) => setRobot({ odom: { ...robot.odom, imuNoiseDeg: v } })} step={0.005} unit="°" />
        <Num label="IMU scale error" value={robot.odom.imuScaleError} onChange={(v) => setRobot({ odom: { ...robot.odom, imuScaleError: v } })} step={0.0005} hint="0.001 = reads 0.1% too high" />
        <Num label="Wheel scale error" value={robot.odom.wheelScaleError} onChange={(v) => setRobot({ odom: { ...robot.odom, wheelScaleError: v } })} step={0.001} />
      </Section>

      <Section title="Controller gains (LemLib layout)" right={<button onClick={tune}>Auto-tune</button>}>
        {tuning && <p className="note">{tuning}</p>}
        <p className="note">Lateral (distance) PID</p>
        <GainEditor g={robot.lateral} onChange={(g) => setRobot({ lateral: g })} unit="in" />
        <p className="note">Angular (turn) PID</p>
        <GainEditor g={robot.angular} onChange={(g) => setRobot({ angular: g })} unit="°" />
        <Num label="horizontalDrift" value={robot.horizontalDrift} onChange={set("horizontalDrift")} step={0.5} min={0} hint="LemLib: ~2 for all-omni, ~8 with center traction." />
        <button onClick={() => setRobot({ horizontalDrift: suggestHorizontalDrift(robot) })}>Suggest horizontalDrift</button>
      </Section>
    </div>
  );
}

function GainEditor({ g, onChange, unit }: { g: RobotConfig["lateral"]; onChange: (g: RobotConfig["lateral"]) => void; unit: string }) {
  const s = (k: keyof RobotConfig["lateral"]) => (v: number) => onChange({ ...g, [k]: v });
  return (
    <>
      <Num label="kP" value={g.kP} onChange={s("kP")} step={0.5} min={0} />
      <Num label="kI" value={g.kI} onChange={s("kI")} step={0.01} min={0} />
      <Num label="kD" value={g.kD} onChange={s("kD")} step={0.5} min={0} />
      <Num label="Anti-windup" value={g.windupRange} onChange={s("windupRange")} step={0.5} min={0} unit={unit} />
      <Num label="Small error" value={g.smallError} onChange={s("smallError")} step={0.25} min={0} unit={unit} />
      <Num label="Small timeout" value={g.smallErrorTimeout} onChange={s("smallErrorTimeout")} step={10} min={0} unit="ms" />
      <Num label="Large error" value={g.largeError} onChange={s("largeError")} step={0.25} min={0} unit={unit} />
      <Num label="Large timeout" value={g.largeErrorTimeout} onChange={s("largeErrorTimeout")} step={10} min={0} unit="ms" />
      <Num label="Slew" value={g.slew} onChange={s("slew")} step={1} min={0} hint="Max power change per 10 ms. 0 = off." />
    </>
  );
}
