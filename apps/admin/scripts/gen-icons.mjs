// Regenerates the PWA icons in public/icons from one set of shape parameters,
// so the SVG and the PNGs cannot drift apart. No image dependency: the PNGs are
// rasterized here and encoded with node:zlib.
//
//   node apps/admin/scripts/gen-icons.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "../public/icons");

const BG = [0x0f, 0x14, 0x19];
const RING = [0x3d, 0x9c, 0xfd];
const DOT = [0x3e, 0xcf, 0x8e];

// Geometry in a unit square, y pointing down.
const CORNER = 0.22;
const RING_R = 0.27;
const RING_W = 0.085;
const DOT_R = 0.075;
const GAP_AT = -45;
const GAP_HALF = 30;
// Maskable icons may be cropped to a circle of 80% diameter.
const MASKABLE_SCALE = 0.72;

const rad = (deg) => (deg * Math.PI) / 180;
const onRing = (deg) => [
  0.5 + RING_R * Math.cos(rad(deg)),
  0.5 + RING_R * Math.sin(rad(deg)),
];
const ARC_START = onRing(GAP_AT + GAP_HALF);
const ARC_END = onRing(GAP_AT - GAP_HALF);
const DOT_C = onRing(GAP_AT);

function colorAt(u, v, maskable) {
  if (!maskable) {
    const qx = Math.abs(u - 0.5) - (0.5 - CORNER);
    const qy = Math.abs(v - 0.5) - (0.5 - CORNER);
    const outside =
      Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
        Math.min(Math.max(qx, qy), 0) >
      CORNER;
    if (outside) return null;
  }
  const scale = maskable ? MASKABLE_SCALE : 1;
  const x = (u - 0.5) / scale + 0.5;
  const y = (v - 0.5) / scale + 0.5;

  if (Math.hypot(x - DOT_C[0], y - DOT_C[1]) <= DOT_R) return DOT;

  const dx = x - 0.5;
  const dy = y - 0.5;
  let fromGap = (Math.atan2(dy, dx) * 180) / Math.PI - GAP_AT;
  fromGap = Math.abs(((fromGap + 540) % 360) - 180);
  const onStroke = Math.abs(Math.hypot(dx, dy) - RING_R) <= RING_W / 2;
  const onCap = [ARC_START, ARC_END].some(
    ([cx, cy]) => Math.hypot(x - cx, y - cy) <= RING_W / 2,
  );
  if ((onStroke && fromGap >= GAP_HALF) || onCap) return RING;
  return BG;
}

function rasterize(size, maskable) {
  const SS = 4;
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = colorAt(
            (px + (sx + 0.5) / SS) / size,
            (py + (sy + 0.5) / SS) / size,
            maskable,
          );
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          covered++;
        }
      }
      const i = (py * size + px) * 4;
      if (covered > 0) {
        rgba[i] = Math.round(r / covered);
        rgba[i + 1] = Math.round(g / covered);
        rgba[i + 2] = Math.round(b / covered);
      }
      rgba[i + 3] = Math.round((covered / (SS * SS)) * 255);
    }
  }
  return rgba;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    // Each scanline starts with filter type 0 (none).
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function svg() {
  const hex = (c) => `#${c.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  const px = (n) => Number((n * 512).toFixed(2));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${px(CORNER)}" fill="${hex(BG)}"/>
  <path d="M${px(ARC_START[0])} ${px(ARC_START[1])}A${px(RING_R)} ${px(RING_R)} 0 1 1 ${px(ARC_END[0])} ${px(ARC_END[1])}" fill="none" stroke="${hex(RING)}" stroke-width="${px(RING_W)}" stroke-linecap="round"/>
  <circle cx="${px(DOT_C[0])}" cy="${px(DOT_C[1])}" r="${px(DOT_R)}" fill="${hex(DOT)}"/>
</svg>
`;
}

mkdirSync(outDir, { recursive: true });
const outputs = [
  ["icon-192.png", encodePng(192, rasterize(192, false))],
  ["icon-512.png", encodePng(512, rasterize(512, false))],
  ["icon-maskable-512.png", encodePng(512, rasterize(512, true))],
  ["icon.svg", Buffer.from(svg(), "utf8")],
];
for (const [name, data] of outputs) {
  writeFileSync(join(outDir, name), data);
  console.log(`${name}  ${data.length} bytes`);
}
