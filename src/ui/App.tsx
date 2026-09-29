import { useCallback, useState } from "react";
import { motorBudget } from "../core/motors";
import { derive, type RobotConfig, type WheelType } from "../core/robot";
import type { SimState } from "../core/physics";
import { games } from "../games";
import { FieldView } from "./FieldView";
import { useStore } from "./store";

function Num({ label, value, onChange, step = 1, min = 0 }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number }) {
  return (
    <label className="row">
      <span>{label}</span>
      <input type="number" value={value} step={step} min={min} onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(v); }} />
    </label>
  );
}

export function App() {
  const { robot, game, setRobot, setGame } = useStore();
  const [tel, setTel] = useState<SimState | null>(null);
  const onTel = useCallback((s: SimState) => setTel({ ...s }), []);
  const d = derive(robot);
  const budget = motorBudget({ count: robot.motorsPerSide * 2, watts: robot.motorWatts }, 0, game.robotRules);

  const setWheelType = (i: number, type: WheelType) =>
    setRobot({ wheels: robot.wheels.map((w, j) => (j === i ? { ...w, type } : w)) });
  const setWheelCount = (n: number) => {
    const xs = n === 2 ? [4, -4] : n === 3 ? [5, 0, -5] : [7, 3.5, 0, -3.5, -7].slice(0, n);
    setRobot({ wheels: xs.map((x, i) => ({ x, type: robot.wheels[i]?.type ?? "omni" })) });
  };
  const num = <K extends keyof RobotConfig>(k: K) => (v: number) => setRobot({ [k]: v } as Partial<RobotConfig>);

  return (
    <div className="app">
      <aside className="panel">
        <h1>SimToEndAllSims</h1>
        <label className="row">
          <span>Game</span>
          <select value={game.id} onChange={(e) => setGame(e.target.value)}>
            {games.map((g) => <option key={g.id} value={g.id}>{g.name} {g.season !== "-" ? `(${g.season})` : ""}</option>)}
          </select>
        </label>
        {game.notes.map((n, i) => <p key={i} className="note">{n}</p>)}

        <h2>Drivetrain</h2>
        <label className="row">
          <span>Motors / side</span>
          <select value={robot.motorsPerSide} onChange={(e) => setRobot({ motorsPerSide: +e.target.value })}>
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} ({n * 2} total)</option>)}
          </select>
        </label>
        <label className="row">
          <span>Motor</span>
          <select value={robot.motorWatts} onChange={(e) => setRobot({ motorWatts: +e.target.value as 11 | 5.5 })}>
            <option value={11}>11 W</option><option value={5.5}>5.5 W</option>
          </select>
        </label>
        <label className="row">
          <span>Cartridge</span>
          <select value={robot.cartridge} onChange={(e) => setRobot({ cartridge: +e.target.value as 100 | 200 | 600 })}>
            <option value={100}>100 rpm (red)</option><option value={200}>200 rpm (green)</option><option value={600}>600 rpm (blue)</option>
          </select>
        </label>
        <Num label="Driving teeth" value={robot.drivingTeeth} onChange={num("drivingTeeth")} min={1} />
        <Num label="Driven teeth" value={robot.drivenTeeth} onChange={num("drivenTeeth")} min={1} />
        <label className="row">
          <span>Wheel size</span>
          <select value={robot.wheelDiameter} onChange={(e) => setRobot({ wheelDiameter: +e.target.value })}>
            <option value={2.75}>2.75"</option><option value={3.25}>3.25"</option><option value={4}>4"</option>
          </select>
        </label>
        <label className="row">
          <span>Wheels / side</span>
          <select value={robot.wheels.length} onChange={(e) => setWheelCount(+e.target.value)}>
            {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        {robot.wheels.map((w, i) => (
          <label className="row" key={i}>
            <span>Wheel {i + 1} (x={w.x}")</span>
            <select value={w.type} onChange={(e) => setWheelType(i, e.target.value as WheelType)}>
              <option value="omni">omni</option><option value="traction">traction</option>
            </select>
          </label>
        ))}

        <h2>Body</h2>
        <Num label="Track width (in)" value={robot.trackWidth} onChange={num("trackWidth")} step={0.25} min={1} />
        <Num label="Length (in)" value={robot.length} onChange={num("length")} step={0.5} min={1} />
        <Num label="Width (in)" value={robot.width} onChange={num("width")} step={0.5} min={1} />
        <Num label="Mass (kg)" value={robot.mass} onChange={num("mass")} step={0.1} min={0.5} />

        <h2>Motor budget</h2>
        <p className={budget.legal ? "ok" : "bad"}>
          Drivetrain {budget.drivetrainW} W{game.robotRules.drivetrainCapW !== null ? ` / ${game.robotRules.drivetrainCapW} W` : ""} · total cap {game.robotRules.totalCapW} W
          {!game.robotRules.verified && " (caps UNVERIFIED)"}
        </p>
        {budget.problems.map((p) => <p key={p} className="bad">{p}</p>)}
        {game.startingSize && (robot.length > game.startingSize.value || robot.width > game.startingSize.value) && (
          <p className="bad">Exceeds {game.startingSize.value}" starting size{game.startingSize.verified ? "" : " (UNVERIFIED)"}</p>
        )}
      </aside>

      <main className="main">
        <FieldView onTelemetry={onTel} />
      </main>

      <aside className="panel telemetry">
        <h2>Derived</h2>
        <p>Free speed: {d.freeSpeed.toFixed(1)} in/s</p>
        <p>Free turn rate: {d.freeTurnRate.toFixed(0)} °/s</p>
        <p>Inertia: {d.inertia.toFixed(4)} kg·m²</p>
        <h2>Live</h2>
        {tel && (
          <>
            <p>x {tel.x.toFixed(1)} in · y {tel.y.toFixed(1)} in</p>
            <p>heading {(((tel.heading % 360) + 360) % 360).toFixed(1)}°</p>
            <p>v {tel.vx.toFixed(1)} in/s · ω {tel.w.toFixed(0)} °/s</p>
            <p>battery {tel.batteryV.toFixed(2)} V</p>
            <p>t {tel.t.toFixed(2)} s</p>
          </>
        )}
      </aside>
    </div>
  );
}
