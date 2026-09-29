/// <reference lib="webworker" />
import { autoTune } from "./tune";
import type { RobotConfig } from "./robot";

self.onmessage = (e: MessageEvent<{ cfg: RobotConfig; mode?: "safe" | "fast" }>) => {
  const result = autoTune(e.data.cfg, (p) => (self as unknown as Worker).postMessage({ progress: p }), e.data.mode ?? "safe");
  (self as unknown as Worker).postMessage({ result });
};
