# Sources and verification status

"Verified" = read from the primary source in this session. "Unverified" = recalled or from search snippets.

## Games
| Item | Status | Source |
|---|---|---|
| Season order: High Stakes 24/25, Push Back 25/26, Override 26/27 | from the user + search | VEX forum / RECF |
| Push Back: 12'x12', 88 Blocks (3 pts), 2 Long + 2 Center Goals, 15 s auton, 1:45 driver | verified from search of the RECF overview | https://recfoundation.net/documents/2025/06/overview-v5-robotics-competition-push-back.pdf/ |
| Override: 56 Cups, 63 Pins, 9 Goals, 4 Toggles, 4 Loaders; Pin = 5 pts, yellow Pin = 10; auton +12 | **UNVERIFIED** (search snippets) | Override manual v0.1.2 https://content.vexrobotics.com/docs/2026-2027/override/files/v5rc-override-0.1.2.pdf (blocked from the build environment) |
| Motor cap 88 W total (R10a), drivetrain 55 W (R11a) | **UNVERIFIED** | same manual |
| 18" starting size | assumed (long-standing V5RC rule) | manual |
| High Stakes / Over Under / Spin Up / Tipping Point details | **UNVERIFIED**, recalled; layouts are approximate practice layouts | - |
| All object positions and scoring zones | **APPROXIMATE practice layouts, not from manuals** | - |

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
