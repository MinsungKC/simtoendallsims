import type { GameModule } from "./types";

const U = (value: number) => ({ value, verified: false });

export const blank: GameModule = {
  id: "blank",
  name: "Blank field",
  season: "-",
  manualVersion: null,
  fieldSize: { value: 144, verified: true, source: "V5RC field is 12'x12'" },
  autonSeconds: U(15),
  driverSeconds: U(105),
  robotRules: { totalCapW: 88, drivetrainCapW: null, verified: false },
  startingSize: { value: 18, verified: true, source: "V5RC 18\" starting cube (long-standing rule)" },
  obstacles: [],
  notes: ["No game elements."],
};

export const override: GameModule = {
  id: "override",
  name: "Override",
  season: "2026-27",
  manualVersion: "0.1.2 (UNVERIFIED - not read directly)",
  fieldSize: U(144),
  autonSeconds: U(15),
  driverSeconds: U(105),
  robotRules: { totalCapW: 88, drivetrainCapW: 55, verified: false },
  startingSize: U(18),
  obstacles: [],
  notes: [
    "From search snippets only: 56 Cups, 63 Pins, 9 Goals (4 short, 1 tall, 2 red, 2 blue), 4 Toggles, 4 Loaders.",
    "Motor caps 88 W total (R10a) and 55 W drivetrain (R11a) need manual verification.",
    "Field geometry not yet modelled (M4).",
  ],
};

export const pushBack: GameModule = {
  id: "push-back",
  name: "Push Back",
  season: "2025-26",
  manualVersion: null,
  fieldSize: { value: 144, verified: true, source: "RECF Push Back overview" },
  autonSeconds: { value: 15, verified: true, source: "RECF Push Back overview" },
  driverSeconds: { value: 105, verified: true, source: "RECF Push Back overview (1:45)" },
  robotRules: { totalCapW: 88, drivetrainCapW: null, verified: false },
  startingSize: U(18),
  obstacles: [],
  notes: ["88 Blocks (3 pts), 2 Long Goals, 2 Center Goals, 2 Park Zones. Geometry in M4."],
};

export const games: GameModule[] = [override, pushBack, blank];
