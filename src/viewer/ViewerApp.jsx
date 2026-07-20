import React, { useEffect, useRef, useState } from "react";
import {
  Camera,
  Crosshair,
  Expand,
  Files,
  Focus,
  FolderOpen,
  HelpCircle,
  Map,
  Minus,
  Mountain,
  Plus,
  RotateCcw,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { CLASS_LEGEND } from "./classLegend.js";
import { diag, diagReport } from "./diag.js";

/* ------------------------------------------------------------------ */
/*  Device budgets                                                     */
/*  navigator.deviceMemory is Chromium-only — Safari (all iOS/iPadOS   */
/*  browsers) and Firefox never expose it — so when the hint is absent */
/*  fall back to a mobile-class check. iPadOS Safari masquerades as    */
/*  desktop macOS, so iPads are caught via Macintosh+maxTouchPoints.   */
/* ------------------------------------------------------------------ */

const IS_CONSTRAINED = (() => {
  if (typeof navigator === "undefined") return false;
  if (navigator.deviceMemory !== undefined) return navigator.deviceMemory <= 4;
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
})();

/* ?budget=N and ?safe=1 support testing, troubleshooting, and power users */
const URL_PARAMS =
  typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
const URL_BUDGET = Number(URL_PARAMS.get("budget")) || 0;
const POINT_BUDGET = URL_BUDGET > 0 ? URL_BUDGET : IS_CONSTRAINED ? 2000000 : 4500000;
const SAFE_START = URL_PARAMS.get("safe") === "1";
const LITE_BUDGET = 1200000;

/* Gaussian-splat "photo" models (DJI Terra 3DGS output and friends) */
const SPLAT_RE = /\.(ply|splat|ksplat|spz)$/i;
const splatFormatOf = (name) => {
  const ext = (name.match(SPLAT_RE) || [])[1]?.toLowerCase();
  return { ply: "Ply", splat: "Splat", ksplat: "KSplat", spz: "Spz" }[ext] || null;
};

const MB = 1024 * 1024;
/* Plain (non-COPC) .laz must be decompressed whole inside the wasm heap — capped.
   .las streams in 32 MB blocks and .copc.laz streams by octree node, so both
   open at any size; the LAS bound below is only a sanity ceiling. */
const MAX_PLAIN_LAZ_BYTES = (IS_CONSTRAINED ? 300 : 500) * MB;
const MAX_LOCAL_LAS_BYTES = 200 * 1024 * MB;
/* The full-download fallback (hosts without range support) holds the whole
   file in memory, so it keeps the old, tighter caps. */
const MAX_DOWNLOAD_LAZ_BYTES = MAX_PLAIN_LAZ_BYTES;
const MAX_DOWNLOAD_LAS_BYTES = (IS_CONSTRAINED ? 600 : 1600) * MB;

const TOO_LARGE_MSG =
  "This compressed scan is too large to open whole in a browser. Run it through the AeroData COPC converter (Make-COPC) for a streaming version that opens at any size — or contact us and we'll send one.";

/* Sniff the LAS 1.4 header for the COPC info VLR — COPC files stream, so
   they're exempt from the plain-LAZ size cap even if renamed. */
const isCopcBlob = async (file) => {
  try {
    const dv = new DataView(await file.slice(0, 440).arrayBuffer());
    if (dv.byteLength < 395) return false;
    const sig = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (sig !== "LASF" || dv.getUint8(25) < 4) return false;
    let userId = "";
    for (let i = 377; i < 393; i++) {
      const b = dv.getUint8(i);
      if (!b) break;
      userId += String.fromCharCode(b);
    }
    return userId === "copc" && dv.getUint16(393, true) === 1;
  } catch {
    return false;
  }
};

const COLOR_MODES = [
  { id: "elevation", label: "Height" },
  { id: "rgb", label: "True color" },
  { id: "intensity", label: "Scanner brightness" },
  { id: "classification", label: "Surface type" },
];

const formatPoints = (n) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)} million` : n.toLocaleString();

/* Terra deliverables ship both merged and per-tile scans of the SAME data
   (terra_las/cloud_merged.las alongside cloud0..N.las). Loading both would
   double the work and the memory. When a "merged"/"combined" scan is
   present, drop the numbered tiles. Also collapse 3DGS LOD duplicates to
   the highest level so a folder pick doesn't stack every LOD of every tile. */
function dedupeScanSet(files) {
  const merged = files.filter((f) => /(merged|combined|full|all)/i.test(f.name));
  if (merged.length && merged.length < files.length) {
    const tiles = files.filter(
      (f) => !merged.includes(f) && /(^|[^a-z])(cloud|tile|block|part)\s*[-_]?\d/i.test(f.name)
    );
    if (tiles.length) return files.filter((f) => !tiles.includes(f));
  }
  return files;
}

/* Lazy-load the 3D chunk (three.js) only when a scan is actually opened */
let scenePromise = null;
const loadSceneModule = () => (scenePromise ??= import("./PointCloudScene.js"));

function Logo() {
  return (
    <a href="./" className="flex items-center gap-2.5" title="Back to AeroData home">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-400/40 bg-cyan-400/10">
        <Crosshair className="h-4 w-4 text-cyan-300" strokeWidth={1.75} />
      </span>
      <span className="font-display text-[15px] font-bold tracking-tight">
        Aero<span className="text-cyan-400">Data</span>
        <span className="ml-2 hidden font-mono text-[10px] font-normal uppercase tracking-hud-mid text-slate-400 sm:inline">
          Scan Viewer
        </span>
      </span>
    </a>
  );
}

const toolbarBtn =
  "flex min-h-11 items-center gap-2 rounded-lg px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white";

export default function ViewerApp() {
  const [stage, setStage] = useState({ kind: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const [colorMode, setColorMode] = useState("elevation");
  const [pointSize, setPointSize] = useState(2);
  const [helpOpen, setHelpOpen] = useState(false);
  const [modeNotice, setModeNotice] = useState("");
  const [announce, setAnnounce] = useState("");
  const [slow, setSlow] = useState(false);
  const [viewMode, setViewMode] = useState("points");
  const [splatState, setSplatState] = useState(null); /* null | {loading,percent} | {count} */
  const [blackDetected, setBlackDetected] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);
  const lastPhaseRef = useRef("");

  const copyReport = () => {
    const text = diagReport();
    const done = () => {
      setReportCopied(true);
      setTimeout(() => setReportCopied(false), 3000);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => window.prompt("Copy this report:", text));
    } else {
      window.prompt("Copy this report:", text);
    }
  };

  const workerRef = useRef(null);
  const dataRef = useRef(null);
  const sceneRef = useRef(null);
  const mountRef = useRef(null);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const pendingSkipRef = useRef(0);
  const streamFallbackRef = useRef(null);
  const splatUrlRef = useRef(null); /* { url, revoke } */
  const pendingSplatRef = useRef(null); /* File waiting for the scan to finish */
  const splatLoadRunningRef = useRef(false);
  const sourceRef = useRef(null); /* { files, center } — for Sharpen reloads */
  const sharpenedRef = useRef(false);
  const snapshotRef = useRef(null); /* camera to restore after a sharpen */
  const safeModeRef = useRef(SAFE_START); /* lighter rendering after a GPU reset */
  const retriedLiteRef = useRef(false);
  const [sceneNonce, setSceneNonce] = useState(0);
  const loadGenRef = useRef(0);
  const abortRef = useRef(null);
  const helpButtonRef = useRef(null);
  const gotItRef = useRef(null);
  const errorBtnRef = useRef(null);
  const openAnotherRef = useRef(null);
  const noticeTimerRef = useRef(null);
  const lastAnnouncedRef = useRef({ phase: "", decile: -1 });

  /* ---------------- load management ---------------- */

  /* Supersede any in-flight load: abort downloads, kill the worker, and
     advance the generation so stale async continuations bail out. */
  const beginLoad = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
    streamFallbackRef.current = null;
    return ++loadGenRef.current;
  };
  const isStale = (gen) => gen !== loadGenRef.current;

  const startWorker = () => {
    const worker = new Worker(new URL("./las-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      if (workerRef.current !== worker) return; /* stale message from a superseded worker */
      const msg = e.data;
      if (msg.type === "progress") {
        if (msg.phase !== lastPhaseRef.current) {
          lastPhaseRef.current = msg.phase;
          diag("phase", msg.phase);
        }
        setStage({ kind: "loading", percent: msg.percent, phase: msg.phase });
      } else if (msg.type === "done") {
        diag("worker done", {
          kept: msg.kept,
          total: msg.total,
          files: msg.fileCount,
          skipped: msg.skipped,
          copc: !!msg.copc,
          rgb: !!msg.rgb,
        });
        worker.terminate(); /* reclaim the worker (and any grown wasm heap) immediately */
        workerRef.current = null;
        dataRef.current = msg;
        if (sourceRef.current && msg.center) sourceRef.current.center = msg.center;
        setColorMode(msg.rgb ? "rgb" : "elevation");
        setPointSize(2);
        setViewMode("points");
        const skipped = (msg.skipped || 0) + pendingSkipRef.current;
        pendingSkipRef.current = 0;
        if (pendingSplatRef.current) {
          splatUrlRef.current = {
            url: URL.createObjectURL(pendingSplatRef.current),
            revoke: true,
            format: splatFormatOf(pendingSplatRef.current.name),
          };
          pendingSplatRef.current = null;
          setSplatState({ loading: true, percent: 0 });
        }
        setStage({
          kind: "ready",
          kept: msg.kept,
          total: msg.total,
          hasRgb: !!msg.rgb,
          hasIntensity: msg.hasIntensity,
          fileCount: msg.fileCount || 1,
          canSharpen: !!(msg.copc && sourceRef.current),
          sharpened: sharpenedRef.current,
        });
        if (skipped > 0) {
          showNotice(
            skipped === 1
              ? "1 file couldn't be opened and was skipped."
              : `${skipped} files couldn't be opened and were skipped.`,
            7000
          );
        }
      } else if (msg.type === "error") {
        diag("worker error", { code: msg.code, msg: String(msg.message).slice(0, 120) });
        worker.terminate();
        workerRef.current = null;
        const fb = streamFallbackRef.current;
        if (fb && fb.gen === loadGenRef.current) {
          streamFallbackRef.current = null;
          if (msg.code === "RANGE") {
            /* host doesn't support streaming — download the file instead */
            downloadUrl(fb.src, fb.gen);
            return;
          }
          setStage({ kind: "error", message: msg.message, retrySrc: fb.src });
          return;
        }
        setStage({ kind: "error", message: msg.message });
      }
    };
    worker.onerror = () => {
      if (workerRef.current !== worker) return;
      worker.terminate();
      workerRef.current = null;
      setStage({
        kind: "error",
        message: "Something went wrong while reading this file. If it keeps happening, contact us and we'll help.",
      });
    };
    workerRef.current = worker;
    return worker;
  };

  const releaseSplatUrl = () => {
    if (splatUrlRef.current?.revoke) URL.revokeObjectURL(splatUrlRef.current.url);
    splatUrlRef.current = null;
    pendingSplatRef.current = null;
    splatLoadRunningRef.current = false;
    setSplatState(null);
  };

  const openSplatOnly = (fileOrUrl) => {
    diag("openSplatOnly", {
      name: typeof fileOrUrl === "string" ? fileOrUrl.slice(-60) : fileOrUrl.name,
      sizeMB: typeof fileOrUrl === "string" ? undefined : Math.round(fileOrUrl.size / 1048576),
    });
    beginLoad();
    releaseSplatUrl();
    loadSceneModule();
    dataRef.current = null;
    sourceRef.current = null;
    sharpenedRef.current = false;
    snapshotRef.current = null;
    splatUrlRef.current =
      typeof fileOrUrl === "string"
        ? { url: fileOrUrl, revoke: false, format: splatFormatOf(fileOrUrl.split("?")[0]) }
        : { url: URL.createObjectURL(fileOrUrl), revoke: true, format: splatFormatOf(fileOrUrl.name) };
    setSplatState({ loading: true, percent: 0 });
    setViewMode("splat");
    setStage({
      kind: "ready",
      splatOnly: true,
      kept: 0,
      total: 0,
      hasRgb: false,
      hasIntensity: false,
      fileCount: 1,
    });
  };

  /* Folder picks can carry tens of thousands of files (a full Terra delivery
     is ~37k). Show feedback the instant the picker returns, then yield a
     frame so the browser paints it before we filter — otherwise a big
     folder looks like "nothing happened". */
  const pickFromFolder = (list) => {
    const count = list?.length || 0;
    diag("pickFromFolder", { count });
    if (!count) return;
    beginLoad();
    setStage({
      kind: "loading",
      percent: null,
      phase: count > 4000 ? "Reading the folder — this can take a moment…" : "Reading the folder…",
    });
    /* snapshot to a plain array now (the input will be cleared) */
    const files = Array.from(list);
    setTimeout(() => {
      try {
        openFiles(files);
      } catch (err) {
        diag("openFiles threw", { msg: String(err?.message || err).slice(0, 150) });
        setStage({
          kind: "error",
          message:
            "That folder couldn't be opened. Try picking just the terra_las (or lidars) subfolder, or the single merged .las file.",
        });
      }
    }, 60);
  };

  const openFiles = async (list) => {
    const all = Array.from(list || []).filter(Boolean);
    if (!all.length) return;
    const viewing = sceneRef.current !== null;
    const rawScans = all.filter((f) => /\.la[sz]$/i.test(f.name));
    const splats = all.filter((f) => SPLAT_RE.test(f.name));
    /* collapse Terra's merged-plus-tiles duplication to one set */
    const scans = dedupeScanSet(rawScans);
    const dropped = rawScans.length - scans.length;
    diag("openFiles", {
      total: all.length,
      rawScans: rawScans.length,
      scans: scans.length,
      dropped,
      splats: splats.length,
      first: (scans[0] || splats[0] || all[0])?.name,
      firstMB: Math.round(((scans[0] || splats[0] || all[0])?.size || 0) / 1048576),
    });
    if (dropped > 0) {
      showNotice(
        `Loaded the combined scan and skipped ${dropped} duplicate tile${dropped > 1 ? "s" : ""} of the same data.`,
        7000
      );
    }
    if (!scans.length && splats.length) {
      openSplatOnly(splats[0]);
      if (splats.length > 1) {
        showNotice(
          `This folder has ${splats.length} photo tiles — showing the first one. Full multi-tile photo models are coming soon.`,
          9000
        );
      }
      return;
    }
    if (!scans.length) {
      if (viewing) return; /* ignore an accidental mis-drop; keep the current 3D view */
      beginLoad();
      setStage({
        kind: "error",
        message:
          all.length > 1
            ? 'None of those files look like scans. Look for files ending in .las or .laz — they\'re often inside a folder named something like "terra_las" or "lidars".'
            : `"${all[0].name}" isn't a scan file. Please choose the file ending in .las or .laz that we sent you.`,
      });
      return;
    }
    const usable = [];
    let tooBig = 0;
    for (const f of scans) {
      if (/\.laz$/i.test(f.name)) {
        /* COPC streams at any size; only plain LAZ needs the whole-file cap */
        if (
          f.size <= MAX_PLAIN_LAZ_BYTES ||
          /\.copc\.laz$/i.test(f.name) ||
          (await isCopcBlob(f))
        ) {
          usable.push(f);
        } else {
          tooBig++;
        }
      } else if (f.size <= MAX_LOCAL_LAS_BYTES) {
        usable.push(f);
      } else {
        tooBig++;
      }
    }
    if (!usable.length) {
      if (viewing) return;
      beginLoad();
      setStage({ kind: "error", message: TOO_LARGE_MSG });
      return;
    }
    beginLoad();
    releaseSplatUrl();
    loadSceneModule();
    pendingSkipRef.current = tooBig;
    /* only auto-pair a photo view for a deliberate scan+model pick; a giant
       folder with dozens of LOD tiles shouldn't attach an arbitrary one */
    pendingSplatRef.current = splats.length === 1 ? splats[0] : null;
    sourceRef.current = { files: usable, center: null };
    sharpenedRef.current = false;
    snapshotRef.current = null;
    setStage({
      kind: "loading",
      percent: 0,
      phase: usable.length > 1 ? `Opening ${usable.length} files…` : "Opening the file…",
    });
    /* Files structured-clone by reference — the worker streams them in chunks */
    startWorker().postMessage({ type: "parse", files: usable, budget: POINT_BUDGET });
  };

  const openDemo = () => {
    beginLoad();
    loadSceneModule();
    setStage({ kind: "loading", percent: 0, phase: "Building the demo scan…" });
    startWorker().postMessage({ type: "demo", budget: POINT_BUDGET });
  };

  /* Streaming-first: hand the URL to the worker, which reads it with HTTP
     range requests (COPC and LAS work at any size). If the host doesn't
     support ranges, the worker reports code "RANGE" and we fall back to
     downloading the whole file (with the old size caps). */
  const openUrl = (src) => {
    let href = src;
    try {
      href = new URL(src, window.location.href).href;
    } catch {
      /* keep raw src */
    }
    if (SPLAT_RE.test(href.split("?")[0])) {
      openSplatOnly(href);
      return;
    }
    const gen = beginLoad();
    releaseSplatUrl();
    loadSceneModule();
    sourceRef.current = { files: [{ url: href }], center: null };
    sharpenedRef.current = false;
    snapshotRef.current = null;
    streamFallbackRef.current = { gen, src };
    setStage({ kind: "loading", percent: 0, phase: "Connecting to the scan…" });
    startWorker().postMessage({ type: "parse", files: [{ url: href }], budget: POINT_BUDGET });
  };

  const downloadUrl = async (src, gen) => {
    const ac = new AbortController();
    abortRef.current = ac;
    let reader = null;
    try {
      setStage({ kind: "loading", percent: 0, phase: "Downloading the scan…" });
      let pathname = src;
      try {
        pathname = new URL(src, window.location.href).pathname;
      } catch {
        /* keep raw src */
      }
      /* unknown extensions get the stricter LAZ cap */
      const cap = /\.las$/i.test(pathname) ? MAX_DOWNLOAD_LAS_BYTES : MAX_DOWNLOAD_LAZ_BYTES;

      const res = await fetch(src, { signal: ac.signal });
      if (isStale(gen)) return;
      if (!res.ok) throw new Error();
      const totalBytes = Number(res.headers.get("content-length")) || 0;
      if (totalBytes > cap) {
        res.body?.cancel();
        setStage({ kind: "error", message: TOO_LARGE_MSG, retrySrc: src });
        return;
      }

      reader = res.body.getReader();
      const chunks = [];
      let received = 0;
      let lastUpdate = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (isStale(gen)) {
          reader.cancel().catch(() => {});
          return;
        }
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        if (received > cap) {
          reader.cancel().catch(() => {});
          setStage({ kind: "error", message: TOO_LARGE_MSG, retrySrc: src });
          return;
        }
        const now = performance.now();
        if (now - lastUpdate > 150) {
          lastUpdate = now;
          setStage(
            totalBytes
              ? {
                  kind: "loading",
                  percent: Math.min(99, (received / totalBytes) * 100),
                  phase: "Downloading the scan…",
                }
              : { kind: "loading", percent: null, receivedBytes: received, phase: "Downloading the scan…" }
          );
        }
      }
      if (isStale(gen)) return;
      const blob = new Blob(chunks);
      sourceRef.current = { files: [blob], center: null };
      startWorker().postMessage({ type: "parse", files: [blob], budget: POINT_BUDGET });
    } catch {
      if (isStale(gen)) return; /* aborted/superseded — not an error */
      setStage({
        kind: "error",
        message: "The scan link couldn't be downloaded. Check the link, or contact us for a fresh one.",
        retrySrc: src,
      });
    }
  };

  const reset = () => {
    beginLoad();
    releaseSplatUrl();
    dataRef.current = null;
    sourceRef.current = null;
    sharpenedRef.current = false;
    snapshotRef.current = null;
    setViewMode("points");
    setStage({ kind: "idle" });
  };

  /* Sharpen: reload the COPC source focused on what the camera is looking
     at — deep octree levels stream in for that region only. */
  const sharpen = () => {
    const s = sceneRef.current;
    const src = sourceRef.current;
    if (!s || !src || !src.center) return;
    const t = s.controls.target;
    const radius = Math.max(8, s.camera.position.distanceTo(t) * 0.9);
    const focus = {
      x: t.x + src.center[0],
      y: t.y + src.center[1],
      z: t.z + src.center[2],
      r: radius,
    };
    snapshotRef.current = { pos: s.camera.position.toArray(), target: t.toArray() };
    sharpenedRef.current = true;
    beginLoad();
    setStage({ kind: "loading", percent: 0, phase: "Sharpening this area…" });
    startWorker().postMessage({
      type: "parse",
      files: src.files,
      budget: POINT_BUDGET,
      focus,
      center: src.center,
    });
  };

  const fullSite = () => {
    const src = sourceRef.current;
    if (!src) return;
    snapshotRef.current = null;
    sharpenedRef.current = false;
    beginLoad();
    setStage({ kind: "loading", percent: 0, phase: "Loading the full site…" });
    startWorker().postMessage({
      type: "parse",
      files: src.files,
      budget: POINT_BUDGET,
      center: src.center,
    });
  };

  /* load from ?src=… links */
  useEffect(() => {
    const src = new URLSearchParams(window.location.search).get("src");
    if (src) openUrl(src);
    return () => {
      abortRef.current?.abort();
      loadGenRef.current++;
      workerRef.current?.terminate();
      workerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- drag & drop (files only) ---------------- */

  useEffect(() => {
    const isFileDrag = (e) => e.dataTransfer?.types?.includes("Files");
    const readAll = (reader) =>
      new Promise((resolve, reject) => {
        const out = [];
        const step = () =>
          reader.readEntries((entries) => {
            if (!entries.length) return resolve(out);
            out.push(...entries);
            step();
          }, reject);
        step();
      });
    const walk = async (entry, files) => {
      if (entry.isFile) {
        try {
          files.push(await new Promise((res, rej) => entry.file(res, rej)));
        } catch {
          /* unreadable entry — skip */
        }
      } else if (entry.isDirectory) {
        try {
          for (const child of await readAll(entry.createReader())) await walk(child, files);
        } catch {
          /* unreadable folder — skip */
        }
      }
    };
    const onDragOver = (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      setDragOver(true);
    };
    const onDragLeave = (e) => {
      if (!e.relatedTarget) setDragOver(false);
    };
    const onDrop = async (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      setDragOver(false);
      /* entries must be captured synchronously, before any await */
      const entries = Array.from(e.dataTransfer.items || [])
        .map((item) => item.webkitGetAsEntry?.())
        .filter(Boolean);
      const plainFiles = Array.from(e.dataTransfer.files || []);
      if (!entries.length) {
        openFiles(plainFiles);
        return;
      }
      const files = [];
      for (const entry of entries) await walk(entry, files);
      openFiles(files.length ? files : plainFiles);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- 3D scene lifecycle (lazy chunk) ---------------- */

  const [sceneEpoch, setSceneEpoch] = useState(0);

  /* GPU context loss recovery ladder:
     1st loss → rebuild the same data in a lighter display mode
     2nd loss → reload the scan at reduced point count
     after that → honest error with advice */
  const handleContextLost = () => {
    diag("CONTEXT LOST", { alreadySafe: safeModeRef.current, splatOnly: !dataRef.current });
    if (!safeModeRef.current) {
      safeModeRef.current = true;
      showNotice("Your graphics driver restarted — switching to a lighter display mode…", 6000);
      /* photo models must be explicitly re-queued for the rebuilt scene —
         setData covers the scan, but the splat load is a separate step */
      if (splatUrlRef.current) {
        splatLoadRunningRef.current = false;
        setSplatState({ loading: true, percent: 0 });
      }
      setSceneNonce((n) => n + 1);
      return;
    }
    if (!dataRef.current && splatUrlRef.current && !retriedLiteRef.current) {
      /* splat-only and already in safe mode: one more rebuild attempt */
      retriedLiteRef.current = true;
      splatLoadRunningRef.current = false;
      setSplatState({ loading: true, percent: 0 });
      setSceneNonce((n) => n + 1);
      return;
    }
    if (sourceRef.current && !retriedLiteRef.current) {
      retriedLiteRef.current = true;
      sharpenedRef.current = false;
      snapshotRef.current = null;
      beginLoad();
      setStage({ kind: "loading", percent: 0, phase: "Reloading at lighter detail…" });
      startWorker().postMessage({
        type: "parse",
        files: sourceRef.current.files,
        budget: LITE_BUDGET,
        center: sourceRef.current.center,
      });
      return;
    }
    setStage({
      kind: "error",
      message:
        "Your computer's graphics couldn't display this scan. Try closing other programs and tabs, then open the file again — or contact us and we'll send a lighter version.",
    });
  };

  useEffect(() => {
    if (stage.kind !== "ready" || !mountRef.current) return;
    let cancelled = false;
    let scene = null;
    loadSceneModule()
      .then(({ PointCloudScene }) => {
        if (cancelled || !mountRef.current) return;
        scene = new PointCloudScene(mountRef.current, { safeMode: safeModeRef.current });
        scene.onContextLost = handleContextLost;
        diag("scene created", {
          safeMode: safeModeRef.current,
          edlOk: scene.edlOk,
          hasData: !!dataRef.current,
        });
        if (dataRef.current) {
          const snap = snapshotRef.current;
          scene.setData(dataRef.current, { keepCamera: !!snap });
          if (snap) {
            scene.camera.position.fromArray(snap.pos);
            scene.controls.target.fromArray(snap.target);
            scene.controls.update();
            scene.wake();
            snapshotRef.current = null;
          }
        }
        sceneRef.current = scene;
        setSceneEpoch((e) => e + 1);
        window.__viewer = {
          stage: "ready",
          kept: dataRef.current?.kept || 0,
          total: dataRef.current?.total || 0,
          scene,
        };
      })
      .catch(() => {
        if (!cancelled)
          setStage({ kind: "error", message: "The 3D viewer couldn't be loaded. Check your connection and try again." });
      });
    return () => {
      cancelled = true;
      if (scene) {
        scene.dispose();
        if (window.__viewer?.scene === scene) window.__viewer = null;
      }
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.kind, sceneNonce]);

  /* apply Photo/Scan mode changes to the live scene */
  useEffect(() => {
    sceneRef.current?.setMode(viewMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, sceneEpoch]);

  /* black-screen watchdog: if content is loaded but two consecutive checks
     see only background pixels, surface the problem instead of hiding it */
  useEffect(() => {
    if (stage.kind !== "ready") {
      setBlackDetected(false);
      return;
    }
    let strikes = 0;
    const id = setInterval(() => {
      const s = sceneRef.current;
      if (!s || splatState?.loading) {
        strikes = 0;
        return;
      }
      if (s.isShowingNothing()) {
        strikes++;
        if (strikes >= 2) {
          diag("BLACK SCREEN DETECTED");
          setBlackDetected(true);
          clearInterval(id);
        }
      } else {
        strikes = 0;
      }
    }, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.kind, sceneEpoch, splatState?.loading]);

  /* load a pending splat (photo view) once the scene exists */
  useEffect(() => {
    const scene = sceneRef.current;
    const su = splatUrlRef.current;
    if (!scene || !su || !splatState?.loading || splatLoadRunningRef.current) return;
    splatLoadRunningRef.current = true;
    let cancelled = false;
    scene
      .setSplat(
        su.url,
        (p) => {
          if (!cancelled) setSplatState({ loading: true, percent: p });
        },
        su.format
      )
      .then((count) => {
        if (cancelled) return;
        diag("splat loaded", { count });
        /* keep the object URL alive — a GPU-reset rebuild needs to reload it */
        setSplatState({ count });
        setViewMode("splat");
        setAnnounce("Photo view loaded.");
      })
      .catch((err) => {
        if (cancelled) return;
        diag("splat FAILED", { msg: String(err?.message || err).slice(0, 150) });
        releaseSplatUrl();
        if (dataRef.current) {
          showNotice("The photo view couldn't be loaded — showing the scan instead.", 6000);
        } else {
          setStage({
            kind: "error",
            message:
              "This 3D photo model couldn't be opened. It may not be a Gaussian-splat file — or contact us and we'll help.",
          });
        }
      })
      .finally(() => {
        splatLoadRunningRef.current = false;
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneEpoch, splatState?.loading]);

  /* ---------------- announcements, focus, slow-load hint ---------------- */

  useEffect(() => {
    if (stage.kind === "loading") {
      const decile = stage.percent == null ? -1 : Math.floor(stage.percent / 10);
      const last = lastAnnouncedRef.current;
      if (stage.phase !== last.phase || (decile !== -1 && decile !== last.decile)) {
        lastAnnouncedRef.current = { phase: stage.phase, decile };
        setAnnounce(decile > 0 ? `${stage.phase} ${decile * 10} percent.` : stage.phase);
      }
    } else {
      lastAnnouncedRef.current = { phase: "", decile: -1 };
      if (stage.kind === "ready") setAnnounce(`Scan loaded. ${formatPoints(stage.kept)} points shown.`);
      else if (stage.kind === "idle") setAnnounce("");
    }
  }, [stage]);

  useEffect(() => {
    if (stage.kind === "error") errorBtnRef.current?.focus();
    else if (stage.kind === "ready") openAnotherRef.current?.focus();
  }, [stage.kind]);

  useEffect(() => {
    if (stage.kind !== "loading") {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, [stage.kind]);

  /* ---------------- help dialog: focus trap + Escape + restore ---------------- */

  useEffect(() => {
    if (!helpOpen) return;
    gotItRef.current?.focus();
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        setHelpOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const dialog = document.getElementById("help-dialog");
      const focusables = dialog ? [...dialog.querySelectorAll("button")] : [];
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!dialog.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      helpButtonRef.current?.focus();
    };
  }, [helpOpen]);

  /* ---------------- toolbar handlers ---------------- */

  const showNotice = (text, ms = 3500) => {
    setModeNotice(text);
    clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setModeNotice(""), ms);
  };
  useEffect(() => () => clearTimeout(noticeTimerRef.current), []);

  const changeColorMode = (mode, disabled, label) => {
    if (disabled) {
      showNotice(`This scan doesn't include ${label.toLowerCase()} information.`);
      return;
    }
    setColorMode(mode);
    sceneRef.current?.setColorMode(mode);
  };
  const changePointSize = (delta) => {
    setPointSize((s) => {
      const next = Math.min(6, Math.max(1, s + delta));
      sceneRef.current?.setPointSize(next);
      return next;
    });
  };

  const onViewerKeyDown = (e) => {
    const s = sceneRef.current;
    if (!s) return;
    const step = e.shiftKey ? 0.25 : 0.08;
    switch (e.key) {
      case "ArrowLeft":
        s.orbit(step, 0);
        break;
      case "ArrowRight":
        s.orbit(-step, 0);
        break;
      case "ArrowUp":
        s.orbit(0, step);
        break;
      case "ArrowDown":
        s.orbit(0, -step);
        break;
      case "+":
      case "=":
        s.zoomBy(1 / 1.2);
        break;
      case "-":
      case "_":
        s.zoomBy(1.2);
        break;
      case "r":
      case "R":
        s.fit();
        break;
      case "t":
      case "T":
        s.topView();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  /* ---------------- render ---------------- */

  const pointsUi = stage.kind === "ready" && viewMode === "points" && !stage.splatOnly;
  const hasBothViews = stage.kind === "ready" && !stage.splatOnly && !!splatState?.count;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#030609] font-sans text-slate-100">
      {/* screen-reader status channel — persistent across stage changes */}
      <div role="status" aria-live="polite" className="sr-only">
        {announce}
      </div>

      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-[#030609] px-4 sm:px-6">
        <Logo />
        {stage.kind === "ready" && (
          <div className="flex items-center gap-4">
            <span className="hidden font-mono text-[12px] tracking-hud-tight text-slate-400 md:block">
              {stage.splatOnly
                ? splatState?.count
                  ? `Photo model — ${formatPoints(splatState.count)} splats`
                  : "Photo model"
                : (stage.fileCount > 1 ? `${stage.fileCount} files · ` : "") +
                  (stage.sharpened
                    ? `Sharpened — ${formatPoints(stage.kept)} points`
                    : stage.kept < stage.total
                      ? `Fast preview — ${formatPoints(stage.kept)} points`
                      : `${formatPoints(stage.kept)} points`)}
            </span>
            <button
              ref={openAnotherRef}
              onClick={reset}
              className="min-h-11 rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-300 transition-colors hover:border-cyan-400/50 hover:text-cyan-300"
            >
              Open other files
            </button>
          </div>
        )}
      </header>

      <main className="relative flex-1">
        {/* ============ idle ============ */}
        {stage.kind === "idle" && (
          <div className="flex h-full flex-col items-center justify-center gap-8 overflow-y-auto px-6 py-8 text-center">
            <div
              onClick={() => fileInputRef.current?.click()}
              className={`flex w-full max-w-2xl cursor-pointer flex-col items-center gap-6 rounded-2xl border-2 border-dashed px-8 py-14 transition-colors ${
                dragOver ? "border-cyan-400 bg-cyan-400/5" : "border-white/15 bg-white/[0.02]"
              }`}
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-400/30 bg-cyan-400/10">
                <Mountain className="h-8 w-8 text-cyan-300" strokeWidth={1.5} />
              </span>
              <div>
                <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                  View your site scan
                </h1>
                <p className="mx-auto mt-3 max-w-md text-base leading-relaxed text-slate-300">
                  Press the big button below and pick the scan files we sent
                  you — you can select several at once
                  <span className="pointer-coarse:hidden">
                    , or drag files or whole folders anywhere onto this page
                  </span>
                  .
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  className="inline-flex items-center gap-3 rounded-xl bg-amber-400 px-10 py-5 font-mono text-[15px] font-semibold uppercase tracking-hud-tight text-[#231603] shadow-[0_0_32px_rgba(251,191,36,0.35)] transition-all hover:bg-amber-300 hover:shadow-[0_0_48px_rgba(251,191,36,0.5)]"
                >
                  <Files className="h-5 w-5" />
                  Choose your files
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    folderInputRef.current?.click();
                  }}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 px-6 py-5 text-sm text-slate-200 transition-colors hover:border-cyan-400/50 hover:text-cyan-300"
                >
                  <FolderOpen className="h-4 w-4" />
                  Choose a whole folder
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".las,.laz,.ply,.splat,.ksplat,.spz"
                multiple
                className="hidden"
                tabIndex={-1}
                aria-hidden="true"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  openFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <input
                ref={folderInputRef}
                type="file"
                webkitdirectory=""
                className="hidden"
                tabIndex={-1}
                aria-hidden="true"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  /* snapshot BEFORE clearing — value="" empties e.target.files */
                  const files = Array.from(e.target.files || []);
                  e.target.value = "";
                  pickFromFolder(files);
                }}
              />
              <p className="text-sm text-slate-400">
                Works with .las, .laz, and .copc.laz scans and 3D photo models
                (.ply / .splat / .ksplat) — tiled scans open together as one map.
              </p>
              <p className="max-w-md text-[13px] text-slate-500">
                Big delivery folder? You can pick just the{" "}
                <span className="font-mono text-slate-400">terra_las</span> (or{" "}
                <span className="font-mono text-slate-400">lidars</span>) subfolder,
                or choose the single merged <span className="font-mono text-slate-400">.las</span> file — it
                opens faster.
              </p>
            </div>

            <div className="flex flex-col items-center gap-3">
              <button
                onClick={openDemo}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-cyan-400/30 px-6 py-3 text-sm text-slate-200 transition-colors hover:border-cyan-400/60 hover:text-cyan-300"
              >
                <Sparkles className="h-4 w-4 text-cyan-300" />
                No file yet? Try the demo scan
              </button>
              <p className="max-w-md text-sm text-slate-400">
                Your file never leaves your computer — it opens right here in
                your browser. Nothing is uploaded, nothing to install.
              </p>
            </div>
          </div>
        )}

        {/* ============ loading ============ */}
        {stage.kind === "loading" && (
          <div className="flex h-full flex-col items-center justify-center gap-6 px-6">
            <p className="font-display text-2xl font-semibold">{stage.phase}</p>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={stage.percent == null ? undefined : Math.round(stage.percent)}
              aria-label={stage.phase}
              className="h-3 w-full max-w-md overflow-hidden rounded-full border border-white/10 bg-white/5"
            >
              {stage.percent == null ? (
                <div className="h-full w-1/3 animate-pulse rounded-full bg-cyan-400" />
              ) : (
                <div
                  className="h-full rounded-full bg-cyan-400 transition-[width] duration-200"
                  style={{ width: `${Math.max(3, Math.round(stage.percent))}%` }}
                />
              )}
            </div>
            <p className="font-mono text-sm text-slate-400 tabular-nums">
              {stage.percent == null
                ? stage.receivedBytes > 1048576
                  ? `${Math.round(stage.receivedBytes / 1048576)} MB downloaded…`
                  : "Starting…"
                : `${Math.round(stage.percent)}%`}
            </p>
            {slow && <p className="text-sm text-slate-400">Still working — big scans can take a minute.</p>}
            <button
              onClick={reset}
              className="min-h-11 rounded-xl border border-white/15 px-8 py-3 text-sm text-slate-300 transition-colors hover:border-cyan-400/50 hover:text-cyan-300"
            >
              Cancel
            </button>
          </div>
        )}

        {/* ============ error ============ */}
        {stage.kind === "error" && (
          <div className="flex h-full flex-col items-center justify-center gap-7 px-6 text-center">
            <p role="alert" className="max-w-md text-lg leading-relaxed text-slate-200">
              {stage.message}
            </p>
            <button
              ref={errorBtnRef}
              onClick={() => (stage.retrySrc ? openUrl(stage.retrySrc) : reset())}
              className="rounded-xl bg-amber-400 px-9 py-4 font-mono text-[14px] font-semibold uppercase tracking-hud-tight text-[#231603] transition-colors hover:bg-amber-300"
            >
              {stage.retrySrc ? "Try downloading again" : "Try again"}
            </button>
            {stage.retrySrc && (
              <button
                onClick={reset}
                className="min-h-11 rounded-lg border border-white/15 px-6 py-3 text-sm text-slate-300 transition-colors hover:border-cyan-400/50 hover:text-cyan-300"
              >
                Choose a file instead
              </button>
            )}
            <button
              onClick={copyReport}
              className="min-h-11 rounded-lg border border-white/15 px-5 py-2 text-sm text-slate-300 transition-colors hover:border-cyan-400/50 hover:text-cyan-300"
            >
              {reportCopied ? "Copied — paste it to us!" : "Copy problem report"}
            </button>
            <p className="text-sm text-slate-400">
              Still stuck? Email us at{" "}
              <a
                href="mailto:ops@aerodata.io"
                className="text-slate-200 underline decoration-cyan-400/50 underline-offset-4"
              >
                ops@aerodata.io
              </a>{" "}
              and we'll walk you through it.
            </p>
          </div>
        )}

        {/* ============ ready: the 3D view ============ */}
        {stage.kind === "ready" && (
          <>
            <div
              ref={mountRef}
              role="application"
              aria-label="3D view of your scan"
              aria-describedby="viewer-kbd-hint"
              tabIndex={0}
              onKeyDown={onViewerKeyDown}
              className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400/70"
            />
            <p id="viewer-kbd-hint" className="sr-only">
              Arrow keys spin the scan. Plus and minus zoom. R resets the view, T shows the top view.
            </p>

            {/* legends */}
            {pointsUi && colorMode === "elevation" && (
              <div className="pointer-events-none absolute right-4 top-4 flex items-center gap-2.5 rounded-lg border border-white/10 bg-[#030609]/85 px-3.5 py-2.5">
                <span className="text-sm text-slate-300">Low</span>
                <span className="h-2.5 w-28 rounded-full bg-[linear-gradient(to_right,#0000ff,#00ffff,#00ff00,#ffff00,#ff0000)]" />
                <span className="text-sm text-slate-300">High</span>
              </div>
            )}
            {pointsUi && colorMode === "intensity" && (
              <div className="pointer-events-none absolute right-4 top-4 flex items-center gap-2.5 rounded-lg border border-white/10 bg-[#030609]/85 px-3.5 py-2.5">
                <span className="text-sm text-slate-300">Dark</span>
                <span className="h-2.5 w-28 rounded-full bg-gradient-to-r from-slate-900 to-cyan-100" />
                <span className="text-sm text-slate-300">Bright</span>
              </div>
            )}
            {pointsUi && colorMode === "classification" && (
              <div className="pointer-events-none absolute right-4 top-4 flex flex-col gap-1.5 rounded-lg border border-white/10 bg-[#030609]/85 px-3.5 py-3">
                {CLASS_LEGEND.map((c) => (
                  <span key={c.key} className="flex items-center gap-2.5 text-sm text-slate-300">
                    <span
                      className="h-3.5 w-3.5 rounded-sm"
                      style={{ backgroundColor: `rgb(${c.color[0]},${c.color[1]},${c.color[2]})` }}
                    />
                    {c.label}
                  </span>
                ))}
              </div>
            )}

            {/* black-screen helper */}
            {blackDetected && (
              <div className="absolute inset-x-0 top-4 z-40 mx-auto w-fit max-w-[94%] rounded-xl border border-amber-400/40 bg-[#0A121C] px-5 py-4 text-center">
                <p className="text-sm leading-relaxed text-slate-200">
                  The view looks blank. Press <strong>Reset view</strong> — and if it
                  stays black, copy the report and send it to us.
                </p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <button
                    onClick={() => {
                      sceneRef.current?.fit();
                      setBlackDetected(false);
                    }}
                    className="min-h-11 rounded-lg border border-white/15 px-4 text-sm text-slate-200 transition-colors hover:border-cyan-400/50"
                  >
                    Reset view
                  </button>
                  <button
                    onClick={copyReport}
                    className="min-h-11 rounded-lg bg-amber-400 px-4 text-sm font-semibold text-[#231603] transition-colors hover:bg-amber-300"
                  >
                    {reportCopied ? "Copied!" : "Copy problem report"}
                  </button>
                  <button
                    onClick={() => setBlackDetected(false)}
                    className="min-h-11 rounded-lg px-3 text-sm text-slate-400 transition-colors hover:text-white"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {/* photo-view loading chip */}
            {splatState?.loading && (
              <p
                role="status"
                className="absolute left-1/2 top-4 -translate-x-1/2 rounded-lg border border-white/15 bg-[#030609]/90 px-4 py-2.5 text-sm text-slate-200"
              >
                Loading photo view… {Math.round(splatState.percent || 0)}%
              </p>
            )}

            {/* unavailable-mode notice */}
            {modeNotice && (
              <p
                role="status"
                className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-lg border border-white/15 bg-[#030609]/90 px-4 py-2.5 text-sm text-slate-200"
              >
                {modeNotice}
              </p>
            )}

            {/* toolbar */}
            <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-2 border-t border-white/10 bg-[#030609]/90 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:gap-3">
              {hasBothViews && (
                <div
                  className="flex items-center gap-1.5 rounded-xl border border-amber-400/25 bg-white/[0.03] p-1.5"
                  role="group"
                  aria-label="View style"
                >
                  <button
                    aria-pressed={viewMode === "splat"}
                    onClick={() => setViewMode("splat")}
                    className={`flex min-h-11 items-center gap-2 rounded-lg px-4 py-2 text-sm transition-colors ${
                      viewMode === "splat"
                        ? "bg-amber-400/20 text-amber-200 ring-1 ring-inset ring-amber-400"
                        : "text-slate-300 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <Camera className="h-4 w-4" /> Photo view
                  </button>
                  <button
                    aria-pressed={viewMode === "points"}
                    onClick={() => setViewMode("points")}
                    className={`flex min-h-11 items-center gap-2 rounded-lg px-4 py-2 text-sm transition-colors ${
                      viewMode === "points"
                        ? "bg-cyan-400/20 text-cyan-200 ring-1 ring-inset ring-cyan-400"
                        : "text-slate-300 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <Mountain className="h-4 w-4" /> Scan view
                  </button>
                </div>
              )}

              {pointsUi && (
              <div
                className="flex flex-wrap items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-1.5"
                role="group"
                aria-label="Color the scan by"
              >
                {COLOR_MODES.map((m) => {
                  const disabled =
                    (m.id === "rgb" && !stage.hasRgb) || (m.id === "intensity" && !stage.hasIntensity);
                  return (
                    <button
                      key={m.id}
                      aria-disabled={disabled || undefined}
                      aria-pressed={colorMode === m.id}
                      aria-describedby={disabled ? `${m.id}-na` : undefined}
                      onClick={() => changeColorMode(m.id, disabled, m.label)}
                      className={`min-h-11 rounded-lg px-4 py-2 text-sm transition-colors ${
                        colorMode === m.id
                          ? "bg-cyan-400/20 text-cyan-200 ring-1 ring-inset ring-cyan-400"
                          : disabled
                            ? "cursor-not-allowed text-slate-500"
                            : "text-slate-300 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      {m.label}
                      {disabled && (
                        <span id={`${m.id}-na`} className="block text-[11px] text-slate-500">
                          Not in this scan
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              )}

              <div
                className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-1.5"
                role="group"
                aria-label="Zoom"
              >
                <button onClick={() => sceneRef.current?.zoomBy(1 / 1.4)} className={toolbarBtn}>
                  <ZoomIn className="h-4 w-4" /> Zoom in
                </button>
                <button onClick={() => sceneRef.current?.zoomBy(1.4)} className={toolbarBtn}>
                  <ZoomOut className="h-4 w-4" /> Zoom out
                </button>
              </div>

              <div
                className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-1.5"
                role="group"
                aria-label="Camera view"
              >
                <button onClick={() => sceneRef.current?.topView()} className={toolbarBtn}>
                  <Map className="h-4 w-4" /> Top view
                </button>
                <button onClick={() => sceneRef.current?.fit()} className={toolbarBtn}>
                  <RotateCcw className="h-4 w-4" /> Reset view
                </button>
              </div>

              {pointsUi && stage.canSharpen && (
                <div
                  className="flex items-center gap-1.5 rounded-xl border border-cyan-400/25 bg-white/[0.03] p-1.5"
                  role="group"
                  aria-label="Detail"
                >
                  <button onClick={sharpen} className={toolbarBtn} title="Reload every captured point for the area you're looking at">
                    <Focus className="h-4 w-4" /> Sharpen this area
                  </button>
                  {stage.sharpened && (
                    <button onClick={fullSite} className={toolbarBtn}>
                      <Expand className="h-4 w-4" /> Full site
                    </button>
                  )}
                </div>
              )}

              {pointsUi && (
              <div
                className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-1.5"
                role="group"
                aria-label="Dot size"
              >
                <button
                  onClick={() => changePointSize(-1)}
                  aria-label="Smaller dots"
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                >
                  <Minus className="h-5 w-5" />
                </button>
                <span className="min-w-[84px] text-center text-sm text-slate-400">Dot size {pointSize}</span>
                <button
                  onClick={() => changePointSize(1)}
                  aria-label="Bigger dots"
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                >
                  <Plus className="h-5 w-5" />
                </button>
              </div>
              )}

              <button
                ref={helpButtonRef}
                onClick={() => setHelpOpen(true)}
                className="flex min-h-11 items-center gap-2 rounded-xl border border-cyan-400/30 px-4 py-2 text-sm text-cyan-300 transition-colors hover:border-cyan-400/60"
              >
                <HelpCircle className="h-4 w-4" /> Help
              </button>
            </div>
          </>
        )}

        {/* drag overlay */}
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center border-4 border-dashed border-cyan-400 bg-[#030609]/80">
            <p className="font-display text-3xl font-semibold text-cyan-300">Drop the file to open it</p>
          </div>
        )}

        {/* help overlay */}
        {helpOpen && (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center bg-[#030609]/90 p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={(e) => {
              if (e.target === e.currentTarget) setHelpOpen(false);
            }}
          >
            <div id="help-dialog" className="w-full max-w-md rounded-2xl border border-white/15 bg-[#0A121C] p-8">
              <div className="flex items-start justify-between">
                <h2 id="help-title" className="font-display text-2xl font-semibold">
                  How to move around
                </h2>
                <button
                  onClick={() => setHelpOpen(false)}
                  aria-label="Close help"
                  className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 text-slate-300 hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <ul className="mt-6 space-y-4 text-[15px] leading-relaxed text-slate-300">
                <li>
                  <strong className="text-white">Spin the scan:</strong> hold the left mouse button and drag.
                  On a phone, drag with one finger.
                </li>
                <li>
                  <strong className="text-white">Zoom in and out:</strong> press the Zoom buttons, roll the
                  mouse wheel, or pinch with two fingers.
                </li>
                <li>
                  <strong className="text-white">Slide around:</strong> hold the right mouse button and drag.
                  On a phone, drag with two fingers.
                </li>
                <li>
                  <strong className="text-white">Lost?</strong> Press{" "}
                  <strong className="text-cyan-300">Reset view</strong> and the scan comes right back.
                </li>
                <li>
                  <strong className="text-white">Why "fast preview"?</strong> Very large scans are lightly
                  thinned so they open quickly in your browser. Your actual scan file is complete and
                  untouched.
                </li>
              </ul>
              <button
                onClick={copyReport}
                className="mt-6 w-full rounded-xl border border-white/15 px-6 py-3.5 text-sm text-slate-200 transition-colors hover:border-cyan-400/50"
              >
                {reportCopied ? "Copied — paste it to us!" : "Something wrong? Copy a problem report"}
              </button>
              <button
                ref={gotItRef}
                onClick={() => setHelpOpen(false)}
                className="mt-3 w-full rounded-xl bg-amber-400 px-6 py-4 font-mono text-[14px] font-semibold uppercase tracking-hud-tight text-[#231603] transition-colors hover:bg-amber-300"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
