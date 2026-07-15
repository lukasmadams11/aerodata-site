/*
 * las-worker.js — reads LAS / LAZ point clouds off the main thread.
 *
 * Input:  { type: "parse", file: Blob, budget: number }
 *         { type: "demo", budget: number }
 * Output: { type: "progress", percent, phase }
 *         { type: "done", positions, rgb?, intensity?, classification, ... }
 *         { type: "error", message }
 *
 * The Blob is read in chunks (never fully materialized on the main thread),
 * points are decimated to `budget` by stride sampling, and positions are
 * re-centered on a robust (median-sampled) center so Float32 precision
 * survives state-plane-sized coordinates even when junk points exist.
 */

import { createLazPerf } from "laz-perf";
import wasmUrl from "laz-perf/lib/laz-perf.wasm?url";

const PROGRESS_EVERY = 250000;
const CHUNK = 32 << 20; /* 32 MB read blocks */

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === "demo") {
      finish(makeDemo(Math.min(msg.budget || 1200000, 1400000)));
    } else if (msg.type === "parse") {
      const file = msg.file;
      const head = await file.slice(0, 375).arrayBuffer();
      const header = parseHeader(head, file.size);
      const result = header.compressed
        ? await parseLaz(file, header, msg.budget)
        : await parseLas(file, header, msg.budget);
      finish(result);
    }
  } catch (err) {
    self.postMessage({ type: "error", message: friendly(err) });
  }
};

function progress(percent, phase) {
  self.postMessage({ type: "progress", percent, phase });
}

function finish(r) {
  const transfer = [r.positions.buffer, r.classification.buffer];
  if (r.rgb) transfer.push(r.rgb.buffer);
  if (r.intensity) transfer.push(r.intensity.buffer);
  self.postMessage({ type: "done", ...r }, transfer);
}

function friendly(err) {
  if (err && err.message === "NOT_LAS")
    return "That file doesn't look like a LAS or LAZ scan. Please choose the .las or .laz file we sent you.";
  if (err && err.message === "EMPTY")
    return "This file doesn't contain any points we can read.";
  if (err && err.message === "TOO_BIG")
    return "This scan is too big for this device to open. Try a computer with more memory, or contact us and we'll send a lighter version.";
  return "Something went wrong while reading this file. If it keeps happening, contact us and we'll help.";
}

/* ---------------- LAS public header ---------------- */

function parseHeader(headBuffer, fileSize) {
  if (fileSize < 227 || headBuffer.byteLength < 227) throw new Error("NOT_LAS");
  const dv = new DataView(headBuffer);
  const sig = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (sig !== "LASF") throw new Error("NOT_LAS");

  const verMinor = dv.getUint8(25);
  const offsetToPoints = dv.getUint32(96, true);
  const rawFormat = dv.getUint8(104);
  const compressed = (rawFormat & 0x80) !== 0;
  const format = rawFormat & 0x3f;
  const recordLength = dv.getUint16(105, true);

  let count = dv.getUint32(107, true);
  if (verMinor >= 4 && headBuffer.byteLength >= 255) {
    const c64 = Number(dv.getBigUint64(247, true));
    if (c64 > 0) count = c64;
  }

  return {
    verMinor,
    offsetToPoints,
    compressed,
    format,
    recordLength,
    count,
    scale: [dv.getFloat64(131, true), dv.getFloat64(139, true), dv.getFloat64(147, true)],
    offset: [dv.getFloat64(155, true), dv.getFloat64(163, true), dv.getFloat64(171, true)],
  };
}

/* RGB byte offset inside a point record, by format (null = no color) */
const RGB_OFFSET = { 0: null, 1: null, 2: 20, 3: 28, 4: null, 5: 28, 6: null, 7: 30, 8: 30, 9: null, 10: 30 };

/* ---------------- collection ---------------- */

function makeCollector(kept, hasRgb, center = null) {
  return {
    positions: new Float32Array(kept * 3),
    rgb16: hasRgb ? new Uint16Array(kept * 3) : null,
    intensity16: new Uint16Array(kept),
    classification: new Uint8Array(kept),
    n: 0,
    center,
    maxIntensity: 0,
    maxColor: 0,
  };
}

function collect(c, x, y, z, intensity, cls, r, g, b) {
  if (!c.center) c.center = [Math.floor(x), Math.floor(y), Math.floor(z)];
  const i3 = c.n * 3;
  c.positions[i3] = x - c.center[0];
  c.positions[i3 + 1] = y - c.center[1];
  c.positions[i3 + 2] = z - c.center[2];
  if (c.rgb16) {
    c.rgb16[i3] = r;
    c.rgb16[i3 + 1] = g;
    c.rgb16[i3 + 2] = b;
    if (r > c.maxColor) c.maxColor = r;
    if (g > c.maxColor) c.maxColor = g;
    if (b > c.maxColor) c.maxColor = b;
  }
  c.intensity16[c.n] = intensity;
  c.classification[c.n] = cls;
  c.n++;
  if (intensity > c.maxIntensity) c.maxIntensity = intensity;
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[s.length >> 1];
};

/* Robust display bounds: percentile-based so a handful of junk points
   (a "point at origin" 500 km from the site) can't wreck the camera fit,
   the grid, or the elevation ramp. */
function robustBounds(c) {
  const n = c.n;
  const step = Math.max(1, Math.floor(n / 100000));
  const xs = [], ys = [], zs = [];
  for (let i = 0; i < n; i += step) {
    xs.push(c.positions[i * 3]);
    ys.push(c.positions[i * 3 + 1]);
    zs.push(c.positions[i * 3 + 2]);
  }
  const pct = (arr) => {
    arr.sort((a, b) => a - b);
    const lo = arr[Math.floor(0.005 * (arr.length - 1))];
    const hi = arr[Math.ceil(0.995 * (arr.length - 1))];
    const pad = Math.max(0.5, 0.02 * (hi - lo));
    return [lo - pad, hi + pad];
  };
  const [x0, x1] = pct(xs);
  const [y0, y1] = pct(ys);
  const [z0, z1] = pct(zs);
  return { min: [x0, y0, z0], max: [x1, y1, z1] };
}

function packResult(c, format, total) {
  if (c.n === 0) throw new Error("EMPTY");

  /* normalize colors: many files store 8-bit values in the 16-bit fields */
  let rgb = null;
  if (c.rgb16 && c.maxColor > 0) {
    const shift = c.maxColor > 255 ? 8 : 0;
    rgb = new Uint8Array(c.n * 3);
    for (let i = 0; i < c.n * 3; i++) rgb[i] = c.rgb16[i] >> shift;
  }

  let intensity = null;
  if (c.maxIntensity > 0) {
    intensity = new Uint8Array(c.n);
    const s = 255 / c.maxIntensity;
    for (let i = 0; i < c.n; i++) intensity[i] = c.intensity16[i] * s;
  }

  return {
    positions: c.n * 3 === c.positions.length ? c.positions : c.positions.slice(0, c.n * 3),
    rgb,
    intensity,
    classification: c.n === c.classification.length ? c.classification : c.classification.slice(0, c.n),
    kept: c.n,
    total,
    hasIntensity: c.maxIntensity > 0,
    format,
    bounds: robustBounds(c),
  };
}

/* Decode one record from a DataView at `base` and hand it to collect(). */
function readRecord(dv, base, h, rgbOff, clsOff, clsMask, c) {
  const x = dv.getInt32(base, true) * h.scale[0] + h.offset[0];
  const y = dv.getInt32(base + 4, true) * h.scale[1] + h.offset[1];
  const z = dv.getInt32(base + 8, true) * h.scale[2] + h.offset[2];
  const intensity = dv.getUint16(base + 12, true);
  const cls = dv.getUint8(base + clsOff) & clsMask;
  let r = 0, g = 0, b = 0;
  if (rgbOff !== null) {
    r = dv.getUint16(base + rgbOff, true);
    g = dv.getUint16(base + rgbOff + 2, true);
    b = dv.getUint16(base + rgbOff + 4, true);
  }
  collect(c, x, y, z, intensity, cls, r, g, b);
}

/* ---------------- uncompressed LAS (chunked reads) ---------------- */

async function parseLas(file, h, budget) {
  const usable = Math.max(
    0,
    Math.min(h.count, Math.floor((file.size - h.offsetToPoints) / h.recordLength))
  );
  if (usable === 0) throw new Error("EMPTY");

  const stride = Math.max(1, Math.ceil(usable / budget));
  const kept = Math.floor((usable - 1) / stride) + 1;
  const rgbOff = RGB_OFFSET[h.format] ?? null;
  const hasRgb = rgbOff !== null && h.recordLength >= rgbOff + 6;
  const effRgbOff = hasRgb ? rgbOff : null;
  const clsOff = h.format <= 5 ? 15 : 16;
  const clsMask = h.format <= 5 ? 0x1f : 0xff;

  /* robust center: median of up to 256 records spread across the file */
  const sampleN = Math.min(256, usable);
  const sampleStride = Math.max(1, Math.floor(usable / sampleN));
  const sx = [], sy = [], sz = [];
  for (let k = 0; k < sampleN; k++) {
    const base = h.offsetToPoints + k * sampleStride * h.recordLength;
    const dv = new DataView(await file.slice(base, base + 12).arrayBuffer());
    if (dv.byteLength < 12) break;
    sx.push(dv.getInt32(0, true) * h.scale[0] + h.offset[0]);
    sy.push(dv.getInt32(4, true) * h.scale[1] + h.offset[1]);
    sz.push(dv.getInt32(8, true) * h.scale[2] + h.offset[2]);
  }
  const center = sx.length
    ? [Math.floor(median(sx)), Math.floor(median(sy)), Math.floor(median(sz))]
    : null;

  const c = makeCollector(kept, hasRgb, center);
  const blockRecords = Math.max(1, Math.floor(CHUNK / h.recordLength));
  let nextSample = 0;

  for (let start = 0; start < usable; start += blockRecords) {
    const count = Math.min(blockRecords, usable - start);
    if (nextSample >= start + count) continue; /* whole block decimated away */
    const byteStart = h.offsetToPoints + start * h.recordLength;
    const dv = new DataView(
      await file.slice(byteStart, byteStart + count * h.recordLength).arrayBuffer()
    );
    while (nextSample < start + count) {
      readRecord(dv, (nextSample - start) * h.recordLength, h, effRgbOff, clsOff, clsMask, c);
      nextSample += stride;
    }
    progress((start / usable) * 100, "Reading your scan…");
  }

  return packResult(c, h.format, usable);
}

/* ---------------- LAZ via laz-perf WASM ---------------- */

let lazPerfPromise = null;
function getLazPerf() {
  if (!lazPerfPromise) lazPerfPromise = createLazPerf({ locateFile: () => wasmUrl });
  return lazPerfPromise;
}

async function parseLaz(file, h, budget) {
  progress(0, "Uncompressing…");
  const LazPerf = await getLazPerf();

  let filePtr = 0;
  let dataPtr = 0;
  let laszip = null;

  try {
    filePtr = LazPerf._malloc(file.size);
    if (!filePtr) throw new Error("TOO_BIG");
    /* copy the file into the wasm heap in chunks — never materialize it whole in JS */
    for (let o = 0; o < file.size; o += CHUNK) {
      const part = new Uint8Array(await file.slice(o, Math.min(file.size, o + CHUNK)).arrayBuffer());
      LazPerf.HEAPU8.set(part, filePtr + o);
    }

    laszip = new LazPerf.LASZip();
    laszip.open(filePtr, file.size);
    const total = laszip.getCount() || h.count;
    if (total === 0) throw new Error("EMPTY");
    const recordLength = laszip.getPointLength();
    const format = laszip.getPointFormat() & 0x3f;
    dataPtr = LazPerf._malloc(recordLength);
    if (!dataPtr) throw new Error("TOO_BIG");

    const stride = Math.max(1, Math.ceil(total / budget));
    const kept = Math.floor((total - 1) / stride) + 1;
    const rgbOff = RGB_OFFSET[format] ?? null;
    const hasRgb = rgbOff !== null && recordLength >= rgbOff + 6;
    const effRgbOff = hasRgb ? rgbOff : null;
    const clsOff = format <= 5 ? 15 : 16;
    const clsMask = format <= 5 ? 0x1f : 0xff;
    const c = makeCollector(kept, hasRgb);

    /* robust center: median of the first sampled records (decode is sequential,
       so a spread sample isn't available — a local median still defeats junk
       points and gives Float32 all the precision it needs) */
    const PRESCAN = Math.min(256, kept);
    const pre = [];

    /* the wasm heap can grow and detach earlier views — re-check per point */
    let heapBuf = LazPerf.HEAPU8.buffer;
    let dv = new DataView(heapBuf);
    const hdr = { scale: h.scale, offset: h.offset };

    for (let i = 0; i < total; i++) {
      laszip.getPoint(dataPtr);
      if (i % stride !== 0) continue;
      if (LazPerf.HEAPU8.buffer !== heapBuf) {
        heapBuf = LazPerf.HEAPU8.buffer;
        dv = new DataView(heapBuf);
      }
      if (pre !== null && pre.length < PRESCAN) {
        /* buffer decoded fields until the center is established */
        const x = dv.getInt32(dataPtr, true) * h.scale[0] + h.offset[0];
        const y = dv.getInt32(dataPtr + 4, true) * h.scale[1] + h.offset[1];
        const z = dv.getInt32(dataPtr + 8, true) * h.scale[2] + h.offset[2];
        const intensity = dv.getUint16(dataPtr + 12, true);
        const cls = dv.getUint8(dataPtr + clsOff) & clsMask;
        let r = 0, g = 0, b = 0;
        if (effRgbOff !== null) {
          r = dv.getUint16(dataPtr + effRgbOff, true);
          g = dv.getUint16(dataPtr + effRgbOff + 2, true);
          b = dv.getUint16(dataPtr + effRgbOff + 4, true);
        }
        pre.push([x, y, z, intensity, cls, r, g, b]);
        if (pre.length === PRESCAN) flushPrescan(c, pre);
        continue;
      }
      readRecord(dv, dataPtr, hdr, effRgbOff, clsOff, clsMask, c);
      if (i % PROGRESS_EVERY === 0) progress((i / total) * 100, "Uncompressing…");
    }
    /* small files: prescan may never have filled */
    if (c.n === 0 && pre.length) flushPrescan(c, pre);

    return packResult(c, format, total);
  } finally {
    if (dataPtr) LazPerf._free(dataPtr);
    if (filePtr) LazPerf._free(filePtr);
    if (laszip) laszip.delete();
  }
}

function flushPrescan(c, pre) {
  c.center = [
    Math.floor(median(pre.map((p) => p[0]))),
    Math.floor(median(pre.map((p) => p[1]))),
    Math.floor(median(pre.map((p) => p[2]))),
  ];
  for (const p of pre) collect(c, p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7]);
  pre.length = 0;
}

/* ---------------- built-in demo terrain ---------------- */

function makeDemo(n) {
  let s = 4242;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];
  const fade = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  const g = (X, Y) => perm[(perm[X & 255] + Y) & 255] / 255;
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const u = fade(x - xi), v = fade(y - yi);
    return lerp(lerp(g(xi, yi), g(xi + 1, yi), u), lerp(g(xi, yi + 1), g(xi + 1, yi + 1), u), v);
  };
  const fbm = (x, y) => 0.6 * noise(x, y) + 0.28 * noise(x * 2.3, y * 2.3) + 0.12 * noise(x * 4.9, y * 4.9);

  const W = 320, D = 240;
  const cols = Math.round(Math.sqrt((n * W) / D));
  const rows = Math.round(n / cols);
  const kept = cols * rows;
  const c = makeCollector(kept, true, [0, 0, 0]);

  const bld = { x0: 60, x1: 118, y0: -40, y1: 8, z: 14 };
  const pond = { cx: -80, cy: -55, r: 34 };

  for (let iy = 0; iy < rows; iy++) {
    for (let ix = 0; ix < cols; ix++) {
      const x = (ix / (cols - 1) - 0.5) * W + (rnd() - 0.5) * 0.7;
      const y = (iy / (rows - 1) - 0.5) * D + (rnd() - 0.5) * 0.7;
      let z = fbm(x * 0.02 + 7, y * 0.02 + 3) * 26;
      let cls = 2;
      let r, g2, b;

      const dpond = Math.hypot(x - pond.cx, y - pond.cy);
      const inBld = x > bld.x0 && x < bld.x1 && y > bld.y0 && y < bld.y1;
      const treeN = noise(x * 0.045 + 40, y * 0.045 + 9);

      if (dpond < pond.r) {
        z = Math.min(z, 4.2) - 1.5;
        cls = 9;
        r = 46; g2 = 98; b = 158;
      } else if (inBld) {
        z = bld.z + (rnd() - 0.5) * 0.15;
        cls = 6;
        r = 168; g2 = 152; b = 142;
      } else if (treeN > 0.62 && z > 6) {
        z += 3 + treeN * 9 + rnd() * 2;
        cls = 5;
        const v = 0.55 + rnd() * 0.45;
        r = 52 * v; g2 = 118 * v; b = 58 * v;
      } else {
        const t = z / 26;
        r = lerp(96, 152, t) + (rnd() - 0.5) * 14;
        g2 = lerp(108, 132, t) + (rnd() - 0.5) * 14;
        b = lerp(72, 104, t) + (rnd() - 0.5) * 10;
      }

      const intensity = Math.round(400 + noise(x * 0.1, y * 0.1) * 600 + rnd() * 120);
      collect(c, x, y, z, intensity, cls, r, g2, b);
    }
    if (iy % 40 === 0) progress((iy / rows) * 100, "Building the demo scan…");
  }

  return packResult(c, 3, kept);
}
