import { useEffect, useMemo, useRef } from "react";
import { frameIndex, lerpFrame } from "./helpers";
import { useStore } from "./store";

type Series = { label: string; color: string; get: (f: ReturnType<typeof lerpFrame>) => number };

function Chart({ title, unit, series, height = 70 }: { title: string; unit: string; series: Series[]; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { recording, time, setTime } = useStore();
  const frames = recording?.frames;

  const data = useMemo(() => (frames ? series.map((s) => frames.map((f) => s.get(f as never))) : []), [frames, series]);

  useEffect(() => {
    const c = ref.current;
    if (!c || !frames || !frames.length) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = height;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    ctx.clearRect(0, 0, w, h);
    const dur = frames[frames.length - 1].t || 1;
    let lo = Infinity, hi = -Infinity;
    for (const d of data) for (const v of d) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!Number.isFinite(lo)) return;
    if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const X = (t: number) => (t / dur) * (w - 34) + 32;
    const Y = (v: number) => h - 4 - ((v - lo) / (hi - lo)) * (h - 10);
    ctx.strokeStyle = dark ? "#2f3a52" : "#c5cede"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(32, Y(0)); ctx.lineTo(w, Y(0)); ctx.stroke();
    ctx.fillStyle = dark ? "#8b96b3" : "#5a6b93"; ctx.font = "10px system-ui"; ctx.textAlign = "right";
    ctx.fillText(hi.toFixed(0), 28, 10); ctx.fillText(lo.toFixed(0), 28, h - 2);
    // step boundaries
    ctx.fillStyle = dark ? "#ffffff10" : "#00000010";
    recording!.steps.forEach((s, i) => { if (i % 2 === 0) ctx.fillRect(X(s.start), 0, Math.max(1, X(s.end) - X(s.start)), h); });
    series.forEach((s, si) => {
      ctx.strokeStyle = s.color; ctx.lineWidth = 1.5; ctx.beginPath();
      data[si].forEach((v, i) => (i ? ctx.lineTo(X(frames[i].t), Y(v)) : ctx.moveTo(X(frames[i].t), Y(v))));
      ctx.stroke();
    });
    ctx.strokeStyle = "#f0b34a"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(X(time), 0); ctx.lineTo(X(time), h); ctx.stroke();
  }, [frames, data, time, series, height, recording]);

  const seek = (e: React.PointerEvent) => {
    if (!frames) return;
    const r = e.currentTarget.getBoundingClientRect();
    const dur = frames[frames.length - 1].t;
    setTime(Math.max(0, Math.min(dur, ((e.clientX - r.left - 32) / (r.width - 34)) * dur)));
  };
  return (
    <div className="chart">
      <div className="chart-head"><b>{title}</b> <em>{unit}</em> {series.map((s) => <span key={s.label} style={{ color: s.color }}>● {s.label}</span>)}</div>
      <canvas ref={ref} style={{ width: "100%", height }} onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); seek(e); }} onPointerMove={(e) => { if (e.buttons) seek(e); }} />
    </div>
  );
}

const speed: Series[] = [
  { label: "speed", color: "#5aa9ff", get: (f) => Math.hypot(f.vx, f.vy) * Math.sign(f.vx || 1) },
  { label: "left wheel", color: "#3fb970", get: (f) => f.wheelVL },
  { label: "right wheel", color: "#e5484d", get: (f) => f.wheelVR },
];
const odomErr: Series[] = [
  { label: "position error", color: "#ff6ba8", get: (f) => Math.hypot(f.ex - f.x, f.ey - f.y) },
  { label: "heading error", color: "#b58cff", get: (f) => f.etheta - f.heading },
];
const power: Series[] = [
  { label: "battery V", color: "#f0b34a", get: (f) => f.battery },
  { label: "current A", color: "#5fd0c8", get: (f) => f.current },
];

export function Timeline() {
  const { recording, time, playing, speed: spd, setTime, setPlaying, setSpeed } = useStore();
  const dur = recording?.duration ?? 0;
  const f = recording && recording.frames.length ? recording.frames[frameIndex(recording.frames, time)] : null;
  return (
    <div className="timeline">
      <div className="transport">
        <button onClick={() => { if (time >= dur - 0.01) setTime(0); setPlaying(!playing); }}>{playing ? "⏸ Pause" : "▶ Play"}</button>
        <button onClick={() => { setPlaying(false); setTime(0); }} title="Rewind">⏮</button>
        <input type="range" min={0} max={Math.max(dur, 0.01)} step={0.01} value={Math.min(time, dur)} onChange={(e) => { setPlaying(false); setTime(parseFloat(e.target.value)); }} />
        <span className="t">{time.toFixed(2)} / {dur.toFixed(2)} s</span>
        <select value={spd} onChange={(e) => setSpeed(parseFloat(e.target.value))}>{[0.25, 0.5, 1, 2, 4].map((s) => <option key={s} value={s}>{s}×</option>)}</select>
      </div>
      {f && (
        <div className="live">
          <span>x {f.x.toFixed(1)} · y {f.y.toFixed(1)} · θ {(((f.heading % 360) + 360) % 360).toFixed(0)}°</span>
          <span>v {f.vx.toFixed(0)} in/s{Math.abs(f.vy) > 1 ? ` (sliding ${f.vy.toFixed(0)})` : ""}</span>
          <span>odom err {Math.hypot(f.ex - f.x, f.ey - f.y).toFixed(1)} in</span>
          <span>{f.battery.toFixed(1)} V · {f.current.toFixed(1)} A</span>
          {f.slip && <span className="bad">wheel slip</span>}
          {f.held > 0 && <span>holding {f.held}</span>}
        </div>
      )}
      <div className="charts">
        <Chart title="Speed" unit="in/s" series={speed} />
        <Chart title="Odometry error" unit="in / °" series={odomErr} />
        <Chart title="Battery" unit="V / A" series={power} />
      </div>
    </div>
  );
}
