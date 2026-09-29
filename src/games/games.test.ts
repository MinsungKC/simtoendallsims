import { describe, expect, it } from "vitest";
import { games, blank, highStakes, pushBack, override } from "./index";
import { createWorld } from "../core/world";
import { worldInit } from "./types";

describe("game modules", () => {
  it("every game has unique object ids and a 144 in field", () => {
    for (const g of games) {
      const ids = new Set(g.objects.map((o) => o.id));
      expect(ids.size).toBe(g.objects.length);
      expect(g.fieldSize.value).toBe(144);
    }
  });
  it("object counts match the games", () => {
    expect(highStakes.objects.filter((o) => o.kind === "ring")).toHaveLength(48);
    expect(highStakes.objects.filter((o) => o.kind === "mobile-goal")).toHaveLength(5);
    expect(pushBack.objects.filter((o) => o.kind === "block")).toHaveLength(88);
    expect(override.objects.filter((o) => o.kind.startsWith("pin"))).toHaveLength(63);
    expect(override.objects.filter((o) => o.kind === "cup")).toHaveLength(56);
  });
  it("all objects start inside the field and don't overlap the start positions", () => {
    for (const g of games) {
      for (const o of g.objects) {
        expect(Math.abs(o.x) + o.r).toBeLessThanOrEqual(72);
        expect(Math.abs(o.y) + o.r).toBeLessThanOrEqual(72);
      }
      for (const s of g.starts) {
        for (const o of g.objects) expect(Math.hypot(o.x - s.x, o.y - s.y)).toBeGreaterThan(12);
      }
    }
  });
  it("starts fit the 18in cube", () => {
    for (const g of games) expect(g.startingSize === null || g.startingSize.value >= 18).toBe(true);
  });
  it("scoring counts a block resting in a goal for its own color, ignoring moving ones", () => {
    const w = createWorld(worldInit(pushBack), { x: 0, y: 0, heading: 0 });
    const b = w.objects.find((o) => o.team === "red")!;
    b.x = 44; b.y = 0; b.vx = 0; b.vy = 0;
    expect(pushBack.score(w).red).toBe(3);
    b.vx = 30;
    expect(pushBack.score(w).red).toBe(0);
  });
  it("blank field scores zero", () => {
    const w = createWorld(worldInit(blank), { x: 0, y: 0, heading: 0 });
    expect(blank.score(w)).toEqual({ red: 0, blue: 0, lines: [] });
  });
  it("unverified games are flagged as approximate", () => {
    for (const g of [override, pushBack, highStakes]) expect(g.layoutApproximate).toBe(true);
  });
});
