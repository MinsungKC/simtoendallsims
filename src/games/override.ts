/**
 * VEX V5RC Override (2026-27), laid out from VEX's official top-down field graphic (Override H2H, the drawing that ships with
 * the Game Manual's field pages) plus the manual text. Sources, by confidence:
 *  - manual (Game Manual v2.0): field 12'x12' on a 6x6 array of 24" tiles; Cup 3.15" x 6.5" (two halves: one clear, one
 *    opaque); Pin ~1.6" x 6.5" (two colored halves); Goals octagonal, 8.7" (center) / 5.8" (neutral) / 3.25" (Alliance) tall;
 *    Toggles 25.8" long, ~2.05" faces, mounted on the Field Perimeter; 9 Goals, 4 Loaders, 4 Toggles; scoring rules SC1-SC8,
 *    starting/expansion rules SG1-SG13; object counts (37 Pins + 36 Cups on the Field).
 *  - official graphic (measured in pixels against the 144" square, cross-checked with the 24" tile seams and the Goal grid):
 *    where every Pin, Cup, Goal, Loader, Toggle and tape line sits, the shape and colors of each, which way each object
 *    faces, and the five Pins that start Placed in the neutral Goals.
 *  - assumed: physics proxies (Pin radius/spine, Loader collision box), Pin mass.
 * Appendix A's dimensioned drawings are images that could not be read; sizes taken from the graphic carry ~0.2" of error.
 */
import { corners, pointInConvex, polysOverlap, rectVerts, type Vec } from "../core/geometry";
import type { GameRules, GoalState, Obstacle, ToggleState, World } from "../core/world";
import type { FieldLine, FieldPoly, GameModule, RuleFinding, ScoreResult } from "./types";

const IN_PER_MM = 1 / 25.4;
export const GOAL_ACROSS_FLATS = 142.5 * IN_PER_MM; // 5.61" (the graphic shows ~5.8" incl. the flange)
export const GOAL_CHAMFER = 0.95;
export const GOAL_HEIGHT = { tall: 222.7 * IN_PER_MM, short: 146.5 * IN_PER_MM, alliance: 82.5 * IN_PER_MM };
export const TOGGLE_LENGTH = 25.8;
export const TOGGLE_FACE = 2.05;
export const CUP = { r: 3.15 / 2, height: 6.5, mass: 0.078 };
/** A Pin is two truncated cones (1.3" at the tip, 2.2" at the middle) with a 3.1" flange where they meet; 6.5" long. */
export const PIN = { r: 1.0, length: 6.5, half: 2.2, mass: 0.073, flange: 3.1 };
export const MIDFIELD_HALF_DIAGONAL = 24;
export const LOAD_ZONE = { inner: 60.9, depth: 24 }; // outer tape edge x = +-60.9 (11.1" wide), 24" along the wall
const HALF = 72;

export type Quadrant = "N" | "E" | "S" | "W";
export function quadrantOf(x: number, y: number): Quadrant {
  return Math.abs(y) > Math.abs(x) ? (y > 0 ? "N" : "S") : x > 0 ? "E" : "W";
}

/** The Goal footprint: a square with chamfered corners (an octagon with long N/E/S/W flats). */
export function goalOutline(x: number, y: number, pad = 0): Vec[] {
  const h = GOAL_ACROSS_FLATS / 2 + pad, c = GOAL_CHAMFER + pad * 0.4;
  return [
    { x: x + h, y: y - (h - c) }, { x: x + h, y: y + (h - c) }, { x: x + (h - c), y: y + h }, { x: x - (h - c), y: y + h },
    { x: x - h, y: y + (h - c) }, { x: x - h, y: y - (h - c) }, { x: x - (h - c), y: y - h }, { x: x + (h - c), y: y - h },
  ];
}

// ---- goals (on the 24" grid; the tall center Goal is the origin)
const goalDefs: Omit<GoalState, "stack">[] = [
  { id: "tall", x: 0, y: 0, kind: "tall", height: GOAL_HEIGHT.tall, reach: 11 },
  { id: "short-N", x: -24, y: 48, kind: "short", height: GOAL_HEIGHT.short, reach: 11 },
  { id: "short-W", x: -48, y: 24, kind: "short", height: GOAL_HEIGHT.short, reach: 11 },
  { id: "short-S", x: 24, y: -48, kind: "short", height: GOAL_HEIGHT.short, reach: 11 },
  { id: "short-E", x: 48, y: -24, kind: "short", height: GOAL_HEIGHT.short, reach: 11 },
  { id: "red-S", x: -24, y: -48, kind: "alliance", alliance: "red", height: GOAL_HEIGHT.alliance, reach: 11 },
  { id: "red-W", x: -48, y: -24, kind: "alliance", alliance: "red", height: GOAL_HEIGHT.alliance, reach: 11 },
  { id: "blue-N", x: 24, y: 48, kind: "alliance", alliance: "blue", height: GOAL_HEIGHT.alliance, reach: 11 },
  { id: "blue-E", x: 48, y: 24, kind: "alliance", alliance: "blue", height: GOAL_HEIGHT.alliance, reach: 11 },
];

// ---- Toggles ride on top of the Field Perimeter (outside the tiles), centered on each wall
const toggleDefs: ToggleState[] = [
  { id: "toggle-N", x: 0, y: HALF, wall: "N", state: "yellow" },
  { id: "toggle-E", x: HALF, y: 0, wall: "E", state: "yellow" },
  { id: "toggle-S", x: 0, y: -HALF, wall: "S", state: "yellow" },
  { id: "toggle-W", x: -HALF, y: 0, wall: "W", state: "yellow" },
];

// ---- Loaders: small trapezoid chutes on the perimeter, 4.4" wide at the wall narrowing to 3.0" over 3.8"
export const LOADER = { y: 60.2, wallWidth: 4.4, tipWidth: 3.0, depth: 3.8 };
const loaderDefs = [
  { id: "loader-red-N", side: -1, y: LOADER.y }, { id: "loader-red-S", side: -1, y: -LOADER.y },
  { id: "loader-blue-N", side: 1, y: LOADER.y }, { id: "loader-blue-S", side: 1, y: -LOADER.y },
];
export function loaderOutline(side: number, y: number): Vec[] {
  const w = HALF * side, t = (HALF - LOADER.depth) * side;
  return [{ x: w, y: y - LOADER.wallWidth / 2 }, { x: t, y: y - LOADER.tipWidth / 2 }, { x: t, y: y + LOADER.tipWidth / 2 }, { x: w, y: y + LOADER.wallWidth / 2 }];
}

const obstacles: Obstacle[] = [
  ...goalDefs.map((g) => ({ x: g.x, y: g.y, w: GOAL_ACROSS_FLATS, h: GOAL_ACROSS_FLATS, label: g.id, verts: goalOutline(g.x, g.y), tag: `goal:${g.id}` })),
  ...loaderDefs.map((l) => {
    const verts = loaderOutline(l.side, l.y);
    return { x: (HALF - LOADER.depth / 2) * l.side, y: l.y, w: LOADER.depth, h: LOADER.wallWidth, label: l.id, verts, tag: "loader" };
  }),
];

// ---- starting objects (from the official top-down graphic)
type Obj = GameModule["objects"][number];
let nextId = 1;
const objects: Obj[] = [];
const add = (o: Omit<Obj, "id">): Obj => { const full = { id: nextId++, ...o } as Obj; objects.push(full); return full; };
const cup = (x: number, y: number, opaqueUp: boolean): Obj => add({ kind: "cup", team: "neutral", x, y, r: CUP.r, mass: CUP.mass, drag: 30, opaqueUp });
/** A Pin standing upright: `halves` are [lower, upper]; `flip` swaps which half is up. */
const standingPin = (x: number, y: number, a: string, b: string, extra: Partial<Obj> = {}): Obj =>
  add({ kind: "pin", team: a === "yellow" && b === "yellow" ? "neutral" : a === "yellow" ? (b as "red" | "blue") : (a as "red" | "blue"), x, y, r: PIN.r, mass: PIN.mass, drag: 30, halves: [a, b], flip: false, ...extra });
/** A Pin lying on the floor pointing `angle` degrees (0 = +y, clockwise) with its halves[1] end farthest out. */
const lyingPin = (x: number, y: number, a: string, b: string, angle: number): Obj =>
  standingPin(x, y, a, b, { lying: true, half: PIN.half, angle });

// 24 Cups (gray half up) in eight touching triples along the perimeter, each triple centered 24.2" from the wall's middle,
// with a yellow Pin standing in the middle Cup
const WALL_CUP = HALF - CUP.r - 0.05;
const TRIPLE = 3.2;
for (const wall of ["N", "E", "S", "W"] as const) {
  const sgn = wall === "N" || wall === "E" ? 1 : -1;
  for (const side of [-1, 1]) {
    const c = side * 24.2;
    for (const k of [-1, 0, 1]) {
      const along = c + k * TRIPLE;
      const [x, y] = wall === "N" || wall === "S" ? [along, sgn * WALL_CUP] : [sgn * WALL_CUP, along];
      const cp = cup(x, y, true);
      if (k === 0) standingPin(x, y, "yellow", "yellow", { nestedIn: cp.id });
    }
  }
}
// four Cups (clear half up) on the Autonomous Line, each with four Pins lying radially: yellow end at the Cup, colored end out
// (north/east: blue, south/west: red)
const CLUSTER_R = 4.9;
for (const [cx, cy] of [[-24, 24], [24, -24], [48, -48], [-48, 48]] as const) {
  cup(cx, cy, false);
  lyingPinRing(cx, cy);
}
function lyingPinRing(cx: number, cy: number): void {
  const dirs: [number, number, number, string][] = [[0, 1, 0, "blue"], [1, 0, 90, "blue"], [0, -1, 180, "red"], [-1, 0, 270, "red"]];
  for (const [dx, dy, ang, tip] of dirs) lyingPin(cx + dx * CLUSTER_R, cy + dy * CLUSTER_R, "yellow", tip, ang);
}
// four yellow Pins standing in Cups on the Quadrant-boundary diagonal
for (const [cx, cy] of [[24, 24], [-24, -24], [48, 48], [-48, -48]] as const) {
  const cp = cup(cx, cy, false);
  standingPin(cx, cy, "yellow", "yellow", { nestedIn: cp.id });
}
// four red/blue Pins standing in Cups on the corners of the Midfield: blue up on the N and E, red up on the S and W
for (const [cx, cy, blueUp] of [[0, 24, true], [24, 0, true], [0, -24, false], [-24, 0, false]] as const) {
  const cp = cup(cx, cy, false);
  standingPin(cx, cy, "red", "blue", { nestedIn: cp.id, flip: !blueUp });
}
// five yellow Pins start Placed in the neutral Goals (the four short ones and the tall center Goal)
for (const g of goalDefs.filter((q) => q.kind !== "alliance")) standingPin(g.x, g.y, "yellow", "yellow", { stackedIn: g.id });

// ---- rules
const overrideRules: GameRules = {
  canStack(goal, item) {
    const top = goal.stack[goal.stack.length - 1];
    if (item.kind === "pin") return !top || top.kind === "cup"; // Pin into an empty Goal, or into a Cup's open socket
    if (item.kind === "cup") return !!top && top.kind === "pin"; // Cup over a Pin's exposed half
    return false;
  },
  possession: { pin: 1, cup: 1 }, // SG6
};

// ---- scoring (manual SC1-SC8)
interface Half { color: string; visible: boolean }

/** Both halves of every Placed Pin in a Goal, with the visibility rule from SC3 (hidden inside a Cup's opaque half). */
export function stackHalves(goal: Pick<GoalState, "stack">): Half[] {
  const out: Half[] = [];
  goal.stack.forEach((item, i) => {
    if (item.kind !== "pin" || !item.halves) return;
    const lower = item.flip ? item.halves[1] : item.halves[0];
    const upper = item.flip ? item.halves[0] : item.halves[1];
    const below = goal.stack[i - 1];
    const above = goal.stack[i + 1];
    // a Cup's upper socket holds the Pin above it; the upper socket is the opaque one when opaqueUp
    const lowerHidden = below?.kind === "cup" && !!below.opaqueUp;
    // the Cup above covers this Pin's top half with its lower socket, which is opaque when !opaqueUp
    const upperHidden = above?.kind === "cup" && !above.opaqueUp;
    out.push({ color: lower, visible: !lowerHidden }, { color: upper, visible: !upperHidden });
  });
  return out;
}

const MID = [{ x: MIDFIELD_HALF_DIAGONAL, y: 0 }, { x: 0, y: MIDFIELD_HALF_DIAGONAL }, { x: -MIDFIELD_HALF_DIAGONAL, y: 0 }, { x: 0, y: -MIDFIELD_HALF_DIAGONAL }];

const robotCorners = (w: World): Vec[] => corners({ x: w.robot.x, y: w.robot.y, heading: w.robot.heading, hl: w.robotBox.hl, hw: w.robotBox.hw });

export function robotInMidfield(w: World): boolean {
  return polysOverlap(robotCorners(w), MID);
}

export function robotTouchesPerimeter(w: World): boolean {
  return robotCorners(w).some((c) => Math.abs(c.x) >= HALF - 0.35 || Math.abs(c.y) >= HALF - 0.35);
}

/** Which side of the Autonomous Line (y = -x): red is x + y < 0 (the W and S quadrants), blue is x + y > 0. */
export const sideOfLine = (x: number, y: number): "red" | "blue" | "line" => (Math.abs(x + y) < 1e-6 ? "line" : x + y < 0 ? "red" : "blue");

export function overrideScore(world: World): ScoreResult {
  const mine = world.alliance;
  const inMid = robotInMidfield(world);
  const lines: ScoreResult["lines"] = [];
  let red = 0, blue = 0;
  let redHalves = 0, blueHalves = 0, yellowOwnedRed = 0, yellowOwnedBlue = 0, yellowUnowned = 0;
  let scoredMine = 0; // for the Autonomous Win Point
  let goalsWith2 = 0;
  for (const g of world.goals) {
    const q = quadrantOf(g.x, g.y);
    const isMid = g.kind === "tall";
    const toggle = world.toggles.find((t) => t.wall === q)?.state ?? "yellow";
    // SC5: yellow Pins are Owned via the Quadrant's Toggle, or in the Midfield by the Alliance with more Robots there
    const owner: "red" | "blue" | null = isMid ? (inMid ? mine : null) : toggle === "red" ? "red" : toggle === "blue" ? "blue" : null;
    let mineHere = 0;
    for (const h of stackHalves(g)) {
      if (!h.visible) continue;
      if (h.color === "red") { red += 5; redHalves++; if (mine === "red" && sideOfLine(g.x, g.y) !== "blue") mineHere++; }
      else if (h.color === "blue") { blue += 5; blueHalves++; if (mine === "blue" && sideOfLine(g.x, g.y) !== "red") mineHere++; }
      else if (h.color === "yellow") {
        if (owner === "red") { red += 10; yellowOwnedRed++; if (mine === "red") mineHere++; }
        else if (owner === "blue") { blue += 10; yellowOwnedBlue++; if (mine === "blue") mineHere++; }
        else yellowUnowned++;
      }
    }
    scoredMine += mineHere;
    if (mineHere >= 2) goalsWith2++;
  }
  if (redHalves || blueHalves) lines.push({ label: "Alliance-color Pin halves (5 pts)", red: redHalves * 5, blue: blueHalves * 5 });
  if (yellowOwnedRed || yellowOwnedBlue) lines.push({ label: "Owned yellow Pin halves (10 pts)", red: yellowOwnedRed * 10, blue: yellowOwnedBlue * 10 });
  if (inMid) { if (mine === "red") red += 8; else blue += 8; lines.push({ label: "Robot ending in the Midfield (8 pts)", red: mine === "red" ? 8 : 0, blue: mine === "blue" ? 8 : 0 }); }
  const notes: string[] = [];
  if (yellowUnowned) notes.push(`${yellowUnowned} yellow Pin half/halves are not Owned (set that Quadrant's Toggle to your color, or hold the Midfield) and score nothing.`);
  const awpPins = 6, awpGoals = 2;
  const awpOk = scoredMine >= awpPins && goalsWith2 >= awpGoals && !robotTouchesPerimeter(world);
  notes.push(`Autonomous Win Point (standard events): ${awpOk ? "MET" : "not met"} - your Alliance needs ${awpPins}+ scored Pins (you have ${scoredMine}), ${awpGoals}+ Goals with 2+ scored Pins (you have ${goalsWith2}), and no Robot touching the perimeter${robotTouchesPerimeter(world) ? " (yours is)" : ""}. Pins on the opposing side of the Autonomous Line don't count.`);
  notes.push("Autonomous Bonus (12 pts) goes to the Alliance with more points when auton ends; Midfield points don't count toward it (SC7).");
  return { red, blue, lines, notes };
}

// ---- rule checks for a finished run
export function overrideChecks({ routine, cfg, recording, world }: { routine: import("../core/routine").Routine; cfg: import("../core/robot").RobotConfig; recording: import("../core/runtime").Recording; world: World }): RuleFinding[] {
  const out: RuleFinding[] = [];
  const mine = routine.alliance;
  const start = { x: routine.start.x, y: routine.start.y, heading: routine.start.heading, hl: cfg.length / 2, hw: cfg.width / 2 };
  const startPoly = corners(start);
  // SG2: never larger than 24" x 24" during the match, including deployed intakes/arms
  const reach = cfg.intake?.reach ?? 0;
  if (cfg.length + reach > 24 || cfg.width > 24) out.push({ level: "warn", text: `Robot length ${cfg.length}" plus the ${reach}" intake reach is ${cfg.length + reach}" - the Robot may never exceed 24" x 24" during the Match (SG2)`, step: -1 });
  // SG1: legal start
  for (const o of obstacles) {
    if ((o.tag?.startsWith("goal:") || o.tag === "loader" || o.tag === "toggle") && polysOverlap(startPoly, o.verts ?? rectVerts(o.x, o.y, o.w, o.h))) { out.push({ level: "error", text: `Start pose touches ${o.label} - a Robot may not start in contact with Goals, Loaders or Toggles (SG1c)`, step: -1 }); break; }
  }
  if (!startPoly.some((c) => Math.abs(c.x) >= HALF - 0.5 || Math.abs(c.y) >= HALF - 0.5)) out.push({ level: "warn", text: "Start pose should be touching the Field Perimeter (SG1f)", step: -1 });
  if (startPoly.some((c) => sideOfLine(c.x, c.y) === (mine === "red" ? "blue" : "red"))) out.push({ level: "error", text: `Start pose is not fully on the ${mine} side of the Autonomous Line (SG1f)`, step: -1 });

  // SG7 / SG9 during the run
  let crossed = false, hitGoal = false, hitOpposingObject = false;
  for (const f of recording.frames) {
    const poly = corners({ x: f.x, y: f.y, heading: f.heading, hl: cfg.length / 2, hw: cfg.width / 2 });
    if (!crossed && poly.some((c) => sideOfLine(c.x, c.y) === (mine === "red" ? "blue" : "red"))) {
      crossed = true;
      out.push({ level: "error", text: `Robot crosses the Autonomous Line onto the ${mine === "red" ? "blue" : "red"} side at ${f.t.toFixed(1)} s. Robots may not contact tiles or objects on the opposing side during auton (SG7); the opposing Alliance gets the Autonomous Bonus.`, step: f.step });
    }
    if (!hitGoal) {
      for (const g of world.goals) {
        if (g.alliance && g.alliance !== mine) {
          const gp = goalOutline(g.x, g.y, 0.2);
          if (polysOverlap(poly, gp)) { hitGoal = true; out.push({ level: "error", text: `Robot contacts the opposing Alliance Goal (${g.id}) at ${f.t.toFixed(1)} s (SG9)`, step: f.step }); break; }
        }
      }
    }
    if (!hitOpposingObject && !crossed) {
      // objects lying on the opposing side (not on the line) that the robot's footprint reaches
      for (let i = 0; i < world.objects.length; i++) {
        const ox = f.objs[i * 3], oy = f.objs[i * 3 + 1], st = f.objs[i * 3 + 2];
        if (st !== 0) continue;
        if (sideOfLine(ox, oy) === (mine === "red" ? "blue" : "red") && Math.abs(ox + oy) > 6 && pointInConvex(poly, ox, oy)) { hitOpposingObject = true; out.push({ level: "warn", text: `Robot contacts an object on the opposing side of the Autonomous Line at ${f.t.toFixed(1)} s (SG7)`, step: f.step }); break; }
      }
    }
  }
  if (recording.duration > 15.05) out.push({ level: "warn", text: `Routine lasts ${recording.duration.toFixed(1)} s but the Autonomous Period is 15 s`, step: -1 });
  for (const e of world.events) if (e.type === "reject") out.push({ level: "warn", text: `Could not ${e.text ?? "act"} at ${e.t.toFixed(1)} s`, step: -1 });
  return out;
}


const MID_EDGE = 0.4; // tape half-width: the Midfield is bounded by the tape's inner edge
const polys: FieldPoly[] = [
  { verts: MID.map((v) => ({ x: v.x * (1 - MID_EDGE / MIDFIELD_HALF_DIAGONAL), y: v.y * (1 - MID_EDGE / MIDFIELD_HALF_DIAGONAL) })), label: "Midfield", fill: "#00000000", stroke: "#c1c8e2", strokeWidth: 0.8 },
  // Load Zones: corner rectangles bounded by the perimeter and a 3-sided tape line
  ...[[-1, 1], [-1, -1], [1, 1], [1, -1]].map(([sx, sy]) => {
    const red = sx < 0, edge = HALF - LOAD_ZONE.depth;
    return {
      verts: [{ x: sx * HALF, y: sy * edge }, { x: sx * LOAD_ZONE.inner, y: sy * edge }, { x: sx * LOAD_ZONE.inner, y: sy * HALF }],
      closed: false, label: "Load Zone", fill: "#00000000", stroke: red ? "#c0273b" : "#2b85b3", strokeWidth: 0.9,
    } as FieldPoly;
  }),
];

const TAPE = "#c1c8e2";
/** The Autonomous Line: a pair of tapes 1.8" apart running corner to Midfield along y = -x, plus the single Quadrant line along y = x */
const lines: FieldLine[] = [];
{
  const start = LOAD_ZONE.inner - 0.4; // the tapes begin at the inner edge of the Load Zone tape
  const gap = 0.9 * Math.SQRT2; // the pair sits 0.9" either side of y = -x, i.e. y = -x +- 1.27
  // NW band (x < 0) and SE band (x > 0), each ending on the Midfield tape (y = x + 24 / y = x - 24)
  for (const c of [gap, -gap]) {
    const xe = (c - MIDFIELD_HALF_DIAGONAL) / 2; // -x + c = x + 24  ->  x = (c - 24) / 2
    lines.push({ x1: -start, y1: start + c, x2: xe, y2: -xe + c, color: TAPE, width: 0.8 });
    const xs = (c + MIDFIELD_HALF_DIAGONAL) / 2; // -x + c = x - 24 -> x = (c + 24) / 2
    lines.push({ x1: start, y1: -start + c, x2: xs, y2: -xs + c, color: TAPE, width: 0.8 });
  }
  // the single Quadrant line along y = x, corner to Midfield (it meets the diamond at 12,12)
  const m = MIDFIELD_HALF_DIAGONAL / 2;
  lines.push({ x1: -start, y1: -start, x2: -m, y2: -m, color: TAPE, width: 0.6 }, { x1: start, y1: start, x2: m, y2: m, color: TAPE, width: 0.6 });
}

export const override: GameModule = {
  id: "override",
  name: "Override",
  season: "2026-27",
  manualVersion: "2.0 (text) + official top-down field graphic",
  fieldSize: { value: 144, verified: true, source: "Game Manual v2.0: 12' x 12' Field, 6x6 tile floor" },
  autonSeconds: { value: 15, verified: true, source: "Game Manual v2.0, Primer" },
  driverSeconds: { value: 105, verified: true, source: "Game Manual v2.0, Primer (1:45)" },
  robotRules: { totalCapW: 88, drivetrainCapW: 55, verified: true },
  startingSize: { value: 18, verified: true, source: "Game Manual v2.0 <SG1a>: 18\" x 18\" x 18\"" },
  layoutApproximate: false,
  mirror: "rotate", // red and blue Goals swap under a 180-degree turn, not a left-right flip
  zones: [],
  starts: [
    // one Robot per Quadrant (SG1d); red starts in the W and S Quadrants, blue in N and E (their Alliance Goals are there)
    { label: "Red · West quadrant", x: -(HALF - 7.5), y: 38, heading: 90, alliance: "red" },
    { label: "Red · South quadrant", x: -38, y: -(HALF - 7.5), heading: 0, alliance: "red" },
    { label: "Blue · North quadrant", x: 38, y: HALF - 7.5, heading: 180, alliance: "blue" },
    { label: "Blue · East quadrant", x: HALF - 7.5, y: -38, heading: 270, alliance: "blue" },
  ],
  lines,
  polys,
  objects,
  obstacles,
  goals: goalDefs,
  toggles: toggleDefs,
  rules: overrideRules,
  preload: (alliance) => ({ id: 9000, kind: "pin", team: alliance, x: 0, y: 0, r: PIN.r, mass: PIN.mass, drag: 30, halves: [alliance, "yellow"], flip: false, held: true }),
  score: overrideScore,
  check: overrideChecks,
  notes: [
    "Layout taken from VEX's official top-down Override field graphic: 36 Cups and 37 Pins (Match Loads excluded) - 24 gray-up Cups in eight touching triples along the perimeter (a yellow Pin stands in each middle Cup), four clear-up Cups on the Autonomous Line each ringed by four lying Pins, four yellow Pin-and-Cup stacks on the Quadrant diagonal, four red/blue Pin-and-Cup stacks on the Midfield corners, and one yellow Pin already Placed in each of the five neutral Goals.",
    "Motor rules verified in the manual: 88 W total on the whole Robot (R10a) and 55 W for the drivetrain motors (R11a); drivetrain motors may not power other mechanisms (R11b). Starting size 18\" cube (SG1a), 24\" x 24\" limit during the Match (SG2), 50\" height (SG3).",
    "Read from the manual (v2.0): scoring rules SC1-SC8 (Pins nest into Goals and Cups; each visible Pin half scores 5, yellow halves 10 when Owned via the Toggle or Midfield; Robot in the Midfield 8; Autonomous Bonus 12; Autonomous Win Point), starting rules SG1-SG13, and element dimensions.",
    "Goals and Loaders are solid; Toggles ride on top of the Field Perimeter. Lying Pins collide along their full 6.5\" length. A Cup with a Pin standing in it is picked up together (the intake needs room for both). Place a held object with the Place action (in front of a Goal); flip a Toggle with the Toggle action (front of the robot against that wall).",
    "Match Loads (introduced through Loaders in the Driver Period) are not simulated; Loaders are obstacles only.",
  ],
  provenance: [
    { item: "Field, tiles, periods, Cup/Pin/Goal-height/Toggle dimensions, scoring and starting rules", source: "Game Manual v2.0 text", confidence: "manual" },
    { item: "Positions, shapes and colors of Goals, Cups, Pins, Loaders, Toggles, Load Zones, Autonomous Line and Midfield", source: "VEX official top-down Override field graphic, measured in pixels (accuracy about 0.2\")", confidence: "community" },
    { item: "Goals sit on the 24\" grid; footprint is a 5.6\" square with 0.95\" chamfers", source: "graphic + community mesh data citing Appendix A", confidence: "community" },
    { item: "Pin physics (1.0\" radius, 4.4\" collision spine when lying) and mass; Loader collision box", source: "assumed from the graphic's silhouettes", confidence: "assumed" },
  ],
};

export type { Vec };
