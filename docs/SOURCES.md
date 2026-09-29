# Sources and verification status

| Item | Status | Source |
|---|---|---|
| Game order: High Stakes 24/25, Push Back 25/26, Override 26/27 | from user + search | VEX forum / RECF |
| Push Back: 12'x12', 88 Blocks (3 pts), 2 Long + 2 Center Goals, 15 s auton, 1:45 driver | verified (search of RECF overview) | https://recfoundation.net/documents/2025/06/overview-v5-robotics-competition-push-back.pdf/ |
| Override: 56 Cups, 63 Pins, 9 Goals, 4 Toggles, 4 Loaders; Pin = 5 pts, yellow Pin = 10; auton +12 | UNVERIFIED (search snippets) | Override manual v0.1.2 https://content.vexrobotics.com/docs/2026-2027/override/files/v5rc-override-0.1.2.pdf (blocked from this environment) |
| Motor cap 88 W total (R10a), drivetrain 55 W (R11a) | UNVERIFIED | same manual |
| 18" starting size | assumed (long-standing V5RC rule), UNVERIFIED for Override | manual |
| V5 11 W motor: 2.1 N·m stall @ 200 rpm; other cartridges constant power | consistent with 11 W peak power (unit-tested) | V5 motor spec |
| V5 motor stall current 2.5 A; 5.5 W motor curve | UNVERIFIED | - |
| Tire friction coefficients | tuning guesses | - |
| LemLib v0.5.6 (PROS 4.2.1); signatures read from chassis.hpp | verified | https://github.com/LemLib/LemLib/blob/stable/include/lemlib/chassis/chassis.hpp |
| EZ-Template 3.2.2 stable, 4.0.0-beta.3 (breaking) | verified | https://github.com/EZ-Robotics/EZ-Template/releases |
| PROS 4.2.2 | verified | https://github.com/purduesigbots/pros/releases/tag/4.2.2 |

Drop the Override manual PDF into the repo to let M4 replace UNVERIFIED values.
