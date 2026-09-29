import { create } from "zustand";
import { defaultRobot, type RobotConfig } from "../core/robot";
import { games } from "../games";
import type { GameModule } from "../games/types";

interface Store {
  robot: RobotConfig;
  game: GameModule;
  setRobot: (patch: Partial<RobotConfig>) => void;
  setGame: (id: string) => void;
}

export const useStore = create<Store>((set) => ({
  robot: defaultRobot(),
  game: games[0],
  setRobot: (patch) => set((s) => ({ robot: { ...s.robot, ...patch } })),
  setGame: (id) => set({ game: games.find((g) => g.id === id) ?? games[0] }),
}));
