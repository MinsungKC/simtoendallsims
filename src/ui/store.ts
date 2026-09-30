import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { defaultRobot, type RobotConfig } from "../core/robot";
import { defaultMotion, emptyRoutine, mirrorRoutine, rotateRoutine, uid, type ActionSpec, type MotionSpec, type Routine, type Step } from "../core/routine";
import { simulate, type Recording } from "../core/runtime";
import { games } from "../games";
import { worldInit, type CustomField, type GameModule } from "../games/types";
import { defaultPorts, type Ports, type TargetId } from "../codegen";
import type { CodeFrame } from "../core/frame";
import { optimizeTimeouts as optimizeTimeoutsCore } from "../core/tune";
import { fixRoute } from "../core/fixroute";
import { DEFAULT_AVOID, avoidList, repairRoutine, routeHits, type AvoidSettings } from "../core/repair";
import { toStraightLines } from "../core/simple";
import { planRoutes, prepareTasks, type PlanCandidate, type PlanTask } from "../core/planner";

export interface Overlays { plan: boolean; trail: boolean; odom: boolean; footprints: boolean; dots: boolean; zones: boolean; tape: boolean; pieces: boolean }
export const OVERLAY_LABELS: Record<keyof Overlays, string> = {
  plan: "Planned route (dashed)", trail: "Simulated path", odom: "Odometry estimate", footprints: "Robot outlines along the path",
  dots: "Numbered step dots (all steps)", zones: "Pickup zones on the robot", tape: "Field tape & lines", pieces: "Game pieces",
};
const OVERLAY_KEY = "simtoendallsims:overlays";
export function loadOverlays(): Overlays {
  const d: Overlays = { plan: true, trail: true, odom: false, footprints: false, dots: true, zones: true, tape: true, pieces: true };
  try { return { ...d, ...(JSON.parse(localStorage.getItem(OVERLAY_KEY) ?? "{}") as Partial<Overlays>) }; } catch { return d; }
}

export type Tool = "select" | "draw" | "targets" | "moveToPoint" | "moveToPose" | "turnToPoint" | "follow" | "objects";
export type Tab = "robot" | "routine" | "code" | "field";

interface Snapshot { robot: RobotConfig; ports: Ports; routine: Routine }

export interface SimOptions {
  seed: number;
  placementError: { x: number; y: number; heading: number };
}

interface Store {
  robot: RobotConfig;
  ports: Ports;
  routine: Routine;
  /** Snapshots of every routine in the project; the entry at `active` is stale until synced (see allRoutines) */
  routines: Routine[];
  active: number;
  gameId: string;
  customField: CustomField | null;
  target: TargetId;
  codeFrame: CodeFrame;
  simOpts: SimOptions;

  selected: string | null;
  tool: Tool;
  tab: Tab;
  recording: Recording | null;
  simMs: number;
  time: number;
  playing: boolean;
  speed: number;

  past: Snapshot[];
  future: Snapshot[];

  game: () => GameModule;
  setTab: (t: Tab) => void;
  setTool: (t: Tool) => void;
  select: (id: string | null) => void;

  /** Take an undo snapshot (call once at the start of a drag or before a discrete edit). */
  snapshot: () => void;
  undo: () => void;
  redo: () => void;

  setRobot: (patch: Partial<RobotConfig>, opts?: { history?: boolean }) => void;
  replaceRobot: (r: RobotConfig) => void;
  setPorts: (patch: Partial<Ports>) => void;
  setRoutine: (patch: Partial<Routine>, opts?: { history?: boolean }) => void;
  setGame: (id: string) => void;
  setTarget: (t: TargetId) => void;
  setCodeFrame: (f: CodeFrame) => void;
  tasks: PlanTask[];
  plans: PlanCandidate[] | null;
  planNotes: string[];
  planErrors: string[];
  planning: number | null;
  addTask: (t: Omit<PlanTask, "id">) => void;
  updateTask: (id: string, patch: Partial<PlanTask>) => void;
  removeTask: (id: string) => void;
  moveTask: (id: string, d: number) => void;
  clearTasks: () => void;
  runPlan: () => Promise<void>;
  stopPlan: () => void;
  applyPlan: (c: PlanCandidate) => void;
  scoreOf: (c: PlanCandidate) => string;
  simple: boolean;
  setSimple: (v: boolean) => void;
  avoid: AvoidSettings;
  setAvoid: (patch: Partial<AvoidSettings>) => void;
  fixPath: (only?: string) => string;
  fixBySim: () => Promise<string>;
  overlays: Overlays;
  setOverlay: (k: keyof Overlays, v: boolean) => void;
  optimizeTimeouts: () => void;
  drawReverse: boolean;
  setDrawReverse: (v: boolean) => void;
  addSteps: (motions: MotionSpec[]) => string | null;
  setSimOpts: (patch: Partial<SimOptions>) => void;
  setCustomField: (f: CustomField | null) => void;

  addStep: (motion: MotionSpec, at?: number) => string;
  updateMotion: (id: string, patch: Partial<MotionSpec>, opts?: { history?: boolean }) => void;
  replaceMotion: (id: string, motion: MotionSpec) => void;
  removeStep: (id: string) => void;
  moveStep: (id: string, delta: number) => void;
  duplicateStep: (id: string) => void;
  addAction: (stepId: string, action: ActionSpec) => void;
  updateAction: (stepId: string, actionId: string, patch: Partial<ActionSpec>) => void;
  removeAction: (stepId: string, actionId: string) => void;
  mirror: () => void;
  clearRoutine: () => void;
  allRoutines: () => Routine[];
  switchRoutine: (i: number) => void;
  newRoutine: () => void;
  duplicateRoutine: () => void;
  deleteRoutine: () => void;
  loadProject: (p: ProjectFile) => void;

  runSim: () => void;
  setTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
}

export interface ProjectFile {
  app: "simtoendallsims";
  version: 1;
  robot: RobotConfig;
  ports: Ports;
  routine: Routine;
  /** Optional: all routines in the project (older files only have `routine`) */
  routines?: Routine[];
  active?: number;
  gameId: string;
  customField: CustomField | null;
  target: TargetId;
  codeFrame?: CodeFrame;
  simOpts: SimOptions;
}

const KEY = "simtoendallsims:project:v1";

function initial(): Pick<Store, "robot" | "ports" | "routine" | "routines" | "active" | "gameId" | "customField" | "target" | "codeFrame" | "simOpts"> {
  const robot = defaultRobot();
  const demo = demoRoutine();
  const base = {
    robot,
    ports: defaultPorts(robot),
    routine: demo,
    routines: [demo],
    active: 0,
    gameId: "high-stakes",
    customField: null as CustomField | null,
    target: "lemlib" as TargetId,
    codeFrame: "start" as CodeFrame,
    simOpts: { seed: 1, placementError: { x: 0, y: 0, heading: 0 } },
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<ProjectFile>;
      if (p.app === "simtoendallsims" && p.robot && p.routine) {
        const r = { ...defaultRobot(), ...p.robot, odom: { ...defaultRobot().odom, ...p.robot.odom } };
        const list = p.routines && p.routines.length ? p.routines : [p.routine];
        const active = Math.min(Math.max(0, p.active ?? 0), list.length - 1);
        return {
          robot: r,
          ports: { ...defaultPorts(r), ...(p.ports ?? {}) },
          routine: list[active],
          routines: list,
          active,
          gameId: p.gameId ?? base.gameId,
          customField: p.customField ?? null,
          target: p.target ?? base.target,
          codeFrame: p.codeFrame ?? base.codeFrame,
          simOpts: { ...base.simOpts, ...(p.simOpts ?? {}) },
        };
      }
    }
  } catch {
    /* storage unavailable or corrupt: fall back to defaults */
  }
  return base;
}

/**
 * A short Override auton that uses the real mechanics (red side, West quadrant): grab the outer Cup of the wall triple,
 * stack it over the yellow Pin already Placed in the short West Goal, nest the Preload Pin in the Cup, then back up to the
 * West wall and flip that Toggle to your color so the yellow Pin halves in this Quadrant are Owned.
 */
export function overrideDemo(alliance: "red" | "blue" = "red"): Routine {
  const at = (x: number, y: number, heading = 0) => ({ x, y, heading });
  const mv = (type: MotionSpec["type"], p: { x: number; y: number; heading: number }, patch: object = {}) => ({ ...defaultMotion(type, p), ...patch }) as MotionSpec;
  const a = (type: ActionSpec["type"], when: ActionSpec["when"], arg?: string): ActionSpec => ({ id: uid("a"), type, when, arg });
  const r: Routine = {
    name: "Override demo",
    gameId: "override",
    alliance: "red",
    start: at(-64.5, 38, 180),
    steps: [
      { id: uid(), motion: mv("moveToPoint", at(-64.5, 30), { timeout: 3000 }), actions: [a("intakeIn", { kind: "start" })] },
      { id: uid(), motion: mv("moveToPoint", at(-58, 27), { forwards: false, timeout: 3000 }), actions: [a("intakeStop", { kind: "end" })] },
      { id: uid(), motion: mv("turnToHeading", at(0, 0, 90)), actions: [a("place", { kind: "end" }, "cup"), a("place", { kind: "end" }, "pin")] },
      { id: uid(), motion: mv("moveToPoint", at(-65, 8), { forwards: false, timeout: 3000 }), actions: [] },
      { id: uid(), motion: mv("turnToHeading", at(0, 0, 270)), actions: [a("toggleSet", { kind: "end" }, alliance)] },
    ],
  };
  return alliance === "red" ? r : rotateRoutine(r);
}

export function demoRoutine(): Routine {
  const at = (x: number, y: number, heading = 0) => ({ x, y, heading });
  const mv = (type: MotionSpec["type"], p: { x: number; y: number; heading: number }, patch: object = {}) => ({ ...defaultMotion(type, p), ...patch }) as MotionSpec;
  return {
    name: "Demo auton",
    gameId: "high-stakes",
    alliance: "red",
    start: at(-48, -56, 0),
    steps: [
      { id: uid(), motion: mv("moveToPoint", at(-48, -30), { maxSpeed: 110 }), actions: [{ id: uid(), type: "intakeIn", when: { kind: "start" } }] },
      { id: uid(), motion: mv("turnToHeading", at(0, 0, 90)), actions: [] },
      { id: uid(), motion: mv("moveToPose", at(-24, -24, 135), { forwards: false }), actions: [{ id: uid(), type: "clamp", when: { kind: "distance", value: 14 } }] },
    ],
  };
}

const syncedRoutines = (s: Pick<Store, "routines" | "routine" | "active">): Routine[] => s.routines.map((r, i) => (i === s.active ? s.routine : r));

const persist = (s: Store): void => {
  try {
    const p: ProjectFile = { app: "simtoendallsims", version: 1, robot: s.robot, ports: s.ports, routine: s.routine, routines: syncedRoutines(s), active: s.active, gameId: s.gameId, customField: s.customField, target: s.target, codeFrame: s.codeFrame, simOpts: s.simOpts };
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
};

let stopFlag = false;
let simTimer: ReturnType<typeof setTimeout> | null = null;

export const useStore = create<Store>((set, get) => {
  const init = initial();
  const snap = (): Snapshot => ({ robot: get().robot, ports: get().ports, routine: get().routine });
  const pushHistory = () => set((s) => ({ past: [...s.past.slice(-49), { robot: s.robot, ports: s.ports, routine: s.routine }], future: [] }));
  const changed = () => {
    persist(get());
    if (simTimer) clearTimeout(simTimer);
    simTimer = setTimeout(() => get().runSim(), 120);
  };
  const editStep = (id: string, f: (s: Step) => Step, history = true) => {
    if (history) pushHistory();
    set((s) => ({ routine: { ...s.routine, steps: s.routine.steps.map((st) => (st.id === id ? f(st) : st)) } }));
    changed();
  };

  return {
    ...init,
    selected: null,
    tool: "moveToPoint",
    tab: "routine",
    recording: null,
    simMs: 0,
    time: 0,
    playing: false,
    speed: 1,
    past: [],
    future: [],

    game: () => games.find((g) => g.id === get().gameId) ?? games[games.length - 1],
    setTab: (tab) => set({ tab }),
    setTool: (tool) => set({ tool }),
    select: (selected) => set({ selected }),

    snapshot: pushHistory,
    undo: () => {
      const { past } = get();
      if (!past.length) return;
      const prev = past[past.length - 1];
      set((s) => ({ ...prev, past: past.slice(0, -1), future: [snap(), ...s.future] }));
      changed();
    },
    redo: () => {
      const { future } = get();
      if (!future.length) return;
      const next = future[0];
      set((s) => ({ ...next, future: future.slice(1), past: [...s.past, snap()] }));
      changed();
    },

    setRobot: (patch, opts) => {
      if (opts?.history !== false) pushHistory();
      set((s) => ({ robot: { ...s.robot, ...patch } }));
      changed();
    },
    replaceRobot: (robot) => {
      pushHistory();
      set({ robot, ports: defaultPorts(robot) });
      changed();
    },
    setPorts: (patch) => {
      set((s) => ({ ports: { ...s.ports, ...patch } }));
      changed();
    },
    setRoutine: (patch, opts) => {
      if (opts?.history !== false) pushHistory();
      set((s) => ({ routine: { ...s.routine, ...patch } }));
      changed();
    },
    setGame: (gameId) => {
      const g = games.find((x) => x.id === gameId) ?? games[0];
      const first = g.starts.find((s) => s.alliance === get().routine.alliance) ?? g.starts[0];
      const cur = get().routine;
      const isDefault = cur.steps.length === 0 || cur.name === "Demo auton";
      if (gameId === "override" && isDefault) {
        pushHistory();
        set({ gameId, customField: null, routine: overrideDemo("red"), selected: null });
      } else {
        set((s) => ({ gameId, customField: null, routine: { ...s.routine, gameId, start: first ? { x: first.x, y: first.y, heading: first.heading } : s.routine.start } }));
      }
      changed();
    },
    setTarget: (target) => { set({ target }); persist(get()); },
    tasks: [],
    plans: null,
    planNotes: [],
    planErrors: [],
    planning: null,
    addTask: (t) => set((s) => ({ tasks: [...s.tasks, { ...t, id: uid("t") }], plans: null })),
    updateTask: (id, patch) => set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)), plans: null })),
    removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id), plans: null })),
    moveTask: (id, d) => set((s) => { const a = s.tasks.slice(); const i = a.findIndex((t) => t.id === id); const j = i + d; if (i < 0 || j < 0 || j >= a.length) return {}; [a[i], a[j]] = [a[j], a[i]]; return { tasks: a, plans: null }; }),
    clearTasks: () => set({ tasks: [], plans: null }),
    runPlan: async () => {
      const s = get();
      if (!s.tasks.length || s.planning !== null) return;
      const g = s.game();
      const init = worldInit(g, s.routine.alliance);
      const world = s.customField ? { ...init, objects: [...s.customField.objects, ...init.objects.filter((o) => o.held)], obstacles: s.customField.obstacles } : init;
      stopFlag = false;
      const base = { ...s.routine, steps: [] };
      const prep = prepareTasks({ tasks: s.tasks, game: g, world, cfg: s.robot, routine: base });
      set({ planning: 0, plans: null, planNotes: prep.notes, planErrors: prep.errors });
      if (prep.errors.length) { set({ plans: [], planning: null }); return; }
      const plans = await planRoutes({
        routine: base, tasks: prep.tasks, cfg: s.robot, game: g, world, obstacles: world.obstacles, seed: s.simOpts.seed, simple: s.simple,
        onProgress: (p) => set({ planning: p }), shouldStop: () => stopFlag,
      });
      set({ plans, planning: null });
    },
    stopPlan: () => { stopFlag = true; },
    applyPlan: (c) => {
      pushHistory();
      set((s) => ({ routine: { ...s.routine, steps: c.routine.steps }, selected: null, time: 0 }));
      changed();
    },
    scoreOf: (c) => { const g = get().game(); const sc = g.score(c.recording.world); return get().routine.alliance === "red" ? String(sc.red) : String(sc.blue); },
    simple: (() => { try { return localStorage.getItem("simtoendallsims:simple") === "1"; } catch { return false; } })(),
    setSimple: (simple) => {
      try { localStorage.setItem("simtoendallsims:simple", simple ? "1" : "0"); } catch { /* ignore */ }
      if (simple) { pushHistory(); set((s) => ({ simple, routine: toStraightLines(s.routine, s.robot), tool: s.tool === "select" || s.tool === "targets" || s.tool === "draw" ? s.tool : "draw", selected: null })); changed(); }
      else set({ simple });
    },
    avoid: DEFAULT_AVOID,
    setAvoid: (patch) => set((s) => ({ avoid: { ...s.avoid, ...patch } })),
    fixBySim: async () => {
      const s = get();
      const g = s.game();
      const init = worldInit(g, s.routine.alliance);
      const world = s.customField ? { ...init, objects: [...s.customField.objects, ...init.objects.filter((o) => o.held)], obstacles: s.customField.obstacles } : init;
      const res = await fixRoute({ routine: s.routine, cfg: s.robot, avoid: s.avoid, fieldSize: init.fieldSize, sim: (r) => simulate(r, s.robot, world, { seed: s.simOpts.seed }), obstacles: world.obstacles, pieces: world.objects as never });
      const changedAny = JSON.stringify(res.routine.steps) !== JSON.stringify(s.routine.steps);
      if (changedAny) {
        pushHistory();
        set({ routine: s.simple ? toStraightLines(res.routine, s.robot) : res.routine });
        changed();
      }
      const moved = res.reports.filter((r) => r.label !== "as drawn").length;
      const bits: string[] = [];
      if (moved) bits.push(`Re-planned ${moved} step${moved === 1 ? "" : "s"} to reach their targets faster/safer (${[...new Set(res.reports.filter((r) => r.label !== "as drawn").map((r) => r.label))].join(", ")}).`);
      bits.push(...res.notes);
      if (res.reachedAll && !res.notes.length) bits.push(`Every step now reaches its target (checked in the simulation). Total ${res.duration.toFixed(1)} s.`);
      return bits.join(" ");
    },
    fixPath: (only) => {
      const s = get();
      const g = s.game();
      const init = worldInit(g, s.routine.alliance);
      const obst = s.customField ? s.customField.obstacles : g.obstacles;
      const objs = s.customField ? s.customField.objects : g.objects;
      const list = avoidList(obst, objs, s.avoid, s.routine, s.robot);
      const { routine, changed: n } = repairRoutine(s.routine, s.robot, list, s.avoid, init.fieldSize, only);
      if (!n) return "Nothing to fix: the path already keeps clear of everything ticked.";
      pushHistory();
      set({ routine: s.simple ? toStraightLines(routine, s.robot) : routine });
      changed();
      return `Re-routed ${n} step${n === 1 ? "" : "s"} around what you ticked. Undo (Ctrl+Z) if you don't like it.`;
    },
    overlays: loadOverlays(),
    setOverlay: (k, v) => { const overlays = { ...get().overlays, [k]: v }; set({ overlays }); try { localStorage.setItem(OVERLAY_KEY, JSON.stringify(overlays)); } catch { /* ignore */ } },
    optimizeTimeouts: () => {
      const rec = get().recording;
      if (!rec) return;
      pushHistory();
      set((s) => ({ routine: optimizeTimeoutsCore(s.routine, rec.steps) }));
      changed();
    },
    drawReverse: false,
    setDrawReverse: (drawReverse) => set({ drawReverse }),
    addSteps: (motions) => {
      if (!motions.length) return null;
      pushHistory();
      const steps: Step[] = motions.map((motion) => ({ id: uid(), motion, actions: [] }));
      set((s) => ({ routine: { ...s.routine, steps: [...s.routine.steps, ...steps] }, selected: steps[steps.length - 1].id }));
      changed();
      return steps[steps.length - 1].id;
    },
    setCodeFrame: (codeFrame) => { set({ codeFrame }); persist(get()); },
    setSimOpts: (patch) => { set((s) => ({ simOpts: { ...s.simOpts, ...patch } })); changed(); },
    setCustomField: (customField) => { set({ customField }); changed(); },

    addStep: (motion, at) => {
      pushHistory();
      const step: Step = { id: uid(), motion, actions: [] };
      set((s) => {
        const steps = s.routine.steps.slice();
        steps.splice(at ?? steps.length, 0, step);
        return { routine: { ...s.routine, steps }, selected: step.id };
      });
      changed();
      return step.id;
    },
    updateMotion: (id, patch, opts) => editStep(id, (st) => ({ ...st, motion: { ...st.motion, ...patch } as MotionSpec }), opts?.history !== false),
    replaceMotion: (id, motion) => editStep(id, (st) => ({ ...st, motion })),
    removeStep: (id) => {
      pushHistory();
      set((s) => ({ routine: { ...s.routine, steps: s.routine.steps.filter((st) => st.id !== id) }, selected: s.selected === id ? null : s.selected }));
      changed();
    },
    moveStep: (id, delta) => {
      pushHistory();
      set((s) => {
        const steps = s.routine.steps.slice();
        const i = steps.findIndex((x) => x.id === id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= steps.length) return {};
        [steps[i], steps[j]] = [steps[j], steps[i]];
        return { routine: { ...s.routine, steps } };
      });
      changed();
    },
    duplicateStep: (id) => {
      pushHistory();
      set((s) => {
        const i = s.routine.steps.findIndex((x) => x.id === id);
        if (i < 0) return {};
        const src = s.routine.steps[i];
        const copy: Step = { ...JSON.parse(JSON.stringify(src)), id: uid(), actions: src.actions.map((a) => ({ ...a, id: uid() })) };
        const steps = s.routine.steps.slice();
        steps.splice(i + 1, 0, copy);
        return { routine: { ...s.routine, steps }, selected: copy.id };
      });
      changed();
    },
    addAction: (stepId, action) => editStep(stepId, (st) => ({ ...st, actions: [...st.actions, action] })),
    updateAction: (stepId, actionId, patch) => editStep(stepId, (st) => ({ ...st, actions: st.actions.map((a) => (a.id === actionId ? ({ ...a, ...patch } as ActionSpec) : a)) })),
    removeAction: (stepId, actionId) => editStep(stepId, (st) => ({ ...st, actions: st.actions.filter((a) => a.id !== actionId) })),
    allRoutines: () => syncedRoutines(get()),
    switchRoutine: (i) => {
      const s = get();
      if (i === s.active || i < 0 || i >= s.routines.length) return;
      const list = syncedRoutines(s);
      set({ routines: list, active: i, routine: list[i], selected: null, time: 0, playing: false });
      changed();
    },
    newRoutine: () => {
      const s = get();
      const list = syncedRoutines(s);
      const g = s.game();
      const first = g.starts[0];
      const r: Routine = { ...emptyRoutine(s.gameId), name: `Auton ${list.length + 1}`, start: first ? { x: first.x, y: first.y, heading: first.heading } : emptyRoutine().start };
      set({ routines: [...list, r], active: list.length, routine: r, selected: null, time: 0, playing: false });
      changed();
    },
    duplicateRoutine: () => {
      const s = get();
      const list = syncedRoutines(s);
      const copy: Routine = { ...JSON.parse(JSON.stringify(s.routine)), name: `${s.routine.name} copy` };
      copy.steps = copy.steps.map((st: Step) => ({ ...st, id: uid(), actions: st.actions.map((a) => ({ ...a, id: uid() })) }));
      set({ routines: [...list, copy], active: list.length, routine: copy, selected: null, time: 0, playing: false });
      changed();
    },
    deleteRoutine: () => {
      const s = get();
      const list = syncedRoutines(s);
      if (list.length <= 1) return;
      const next = list.filter((_, i) => i !== s.active);
      const active = Math.min(s.active, next.length - 1);
      set({ routines: next, active, routine: next[active], selected: null, time: 0, playing: false });
      changed();
    },
    mirror: () => {
      pushHistory();
      set((s) => ({ routine: (get().game().mirror === "rotate" ? rotateRoutine : mirrorRoutine)(s.routine) }));
      changed();
    },
    clearRoutine: () => {
      pushHistory();
      set((s) => ({ routine: { ...emptyRoutine(s.gameId), name: s.routine.name, alliance: s.routine.alliance, start: s.routine.start }, selected: null }));
      changed();
    },
    loadProject: (p) => {
      pushHistory();
      const list = p.routines && p.routines.length ? p.routines : [p.routine];
      const active = Math.min(Math.max(0, p.active ?? 0), list.length - 1);
      set({ robot: { ...defaultRobot(), ...p.robot, odom: { ...defaultRobot().odom, ...p.robot.odom } }, ports: p.ports, routine: list[active], routines: list, active, gameId: p.gameId, customField: p.customField ?? null, target: p.target ?? "lemlib", codeFrame: p.codeFrame ?? "start", simOpts: p.simOpts ?? get().simOpts, selected: null });
      changed();
    },

    runSim: () => {
      const s = get();
      const g = s.game();
      const init = worldInit(g, s.routine.alliance);
      const world = s.customField ? { ...init, objects: [...s.customField.objects, ...init.objects.filter((o) => o.held)], obstacles: s.customField.obstacles } : init;
      const t0 = performance.now();
      const recording = simulate(s.routine, s.robot, world, { seed: s.simOpts.seed, placementError: s.simOpts.placementError });
      for (const h of routeHits(recording)) recording.warnings.push({ t: h.t, step: h.step, text: `The robot runs into ${h.label} at ${h.t.toFixed(1)} s. Use “Avoid & fix path”.`, level: "warn" });
      if (g.check) {
        for (const f of g.check({ routine: s.routine, cfg: s.robot, recording, world: recording.world })) recording.warnings.push({ t: 0, step: f.step ?? -1, text: f.text, level: f.level });
      }
      set({ recording, simMs: performance.now() - t0, time: Math.min(get().time, recording.duration) });
    },
    setTime: (time) => set({ time }),
    setPlaying: (playing) => set({ playing }),
    setSpeed: (speed) => set({ speed }),
  };
});

// initial simulation
setTimeout(() => useStore.getState().runSim(), 0);

type State = ReturnType<typeof useStore.getState>;

/** All store fields except the 60 fps playback clock, so editor panels don't re-render every frame. */
export function useEditor(): Omit<State, "time" | "playing" | "speed"> {
  return useStore(
    useShallow((s) => {
      const { time, playing, speed, ...rest } = s;
      void time; void playing; void speed;
      return rest;
    }),
  );
}
