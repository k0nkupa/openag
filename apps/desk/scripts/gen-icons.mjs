// Writes the PWA icons and favicon with no dependencies: a blue rounded square with a white ring and dot.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "public");
mkdirSync(out, { recursive: true });

const BG = [37, 99, 235];
const FG = [255, 255, 255];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Motif in unit coordinates (0..1), centred. `scale` shrinks it for the maskable safe zone (inner 80%).
function motif(u, v, scale) {
  const dx = (u - 0.5) / scale, dy = (v - 0.5) / scale;
  const d = Math.hypot(dx, dy);
  if (d <= 0.12) return true; // dot
  return d >= 0.27 && d <= 0.36; // ring
}

// Motif coverage with 2x2 supersampling so the ring edges are smooth.
function coverage(u, v, size, scale) {
  let hits = 0;
  for (const ox of [-0.25, 0.25]) for (const oy of [-0.25, 0.25]) {
    if (motif(u + ox / size, v + oy / size, scale)) hits++;
  }
  return hits / 4;
}

const blend = (cov) => [
  Math.round(BG[0] * (1 - cov) + FG[0] * cov),
  Math.round(BG[1] * (1 - cov) + FG[1] * cov),
  Math.round(BG[2] * (1 - cov) + FG[2] * cov),
  255,
];

// Rounded-square icon: transparent outside a corner radius of 22% of the size.
const roundedPixel = (x, y, size) => {
  const u = (x + 0.5) / size, v = (y + 0.5) / size;
  const r = 0.22;
  const cx = Math.min(Math.max(u, r), 1 - r), cy = Math.min(Math.max(v, r), 1 - r);
  if (Math.hypot(u - cx, v - cy) > r) return [0, 0, 0, 0];
  return blend(coverage(u, v, size, 1));
};

// Maskable: full-bleed background, motif scaled into the central 80% safe zone.
const maskablePixel = (x, y, size) => {
  const u = (x + 0.5) / size, v = (y + 0.5) / size;
  return blend(coverage(u, v, size, 0.8));
};

writeFileSync(join(out, "icon-192.png"), png(192, roundedPixel));
writeFileSync(join(out, "icon-512.png"), png(512, roundedPixel));
writeFileSync(join(out, "icon-maskable-512.png"), png(512, maskablePixel));
writeFileSync(
  join(out, "favicon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2563eb"/><circle cx="32" cy="32" r="18" fill="none" stroke="#fff" stroke-width="6"/><circle cx="32" cy="32" r="7" fill="#fff"/></svg>\n`,
);
console.log("wrote icons to", out);
