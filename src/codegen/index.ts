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
  switch (target) {
    case "lemlib": return generateLemLib(input);
    case "ez-template": return generateEz(input);
    case "jar-template": return generateJar(input);
    case "generic-pros": return generateGeneric(input);
  }
}
