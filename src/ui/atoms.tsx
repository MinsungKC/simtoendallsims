import { useEffect, useState, type ReactNode } from "react";

export function Num({ label, value, onChange, step = 1, min, max, unit, hint }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; unit?: string; hint?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { if (parseFloat(text) !== value) setText(String(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="row" title={hint}>
      <span>{label}</span>
      <span className="input-unit">
        <input
          type="number"
          value={text}
          step={step}
          min={min}
          max={max}
          onChange={(e) => {
            setText(e.target.value);
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v) && (min === undefined || v >= min) && (max === undefined || v <= max)) onChange(v);
          }}
        />
        {unit && <em>{unit}</em>}
      </span>
    </label>
  );
}

export function Sel<T extends string | number>({ label, value, options, onChange, hint }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; hint?: string }) {
  return (
    <label className="row" title={hint}>
      <span>{label}</span>
      <select value={String(value)} onChange={(e) => { const o = options.find((x) => String(x.value) === e.target.value); if (o) onChange(o.value); }}>
        {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function Check({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="row check" title={hint}>
      <span>{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Section({ title, children, open = true, right }: { title: string; children: ReactNode; open?: boolean; right?: ReactNode }) {
  const [o, setO] = useState(open);
  return (
    <section className="section">
      <header onClick={() => setO(!o)}>
        <span className="chev">{o ? "▾" : "▸"}</span>
        <h3>{title}</h3>
        <span className="grow" />
        {right && <span onClick={(e) => e.stopPropagation()}>{right}</span>}
      </header>
      {o && <div className="body">{children}</div>}
    </section>
  );
}

export function Badge({ kind, children }: { kind: "ok" | "warn" | "bad" | "info"; children: ReactNode }) {
  return <span className={`badge ${kind}`}>{children}</span>;
}

/** Comma separated integer list editor (motor/port lists) */
export function IntList({ label, value, onChange, hint }: { label: string; value: number[]; onChange: (v: number[]) => void; hint?: string }) {
  const [text, setText] = useState(value.join(", "));
  useEffect(() => { if (text.split(",").map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n)).join(",") !== value.join(",")) setText(value.join(", ")); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="row" title={hint}>
      <span>{label}</span>
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const nums = e.target.value.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n));
          onChange(nums);
        }}
      />
    </label>
  );
}
