/**
 * VEX V5RC Override (2026-27). Sources, by confidence:
 *  - manual (Game Manual v2.0): field 12'x12' on a 6x6 array of 24" tiles; Cup 3.15" x 6.5" (two halves, one clear one
 *    opaque); Pin ~1.6" x 6.5" (two colored halves); Goals are octagonal, 8.7" (center) / 5.8" (neutral) / 3.25"
 *    (Alliance) tall; Toggles 25.8" long with ~2.05" faces on the Field Perimeter at each wall's center; 4 Loaders;
 *    scoring rules SC1-SC8, starting/expansion rules SG1-SG13; object counts (see bill of materials below).
 *  - community: goal/toggle/loader POSITIONS on the 24" grid (three independent public sources derived from VEX's official
 *    VR playground data agree), goal footprint (142.5 mm across flats), Midfield size, and the STARTING LAYOUT of the
 *    on-field Pins/Cups (a reconstruction of Figure FO-2, consistent with the manual's counts).
 *  - assumed: Loader footprint, Load Zone size, Pin physics radius.
 * Appendix A's dimensioned drawings and Figure FO-2 are images and could not be read.
 */
import { corners, pointInConvex, polysOverlap, rectVerts, regularPolygon, type Vec } from "../core/geometry";
import type { GameRules, GoalState, Obstacle, ToggleState, World } from "../core/world";
import type { FieldPoly, GameModule, RuleFinding, ScoreResult } from "./types";

const IN_PER_MM = 1 / 25.4;
export const GOAL_ACROSS_FLATS = 142.5 * IN_PER_MM; // 5.61"
export const GOAL_HEIGHT = { tall: 222.7 * IN_PER_MM, short: 146.5 * IN_PER_MM, alliance: 82.5 * IN_PER_MM };
export const TOGGLE_LENGTH = 25.8;
export const TOGGLE_FACE = 2.05;
export const CUP = { r: 3.15 / 2, height: 6.5, mass: 0.078 };
export const PIN = { r: 1.6 / 2, height: 6.5, mass: 0.073 };
export const MIDFIELD_HALF_DIAGONAL = 24; // community sources disagree (17 vs 24); 24 matches the official VR data
const HALF = 72;

type Obj = GameModule["objects"][number];
let nextId = 1;
const pin = (a: string, b: string, x: number, y: number, flip = false): Obj => ({
  id: nextId++, kind: "pin", team: a === "yellow" ? "neutral" : (a as "red" | "blue"), x, y, r: PIN.r, mass: PIN.mass, drag: 30, halves: [a, b], flip,
});
const cup = (x: number, y: number, opaqueUp: boolean): Obj => ({ id: nextId++, kind: "cup", team: "neutral", x, y, r: CUP.r, mass: CUP.mass, drag: 30, opaqueUp });

export type Quadrant = "N" | "E" | "S" | "W";
export function quadrantOf(x: number, y: number): Quadrant {
  return Math.abs(y) > Math.abs(x) ? (y > 0 ? "N" : "S") : x > 0 ? "E" : "W";
}

// ---- goals (positions: community, on the 24" grid; center Goal is the origin)
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

const toggleDefs: ToggleState[] = [
  { id: "toggle-N", x: 0, y: HALF - TOGGLE_FACE * 0.45, wall: "N", state: "yellow" },
  { id: "toggle-E", x: HALF - TOGGLE_FACE * 0.45, y: 0, wall: "E", state: "yellow" },
  { id: "toggle-S", x: 0, y: -(HALF - TOGGLE_FACE * 0.45), wall: "S", state: "yellow" },
  { id: "toggle-W", x: -(HALF - TOGGLE_FACE * 0.45), y: 0, wall: "W", state: "yellow" },
];

const LOADER_W = 13.4, LOADER_D = 9.4; // assumed footprint (along wall x depth)
const loaderDefs = [
  { id: "loader-red-N", x: -(HALF - LOADER_D / 2), y: 60 },
  { id: "loader-red-S", x: -(HALF - LOADER_D / 2), y: -60 },
  { id: "loader-blue-N", x: HALF - LOADER_D / 2, y: 60 },
  { id: "loader-blue-S", x: HALF - LOADER_D / 2, y: -60 },
];

const obstacles: Obstacle[] = [
  ...goalDefs.map((g) => ({ x: g.x, y: g.y, w: GOAL_ACROSS_FLATS, h: GOAL_ACROSS_FLATS, label: g.id, verts: regularPolygon(g.x, g.y, 8, GOAL_ACROSS_FLATS), tag: `goal:${g.id}` })),
  ...toggleDefs.map((t) => {
    const horizontal = t.wall === "N" || t.wall === "S";
    const w = horizontal ? TOGGLE_LENGTH : TOGGLE_FACE * 0.9;
    const h = horizontal ? TOGGLE_FACE * 0.9 : TOGGLE_LENGTH;
    return { x: t.x, y: t.y, w, h, label: t.id, tag: "toggle" };
  }),
  ...loaderDefs.map((l) => ({ x: l.x, y: l.y, w: LOADER_D, h: LOADER_W, label: l.id, tag: "loader" })),
];

// ---- starting objects (reconstruction of Figure FO-2; see header)
nextId = 1;
const objects: Obj[] = [];
const NEST = 2.6; // nested Pin-in-Cup pairs are modelled side by side (no compound bodies yet)
const stackAt = (x: number, y: number, opaqueUp: boolean, a: string, b: string) => {
  objects.push(cup(x, y, opaqueUp));
  objects.push(pin(a, b, x + NEST, y));
};
// four Cups on the Autonomous Line, each ringed by four sideways Pins (8 red/yellow + 8 blue/yellow)
const lineCups: [number, number][] = [[-24, 24], [24, -24], [48, -48], [-48, 48]];
const ring = [[-8, 0], [8, 0], [0, 8], [0, -8]];
const ringColors: [string, string][] = [["red", "yellow"], ["blue", "yellow"], ["blue", "yellow"], ["red", "yellow"]];
for (const [cx, cy] of lineCups) {
  objects.push(cup(cx, cy, false));
  ring.forEach(([dx, dy], i) => objects.push(pin(ringColors[i][0], ringColors[i][1], cx + dx, cy + dy)));
}
// four Cup+Pin stacks on the Midfield corners; Pins are red/blue
for (const [cx, cy] of [[0, MIDFIELD_HALF_DIAGONAL], [MIDFIELD_HALF_DIAGONAL, 0], [0, -MIDFIELD_HALF_DIAGONAL], [-MIDFIELD_HALF_DIAGONAL, 0]]) stackAt(cx, cy, false, "red", "blue");
// yellow stacks on the other diagonal
for (const [cx, cy] of [[24, 24], [-24, -24], [48, 48], [-48, -48]]) stackAt(cx, cy, false, "yellow", "yellow");
// toggle stacks: 6 gray-side-up Cups and 2 yellow Pins beside each Toggle
for (const wall of ["N", "E", "S", "W"] as const) {
  const sgn = wall === "N" || wall === "E" ? 1 : -1;
  const at = (t: number): [number, number] => (wall === "N" || wall === "S" ? [t, sgn * (HALF - 2.4)] : [sgn * (HALF - 2.4), t]);
  for (const t of [-24, -19.2, -14.4, 14.4, 19.2, 24]) { const [x, y] = at(t); objects.push(cup(x, y, true)); }
  for (const t of [-19.2, 19.2]) { const [x, y] = at(t); objects.push(pin("yellow", "yellow", x + (wall === "N" || wall === "S" ? 0 : sgn * -NEST), y + (wall === "N" || wall === "S" ? sgn * -NEST : 0))); }
}
// loose yellow Pins near the Midfield
for (const [x, y] of [[-36, 0], [-12, 0], [12, 0], [36, 0], [0, -12]]) objects.push(pin("yellow", "yellow", x, y));

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
          const gp = regularPolygon(g.x, g.y, 8, GOAL_ACROSS_FLATS + 0.4);
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

const polys: FieldPoly[] = [
  { verts: MID, label: "Midfield", fill: "#ffffff14", stroke: "#f5f5f5" },
  ...loaderDefs.map((l) => {
    const red = l.id.includes("red");
    const inner = red ? -(HALF - 24) : HALF - 24;
    return { verts: [{ x: red ? -HALF : HALF, y: l.y - 14 }, { x: inner, y: l.y - 14 }, { x: inner, y: l.y + 14 }, { x: red ? -HALF : HALF, y: l.y + 14 }], label: "Load Zone", fill: red ? "#e5484d14" : "#3e8bff14", stroke: red ? "#e5484d" : "#3e8bff" } as FieldPoly;
  }),
];

export const override: GameModule = {
  id: "override",
  name: "Override",
  season: "2026-27",
  manualVersion: "2.0 (text read; Appendix A drawings and Figure FO-2 are images, not read)",
  fieldSize: { value: 144, verified: true, source: "Game Manual v2.0: 12' x 12' Field, 6x6 tile floor" },
  autonSeconds: { value: 15, verified: true, source: "Game Manual v2.0, Primer" },
  driverSeconds: { value: 105, verified: true, source: "Game Manual v2.0, Primer (1:45)" },
  robotRules: { totalCapW: 88, drivetrainCapW: 55, verified: true },
  startingSize: { value: 18, verified: true, source: "Game Manual v2.0 <SG1a>: 18\" x 18\" x 18\"" },
  layoutApproximate: true,
  zones: [],
  starts: [
    // one Robot per Quadrant (SG1d); red starts in the W and S Quadrants, blue in N and E (their Alliance Goals are there)
    { label: "Red · West quadrant", x: -(HALF - 7.5), y: 38, heading: 90, alliance: "red" },
    { label: "Red · South quadrant", x: -38, y: -(HALF - 7.5), heading: 0, alliance: "red" },
    { label: "Blue · North quadrant", x: 38, y: HALF - 7.5, heading: 180, alliance: "blue" },
    { label: "Blue · East quadrant", x: HALF - 7.5, y: -38, heading: 270, alliance: "blue" },
  ],
  lines: [
    { x1: -HALF, y1: HALF, x2: HALF, y2: -HALF, color: "#f5f5f5" }, // Autonomous Line (y = -x)
    { x1: -HALF, y1: -HALF, x2: HALF, y2: HALF, color: "#f5f5f588" }, // Quadrant boundary (y = x)
  ],
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
    "Motor rules verified in the manual: 88 W total on the whole Robot (R10a) and 55 W for the drivetrain motors (R11a); drivetrain motors may not power other mechanisms (R11b). Starting size 18\" cube (SG1a), 24\" x 24\" limit during the Match (SG2), 50\" height (SG3).",
    "Read from the manual (v2.0): scoring rules SC1-SC8 (Pins nest into Goals and Cups; each visible Pin half scores 5, yellow halves 10 when Owned via the Toggle or Midfield; Robot in the Midfield 8; Autonomous Bonus 12; Autonomous Win Point), starting rules SG1-SG13, and element dimensions (Cup 3.15\" x 6.5\", Pin 1.6\" x 6.5\", Goal heights 8.7/5.8/3.25\", Toggle 25.8\").",
    "Goals, Toggles and Loaders are solid: Robots and objects collide with the octagonal Goals, Toggle bars and Loader boxes. Place a held object with the Place action (in front of a Goal) and flip a Toggle with the Toggle action (in front of a wall Toggle).",
    "NOT verified: the exact starting positions of every Pin and Cup (Figure FO-2 is an image) - this is a community reconstruction that matches the manual's counts (37 Pins + 36 Cups on the Field, Match Loads excluded). Nested Pin-in-Cup starting stacks are modelled side by side.",
    "Match Loads (introduced through Loaders in the Driver Period) are not simulated; Loaders are obstacles only.",
  ],
  provenance: [
    { item: "Field, tiles, periods, Cup/Pin/Goal-height/Toggle dimensions, scoring and starting rules", source: "Game Manual v2.0 text", confidence: "manual" },
    { item: "Goal, Toggle and Loader positions on the 24\" grid", source: "three community projects derived from VEX's official VR field data", confidence: "community" },
    { item: "Goal footprint 5.61\" across flats", source: "community mesh generator citing Appendix A", confidence: "community" },
    { item: "Midfield diamond (half-diagonal 24\") and Autonomous Line along y = -x", source: "community + manual quadrant/side definitions; sources disagree on Midfield size", confidence: "community" },
    { item: "Starting positions of Pins and Cups", source: "community reconstruction of Figure FO-2", confidence: "community" },
    { item: "Loader footprint, Load Zone size, Pin physics radius", source: "assumed", confidence: "assumed" },
  ],
};

export type { Vec };
