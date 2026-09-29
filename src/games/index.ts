import type { GameObject, Team, World } from "../core/world";
import type { GameModule, ScoreResult, ScoringZone, StartPosition } from "./types";

const U = (value: number) => ({ value, verified: false });
type Obj = GameModule["objects"][number];

let nextId = 1;
const obj = (kind: string, team: Team, x: number, y: number, r: number, mass: number, extra: Partial<Obj> = {}): Obj =>
  ({ id: nextId++, kind, team, x, y, r, mass, drag: 45, ...extra });

const inZone = (z: ScoringZone, o: GameObject): boolean =>
  z.geom.shape === "rect"
    ? Math.abs(o.x - z.geom.x) <= z.geom.w / 2 && Math.abs(o.y - z.geom.y) <= z.geom.h / 2
    : Math.hypot(o.x - z.geom.x, o.y - z.geom.y) <= z.geom.r;

/** Points for objects resting in zones, split by object team. */
export function zoneScore(world: World, zones: ScoringZone[], colorOfNeutral?: (z: ScoringZone) => "red" | "blue" | null): ScoreResult {
  const lines: ScoreResult["lines"] = [];
  let red = 0, blue = 0;
  for (const z of zones) {
    let r = 0, b = 0, count = 0;
    for (const o of world.objects) {
      if (o.state !== "field" || !z.accepts.includes(o.kind) || !inZone(z, o)) continue;
      if (Math.hypot(o.vx, o.vy) > 3) continue; // still moving
      if (z.capacity !== undefined && count >= z.capacity) break;
      count++;
      const owner = o.team === "neutral" ? colorOfNeutral?.(z) ?? null : o.team;
      if (owner === "red") r += z.points;
      else if (owner === "blue") b += z.points;
    }
    if (r || b) lines.push({ label: z.label, red: r, blue: b });
    red += r; blue += b;
  }
  return { red, blue, lines };
}

const sym = <T>(f: (side: 1 | -1) => T): T[] => [f(-1), f(1)];

// ------------------------------------------------------------------------------------ blank

export const blank: GameModule = {
  id: "blank",
  name: "Blank field",
  season: "-",
  manualVersion: null,
  fieldSize: { value: 144, verified: true, source: "V5RC field is 12'x12'" },
  autonSeconds: { value: 15, verified: true, source: "V5RC autonomous period is 15 s (Push Back / High Stakes)" },
  driverSeconds: U(105),
  robotRules: { totalCapW: 88, drivetrainCapW: null, verified: false },
  startingSize: { value: 18, verified: true, source: "V5RC 18\" starting cube (long-standing rule)" },
  layoutApproximate: false,
  zones: [],
  starts: [
    { label: "Red left", x: -48, y: -58, heading: 0, alliance: "red" },
    { label: "Red right", x: -24, y: -58, heading: 0, alliance: "red" },
    { label: "Blue left", x: 24, y: -58, heading: 0, alliance: "blue" },
    { label: "Blue right", x: 48, y: -58, heading: 0, alliance: "blue" },
  ],
  lines: [],
  objects: [],
  obstacles: [],
  score: () => ({ red: 0, blue: 0, lines: [] }),
  notes: ["No game elements."],
};

// ------------------------------------------------------------------------------------ High Stakes (24/25)

nextId = 1;
const highStakesObjects: Obj[] = [
  // 5 mobile goals (clampable). Positions are approximate.
  obj("mobile-goal", "neutral", -24, 24, 6.5, 1.6, { carriable: true }),
  obj("mobile-goal", "neutral", 24, 24, 6.5, 1.6, { carriable: true }),
  obj("mobile-goal", "neutral", -24, -24, 6.5, 1.6, { carriable: true }),
  obj("mobile-goal", "neutral", 24, -24, 6.5, 1.6, { carriable: true }),
  obj("mobile-goal", "neutral", 0, 0, 6.5, 1.6, { carriable: true }),
];
// 48 rings, 24 per color, laid out in rows (approximate)
for (let i = 0; i < 24; i++) {
  const col = i % 12, row = Math.floor(i / 12);
  highStakesObjects.push(obj("ring", "red", -55 + col * 10, 40 - row * 9, 3.5, 0.06));
  highStakesObjects.push(obj("ring", "blue", -55 + col * 10, -40 + row * 9, 3.5, 0.06));
}
// mobile goals accept rings within their footprint (scored as 1 pt each, approximate)
export const highStakes: GameModule = {
  id: "high-stakes",
  name: "High Stakes",
  season: "2024-25",
  manualVersion: null,
  fieldSize: { value: 144, verified: true, source: "V5RC field is 12'x12'" },
  autonSeconds: { value: 15, verified: true },
  driverSeconds: { value: 105, verified: true },
  robotRules: { totalCapW: 88, drivetrainCapW: null, verified: false },
  startingSize: U(18),
  layoutApproximate: true,
  zones: [
    { id: "stake-n", label: "Wall stake (N)", geom: { shape: "circle", x: 0, y: 70, r: 5 }, accepts: ["ring"], points: 3, color: "#e2b93b" },
    { id: "stake-s", label: "Wall stake (S)", geom: { shape: "circle", x: 0, y: -70, r: 5 }, accepts: ["ring"], points: 3, color: "#e2b93b" },
    { id: "stake-e", label: "Wall stake (E)", geom: { shape: "circle", x: 70, y: 0, r: 5 }, accepts: ["ring"], points: 3, color: "#e2b93b" },
    { id: "stake-w", label: "Wall stake (W)", geom: { shape: "circle", x: -70, y: 0, r: 5 }, accepts: ["ring"], points: 3, color: "#e2b93b" },
  ],
  starts: [
    { label: "Red left", x: -48, y: -56, heading: 0, alliance: "red" },
    { label: "Red right", x: -24, y: -56, heading: 0, alliance: "red" },
    { label: "Blue left", x: 24, y: -56, heading: 0, alliance: "blue" },
    { label: "Blue right", x: 48, y: -56, heading: 0, alliance: "blue" },
  ],
  lines: [],
  objects: highStakesObjects,
  obstacles: [],
  score(world) {
    const base = zoneScore(world, this.zones);
    // Rings within a mobile goal's footprint score 1 pt each for their own color (approximation)
    let r = 0, b = 0;
    for (const g of world.objects.filter((o) => o.kind === "mobile-goal")) {
      for (const o of world.objects) {
        if (o.kind !== "ring" || o.state !== "field") continue;
        if (Math.hypot(o.x - g.x, o.y - g.y) <= g.r) { if (o.team === "red") r++; else if (o.team === "blue") b++; }
      }
    }
    if (r || b) base.lines.push({ label: "Rings on mobile goals", red: r, blue: b });
    base.red += r; base.blue += b;
    return base;
  },
  notes: [
    "Layout is an APPROXIMATE practice layout, not from the manual. Counts (48 rings, 5 mobile goals) match the game; positions and scoring values are simplified. Import a corrected field JSON to refine.",
  ],
};

// ------------------------------------------------------------------------------------ Push Back (25/26)

nextId = 1;
const pushBackZones: ScoringZone[] = [
  ...sym((s) => ({ id: `long-${s}`, label: s < 0 ? "Long goal (W)" : "Long goal (E)", geom: { shape: "rect" as const, x: s * 44, y: 0, w: 8, h: 44 }, accepts: ["block"], points: 3, color: "#e2b93b" })),
  { id: "center-upper", label: "Center goal (upper)", geom: { shape: "rect", x: 0, y: 12, w: 14, h: 8 }, accepts: ["block"], points: 3, color: "#e2b93b" },
  { id: "center-lower", label: "Center goal (lower)", geom: { shape: "rect", x: 0, y: -12, w: 14, h: 8 }, accepts: ["block"], points: 3, color: "#e2b93b" },
];
const pushBackObjects: Obj[] = [];
for (let i = 0; i < 44; i++) {
  const col = i % 11, row = Math.floor(i / 11);
  pushBackObjects.push(obj("block", "red", -55 + col * 11, 28 + row * 5, 1.75, 0.09));
  pushBackObjects.push(obj("block", "blue", -55 + col * 11, -28 - row * 5, 1.75, 0.09));
}
export const pushBack: GameModule = {
  id: "push-back",
  name: "Push Back",
  season: "2025-26",
  manualVersion: null,
  fieldSize: { value: 144, verified: true, source: "RECF Push Back overview (12'x12')" },
  autonSeconds: { value: 15, verified: true, source: "RECF Push Back overview" },
  driverSeconds: { value: 105, verified: true, source: "RECF Push Back overview (1:45)" },
  robotRules: { totalCapW: 88, drivetrainCapW: null, verified: false },
  startingSize: U(18),
  layoutApproximate: true,
  zones: pushBackZones,
  starts: [
    { label: "Red left", x: -48, y: -58, heading: 0, alliance: "red" },
    { label: "Red right", x: -24, y: -58, heading: 0, alliance: "red" },
    { label: "Blue left", x: 24, y: -58, heading: 0, alliance: "blue" },
    { label: "Blue right", x: 48, y: -58, heading: 0, alliance: "blue" },
  ],
  lines: [],
  objects: pushBackObjects,
  obstacles: [],
  score: (w) => zoneScore(w, pushBackZones),
  notes: [
    "Verified: 12'x12' field, 88 Blocks worth 3 pts each in Goals, 2 Long + 2 Center Goals, 15 s auton.",
    "APPROXIMATE: goal positions/sizes and block placement are practice values, not from the manual. Zone-control and Park scoring are not modelled.",
  ],
};

// ------------------------------------------------------------------------------------ Override (26/27)

nextId = 1;
const overrideObjects: Obj[] = [];
for (let i = 0; i < 63; i++) {
  const col = i % 9, row = Math.floor(i / 9);
  const team: Team = i < 24 ? "red" : i < 48 ? "blue" : "neutral";
  overrideObjects.push(obj(i >= 56 ? "pin-yellow" : "pin", team, -56 + col * 14, -42 + row * 12, 1.6, 0.05));
}
for (let i = 0; i < 56; i++) overrideObjects.push(obj("cup", "neutral", -60 + (i % 14) * 9, 60 - Math.floor(i / 14) * 5, 2, 0.04));
const overrideZones: ScoringZone[] = [
  { id: "tall", label: "Tall Goal", geom: { shape: "circle", x: 0, y: 0, r: 8 }, accepts: ["pin", "pin-yellow"], points: 5, color: "#e2b93b" },
  ...[[-24, 24], [24, 24], [-24, -24], [24, -24]].map(([x, y], i) => ({ id: `short-${i}`, label: `Short Goal ${i + 1}`, geom: { shape: "circle" as const, x, y, r: 6 }, accepts: ["pin", "pin-yellow"], points: 5, color: "#e2b93b" })),
];
export const override: GameModule = {
  id: "override",
  name: "Override",
  season: "2026-27",
  manualVersion: "0.1.2 (UNVERIFIED - manual could not be read directly)",
  fieldSize: U(144),
  autonSeconds: U(15),
  driverSeconds: U(105),
  robotRules: { totalCapW: 88, drivetrainCapW: 55, verified: false },
  startingSize: U(18),
  layoutApproximate: true,
  zones: overrideZones,
  starts: [
    { label: "Red left", x: -48, y: -58, heading: 0, alliance: "red" },
    { label: "Red right", x: -24, y: -58, heading: 0, alliance: "red" },
    { label: "Blue left", x: 24, y: -58, heading: 0, alliance: "blue" },
    { label: "Blue right", x: 48, y: -58, heading: 0, alliance: "blue" },
  ],
  lines: [],
  objects: overrideObjects,
  obstacles: [],
  score: (w) => zoneScore(w, overrideZones),
  notes: [
    "Object counts from search snippets of the manual: 56 Cups, 63 Pins, 9 Goals (4 short, 1 tall, 2 red, 2 blue), 4 Toggles, 4 Loaders. Alliance-color Pin = 5 pts.",
    "UNVERIFIED: 88 W total cap (R10a) and 55 W drivetrain cap (R11a) - check the manual. Toggles, yellow-Pin 10-pt rule, Cups, Loaders and true geometry are NOT modelled. Layout is a practice approximation.",
  ],
};

/** Older seasons: field size and periods only. Objects/scoring are not modelled (use the blank-field tools). */
function stub(id: string, name: string, season: string, note: string): GameModule {
  return {
    ...blank,
    id,
    name,
    season,
    fieldSize: { value: 144, verified: false, source: "12'x12' V5RC field" },
    autonSeconds: U(15),
    driverSeconds: U(105),
    layoutApproximate: false,
    notes: [`${note} Field size and periods are from general knowledge and are UNVERIFIED; no game objects or scoring are modelled - use Edit field / custom JSON to add your own.`],
  };
}

export const overUnder = stub("over-under", "Over Under", "2023-24", "Stub for the 2023-24 season.");
export const spinUp = stub("spin-up", "Spin Up", "2022-23", "Stub for the 2022-23 season.");
export const tippingPoint = stub("tipping-point", "Tipping Point", "2021-22", "Stub for the 2021-22 season.");

export const games: GameModule[] = [override, pushBack, highStakes, overUnder, spinUp, tippingPoint, blank];

export function startsFor(g: GameModule, alliance: "red" | "blue"): StartPosition[] {
  return g.starts.filter((s) => s.alliance === alliance);
}
