import { useState } from "react";
import { games } from "../games";
import type { CustomField } from "../games/types";
import { Badge, Num, Section } from "./atoms";
import { download } from "./helpers";
import { useEditor } from "./store";

export function FieldPanel() {
  const st = useEditor();
  const game = st.game();
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const exportField = () => {
    const f: CustomField = st.customField ?? { objects: game.objects, obstacles: game.obstacles, zones: game.zones };
    download(`${game.id}-field.json`, JSON.stringify(f, null, 1), "application/json");
  };
  const importField = (json: string) => {
    try {
      const f = JSON.parse(json) as CustomField;
      if (!Array.isArray(f.objects) || !Array.isArray(f.obstacles) || !Array.isArray(f.zones)) throw new Error("expected {objects, obstacles, zones} arrays");
      const ids = new Set<number>();
      for (const o of f.objects) {
        if (typeof o.id !== "number" || typeof o.x !== "number" || typeof o.y !== "number" || typeof o.r !== "number" || typeof o.mass !== "number") throw new Error("each object needs numeric id, x, y, r, mass");
        if (ids.has(o.id)) throw new Error(`duplicate object id ${o.id}`);
        ids.add(o.id);
      }
      st.setCustomField({ objects: f.objects.map((o) => ({ ...o, drag: o.drag ?? 45, team: o.team ?? "neutral", kind: o.kind ?? "object" })), obstacles: f.obstacles, zones: f.zones });
      setMsg("Custom field loaded.");
    } catch (e) {
      setMsg(`Could not load field: ${String(e)}`);
    }
  };

  const rules = game.robotRules;
  return (
    <div className="panel-body">
      <Section title="Game">
        <select className="wide" value={game.id} onChange={(e) => st.setGame(e.target.value)}>
          {games.map((g) => <option key={g.id} value={g.id}>{g.name}{g.season !== "-" ? ` (${g.season})` : ""}</option>)}
        </select>
        <div className="kv"><span>Field</span><b>{game.fieldSize.value}" square</b>{game.fieldSize.verified ? <Badge kind="ok">verified</Badge> : <Badge kind="warn">unverified</Badge>}</div>
        <div className="kv"><span>Auton</span><b>{game.autonSeconds.value} s</b>{game.autonSeconds.verified ? <Badge kind="ok">verified</Badge> : <Badge kind="warn">unverified</Badge>}</div>
        <div className="kv"><span>Driver</span><b>{game.driverSeconds.value} s</b>{game.driverSeconds.verified ? <Badge kind="ok">verified</Badge> : <Badge kind="warn">unverified</Badge>}</div>
        <div className="kv"><span>Motor caps</span><b>{rules.totalCapW} W{rules.drivetrainCapW !== null ? ` / ${rules.drivetrainCapW} W drive` : ""}</b>{rules.verified ? <Badge kind="ok">verified</Badge> : <Badge kind="warn">unverified</Badge>}</div>
        {game.manualVersion && <p className="note">Manual: {game.manualVersion}</p>}
        {game.layoutApproximate && <p className="warn">⚠ Object layout and scoring are an approximate practice layout, not taken from the official manual. Use Edit field or import a corrected JSON.</p>}
        {game.notes.map((n, i) => <p key={i} className="note">{n}</p>)}
      </Section>

      <Section title="Score (simulated)">
        {st.recording ? (() => {
          const w = st.recording.world;
          const sc = (st.customField && st.customField.zones.length ? null : game.score(w));
          return sc ? (
            <>
              <div className="kv"><span>Red</span><b style={{ color: "#e5484d" }}>{sc.red}</b><span>Blue</span><b style={{ color: "#3e8bff" }}>{sc.blue}</b></div>
              {sc.lines.map((l) => <div key={l.label} className="kv"><span>{l.label}</span><b>{l.red} / {l.blue}</b></div>)}
              {sc.notes?.map((n, i) => <p key={i} className="note">{n}</p>)}
              <p className="note">Counts objects resting in scoring zones at the end of the run. Bonuses, control zones and park are not modelled.</p>
            </>
          ) : <p className="note">Score for custom fields is shown in the top bar.</p>;
        })() : <p className="note">Run the simulation to see the score.</p>}
      </Section>

      {game.provenance && (
        <Section title="Where the field data comes from" open={false}>
          {game.provenance.map((p, i) => (
            <div key={i} className="kv">
              <Badge kind={p.confidence === "manual" ? "ok" : p.confidence === "community" ? "info" : "warn"}>{p.confidence}</Badge>
              <span style={{ flex: 1 }}>{p.item} - <em>{p.source}</em></span>
            </div>
          ))}
        </Section>
      )}

      <Section title="Field layout (custom JSON)">
        <p className="note">Objects: {(st.customField?.objects ?? game.objects).length} · Obstacles: {(st.customField?.obstacles ?? game.obstacles).length} · Zones: {(st.customField?.zones ?? game.zones).length} {st.customField && <Badge kind="info">custom</Badge>}</p>
        <div className="btns">
          <button onClick={exportField}>Export JSON</button>
          <button onClick={() => st.setCustomField(null)} disabled={!st.customField}>Reset to game default</button>
        </div>
        <textarea rows={6} placeholder='Paste field JSON: {"objects":[{"id":1,"kind":"ring","team":"red","x":0,"y":0,"r":3.5,"mass":0.06}],"obstacles":[{"x":0,"y":0,"w":10,"h":2,"label":"barrier"}],"zones":[]}' value={text} onChange={(e) => setText(e.target.value)} />
        <div className="btns"><button onClick={() => importField(text)} disabled={!text.trim()}>Load pasted JSON</button></div>
        {msg && <p className="note">{msg}</p>}
      </Section>

      <Section title="Simulation options" open={false}>
        <Num label="Random seed" value={st.simOpts.seed} onChange={(seed) => st.setSimOpts({ seed: Math.round(seed) })} step={1} hint="Changes sensor noise / IMU drift direction." />
        <p className="note">Placement error: the robot really starts here, but code assumes the exact start pose. Use it to test how sensitive your auton is to sloppy setup.</p>
        <Num label="Placement X" value={st.simOpts.placementError.x} onChange={(x) => st.setSimOpts({ placementError: { ...st.simOpts.placementError, x } })} step={0.25} unit="in" />
        <Num label="Placement Y" value={st.simOpts.placementError.y} onChange={(y) => st.setSimOpts({ placementError: { ...st.simOpts.placementError, y } })} step={0.25} unit="in" />
        <Num label="Placement heading" value={st.simOpts.placementError.heading} onChange={(heading) => st.setSimOpts({ placementError: { ...st.simOpts.placementError, heading } })} step={0.5} unit="°" />
      </Section>
    </div>
  );
}
