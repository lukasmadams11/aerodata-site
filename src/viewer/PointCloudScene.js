/*
 * PointCloudScene — three.js wrapper for the client scan viewer.
 *
 * Renders the point cloud through an Eye-Dome Lighting (EDL) post pass —
 * the depth-aware shading every professional point-cloud tool uses — and
 * can additionally host a Gaussian-splat "photo view" of the same site
 * (lazy-loaded @mkkellogg/gaussian-splats-3d DropInViewer).
 *
 * The rAF loop parks itself when idle; wake() is the single repaint entry.
 * Splat mode keeps the loop continuous (the splat sorter is async).
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CLASS_LEGEND } from "./classLegend.js";

const CLASS_COLORS = (() => {
  const map = {};
  for (const entry of CLASS_LEGEND) for (const cl of entry.classes) map[cl] = entry.color;
  return map;
})();
const CLASS_OTHER = [122, 134, 149];

/* blue → cyan → green → yellow → red, DJI-Terra-style elevation ramp */
function rampColor(t, out, o) {
  const h = (1 - Math.min(1, Math.max(0, t))) * (240 / 360);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  out[o] = f(0) * 255;
  out[o + 1] = f(8) * 255;
  out[o + 2] = f(4) * 255;
}

const RAMP_LUT = (() => {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) rampColor(i / 255, lut, i * 3);
  return lut;
})();

const UP = new THREE.Vector3(0, 0, 1);

/* percentile bounds over sampled values — same guard the worker uses */
function pctBounds(xs, ys, zs) {
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

const EDL_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/* Strict GLSL ES 1.00 — no loops around texture reads, no array
   constructors. Some drivers hard-reject those patterns (others merely
   warn), and a failed compile here would mean a black viewer. */
const EDL_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 uResolution;
  uniform float uNear;
  uniform float uFar;
  uniform float uStrength;
  varying vec2 vUv;

  float linearDepth(float d) {
    float z = d * 2.0 - 1.0;
    return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
  }

  float obscure(vec2 uv, float logC) {
    float dn = texture2D(tDepth, uv).x;
    if (dn >= 1.0) return 0.0;
    return max(0.0, logC - log2(linearDepth(dn)));
  }

  void main() {
    vec4 color = texture2D(tColor, vUv);
    float dRaw = texture2D(tDepth, vUv).x;
    if (dRaw >= 1.0) {
      gl_FragColor = color;
      return;
    }
    float logC = log2(linearDepth(dRaw));
    vec2 px = 1.4 / uResolution;
    float response =
      obscure(vUv + vec2(px.x, 0.0), logC) +
      obscure(vUv + vec2(-px.x, 0.0), logC) +
      obscure(vUv + vec2(0.0, px.y), logC) +
      obscure(vUv + vec2(0.0, -px.y), logC) +
      obscure(vUv + vec2(px.x * 0.7, px.y * 0.7), logC) +
      obscure(vUv + vec2(-px.x * 0.7, px.y * 0.7), logC) +
      obscure(vUv + vec2(px.x * 0.7, -px.y * 0.7), logC) +
      obscure(vUv + vec2(-px.x * 0.7, -px.y * 0.7), logC);
    response /= 8.0;
    float shade = clamp(exp(-response * 60.0 * uStrength), 0.25, 1.0);
    gl_FragColor = vec4(color.rgb * shade, color.a);
  }
`;

export class PointCloudScene {
  constructor(container, { safeMode = false } = {}) {
    this.container = container;
    this.safeMode = safeMode;
    this.dirty = true;
    this.disposed = false;
    this.tween = null;
    this.mode = "points";
    this._continuous = false;
    this.onContextLost = null;

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(safeMode ? 1 : Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor("#05090F");
    /* if ANY shader fails to compile on this GPU, drop the EDL post pass
       rather than showing a black view */
    this.renderer.debug.onShaderError = () => {
      if (this.edlOk) {
        this.edlOk = false;
        this.wake?.();
      }
    };
    container.appendChild(this.renderer.domElement);

    /* GPU context loss = the "renders once, then black screen" failure.
       Surface it so the app can rebuild in a lighter mode. */
    this._onCtxLost = (e) => {
      e.preventDefault();
      this._running = false;
      this.onContextLost?.();
    };
    this.renderer.domElement.addEventListener("webglcontextlost", this._onCtxLost, false);

    /* browsers may evict a non-redrawn canvas front buffer under memory
       pressure — a cheap periodic repaint heals it within seconds */
    this._keepalive = setInterval(() => {
      if (!this.disposed) this.wake();
    }, 8000);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 10000);
    this.camera.up.copy(UP);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;

    this.points = null;
    this.grid = null;
    this.data = null;
    this.splat = null;
    this.splatBounds = null;
    this.diag = 100;
    this.center = new THREE.Vector3();

    /* ---- EDL post pass (WebGL2 only; falls back to direct render) ---- */
    this.edlOk = !safeMode && !!this.renderer.capabilities.isWebGL2;
    if (this.edlOk) {
      try {
        const depthTexture = new THREE.DepthTexture(2, 2);
        this.rt = new THREE.WebGLRenderTarget(2, 2, { depthTexture });
        this.edlMaterial = new THREE.ShaderMaterial({
          vertexShader: EDL_VERT,
          fragmentShader: EDL_FRAG,
          uniforms: {
            tColor: { value: this.rt.texture },
            tDepth: { value: depthTexture },
            uResolution: { value: new THREE.Vector2(2, 2) },
            uNear: { value: 0.1 },
            uFar: { value: 10000 },
            uStrength: { value: 1.0 },
          },
          depthTest: false,
          depthWrite: false,
        });
        this.edlScene = new THREE.Scene();
        this.edlScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.edlMaterial));
        this.edlCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      } catch {
        this.edlOk = false;
      }
    }

    /* ---- self-parking render loop ---- */
    this._idleFrames = 0;
    this._running = false;
    this._loop = () => {
      if (this.disposed) {
        this._running = false;
        return;
      }
      let moved;
      if (this.tween) {
        this.stepTween();
        this.controls.update();
        moved = true;
      } else {
        moved = this.controls.update();
      }
      if (moved || this.dirty || this._continuous) {
        this.dirty = false;
        this._idleFrames = 0;
        this.renderFrame();
      } else if (++this._idleFrames >= 30) {
        this._running = false;
        return;
      }
      this.raf = requestAnimationFrame(this._loop);
    };
    this.wake = () => {
      this.dirty = true;
      this._idleFrames = 0;
      if (!this._running && !this.disposed) {
        this._running = true;
        this.raf = requestAnimationFrame(this._loop);
      }
    };
    this.controls.addEventListener("start", this.wake);
    this.controls.addEventListener("change", this.wake);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.wake();
  }

  renderFrame() {
    /* EDL only benefits the point cloud; splats render direct */
    if (this.edlOk && this.mode === "points" && this.points) {
      try {
        const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
        if (size.x * size.y > 4200000) {
          /* very large buffers (4K+): skip the post pass to halve GPU load */
          this.renderer.render(this.scene, this.camera);
          return;
        }
        if (this.rt.width !== size.x || this.rt.height !== size.y) {
          this.rt.setSize(size.x, size.y);
          this.edlMaterial.uniforms.uResolution.value.set(size.x, size.y);
        }
        this.edlMaterial.uniforms.uNear.value = this.camera.near;
        this.edlMaterial.uniforms.uFar.value = this.camera.far;
        this.renderer.setRenderTarget(this.rt);
        this.renderer.render(this.scene, this.camera);
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.edlScene, this.edlCamera);
        return;
      } catch {
        this.edlOk = false;
        this.renderer.setRenderTarget(null);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    if (this.disposed) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.wake();
  }

  applyBounds(bounds) {
    const { min, max } = bounds;
    const dx = max[0] - min[0];
    const dy = max[1] - min[1];
    const dz = max[2] - min[2];
    this.diag = Math.max(1, Math.hypot(dx, dy, dz));
    this.center.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    this.camera.near = this.diag / 1000;
    this.camera.far = this.diag * 12;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = this.diag * 0.02;
    this.controls.maxDistance = this.diag * 4;
  }

  setData(data, { keepCamera = false } = {}) {
    this.clearCloud();
    this.data = data;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    this.colorAttr = new THREE.BufferAttribute(new Uint8Array(data.kept * 3), 3, true);
    geometry.setAttribute("color", this.colorAttr);
    geometry.computeBoundingSphere();

    this.material = new THREE.PointsMaterial({
      size: 2,
      sizeAttenuation: false,
      vertexColors: true,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.visible = this.mode === "points";
    this.scene.add(this.points);

    const savedPos = keepCamera ? this.camera.position.clone() : null;
    const savedTarget = keepCamera ? this.controls.target.clone() : null;
    this.applyBounds(data.bounds);

    const { min, max } = data.bounds;
    const gridSize = Math.max(max[0] - min[0], max[1] - min[1]) * 1.4;
    this.grid = new THREE.GridHelper(gridSize, 20, 0x1e293b, 0x101a29);
    this.grid.rotation.x = Math.PI / 2;
    this.grid.position.set(this.center.x, this.center.y, min[2] - (max[2] - min[2]) * 0.02);
    this.grid.visible = this.mode === "points";
    this.scene.add(this.grid);

    this.setColorMode(data.rgb ? "rgb" : "elevation");
    if (keepCamera && savedPos) {
      this.camera.position.copy(savedPos);
      this.controls.target.copy(savedTarget);
      this.controls.update();
      this.wake();
    } else {
      this.fit(false);
    }
  }

  /* ---- gaussian splat "photo view" ---- */

  async setSplat(url, onProgress, formatName) {
    const GS = await import("@mkkellogg/gaussian-splats-3d");
    if (this.disposed) return 0;
    const dropIn = new GS.DropInViewer({
      sharedMemoryForWorkers: false,
      gpuAcceleratedSort: false,
      freeIntermediateSplatData: true,
    });
    const options = {
      showLoadingUI: false,
      /* fully load before resolving, and skip the reveal animation — the
         model must be complete on the first rendered frame (our loop
         renders on demand, not continuously) */
      progressiveLoad: false,
      sceneRevealMode: GS.SceneRevealMode?.Instant,
      onProgress: (percent) => {
        if (typeof percent === "number") onProgress?.(percent);
      },
    };
    /* object URLs have no extension — the format must be passed explicitly */
    if (formatName && GS.SceneFormat && GS.SceneFormat[formatName] !== undefined) {
      options.format = GS.SceneFormat[formatName];
    }
    await dropIn.addSplatScene(url, options);
    if (this.disposed) {
      try { dropIn.viewer?.dispose(); } catch { /* best effort */ }
      return 0;
    }
    this.splat = dropIn;
    this.scene.add(dropIn);

    /* the library reveals the scene radially over many update() ticks —
       snap the visible region to full so the first frame shows everything */
    try {
      const m = dropIn.viewer?.getSplatMesh?.();
      if (m && typeof m.maxSplatDistanceFromSceneCenter === "number") {
        m.visibleRegionBufferRadius = m.maxSplatDistanceFromSceneCenter;
        m.visibleRegionRadius = m.maxSplatDistanceFromSceneCenter;
        m.visibleRegionFadeStartRadius = m.maxSplatDistanceFromSceneCenter;
        m.updateVisibleRegionFadeDistance?.(GS.SceneRevealMode?.Instant);
      }
    } catch {
      /* cosmetic only */
    }

    let count = 0;
    try {
      const mesh = dropIn.viewer?.getSplatMesh?.();
      if (mesh?.getSplatCount) {
        count = mesh.getSplatCount();
        const v = new THREE.Vector3();
        const xs = [], ys = [], zs = [];
        const step = Math.max(1, Math.floor(count / 5000));
        for (let i = 0; i < count; i += step) {
          mesh.getSplatCenter(i, v, true);
          xs.push(v.x);
          ys.push(v.y);
          zs.push(v.z);
        }
        if (xs.length > 8) this.splatBounds = pctBounds(xs, ys, zs);
      }
    } catch {
      /* bounds stay null — camera keeps whatever frame it has */
    }

    if (!this.data && this.splatBounds) {
      this.applyBounds(this.splatBounds);
      this.fit(false);
    }
    this.setMode("splat");
    return count;
  }

  setMode(mode) {
    this.mode = mode;
    if (this.points) this.points.visible = mode === "points";
    if (this.grid) this.grid.visible = mode === "points";
    if (this.splat) this.splat.visible = mode === "splat";
    this._continuous = mode === "splat" && !!this.splat;
    if (mode === "points" && this.data) this.fitIfLost();
    this.wake();
  }

  fitIfLost() {
    /* if the camera drifted into a splat-only frame with no points on
       screen, a mode switch shouldn't strand the user — cheap guard */
    if (!Number.isFinite(this.camera.position.lengthSq())) this.fit(false);
  }

  setColorMode(mode) {
    if (!this.data) return;
    const d = this.data;
    const out = this.colorAttr.array;
    const n = d.kept;
    const zmin = d.bounds.min[2];
    const zrange = Math.max(1e-6, d.bounds.max[2] - zmin);

    if (mode === "rgb" && d.rgb) {
      out.set(d.rgb);
    } else if (mode === "intensity" && d.intensity) {
      for (let i = 0; i < n; i++) {
        const v = d.intensity[i];
        out[i * 3] = v * 0.85;
        out[i * 3 + 1] = v * 0.95;
        out[i * 3 + 2] = v;
      }
    } else if (mode === "classification") {
      for (let i = 0; i < n; i++) {
        const c = CLASS_COLORS[d.classification[i]] || CLASS_OTHER;
        out[i * 3] = c[0];
        out[i * 3 + 1] = c[1];
        out[i * 3 + 2] = c[2];
      }
    } else {
      const pos = d.positions;
      for (let i = 0; i < n; i++) {
        let idx = (((pos[i * 3 + 2] - zmin) / zrange) * 255) | 0;
        if (idx < 0) idx = 0;
        else if (idx > 255) idx = 255;
        const s = idx * 3;
        const o = i * 3;
        out[o] = RAMP_LUT[s];
        out[o + 1] = RAMP_LUT[s + 1];
        out[o + 2] = RAMP_LUT[s + 2];
      }
    }
    this.colorAttr.needsUpdate = true;
    this.wake();
  }

  setPointSize(px) {
    if (this.material) {
      this.material.size = px;
      this.wake();
    }
  }

  /* ---- camera moves ---- */

  fit(animate = true) {
    const dist = this.diag * 0.85;
    const dir = new THREE.Vector3(0.75, -1, 0.62).normalize();
    this.moveCamera(this.center.clone().addScaledVector(dir, dist), this.center.clone(), animate);
  }

  topView(animate = true) {
    const pos = this.center.clone().add(new THREE.Vector3(0, -this.diag * 0.001, this.diag * 1.05));
    this.moveCamera(pos, this.center.clone(), animate);
  }

  zoomBy(factor) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.setLength(
      Math.min(this.controls.maxDistance, Math.max(this.controls.minDistance, offset.length() * factor))
    );
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
    this.wake();
  }

  orbit(dYaw, dPitch) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.applyAxisAngle(UP, dYaw);
    const polar = offset.angleTo(UP);
    const clamped = Math.min(Math.max(polar - dPitch, 0.05), this.controls.maxPolarAngle);
    const right = new THREE.Vector3().crossVectors(UP, offset).normalize();
    if (right.lengthSq() > 0.5) offset.applyAxisAngle(right, polar - clamped);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
    this.wake();
  }

  moveCamera(pos, target, animate = true) {
    if (!animate) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      this.wake();
      return;
    }
    this.tween = {
      t0: performance.now(),
      dur: 550,
      fromPos: this.camera.position.clone(),
      toPos: pos,
      fromTarget: this.controls.target.clone(),
      toTarget: target,
    };
    this.wake();
  }

  stepTween() {
    const tw = this.tween;
    const p = Math.min(1, (performance.now() - tw.t0) / tw.dur);
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    this.camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
    this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
    this.dirty = true;
    if (p >= 1) this.tween = null;
  }

  /* ---- teardown ---- */

  clearCloud() {
    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      this.material.dispose();
      this.points = null;
    }
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      this.grid.material.dispose();
      this.grid = null;
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearInterval(this._keepalive);
    this.renderer.domElement.removeEventListener("webglcontextlost", this._onCtxLost, false);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.clearCloud();
    if (this.splat) {
      this.scene.remove(this.splat);
      try { this.splat.viewer?.dispose(); } catch { /* best effort */ }
      this.splat = null;
    }
    if (this.rt) {
      this.rt.dispose();
      this.edlMaterial.dispose();
    }
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
    this.data = null;
    this.colorAttr = null;
    this.material = null;
    this.renderer = null;
    this.controls = null;
  }
}
