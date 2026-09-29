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
import { useMemo } from "react";
import { useEditor, useStore, type ProjectFile, type Tab } from "./store";

const TABS: { id: Tab; label: string }[] = [
  { id: "routine", label: "Routine" },
  { id: "robot", label: "Robot" },
  { id: "code", label: "Code" },
  { id: "field", label: "Field" },
];

try {
  const saved = localStorage.getItem("simtoendallsims:theme");
  if (saved) document.documentElement.dataset.theme = saved;
} catch { /* storage unavailable */ }

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
      else if (e.key === "Escape") { s.select(null); s.setTool("select"); }
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
    ...(recording?.warnings ?? []).map((w) => ({ ...w, level: "warn" as const })),
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
