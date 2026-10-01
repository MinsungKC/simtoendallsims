import { uid, type ActionSpec, type ActionType, type PathMark } from "./routine";

type State = { marks: PathMark[]; actions: ActionSpec[] };

const r1 = (v: number) => Math.round(v * 10) / 10;

export function addMark(s: State, d: number, extra?: Partial<PathMark>): State & { id: string } {
  const id = uid("m");
  const marks = [...s.marks, { id, d: r1(d), ...extra }].sort((a, b) => a.d - b.d);
  return { marks, actions: s.actions, id };
}

/** Move a point along the curve; actions pinned to it follow. */
export function moveMark(s: State, id: string, d: number): State {
  const v = r1(Math.max(0, d));
  return { marks: s.marks.map((m) => (m.id === id ? { ...m, d: v } : m)).sort((a, b) => a.d - b.d), actions: s.actions.map((a) => (a.markId === id ? { ...a, when: { kind: "distance", value: v } } : a)) };
}

export function patchMark(s: State, id: string, patch: Partial<PathMark>): State {
  return { marks: s.marks.map((m) => (m.id === id ? { ...m, ...patch } : m)), actions: s.actions };
}

export function removeMark(s: State, id: string): State {
  return { marks: s.marks.filter((m) => m.id !== id), actions: s.actions.filter((a) => a.markId !== id) };
}

export function addMarkAction(s: State, id: string, type: ActionType, arg?: string): State {
  const m = s.marks.find((x) => x.id === id);
  if (!m) return s;
  return { marks: s.marks, actions: [...s.actions, { id: uid("a"), type, arg, markId: id, when: { kind: "distance", value: m.d } }] };
}
