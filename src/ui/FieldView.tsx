import { useEffect, useRef, useState } from "react";
import { derive } from "../core/robot";
import { defaultEnv, initialState, step, type SimState } from "../core/physics";
import { useStore } from "./store";

const DT = 0.005;
const KEYS = new Set(["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"]);

export function FieldView({ onTelemetry }: { onTelemetry: (s: SimState) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const robot = useStore((s) => s.robot);
  const game = useStore((s) => s.game);
  const sim = useRef<SimState>(initialState(0, 0, 0));
  const keys = useRef(new Set<string>());
  const cfgRef = useRef(robot);
  const [trail, setTrail] = useState(true);
  const trailRef = useRef<[number, number][]>([]);
  const trailOn = useRef(true);
  cfgRef.current = robot;
  trailOn.current = trail;

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (KEYS.has(k) && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) {
        keys.current.add(k);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let frame = 0;
    const env = { ...defaultEnv, fieldSize: game.fieldSize.value };
    let derivedFor = cfgRef.current;
    let d = derive(derivedFor);

    const draw = () => {
      const c = canvas.current;
      if (!c) return;
      const ctx = c.getContext("2d")!;
      const size = c.width;
      const scale = size / env.fieldSize;
      const cfg = cfgRef.current;
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = "#1c2230";
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = "#2c3548";
      ctx.lineWidth = 1;
      for (let i = 1; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo((i * size) / 6, 0); ctx.lineTo((i * size) / 6, size);
        ctx.moveTo(0, (i * size) / 6); ctx.lineTo(size, (i * size) / 6);
        ctx.stroke();
      }
      ctx.strokeStyle = "#5d6b8a";
      ctx.lineWidth = 3;
      ctx.strokeRect(0, 0, size, size);

      const s = sim.current;
      const px = (x: number) => size / 2 + x * scale;
      const py = (y: number) => size / 2 - y * scale;
      if (trailOn.current && trailRef.current.length > 1) {
        ctx.strokeStyle = "#f0b34a";
        ctx.lineWidth = 2;
        ctx.beginPath();
        trailRef.current.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))));
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(px(s.x), py(s.y));
      ctx.rotate((s.heading * Math.PI) / 180);
      const w = cfg.width * scale, l = cfg.length * scale;
      ctx.fillStyle = "rgba(90,160,255,0.55)";
      ctx.strokeStyle = "#8ec1ff";
      ctx.lineWidth = 2;
      ctx.fillRect(-w / 2, -l / 2, w, l);
      ctx.strokeRect(-w / 2, -l / 2, w, l);
      // wheels
      const ww = 0.8 * scale;
      for (const wh of cfg.wheels) {
        ctx.fillStyle = wh.type === "omni" ? "#ddd" : "#333";
        for (const side of [-1, 1]) {
          const wl = cfg.wheelDiameter * scale;
          ctx.fillRect((side * cfg.trackWidth * scale) / 2 - ww / 2, -wh.x * scale - wl / 2, ww, wl);
        }
      }
      // heading arrow (front)
      ctx.fillStyle = "#ff6b6b";
      ctx.beginPath();
      ctx.moveTo(0, -l / 2 - 4); ctx.lineTo(-6, -l / 2 + 8); ctx.lineTo(6, -l / 2 + 8);
      ctx.fill();
      ctx.restore();
    };

    const loop = (now: number) => {
      acc += Math.min(0.05, (now - last) / 1000);
      last = now;
      if (derivedFor !== cfgRef.current) {
        derivedFor = cfgRef.current;
        d = derive(derivedFor);
      }
      const k = keys.current;
      const fwd = (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0);
      const turn = (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0);
      const l = Math.max(-1, Math.min(1, fwd + turn));
      const r = Math.max(-1, Math.min(1, fwd - turn));
      while (acc >= DT) {
        sim.current = step(sim.current, derivedFor, l, r, DT, env, d);
        acc -= DT;
      }
      const s = sim.current;
      const tr = trailRef.current;
      if (frame % 3 === 0 && (tr.length === 0 || Math.hypot(s.x - tr[tr.length - 1][0], s.y - tr[tr.length - 1][1]) > 0.5)) {
        tr.push([s.x, s.y]);
        if (tr.length > 3000) tr.shift();
      }
      if (frame++ % 6 === 0) onTelemetry(s);
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [game, onTelemetry]);

  const reset = () => {
    sim.current = initialState(0, 0, 0);
    trailRef.current = [];
  };

  return (
    <div className="field-wrap">
      <canvas ref={canvas} width={720} height={720} className="field" />
      <div className="field-bar">
        <button onClick={reset}>Reset</button>
        <label><input type="checkbox" checked={trail} onChange={(e) => setTrail(e.target.checked)} /> trail</label>
        <span className="hint">Drive: WASD / arrows</span>
      </div>
    </div>
  );
}
