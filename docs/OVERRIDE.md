# Override in the simulator

What is modelled, and how faithfully. Rule references are to Game Manual v2.0.

## Layout: traced from VEX's official top-down field graphic
Every position, shape and color below was measured from the official Override H2H top-down image (calibrated against the
144" square, the 24" tile seams and the Goal grid; accuracy about 0.2"). The manual's counts are reproduced exactly: 37 Pins
and 36 Cups on the Field (Match Loads excluded).

| Element | Where / what it looks like | Collision |
|---|---|---|
| 9 Goals | on the 24" grid: tall center Goal, four short neutral Goals at (-24,48) (-48,24) (24,-48) (48,-24), red at (-24,-48) (-48,-24), blue at (24,48) (48,24). A 5.6" square with 0.95" chamfered corners, four corner ribs around a raised octagon, a round socket and screws; red/blue/black | chamfered-square polygon |
| 4 Toggles | 25.8" x 2.05" triangular bars centered on each wall, riding **on top of the Perimeter** (outside the tiles); three faces yellow / red / blue with black end brackets | none (they are not inside the Field) |
| 4 Loaders | small trapezoid chutes on the red (west) and blue (east) walls at y = +-60.2: 4.4" wide at the wall narrowing to 3.0" over 3.8", outlined in Alliance color | trapezoid polygon |
| 4 Load Zones | corner rectangles 24" along the wall x ~11" deep, bounded by 3-sided red/blue tape | none |
| Autonomous Line | pair of white tapes 1.8" apart along y = -x from each Load Zone tape to the Midfield; single tape along y = x | none |
| Midfield | white-tape diamond with 24" half-diagonal | scoring only |
| 24 Cups (gray half up) | eight touching triples along the walls, middle Cup of each triple 24.2" either side of the wall's middle, touching the Perimeter; a yellow Pin stands in each middle Cup | circle r 1.575" |
| 4 Cups (clear half up) on the Autonomous Line | (-24,24) (24,-24) (-48,48) (48,-48), each with 4 Pins **lying** radially: yellow end at the Cup, colored end out (N/E blue, S/W red) | circle; the Pins are capsules |
| 4 yellow stacks | a yellow Pin standing in a clear-up Cup at (24,24) (-24,-24) (48,48) (-48,-48) | circle r 1.575" |
| 4 red/blue stacks | a red/blue Pin standing in a Cup on each Midfield corner (blue up N/E, red up S/W) | circle r 1.575" |
| 5 yellow Pins in Goals | already Placed in the four short Goals and the tall Goal (score 0 until Owned) | - |

A **Pin** is drawn as VEX makes it: two truncated cones (1.3" at the tip to 2.2" in the middle) joined by a 3.1" flange, 6.5" long.
Lying Pins collide as capsules (a 4.4" spine swept by a 1.0" radius), so a robot meets the end of a Pin before its center and a
Pin can't be pushed through the wall or a Goal. A standing Pin is a hexagon on a round flange; standing objects are drawn the way
the official graphic draws them (Cup = circle split into a clear white and an opaque gray half; Pin = hexagon showing both colors).

Robots (oriented boxes) and loose Pins/Cups collide with all of these using convex-polygon SAT and impulses.

## The other Alliance
Override's red and blue sides are related by a **180-degree turn** about the field center (red Goals at (-24,-48) and (-48,-24) become
blue at (24,48) and (48,24)), not by a left-right flip, so the routine panel's mirror button rotates the routine instead of flipping it
(`GameModule.mirror = "rotate"`).

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
- A Cup with a Pin standing in it starts as one unit: it is picked up together (the intake needs room for both) and the Pin then
  rides in the robot. Nesting again on the field is not simulated; use the Place action to nest into a Goal.
- A Pin lying on the floor stays lying (it slides but does not roll or rotate) until it is picked up, after which it is upright;
  tipping is not simulated.
- Goal stacks have no height limit besides `maxStack` on the robot (default unlimited).
- Match Loads / Loaders, the opposing Alliance, Endgame rules (SG12) and Load Zone protection (SG13, driver period only) are not simulated.
- Yellow-Pin ownership in the center Goal only considers your own Robot.

## Pen routes, pickup sides and scoring side
- **Pen (✎ Draw path):** draw a rough line; it is smoothed, pushed out of Goals/Loaders/walls (keeping the robot's half-width + 1" clear),
  reduced to a few waypoints and added as boomerang steps whose headings follow the line (adjust with the arrow handles). Choose
  whether the robot leads with its front or back. Loose game pieces are not avoided (you may want to run into them).
- **Pickup (Robot tab → Pickup & scoring):** a front zone and an optional rear zone, each with reach, width, capacity and
  "any orientation" or "standing pieces only" (a rear roller that can't take a lying Pin). Actions: Front/Rear intake on/off.
- **Scoring side:** the Place action reaches out of the front or back; drive so that end faces the Goal.
