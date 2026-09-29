# SimToEndAllSims - plan

Browser-based, physics-driven VEX V5RC auton simulator and code generator.
Pure-TS core (`src/core`, `src/games`) has no UI dependency; UI is React + canvas (`src/ui`).

Conventions: field inches, origin at field center, x right, y up, heading in degrees with
0 = +y and clockwise positive (matches LemLib's convention, which keeps codegen simple).

## Milestones
- [x] **M1** Field + robot config (incl. 88 W motor budget) + tank physics, keyboard-driven test drive
  - Drive motor count 2-8, 11 W / 5.5 W, cartridges, gearing, wheels omni/traction per position
  - DC-motor model with back-EMF, battery sag, traction limit, omni/traction lateral scrub, wall collision
  - Game module schema with `verified` flags; Override / Push Back / blank stubs
- [ ] **M2** Path editor (Bezier / boomerang / pure pursuit / turn+drive primitives), motion profiling, follower controllers driving the sim, path.jerryio import/export
- [ ] **M3** Actions timeline (intake, clamp, lift, wait, parallel, custom code)
- [ ] **M4** Full game modules (Override, Push Back) with Planck.js objects/scoring; then High Stakes
- [ ] **M5** Codegen: LemLib + generic PID/odom
- [ ] **M6** EZ-Template 3.2.x (4.0 beta separately), JAR-Template, PROS/VEXcode; older-game stubs
- [ ] **M7** Polish, docs, ADDING_A_GAME / ADDING_A_TEMPLATE

## Open questions / needs verification
See `SOURCES.md`. Biggest: Override manual geometry and the 55 W drivetrain sub-cap (R11a);
JAR-Template current API; 5.5 W motor curve and V5 motor stall current; tire friction values.

## Known M1 simplifications
- Tank only; wall collision is corner-based and only zeroes forward speed (no spin from impacts)
- Field obstacles/objects arrive in M4 (Planck.js)
- No odometry noise yet (M2)
