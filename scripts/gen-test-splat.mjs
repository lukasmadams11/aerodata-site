/* Generates public/test.splat — a synthetic Gaussian-splat terrain in the
   standard 32-byte .splat format, for end-to-end viewer testing. Z-up,
   same site footprint as the test LAS tiles. Not committed (gitignored). */
import { writeFileSync, mkdirSync } from "node:fs";

const N = 160000;
const REC = 32;
const buf = Buffer.alloc(N * REC);

let s = 987;
const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;

const W = 280, D = 200;
const cols = Math.round(Math.sqrt((N * W) / D));
const rows = Math.ceil(N / cols);

let p = 0;
let written = 0;
for (let iy = 0; iy < rows && written < N; iy++) {
  for (let ix = 0; ix < cols && written < N; ix++) {
    const x = (ix / (cols - 1) - 0.5) * W;
    const y = (iy / (rows - 1) - 0.5) * D;
    let z =
      Math.sin(x * 0.045) * 6 +
      Math.cos(y * 0.06) * 5 +
      Math.sin((x + y) * 0.02) * 8;
    let r = 96 + z * 4 + rnd() * 24;
    let g = 104 + z * 3 + rnd() * 24;
    let b = 74 + rnd() * 20;
    const inBld = x > 40 && x < 95 && y > -30 && y < 15;
    if (inBld) {
      z = 16;
      r = 172; g = 158; b = 148;
    }

    buf.writeFloatLE(x, p);
    buf.writeFloatLE(y, p + 4);
    buf.writeFloatLE(z, p + 8);
    const sc = 0.45 + rnd() * 0.25; /* isotropic — rotation irrelevant */
    buf.writeFloatLE(sc, p + 12);
    buf.writeFloatLE(sc, p + 16);
    buf.writeFloatLE(sc, p + 20);
    buf.writeUInt8(Math.min(255, Math.max(0, Math.round(r))), p + 24);
    buf.writeUInt8(Math.min(255, Math.max(0, Math.round(g))), p + 25);
    buf.writeUInt8(Math.min(255, Math.max(0, Math.round(b))), p + 26);
    buf.writeUInt8(255, p + 27); /* opaque */
    buf.writeUInt8(255, p + 28); /* identity quaternion: w=1 → 255 */
    buf.writeUInt8(128, p + 29);
    buf.writeUInt8(128, p + 30);
    buf.writeUInt8(128, p + 31);
    p += REC;
    written++;
  }
}

mkdirSync(new URL("../public/", import.meta.url), { recursive: true });
writeFileSync(new URL("../public/test.splat", import.meta.url), buf);
console.log(`Wrote public/test.splat — ${written} splats, ${(buf.length / 1e6).toFixed(1)} MB`);
