import { useState } from "react";
import { Check, Num, Section, Sel } from "./atoms";
import { useEditor } from "./store";
import { topThree } from "../core/planner";

const EXTRA: { label: string; type: import("../core/routine").ActionType; when: "start" | "end"; arg?: string }[] = [
  { label: "Front intake on", type: "intakeIn", when: "start" }, { label: "Intake off", type: "intakeStop", when: "end" },
  { label: "Rear intake on", type: "rearIntakeIn", when: "start" }, { label: "Clamp", type: "clamp", when: "end" }, { label: "Release", type: "unclamp", when: "end" }, { label: "Place", type: "place", when: "end" },
];

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
      {tasks.length === 0 && <p className="note">Choose <b>🎯 Pick targets</b> in the toolbar, then click goals, pieces or toggles - or empty field for a waypoint - in the order you want to visit them (drag waypoints to move them). Then pick how to arrive and what to do, and get the 3 fastest routes that work.</p>}
      {tasks.map((t, i) => (
        <div className="card" key={t.id}>
          <div className="row two"><b>{i + 1}. {t.label}</b>
            <span className="btns inline"><button disabled={i === 0} onClick={() => st.moveTask(t.id, -1)}>↑</button><button disabled={i === tasks.length - 1} onClick={() => st.moveTask(t.id, 1)}>↓</button><button onClick={() => st.removeTask(t.id)}>✕</button></span>
          </div>
          {t.targetKind !== "point" && <Sel label="Do" value={t.action} options={(Object.keys(ACTION_LABEL) as (keyof typeof ACTION_LABEL)[]).map((v) => ({ value: v, label: ACTION_LABEL[v] }))} onChange={(action) => st.updateTask(t.id, { action })} />}
          <Sel label={t.targetKind === "point" ? "Leads with" : "With the"} value={t.side} options={[{ value: "auto", label: t.targetKind === "point" ? "Front" : "Best end (auto)" }, { value: "front", label: "Front" }, { value: "back", label: "Back" }]} onChange={(side) => st.updateTask(t.id, { side })} />
          <Sel label={t.targetKind === "point" ? "Heading there" : "Arrive heading"} value={t.approach === "auto" ? "auto" : "set"} options={[{ value: "auto", label: t.targetKind === "point" ? "Direction of travel" : "Auto (try several)" }, { value: "set", label: "I choose…" }]} onChange={(v) => st.updateTask(t.id, { approach: v === "auto" ? "auto" : 0 })} />
          {t.approach !== "auto" && <Num label="Heading" value={t.approach} onChange={(v) => st.updateTask(t.id, { approach: v })} unit="°" hint="Direction the robot points/travels here: 0 = up the field, 90 = right, clockwise." />}
          <Num label="Speed" value={t.speed ?? 127} onChange={(v) => st.updateTask(t.id, { speed: v })} min={10} max={127} hint="0-127 for the leg into this stop" />
          <Check label="Drive through (don't stop)" value={!!t.pass} onChange={(pass) => st.updateTask(t.id, { pass })} />
          {t.targetKind === "point" && <><Num label="X" value={t.x} onChange={(x) => st.updateTask(t.id, { x })} step={0.5} unit="in" /><Num label="Y" value={t.y} onChange={(y) => st.updateTask(t.id, { y })} step={0.5} unit="in" /></>}
          {t.action === "toggle" && <Sel label="Set to" value={t.toggleColor ?? st.routine.alliance} options={[{ value: "red", label: "red" }, { value: "blue", label: "blue" }, { value: "yellow", label: "yellow" }]} onChange={(toggleColor) => st.updateTask(t.id, { toggleColor })} />}
          <div className="chips">
            {EXTRA.map((e) => <button key={e.label} onClick={() => st.updateTask(t.id, { extra: [...(t.extra ?? []), { type: e.type, when: e.when, arg: e.arg }] })}>+ {e.label}</button>)}
          </div>
          {(t.extra ?? []).length > 0 && <ul className="done">{t.extra!.map((e, k) => <li key={k}>{e.type} <i>{e.when === "start" ? "on arrival at the leg start" : "when done"}</i><button className="x" onClick={() => st.updateTask(t.id, { extra: t.extra!.filter((_, j) => j !== k) })}>✕</button></li>)}</ul>}
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
