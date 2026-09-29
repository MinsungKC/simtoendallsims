import { frameNote, toFrame } from "../core/frame";
import { generateEz } from "./ez";
import { generateGeneric } from "./generic";
import { generateJar } from "./jar";
import { generateLemLib } from "./lemlib";
import type { GenInput, GenResult, TargetId } from "./types";

export * from "./types";

export const TARGETS: { id: TargetId; label: string; blurb: string }[] = [
  { id: "lemlib", label: "LemLib (PROS)", blurb: "Most popular PROS library: odometry, boomerang, pure pursuit." },
  { id: "ez-template", label: "EZ-Template (PROS)", blurb: "Beginner-friendly PROS template with PID, odom and a tuner." },
  { id: "jar-template", label: "JAR-Template (VEXcode)", blurb: "VEXcode C++ template with PID, odom and boomerang." },
  { id: "generic-pros", label: "Generic PROS (no library)", blurb: "Self-contained PROS code: no dependencies." },
];

export function generate(target: TargetId, input: GenInput): GenResult {
  // The simulator works in field coordinates; the emitted code is expressed relative to the robot's start pose by default.
  const frame = input.frame ?? "start";
  const routine = toFrame(input.routine, frame);
  const inp: GenInput = { ...input, routine };
  const res = (() => {
    switch (target) {
      case "lemlib": return generateLemLib(inp);
      case "ez-template": return generateEz(inp);
      case "jar-template": return generateJar(inp);
      case "generic-pros": return generateGeneric(inp);
    }
  })();
  const note = frameNote(input.routine, frame);
  // say it in the code too, on the file that starts the routine, so it survives being copy-pasted out of the app
  const files = res.files.map((f) => (/(^|\/)(main|autons)\.cpp$/.test(f.path) && /setPose|odom_xyt_set|set_coordinates|set_pose/.test(f.content) ? { ...f, content: `// ${note}\n${f.content}` } : f));
  return { ...res, files, notes: [note, ...res.notes] };
}
