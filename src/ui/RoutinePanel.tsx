import { defaultMotion, uid, type ActionSpec, type ActionType, type MotionSpec, type Step, type Trigger } from "../core/routine";
import { planPoses } from "../core/common-plan";
import { describeMotion } from "../codegen/common";
import { pathLength } from "../core/path";
import { Check, Num, Sel, Section } from "./atoms";
import { bearingDeg, fmt } from "./helpers";
import { useEditor, type Tool } from "./store";

const MOTION_LABEL: Record<MotionSpec["type"], string> = {
  setPose: "Set pose", moveToPoint: "Move to point", moveToPose: "Move to pose (boomerang)", turnToHeading: "Turn to heading",
  turnToPoint: "Turn to point", swingToHeading: "Swing to heading", follow: "Follow path (pure pursuit)", wait: "Wait",
};

const ACTION_LABEL: Record<ActionType, string> = {
  intakeIn: "Intake in", intakeOut: "Intake out", intakeStop: "Intake stop", clamp: "Clamp", unclamp: "Unclamp", eject: "Eject", place: "Place held object on Goal", toggleSet: "Set Toggle", custom: "Custom code",
};

export const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: "moveToPoint", label: "Drive to", hint: "Click the field to add a drive-to point" },
  { id: "draw", label: "✎ Draw path", hint: "Hold and drag on the field to draw any curve freehand; it is smoothed automatically and the robot's predicted path appears" },
  { id: "follow", label: "Curve (click)", hint: "Click the field to add a smooth curved path" },
  { id: "moveToPose", label: "Drive + end facing", hint: "Click the field to drive there and end at a set heading (boomerang)" },
  { id: "turnToPoint", label: "Face a spot", hint: "Click the field to turn the robot toward that spot" },
  { id: "select", label: "Just select", hint: "Clicking the field adds nothing; drag handles to edit" },
  { id: "objects", label: "Move game pieces", hint: "Drag game objects to change the layout" },
];

export function RoutinePanel() {
  const st = useEditor();
  const { routine, robot, selected, select } = st;
  const game = st.game();
  const planned = planPoses(routine, robot);
  const step = routine.steps.find((s) => s.id === selected) ?? null;
  const idx = step ? routine.steps.indexOf(step) : -1;

  const addByType = (type: MotionSpec["type"]) => {
    const last = planned.after.at(-1) ?? routine.start;
    const m = defaultMotion(type, { x: last.x, y: Math.min(70, last.y + 12), heading: last.heading });
    st.addStep(m);
  };

  return (
    <div className="panel-body">
      <Section title="Start">
        <label className="row">
          <span>Robot starts</span>
          <select value="" onChange={(e) => { const p = game.starts.find((x) => x.label === e.target.value); if (p) st.setRoutine({ start: { x: p.x, y: p.y, heading: p.heading }, alliance: p.alliance }); }}>
            <option value="">{routine.alliance === "red" ? "Red" : "Blue"} · ({fmt(routine.start.x)}, {fmt(routine.start.y)}) facing {fmt(routine.start.heading, 0)}° - pick a preset…</option>
            {game.starts.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
          </select>
        </label>
        <p className="note">Or drag the green <b>S</b> on the field to place the robot, and the small dot to turn it.</p>
        <div className="btns">
          <button onClick={st.mirror} title={st.game().mirror === "rotate" ? "Turn the whole routine 180° about the field center (this field's red and blue sides swap under a rotation)" : "Flip the whole routine across the field's center line"}>{st.game().mirror === "rotate" ? "Copy to other alliance ↻" : "Mirror to other alliance ↔"}</button>
          <button onClick={st.clearRoutine} disabled={!routine.steps.length}>Clear all steps</button>
        </div>
      </Section>

      <Section title={`Steps (${routine.steps.length})`} right={
        <select value="" onChange={(e) => { if (e.target.value) addByType(e.target.value as MotionSpec["type"]); }}>
          <option value="">+ Other step…</option>
          {(Object.keys(MOTION_LABEL) as MotionSpec["type"][]).map((t) => <option key={t} value={t}>{MOTION_LABEL[t]}</option>)}
        </select>
      }>
        {routine.steps.length === 0 && <p className="note">No steps yet. Just click the field where the robot should drive.</p>}
        <ol className="steps">
          {routine.steps.map((s, i) => {
            const t = st.recording?.steps.find((x) => x.index === i);
            return (
              <li key={s.id} className={s.id === selected ? "sel" : ""} onClick={() => select(s.id)}>
                <span className="n">{i + 1}</span>
                <span className="lbl">{describeMotion(s.motion)}</span>
                {s.actions.length > 0 && <span className="chip">{s.actions.length} action{s.actions.length > 1 ? "s" : ""}</span>}
                {t && <span className={`time ${t.timedOut ? "bad" : ""}`}>{(t.end - t.start).toFixed(2)}s{t.timedOut ? " ⚠" : ""}</span>}
                <button className="x" title="Delete step" onClick={(e) => { e.stopPropagation(); st.removeStep(s.id); }}>✕</button>
              </li>
            );
          })}
        </ol>
      </Section>

      {step && (
        <Section title={`Step ${idx + 1}: ${MOTION_LABEL[step.motion.type]}`} right={
          <span className="btns inline">
            <button onClick={() => st.moveStep(step.id, -1)} disabled={idx === 0} title="Move up">↑</button>
            <button onClick={() => st.moveStep(step.id, 1)} disabled={idx === routine.steps.length - 1} title="Move down">↓</button>
            <button onClick={() => st.duplicateStep(step.id)} title="Duplicate">⧉</button>
            <button onClick={() => st.removeStep(step.id)} title="Delete (Del)">🗑</button>
          </span>
        }>
          <MotionEditor step={step} before={planned.before[idx]} />
          <ActionsEditor step={step} />
        </Section>
      )}
      <Section title="More: routines, exact start, name" open={false}>
        <div className="row">
          <select className="wide" value={st.active} onChange={(e) => st.switchRoutine(parseInt(e.target.value, 10))} title="Routines in this project">
            {st.allRoutines().map((r, i) => <option key={i} value={i}>{r.name || `Auton ${i + 1}`} ({r.alliance})</option>)}
          </select>
        </div>
        <div className="btns" style={{ marginTop: 0, marginBottom: 6 }}>
          <button onClick={st.newRoutine}>+ New routine</button>
          <button onClick={st.duplicateRoutine}>Duplicate</button>
          <button onClick={st.deleteRoutine} disabled={st.routines.length <= 1}>Delete</button>
        </div>
        <label className="row"><span>Name</span><input value={routine.name} onChange={(e) => st.setRoutine({ name: e.target.value }, { history: false })} /></label>
        <Sel label="Alliance" value={routine.alliance} options={[{ value: "red", label: "Red" }, { value: "blue", label: "Blue" }]} onChange={(v) => st.setRoutine({ alliance: v })} />
        <Num label="Start X" value={routine.start.x} onChange={(x) => st.setRoutine({ start: { ...routine.start, x } })} step={0.5} unit="in" />
        <Num label="Start Y" value={routine.start.y} onChange={(y) => st.setRoutine({ start: { ...routine.start, y } })} step={0.5} unit="in" />
        <Num label="Start heading" value={routine.start.heading} onChange={(heading) => st.setRoutine({ start: { ...routine.start, heading } })} step={1} unit="°" />
      </Section>
    </div>
  );
}

function MotionEditor({ step, before }: { step: Step; before: { x: number; y: number; heading: number } }) {
  const st = useEditor();
  const m = step.motion;
  const up = (patch: Partial<MotionSpec>) => st.updateMotion(step.id, patch);
  const common = (m: Extract<MotionSpec, { maxSpeed: number }>) => (
    <>
      <Num label="Speed" value={m.maxSpeed} onChange={(v) => up({ maxSpeed: v } as never)} min={1} max={127} hint="0-127 (PROS move units)" />
      <details className="adv"><summary>Advanced</summary>
        <Num label="Min speed" value={m.minSpeed} onChange={(v) => up({ minSpeed: v } as never)} min={0} max={127} hint="Non-zero = don't slow down; use with early exit to chain motions." />
        <Num label="Early exit range" value={m.earlyExit} onChange={(v) => up({ earlyExit: v } as never)} min={0} step={0.5} hint="Exit this far from the target (only used with min speed)." />
      </details>
    </>
  );
  const timeout = (m: { timeout: number }) => <details className="adv"><summary>Timeout</summary><Num label="Timeout" value={m.timeout} onChange={(v) => up({ timeout: v } as never)} step={100} min={100} unit="ms" /></details>;
  switch (m.type) {
    case "setPose":
      return <>
        <Num label="X" value={m.x} onChange={(v) => up({ x: v })} step={0.5} unit="in" />
        <Num label="Y" value={m.y} onChange={(v) => up({ y: v })} step={0.5} unit="in" />
        <Num label="Heading" value={m.heading} onChange={(v) => up({ heading: v })} unit="°" />
        <p className="note">Tells odometry where the robot is. The simulator's robot does not move.</p>
      </>;
    case "moveToPoint":
      return <>
        <Num label="X" value={m.x} onChange={(v) => up({ x: v })} step={0.5} unit="in" />
        <Num label="Y" value={m.y} onChange={(v) => up({ y: v })} step={0.5} unit="in" />
        <Check label="Forwards" value={m.forwards} onChange={(v) => up({ forwards: v })} />
        {common(m)}{timeout(m)}
        <p className="note">Distance from the previous pose: {fmt(Math.hypot(m.x - before.x, m.y - before.y))} in</p>
      </>;
    case "moveToPose":
      return <>
        <Num label="X" value={m.x} onChange={(v) => up({ x: v })} step={0.5} unit="in" />
        <Num label="Y" value={m.y} onChange={(v) => up({ y: v })} step={0.5} unit="in" />
        <Num label="Heading" value={m.heading} onChange={(v) => up({ heading: v })} unit="°" />
        <Check label="Forwards" value={m.forwards} onChange={(v) => up({ forwards: v })} />
        <Num label="Lead" value={m.lead} onChange={(v) => up({ lead: v })} step={0.05} min={0} max={1} hint="Boomerang carrot distance ratio: bigger = wider curve." />
        <Num label="Horizontal drift" value={m.horizontalDrift} onChange={(v) => up({ horizontalDrift: v })} step={0.5} min={0} hint="0 = use the robot's value" />
        {common(m)}{timeout(m)}
        <button onClick={() => up({ heading: Math.round(bearingDeg(before, m)) })}>Face direction of travel</button>
      </>;
    case "turnToHeading":
      return <>
        <Num label="Heading" value={m.heading} onChange={(v) => up({ heading: v })} unit="°" hint="0 = up the field (+Y), clockwise positive" />
        <Sel label="Direction" value={m.direction} options={[{ value: "auto", label: "Shortest" }, { value: "cw", label: "Clockwise" }, { value: "ccw", label: "Counter-clockwise" }]} onChange={(v) => up({ direction: v })} />
        {common(m)}{timeout(m)}
      </>;
    case "turnToPoint":
      return <>
        <Num label="X" value={m.x} onChange={(v) => up({ x: v })} step={0.5} unit="in" />
        <Num label="Y" value={m.y} onChange={(v) => up({ y: v })} step={0.5} unit="in" />
        <Check label="Front faces point" value={m.forwards} onChange={(v) => up({ forwards: v })} />
        {common(m)}{timeout(m)}
      </>;
    case "swingToHeading":
      return <>
        <Num label="Heading" value={m.heading} onChange={(v) => up({ heading: v })} unit="°" />
        <Sel label="Locked side" value={m.lock} options={[{ value: "left", label: "Left side stays" }, { value: "right", label: "Right side stays" }]} onChange={(v) => up({ lock: v })} />
        {common(m)}{timeout(m)}
      </>;
    case "follow": {
      const len = pathLength(m.path);
      return <>
        <Check label="Forwards" value={m.forwards} onChange={(v) => up({ forwards: v })} />
        <Num label="Lookahead" value={m.lookahead} onChange={(v) => up({ lookahead: v })} step={1} min={2} unit="in" hint="Smaller follows the path tighter; larger is faster/looser (10-15 typical)." />
        <Num label="Path max speed" value={m.path.maxSpeed} onChange={(v) => up({ path: { ...m.path, maxSpeed: v } })} min={10} max={127} />
        <Num label="Path min speed" value={m.path.minSpeed} onChange={(v) => up({ path: { ...m.path, minSpeed: v } })} min={5} max={127} />
        <Num label="Decel rate" value={m.path.decel} onChange={(v) => up({ path: { ...m.path, decel: v } })} step={100} min={100} hint="How hard the speed profile brakes toward the end." />
        {timeout(m)}
        <p className="note">Length {fmt(len)} in, {m.path.segments.length} segment(s). Drag the control points on the field.</p>
        <div className="btns">
          <button onClick={() => {
            const last = m.path.segments.at(-1)!.p[3];
            const prev = m.path.segments.at(-1)!.p[2];
            const dx = last.x - prev.x, dy = last.y - prev.y;
            const n = Math.hypot(dx, dy) || 1;
            const seg = { p: [{ ...last }, { x: last.x + (dx / n) * 8, y: last.y + (dy / n) * 8 }, { x: last.x + (dx / n) * 16, y: last.y + (dy / n) * 16 + 8 }, { x: last.x + (dx / n) * 24, y: last.y + (dy / n) * 24 + 12 }] as [typeof last, typeof last, typeof last, typeof last] };
            up({ path: { ...m.path, segments: [...m.path.segments, seg] } });
          }}>+ Segment</button>
          <button disabled={m.path.segments.length < 2} onClick={() => up({ path: { ...m.path, segments: m.path.segments.slice(0, -1) } })}>− Segment</button>
        </div>
      </>;
    }
    case "wait":
      return <Num label="Duration" value={m.ms} onChange={(v) => up({ ms: v })} step={50} min={0} unit="ms" />;
  }
}

function ActionsEditor({ step }: { step: Step }) {
  const st = useEditor();
  const hasIntake = !!st.robot.intake;
  const add = (type: ActionType) => st.addAction(step.id, { id: uid("a"), type, when: { kind: "start" }, code: type === "custom" ? "// your code here" : undefined });
  const isTurn = step.motion.type === "turnToHeading" || step.motion.type === "turnToPoint" || step.motion.type === "swingToHeading";
  const quick: { label: string; type: ActionType; when: Trigger; arg?: string; show: boolean }[] = [
    { label: "Intake on", type: "intakeIn", when: { kind: "start" }, show: hasIntake },
    { label: "Intake off", type: "intakeStop", when: { kind: "end" }, show: hasIntake },
    { label: "Clamp", type: "clamp", when: { kind: "end" }, show: true },
    { label: "Release", type: "unclamp", when: { kind: "end" }, show: true },
    { label: "Place on goal", type: "place", when: { kind: "end" }, show: !!st.game().goals?.length },
    { label: "Flip toggle", type: "toggleSet", when: { kind: "end" }, arg: st.routine.alliance, show: !!st.game().toggles?.length },
  ];
  return (
    <div className="actions">
      <h4>Do something here</h4>
      <div className="chips">
        {quick.filter((q) => q.show).map((q) => <button key={q.label} onClick={() => st.addAction(step.id, { id: uid("a"), type: q.type, when: q.when, arg: q.arg })}>{q.label}</button>)}
      </div>
      {step.actions.length > 0 && <ul className="done">{step.actions.map((a) => <li key={a.id}>{ACTION_LABEL[a.type]}{a.type === "toggleSet" ? ` → ${a.arg ?? "red"}` : ""} <i>{a.when.kind === "start" ? "at start" : a.when.kind === "end" ? "when done" : a.when.kind === "distance" ? `after ${a.when.value}` : `after ${a.when.ms} ms`}</i><button className="x" onClick={() => st.removeAction(step.id, a.id)}>✕</button></li>)}</ul>}
      <details className="adv"><summary>Edit timing / custom code</summary>
      <h4>Actions <select value="" onChange={(e) => { if (e.target.value) add(e.target.value as ActionType); }}>
        <option value="">+ Add action…</option>
        {(Object.keys(ACTION_LABEL) as ActionType[]).map((t) => <option key={t} value={t}>{ACTION_LABEL[t]}</option>)}
      </select></h4>
      {step.actions.length === 0 && <p className="note">Mechanism actions run at the start, at a distance into the move, after a delay, or at the end.</p>}
      {step.actions.map((a) => (
        <div className="card" key={a.id}>
          <div className="row two">
            <select value={a.type} onChange={(e) => st.updateAction(step.id, a.id, { type: e.target.value as ActionType })}>
              {(Object.keys(ACTION_LABEL) as ActionType[]).map((t) => <option key={t} value={t}>{ACTION_LABEL[t]}</option>)}
            </select>
            <button onClick={() => st.removeAction(step.id, a.id)}>✕</button>
          </div>
          <TriggerEditor trigger={a.when} isTurn={isTurn} onChange={(when) => st.updateAction(step.id, a.id, { when })} />
          {a.type === "place" && <Sel label="Prefer" value={a.arg ?? "any"} options={[{ value: "any", label: "whichever fits" }, { value: "pin", label: "Pin first" }, { value: "cup", label: "Cup first" }]} onChange={(v) => st.updateAction(step.id, a.id, { arg: v })} />}
          {a.type === "toggleSet" && <Sel label="Set to" value={a.arg ?? "red"} options={[{ value: "red", label: "red" }, { value: "blue", label: "blue" }, { value: "yellow", label: "yellow (neutral)" }]} onChange={(v) => st.updateAction(step.id, a.id, { arg: v })} />}
          {a.type === "custom" && <textarea rows={3} value={a.code ?? ""} onChange={(e) => st.updateAction(step.id, a.id, { code: e.target.value })} />}
          {(a.type === "intakeIn" || a.type === "intakeOut" || a.type === "intakeStop" || a.type === "eject") && !hasIntake && <p className="bad">No intake configured on the robot.</p>}
        </div>
      ))}
      </details>
    </div>
  );
}

function TriggerEditor({ trigger, isTurn, onChange }: { trigger: Trigger; isTurn: boolean; onChange: (t: Trigger) => void }) {
  return (
    <>
      <Sel label="When" value={trigger.kind} options={[{ value: "start", label: "At start of step" }, { value: "distance", label: isTurn ? "After turning…" : "After traveling…" }, { value: "delay", label: "After a delay…" }, { value: "end", label: "After step finishes" }]}
        onChange={(k) => onChange(k === "distance" ? { kind: "distance", value: 12 } : k === "delay" ? { kind: "delay", ms: 300 } : ({ kind: k } as Trigger))} />
      {trigger.kind === "distance" && <Num label="Distance" value={trigger.value} onChange={(v) => onChange({ kind: "distance", value: v })} step={1} min={0} unit={isTurn ? "°" : "in"} />}
      {trigger.kind === "delay" && <Num label="Delay" value={trigger.ms} onChange={(v) => onChange({ kind: "delay", ms: v })} step={50} min={0} unit="ms" />}
    </>
  );
}

export type { ActionSpec };
