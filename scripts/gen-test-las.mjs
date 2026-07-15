/* Generates public/test.las — a synthetic LAS 1.2 / point-format-3 terrain
   for end-to-end viewer testing. Not committed (gitignored). */
import { writeFileSync, mkdirSync } from "node:fs";

const N = 300000;
const HEADER = 227;
const REC = 34;

const buf = Buffer.alloc(HEADER + N * REC);

/* ---- header ---- */
buf.write("LASF", 0, "ascii");
buf.writeUInt8(1, 24); // version major
buf.writeUInt8(2, 25); // version minor
buf.write("AERODATA SYNTH", 26, "ascii");
buf.write("gen-test-las", 58, "ascii");
buf.writeUInt16LE(180, 90); // day
buf.writeUInt16LE(2026, 92); // year
buf.writeUInt16LE(HEADER, 94);
buf.writeUInt32LE(HEADER, 96); // offset to points
buf.writeUInt32LE(0, 100); // VLRs
buf.writeUInt8(3, 104); // point format 3
buf.writeUInt16LE(REC, 105);
buf.writeUInt32LE(N, 107);

const scale = 0.01;
const ox = 512000, oy = 4182000, oz = 100;
buf.writeDoubleLE(scale, 131);
buf.writeDoubleLE(scale, 139);
buf.writeDoubleLE(scale, 147);
buf.writeDoubleLE(ox, 155);
buf.writeDoubleLE(oy, 163);
buf.writeDoubleLE(oz, 171);

/* ---- points: rolling terrain + one flat "building" pad ---- */
let s = 1234;
const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
const W = 280, D = 200;
const cols = Math.round(Math.sqrt((N * W) / D));
const rows = Math.ceil(N / cols);

let minX = Infinity, minY = Infinity, minZ = Infinity;
let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

let p = HEADER;
let written = 0;
for (let iy = 0; iy < rows && written < N; iy++) {
  for (let ix = 0; ix < cols && written < N; ix++) {
    const x = (ix / (cols - 1) - 0.5) * W;
    const y = (iy / (rows - 1) - 0.5) * D;
    let z =
      Math.sin(x * 0.045) * 6 +
      Math.cos(y * 0.06) * 5 +
      Math.sin((x + y) * 0.02) * 8 +
      rnd() * 0.3;
    let cls = 2;
    let r = 90 + z * 4 + rnd() * 20;
    let g = 100 + z * 3 + rnd() * 20;
    let b = 70 + rnd() * 20;

    const inBld = x > 40 && x < 95 && y > -30 && y < 15;
    if (inBld) {
      z = 16;
      cls = 6;
      r = 170; g = 155; b = 145;
    } else if (Math.sin(x * 0.11) * Math.cos(y * 0.13) > 0.55 && z > 2) {
      z += 4 + rnd() * 6;
      cls = 5;
      r = 45 + rnd() * 25; g = 110 + rnd() * 30; b = 50 + rnd() * 20;
    }

    buf.writeInt32LE(Math.round(x / scale), p);
    buf.writeInt32LE(Math.round(y / scale), p + 4);
    buf.writeInt32LE(Math.round(z / scale), p + 8);
    buf.writeUInt16LE(Math.round(300 + rnd() * 900), p + 12); // intensity
    buf.writeUInt8(0b00010001, p + 14); // 1 return, first
    buf.writeUInt8(cls, p + 15);
    buf.writeDoubleLE(written * 0.0001, p + 20); // gps time
    /* 16-bit RGB (8-bit values << 8) to exercise the viewer's shift heuristic */
    buf.writeUInt16LE(Math.min(255, Math.max(0, Math.round(r))) << 8, p + 28);
    buf.writeUInt16LE(Math.min(255, Math.max(0, Math.round(g))) << 8, p + 30);
    buf.writeUInt16LE(Math.min(255, Math.max(0, Math.round(b))) << 8, p + 32);

    const wx = ox + x, wy = oy + y, wz = oz + z;
    if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
    if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
    if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
    p += REC;
    written++;
  }
}

buf.writeDoubleLE(maxX, 179);
buf.writeDoubleLE(minX, 187);
buf.writeDoubleLE(maxY, 195);
buf.writeDoubleLE(minY, 203);
buf.writeDoubleLE(maxZ, 211);
buf.writeDoubleLE(minZ, 219);

mkdirSync(new URL("../public/", import.meta.url), { recursive: true });
writeFileSync(new URL("../public/test.las", import.meta.url), buf);
console.log(`Wrote public/test.las — ${written} points, ${(buf.length / 1e6).toFixed(1)} MB`);
