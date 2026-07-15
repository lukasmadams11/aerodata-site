# AeroData — Aerial Intelligence Landing Page

Marketing site for a commercial drone services business: **LiDAR mapping, multispectral imaging, and thermal inspection**.

Single-page React app with a "mission control instrument" aesthetic — a live LiDAR terrain-scan hero canvas, crosshair coordinate cursor, live telemetry readouts, sensor cards with STANDBY → ACQUIRING states, and a GIS-style data-products file inspector.

Includes a **Client Scan Viewer** (`viewer.html`): clients open the `.las`/`.laz`
files we deliver right in their browser — drag & drop or one big button, fully
client-side (nothing uploaded, nothing to install). LAS is parsed directly;
LAZ is decompressed with the laz-perf WebAssembly build in a worker; rendering
is three.js. Big files are automatically thinned to a device-appropriate point
budget. Supports `viewer.html?src=<url>` for hosted scans (the host needs CORS).

## Stack

- [Vite](https://vitejs.dev/) + [React 19](https://react.dev/)
- [Tailwind CSS v4](https://tailwindcss.com/) (CSS-first config in `src/index.css`)
- [lucide-react](https://lucide.dev/) icons
- No backend — the site is fully static. Contact CTA is a `mailto:` for now.

## Run it locally

```bash
npm install
npm run dev      # dev server at http://localhost:5173
npm run build    # production build to dist/
npm run preview  # serve the production build
```

## Where things live

- `src/App.jsx` — the entire marketing site (all sections, canvas engines, and copy)
- `src/viewer/` — the client scan viewer (`ViewerApp.jsx` UI, `las-worker.js` LAS/LAZ parsing, `PointCloudScene.js` three.js renderer)
- `src/index.css` — design tokens (fonts, tracking scale, keyframes)
- `index.html` / `viewer.html` — the two pages
- `scripts/gen-test-las.mjs` — generates `public/test.las` (gitignored) for local viewer testing

## Placeholders to replace before launch

- Brand name **"AeroData"** and email **ops@aerodata.io**
- Stats band: *14K+ acres mapped, 320+ missions flown*
- The three **Field Results** metrics (`RESULTS` in `src/App.jsx`)
- Footer coordinates and phone/contact details
