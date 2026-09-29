/** Test helper: syntax/type-check generated C++ against real library headers with the host compiler. */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { GenFile } from "./types";

export const REFS = resolve(process.cwd(), ".refs");
export const haveRefs = existsSync(join(REFS, "pros/include")) && existsSync(join(REFS, "LemLib/include")) && existsSync(join(REFS, "JAR-Template/include")) && existsSync(join(REFS, "EZ-Template/EZ-Template-Example-Project/include"));

/** `overlay`: an existing project whose include/ folder is copied first, so generated files replace its own. */
export function compileCheck(files: GenFile[], includeDirs: string[], sources: string[], overlay?: string): { ok: boolean; log: string } {
  const dir = mkdtempSync(join(tmpdir(), "gen-"));
  if (overlay) cpSync(join(overlay, "include"), join(dir, "include"), { recursive: true });
  for (const f of files) {
    const p = join(dir, f.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.content);
  }
  const args = ["-fsyntax-only", "-std=gnu++20", "-w", "-Wfatal-errors", "-I", join(dir, "include"), "-I", join(dir, "include/pros"), ...includeDirs.flatMap((d) => ["-I", d]), ...sources.map((s) => join(dir, s))];
  try {
    execFileSync("g++", args, { stdio: "pipe", cwd: dir });
    return { ok: true, log: "" };
  } catch (e) {
    const err = e as { stderr?: Buffer };
    return { ok: false, log: err.stderr?.toString() ?? String(e) };
  }
}
