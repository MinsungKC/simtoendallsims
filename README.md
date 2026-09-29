# SimToEndAllSims

Physics-based VEX V5RC auton simulator and code generator (in progress - see `docs/PLAN.md`).

```
npm install
npm run dev      # drive the robot with WASD / arrows
npm test         # physics + motor-budget tests
npm run build
```

Current (M1): configurable tank drivetrain (motor count/wattage, cartridge, gearing, wheel type,
mass, dimensions), 88 W motor-budget legality check, deterministic physics, game module stubs.
