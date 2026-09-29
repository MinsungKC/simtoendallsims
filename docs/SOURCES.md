# Sources and verification status

"Verified" = read from the primary source in this session. "Unverified" = recalled or from search snippets.

## Games
| Item | Status | Source |
|---|---|---|
| Season order: High Stakes 24/25, Push Back 25/26, Override 26/27 | from the user + search | VEX forum / RECF |
| **Override** field, 6x6 tiles, 15 s auton / 1:45 driver, 18" start size, object counts, Cup (3.15"x6.5") and Pin (~1.6"x6.5") sizes, Goal heights (8.7/5.8/3.25"), Toggle (25.8" long, 2.05" faces), scoring rules SC1-SC8, rules SG1-SG13, motor rules R10a (88 W) and R11a (55 W drivetrain) | **verified** | Game Manual v2.0 (text). A public copy of the manual text was read; it is not redistributed in this repo (`.refs/` is git-ignored). |
| Override **layout**: Goal, Toggle, Loader, Load Zone, Autonomous Line and Midfield geometry, and the starting position/orientation/color of every Pin and Cup (incl. the five yellow Pins already in the neutral Goals) | traced from VEX's **official top-down Override field graphic** (the H2H field drawing published with the manual and bundled in the open-source path.jerryio project), measured in pixels against the 144" square and the 24" tile seams, ~0.2" accuracy; counts match the manual (37 Pins, 36 Cups) | github.com/Jerrylum/path.jerryio `public/precache/V5RC-Override-H2H-TopDownHighlighted-*.png`; positions cross-checked against MMGA_Override_AutonSim (derived from VEX's VR field data) and msoe-vex/VEX-AI-Reinforcement-Learning |
| Override Goal footprint (5.6" chamfered square, 142.5 mm across the flats) and Pin profile (1.3" tip, 2.2" middle, 3.1" flange) | official graphic + community mesh data (Goal heights match the manual to 0.1 mm) | as above |
| Override Pin physics proxy (1.0" radius, 4.4" collision spine when lying), Pin mass, Loader collision polygon | **assumed** from the graphic's silhouettes | - |
| Not readable: Appendix A dimensioned drawings (A5-A17) and Figures FO-1/FO-2 are images | - | Game Manual v2.0 |
| Push Back: 12'x12', 88 Blocks (3 pts), 2 Long + 2 Center Goals, 15 s auton, 1:45 driver | verified from search of the RECF overview | https://recfoundation.net/documents/2025/06/overview-v5-robotics-competition-push-back.pdf/ |
| High Stakes / Over Under / Spin Up / Tipping Point details, and Push Back/High Stakes object positions | **UNVERIFIED**, approximate practice layouts | - |

## Hardware constants
| Item | Status |
|---|---|
| V5 11 W motor: 2.1 N·m stall @ 200 rpm; constant power across cartridges | consistent with 11 W peak (unit-tested) |
| Stall current 2.5 A, 5.5 W motor curve, battery resistance, tire friction, drivetrain efficiency | **UNVERIFIED assumptions** (calibration knobs exist) |
| IME ticks/rev red 1800 / green 900 / blue 300; Rotation Sensor 0.088 deg | recalled from VEX docs, UNVERIFIED |
| Actual wheel diameters (2.125 / 2.75 / 3.25 / 4.00 / 4.18 in) | verified from LemLib's `Omniwheel` table |

## Libraries (all read from source in this session)
| Library | Version | Source |
|---|---|---|
| LemLib | v0.5.x stable branch (PROS 4.2.x). `master` is an unreleased rewrite with a different API and is NOT targeted | https://github.com/LemLib/LemLib |
| EZ-Template | 3.2.x stable (4.0 beta has breaking changes; not targeted) | https://github.com/EZ-Robotics/EZ-Template |
| JAR-Template | v1.2.x (last upstream commit June 2024) | https://github.com/JacksonAreaRobotics/JAR-Template |
| PROS | 4.2.2 | https://github.com/purduesigbots/pros |
| path.jerryio (LemLib v0.5 path file format) | read from `LemLibFormatV0_4` | https://github.com/Jerrylum/path.jerryio |

Known upstream discrepancy: LemLib's docs say a horizontal tracking wheel should read *positive when pushed right*, but
`odom.cpp` adds `localX * -cos(heading)`, i.e. treats positive as *left*. The simulator follows the code. Generated code tells
users to verify sensor direction with the on-brain pose readout.
