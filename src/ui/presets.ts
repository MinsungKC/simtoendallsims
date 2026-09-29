import { defaultRobot, type RobotConfig } from "../core/robot";

/** Representative robot configurations (typical builds, not any specific team's robot). */
export const PRESETS: { id: string; label: string; make: () => RobotConfig }[] = [
  { id: "fast-4m", label: "4-motor 450 rpm, 3.25\" omni + center traction (fast)", make: () => ({ ...defaultRobot(), name: "4-motor 450rpm" }) },
  {
    id: "classic-6m",
    label: "6-motor 360 rpm, 4\" omni + center traction",
    make: () => ({
      ...defaultRobot(), name: "6-motor 360rpm", motorsPerSide: 3, cartridge: 600, drivingTeeth: 36, drivenTeeth: 60, wheelDiameter: 4, trackWidth: 12.75, mass: 7.5,
      wheels: [{ type: "omni", x: 5.5 }, { type: "traction", x: 0 }, { type: "omni", x: -5.5 }], horizontalDrift: 8,
    }),
  },
  {
    id: "pusher-4m",
    label: "4-motor 200 rpm, all traction (pusher)",
    make: () => ({
      ...defaultRobot(), name: "4-motor pusher", cartridge: 200, drivingTeeth: 1, drivenTeeth: 1, wheelDiameter: 3.25, mass: 8.5,
      wheels: [{ type: "traction", x: 4 }, { type: "traction", x: -4 }], horizontalDrift: 8, brake: "hold",
    }),
  },
  {
    id: "drift-6m",
    label: "6-motor 600 rpm, all-omni drift drive",
    make: () => ({
      ...defaultRobot(), name: "6-motor drift", motorsPerSide: 3, cartridge: 600, drivingTeeth: 36, drivenTeeth: 48, wheelDiameter: 3.25, mass: 6,
      wheels: [{ type: "omni", x: 5 }, { type: "omni", x: 0 }, { type: "omni", x: -5 }], horizontalDrift: 2,
      odom: { ...defaultRobot().odom, trackingWheels: [
        { axis: "vertical", diameter: 2.75, offset: 0, sensor: "rotation" },
        { axis: "horizontal", diameter: 2.75, offset: -2, sensor: "rotation" },
      ] },
    }),
  },
];
