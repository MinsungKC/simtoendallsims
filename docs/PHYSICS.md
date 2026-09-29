# Physics model, assumptions and validation

The simulator is meant to be *predictive enough to be useful*, not a digital twin. Everything below is
what is actually implemented (see `src/core/`), what it was checked against, and where it is known to be wrong.

## Conventions
Field inches, origin at field center, x right, y up. Heading in degrees, 0 = +y, clockwise positive (this is
LemLib's and EZ-Template's convention, so poses copy straight into code). Body frame: forward `vx`, right `vy`.

## Drivetrain (`physics.ts`)
Fixed 5 ms steps, each split into <= 1 ms sub-steps (the lateral tire model is stiff).

- **Motor**: brushed-DC model per side. `F = N * T_stall * (V/12 - w_motor/w_free) * ratio * efficiency / r`.
  11 W V5 motor: 2.1 N·m stall at 200 rpm; the other cartridges trade speed for torque at constant power
  (checked in tests: peak power = 11 W for 100/200/600 rpm). The 5.5 W motor is modelled as the 11 W curve at half
  torque (**assumption**). Stall current 2.5 A (**assumption**).
- **Battery**: 12.6 V open circuit, 0.09 ohm internal resistance (**assumption**) -> voltage sags with current. Commands are
  PROS `move()` units (x/127 of 12 V), capped at the battery voltage.
- **Tire traction**: each side transmits at most `sum(mu_long * N_wheel)`. When the motor asks for more, the wheels
  *slip*: force drops to 85% of the limit and the wheel speeds up to where motor force equals it. Encoders read the wheel
  speed, so **slip corrupts odometry** exactly as on a real robot.
- **Lateral grip**: every wheel applies smooth Coulomb friction `-mu_lat * N * tanh(v_lat / 0.05)`. Omni wheels have
  `mu_lat ~ 0.08`, traction `0.9` (**assumptions**). This produces (a) sideways drift in arcs on all-omni drives,
  (b) yaw "scrub" that resists turning in place, growing with wheel distance from the pivot, so a center traction wheel
  scrubs little and a corner traction wheel scrubs a lot.
- **Losses**: efficiency 0.88, viscous drag, rolling resistance (all **assumptions**; calibration knobs in the Robot tab).
- **Brake modes**: coast (zero torque), brake (motor terminals shorted -> back-EMF braking), hold (a stronger version).
- **Yaw inertia**: uniform box from mass and footprint unless overridden.

Not modelled: weight transfer / tipping, gearbox backlash and wheel compliance, motor thermal derating, battery
temperature, tile seams, mecanum/X-drive/H-drive/swerve kinematics.

## Contacts and objects (`world.ts`)
Robot (oriented box) vs field walls: corner-point impulses with restitution 0.08 and Coulomb friction 0.45, so the robot
can bounce and spin off walls. Robot vs static obstacles: SAT with the same impulse model. Game objects are circles with
sliding friction; robot-object and object-object collisions are two-body impulses (the robot loses momentum pushing a heavy
mobile goal). The intake is a capture rectangle; the clamp attaches the nearest carriable object rigidly.

## Sensors and odometry (`odom.ts`)
- IMU: gain error, drift (per-seed random sign), and white noise. Drive **IMEs** are quantized at the real tick counts
  (red 1800 / green 900 / blue 300 per motor rev) and read *wheel* travel (so slip and sideways drift are invisible).
  Tracking wheels are quantized (Rotation Sensor 0.088 deg/tick, ADI encoder 360/rev) and see true rolling motion.
- The pose estimator is a line-by-line port of LemLib v0.5 `odom.cpp`, including its fallback to drive-motor encoders.
  One consequence checked in tests: an all-omni drive using only motor encoders drifts ~12" over a 40" curved move;
  with tracking wheels it stays within ~0.1"; a center-traction drive stays within ~1".

## Controllers (`lemlib.ts`, `runtime.ts`)
`moveToPoint`, `moveToPose` (boomerang), `turnToHeading/Point`, `swingToHeading`, `follow` (pure pursuit), PID, exit
conditions and slew are ports of LemLib v0.5 (`src/lemlib/chassis/motions/*.cpp`), run every 10 ms against the *estimated*
pose. Motor commands take effect one tick (10 ms) after they are computed, like real PROS motor updates.
Other libraries' generated code is simulated with the same controller: their gains/behaviors differ in detail, so treat the
sim as "what a LemLib-class controller would do", not a bit-exact EZ-Template/JAR run.

## Validation (numbers from this model; reproduce with the probe in the test suite history)
| Build | Free speed | Sim top speed | 90% time | Stop from top speed |
|---|---|---|---|---|
| 4x11 W, 600 rpm cart, 36:48, 3.25" (450 rpm wheel) | 76.6 in/s | 67.9 in/s (89%) | 0.59 s | 15.8 in |
| 6x11 W, 600 rpm cart, 36:60, 4" (360 rpm wheel) | 75.4 in/s | 66.5 in/s (88%) | 0.70 s | 17.8 in |
| 6x11 W, 200 rpm direct, 4" | 41.9 in/s | 41.2 in/s (98%) | 0.16 s | 3.1 in |

- Loaded top speed is 88-98% of free speed (real drivetrains typically reach ~85-95%).
- Motor peak power identity, motor-budget legality, deterministic replay, wall containment, slip/encoder over-read,
  omni-vs-traction drift and scrub, and controller accuracy (48" move within 2", 90-180 deg turns within 2-3 deg)
  are unit-tested (`src/core/*.test.ts`).
- **High-torque, low-speed setups (e.g. 200 rpm direct) accelerate in ~0.15 s because they are traction-limited at mu ~ 1.**
  Whether that matches your robot depends on your tires and floor. **Calibrate**: measure your robot's top speed and time to
  reach it, then adjust "Floor grip" and "Drive efficiency" (Robot tab -> Calibration).

## Field objects
Loose objects are rigid bodies. Upright Pins and Cups are circles that **tip over** when knocked at more than the speed that lifts their
center of gravity over the base edge (computed from height and base radius with a 2.5" bumper contact height: about 13 in/s for a Pin,
35 in/s for a Cup); a tipped Cup throws out the Pin standing in it. A tipped/lying object is a **capsule** (Pin: 4.4" spine, 1.0" radius;
Cup: 3.35" spine, 1.575" radius) with an angle, angular velocity and inertia: contacts with the robot, walls, Goals and other objects
apply impulses at the contact point, so off-center hits spin it. Ground friction is anisotropic: it slides along its axis (30 in/s²)
but **rolls** across it (4 in/s²), and yaw spin decays. Not modelled: the taper's curved rolling path, stacking on top of each other
on the floor, and rocking/settling.

## Chassis shape
`RobotConfig.cutouts` are rectangular notches in the frame (goal aligners, pin slots, corner reliefs). The outline is decomposed into
convex boxes and every contact test (walls, Goals, objects) runs on each box, so a notched robot really can straddle a Goal. Mass,
inertia and the intake zone still come from the plain length x width box.

## Things I could not verify from here
Real V5 stall current, 5.5 W motor curve, tire friction on your tiles, battery internal resistance, and the Override manual's
field geometry and motor caps. All are marked `UNVERIFIED` in the code/UI and listed in `SOURCES.md`.
