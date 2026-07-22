// Generates Phase 09 placeholder fighter spritesheets with stdlib only (no deps).
// ponytail: placeholder art proves the load->registry->anchor->animate pipeline and keeps tests +
// e2e green with ZERO art credits spent. Upgrade path = real Higgsfield sheets built by
// scripts/build-sprites.py replace these same public/sprites/<id>/<state>.png files.
//
// Output: for every fighter id and every state in public/configs/character-gym.json, writes
// public/sprites/<id>/<state>.png — a horizontal strip of `render.sheets[state].frames` cells,
// 320x256 each, 8-bit RGBA, TRANSPARENT background (no magenta -> nothing to key). Each cell is a
// feet-anchored silhouette (foot pixels pinned to the bottom row), tinted per fighter and posed per
// state so state->animation switching is visibly real. Deterministic — no RNG, no time.
//
// Run: `node scripts/gen-placeholder-sheet.mjs` (self-checks every emitted file).

import { deflateSync, inflateSync } from "node:zlib";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FRAME_W = 320;
const FRAME_H = 256;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = JSON.parse(readFileSync(join(ROOT, "public", "configs", "character-gym.json"), "utf8"));

// Per-fighter tint: [body, head] RGB. Marker is a bright forward block proving setFlipX mirroring.
const TINTS = {
  brawler: { body: [196, 64, 56], head: [150, 44, 40] },
  jiujitsu: { body: [56, 96, 196], head: [40, 64, 150] },
  monk: { body: [210, 170, 70], head: [160, 120, 44] },
};
const MARKER = [245, 245, 245, 255];

// Per-state pose: body box height + a coarse gesture. Feet pinned to the bottom row unless `lying`.
// bob/stride/extend vary per frame so the animation actually moves.
const POSE = {
  idle: { bodyH: 140, bodyW: 40 },
  walkF: { bodyH: 140, bodyW: 40, stride: true },
  walkB: { bodyH: 140, bodyW: 40, stride: true },
  crouch: { bodyH: 92, bodyW: 48 },
  jumpRise: { bodyH: 128, bodyW: 38, armsUp: true },
  jumpFall: { bodyH: 128, bodyW: 38, armsUp: true },
  attackLight: { bodyH: 140, bodyW: 40, punch: "high" },
  attackHeavy: { bodyH: 110, bodyW: 46, punch: "low" },
  airLight: { bodyH: 128, bodyW: 38, punch: "high", armsUp: true },
  airHeavy: { bodyH: 128, bodyW: 38, punch: "low", armsUp: true },
  crouchLight: { bodyH: 92, bodyW: 48, punch: "low" },
  crouchHeavy: { bodyH: 88, bodyW: 52, punch: "low" },
  hitstun: { bodyH: 140, bodyW: 40, lean: -8 },
  blockstun: { bodyH: 138, bodyW: 44, guard: true },
  knockdown: { bodyH: 56, bodyW: 96, lying: true },
  ko: { bodyH: 50, bodyW: 96, lying: true },
};

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function emit(id, state, frames) {
  const W = FRAME_W * frames;
  const H = FRAME_H;
  const px = new Uint8Array(W * H * 4); // transparent
  const tint = TINTS[id] ?? TINTS.brawler;
  const pose = POSE[state] ?? POSE.idle;

  const fillCell = (baseX, x0, y0, w, h, [r, g, b, a]) => {
    for (let y = y0; y < y0 + h; y++) {
      if (y < 0 || y >= H) continue;
      for (let x = baseX + x0; x < baseX + x0 + w; x++) {
        if (x < baseX || x >= baseX + FRAME_W || x < 0 || x >= W) continue;
        const i = (y * W + x) * 4;
        px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
      }
    }
  };

  for (let f = 0; f < frames; f++) {
    const baseX = f * FRAME_W;
    const cx = FRAME_W / 2;
    const t = frames > 1 ? f / (frames - 1) : 0; // 0..1 progression
    const bob = [0, 2, 3, 1][f % 4];

    if (pose.lying) {
      // horizontal body along the bottom, feet-anchored bottom row
      fillCell(baseX, cx - pose.bodyW / 2, FRAME_H - pose.bodyH, pose.bodyW, pose.bodyH, [...tint.body, 255]);
      fillCell(baseX, cx + pose.bodyW / 2 - 4, FRAME_H - pose.bodyH, 26, pose.bodyH, [...tint.head, 255]); // head at one end
      continue;
    }

    const lean = (pose.lean ?? 0) + (pose.stride ? [0, 4, 0, -4][f % 4] : 0);
    const bodyX = cx - pose.bodyW / 2 + lean;
    fillCell(baseX, bodyX, FRAME_H - pose.bodyH, pose.bodyW, pose.bodyH, [...tint.body, 255]);

    const headW = 30, headH = 34;
    const headBottom = FRAME_H - pose.bodyH - (pose.armsUp ? 6 : bob);
    fillCell(baseX, cx - headW / 2 + lean, headBottom - headH, headW, headH, [...tint.head, 255]);

    // forward marker / gesture on the +x side (mirrored by setFlipX at runtime)
    if (pose.punch) {
      const reach = 8 + Math.round(t * 60); // arm extends over the animation
      const y = pose.punch === "high" ? FRAME_H - 150 : FRAME_H - 70;
      fillCell(baseX, cx + pose.bodyW / 2, y, reach, 16, MARKER);
    } else if (pose.guard) {
      fillCell(baseX, cx + pose.bodyW / 2, FRAME_H - 130, 12, 70, MARKER); // forearm up = block
    } else {
      fillCell(baseX, cx + pose.bodyW / 2, FRAME_H - 100, 8, 16, MARKER);
    }
  }

  const png = encodePng(px, W, H);
  const dir = join(ROOT, "public", "sprites", id);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${state}.png`);
  writeFileSync(file, png);
  selfCheck(file, W, H);
  return file;
}

// --- minimal PNG encoder (IHDR/IDAT/IEND + CRC32) ---
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
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(px, W, H) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    const rowStart = y * (W * 4 + 1);
    raw[rowStart] = 0;
    px.subarray(y * W * 4, (y + 1) * W * 4).forEach((v, i) => (raw[rowStart + 1 + i] = v));
  }
  return Buffer.concat([PNG_SIG, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function selfCheck(file, W, H) {
  const buf = readFileSync(file);
  assert(buf.subarray(0, 8).equals(PNG_SIG), `bad PNG signature: ${file}`);
  const idat = [];
  let ihdrSeen = null, iendSeen = false, off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    const crcStored = buf.readUInt32BE(off + 8 + len);
    assert(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])) === crcStored, `bad CRC in ${type}`);
    if (type === "IHDR") ihdrSeen = data;
    if (type === "IDAT") idat.push(data);
    if (type === "IEND") iendSeen = true;
    off += 12 + len;
  }
  assert(ihdrSeen && iendSeen, `missing IHDR/IEND: ${file}`);
  assert(ihdrSeen.readUInt32BE(0) === W && ihdrSeen.readUInt32BE(4) === H, `wrong dimensions: ${file}`);
  const inflated = inflateSync(Buffer.concat(idat));
  assert(inflated.length === (W * 4 + 1) * H, `wrong raw scanline length: ${file}`);
}
function assert(cond, msg) {
  if (!cond) { console.error(`self-check FAILED: ${msg}`); process.exit(1); }
}

let count = 0;
for (const id of Object.keys(REGISTRY)) {
  if (id.startsWith("_")) continue;
  const sheets = REGISTRY[id].render.sheets;
  for (const state of Object.keys(sheets)) {
    emit(id, state, sheets[state].frames);
    count++;
  }
}
console.log(`ok: wrote ${count} placeholder sheets (320x256 cells) under public/sprites/<id>/`);
