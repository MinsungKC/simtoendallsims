/// <reference lib="webworker" />
import { autoTune } from "./tune";
import type { RobotConfig } from "./robot";

self.onmessage = (e: MessageEvent<{ cfg: RobotConfig }>) => {
  const result = autoTune(e.data.cfg, (p) => (self as unknown as Worker).postMessage({ progress: p }));
  (self as unknown as Worker).postMessage({ result });
};
