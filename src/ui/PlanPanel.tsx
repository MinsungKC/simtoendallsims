import { useState } from "react";
import { Num, Section, Sel } from "./atoms";
import { useEditor } from "./store";
import { topThree } from "../core/planner";

const ACTION_LABEL = { pickup: "Pick up", place: "Score / place", toggle: "Flip toggle" } as const;

/** "Pick targets" planner: click elements on the field, set how to arrive and what to do, get the 3 fastest working routes. */
export function PlanPanel() {
  const st = useEditor();
  const [open, setOpen] = useState(true);
  const { tasks } = st;
  const top = st.plans ? topThree(st.plans) : [];
  const failed = st.plans ? st.plans.filter((p) => !p.ok) : [];
  return (
    <Section title={`Plan by targets (${tasks.length})`} open={open || tasks.length > 0} right={tasks.length ? <button onClick={st.clearTasks}>Clear</button> : undefined}>
      {tasks.length === 0 && <p className="note">Choose <b>🎯 Pick targets</b> in the toolbar, then click the goals, pieces or toggles you want to visit, in order. Then pick how to arrive and what to do, and get the 3 fastest routes that work.</p>}
      {tasks.map((t, i) => (
        <div className="card" key={t.id}>
          <div className="row two"><b>{i + 1}. {t.label}</b>
            <span className="btns inline"><button disabled={i === 0} onClick={() => st.moveTask(t.id, -1)}>↑</button><button disabled={i === tasks.length - 1} onClick={() => st.moveTask(t.id, 1)}>↓</button><button onClick={() => st.removeTask(t.id)}>✕</button></span>
          </div>
          <Sel label="Do" value={t.action} options={(Object.keys(ACTION_LABEL) as (keyof typeof ACTION_LABEL)[]).map((v) => ({ value: v, label: ACTION_LABEL[v] }))} onChange={(action) => st.updateTask(t.id, { action })} />
          <Sel label="With the" value={t.side} options={[{ value: "auto", label: "Best end (auto)" }, { value: "front", label: "Front" }, { value: "back", label: "Back" }]} onChange={(side) => st.updateTask(t.id, { side })} />
          <Sel label="Arrive heading" value={t.approach === "auto" ? "auto" : "set"} options={[{ value: "auto", label: "Auto (try several)" }, { value: "set", label: "I choose…" }]} onChange={(v) => st.updateTask(t.id, { approach: v === "auto" ? "auto" : 0 })} />
          {t.approach !== "auto" && <Num label="Heading" value={t.approach} onChange={(v) => st.updateTask(t.id, { approach: v })} unit="°" hint="Direction the robot travels as it approaches: 0 = up the field, 90 = right, clockwise." />}
          {t.action === "toggle" && <Sel label="Set to" value={t.toggleColor ?? st.routine.alliance} options={[{ value: "red", label: "red" }, { value: "blue", label: "blue" }, { value: "yellow", label: "yellow" }]} onChange={(toggleColor) => st.updateTask(t.id, { toggleColor })} />}
        </div>
      ))}
      {tasks.length > 0 && (
        <div className="btns">
          <button className="primary" disabled={st.planning !== null} onClick={() => { setOpen(true); void st.runPlan(); }}>{st.planning !== null ? `Searching… ${Math.round(st.planning * 100)}%` : "Find 3 fastest routes"}</button>
          {st.planning !== null && <button onClick={st.stopPlan}>Stop</button>}
        </div>
      )}
      {st.planNotes.map((n, i) => <p key={i} className="note">ℹ {n}</p>)}
      {st.planErrors.map((n, i) => <p key={i} className="bad">✖ {n}</p>)}
      {st.plans && st.planning === null && st.planErrors.length === 0 && (
        <>
          {top.length === 0 && failed.length > 0 && <p className="bad">None of the {st.plans.length} routes tried fully worked. The closest are below, with what goes wrong.</p>}
          {(top.length ? top : failed.slice().sort((a, b) => a.problems.length - b.problems.length || a.duration - b.duration).slice(0, 3)).map((c, i) => (
            <div className="card" key={i}>
              <div className="row two"><b>#{i + 1} · {c.duration.toFixed(2)} s{c.ok ? "" : " (needs a fix)"}</b><button className={c.ok ? "primary" : ""} onClick={() => st.applyPlan(c)}>Use this</button></div>
              <p className="note">{c.style} · {c.routine.steps.length} steps · your score {st.scoreOf(c)}</p>
              {c.problems.slice(0, 3).map((p, k) => <p key={k} className="warn">⚠ {p}</p>)}
            </div>
          ))}
        </>
      )}
    </Section>
  );
}
