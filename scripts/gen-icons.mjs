// Generates the Git Replay app icons (pure Node, no dependencies).
// Draws a git-timeline motif (branch line + commits + playhead) onto a rounded
// dark square, then encodes PNG and ICO (PNG-in-ICO) by hand.
//
// Usage: node scripts/gen-icons.mjs

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "desktop", "src-tauri", "icons");

// ---------------------------------------------------------------------------
// PNG encoding (RGBA, 8-bit, no interlace)
// ---------------------------------------------------------------------------

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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------
// ICO container (single 256x256 PNG entry — valid since Vista)
// ---------------------------------------------------------------------------

function encodeIco(pngBuf) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // image count
  const entry = Buffer.alloc(16);
  entry[0] = 0; // width 256
  entry[1] = 0; // height 256
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(22, 12); // image offset
  return Buffer.concat([header, entry, pngBuf]);
}

// ---------------------------------------------------------------------------
// Drawing (signed-distance shapes → coverage → over-composite)
// ---------------------------------------------------------------------------

const clamp01 = (v) => Math.min(1, Math.max(0, v));

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax, pay = py - ay;
  const bax = bx - ax, bay = by - ay;
  const h = clamp01((pax * bax + pay * bay) / (bax * bax + bay * bay));
  return Math.hypot(pax - bax * h, pay - bay * h);
}

// Returns a 0..1 coverage map for the given SDF, with ~1px anti-aliased edge.
function coverage(size, sd) {
  const cov = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      cov[y * size + x] = clamp01(0.5 - sd(x + 0.5, y + 0.5));
    }
  }
  return cov;
}

function newCanvas(size) {
  return new Uint8Array(size * size * 4);
}

function paint(canvas, size, cov, r, g, b) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = cov[y * size + x];
      if (a <= 0) continue;
      const i = (y * size + x) * 4;
      const dstA = canvas[i + 3] / 255;
      const outA = a + dstA * (1 - a);
      if (outA <= 0) continue;
      canvas[i] = Math.round((r * a + canvas[i] * (dstA * (1 - a))) / outA);
      canvas[i + 1] = Math.round((g * a + canvas[i + 1] * (dstA * (1 - a))) / outA);
      canvas[i + 2] = Math.round((b * a + canvas[i + 2] * (dstA * (1 - a))) / outA);
      canvas[i + 3] = Math.round(outA * 255);
    }
  }
}

// Draws a rounded-corner segment with round caps.
function paintSegment(canvas, size, ax, ay, bx, by, w, r, g, b) {
  const half = w / 2;
  let cov = coverage(size, (px, py) => sdSegment(px, py, ax, ay, bx, by) - half);
  for (const [cx, cy] of [[ax, ay], [bx, by]]) {
    const caps = coverage(size, (px, py) => sdCircle(px, py, cx, cy, half));
    for (let i = 0; i < cov.length; i++) cov[i] = Math.max(cov[i], caps[i]);
  }
  paint(canvas, size, cov, r, g, b);
}

function paintCircle(canvas, size, cx, cy, r, r0, g0, b0) {
  paint(canvas, size, coverage(size, (px, py) => sdCircle(px, py, cx, cy, r)), r0, g0, b0);
}

// ---------------------------------------------------------------------------
// The motif
// ---------------------------------------------------------------------------

const BG = [0x16, 0x18, 0x1d]; // near-black slate
const LINE = [0x3a, 0x40, 0x50]; // muted branch line
const ACCENT = [0x5b, 0x8d, 0xef]; // blue playhead
const GREEN = [0x3f, 0xb9, 0x50];
const AMBER = [0xd2, 0x99, 0x22];

function draw(size) {
  const canvas = newCanvas(size);
  // Rounded-square background with a transparent margin.
  const m = size * 0.03;
  const bg = coverage(
    size,
    (px, py) => sdRoundRect(px, py, size / 2, size / 2, size / 2 - m, size / 2 - m, size * 0.21),
  );
  paint(canvas, size, bg, ...BG);

  // Branch line: up-left leg (muted) and up-right leg (accent).
  const ax = size * 0.20, ay = size * 0.70;
  const mx = size * 0.485, my = size * 0.515;
  const bx = size * 0.80, by = size * 0.33;
  const w = size * 0.045;
  paintSegment(canvas, size, ax, ay, mx, my, w, ...LINE);
  paintSegment(canvas, size, mx, my, bx, by, w, ...ACCENT);

  // Commits along the line.
  paintCircle(canvas, size, ax, ay, size * 0.052, ...GREEN);
  paintCircle(canvas, size, mx, my, size * 0.052, ...AMBER);

  // Playhead: ring around the current commit.
  const pr = size * 0.086;
  const hole = size * 0.035;
  paintCircle(canvas, size, bx, by, pr, ...ACCENT);
  paint(canvas, size, coverage(size, (px, py) => sdCircle(px, py, bx, by, hole)), ...BG);

  return canvas;
}

function downscale(src, from, to) {
  const k = from / to;
  const out = newCanvas(to);
  for (let y = 0; y < to; y++) {
    for (let x = 0; x < to; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < k; sy++) {
        for (let sx = 0; sx < k; sx++) {
          const i = ((y * k + sy) * from + x * k + sx) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3];
        }
      }
      const n = k * k;
      const i = (y * to + x) * 4;
      out[i] = Math.round(r / n);
      out[i + 1] = Math.round(g / n);
      out[i + 2] = Math.round(b / n);
      out[i + 3] = Math.round(a / n);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });

const S = 256;
const icon256 = draw(S);
const png256 = encodePng(S, S, icon256);
const png128 = encodePng(128, 128, downscale(icon256, S, 128));
const png32 = encodePng(32, 32, downscale(icon256, S, 32));

writeFileSync(join(OUT_DIR, "icon.png"), png256);
writeFileSync(join(OUT_DIR, "128x128.png"), png128);
writeFileSync(join(OUT_DIR, "128x128@2x.png"), png256);
writeFileSync(join(OUT_DIR, "32x32.png"), png32);
writeFileSync(join(OUT_DIR, "icon.ico"), encodeIco(png256));

console.log(`Wrote 5 icons to ${OUT_DIR}`);
