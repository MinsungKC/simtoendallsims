import type { Frame } from "../core/runtime";
import type { CustomField, GameModule } from "../games/types";
import { zoneScore } from "../games";
import type { World } from "../core/world";

export const TEAM_COLOR = { red: "#e5484d", blue: "#3e8bff", neutral: "#e2b93b" } as const;

/** Find the frame index at or before time t (frames are time-sorted). */
export function frameIndex(frames: Frame[], t: number): number {
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}

export function lerpFrame(frames: Frame[], t: number): Frame {
  const i = frameIndex(frames, t);
  const a = frames[i];
  const b = frames[Math.min(i + 1, frames.length - 1)];
  if (a === b || b.t === a.t) return a;
  const f = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
  const l = (p: number, q: number) => p + (q - p) * f;
  return {
    ...a, t,
    x: l(a.x, b.x), y: l(a.y, b.y), heading: l(a.heading, b.heading),
    ex: l(a.ex, b.ex), ey: l(a.ey, b.ey), etheta: l(a.etheta, b.etheta),
    vx: l(a.vx, b.vx), vy: l(a.vy, b.vy), w: l(a.w, b.w),
    wheelVL: l(a.wheelVL, b.wheelVL), wheelVR: l(a.wheelVR, b.wheelVR),
    battery: l(a.battery, b.battery), current: l(a.current, b.current),
    objs: a.objs.map((v, k) => (k % 4 === 2 ? v : l(v, b.objs[k]))),
  };
}

export function bearingDeg(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return (Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI;
}

export function scoreFor(game: GameModule, custom: CustomField | null, world: World) {
  if (custom && custom.zones.length) return zoneScore(world, custom.zones);
  return game.score(world);
}

export function fmt(n: number, d = 1): string {
  return Number(n.toFixed(d)).toString();
}

export function download(name: string, data: BlobPart, type = "text/plain"): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Minimal STORE-only zip writer so the generated project can be downloaded in one file. */
export function makeZip(files: { path: string; content: string }[]): Uint8Array {
  const enc = new TextEncoder();
  const crcTable = (() => {
    const t: number[] = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t.push(c >>> 0);
    }
    return t;
  })();
  const crc32 = (b: Uint8Array) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  for (const f of files) {
    const name = enc.encode(f.path);
    const data = enc.encode(f.content);
    const crc = crc32(data);
    const local = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...name, ...data]);
    parts.push(local);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name]));
    offset += local.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}
