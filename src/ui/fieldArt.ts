/**
 * Top-down drawings of the Override field elements, traced from VEX's official field graphic: everything is drawn in
 * inches in a y-up frame (the canvas transform handles scale and orientation), so shapes stay to scale at any zoom.
 */
import { goalOutline, GOAL_ACROSS_FLATS, PIN, CUP, TOGGLE_FACE, TOGGLE_LENGTH } from "../games/override";

export interface Frame2D {
  ctx: CanvasRenderingContext2D;
  /** field inches -> canvas px */
  px: (x: number) => number;
  py: (y: number) => number;
  /** px per inch */
  S: number;
}

export const PALETTE = {
  floorA: "#3a3c41",
  floorB: "#37393e",
  seam: "#2a2c30",
  perimeter: "#bdbbbb",
  perimeterEdge: "#8f8d8d",
  tape: "#c1c8e2",
  tapeRed: "#c0273b",
  tapeBlue: "#2b85b3",
  red: "#cc2436",
  blue: "#1f9ee0",
  yellow: "#ecdc55",
  cupClear: "#f6f6f8",
  cupOpaque: "#5c5e65",
  ink: "#0b0b0d",
} as const;

export const pinColor = (c: string | undefined): string => (c === "red" ? PALETTE.red : c === "blue" ? PALETTE.blue : c === "yellow" ? PALETTE.yellow : "#cfcfcf");

/** Run `draw` in a local frame: origin at field (x, y), units = inches, +y = `headingDeg` clockwise from field-north. */
export function local(f: Frame2D, x: number, y: number, headingDeg: number, draw: () => void): void {
  const { ctx } = f;
  ctx.save();
  ctx.translate(f.px(x), f.py(y));
  ctx.scale(f.S, -f.S);
  ctx.rotate((-headingDeg * Math.PI) / 180);
  draw();
  ctx.restore();
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))));
  return `#${[c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function poly(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

// ---- Cups: a circle split into a clear (white) half and an opaque (gray) half; `opaqueUp` puts the gray half on top
export function drawCup(f: Frame2D, x: number, y: number, opaqueUp: boolean | undefined): void {
  const { ctx } = f;
  local(f, x, y, 0, () => {
    const r = CUP.r;
    const top = opaqueUp ? PALETTE.cupOpaque : PALETTE.cupClear, bottom = opaqueUp ? PALETTE.cupClear : PALETTE.cupOpaque;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI); ctx.closePath(); ctx.fillStyle = top; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, r, Math.PI, Math.PI * 2); ctx.closePath(); ctx.fillStyle = bottom; ctx.fill();
    ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 0.11;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
  });
}

/** A Cup lying on its side: a 3.15" x 6.5" rounded body, clear half at one end and opaque half at the other. `angle` points at the top end. */
export function drawLyingCup(f: Frame2D, x: number, y: number, angle: number, opaqueUp: boolean | undefined): void {
  const { ctx } = f;
  local(f, x, y, angle, () => {
    const r = CUP.r, L = CUP.height / 2;
    const top = opaqueUp ? PALETTE.cupOpaque : PALETTE.cupClear, bottom = opaqueUp ? PALETTE.cupClear : PALETTE.cupOpaque;
    ctx.beginPath(); ctx.rect(-r, 0, 2 * r, L); ctx.fillStyle = top; ctx.fill();
    ctx.beginPath(); ctx.rect(-r, -L, 2 * r, L); ctx.fillStyle = bottom; ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect(-r * 0.35, -L, r * 0.3, 2 * L);
    ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 0.11; ctx.strokeRect(-r, -L, 2 * r, 2 * L);
    ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
  });
}

// ---- Pins
/** A Pin standing on end, seen from above: the flange ring in the upper color and a hexagon showing both halves. */
export function drawStandingPin(f: Frame2D, x: number, y: number, upper: string, lower: string, flange: boolean): void {
  const { ctx } = f;
  local(f, x, y, 0, () => {
    if (flange) {
      ctx.beginPath(); ctx.arc(0, 0, PIN.flange / 2, 0, Math.PI * 2); ctx.fillStyle = pinColor(upper); ctx.fill();
      ctx.strokeStyle = shade(pinColor(upper), -0.45); ctx.lineWidth = 0.09; ctx.stroke();
    }
    const R = 1.15;
    const hex = Array.from({ length: 6 }, (_, k) => ({ x: R * Math.cos(Math.PI / 2 + (k * Math.PI) / 3), y: R * Math.sin(Math.PI / 2 + (k * Math.PI) / 3) }));
    ctx.save();
    poly(ctx, hex); ctx.clip();
    ctx.fillStyle = pinColor(upper); ctx.fillRect(-R, 0, 2 * R, R);
    ctx.fillStyle = pinColor(lower); ctx.fillRect(-R, -R, 2 * R, R);
    ctx.restore();
    ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 0.09;
    poly(ctx, hex); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-R * 0.87, 0); ctx.lineTo(R * 0.87, 0); ctx.stroke();
  });
}

/** Half-width of a Pin's silhouette at distance u from its middle (u along the axis, 0 = the flange). */
export function pinHalfWidth(u: number): number {
  const a = Math.abs(u);
  if (a <= 0.35) return 1.55;
  if (a <= 0.5) return 1.55 - ((a - 0.35) / 0.15) * 0.43;
  return 1.12 - ((a - 0.5) / (PIN.length / 2 - 0.5)) * 0.47;
}

/** A Pin lying on the floor: two tapering halves joined at a flange. `angle` points toward halves[1]'s far end. */
export function drawLyingPin(f: Frame2D, x: number, y: number, angle: number, halves: [string, string] | undefined, flip: boolean | undefined): void {
  const { ctx } = f;
  const a = pinColor(halves ? halves[flip ? 1 : 0] : undefined);
  const b = pinColor(halves ? halves[flip ? 0 : 1] : undefined);
  local(f, x, y, angle, () => {
    const L = PIN.length / 2;
    const us = [-L, -0.5, -0.35, 0.35, 0.5, L];
    const right = us.map((u) => ({ x: pinHalfWidth(u), y: u }));
    const left = [...us].reverse().map((u) => ({ x: -pinHalfWidth(u), y: u }));
    const outline = [...right, ...left];
    ctx.save();
    poly(ctx, outline); ctx.clip();
    ctx.fillStyle = a; ctx.fillRect(-2, -L - 0.2, 4, L + 0.2 - 0.35);
    ctx.fillStyle = b; ctx.fillRect(-2, -0.35, 4, L + 0.55);
    // facets: a lighter ridge down the middle and darker flanks
    ctx.fillStyle = "rgba(255,255,255,0.20)";
    ctx.beginPath(); ctx.moveTo(-0.28, -L); ctx.lineTo(0.28, -L); ctx.lineTo(0.42, L); ctx.lineTo(-0.42, L); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    for (const sg of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sg * 0.65, -L); ctx.lineTo(sg * 1.6, -L); ctx.lineTo(sg * 1.6, L); ctx.lineTo(sg * 0.95, L); ctx.closePath(); ctx.fill(); }
    // the flange ring is a touch brighter than the body
    ctx.fillStyle = "rgba(255,255,255,0.14)"; ctx.fillRect(-2, -0.35, 4, 0.7);
    ctx.restore();
    ctx.strokeStyle = "rgba(0,0,0,0.55)"; ctx.lineWidth = 0.07;
    poly(ctx, outline); ctx.stroke();
    ctx.lineWidth = 0.05;
    for (const u of [-0.35, 0.35]) { ctx.beginPath(); ctx.moveTo(-pinHalfWidth(u), u); ctx.lineTo(pinHalfWidth(u), u); ctx.stroke(); }
  });
}

// ---- Goals: a chamfered square housing, four corner ribs around a raised octagon, and the socket
export function drawGoal(f: Frame2D, x: number, y: number, color: "red" | "blue" | "black", tall: boolean): void {
  const { ctx } = f;
  const base = color === "red" ? "#c8283a" : color === "blue" ? "#2a86c2" : "#17181c";
  local(f, x, y, 0, () => {
    const outer = goalOutline(0, 0);
    poly(ctx, outer); ctx.fillStyle = base; ctx.fill();
    // inner raised octagon
    const h = GOAL_ACROSS_FLATS / 2, hi = 1.85, ci = 0.7;
    const inner = [{ x: hi, y: -(hi - ci) }, { x: hi, y: hi - ci }, { x: hi - ci, y: hi }, { x: -(hi - ci), y: hi }, { x: -hi, y: hi - ci }, { x: -hi, y: -(hi - ci) }, { x: -(hi - ci), y: -hi }, { x: hi - ci, y: -hi }];
    // corner ribs: quads joining each outer chamfer to the inner octagon's matching edge
    ctx.fillStyle = shade(base, color === "black" ? 0.10 : -0.22);
    for (let k = 0; k < 4; k++) {
      const o0 = outer[(2 * k + 1) % 8], o1 = outer[(2 * k + 2) % 8], i0 = inner[(2 * k + 1) % 8], i1 = inner[(2 * k + 2) % 8];
      poly(ctx, [o0, o1, i1, i0]); ctx.fill();
    }
    poly(ctx, inner); ctx.fillStyle = shade(base, color === "black" ? 0.05 : 0.06); ctx.fill();
    ctx.strokeStyle = shade(base, -0.45); ctx.lineWidth = 0.06; poly(ctx, inner); ctx.stroke();
    // socket
    ctx.beginPath(); ctx.arc(0, 0, tall ? 1.25 : 1.15, 0, Math.PI * 2); ctx.fillStyle = shade(base, color === "black" ? 0.12 : 0.1); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, 0.8, 0, Math.PI * 2); ctx.fillStyle = "#08080a"; ctx.fill();
    // screws at the flat midpoints
    ctx.fillStyle = "#e9e9ee";
    for (const [sx, sy] of [[h - 0.35, 0], [-(h - 0.35), 0], [0, h - 0.35], [0, -(h - 0.35)]]) { ctx.beginPath(); ctx.arc(sx, sy, 0.1, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 0.1; poly(ctx, outer); ctx.stroke();
  });
}

// ---- Loaders: a dark trapezoid chute outlined in Alliance color, bolted to the wall
export function drawLoader(f: Frame2D, verts: { x: number; y: number }[], red: boolean): void {
  const { ctx } = f;
  ctx.save();
  ctx.beginPath();
  verts.forEach((v, i) => (i ? ctx.lineTo(f.px(v.x), f.py(v.y)) : ctx.moveTo(f.px(v.x), f.py(v.y))));
  ctx.closePath();
  ctx.fillStyle = "#101114"; ctx.fill();
  ctx.strokeStyle = red ? PALETTE.tapeRed : PALETTE.tapeBlue; ctx.lineWidth = 0.2 * f.S; ctx.lineJoin = "round"; ctx.stroke();
  // wall bracket
  const w = verts[0], w2 = verts[3];
  const dir = Math.sign(-w.x);
  ctx.fillStyle = "#050506";
  ctx.fillRect(f.px(w.x) - (dir > 0 ? 0 : 0.6 * f.S), f.py(w2.y), 0.6 * f.S, (w2.y - w.y) * f.S);
  ctx.restore();
}

// ---- Toggles: a triangular bar on top of the Perimeter; the face toward the Field shows the set color
const TOGGLE_NEXT: Record<string, string> = { yellow: "blue", blue: "red", red: "yellow" };
export function drawToggle(f: Frame2D, wall: "N" | "E" | "S" | "W", state: string): void {
  const { ctx } = f;
  const rot = { N: 0, E: 90, S: 180, W: 270 }[wall];
  local(f, 0, 0, rot, () => {
    // local frame: the wall is at y = 72, the Field below it
    const y0 = 72.05, L = TOGGLE_LENGTH, W = TOGGLE_FACE;
    const main = state === "red" ? PALETTE.red : state === "blue" ? PALETTE.blue : "#e4d769";
    const edge = TOGGLE_NEXT[state] === "red" ? PALETTE.red : TOGGLE_NEXT[state] === "blue" ? PALETTE.blue : "#e4d769";
    ctx.fillStyle = main; ctx.fillRect(-L / 2, y0, L, W);
    ctx.fillStyle = edge; ctx.fillRect(-L / 2, y0 + W - 0.28, L, 0.28);
    ctx.fillStyle = "rgba(255,255,255,0.16)"; ctx.fillRect(-L / 2, y0 + 0.5, L, 0.35);
    ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 0.08; ctx.strokeRect(-L / 2, y0, L, W);
    // end brackets and bolts
    ctx.fillStyle = "#0d0d10";
    for (const sg of [-1, 1]) { ctx.fillRect(sg > 0 ? L / 2 : -L / 2 - 0.65, y0 - 0.15, 0.65, W + 0.3); }
    ctx.fillStyle = "#d9d9de";
    for (const sg of [-1, 1]) { ctx.beginPath(); ctx.arc(sg * (L / 2 - 0.9), y0 + W / 2, 0.14, 0, Math.PI * 2); ctx.fill(); }
  });
}

/** The Field Perimeter: a light gray wall band just outside the tiles. */
export function drawPerimeter(f: Frame2D, half: number): void {
  const { ctx } = f;
  const t = 2.6;
  const x0 = f.px(-half - t), y0 = f.py(half + t), w = 2 * (half + t) * f.S, b = t * f.S;
  ctx.fillStyle = PALETTE.perimeter;
  ctx.fillRect(x0, y0, w, b); // top
  ctx.fillRect(x0, f.py(-half), w, b); // bottom
  ctx.fillRect(x0, y0, b, w); // left
  ctx.fillRect(f.px(half), y0, b, w); // right
  ctx.strokeStyle = PALETTE.perimeterEdge; ctx.lineWidth = 0.15 * f.S;
  ctx.strokeRect(f.px(-half), f.py(half), 2 * half * f.S, 2 * half * f.S);
}
