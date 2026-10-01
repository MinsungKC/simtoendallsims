import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fitStroke } from "../core/fit";
import { addMark, moveMark } from "../core/marks";
import { avoidObstacles, polylineFromStroke } from "../core/autoroute";
import { avoidList, robotRadius } from "../core/repair";
import { forwardOf, rightOf } from "../core/geometry";
import { planPoses } from "../core/common-plan";
import { distanceAlongPath, pathLength, pointAtDistance, samplePath } from "../core/path";
import type { PathSpec } from "../core/routine";
import { defaultMotion } from "../core/routine";
import { obstaclePoly } from "../core/world";
import { chassisRects, pickupOrientation, scoreSpecOf } from "../core/robot";
import { drawCup, drawGoal, drawLoader, drawLyingCup, drawLyingPin, drawPerimeter, drawStandingPin, drawToggle, PALETTE, type Frame2D } from "./fieldArt";
import { loaderOutline } from "../games/override";
import { bearingDeg, frameIndex, lerpFrame, TEAM_COLOR } from "./helpers";
import { useStore } from "./store";
import { worldInit, type CustomField } from "../games/types";

interface Handle {
  kind: "start" | "start-heading" | "step" | "step-heading" | "ctrl" | "object" | "task" | "mark";
  id?: string;
  seg?: number;
  idx?: number;
  mark?: string;
  x: number;
  y: number;
  r: number;
}

const HANDLE_R = 8;
/** Field Perimeter and the Toggles that ride on it live outside the 144" of tiles */
const MARGIN = 3;

function snap(v: number): number {
  return Math.round(v * 4) / 4;
}

export function FieldCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const handles = useRef<Handle[]>([]);
  const drag = useRef<Handle | null>(null);
  const stroke = useRef<{ x: number; y: number }[] | null>(null);
  const sizeRef = useRef(720);

  const [bumpKey, setBumpKey] = useState(0);
  const store = useStore();
  const { recording, time, routine, robot, selected, tool, customField, overlays, tasks } = store;
  const game = store.game();
  const fieldSize = game.fieldSize.value;

  const planned = useMemo(() => planPoses(routine, robot), [routine, robot]);

  const world = useMemo(() => {
    const init = worldInit(game);
    return customField ? { ...init, objects: customField.objects, obstacles: customField.obstacles, zones: customField.zones } : { ...init, zones: game.zones };
  }, [game, customField]);

  const draw = useCallback(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const size = sizeRef.current;
    if (c.width !== Math.round(size * dpr)) { c.width = Math.round(size * dpr); c.height = Math.round(size * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const S = size / (fieldSize + 2 * MARGIN);
    const px = (x: number) => size / 2 + x * S;
    const py = (y: number) => size / 2 - y * S;
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    const C = dark
      ? { wall: "#6b7a9b", text: "#c9d1e3", plan: "#9fb0d3" }
      : { wall: "#6b7a9b", text: "#39435a", plan: "#3b4a72" };
    const F: Frame2D = { ctx, px, py, S };
    const half = fieldSize / 2;

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#0b0b0d"; ctx.fillRect(0, 0, size, size);
    // foam floor tiles (6 x 6 of 24 in) - always the real dark gray, so tape and game pieces read like the real field
    const tile = (fieldSize / 6) * S;
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) { ctx.fillStyle = (i + j) % 2 ? PALETTE.floorA : PALETTE.floorB; ctx.fillRect(px(-half) + i * tile, py(half) + j * tile, tile + 0.5, tile + 0.5); }
    ctx.strokeStyle = PALETTE.seam; ctx.lineWidth = Math.max(1, 0.25 * S);
    for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.moveTo(px(-half) + i * tile, py(half)); ctx.lineTo(px(-half) + i * tile, py(-half)); ctx.moveTo(px(-half), py(half) + i * tile); ctx.lineTo(px(half), py(half) + i * tile); ctx.stroke(); }
    drawPerimeter(F, half);

    // scoring zones
    for (const z of world.zones) {
      ctx.fillStyle = (z.color ?? "#e2b93b") + "33"; ctx.strokeStyle = (z.color ?? "#e2b93b") + "aa"; ctx.lineWidth = 1.5;
      if (z.geom.shape === "rect") { ctx.fillRect(px(z.geom.x - z.geom.w / 2), py(z.geom.y + z.geom.h / 2), z.geom.w * S, z.geom.h * S); ctx.strokeRect(px(z.geom.x - z.geom.w / 2), py(z.geom.y + z.geom.h / 2), z.geom.w * S, z.geom.h * S); }
      else { ctx.beginPath(); ctx.arc(px(z.geom.x), py(z.geom.y), z.geom.r * S, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    }
    // game tape lines and regions (Midfield, Load Zones, Autonomous Line ...)
    if (overlays.tape) for (const poly of game.polys ?? []) {
      ctx.beginPath(); poly.verts.forEach((v, i) => (i ? ctx.lineTo(px(v.x), py(v.y)) : ctx.moveTo(px(v.x), py(v.y)))); if (poly.closed !== false) ctx.closePath();
      if (poly.fill) { ctx.fillStyle = poly.fill; ctx.fill(); }
      ctx.strokeStyle = poly.stroke ?? "#ffffff88"; ctx.lineWidth = poly.strokeWidth ? poly.strokeWidth * S : 2; ctx.lineJoin = "miter"; ctx.lineCap = "butt"; ctx.stroke();
    }
    if (overlays.tape) for (const l of game.lines) {
      ctx.strokeStyle = l.color ?? "#ffffff88"; ctx.beginPath(); ctx.moveTo(px(l.x1), py(l.y1)); ctx.lineTo(px(l.x2), py(l.y2));
      if (l.width) { ctx.lineWidth = l.width * S; ctx.lineCap = "butt"; ctx.stroke(); }
      else { ctx.lineWidth = 2.5; ctx.setLineDash([10, 6]); ctx.stroke(); ctx.setLineDash([]); }
    }

    // static solid elements: real footprints (Goals, Loaders); anything else as a plain block
    const outline = (verts: { x: number; y: number }[]) => { ctx.beginPath(); verts.forEach((v, i) => (i ? ctx.lineTo(px(v.x), py(v.y)) : ctx.moveTo(px(v.x), py(v.y)))); ctx.closePath(); };
    for (const o of world.obstacles) {
      const tag = o.tag ?? "";
      if (tag.startsWith("goal:")) { const id = tag.slice(5); drawGoal(F, o.x, o.y, id.startsWith("red") ? "red" : id.startsWith("blue") ? "blue" : "black", id === "tall"); continue; }
      if (tag === "loader") { const red = o.label.includes("red"); drawLoader(F, loaderOutline(red ? -1 : 1, o.y), red); continue; }
      outline(obstaclePoly(o)); ctx.fillStyle = "#59647d"; ctx.fill(); ctx.strokeStyle = "#2b3448"; ctx.lineWidth = 1.5; ctx.stroke();
    }
    // Toggles: bars on top of the Perimeter showing the color they are set to
    const toggleState = new Map<string, string>();
    for (const t of game.toggles ?? []) toggleState.set(t.id, t.state);
    for (const e of recording?.events ?? []) if (e.type === "toggle" && e.t <= time && e.toggle && e.color) toggleState.set(e.toggle, e.color);
    for (const t of game.toggles ?? []) drawToggle(F, t.wall, toggleState.get(t.id) ?? t.state);

    // objects (Cups first so the Pins standing in them are drawn on top)
    const frames = recording?.frames;
    const fr = frames && frames.length ? lerpFrame(frames, time) : null;
    const meta = recording ? recording.world.objects : world.objects;
    const at = (o: (typeof meta)[number], i: number) => {
      let x = o.x, y = o.y, st = o.lying ? 6 : 0, ang = o.angle ?? 0;
      if (fr) { x = fr.objs[i * 4]; y = fr.objs[i * 4 + 1]; st = fr.objs[i * 4 + 2]; ang = fr.objs[i * 4 + 3]; }
      else if (o.stackedIn) st = 3;
      else if (o.nestedIn !== undefined) st = 5;
      if (!fr && recording) { x = world.objects[i]?.x ?? o.x; y = world.objects[i]?.y ?? o.y; }
      return { x, y, st, ang };
    };
    const generic = (o: (typeof meta)[number], x: number, y: number) => {
      const r = Math.max(2, o.r * S);
      if (o.kind === "ring") { ctx.beginPath(); ctx.arc(px(x), py(y), r, 0, Math.PI * 2); ctx.strokeStyle = TEAM_COLOR[o.team]; ctx.lineWidth = Math.max(2, r * 0.45); ctx.stroke(); }
      else if (o.kind === "mobile-goal") { ctx.beginPath(); ctx.arc(px(x), py(y), r, 0, Math.PI * 2); ctx.fillStyle = "#e2b93b33"; ctx.fill(); ctx.strokeStyle = "#e2b93b"; ctx.lineWidth = 2.5; ctx.stroke(); }
      else { ctx.beginPath(); ctx.arc(px(x), py(y), r, 0, Math.PI * 2); ctx.fillStyle = TEAM_COLOR[o.team]; ctx.fill(); }
    };
    if (overlays.pieces) meta.forEach((o, i) => { const p = at(o, i); if (p.st === 1 || p.st === 3 || o.kind === "pin") return; if (o.kind === "cup") { if (p.st === 6) drawLyingCup(F, p.x, p.y, p.ang, o.opaqueUp); else drawCup(F, p.x, p.y, o.opaqueUp); } else generic(o, p.x, p.y); });
    if (overlays.pieces) meta.forEach((o, i) => {
      if (o.kind !== "pin") return;
      const p = at(o, i);
      if (p.st === 1 || p.st === 3) return;
      const upper = o.halves ? o.halves[o.flip ? 0 : 1] : "yellow", lower = o.halves ? o.halves[o.flip ? 1 : 0] : "yellow";
      if (p.st === 6) drawLyingPin(F, p.x, p.y, p.ang, o.halves, o.flip);
      else drawStandingPin(F, p.x, p.y, upper, lower, p.st !== 5);
    });
    // Goal stacks: what started Placed plus placement events up to the playhead, bottom to top
    if (game.goals?.length) {
      const stacks = new Map<string, number[]>();
      for (const o of meta) if (o.stackedIn) stacks.set(o.stackedIn, [...(stacks.get(o.stackedIn) ?? []), o.id]);
      for (const e of recording?.events ?? []) if (e.type === "place" && e.t <= time && e.goal && e.id !== undefined) stacks.set(e.goal, [...(stacks.get(e.goal) ?? []), e.id]);
      for (const g of game.goals) {
        const ids = stacks.get(g.id) ?? [];
        ids.forEach((id, level) => {
          const o = meta.find((q) => q.id === id);
          if (!o) return;
          const off = level * 0.35;
          if (o.kind === "pin") {
            const upper = o.halves ? o.halves[o.flip ? 0 : 1] : "yellow", lower = o.halves ? o.halves[o.flip ? 1 : 0] : "yellow";
            drawStandingPin(F, g.x - off, g.y + off, upper, lower, true);
          } else drawCup(F, g.x - off, g.y + off, o.opaqueUp);
        });
        if (ids.length > 1) { ctx.fillStyle = "#fff"; ctx.font = "bold 10px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(ids.length), px(g.x + 4.2), py(g.y - 4.2)); }
      }
    }

    // planned route
    if (overlays.plan) { ctx.setLineDash([5, 4]); ctx.strokeStyle = C.plan; ctx.lineWidth = 1.5; ctx.beginPath();
    ctx.moveTo(px(routine.start.x), py(routine.start.y));
    planned.after.forEach((p, i) => { if (routine.steps[i].motion.type !== "follow") ctx.lineTo(px(p.x), py(p.y)); else ctx.moveTo(px(p.x), py(p.y)); });
    ctx.stroke(); ctx.setLineDash([]); }

    // follow paths
    handles.current = [];
    routine.steps.forEach((s, i) => {
      if (s.motion.type !== "follow") return;
      const path: PathSpec = s.motion.path;
      const pts = samplePath(path);
      ctx.strokeStyle = s.id === selected ? "#f0b34a" : "#c98b2a"; ctx.lineWidth = 3; ctx.beginPath();
      pts.forEach((p, k) => (k ? ctx.lineTo(px(p.x), py(p.y)) : ctx.moveTo(px(p.x), py(p.y)))); ctx.stroke();
      if (s.id === selected) {
        path.segments.forEach((seg, si) => {
          ctx.strokeStyle = "#f0b34a88"; ctx.lineWidth = 1; ctx.beginPath();
          ctx.moveTo(px(seg.p[0].x), py(seg.p[0].y)); ctx.lineTo(px(seg.p[1].x), py(seg.p[1].y));
          ctx.moveTo(px(seg.p[3].x), py(seg.p[3].y)); ctx.lineTo(px(seg.p[2].x), py(seg.p[2].y)); ctx.stroke();
          seg.p.forEach((q, qi) => { if (si > 0 && qi === 0) return; handles.current.push({ kind: "ctrl", id: s.id, seg: si, idx: qi, x: q.x, y: q.y, r: HANDLE_R }); });
        });
      }
      const marks = path.marks ?? [];
      marks.forEach((mk) => {
        const q = pointAtDistance(path, mk.d);
        ctx.save(); ctx.translate(px(q.x), py(q.y)); ctx.rotate(Math.PI / 4);
        ctx.fillStyle = mk.speed !== undefined ? "#e0603a" : "#2f9e6f"; ctx.strokeStyle = "#101418"; ctx.lineWidth = 1.5;
        ctx.fillRect(-5, -5, 10, 10); ctx.strokeRect(-5, -5, 10, 10); ctx.restore();
        if (s.id === selected) handles.current.push({ kind: "mark", id: s.id, seg: marks.indexOf(mk), x: q.x, y: q.y, r: 9, mark: mk.id });
      });
      void i;
    });

    // trails (true = solid, odometry estimate = thin)
    if (frames && frames.length && (overlays.trail || overlays.odom)) {
      const upto = frameIndex(frames, time);
      if (overlays.trail) {
      ctx.lineWidth = 2.5; ctx.strokeStyle = "#f0b34a"; ctx.beginPath();
      for (let k = 0; k <= upto; k++) (k ? ctx.lineTo(px(frames[k].x), py(frames[k].y)) : ctx.moveTo(px(frames[0].x), py(frames[0].y)));
      ctx.stroke(); }
      if (overlays.odom) {
      ctx.lineWidth = 1; ctx.strokeStyle = "#ff6ba8"; ctx.beginPath();
      for (let k = 0; k <= upto; k++) (k ? ctx.lineTo(px(frames[k].ex), py(frames[k].ey)) : ctx.moveTo(px(frames[0].ex), py(frames[0].ey)));
      ctx.stroke(); }
    }

    // predicted footprint: the robot's outline every ~10 in along the simulated path
    if (overlays.footprints && frames && frames.length > 1) {
      ctx.save(); ctx.strokeStyle = "rgba(240,179,74,0.35)"; ctx.lineWidth = 1;
      let acc = 1e9, px0 = frames[0].x, py0 = frames[0].y;
      for (const f of frames) {
        acc += Math.hypot(f.x - px0, f.y - py0); px0 = f.x; py0 = f.y;
        if (acc < 10) continue;
        acc = 0;
        ctx.save(); ctx.translate(px(f.x), py(f.y)); ctx.rotate((f.heading * Math.PI) / 180);
        for (const c of chassisRects(robot)) ctx.strokeRect((c.cx - c.w / 2) * S, -(c.cy + c.h / 2) * S, c.w * S, c.h * S);
        ctx.restore();
      }
      ctx.restore();
    }
    // live freehand stroke: raw ink and the smoothed curve it will become
    const ink = stroke.current;
    if (ink && ink.length > 1) {
      ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1.5; ctx.beginPath();
      ink.forEach((q, i) => (i ? ctx.lineTo(px(q.x), py(q.y)) : ctx.moveTo(px(q.x), py(q.y)))); ctx.stroke();
      const g0 = useStore.getState().game();
      const sm = samplePath({ segments: fitStroke(avoidObstacles(ink, { obstacles: avoidList(useStore.getState().customField?.obstacles ?? g0.obstacles, useStore.getState().customField?.objects ?? g0.objects, useStore.getState().avoid, routine, robot), fieldSize, clearance: robotRadius(robot) + useStore.getState().avoid.margin })), maxSpeed: 0, minSpeed: 0, decel: 0, spacing: 1 });
      ctx.strokeStyle = "#f0b34a"; ctx.lineWidth = 3; ctx.beginPath();
      sm.forEach((q, i) => (i ? ctx.lineTo(px(q.x), py(q.y)) : ctx.moveTo(px(q.x), py(q.y)))); ctx.stroke();
    }

    // planner targets
    if (tasks.length > 1) { ctx.setLineDash([3, 4]); ctx.strokeStyle = "#ffd24a99"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(px(routine.start.x), py(routine.start.y)); tasks.forEach((t) => ctx.lineTo(px(t.x), py(t.y))); ctx.stroke(); ctx.setLineDash([]); }
    tasks.forEach((t, i) => {
      if (t.targetKind === "point") handles.current.push({ kind: "task", id: t.id, x: t.x, y: t.y, r: 10 });
      ctx.beginPath(); ctx.arc(px(t.x), py(t.y), Math.max(9, 3.5 * S), 0, Math.PI * 2); ctx.strokeStyle = "#ffd24a"; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.fillStyle = "#ffd24a"; ctx.font = "bold 11px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(i + 1), px(t.x) + Math.max(9, 3.5 * S) + 7, py(t.y) - Math.max(9, 3.5 * S) - 2);
      if (t.approach !== "auto") { const f = forwardOf(t.approach); ctx.beginPath(); ctx.moveTo(px(t.x - f.x * 8), py(t.y - f.y * 8)); ctx.lineTo(px(t.x), py(t.y)); ctx.stroke(); }
    });

    // robot
    const drawBody = (x: number, y: number, heading: number, dashed: boolean, alpha: number) => {
      ctx.save(); ctx.translate(px(x), py(y)); ctx.rotate((heading * Math.PI) / 180);
      const w = robot.width * S, l = robot.length * S;
      ctx.globalAlpha = alpha;
      if (dashed) { ctx.setLineDash([4, 3]); ctx.strokeStyle = "#ff6ba8"; ctx.lineWidth = 1.5; ctx.strokeRect(-w / 2, -l / 2, w, l); ctx.setLineDash([]); }
      else {
        ctx.fillStyle = "rgba(80,150,255,0.5)"; ctx.strokeStyle = "#8ec1ff"; ctx.lineWidth = 2;
        for (const c of chassisRects(robot)) { ctx.fillRect((c.cx - c.w / 2) * S, -(c.cy + c.h / 2) * S, c.w * S, c.h * S); ctx.strokeRect((c.cx - c.w / 2) * S, -(c.cy + c.h / 2) * S, c.w * S, c.h * S); }
        if (overlays.zones && robot.intake) { ctx.fillStyle = "rgba(120,220,140,0.25)"; ctx.fillRect(((robot.intake.x ?? 0) - robot.intake.width / 2) * S, -l / 2 + (robot.intake.inset ?? 0) * S - robot.intake.reach * S, robot.intake.width * S, robot.intake.reach * S); }
        if (overlays.zones && robot.rearIntake) { ctx.fillStyle = pickupOrientation(robot.rearIntake) === "standing" ? "rgba(90,200,230,0.25)" : pickupOrientation(robot.rearIntake) === "lying" ? "rgba(230,150,90,0.25)" : "rgba(120,220,140,0.25)"; ctx.fillRect(((robot.rearIntake.x ?? 0) - robot.rearIntake.width / 2) * S, l / 2 - (robot.rearIntake.inset ?? 0) * S, robot.rearIntake.width * S, robot.rearIntake.reach * S); }
        if (overlays.zones) { const sc = scoreSpecOf(robot); const yy = (sc.side === "front" ? -1 : 1) * (l / 2 - (sc.inset ?? 0) * S); ctx.fillStyle = "#ffd24a"; ctx.beginPath(); ctx.arc((sc.x ?? 0) * S, yy, 3, 0, Math.PI * 2); ctx.fill(); }
        for (const wh of robot.wheels) for (const side of [-1, 1]) {
          ctx.fillStyle = wh.type === "omni" ? "#eee" : "#222";
          const wl = robot.wheelDiameter * S;
          ctx.fillRect(side * (robot.trackWidth * S) / 2 - 0.4 * S, -wh.x * S - wl / 2, 0.8 * S, wl);
        }
        ctx.fillStyle = "#ff6b6b"; ctx.beginPath(); ctx.moveTo(0, -l / 2 - 5); ctx.lineTo(-6, -l / 2 + 8); ctx.lineTo(6, -l / 2 + 8); ctx.fill();
      }
      ctx.restore();
    };
    if (fr) {
      drawBody(fr.etheta === undefined ? fr.x : fr.ex, fr.ey, fr.etheta, true, 0.9);
      drawBody(fr.x, fr.y, fr.heading, false, 1);
    } else drawBody(routine.start.x, routine.start.y, routine.start.heading, false, 1);

    // handles: start + steps
    const dot = (x: number, y: number, fill: string, r = HANDLE_R, label?: string) => {
      ctx.beginPath(); ctx.arc(px(x), py(y), r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = "#0008"; ctx.lineWidth = 1.5; ctx.stroke();
      if (label) { ctx.fillStyle = "#fff"; ctx.font = "bold 10px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, px(x), py(y) + 0.5); }
    };
    const arrowHandle = (x: number, y: number, heading: number, id: string | undefined, kind: Handle["kind"], color: string) => {
      const f = forwardOf(heading);
      const hx = x + f.x * 14, hy = y + f.y * 14;
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px(x), py(y)); ctx.lineTo(px(hx), py(hy)); ctx.stroke();
      dot(hx, hy, color, 5);
      handles.current.push({ kind, id, x: hx, y: hy, r: 9 });
    };
    routine.steps.forEach((s, i) => {
      const m = s.motion;
      const before = planned.before[i];
      const after = planned.after[i];
      const sel = s.id === selected;
      if (!overlays.dots && !sel) return;
      const color = sel ? "#f0b34a" : "#8b96b3";
      if (m.type === "moveToPoint" || m.type === "moveToPose" || m.type === "turnToPoint") {
        dot(m.x, m.y, color, HANDLE_R, String(i + 1));
        handles.current.push({ kind: "step", id: s.id, x: m.x, y: m.y, r: HANDLE_R });
        if (m.type === "moveToPose") arrowHandle(m.x, m.y, m.heading, s.id, "step-heading", color);
      } else if (m.type === "turnToHeading" || m.type === "swingToHeading") {
        if (sel) arrowHandle(before.x, before.y, m.heading, s.id, "step-heading", color);
        dot(after.x + 4, after.y + 4, color, 6, String(i + 1));
      } else if (m.type === "follow") {
        dot(after.x, after.y, color, 9, String(i + 1));
        const nx = routine.steps[i + 1];
        if (nx && nx.motion.type === "turnToHeading" && (sel || nx.id === selected)) arrowHandle(after.x, after.y, nx.motion.heading, nx.id, "step-heading", "#f0b34a");
      } else if (m.type === "setPose") dot(m.x, m.y, color, 6, "P");
    });
    // start
    dot(routine.start.x, routine.start.y, "#3fb970", HANDLE_R, "S");
    handles.current.push({ kind: "start", x: routine.start.x, y: routine.start.y, r: HANDLE_R });
    arrowHandle(routine.start.x, routine.start.y, routine.start.heading, undefined, "start-heading", "#3fb970");
    // object handles in edit mode
    if (tool === "objects") world.objects.forEach((o) => handles.current.push({ kind: "object", id: String(o.id), x: o.x, y: o.y, r: Math.max(6, o.r * S) }));

    void rightOf; void C;
  }, [recording, time, routine, robot, selected, tool, world, planned, fieldSize, bumpKey, overlays, tasks]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { sizeRef.current = Math.max(280, Math.min(el.clientWidth, el.clientHeight || el.clientWidth, 900)); if (ref.current) { ref.current.style.width = `${sizeRef.current}px`; ref.current.style.height = `${sizeRef.current}px`; } draw(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw]);

  const toWorld = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const S = r.width / (fieldSize + 2 * MARGIN);
    return { x: (e.clientX - r.left - r.width / 2) / S, y: -(e.clientY - r.top - r.height / 2) / S, S };
  };

  const hit = (x: number, y: number, S: number): Handle | null => {
    let best: Handle | null = null, bd = Infinity;
    for (let i = handles.current.length - 1; i >= 0; i--) {
      const h = handles.current[i];
      const d = Math.hypot(h.x - x, h.y - y) * S;
      if (d <= h.r + 3 && d < bd) { best = h; bd = d; }
    }
    return best;
  };

  const ensureCustom = (): CustomField => {
    const cur = useStore.getState().customField;
    if (cur) return cur;
    const g = useStore.getState().game();
    const c: CustomField = { objects: g.objects.map((o) => ({ ...o })), obstacles: g.obstacles.map((o) => ({ ...o })), zones: g.zones.map((z) => ({ ...z })) };
    return c;
  };

  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = toWorld(e);
    const h = hit(p.x, p.y, p.S);
    const st = useStore.getState();
    if (h) {
      drag.current = h;
      st.snapshot();
      if (h.id && (h.kind === "step" || h.kind === "step-heading" || h.kind === "ctrl")) st.select(h.id);
      return;
    }
    if (st.tool === "select") {
      // clicking a curve selects it; clicking the selected curve again pins a point there
      let near: { id: string; d: number } | null = null;
      for (const q of st.routine.steps) if (q.motion.type === "follow") { const r = distanceAlongPath(q.motion.path, p.x, p.y); if (r.off * p.S < 10 && (!near || r.off < near.d)) near = { id: q.id, d: r.off }; }
      if (near) {
        if (st.selected === near.id) { const step = st.routine.steps.find((q) => q.id === near!.id)!; if (step.motion.type === "follow") { const { d } = distanceAlongPath(step.motion.path, p.x, p.y); st.editMarks(near.id, (marks, actions) => addMark({ marks, actions }, d)); } }
        else st.select(near.id);
        return;
      }
      st.select(null); return;
    }
    if (st.tool === "objects") { st.select(null); return; }
    if (st.tool === "draw") { stroke.current = [{ x: p.x, y: p.y }]; return; }
    if (st.tool === "targets") {
      const g = st.game();
      const objs = (st.customField?.objects ?? g.objects).filter((o) => !o.stackedIn && o.nestedIn === undefined);
      const cands: { d: number; t: Omit<import("../core/planner").PlanTask, "id"> }[] = [];
      for (const q of g.goals ?? []) cands.push({ d: Math.hypot(q.x - p.x, q.y - p.y) - 2, t: { label: `Goal ${q.id}`, x: q.x, y: q.y, targetKind: "goal", action: "place", side: "auto", approach: "auto", refId: q.id } });
      for (const q of g.toggles ?? []) cands.push({ d: Math.max(0, Math.hypot(q.x - p.x, q.y - p.y) - 10), t: { label: `Toggle ${q.wall}`, x: q.x, y: q.y, targetKind: "toggle", action: "toggle", side: "front", approach: { N: 0, E: 90, S: 180, W: 270 }[q.wall] } });
      for (const q of objs) cands.push({ d: Math.hypot(q.x - p.x, q.y - p.y) - q.r, t: { label: q.kind === "cup" ? "Cup" : q.kind === "pin" ? "Pin" : q.kind, x: q.x, y: q.y, targetKind: "object", action: "pickup", side: "auto", approach: "auto", lying: !!q.lying, refId: q.id, pieceKind: q.kind } });
      cands.sort((a, b) => a.d - b.d);
      if (cands[0] && cands[0].d < 4) st.addTask(cands[0].t);
      else st.addTask({ label: `Point ${st.tasks.filter((t) => t.targetKind === "point").length + 1}`, x: Math.round(p.x * 4) / 4, y: Math.round(p.y * 4) / 4, targetKind: "point", action: "none", side: "auto", approach: "auto" });
      return;
    }
    // add-step tools
    const last = planPoses(st.routine, st.robot).after.at(-1) ?? { ...st.routine.start };
    const pos = { x: snap(p.x), y: snap(p.y) };
    const hd = Math.round(bearingDeg(last, pos));
    let id: string;
    if (st.tool === "moveToPoint") id = st.addStep(defaultMotion("moveToPoint", { ...pos, heading: hd }));
    else if (st.tool === "moveToPose") id = st.addStep(defaultMotion("moveToPose", { ...pos, heading: hd }));
    else if (st.tool === "turnToPoint") id = st.addStep(defaultMotion("turnToPoint", { ...pos, heading: hd }));
    else {
      const m = defaultMotion("follow", { x: last.x, y: last.y, heading: last.heading });
      if (m.type === "follow") {
        const a = { x: last.x, y: last.y }, b = pos;
        m.path.segments = [{ p: [a, { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 }, { x: a.x + (2 * (b.x - a.x)) / 3, y: a.y + (2 * (b.y - a.y)) / 3 }, b] }];
      }
      id = st.addStep(m);
    }
    st.select(id);
  };

  const onMove = (e: React.PointerEvent) => {
    if (stroke.current) {
      const p = toWorld(e);
      const last = stroke.current[stroke.current.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) > 0.4) { stroke.current.push({ x: Math.max(-fieldSize / 2, Math.min(fieldSize / 2, p.x)), y: Math.max(-fieldSize / 2, Math.min(fieldSize / 2, p.y)) }); setBumpKey((k) => k + 1); }
      return;
    }
    const h = drag.current;
    if (!h) return;
    const p = toWorld(e);
    const st = useStore.getState();
    const x = snap(Math.max(-fieldSize / 2, Math.min(fieldSize / 2, p.x)));
    const y = snap(Math.max(-fieldSize / 2, Math.min(fieldSize / 2, p.y)));
    if (h.kind === "start") st.setRoutine({ start: { ...st.routine.start, x, y } }, { history: false });
    else if (h.kind === "start-heading") st.setRoutine({ start: { ...st.routine.start, heading: Math.round(bearingDeg(st.routine.start, { x, y })) } }, { history: false });
    else if (h.kind === "task" && h.id) st.updateTask(h.id, { x, y });
    else if (h.kind === "step" && h.id) {
      const step = st.routine.steps.find((s) => s.id === h.id);
      if (step && "x" in step.motion) st.updateMotion(h.id, { x, y } as never, { history: false });
    } else if (h.kind === "step-heading" && h.id) {
      const idx = st.routine.steps.findIndex((s) => s.id === h.id);
      const step = st.routine.steps[idx];
      const origin = step.motion.type === "moveToPose" ? { x: step.motion.x, y: step.motion.y } : planPoses(st.routine, st.robot).before[idx];
      st.updateMotion(h.id, { heading: Math.round(bearingDeg(origin, { x, y })) } as never, { history: false });
    } else if (h.kind === "mark" && h.id && h.mark) {
      const step = st.routine.steps.find((q) => q.id === h.id);
      if (!step || step.motion.type !== "follow") return;
      const { d } = distanceAlongPath(step.motion.path, p.x, p.y);
      st.editMarks(h.id, (marks, actions) => moveMark({ marks, actions }, h.mark!, d), false);
      return;
    } else if (h.kind === "ctrl" && h.id !== undefined && h.seg !== undefined && h.idx !== undefined) {
      const step = st.routine.steps.find((s) => s.id === h.id);
      if (!step || step.motion.type !== "follow") return;
      const path = JSON.parse(JSON.stringify(step.motion.path)) as PathSpec;
      path.segments[h.seg].p[h.idx as 0 | 1 | 2 | 3] = { x, y };
      // shared joint between segments moves together
      if (h.idx === 3 && path.segments[h.seg + 1]) path.segments[h.seg + 1].p[0] = { x, y };
      if (h.idx === 0 && h.seg > 0) path.segments[h.seg - 1].p[3] = { x, y };
      st.updateMotion(h.id, { path } as never, { history: false });
    } else if (h.kind === "object" && h.id) {
      const c = ensureCustom();
      const objects = c.objects.map((o) => (String(o.id) === h.id ? { ...o, x, y } : o));
      st.setCustomField({ ...c, objects });
    }
    h.x = x; h.y = y;
  };

  const onUp = () => {
    drag.current = null;
    const ink = stroke.current;
    stroke.current = null;
    setBumpKey((k) => k + 1);
    if (!ink || ink.length < 3) return;
    const st = useStore.getState();
    const last = planPoses(st.routine, st.robot).after.at(-1) ?? { ...st.routine.start };
    const g = st.game();
    if (st.simple) {
      // simple mode: straight legs only
      const legs = polylineFromStroke(ink, { obstacles: [], fieldSize, clearance: 0, from: { x: last.x, y: last.y } }, 5, 10);
      let prev = { x: last.x, y: last.y };
      st.addSteps(legs.map((q) => { const m = defaultMotion("moveToPoint", { x: q.x, y: q.y, heading: 0 }); if (m.type === "moveToPoint") { m.forwards = !st.drawReverse; m.timeout = Math.max(1500, Math.ceil(((Math.hypot(q.x - prev.x, q.y - prev.y) / 15) * 1000 + 1500) / 100) * 100); } prev = q; return m; }));
      st.fixPath(); // grid-plan every leg around Goals, loaders and walls, facing each leg first
      return;
    }
    // one smooth curve (obstacle-avoided, tangent-continuous), then a turn that sets the ending face
    // loose pieces are left alone here (the curve is what you drew; they get bumped or picked up) - only Goals, Loaders and walls bend it
    const hard = avoidList(st.customField ? st.customField.obstacles : g.obstacles, [], st.avoid, st.routine, st.robot);
    const safe = avoidObstacles([{ x: last.x, y: last.y }, ...ink], { obstacles: hard, fieldSize, clearance: robotRadius(st.robot) + st.avoid.margin });
    const segments = fitStroke(safe);
    if (!segments.length) return;
    const m = defaultMotion("follow", { x: last.x, y: last.y, heading: last.heading });
    if (m.type !== "follow") return;
    m.forwards = !st.drawReverse;
    m.path.segments = segments.map((sg) => ({ p: sg.p.map((q) => ({ x: Math.round(q.x * 100) / 100, y: Math.round(q.y * 100) / 100 })) as typeof sg.p }));
    m.timeout = Math.max(2000, Math.ceil(((pathLength(m.path) / 35) * 1000 + 1000) / 100) * 100);
    // one step ending at the drawn point (the robot finishes pointing along the curve); pin points on the curve to tune it
    st.addSteps([m]);
  };

  return (
    <div className="field-wrap" ref={wrap}>
      <canvas ref={ref} className="field" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
    </div>
  );
}
