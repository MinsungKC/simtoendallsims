# Override in the simulator

What is modelled, and how faithfully. Rule references are to Game Manual v2.0.

## Field elements (collidable)
| Element | Shape used | Basis |
|---|---|---|
| Field Perimeter | walls at +-72" | manual |
| 9 Goals | regular **octagon**, 5.61" across flats; heights 8.77 (center) / 5.77 (short) / 3.25" (alliance) | heights: manual; footprint: community |
| 4 Toggles | 25.8" x ~1.8" bar on each wall center; three faces = yellow / red / blue | manual |
| 4 Loaders | 13.4" x 9.4" box on the alliance walls (Match Loads themselves are not simulated) | assumed footprint |
| Cups | circle, 3.15" diameter | manual |
| Pins | circle, 1.6" diameter | manual (approximate) |

Robots (oriented boxes) and loose Pins/Cups collide with all of these using convex-polygon SAT and impulses, so
you can't drive through a Goal, get stuck against Toggle bars, and can push objects into walls and Goals.

## Mechanics
- **Possession (SG6):** the intake holds at most 1 Pin and 1 Cup.
- **Preload (SG5):** the robot starts holding 1 Pin (red/yellow for red, blue/yellow for blue).
- **Place action:** nests the held object onto the Goal in front of the robot. A Pin goes into an empty Goal or the open
  socket of a Cup; a Cup goes over a Pin. Placing on the opposing Alliance's Goal is refused (SG9).
- **Toggle action:** sets the wall Toggle in front of the robot to red / blue / yellow.

## Scoring (SC1-SC8) on the final state of the run
- each **visible** half of a Placed Pin scores 5 (alliance color) - a half inside a Cup's **opaque** half is hidden (SC3):
  gray-side-up Cups hide the Pin nested in their upper socket, clear-side-up Cups hide the Pin nested in their lower socket;
- yellow halves score 10 for whoever **Owns** them: the Alliance the Quadrant's Toggle is set to, or, in the center Goal, the
  Alliance with more Robots in the Midfield (SC5);
- a Robot overlapping the Midfield diamond at the end: 8 (SC6);
- **Autonomous Win Point** status is reported (6 scored Pins, 2 Goals with 2+, no Robot on the perimeter - SC8) and the
  Autonomous Bonus (12) is described but not awarded, since it depends on an opponent.

## Rule checks (SG1, SG2, SG7, SG9, R10/R11)
Start pose: touching Goals/Loaders/Toggles, not touching the perimeter, not fully on your side of the Autonomous Line
(**y = -x**: red is the W and S Quadrants, blue N and E). During the run: crossing the Autonomous Line, touching objects on the
opposing side, touching an opposing Alliance Goal, exceeding the 24" expansion limit, failed Place/Toggle actions, running past
15 s, and motor-power caps (88 W total / 55 W drivetrain).

## Known simplifications
- Nested Pin-in-Cup starting stacks are modelled as a Cup and a Pin side by side.
- A Pin/Cup is either lying on the floor (a circle) or nested in a Goal; standing/tipping is not simulated.
- Goal stacks have no height limit besides `maxStack` on the robot (default unlimited).
- Match Loads / Loaders, the opposing Alliance, Endgame rules (SG12) and Load Zone protection (SG13, driver period only) are not simulated.
- Yellow-Pin ownership in the center Goal only considers your own Robot.
