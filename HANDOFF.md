# AeroData — Project Handoff

Paste this whole file into a new chat to bring it up to speed. Last updated 2026-07-19.

---

## 1. What this project is

A website for **Lukas Adams's commercial drone-services business** (LiDAR,
multispectral, thermal). Two parts:

1. **Marketing site** — a polished "mission-control / aerial-intelligence"
   landing page.
2. **Client Scan Viewer** — a browser tool where clients open the LiDAR files
   we deliver (`.las` / `.laz` / `.copc.laz`) and 3D photo models
   (`.ply` / `.splat`) with **no software to install and nothing uploaded**.
   Explicit design goal: **"old-people-proof"** — big labeled buttons, plain
   language, friendly errors.

Brand name "AeroData" and `ops@aerodata.io` are **placeholders** to be replaced.

---

## 2. Links, locations, accounts

- **Live marketing site:** https://lukasmadams11.github.io/aerodata-site/
- **Live viewer:** https://lukasmadams11.github.io/aerodata-site/viewer.html
- **GitHub repo (public):** https://github.com/lukasmadams11/aerodata-site
- **Local project folder:** `C:\Users\maste\Desktop\Drone Website`
- **Git identity:** Lukas Adams / lukasmadams11@gmail.com (gh CLI authenticated)
- **Deploy:** GitHub Actions → GitHub Pages on every push to `main` (~1–2 min).
  Vite `base` is `/aerodata-site/` only when `GITHUB_ACTIONS=true`; local dev
  stays at `/`.

---

## 3. Tech stack

- Vite + React 19 + Tailwind CSS v4 (CSS-first `@theme` in `src/index.css`) +
  lucide-react.
- Viewer adds: **three.js** (rendering), **laz-perf** (LAZ decode, WASM),
  **copc** (COPC streaming), **@mkkellogg/gaussian-splats-3d** (splats).
- Two pages via Vite multi-page config: `index.html` (marketing) and
  `viewer.html` (viewer).

---

## 4. File map

- `src/App.jsx` — entire marketing site. Aesthetic: base `#030609`,
  Space Grotesk + Inter + JetBrains Mono, **cyan = live data, amber = CTA**,
  one glow per viewport. Sections: hero (live LiDAR terrain-scan canvas),
  ticker, stats, sensor cards, mission flow, data products, sectors, field
  results, CTA, footer.
- `src/index.css` — design tokens (fonts, `tracking-hud-*`, keyframes).
- `src/viewer/ViewerApp.jsx` — viewer UI shell (the big file; all UX, load
  orchestration, recovery logic).
- `src/viewer/las-worker.js` — LAS/LAZ/COPC parsing off-thread; merges tiles;
  streams.
- `src/viewer/PointCloudScene.js` — three.js scene: EDL shading, splats,
  camera, self-parking render loop.
- `src/viewer/classLegend.js` — shared classification legend (three.js-free).
- `src/viewer/diag.js` — flight recorder (see §8).
- `tools/copc-converter/` — drag-and-drop COPC converter (see §7).
- `scripts/gen-test-*.mjs` — synthetic test file generators (gitignored output
  in `public/`).

---

## 5. Viewer capabilities (all shipped)

- Opens `.las`, `.laz`, `.copc.laz`, and photo models `.ply`/`.splat`/`.ksplat`/`.spz`.
- **Multiple files, whole folders, and drag-drop** (files or folders); tiled
  scans merge into one cloud sharing a robust center.
- **COPC streams** (any size, local or hosted via HTTP range). **LAS streams**
  in 32 MB blocks (any size). **Plain non-COPC LAZ** must load whole → size
  capped, error points at the converter.
- **Eye-Dome Lighting** (depth-aware shading; auto-fallback if GPU rejects it).
- **Gaussian splats**: "Photo view / Scan view" toggle when a scan + model are
  loaded together.
- **"Sharpen this area"**: on a COPC file, reloads full captured density for
  the region the camera is looking at (deep octree nodes only).
- **Self-healing**: GPU context-loss recovery ladder (lighter mode → reduced
  detail → honest message), black-screen watchdog, and a **"Copy problem
  report"** button (see §8).
- URL params: `?src=<url>` loads a hosted scan; `?budget=N` overrides point
  budget; `?safe=1` starts in lighter rendering mode.

---

## 6. Environment quirks (important for the machine this runs on)

- **Node** is at `C:\Program Files\nodejs` but NOT on the shell PATH the harness
  inherits. Prepend it: `$env:Path = "C:\Program Files\nodejs;" + $env:Path`.
  In `.claude/launch.json` use `node.exe` full path directly (npm.cmd can't find
  node).
- **npm 11** blocks postinstall scripts; `allowScripts` already set for esbuild.
- **PowerShell**: `.ps1` files must be pure ASCII (BOM-less → read as ANSI;
  em-dashes/smart-quotes break parsing). `git commit -m` here-strings must
  contain **no double quotes** (PS 5.1 native-arg quoting splits them).
- **Preview pane**: the in-app browser is hidden → `screenshot` times out and
  `requestAnimationFrame` doesn't fire. Verify via `javascript_tool` /
  `preview_eval` / reading `window.__viewer`, not screenshots. To test the real
  render loop, monkeypatch `requestAnimationFrame` to `setTimeout`.
- Build+serve prod locally: `npm run build` then
  `node node_modules/vite/bin/vite.js preview --port 4175`.

---

## 7. COPC converter (for big / uncompressed-quality hosting)

- **Why:** 50 GB deliverables can't load whole in any browser. COPC
  (`.copc.laz`) is **lossless** (like a ZIP — every point identical) with an
  internal LOD octree, so the viewer streams it — a 50 GB site opens in seconds.
- **Installed on this machine:** Miniforge at `C:\Users\maste\miniforge3`, conda
  env `copc` with **untwine** + **pdal**.
- **Usage:** drag a folder (or files) onto
  `tools/copc-converter/Make-COPC.bat` → merges everything into one lossless
  `<name>.copc.laz`, validates with PDAL. `Install-Converter.bat` sets up a new
  machine.
- Untwine CLI: `untwine -i <in> -o out.copc.laz --progress_debug`.

---

## 8. Diagnostics (added because a bug wouldn't reproduce)

- `src/viewer/diag.js` is a **flight recorder**: ring buffer of lifecycle events
  (files chosen, worker phases, scene creation, splat loads, context losses, JS
  errors) + GPU name / browser / memory / screen.
- **Black-screen watchdog**: samples pixels every 3 s; two all-background reads →
  a helper overlay with **Reset view / Copy problem report / Dismiss**.
- **"Copy problem report"** buttons live in that overlay, the Help dialog, and
  every error screen. One press copies a pasteable report.
- **NEXT SESSION SHOULD GET THIS REPORT** from the user if problems persist —
  we've been fixing plausible causes without a confirmed reproduction of their
  exact failure.

---

## 9. Real test data on this machine

`C:\Users\maste\Desktop\Bunkhouse 2\` — an actual DJI Terra delivery. **Use
these to reproduce bugs, not synthetic files.**
- `lidars\terra_las\cloud0-3.las` (~2.1 GB each) + `cloud_merged.las` (8.5 GB).
  **`cloud_merged` duplicates the four tiles** — never load both (the viewer now
  de-dupes automatically).
- `lidars\3dgs_ply\Block000-015\LOD1-3\point_cloud.ply` — ~100 tiled Gaussian
  splat files (INRIA-style + extra props, small local coords).
- Whole folder is **~37,000 files / ~40 GB**.

---

## 10. The debugging saga (be honest about this)

The user reported the viewer **"loads then goes black"** and later **"folder
picker does nothing"** across several rounds. Fixes shipped, each for a real
cause found:
1. EDL shader used GPU-hostile GLSL (loop+array) → rewritten strict ES 1.00 +
   auto-fallback.
2. GPU context-loss recovery ladder added.
3. Splat-only context loss rebuilt an empty scene → fixed (keep object URL,
   re-queue splat).
4. Flight recorder + watchdog + Copy-report added.
5. **Folder picker "does nothing"**: pointing it at the 37k-file parent made the
   browser grind silently; also would load merged + duplicate tiles. Fixed with
   instant "Reading the folder…" feedback, `dedupeScanSet` (drops tiles when a
   merged file is present), and steering users to the `terra_las` subfolder /
   single merged file. Also fixed a self-inflicted bug (clearing the file input
   emptied the list before it was read).

**Status: NOT confirmed resolved by the user.** Last deploy (folder fix) was
queued behind a GitHub Actions outage (503s). Next session: confirm the folder
fix works with the real Bunkhouse folder, and **if it still fails, get the "Copy
problem report" output** — or connect the Claude-in-Chrome extension to debug
the user's real browser session directly (it was not connected this session).

---

## 11. Open TODOs

1. **Confirm the folder-picker fix** works on the real Bunkhouse 2 delivery
   (deploy was pending at end of session).
2. **Cloudflare R2 bucket + CORS** — user's task (needs their payment details);
   for hosting client `?src=` links. Then wire up the share flow.
3. **Multi-tile Gaussian splats** — currently loads 1 of N tiles with a notice;
   full merge is future work (`addSplatScenes`).
4. **Dynamic LOD-on-zoom** — "Sharpen this area" is the manual version; auto
   refinement on zoom is optional future work.
5. **Replace placeholders** before real customer use: brand "AeroData",
   `ops@aerodata.io`, hero/stats numbers (14K acres, 320 missions), the three
   Field Results metrics, footer contact.
6. **Test at real scale** — a real Terra LAZ/COPC through the whole pipeline.

---

## 12. Working style notes

- Every substantive change is verified in the running app (via the browser
  tools, since screenshots don't work here) and pushed to GitHub, which
  auto-deploys.
- Multi-agent adversarial code reviews were run at major milestones (the
  marketing site and viewer each passed one) — that workflow is available if
  wanted again.
- The user is non-deeply-technical and testing on this same Windows machine, so:
  reproduce with their real files, keep the UI dead simple, and prefer changes
  that fail gracefully over changes that assume a capable GPU/browser.
