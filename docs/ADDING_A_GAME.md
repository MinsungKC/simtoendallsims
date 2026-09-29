# Adding a game

A game is a `GameModule` (`src/games/types.ts`) registered in `src/games/index.ts`:

```ts
export const myGame: GameModule = {
  id: "my-game", name: "My Game", season: "2027-28", manualVersion: "1.0",
  fieldSize: { value: 144, verified: true, source: "manual section X" },
  autonSeconds: { value: 15, verified: true }, driverSeconds: { value: 105, verified: true },
  robotRules: { totalCapW: 88, drivetrainCapW: null, verified: true },
  startingSize: { value: 18, verified: true },
  layoutApproximate: false,
  zones: [/* scoring zones: rect/circle, accepted object kinds, points */],
  starts: [/* start pose presets */],
  lines: [], objects: [/* {id, kind, team, x, y, r, mass, drag, carriable?} */], obstacles: [/* AABBs */],
  score: (world) => zoneScore(world, zones),
  notes: [],
};
```

Rules of the road:
- Only set `verified: true` on values you checked against the official manual, and cite it in `source`.
- If you can't verify the layout, set `layoutApproximate: true`; the UI then shows a warning.
- Object ids must be unique. Coordinates are inches from field center (x right, y up).
- `carriable: true` objects (mobile goals) can be clamped. Anything else can be picked up by the intake.
- Add tests to `src/games/games.test.ts` (object counts, nothing overlapping start poses).

Users can also correct a layout without code: Field tab -> Export/Import JSON, or the "Edit field" tool.
