import { useMemo, useState } from "react";
import { generate, TARGETS, type GenResult } from "../codegen";
import { Badge, Check, IntList, Num, Sel, Section } from "./atoms";
import { download, makeZip } from "./helpers";
import { ident } from "../codegen/common";
import { simulate } from "../core/runtime";
import { worldInit } from "../games/types";
import { useEditor, useStore } from "./store";

const VERIFY: Record<string, string> = {
  lemlib: "Compile-checked in tests against PROS 4.2.2 + LemLib (stable) headers.",
  "ez-template": "Compile-checked in tests inside the EZ-Template 3.2.x example project.",
  "jar-template": "Type-checked in tests against JAR-Template's headers (VEX SDK stubbed) - not built with the real VEXcode SDK.",
  "generic-pros": "Compile-checked against PROS 4.2.2 headers, and its motions are run against a simulated plant in tests.",
};

export function CodePanel() {
  const { routine, robot, ports, target, setTarget, setPorts, recording, routines } = useEditor();
  const [fileIdx, setFileIdx] = useState(0);
  const [copied, setCopied] = useState(false);

  const result: GenResult | { error: string } = useMemo(() => {
    try {
      return generate(target, { routine, cfg: robot, ports, recording: recording ?? undefined });
    } catch (e) {
      return { error: String(e) };
    }
  }, [target, routine, robot, ports, recording]);

  const setTracking = (i: number, patch: object) => setPorts({ tracking: robot.odom.trackingWheels.map((_, j) => ({ ...(ports.tracking[j] ?? { port: 11 + j }), ...(j === i ? patch : {}) })) });

  return (
    <div className="panel-body">
      <Section title="Target library">
        <div className="targets">
          {TARGETS.map((t) => (
            <button key={t.id} className={target === t.id ? "active" : ""} onClick={() => { setTarget(t.id); setFileIdx(0); }} title={t.blurb}>{t.label}</button>
          ))}
        </div>
        <p className="note">{TARGETS.find((t) => t.id === target)?.blurb}</p>
      </Section>

      <Section title="Wiring (ports)" open={false}>
        <IntList label="Left motors" value={ports.left} onChange={(left) => setPorts({ left })} hint="Negative = reversed. All motors must spin the robot forward when driven positive." />
        <IntList label="Right motors" value={ports.right} onChange={(right) => setPorts({ right })} />
        <Num label="IMU port" value={ports.imu} onChange={(imu) => setPorts({ imu })} min={1} max={21} />
        <IntList label="Intake motors" value={ports.intake} onChange={(intake) => setPorts({ intake })} />
        <Sel label="Intake cartridge" value={ports.intakeCartridge} options={[{ value: 100, label: "red" }, { value: 200, label: "green" }, { value: 600, label: "blue" }]} onChange={(v) => setPorts({ intakeCartridge: v })} />
        <label className="row"><span>Clamp ADI port</span><input value={ports.clamp} maxLength={1} onChange={(e) => setPorts({ clamp: e.target.value.toUpperCase().slice(0, 1) || "A" })} /></label>
        <Sel label="Driver control" value={ports.controller} options={[{ value: "arcade", label: "Arcade" }, { value: "tank", label: "Tank" }]} onChange={(v) => setPorts({ controller: v })} />
        {robot.odom.trackingWheels.map((tw, i) => {
          const tp = ports.tracking[i] ?? { port: 11 + i };
          return (
            <div className="card" key={i}>
              <b>Tracking wheel {i + 1} ({tw.axis})</b>
              <Check label="ADI encoder" value={!!tp.adi} onChange={(v) => setTracking(i, { adi: v ? ["C", "D"] : undefined })} />
              {tp.adi ? (
                <label className="row"><span>ADI pair</span><input value={tp.adi.join("")} maxLength={2} onChange={(e) => { const s = e.target.value.toUpperCase(); if (s.length === 2) setTracking(i, { adi: [s[0], s[1]] }); }} /></label>
              ) : (
                <Num label="Smart port" value={Math.abs(tp.port)} onChange={(port) => setTracking(i, { port })} min={1} max={21} />
              )}
              <Check label="Reversed" value={!!tp.reversed} onChange={(reversed) => setTracking(i, { reversed })} />
            </div>
          );
        })}
      </Section>

      {"error" in result ? (
        <p className="bad">Code generation failed: {result.error}</p>
      ) : (
        <>
          <Section title="Notes & warnings" right={<Badge kind={result.warnings.length ? "warn" : "ok"}>{result.warnings.length} warning{result.warnings.length === 1 ? "" : "s"}</Badge>}>
            <p className="note"><b>{result.title}</b> — {result.version}</p>
            <p className="note ok">✔ {VERIFY[result.target]}</p>
            {result.warnings.map((w, i) => <p key={i} className="warn">⚠ {w}</p>)}
            <ul className="notes">{result.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          </Section>
          <Section title="Files" right={
            <span className="btns inline">
              <button onClick={() => { const f = result.files[Math.min(fileIdx, result.files.length - 1)]; void navigator.clipboard?.writeText(f.content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); }}>{copied ? "Copied ✓" : "Copy"}</button>
              <button onClick={() => download(`${routine.name.replace(/\W+/g, "_") || "auton"}_${result.target}.zip`, makeZip(result.files).buffer as ArrayBuffer, "application/zip")}>Download .zip</button>
            </span>
          }>
            {routines.length > 1 && (
              <div className="btns" style={{ marginBottom: 6 }}>
                <button onClick={() => {
                  const st = useStore.getState();
                  const g = st.game();
                  const init = st.customField ? { ...worldInit(g), objects: st.customField.objects, obstacles: st.customField.obstacles } : worldInit(g);
                  const used = new Set<string>();
                  const files: { path: string; content: string }[] = [];
                  for (const r of st.allRoutines()) {
                    let name = ident(r.name) || "auton"; let n = 2; const base = name;
                    while (used.has(name)) name = `${base}_${n++}`;
                    used.add(name);
                    const rec = simulate(r, robot, init, { seed: st.simOpts.seed });
                    const res = generate(target, { routine: r, cfg: robot, ports, recording: rec, fnName: name });
                    for (const f of res.files) files.push({ path: `${name}/${f.path}`, content: f.content });
                  }
                  download(`${ident(st.routine.name) || "project"}_all_${target}.zip`, makeZip(files).buffer as ArrayBuffer, "application/zip");
                }}>Download all {routines.length} routines (.zip)</button>
              </div>
            )}
            <div className="file-tabs">
              {result.files.map((f, i) => <button key={f.path} className={i === Math.min(fileIdx, result.files.length - 1) ? "active" : ""} onClick={() => setFileIdx(i)}>{f.path}</button>)}
            </div>
            <pre className="code">{result.files[Math.min(fileIdx, result.files.length - 1)].content}</pre>
          </Section>
        </>
      )}
    </div>
  );
}
