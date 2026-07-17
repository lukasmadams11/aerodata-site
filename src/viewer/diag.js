/* Flight recorder for the scan viewer — a ring buffer of lifecycle events
   plus environment info, exported as a pasteable problem report. */

const buf = [];
const t0 = performance.now();

export function diag(event, data) {
  const t = ((performance.now() - t0) / 1000).toFixed(1);
  let line = `${t}s ${event}`;
  if (data !== undefined) {
    try {
      line += " " + JSON.stringify(data);
    } catch {
      line += " [unserializable]";
    }
  }
  buf.push(line);
  if (buf.length > 250) buf.shift();
}

if (typeof window !== "undefined") {
  window.addEventListener("error", (e) => {
    diag("JS ERROR", { msg: String(e.message).slice(0, 200), src: `${e.filename}:${e.lineno}` });
  });
  window.addEventListener("unhandledrejection", (e) => {
    diag("PROMISE REJECTION", { msg: String(e.reason).slice(0, 200) });
  });
}

function gpuInfo() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return "NO WEBGL";
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const name = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "(renderer name unavailable)";
    return `${name} · ${gl instanceof WebGL2RenderingContext ? "WebGL2" : "WebGL1"}`;
  } catch {
    return "gl probe failed";
  }
}

export function diagReport() {
  return [
    `AeroData Scan Viewer problem report — ${new Date().toISOString()}`,
    `URL: ${location.href}`,
    `Browser: ${navigator.userAgent}`,
    `GPU: ${gpuInfo()}`,
    `Memory hint: ${navigator.deviceMemory ?? "n/a"} GB · CPU cores: ${navigator.hardwareConcurrency ?? "?"}`,
    `Screen: ${screen.width}x${screen.height} @ dpr ${window.devicePixelRatio}`,
    `Visibility: ${document.visibilityState}`,
    "--- events (seconds since page load) ---",
    ...buf,
  ].join("\n");
}
