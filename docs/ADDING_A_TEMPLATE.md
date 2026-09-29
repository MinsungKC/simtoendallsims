# Adding a code-generation target

1. Read the library's **real** headers/examples first and pin a version (see `docs/SOURCES.md`).
2. Create `src/codegen/<target>.ts` exporting `generateX(input: GenInput): GenResult`. Use the helpers in `common.ts`
   (`num`, `planPoses`, `splitActions`, `actionCpp`, ...). Sequential semantics must match the simulator:
   start actions -> motion -> triggers in list order (`waitUntil`/delay) -> wait for the motion -> end actions.
3. Register it in `src/codegen/index.ts` (`TARGETS` + `generate`).
4. Tests (see `lemlib.test.ts`, `ez.test.ts`, `jar.test.ts`, `generic.test.ts`):
   - assertions on the important generated lines + a golden snapshot,
   - a **compile check** against the real headers (`compile.ts`; `npm run fetch-refs` clones them to `.refs/`),
   - where possible, a **behavior check** (`genericRun.test.ts` compiles generated code with a PROS host stub and runs it
     against a simple plant).
5. Anything the library cannot express goes into `result.warnings`, never silently dropped.

Compile checks are `g++ -fsyntax-only` against real headers, so they catch wrong signatures/names (they have already caught
a nonexistent `DigitalOut::toggle()`, a `clamp` name clash with `std::clamp`, and a missing `extern Drive chassis`).
They do not prove the robot behaves well - tune on hardware.
