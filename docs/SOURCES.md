# Sources and verification status

"Verified" = read from the primary source in this session. "Unverified" = recalled or from search snippets.

## Games
| Item | Status | Source |
|---|---|---|
| Season order: High Stakes 24/25, Push Back 25/26, Override 26/27 | from the user + search | VEX forum / RECF |
| **Override** field, 6x6 tiles, 15 s auton / 1:45 driver, 18" start size, object counts, Cup (3.15"x6.5") and Pin (~1.6"x6.5") sizes, Goal heights (8.7/5.8/3.25"), Toggle (25.8" long, 2.05" faces), scoring rules SC1-SC8, rules SG1-SG13, motor rules R10a (88 W) and R11a (55 W drivetrain) | **verified** | Game Manual v2.0 (text). A public copy of the manual text was read; it is not redistributed in this repo (`.refs/` is git-ignored). |
| Override Goal / Toggle / Loader **positions** on the 24" grid (goals at (+-24,+-48) and (+-48,+-24), tall Goal at the origin, Toggles at the wall centers, Loaders at the walls at y = +-60) | community, three independent sources agree | github.com/wittodetto/MMGA_Override_AutonSim (derived from VEX's official VR field data), github.com/msoe-vex/VEX-AI-Reinforcement-Learning, a team engineering notebook |
| Override Goal footprint (octagon, 142.5 mm across flats) | community (heights match the manual to 0.1 mm) | MMGA_Override_AutonSim mesh generator |
| Override Midfield diamond (24" half-diagonal) | community; the two community sources disagree (17" vs 24") | see above |
| Override **starting positions of Pins and Cups** | community reconstruction of Figure FO-2 (an image); consistent with the manual's counts: 4 red/blue, 8 red/yellow, 8 blue/yellow, 17 yellow/yellow Pins and 24 gray-up + 12 clear-up Cups on the Field | msoe-vex repo; two pins dropped to match the manual's count of 17 yellow/yellow |
| Override Loader footprint, Load Zone size, Pin physics radius | **assumed** | - |
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
