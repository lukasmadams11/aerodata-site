/*
 * PointCloudScene — three.js wrapper for the client scan viewer.
 * Owns the renderer, camera, controls, and the single Points object.
 * The rAF loop parks itself after ~30 idle frames; every external
 * repaint request goes through wake().
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

export class PointCloudScene {
  constructor(container) {
    this.container = container;
    this.dirty = true;
    this.disposed = false;
    this.tween = null;

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor("#05090F");
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 10000);
    this.camera.up.copy(UP);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.maxPolarAngle = Math.PI * 0.49; /* never below the ground plane */

    this.points = null;
    this.grid = null;
    this.data = null;
    this.diag = 100;
    this.center = new THREE.Vector3();

    /* self-parking render loop */
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
      if (moved || this.dirty) {
        this.dirty = false;
        this._idleFrames = 0;
        this.renderer.render(this.scene, this.camera);
      } else if (++this._idleFrames >= 30) {
        this._running = false; /* park until the next wake() */
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

  setData(data) {
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
    this.scene.add(this.points);

    const { min, max } = data.bounds;
    const dx = max[0] - min[0];
    const dy = max[1] - min[1];
    const dz = max[2] - min[2];
    this.diag = Math.max(1, Math.hypot(dx, dy, dz));
    this.center.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);

    /* faint reference grid just under the lowest point */
    const gridSize = Math.max(dx, dy) * 1.4;
    this.grid = new THREE.GridHelper(gridSize, 20, 0x1e293b, 0x101a29);
    this.grid.rotation.x = Math.PI / 2; /* GridHelper is XZ; our world is Z-up */
    this.grid.position.set(this.center.x, this.center.y, min[2] - dz * 0.02);
    this.scene.add(this.grid);

    this.camera.near = this.diag / 1000;
    this.camera.far = this.diag * 12;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = this.diag * 0.02;
    this.controls.maxDistance = this.diag * 4;

    this.setColorMode(data.rgb ? "rgb" : "elevation");
    this.fit(false);
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
      /* elevation via LUT — ~7x faster than computing HSL per point */
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

  /* ---------- camera moves ---------- */

  fit(animate = true) {
    const dist = this.diag * 0.85;
    const dir = new THREE.Vector3(0.75, -1, 0.62).normalize();
    this.moveCamera(this.center.clone().addScaledVector(dir, dist), this.center.clone(), animate);
  }

  topView(animate = true) {
    const pos = this.center.clone().add(new THREE.Vector3(0, -this.diag * 0.001, this.diag * 1.05));
    this.moveCamera(pos, this.center.clone(), animate);
  }

  /* factor > 1 zooms out, < 1 zooms in (distance multiplier) */
  zoomBy(factor) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.setLength(
      Math.min(this.controls.maxDistance, Math.max(this.controls.minDistance, offset.length() * factor))
    );
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
    this.wake();
  }

  /* keyboard orbit: yaw around world Z, pitch around the camera's right axis */
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

  /* ---------- teardown ---------- */

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
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.clearCloud();
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
