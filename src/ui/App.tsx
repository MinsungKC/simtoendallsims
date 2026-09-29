import { useEffect, useRef } from "react";
import { FieldCanvas } from "./FieldCanvas";
import { RobotPanel } from "./RobotPanel";
import { RoutinePanel } from "./RoutinePanel";
import { CodePanel } from "./CodePanel";
import { FieldPanel } from "./FieldPanel";
import { Timeline } from "./Timeline";
import { Badge } from "./atoms";
import { download, scoreFor } from "./helpers";
import { games } from "../games";
import { preflight } from "../core/preflight";
import { useMemo, useState } from "react";
import { TOOLS } from "./RoutinePanel";
import { OVERLAY_LABELS, useEditor, useStore, type Overlays, type ProjectFile, type Tab } from "./store";

const TABS: { id: Tab; label: string }[] = [
  { id: "routine", label: "Route" },
  { id: "robot", label: "Robot" },
  { id: "code", label: "Code" },
  { id: "field", label: "Game info" },
];

try {
  const saved = localStorage.getItem("simtoendallsims:theme");
  if (saved) document.documentElement.dataset.theme = saved;
} catch { /* storage unavailable */ }

function Guide({ steps }: { steps: number }) {
  const [gone, setGone] = useState(() => { try { return localStorage.getItem("simtoendallsims:guide") === "1"; } catch { return false; } });
  if (gone || steps >= 2) return null;
  return (
    <div className="guide">
      <ol>
        <li><b>Pick your game</b> at the top and your robot on the Robot tab.</li>
        <li><b>Click the field</b> to add a drive point, or pick <b>✎ Draw path</b> and drag to draw any curve freehand - it is smoothed for you.</li>
        <li>Press <b>Play</b> to watch it, then <b>Get code ▸</b> for your robot's program.</li>
      </ol>
      <button title="Hide" onClick={() => { setGone(true); try { localStorage.setItem("simtoendallsims:guide", "1"); } catch { /* ignore */ } }}>✕</button>
    </div>
  );
}

export function App() {
  const st = useEditor();
  const playing = useStore((s) => s.playing);
  const { tab, setTab, recording, routine, robot } = st;
  const game = st.game();
  const fileRef = useRef<HTMLInputElement>(null);

  // playback loop
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const s = useStore.getState();
      const dt = ((now - last) / 1000) * s.speed;
      last = now;
      const dur = s.recording?.duration ?? 0;
      const t = s.time + dt;
      if (t >= dur) { s.setTime(dur); s.setPlaying(false); return; }
      s.setTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
      const s = useStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? s.redo() : s.undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); s.redo(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && s.selected) { e.preventDefault(); s.removeStep(s.selected); }
      else if (e.key === " ") { e.preventDefault(); s.setPlaying(!s.playing); }
      else if (e.key === "Escape") { s.select(null); s.setTool("moveToPoint"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const score = recording ? scoreFor(game, st.customField, recording.world) : null;
  const pre = useMemo(() => {
    const objs = st.customField ? st.customField.objects : game.objects;
    const obst = st.customField ? st.customField.obstacles : game.obstacles;
    return preflight(routine, robot, game, obst, objs);
  }, [routine, robot, game, st.customField]);
  const warnings = [
    ...pre.map((p) => ({ t: 0, step: p.step ?? -1, text: p.text, level: p.level })),
    ...(recording?.warnings ?? []).map((w) => ({ ...w, level: w.level ?? ("warn" as const) })),
  ];
  const errors = warnings.filter((w) => w.level === "error").length;
  const autonLimit = game.autonSeconds.value;
  const over = recording && recording.duration > autonLimit;

  const save = () => {
    const p: ProjectFile = { app: "simtoendallsims", version: 1, robot, ports: st.ports, routine, routines: st.allRoutines(), active: st.active, gameId: st.gameId, customField: st.customField, target: st.target, simOpts: st.simOpts };
    download(`${routine.name.replace(/\W+/g, "_") || "auton"}.simproject.json`, JSON.stringify(p, null, 1), "application/json");
  };
  const load = async (file: File) => {
    try {
      const p = JSON.parse(await file.text()) as ProjectFile;
      if (p.app !== "simtoendallsims") throw new Error("not a SimToEndAllSims project");
      st.loadProject(p);
    } catch (e) {
      alert(`Could not open project: ${String(e)}`);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>SimToEndAllSims</h1>
        <select value={game.id} onChange={(e) => st.setGame(e.target.value)} title="Game">
          {games.map((g) => <option key={g.id} value={g.id}>{g.name}{g.season !== "-" ? ` · ${g.season}` : ""}</option>)}
        </select>
        {game.layoutApproximate && <Badge kind="warn">approx. layout</Badge>}
        <span className="grow" />
        {recording && (
          <>
            <Badge kind={over ? "bad" : "ok"}>{recording.duration.toFixed(1)} s / {autonLimit} s</Badge>
            {score && <Badge kind="info">score R {score.red} · B {score.blue}</Badge>}
            <Badge kind={errors ? "bad" : warnings.length ? "warn" : "ok"}>{errors ? `${errors} error${errors === 1 ? "" : "s"} · ` : ""}{warnings.length - errors} warning{warnings.length - errors === 1 ? "" : "s"}</Badge>
          </>
        )}
        <button onClick={() => { const cur = document.documentElement.dataset.theme; const dark = cur ? cur === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; const next = dark ? "light" : "dark"; document.documentElement.dataset.theme = next; try { localStorage.setItem("simtoendallsims:theme", next); } catch { /* ignore */ } }} title="Toggle light/dark">◐</button>
        <button onClick={st.undo} disabled={!st.past.length} title="Undo (Ctrl+Z)">↶</button>
        <button onClick={st.redo} disabled={!st.future.length} title="Redo (Ctrl+Shift+Z)">↷</button>
        <button onClick={save}>Save</button>
        <button onClick={() => fileRef.current?.click()}>Open</button>
        <label className="simple" title="Only straight legs: draw a path or pick targets, nothing else"><input type="checkbox" checked={st.simple} onChange={(e) => st.setSimple(e.target.checked)} /> Simple mode</label>
        <button className="primary" onClick={() => setTab("code")} title="Generate the robot code for this route">Get code ▸</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ""; }} />
      </header>

      <aside className="side">
        <nav className="tabs">
          {TABS.map((t) => <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>{t.label}</button>)}
        </nav>
        {tab === "routine" && <RoutinePanel />}
        {tab === "robot" && <RobotPanel />}
        {tab === "code" && <CodePanel />}
        {tab === "field" && <FieldPanel />}
      </aside>

      <main className="center">
        <div className="toolbar">
          <button className="primary" onClick={() => { const g = useStore.getState(); if (!g.playing && g.recording && g.time >= g.recording.duration - 0.01) g.setTime(0); g.setPlaying(!g.playing); }} title="Play / pause (Space)">{playing ? "❚❚ Pause" : "▶ Play"}</button>
          <span className="sep" />
          {TOOLS.filter((t) => !st.simple || ["draw", "targets", "select"].includes(t.id)).map((t) => <button key={t.id} className={st.tool === t.id ? "active" : ""} title={t.hint} onClick={() => st.setTool(t.id)}>{t.label}</button>)}
          {st.tool === "draw" && <><span className="sep" /><span className="lbl">Leads with</span><button className={!st.drawReverse ? "active" : ""} onClick={() => st.setDrawReverse(false)}>Front</button><button className={st.drawReverse ? "active" : ""} onClick={() => st.setDrawReverse(true)}>Back</button></>}
        </div>
        <details className="view"><summary>View</summary><div>{(Object.keys(OVERLAY_LABELS) as (keyof Overlays)[]).map((k) => <label key={k}><input type="checkbox" checked={st.overlays[k]} onChange={(e) => st.setOverlay(k, e.target.checked)} /> {OVERLAY_LABELS[k]}</label>)}</div></details>
        <Guide steps={routine.steps.length} />
        <FieldCanvas />
        <div className="legend">
          <span><i style={{ background: "#f0b34a" }} /> true path</span>
          <span><i style={{ background: "#ff6ba8" }} /> odometry estimate (dashed robot = where the robot thinks it is)</span>
          <span><i style={{ background: "#8b96b3" }} /> planned route</span>
          <span>sim {st.simMs.toFixed(0)} ms</span>
        </div>
        {warnings.length > 0 && (
          <ul className="warnings">
            {warnings.slice(0, 6).map((w, i) => <li key={i} className={w.level === "error" ? "bad" : ""} onClick={() => w.step >= 0 && routine.steps[w.step] && st.select(routine.steps[w.step].id)}>{w.level === "error" ? "✖" : "⚠"} {w.step >= 0 ? `Step ${w.step + 1}: ` : ""}{w.text}</li>)}
            {warnings.length > 6 && <li>… and {warnings.length - 6} more</li>}
          </ul>
        )}
        <Timeline />
      </main>
    </div>
  );
}
