# SimToEndAllSims - status

Browser-based, physics-driven VEX V5RC auton simulator and code generator. Pure-TS core (`src/core`, `src/games`,
`src/codegen`) has no UI dependency; UI is React + canvas (`src/ui`).

## Done
- [x] **Physics v2**: motor/battery model, wheel slip, lateral drift, scrub, impulse contacts, pushable objects, intake/clamp
- [x] **Sensors/odometry**: IMU, IME quantization, tracking wheels; port of LemLib's estimator
- [x] **Controllers**: port of LemLib v0.5 motions; 10 ms loop, 1-tick command latency
- [x] **Routine model + runtime**: steps, triggers (start/distance/delay/end), warnings, placement-error option, mirroring
- [x] **Auto-tune** (Web Worker) from the physics model
- [x] **Editor UI**: field canvas with draggable handles, add-step tools, undo/redo, timeline + charts, robot/routine/code/field panels
- [x] **Games**: Override (approx.), Push Back (approx.), High Stakes (approx.), Over Under/Spin Up/Tipping Point stubs, blank
- [x] **Code generators**: LemLib, EZ-Template, JAR-Template, generic PROS - compile/type/behavior checked (see ADDING_A_TEMPLATE.md)

## Known gaps / next
- Tank drive only (no X/H/mecanum/swerve); no weight transfer or motor thermal model
- Game layouts and scoring are approximate until the official manuals can be read (drop the Override PDF in the repo)
- Simulated controller is LemLib-class for every target
- vexide (Rust) target; per-game auton-scoring bonuses (win points, control zones)
