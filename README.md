# SimToEndAllSims

A physics-based VEX V5RC autonomous simulator and code generator that runs entirely in the browser.

Describe your robot (motors, cartridge, gearing, wheels omni/traction, track width, mass, sensors), draw an auton on a
to-scale field, watch a physics simulation of it (wheel slip, sideways drift, odometry error, pushable game objects), then
export code for **LemLib**, **EZ-Template**, **JAR-Template** or **plain PROS**.

```
npm install
npm run dev          # http://localhost:5173
npm test             # unit + behavior tests (compile checks are skipped without .refs)
npm run fetch-refs   # clone real PROS/LemLib/EZ/JAR headers to .refs/ so tests can compile-check generated code
npm run build
```

## What it does
- **Robot**: 2-8 drive motors (11 W / 5.5 W), 100/200/600 rpm cartridges, gearing, actual wheel diameters, per-wheel omni/traction,
  88 W motor-budget legality (incl. 4-motor drives and Override's drivetrain sub-cap - unverified), tracking wheels, IMU noise.
- **Auton editor**: move-to-point, boomerang pose, turn, swing, pure-pursuit paths (Bezier), waits; mechanism actions (intake,
  clamp, eject, custom code) triggered at start / after a distance / after a delay / at the end. Red/blue mirroring, undo/redo,
  autosave, save/open project files.
- **Simulation**: LemLib's control algorithms run against the physics with noisy odometry. Timeline scrubbing, speed/odometry-error/
  battery charts, warnings (timeouts, unreachable triggers, over 15 s), placement-error testing, auto-tuned starting gains.
- **Games**: Override (2026-27), Push Back, High Stakes, older-season stubs, blank field. **Layouts are approximate practice layouts
  and are flagged as such** - edit or import a corrected field JSON.
- **Code**: see `docs/ADDING_A_TEMPLATE.md` for how each target is verified.

## Honest limits
Read `docs/PHYSICS.md` (model, assumptions, validation) and `docs/SOURCES.md` (what is and isn't verified). Gains it produces are
starting points; tune on the real robot. Tank drive only for now.

## Docs
`docs/PHYSICS.md` · `docs/SOURCES.md` · `docs/PLAN.md` · `docs/ADDING_A_GAME.md` · `docs/ADDING_A_TEMPLATE.md`
