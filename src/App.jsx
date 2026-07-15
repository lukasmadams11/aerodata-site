import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock,
  Copy,
  Crosshair,
  Flame,
  Gauge,
  Leaf,
  Mail,
  MapPin,
  Menu,
  Pause,
  Play,
  Radar,
  Satellite,
  ShieldCheck,
  X,
} from "lucide-react";

/* ================================================================== */
/*  Utilities                                                          */
/* ================================================================== */

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Deterministic seeded RNG + 2D value noise (shared by the canvases) */
function makeNoise(seedInit = 1337) {
  let s = seedInit;
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
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = fade(x - xi);
    const v = fade(y - yi);
    return lerp(
      lerp(g(xi, yi), g(xi + 1, yi), u),
      lerp(g(xi, yi + 1), g(xi + 1, yi + 1), u),
      v
    );
  };
  const fbm = (x, y) =>
    0.58 * noise(x, y) + 0.3 * noise(x * 2.1, y * 2.1) + 0.12 * noise(x * 4.3, y * 4.3);
  return { rnd, noise, fbm };
}

/** Fade-up-on-scroll wrapper */
function Reveal({ children, delay = 0, className = "" }) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out ${
        inView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
      } ${className}`}
    >
      {children}
    </div>
  );
}

/** Animated counter — counts up when scrolled into view */
function CountUp({ to, duration = 1800, decimals = 0, prefix = "", suffix = "" }) {
  const ref = useRef(null);
  const [val, setVal] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        if (reducedMotion()) {
          setVal(to);
          return;
        }
        const t0 = performance.now();
        const tick = (t) => {
          const p = Math.min(1, Math.max(0, (t - t0) / duration));
          const eased = 1 - Math.pow(1 - p, 4);
          setVal(to * eased);
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.6 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [to, duration]);

  return (
    <span ref={ref} className="tabular-nums">
      {prefix}
      {val.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </span>
  );
}

/** Section header — mono flight-log index + rule + title */
function SectionHead({ index, label, refTag, title, sub }) {
  return (
    <Reveal>
      <div className="mb-7 flex items-center gap-5">
        <span className="whitespace-nowrap font-mono text-[11px] font-medium uppercase tracking-hud-wide text-cyan-400">
          {index} <span aria-hidden="true" className="text-slate-600">//</span> {label}
        </span>
        <span className="h-px flex-1 bg-gradient-to-r from-slate-700/70 to-transparent" />
        <span aria-hidden="true" className="hidden whitespace-nowrap font-mono text-[9.5px] tracking-hud-mid text-slate-500 sm:block">
          {refTag}
        </span>
      </div>
      <h2 className="max-w-3xl font-display text-3xl font-semibold tracking-tight sm:text-4xl lg:text-[2.9rem] lg:leading-[1.08]">
        {title}
      </h2>
      {sub && <p className="mt-5 max-w-2xl text-slate-400">{sub}</p>}
    </Reveal>
  );
}

/* ================================================================== */
/*  HUD chrome — fixed viewport corner brackets (below the navbar)     */
/* ================================================================== */

function HudFrame() {
  const c = "pointer-events-none absolute h-5 w-5 border-cyan-200/20";
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-3 bottom-3 top-19 z-40 hidden xl:block">
      <span className={`${c} left-0 top-0 border-l border-t`} />
      <span className={`${c} right-0 top-0 border-r border-t`} />
      <span className={`${c} bottom-0 left-0 border-b border-l`} />
      <span className={`${c} bottom-0 right-0 border-b border-r`} />
    </div>
  );
}

/* ================================================================== */
/*  Navbar                                                             */
/* ================================================================== */

const NAV_LINKS = [
  { label: "Sensors", href: "#sensors" },
  { label: "Mission", href: "#mission" },
  { label: "Data", href: "#data" },
  { label: "Sectors", href: "#sectors" },
  { label: "Viewer", href: "viewer.html" },
  { label: "Contact", href: "#contact" },
];

function Logo() {
  return (
    <a href="#top" className="group flex items-center gap-3">
      <span className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-400/40 bg-cyan-400/10 transition-shadow duration-300 group-hover:shadow-[0_0_18px_rgba(34,211,238,0.25)]">
        <Crosshair className="h-4.5 w-4.5 text-cyan-300" strokeWidth={1.75} />
      </span>
      <span className="font-display text-[17px] font-bold tracking-tight">
        Aero<span className="text-cyan-400">Data</span>
      </span>
    </a>
  );
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const now = useClock();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const utcOff = -now.getTimezoneOffset() / 60;
  const utcLabel = `UTC${utcOff >= 0 ? "+" : ""}${utcOff}`;

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b backdrop-blur-md transition-colors duration-300 ${
        scrolled ? "border-white/10 bg-[#030609]/85" : "border-transparent bg-[#030609]/40"
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        <Logo />

        <div className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="font-mono text-[11.5px] uppercase tracking-hud-mid text-slate-400 transition-colors hover:text-cyan-300"
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-5">
          <span
            aria-hidden="true"
            className="hidden font-mono text-[10.5px] tracking-hud-tight text-slate-400 tabular-nums lg:block"
          >
            {hh}:{mm}:{ss} <span className="text-slate-600">{utcLabel}</span>
          </span>
          <a
            href="#contact"
            className="hidden rounded-lg bg-amber-400 px-5 py-2.5 font-mono text-[11.5px] font-semibold uppercase tracking-hud-tight text-[#231603] transition-all hover:bg-amber-300 hover:shadow-[0_0_28px_rgba(251,191,36,0.4)] sm:block"
          >
            Request a Flight
          </a>
          <button
            onClick={() => setOpen(!open)}
            className="rounded-lg border border-white/10 p-2 text-slate-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-300 md:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {open && (
        <div className="animate-menu-in border-t border-white/10 bg-[#030609]/95 px-6 py-5 md:hidden">
          <div className="flex flex-col gap-1">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-3 font-mono text-[12px] uppercase tracking-hud-mid text-slate-300 transition-colors hover:bg-white/5 hover:text-cyan-300"
              >
                {l.label}
              </a>
            ))}
            <a
              href="#contact"
              onClick={() => setOpen(false)}
              className="mt-3 rounded-lg bg-amber-400 px-5 py-3 text-center font-mono text-[12px] font-semibold uppercase tracking-hud-tight text-[#231603]"
            >
              Request a Flight
            </a>
          </div>
        </div>
      )}
    </header>
  );
}

/* ================================================================== */
/*  Hero — live LiDAR terrain acquisition                              */
/* ================================================================== */

/**
 * The flagship: a pseudo-3D terrain point grid. Every ~7s a scan band
 * sweeps across; points it touches flash cyan, lift, then settle into a
 * persistent elevation colormap — raw ground visibly becoming data.
 */
function TerrainCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const reduced = reducedMotion();
    const { fbm } = makeNoise(1337);

    const ROWS = 52;
    const ELEV = ["#22384f", "#234b63", "#256579", "#2f8496", "#4db2c2", "#8ee3ee"];

    let raf = 0;
    let W = 0, H = 0, dpr = 1, COLS = 80;
    let heights = [];
    let scannedAt = null;
    let px, py, fl;
    let yaw = 0, targetYaw = 0;
    let running = false;
    const start = performance.now();

    function resize() {
      dpr = Math.min(1.75, window.devicePixelRatio || 1);
      W = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      H = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      canvas.width = W;
      canvas.height = H;
      COLS = Math.round(Math.min(112, Math.max(56, canvas.clientWidth / 11)));
      heights = Array.from({ length: ROWS }, (_, j) =>
        Array.from({ length: COLS }, (_, i) => fbm(i * 0.055, j * 0.09))
      );
      scannedAt = new Float64Array(COLS * ROWS).fill(reduced ? 1 : -1);
      px = new Float32Array(COLS * ROWS);
      py = new Float32Array(COLS * ROWS);
      fl = new Float32Array(COLS * ROWS);
      if (reduced) draw(performance.now(), true);
    }

    function draw(now, staticFrame = false) {
      ctx.clearRect(0, 0, W, H);
      const horizon = H * 0.32;
      const cycle = 7000;
      const sweepDur = 2500;
      const pad = 170 * dpr;
      const cp = (now - start) % cycle;
      const sweeping = !staticFrame && cp < sweepDur;
      const bandX = sweeping ? -pad + (cp / sweepDur) * (W + 2 * pad) : -1e9;
      const band = 72 * dpr;
      yaw += (targetYaw - yaw) * 0.05;

      const dim = new Path2D();
      const buckets = ELEV.map(() => new Path2D());
      const flash = new Path2D();
      const links = new Path2D();

      for (let j = 0; j < ROWS; j++) {
        const t = j / (ROWS - 1);
        const persp = Math.pow(t, 1.62);
        const rowY = horizon + persp * (H - horizon) * 1.03;
        const rs = 0.24 + 0.98 * persp;
        const cw = (W / COLS) * 1.75 * rs;
        const size = (1.35 + persp * 1.15) * dpr;

        for (let i = 0; i < COLS; i++) {
          const idx = j * COLS + i;
          const hgt = heights[j][i];
          const x = W / 2 + (i - COLS / 2) * cw + yaw * dpr * (1 - t) * 1.4;
          let y = rowY - hgt * 84 * dpr * rs;

          if (sweeping && Math.abs(x - bandX) < band) scannedAt[idx] = now;
          const f = staticFrame ? 0 : Math.max(0, 1 - (now - scannedAt[idx]) / 950);
          if (f > 0.02) y -= f * 3.4 * dpr;

          px[idx] = x;
          py[idx] = y;
          fl[idx] = f;

          if (scannedAt[idx] < 0) {
            dim.rect(x, y, size * 0.8, size * 0.8);
          } else if (f > 0.35) {
            flash.rect(x - 0.5 * dpr, y - 0.5 * dpr, size * 1.5, size * 1.5);
          } else {
            buckets[Math.min(5, Math.floor(hgt * 6))].rect(x, y, size, size);
          }
        }
      }

      /* connective tissue between freshly-scanned points */
      if (sweeping) {
        for (let j = 0; j < ROWS - 2; j += 2) {
          for (let i = 0; i < COLS - 2; i += 2) {
            const a = j * COLS + i;
            if (fl[a] <= 0.45) continue;
            const b = a + 2;
            const c = a + 2 * COLS;
            if (fl[b] > 0.45) {
              links.moveTo(px[a], py[a]);
              links.lineTo(px[b], py[b]);
            }
            if (fl[c] > 0.45) {
              links.moveTo(px[a], py[a]);
              links.lineTo(px[c], py[c]);
            }
          }
        }
      }

      ctx.fillStyle = "rgba(148,163,184,0.26)";
      ctx.fill(dim);
      ctx.globalAlpha = 0.6;
      buckets.forEach((b, k) => {
        ctx.fillStyle = ELEV[k];
        ctx.fill(b);
      });
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(34,211,238,0.15)";
      ctx.lineWidth = 1 * dpr;
      ctx.stroke(links);
      ctx.fillStyle = "rgba(140,240,252,0.95)";
      ctx.fill(flash);

      /* the scan head itself: bright leading edge + gradient wake */
      if (sweeping && bandX > -pad && bandX < W + pad) {
        const wake = ctx.createLinearGradient(bandX - 150 * dpr, 0, bandX, 0);
        wake.addColorStop(0, "rgba(34,211,238,0)");
        wake.addColorStop(1, "rgba(34,211,238,0.07)");
        ctx.fillStyle = wake;
        ctx.fillRect(bandX - 150 * dpr, horizon * 0.85, 150 * dpr, H - horizon * 0.85);
        ctx.fillStyle = "rgba(103,232,249,0.5)";
        ctx.fillRect(bandX, horizon * 0.85, 1.4 * dpr, H - horizon * 0.85);
      }
    }

    function loop(now) {
      if (!running) return;
      draw(now);
      raf = requestAnimationFrame(loop);
    }
    function startLoop() {
      if (running || reduced) return;
      running = true;
      raf = requestAnimationFrame(loop);
    }
    function stopLoop() {
      running = false;
      cancelAnimationFrame(raf);
    }

    const onPointer = (e) => {
      targetYaw = (e.clientX / window.innerWidth - 0.5) * 26;
    };

    resize();
    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);
    const io = new IntersectionObserver(
      ([en]) => (en.isIntersecting ? startLoop() : stopLoop()),
      { threshold: 0.05 }
    );
    io.observe(canvas);

    if (!reduced) window.addEventListener("pointermove", onPointer, { passive: true });

    return () => {
      stopLoop();
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("pointermove", onPointer);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
}

/** Crosshair coordinate cursor — hero only, fine pointers only */
function Reticle({ containerRef }) {
  const xRef = useRef(null);
  const yRef = useRef(null);
  const chipRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches || reducedMotion()) return;
    const el = containerRef.current;
    const wrap = wrapRef.current;
    if (!el || !wrap) return;

    const fmt = new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 1,
      minimumFractionDigits: 1,
    });

    let raf = 0;
    let tx = 0, ty = 0, cx = -1, cy = -1;
    let running = false;

    const frame = () => {
      cx += (tx - cx) * 0.16;
      cy += (ty - cy) * 0.16;
      if (xRef.current) xRef.current.style.transform = `translateX(${cx}px)`;
      if (yRef.current) yRef.current.style.transform = `translateY(${cy}px)`;
      if (chipRef.current) {
        const flip = cx > el.clientWidth - 220;
        chipRef.current.style.transform = `translate(${cx + (flip ? -14 : 14)}px, ${cy + 16}px) ${flip ? "translateX(-100%)" : ""}`;
        const e = 512000 + cx * 1.7;
        const n = 4182000 + (el.clientHeight - cy) * 2.3;
        chipRef.current.textContent = `E ${fmt.format(e)}  N ${fmt.format(n)}`;
      }
      /* park the loop once converged; move() restarts it */
      if (Math.abs(tx - cx) < 0.1 && Math.abs(ty - cy) < 0.1) {
        running = false;
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    const move = (e) => {
      const r = el.getBoundingClientRect();
      tx = e.clientX - r.left;
      ty = e.clientY - r.top;
      if (cx < 0) {
        cx = tx;
        cy = ty;
      }
      if (!running) {
        running = true;
        wrap.style.opacity = "1";
        raf = requestAnimationFrame(frame);
      }
    };
    const leave = () => {
      running = false;
      wrap.style.opacity = "0";
      cancelAnimationFrame(raf);
    };

    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, [containerRef]);

  return (
    <div
      ref={wrapRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20 opacity-0 transition-opacity duration-300"
    >
      <span ref={xRef} className="absolute inset-y-0 left-0 w-px bg-cyan-400/15 will-change-transform" />
      <span ref={yRef} className="absolute inset-x-0 top-0 h-px bg-cyan-400/15 will-change-transform" />
      {/* tracking-[0.05em]: deliberate exception — tabular coordinates, not a label */}
      <span
        ref={chipRef}
        className="absolute left-0 top-0 whitespace-pre border border-cyan-400/25 bg-[#030609]/85 px-2 py-1 font-mono text-[10px] tracking-[0.05em] text-cyan-300 tabular-nums will-change-transform"
      />
    </div>
  );
}

/** Live-updating flight telemetry (random-walked, purely illustrative) */
function useLiveTelemetry() {
  const [t, setT] = useState({ alt: 388, sats: 27, link: 99.8 });
  useEffect(() => {
    if (reducedMotion()) return;
    const clamp = (lo, hi, v) => Math.min(hi, Math.max(lo, v));
    const id = setInterval(() => {
      setT((p) => ({
        alt: clamp(372, 396, p.alt + (Math.random() * 4 - 2)),
        sats: clamp(24, 31, p.sats + (Math.random() < 0.18 ? (Math.random() < 0.5 ? -1 : 1) : 0)),
        link: clamp(99.3, 99.9, p.link + (Math.random() * 0.2 - 0.1)),
      }));
    }, 2000);
    return () => clearInterval(id);
  }, []);
  return t;
}

function Hero() {
  const heroRef = useRef(null);
  const tel = useLiveTelemetry();

  const TELEMETRY = [
    { k: "ALT", v: `${Math.round(tel.alt)} ft AGL` },
    { k: "GNSS", v: `RTK FIX · ${Math.round(tel.sats)} SV` },
    { k: "GSD", v: "2.0 cm/px" },
    { k: "LINK", v: `${tel.link.toFixed(1)}%` },
  ];

  return (
    <section
      id="top"
      ref={heroRef}
      className="relative flex min-h-screen flex-col justify-center overflow-hidden pt-16"
    >
      <TerrainCanvas />

      {/* flight path arc + drone tick */}
      <svg
        className="pointer-events-none absolute left-0 top-[6%] h-[38%] w-full"
        viewBox="0 0 1440 300"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M -40 210 Q 380 60 740 110 T 1480 80"
          fill="none"
          stroke="rgba(34,211,238,0.12)"
          strokeWidth="1"
          strokeDasharray="4 8"
        />
        <circle className="motion-reduce:hidden" r="2.5" fill="rgba(103,232,249,0.9)">
          <animateMotion dur="34s" repeatCount="indefinite" path="M -40 210 Q 380 60 740 110 T 1480 80" />
        </circle>
      </svg>

      {/* vignette to keep the text zone quiet */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_90%_70%_at_28%_42%,rgba(3,6,9,0.55)_0%,transparent_55%),linear-gradient(to_bottom,rgba(3,6,9,0.5),transparent_28%,transparent_70%,#030609_100%)]"
      />

      <Reticle containerRef={heroRef} />

      <div className="relative z-10 mx-auto grid w-full max-w-7xl items-center gap-12 px-5 sm:px-8 lg:grid-cols-[1fr_auto]">
        <div className="max-w-2xl">
          <div className="animate-fade-up [animation-delay:80ms] mb-8 inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-[#030609]/90 px-4 py-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-amber-400" />
            <span className="font-mono text-[10.5px] uppercase tracking-hud-wide text-slate-300">
              Aerial Intelligence · FAA Part 107
            </span>
          </div>

          <h1 className="animate-fade-up [animation-delay:200ms] font-display text-5xl font-bold leading-[1.02] tracking-tight sm:text-6xl lg:text-[5.2rem]">
            The sky is{" "}
            <span className="bg-gradient-to-r from-cyan-300 via-sky-400 to-blue-500 bg-clip-text text-transparent">
              a sensor.
            </span>
          </h1>

          <p className="animate-fade-up [animation-delay:320ms] mt-7 max-w-xl text-base leading-relaxed text-slate-400 sm:text-lg">
            Survey-grade LiDAR, multispectral, and thermal missions over your
            site — ±2 cm vertical accuracy, radiometric truth, and files in
            your inbox, typically within 48 hours.
          </p>

          <div className="animate-fade-up [animation-delay:440ms] mt-10 flex flex-col gap-4 sm:flex-row">
            <a
              href="#contact"
              className="group inline-flex items-center justify-center gap-2 rounded-lg bg-amber-400 px-8 py-4 font-mono text-[13px] font-semibold uppercase tracking-hud-tight text-[#231603] shadow-[0_0_32px_rgba(251,191,36,0.35)] transition-all hover:bg-amber-300 hover:shadow-[0_0_48px_rgba(251,191,36,0.5)]"
            >
              Request a Flight
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </a>
            <a
              href="#sensors"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-400/30 bg-[#030609]/90 px-8 py-4 font-mono text-[13px] font-medium uppercase tracking-hud-tight text-slate-200 transition-all hover:border-cyan-400/60 hover:text-cyan-300"
            >
              See the Sensors
            </a>
          </div>
        </div>

        {/* live telemetry stack */}
        <div className="animate-fade-up [animation-delay:560ms] hidden flex-col gap-3 lg:flex" aria-hidden="true">
          {TELEMETRY.map((t) => (
            <div
              key={t.k}
              className="flex min-w-[190px] items-baseline justify-between gap-6 border border-white/10 bg-[#030609]/90 px-4 py-3"
            >
              <span className="font-mono text-[9.5px] tracking-hud-mid text-slate-500">{t.k}</span>
              <span className="font-mono text-[13px] font-medium text-slate-200 tabular-nums">{t.v}</span>
            </div>
          ))}
          <div className="flex items-center justify-between border border-white/10 bg-[#030609]/90 px-4 py-3">
            <span className="font-mono text-[9.5px] tracking-hud-mid text-slate-500">SCAN</span>
            <span className="flex items-center gap-2 font-mono text-[11px] text-cyan-300">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-cyan-400 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan-400" />
              </span>
              ACTIVE
            </span>
          </div>
        </div>
      </div>

      {/* scroll cue */}
      <div
        aria-hidden="true"
        className="absolute bottom-7 left-1/2 z-10 hidden -translate-x-1/2 flex-col items-center gap-2.5 sm:flex"
      >
        <span className="font-mono text-[9px] tracking-hud-wide text-slate-500">
          SCROLL FOR MISSION DATA
        </span>
        <span className="h-7 w-px overflow-hidden bg-white/10">
          <span className="block h-2.5 w-px bg-cyan-400/60" />
        </span>
      </div>
    </section>
  );
}

/* ================================================================== */
/*  Capability ticker                                                  */
/* ================================================================== */

const TICKER = [
  "SURVEY-GRADE LIDAR",
  "MULTISPECTRAL 5-BAND",
  "THERMAL <50 mK NETD",
  "RTK / PPK POSITIONING",
  "FAA PART 107",
  "48 hr TYPICAL DELIVERY",
  "GROUND CONTROL VERIFIED",
  "CAD / GIS / LAS DELIVERABLES",
];

function Ticker() {
  const [paused, setPaused] = useState(false);
  return (
    <div className="relative overflow-hidden border-y border-white/5 bg-white/[0.015] py-3.5">
      <div
        aria-hidden="true"
        className="animate-marquee flex w-max hover:[animation-play-state:paused] motion-reduce:animate-none"
        style={paused ? { animationPlayState: "paused" } : undefined}
      >
        {[0, 1].map((half) => (
          <div key={half} className="flex shrink-0 items-center">
            {TICKER.map((t) => (
              <span key={t} className="flex items-center font-mono text-[10px] tracking-hud-wide text-slate-500">
                <span className="mx-7">{t}</span>
                <span className="h-1 w-1 rotate-45 bg-cyan-400/40" />
              </span>
            ))}
          </div>
        ))}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[#030609] to-transparent"
      />
      <button
        type="button"
        onClick={() => setPaused((p) => !p)}
        aria-pressed={paused}
        aria-label={paused ? "Play capability ticker" : "Pause capability ticker"}
        className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded border border-white/10 bg-[#030609]/90 text-slate-400 transition-colors hover:border-white/25 hover:text-cyan-300"
      >
        {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
      </button>
    </div>
  );
}

/* ================================================================== */
/*  Stats band                                                         */
/* ================================================================== */

// NOTE: 14K+ acres and 320+ missions are placeholder metrics — replace with real project data.
const STATS = [
  { value: 14, suffix: "K+", label: "ACRES MAPPED" },
  { fixed: "±2 cm", label: "VERTICAL RMSE" },
  { value: 6, suffix: "", label: "SECTORS SERVED" },
  { value: 320, suffix: "+", label: "MISSIONS FLOWN" },
];

function StatsBand() {
  return (
    <section className="bg-[radial-gradient(rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:22px_22px] py-16">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-4 px-5 sm:px-8 md:grid-cols-4">
        {STATS.map((s, i) => (
          <Reveal key={s.label} delay={i * 90}>
            <div className="border border-white/10 bg-[#030609]/60 px-6 py-6">
              <div className="font-mono text-2xl font-medium text-white sm:text-3xl">
                {s.fixed ? (
                  <span className="tabular-nums">{s.fixed}</span>
                ) : (
                  <CountUp to={s.value} suffix={s.suffix} />
                )}
              </div>
              <div className="mt-2 font-mono text-[9.5px] tracking-hud-mid text-slate-400">
                {s.label}
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ================================================================== */
/*  01 // Sensor suite                                                 */
/* ================================================================== */

/** Rotating 3D point-cloud of a transmission tower */
function LidarCloudCanvas({ active }) {
  const ref = useRef(null);
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const reduced = reducedMotion();

    /* build the pylon vertex cloud once */
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const jit = (v, a = 2.2) => v + (rnd() - 0.5) * a;
    const pts = [];
    const corners = [
      [1, 1],
      [1, -1],
      [-1, -1],
      [-1, 1],
    ];
    const radiusAt = (y) => 34 - 24 * (y / 150);
    // legs
    for (const [fx, fz] of corners)
      for (let k = 0; k <= 26; k++) {
        const y = (k / 26) * 150;
        const r = radiusAt(y);
        pts.push([jit(fx * r), y, jit(fz * r)]);
      }
    // ring braces
    for (const y of [0, 30, 60, 90, 120, 150]) {
      const r = radiusAt(y);
      for (let e = 0; e < 4; e++) {
        const [ax, az] = corners[e];
        const [bx, bz] = corners[(e + 1) % 4];
        for (let k = 1; k < 6; k++) {
          const t = k / 6;
          pts.push([jit((ax + (bx - ax) * t) * r), jit(y, 1.5), jit((az + (bz - az) * t) * r)]);
        }
      }
    }
    // face diagonals
    for (let seg = 0; seg < 5; seg++) {
      const y0 = seg * 30;
      const y1 = y0 + 30;
      for (let e = 0; e < 4; e++) {
        const [ax, az] = corners[e];
        const [bx, bz] = corners[(e + 1) % 4];
        for (let k = 1; k < 5; k++) {
          const t = k / 5;
          const ra = radiusAt(y0 + (y1 - y0) * t);
          pts.push([
            jit((ax + (bx - ax) * t) * ra),
            jit(y0 + (y1 - y0) * t, 1.5),
            jit((az + (bz - az) * t) * ra),
          ]);
        }
      }
    }
    // crossarms + tip
    for (let k = 0; k <= 26; k++) pts.push([jit(-62 + (124 * k) / 26), jit(150, 1.5), jit(0, 3)]);
    for (let k = 0; k <= 16; k++) pts.push([jit(-44 + (88 * k) / 16), jit(132, 1.5), jit(0, 3)]);
    for (let k = 0; k <= 6; k++) pts.push([jit(0, 1.5), 150 + (k / 6) * 20, jit(0, 1.5)]);

    const RAMP = ["#155e75", "#0e7490", "#0891b2", "#22d3ee", "#67e8f9", "#cffafe"];
    const ALPHAS = [0.35, 0.6, 0.95];
    const colorIdx = new Uint8Array(pts.length);
    for (let i = 0; i < pts.length; i++)
      colorIdx[i] = Math.max(0, Math.min(5, Math.floor((pts[i][1] / 172) * 6)));
    const paths = new Array(18);

    let raf = 0;
    let W = 0, H = 0, dpr = 1;
    let theta = 0.6;
    let last = performance.now();
    let running = false;

    function resize() {
      dpr = Math.min(1.75, window.devicePixelRatio || 1);
      W = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      H = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      canvas.width = W;
      canvas.height = H;
      if (reduced) draw();
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      const s = H / 215; /* device-pixel scale: H is already in device px */
      const cx = W / 2;
      const baseY = H * 0.94;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const sz = 1.7 * dpr;
      paths.fill(null);
      for (let i = 0; i < pts.length; i++) {
        const [x, y, z] = pts[i];
        const rx = x * cos - z * sin;
        const rz = x * sin + z * cos;
        const a = Math.max(0.25, Math.min(1, 0.62 + rz / 110));
        const tier = a > 0.8 ? 2 : a > 0.5 ? 1 : 0;
        const id = colorIdx[i] * 3 + tier;
        let p = paths[id];
        if (!p) p = paths[id] = new Path2D();
        p.rect(cx + rx * s, baseY - y * s, sz, sz);
      }
      for (let id = 0; id < 18; id++) {
        const p = paths[id];
        if (!p) continue;
        ctx.globalAlpha = ALPHAS[id % 3];
        ctx.fillStyle = RAMP[(id / 3) | 0];
        ctx.fill(p);
      }
      ctx.globalAlpha = 1;
    }

    function loop(now) {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      theta += dt * (activeRef.current ? 0.85 : 0.18);
      draw();
      raf = requestAnimationFrame(loop);
    }
    function startLoop() {
      if (running || reduced) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    }
    function stopLoop() {
      running = false;
      cancelAnimationFrame(raf);
    }

    resize();
    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);
    const io = new IntersectionObserver(
      ([en]) => (en.isIntersecting ? startLoop() : stopLoop()),
      { threshold: 0.1 }
    );
    io.observe(canvas);

    return () => {
      stopLoop();
      io.disconnect();
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="h-full w-full" aria-hidden="true" />;
}

/** Calibrated NDVI raster preview + revisit scan line */
function NdviVisual({ active }) {
  return (
    <div className="relative h-full w-full" aria-hidden="true">
      <PreviewCanvas draw={drawNdviPreview} />
      {active && (
        <span className="animate-revisit absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-400/60 to-transparent" />
      )}
      <div className="absolute bottom-2 left-2 right-2 flex items-center gap-2 rounded-sm bg-[#030609]/90 px-2 py-1.5">
        <span className="h-1 flex-1 rounded-full bg-gradient-to-r from-[#A63D2F] via-[#E8C547] to-[#57C46B]" />
        <span className="font-mono text-[8.5px] tracking-hud-tight text-slate-300">NDVI 0.2 → 0.9</span>
      </div>
    </div>
  );
}

/** Radiometric thermal ortho preview + revisit scan line */
function ThermalVisual({ active }) {
  return (
    <div className="relative h-full w-full" aria-hidden="true">
      <PreviewCanvas draw={drawThermalPreview} />
      {active && (
        <span className="animate-revisit absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-orange-400/60 to-transparent" />
      )}
      <span className="absolute left-3 top-2.5 font-mono text-[8.5px] tracking-hud-mid text-orange-300/90">
        ΔT +42.8°C // ANOMALY
      </span>
      <div className="absolute right-3 top-1/2 flex h-[64%] -translate-y-1/2 items-stretch gap-2">
        <div className="flex flex-col justify-between py-0.5 text-right font-mono text-[8.5px] text-slate-300">
          <span>61.2°</span>
          <span>18.4°</span>
        </div>
        <div className="w-1.5 rounded-full border border-white/10 bg-gradient-to-b from-yellow-200 via-orange-500 to-purple-900" />
      </div>
    </div>
  );
}

const SENSORS = [
  {
    id: "lidar",
    icon: Radar,
    title: "LiDAR Mapping",
    desc: "Multi-return LiDAR penetrates canopy gaps to model bare earth as high-density, centimeter-precision point clouds — terrain, structures, and stockpiles resolved in 3D.",
    table: [
      ["WAVELENGTH", "905 nm"],
      ["PULSE RATE", "240K pts/s"],
      ["ACCURACY", "±2 cm RMSE"],
    ],
    outputs: ["LAS / LAZ", "DXF", "DEM / DTM", "VOLUMES"],
    accent: {
      title: "text-cyan-300",
      statusOn: "border-cyan-400/50 text-cyan-300",
      activeBorder: "border-cyan-400/40",
      activeShadow: "shadow-[0_0_60px_-15px_rgba(34,211,238,0.4)]",
      glow: "rgba(34,211,238,0.07)",
      icon: "border-cyan-400/30 bg-cyan-400/10 text-cyan-300",
    },
    Visual: LidarCloudCanvas,
  },
  {
    id: "multispectral",
    icon: Leaf,
    title: "Multispectral Imaging",
    desc: "Crop stress is visible in the red edge weeks before the naked eye catches it. Calibrated five-band imaging quantifies plant health, water stress, and nutrient variability.",
    table: [
      ["BANDS", "5 + calibration"],
      ["RED EDGE", "717 nm"],
      ["NIR", "840 nm"],
    ],
    outputs: ["NDVI / NDRE", "RX ZONES", "GEOTIFF"],
    accent: {
      title: "text-emerald-300",
      statusOn: "border-emerald-400/50 text-emerald-300",
      activeBorder: "border-emerald-400/40",
      activeShadow: "shadow-[0_0_60px_-15px_rgba(52,211,153,0.35)]",
      glow: "rgba(52,211,153,0.07)",
      icon: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
    },
    Visual: NdviVisual,
  },
  {
    id: "thermal",
    icon: Flame,
    title: "Thermal Inspection",
    desc: "Radiometric infrared reads the true temperature of every pixel. Failing solar cells, moisture intrusion, and overheating equipment — found without shutting anything down.",
    table: [
      ["RESOLUTION", "640 × 512"],
      ["SENSITIVITY", "<50 mK NETD"],
      ["OUTPUT", "Radiometric"],
    ],
    outputs: ["R-JPEG / TIFF", "ΔT REPORT", "ORTHO OVERLAY"],
    accent: {
      title: "text-orange-300",
      statusOn: "border-orange-400/50 text-orange-300",
      activeBorder: "border-orange-400/40",
      activeShadow: "shadow-[0_0_60px_-15px_rgba(251,146,60,0.35)]",
      glow: "rgba(251,146,60,0.07)",
      icon: "border-orange-400/30 bg-orange-400/10 text-orange-300",
    },
    Visual: ThermalVisual,
  },
];

function SensorCard({ sensor, delay }) {
  const { icon: Icon, accent, Visual } = sensor;
  const [active, setActive] = useState(false);
  const cardRef = useRef(null);

  /* touch devices: engage once when a substantial portion of the card is on screen */
  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) return;
    const el = cardRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([en]) => {
        if (en.isIntersecting && en.intersectionRatio >= 0.35) {
          setActive(true);
          io.disconnect();
        }
      },
      { threshold: [0.4] }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const onMove = (e) => {
    const r = cardRef.current.getBoundingClientRect();
    cardRef.current.style.setProperty("--mx", `${e.clientX - r.left}px`);
    cardRef.current.style.setProperty("--my", `${e.clientY - r.top}px`);
  };

  return (
    <Reveal delay={delay} className="h-full">
      <article
        ref={cardRef}
        onPointerEnter={() => setActive(true)}
        onPointerLeave={() => setActive(false)}
        onPointerMove={onMove}
        className={`group relative h-full overflow-hidden rounded-xl border bg-white/[0.025] transition-all duration-500 ${
          active
            ? `${accent.activeBorder} ${accent.activeShadow} -translate-y-1.5`
            : "border-white/10"
        }`}
      >
        {/* cursor-proximity wash */}
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 transition-opacity duration-500 ${active ? "opacity-100" : "opacity-0"}`}
          style={{
            background: `radial-gradient(380px circle at var(--mx, 50%) var(--my, 50%), ${accent.glow}, transparent 65%)`,
          }}
        />

        {/* visualization */}
        <div className="relative h-44 border-b border-white/[0.06] bg-[#05090F]">
          <div
            className={`h-full w-full transition-all duration-500 ${active ? "" : "opacity-45 grayscale-[0.85]"}`}
          >
            <Visual active={active} />
          </div>
          <span
            aria-hidden="true"
            key={active ? "on" : "off"}
            className={`animate-flicker absolute right-2.5 top-2.5 border bg-[#030609]/80 px-2 py-1 font-mono text-[8.5px] tracking-hud-mid ${
              active ? accent.statusOn : "border-white/10 text-slate-500"
            }`}
          >
            {active ? "ACQUIRING" : "STANDBY"}
          </span>
        </div>

        <div className="relative p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className={`flex h-10 w-10 items-center justify-center rounded-lg border ${accent.icon}`}>
              <Icon className="h-4.5 w-4.5" strokeWidth={1.75} />
            </span>
            <h3 className="font-display text-lg font-semibold tracking-tight text-white">
              {sensor.title}
            </h3>
          </div>

          <p className="text-sm leading-relaxed text-slate-400">{sensor.desc}</p>

          {/* spec table */}
          <dl className="mt-5 border-t border-white/[0.07]">
            {sensor.table.map(([k, v]) => (
              <div
                key={k}
                className="flex items-baseline justify-between border-b border-white/[0.07] py-2"
              >
                <dt className="font-mono text-[9px] tracking-hud-mid text-slate-400">{k}</dt>
                <dd className={`font-mono text-[11px] tabular-nums ${active ? accent.title : "text-slate-300"} transition-colors duration-300`}>
                  {v}
                </dd>
              </div>
            ))}
          </dl>

          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Typical outputs">
            {sensor.outputs.map((o) => (
              <li
                key={o}
                className="border border-white/10 px-2 py-1 font-mono text-[8.5px] tracking-hud-tight text-slate-400"
              >
                {o}
              </li>
            ))}
          </ul>
        </div>
      </article>
    </Reveal>
  );
}

function SensorSuite() {
  return (
    <section id="sensors" className="relative py-28">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHead
          index="01"
          label="Sensor Suite"
          refTag="REF AD-2026-01"
          title={
            <>
              Three instruments.{" "}
              <span className="text-slate-500">One aircraft.</span>
            </>
          }
          sub="Every mission is flown with the sensor matched to your question — terrain, plant health, or heat."
        />
        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {SENSORS.map((s, i) => (
            <SensorCard key={s.id} sensor={s} delay={i * 120} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ================================================================== */
/*  02 // Mission flow                                                 */
/* ================================================================== */

const WAYPOINTS = [
  {
    wp: "WP-01",
    t: "T−48 HR",
    name: "Plan",
    desc: "Site assessment, airspace clearance, and a flight plan engineered to your accuracy spec. Scoped quote within 24 hours.",
  },
  {
    wp: "WP-02",
    t: "T+0",
    name: "Fly",
    desc: "FAA Part 107 pilots fly RTK-corrected missions verified against ground control. Most sites captured in one morning.",
  },
  {
    wp: "WP-03",
    t: "T+6 HR",
    name: "Process",
    desc: "Raw sensor data is processed, classified, and QC'd against control points. Every deliverable ships with an accuracy report.",
  },
  {
    wp: "WP-04",
    t: "T+48 HR",
    name: "Deliver",
    desc: "Files land in the formats your team already uses — CAD, GIS, or PDF.",
  },
];

function MissionFlow() {
  const ref = useRef(null);
  const [lit, setLit] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([en]) => {
        if (en.isIntersecting) {
          setLit(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section id="mission" className="relative py-28">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-b from-transparent via-slate-900/35 to-transparent"
      />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHead
          index="02"
          label="Mission Flow"
          refTag="REF AD-2026-02"
          title="From wheels-up to file delivery."
        />

        <div ref={ref} className="relative mt-16">
          {/* dashed flight line */}
          <span
            aria-hidden="true"
            className={`absolute left-0 right-0 top-[5px] hidden h-px origin-left bg-[repeating-linear-gradient(90deg,rgba(34,211,238,0.4)_0_6px,transparent_6px_14px)] transition-transform duration-[1600ms] ease-out md:block ${
              lit ? "scale-x-100" : "scale-x-0"
            }`}
          />
          <ol className="grid gap-10 md:grid-cols-4 md:gap-8">
            {WAYPOINTS.map((w, i) => (
              <li key={w.wp} className="relative md:pt-9">
                <span
                  aria-hidden="true"
                  style={{ transitionDelay: `${300 + i * 320}ms` }}
                  className={`absolute left-0 top-0 hidden h-[11px] w-[11px] rounded-full border transition-colors duration-500 md:block ${
                    lit ? "border-cyan-400 bg-cyan-400" : "border-cyan-400/40 bg-[#030609]"
                  }`}
                />
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[10px] tracking-hud-mid text-cyan-400">{w.wp}</span>
                  <span className="font-mono text-[9px] tracking-hud-mid text-slate-400">{w.t}</span>
                </div>
                <h3 className="mt-2 font-display text-xl font-semibold tracking-tight">{w.name}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-slate-400">{w.desc}</p>
              </li>
            ))}
          </ol>
        </div>

        {/* operating standards strip */}
        <div className="mt-16 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 md:grid-cols-4">
          {[
            { icon: ShieldCheck, k: "FAA PART 107", v: "Certified & current" },
            { icon: Satellite, k: "RTK / PPK", v: "Survey-grade georeferencing" },
            { icon: Gauge, k: "CALIBRATED", v: "Radiometric truth" },
            { icon: Clock, k: "48 HR", v: "Typical turnaround" },
          ].map(({ icon: I, k, v }) => (
            <div key={k} className="flex items-center gap-3.5 bg-[#050a12] px-5 py-4">
              <I className="h-4.5 w-4.5 shrink-0 text-cyan-400" strokeWidth={1.75} />
              <div>
                <div className="font-mono text-[10px] tracking-hud-mid text-slate-200">{k}</div>
                <div className="text-[12.5px] text-slate-400">{v}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ================================================================== */
/*  03 // Data products — file inspector                               */
/* ================================================================== */

function drawCloudPreview(ctx, W, H) {
  const { rnd, fbm } = makeNoise(21);
  const gy = (x) => H * 0.68 - fbm(x * 0.006, 3.7) * H * 0.34;
  ctx.strokeStyle = "rgba(148,163,184,0.08)";
  ctx.lineWidth = 1;
  for (let k = 1; k < 5; k++) {
    ctx.beginPath();
    ctx.moveTo(0, (H / 5) * k);
    ctx.lineTo(W, (H / 5) * k);
    ctx.stroke();
  }
  const RAMP = ["#1d4a63", "#256579", "#2f8496", "#4db2c2", "#8ee3ee"];
  for (let x = 0; x < W; x += 2.2) {
    const y = gy(x);
    for (let k = 0; k < 3; k++) {
      const yy = y + (rnd() - 0.5) * 7;
      const lvl = Math.min(4, Math.max(0, Math.floor(((H * 0.75 - yy) / (H * 0.45)) * 5)));
      ctx.fillStyle = RAMP[lvl];
      ctx.globalAlpha = 0.75;
      ctx.fillRect(x + rnd() * 2, yy, 1.6, 1.6);
    }
  }
  ctx.globalAlpha = 0.55;
  for (let c = 0; c < 11; c++) {
    const cx = rnd() * W;
    if (cx > W * 0.6 && cx < W * 0.85) continue;
    const base = gy(cx);
    const ch = 28 + rnd() * 34;
    for (let p = 0; p < 46; p++) {
      const dx = (rnd() - 0.5) * 34;
      const dy = rnd() * ch;
      ctx.fillStyle = "#4ade80";
      ctx.fillRect(cx + dx, base - 6 - dy, 1.5, 1.5);
    }
  }
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "#bae6fd";
  const bx = W * 0.66;
  const bw = W * 0.16;
  const by = gy(bx + bw / 2);
  const bh = H * 0.2;
  for (let x = bx; x < bx + bw; x += 2.4) {
    ctx.fillRect(x + rnd(), by - bh + (rnd() - 0.5) * 2, 1.5, 1.5);
  }
  for (let y = by - bh; y < by; y += 2.4) {
    ctx.fillRect(bx + (rnd() - 0.5) * 2, y, 1.5, 1.5);
    ctx.fillRect(bx + bw + (rnd() - 0.5) * 2, y, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;
}

function drawContoursPreview(ctx, W, H) {
  const { fbm } = makeNoise(55);
  const centers = [
    [W * 0.36, H * 0.44, 1],
    [W * 0.74, H * 0.62, 0.7],
  ];
  for (const [cx, cy, m] of centers) {
    for (let k = 1; k <= 8; k++) {
      const r0 = k * 21 * m;
      const index = k % 4 === 0;
      ctx.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.05; a += 0.045) {
        const wob = 1 + 0.34 * (fbm(Math.cos(a) * 1.2 + k * 0.53, Math.sin(a) * 1.2 - k * 0.31) - 0.5);
        const r = r0 * wob;
        const x = cx + Math.cos(a) * r * 1.18;
        const y = cy + Math.sin(a) * r * 0.82;
        a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = index ? "rgba(34,211,238,0.5)" : "rgba(34,211,238,0.2)";
      ctx.lineWidth = index ? 1.4 : 1;
      ctx.stroke();
    }
  }
  ctx.strokeStyle = "rgba(226,232,240,0.5)";
  ctx.lineWidth = 1;
  for (const [x, y] of [[W * 0.36, H * 0.44], [W * 0.74, H * 0.62], [W * 0.14, H * 0.8]]) {
    ctx.beginPath();
    ctx.moveTo(x - 5, y);
    ctx.lineTo(x + 5, y);
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y + 5);
    ctx.stroke();
  }
}

function drawOrthoPreview(ctx, W, H) {
  const { rnd } = makeNoise(88);
  const GREENS = ["#2e4a2f", "#3b5c33", "#51683a", "#6b7444", "#7d7a4e", "#8b7b55", "#46543f"];
  let x = 0;
  while (x < W) {
    const w = 60 + rnd() * 120;
    let y = 0;
    while (y < H) {
      const h = 70 + rnd() * 110;
      ctx.fillStyle = GREENS[Math.floor(rnd() * GREENS.length)];
      ctx.fillRect(x, y, w + 1, h + 1);
      y += h;
    }
    x += w;
  }
  ctx.fillStyle = "#5d8a46";
  ctx.beginPath();
  ctx.arc(W * 0.72, H * 0.3, 56, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  for (let k = 0; k < 6; k++) {
    ctx.beginPath();
    ctx.moveTo(W * 0.72, H * 0.3);
    ctx.lineTo(W * 0.72 + Math.cos((k / 6) * Math.PI * 2) * 56, H * 0.3 + Math.sin((k / 6) * Math.PI * 2) * 56);
    ctx.stroke();
  }
  ctx.strokeStyle = "#57606c";
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(-10, H * 0.78);
  ctx.quadraticCurveTo(W * 0.5, H * 0.62, W + 10, H * 0.86);
  ctx.stroke();
  ctx.strokeStyle = "rgba(226,232,240,0.55)";
  ctx.lineWidth = 1;
  ctx.setLineDash([8, 10]);
  ctx.beginPath();
  ctx.moveTo(-10, H * 0.78);
  ctx.quadraticCurveTo(W * 0.5, H * 0.62, W + 10, H * 0.86);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = rnd() > 0.5 ? "#fff" : "#000";
    ctx.fillRect(rnd() * W, rnd() * H, 1.4, 1.4);
  }
  ctx.globalAlpha = 1;
}

function drawNdviPreview(ctx, W, H) {
  const { rnd, fbm } = makeNoise(132);
  const ramp = (v) => {
    if (v < 0.5) {
      const t = v / 0.5;
      return `rgb(${(166 + (232 - 166) * t) | 0},${(61 + (197 - 61) * t) | 0},${(47 + (71 - 47) * t) | 0})`;
    }
    const t = (v - 0.5) / 0.5;
    return `rgb(${(232 + (87 - 232) * t) | 0},${(197 + (196 - 197) * t) | 0},${(71 + (107 - 71) * t) | 0})`;
  };
  const cell = 7;
  for (let x = 0; x < W; x += cell) {
    for (let y = 0; y < H; y += cell) {
      const v = Math.min(1, Math.max(0, fbm(x * 0.012, y * 0.012) * 1.35 - 0.12));
      ctx.fillStyle = ramp(v);
      ctx.globalAlpha = 0.92;
      ctx.fillRect(x, y, cell, cell);
    }
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(3,6,9,0.65)";
  ctx.lineWidth = 2;
  for (const fx of [0.33, 0.62]) {
    ctx.beginPath();
    ctx.moveTo(W * fx + rnd() * 8, 0);
    ctx.lineTo(W * fx - rnd() * 8, H);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(0, H * 0.52);
  ctx.lineTo(W, H * 0.48);
  ctx.stroke();
}

function drawThermalPreview(ctx, W, H) {
  ctx.fillStyle = "#100a1c";
  ctx.fillRect(0, 0, W, H);
  const m = Math.min(W, H); /* proportional radii so the composition holds at card + panel sizes */
  const blob = (x, y, r, stops) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    for (const [o, c] of stops) g.addColorStop(o, c);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  blob(W * 0.3, H * 0.55, m * 0.475, [[0, "rgba(123,45,139,0.75)"], [1, "rgba(123,45,139,0)"]]);
  blob(W * 0.62, H * 0.4, m * 0.4, [[0, "rgba(232,93,47,0.6)"], [1, "rgba(232,93,47,0)"]]);
  blob(W * 0.62, H * 0.38, m * 0.13, [[0, "rgba(249,231,160,0.95)"], [0.5, "rgba(232,93,47,0.5)"], [1, "rgba(232,93,47,0)"]]);
  blob(W * 0.83, H * 0.72, m * 0.1, [[0, "rgba(249,231,160,0.8)"], [1, "rgba(232,93,47,0)"]]);
  ctx.strokeStyle = "rgba(226,232,240,0.25)";
  ctx.lineWidth = 1;
  ctx.strokeRect(W * 0.12, H * 0.18, W * 0.5, H * 0.62);
  ctx.strokeRect(W * 0.68, H * 0.24, W * 0.24, H * 0.56);
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  for (const [x, y] of [[W * 0.62, H * 0.38], [W * 0.83, H * 0.72]]) {
    ctx.strokeRect(x - 9, y - 9, 18, 18);
    ctx.beginPath();
    ctx.moveTo(x + 9, y - 9);
    ctx.lineTo(x + 26, y - 22);
    ctx.stroke();
  }
}

const PRODUCTS = [
  {
    id: "cloud",
    tab: "POINT CLOUD",
    file: "site_scan_2026-06.las",
    chips: ["LAS 1.4", "240 pts/m²", "NAD83 / STATE PLANE"],
    desc: "Classified point cloud — ground, vegetation, and structure separated, verified against ground control. Accuracy report attached to every delivery.",
    opens: "Civil 3D · ReCap · CloudCompare · Global Mapper",
    draw: drawCloudPreview,
  },
  {
    id: "contours",
    tab: "CONTOURS / DTM",
    file: "site_topo_0.5ft.dxf",
    chips: ["DXF / SHP", "0.5 FT INTERVAL", "BARE EARTH"],
    desc: "CAD-ready contours and a bare-earth terrain model generated from classified LiDAR returns. Drops straight into your existing drawing set.",
    opens: "AutoCAD · Civil 3D · MicroStation · QGIS",
    draw: drawContoursPreview,
  },
  {
    id: "ortho",
    tab: "ORTHOMOSAIC",
    file: "site_ortho_2cm.tif",
    chips: ["GEOTIFF", "2 cm/px GSD", "RGB"],
    desc: "True-color orthomosaic — every pixel georeferenced and measurable. The base layer for progress tracking, as-builts, and stakeholder updates.",
    opens: "QGIS · ArcGIS · Civil 3D · any web map",
    draw: drawOrthoPreview,
  },
  {
    id: "ndvi",
    tab: "NDVI / NDRE",
    file: "field_ndvi_2026-06.tif",
    chips: ["GEOTIFF", "CALIBRATED", "RX ZONES"],
    desc: "Radiometrically calibrated vegetation-index rasters with zoned prescription maps — comparable flight to flight, so you track change, not noise.",
    opens: "SMS · John Deere Ops · FieldView · QGIS",
    draw: drawNdviPreview,
  },
  {
    id: "thermal",
    tab: "THERMAL REPORT",
    file: "roof_thermal_report.pdf",
    chips: ["PDF + R-JPEG", "RADIOMETRIC", "ΔT TAGGED"],
    desc: "Anomaly report with every finding temperature-tagged, located on the orthomosaic, and ranked by severity. Raw radiometric imagery ships alongside.",
    opens: "Any PDF reader · FLIR Thermal Studio",
    draw: drawThermalPreview,
  },
];

function PreviewCanvas({ draw }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const render = () => {
      if (canvas.clientWidth < 2 || canvas.clientHeight < 2) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = (canvas.width = Math.floor(canvas.clientWidth * dpr));
      const H = (canvas.height = Math.floor(canvas.clientHeight * dpr));
      draw(canvas.getContext("2d"), W, H);
    };
    render();
    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);
  return <canvas ref={ref} className="h-full w-full" aria-hidden="true" />;
}

function DataProducts() {
  const [tab, setTab] = useState(0);
  const tabsRef = useRef(null);

  const onKey = (e) => {
    let next;
    if (e.key === "ArrowRight") next = (tab + 1) % PRODUCTS.length;
    else if (e.key === "ArrowLeft") next = (tab - 1 + PRODUCTS.length) % PRODUCTS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = PRODUCTS.length - 1;
    else return;
    e.preventDefault();
    setTab(next);
    tabsRef.current?.querySelectorAll("[role=tab]")[next]?.focus();
  };

  const p = PRODUCTS[tab];

  return (
    <section id="data" className="relative py-28">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHead
          index="03"
          label="Data Products"
          refTag="REF AD-2026-03"
          title={
            <>
              You don't buy a flight.{" "}
              <span className="text-slate-500">You buy the file.</span>
            </>
          }
          sub="Every mission ends as a deliverable your engineer, agronomist, or facility manager can open the same day. Select a product to inspect it."
        />

        <Reveal className="mt-12">
          <div
            ref={tabsRef}
            role="tablist"
            aria-label="Data products"
            onKeyDown={onKey}
            className="flex flex-wrap gap-2.5"
          >
            {PRODUCTS.map((pr, i) => (
              <button
                key={pr.id}
                role="tab"
                id={`ptab-${pr.id}`}
                aria-selected={tab === i}
                aria-controls={tab === i ? `panel-${pr.id}` : undefined}
                tabIndex={tab === i ? 0 : -1}
                onClick={() => setTab(i)}
                className={`rounded-md border px-4 py-2.5 font-mono text-[10px] tracking-hud-tight transition-all duration-300 ${
                  tab === i
                    ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-300"
                    : "border-white/10 text-slate-400 hover:border-white/25 hover:text-slate-200"
                }`}
              >
                {pr.tab}
              </button>
            ))}
          </div>

          <div
            role="tabpanel"
            id={`panel-${p.id}`}
            aria-labelledby={`ptab-${p.id}`}
            tabIndex={0}
            className="mt-5 grid gap-8 rounded-xl border border-white/10 bg-white/[0.02] p-5 sm:p-7 lg:grid-cols-[1.15fr_1fr]"
          >
            {/* file window */}
            <div className="overflow-hidden rounded-lg border border-white/[0.08]">
              <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#05090F] px-4 py-2.5">
                <span className="font-mono text-[11px] text-slate-300">{p.file}</span>
                <span aria-hidden="true" className="font-mono text-[9px] tracking-hud-mid text-cyan-400/80">
                  ● PREVIEW
                </span>
              </div>
              <div className="aspect-[16/10] bg-[#05090F]">
                <PreviewCanvas key={p.id} draw={p.draw} />
              </div>
            </div>

            <div className="flex flex-col justify-center">
              <div className="flex flex-wrap gap-2">
                {p.chips.map((c) => (
                  <span
                    key={c}
                    className="border border-cyan-400/25 px-2.5 py-1.5 font-mono text-[9.5px] tracking-hud-tight text-cyan-300"
                  >
                    {c}
                  </span>
                ))}
              </div>
              <p className="mt-5 text-[15px] leading-relaxed text-slate-400">{p.desc}</p>
              <p className="mt-5 font-mono text-[10px] uppercase tracking-hud-mid text-slate-400">
                OPENS IN <span aria-hidden="true" className="text-slate-600">//</span> {p.opens}
              </p>
            </div>
          </div>

          <p className="mt-6 text-sm text-slate-400">
            Already holding a scan from us?{" "}
            <a
              href="viewer.html"
              className="text-slate-200 underline decoration-cyan-400/50 underline-offset-4 transition-colors hover:text-cyan-300"
            >
              Open your .las / .laz file in the free Scan Viewer
            </a>{" "}
            — right in your browser, nothing to install.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ================================================================== */
/*  04 // Deployment sectors                                           */
/* ================================================================== */

const SECTORS = [
  {
    n: "04.1",
    name: "Construction & Earthworks",
    desc: "Weekly progress surveys, cut/fill volumes, and stockpile quantities to ±2%.",
    stat: "±2% VOLUMES",
  },
  {
    n: "04.2",
    name: "Surveying & Engineering",
    desc: "Topographic base maps and bare-earth DTMs delivered as CAD-ready contours.",
    stat: "0.5 FT CONTOURS",
  },
  {
    n: "04.3",
    name: "Agriculture",
    desc: "Variable-rate prescription maps from five-band imagery — field-wide in one flight.",
    stat: "5-BAND / 1 FLIGHT",
  },
  {
    n: "04.4",
    name: "Energy & Utilities",
    desc: "Corridor mapping, vegetation encroachment, and thermal fault detection on live assets.",
    stat: "ΔT TAGGED",
  },
  {
    n: "04.5",
    name: "Roofing & Facilities",
    desc: "Moisture intrusion and insulation loss mapped — no ladders, no shutdowns.",
    stat: "<50 mK",
  },
  {
    n: "04.6",
    name: "Public Safety & Environmental",
    desc: "Rapid post-storm damage assessment, erosion monitoring, and floodplain modeling.",
    stat: "<24 HR RESPONSE",
  },
];

function Sectors() {
  return (
    <section id="sectors" className="relative py-28">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-b from-transparent via-slate-900/35 to-transparent"
      />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHead index="04" label="Deployment Sectors" refTag="REF AD-2026-04" title="Where we fly." />

        <div className="mt-12 border-t border-white/[0.07]">
          {SECTORS.map((s, i) => (
            <Reveal key={s.n} delay={i * 60}>
              <div className="group border-b border-white/[0.07] px-2 py-6 transition-colors duration-300 hover:bg-white/[0.025]">
                <div className="flex flex-col gap-2 transition-transform duration-300 ease-out group-hover:translate-x-3 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0 md:flex-row md:items-baseline md:gap-8">
                  <span className="font-mono text-[11px] tracking-hud-mid text-slate-400 transition-colors group-hover:text-cyan-400">
                    {s.n}
                  </span>
                  <h3 className="font-display text-xl font-semibold tracking-tight text-slate-100 sm:text-2xl md:min-w-[280px]">
                    {s.name}
                  </h3>
                  <p className="flex-1 text-sm leading-relaxed text-slate-400">{s.desc}</p>
                  <span className="hidden items-center gap-3 md:flex">
                    <span className="font-mono text-[9.5px] tracking-hud-mid text-cyan-300/80">{s.stat}</span>
                    <ArrowUpRight
                      className="h-4 w-4 -translate-x-1 text-slate-600 opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:text-cyan-300 group-hover:opacity-100"
                      strokeWidth={1.75}
                    />
                  </span>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ================================================================== */
/*  05 // Field results                                                */
/*  NOTE: placeholder metrics — replace with real project data.        */
/* ================================================================== */

const RESULTS = [
  {
    log: "LOG-041 · EARTHWORKS",
    metric: "±1.8%",
    headline: "cut/fill variance",
    desc: "Verified against GNSS control on a 40-acre earthworks site — volumes the estimator could sign off on.",
  },
  {
    log: "LOG-057 · AGRICULTURE",
    metric: "3 wk",
    headline: "earlier stress detection",
    desc: "NDRE maps caught failing drip irrigation across 600 acres before any visible symptoms appeared.",
  },
  {
    log: "LOG-062 · SOLAR",
    metric: "37",
    headline: "failing strings located",
    desc: "One radiometric sweep of a 20 MW array — every anomaly temperature-tagged, zero downtime.",
  },
];

function FieldResults() {
  return (
    <section id="results" className="relative py-28">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHead index="05" label="Field Results" refTag="REF AD-2026-05" title="Numbers from the field." />

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {RESULTS.map((r, i) => (
            <Reveal key={r.log} delay={i * 110} className="h-full">
              <div className="flex h-full flex-col rounded-xl border border-white/10 bg-white/[0.025] p-7 transition-all duration-500 hover:-translate-y-1 hover:border-cyan-400/30">
                <span className="font-mono text-[9px] tracking-hud-mid text-slate-400">{r.log}</span>
                <div className="mt-5 font-mono text-4xl font-semibold text-cyan-300 tabular-nums">
                  {r.metric}
                </div>
                <div className="mt-1 font-mono text-[10.5px] uppercase tracking-hud-mid text-slate-400">
                  {r.headline}
                </div>
                <p className="mt-4 text-sm leading-relaxed text-slate-400">{r.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ================================================================== */
/*  06 // Flight request                                               */
/* ================================================================== */

const MAILTO_BRIEF =
  "mailto:ops@aerodata.io?subject=Flight%20Request&body=Site%20location%20(city%2C%20state)%3A%20%0AApprox.%20area%20(acres)%3A%20%0ASensor%20needed%20(LiDAR%20%2F%20multispectral%20%2F%20thermal%20%2F%20not%20sure)%3A%20%0ATimeline%3A%20";

function FinalCTA() {
  const [copied, setCopied] = useState(false);
  const copyEmail = () => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText("ops@aerodata.io")
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
        .catch(() => {});
    }
  };

  return (
    <section id="contact" className="relative py-28">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <Reveal>
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-[#0A121C] to-[#050A12]">
            {/* map grid */}
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.05)_1px,transparent_1px)] [background-size:44px_44px]"
            />
            <div className="relative grid gap-10 p-8 sm:p-14 lg:grid-cols-[1.2fr_0.8fr] lg:gap-16">
              <div>
                <div className="flex items-center gap-5">
                  <span className="whitespace-nowrap font-mono text-[11px] font-medium uppercase tracking-hud-wide text-cyan-400">
                    06 <span aria-hidden="true" className="text-slate-600">//</span> Flight Request
                  </span>
                  <span className="h-px flex-1 bg-gradient-to-r from-slate-700/70 to-transparent" />
                  <span aria-hidden="true" className="hidden whitespace-nowrap font-mono text-[9.5px] tracking-hud-mid text-slate-500 sm:block">
                    REF AD-2026-06
                  </span>
                </div>
                <h2 className="mt-7 max-w-xl font-display text-3xl font-semibold tracking-tight sm:text-4xl lg:text-[2.9rem] lg:leading-[1.08]">
                  Put a sensor over your site.
                </h2>
                <p className="mt-5 max-w-lg text-slate-400">
                  Request the flight — you're buying the file. Tell us about
                  the site and you'll hear from us within 24 hours, with a
                  scoped quote and sample deliverables from comparable
                  missions.
                </p>
                <div className="mt-9 flex flex-col items-start gap-4">
                  <a
                    href={MAILTO_BRIEF}
                    className="group inline-flex items-center gap-2 rounded-lg bg-amber-400 px-8 py-4 font-mono text-[13px] font-semibold uppercase tracking-hud-tight text-[#231603] shadow-[0_0_32px_rgba(251,191,36,0.35)] transition-all hover:bg-amber-300 hover:shadow-[0_0_48px_rgba(251,191,36,0.5)]"
                  >
                    Request a Flight
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </a>
                  <p className="flex items-center gap-2 text-sm text-slate-400">
                    Or email{" "}
                    <a
                      href="mailto:ops@aerodata.io"
                      className="text-slate-200 underline decoration-cyan-400/50 underline-offset-4 transition-colors hover:text-cyan-300"
                    >
                      ops@aerodata.io
                    </a>{" "}
                    directly
                    <button
                      type="button"
                      onClick={copyEmail}
                      aria-label="Copy email address"
                      className="flex h-6 w-6 items-center justify-center rounded border border-white/10 text-slate-400 transition-colors hover:border-white/25 hover:text-cyan-300"
                    >
                      {copied ? (
                        <Check className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </button>
                  </p>
                </div>
                <p className="mt-9 font-mono text-[9.5px] uppercase tracking-hud-wide text-slate-400">
                  Response &lt; 24 hrs // Nationwide deployment // Fully insured
                </p>
              </div>

              {/* target panel */}
              <div aria-hidden="true" className="relative hidden min-h-[280px] rounded-xl border border-white/[0.08] bg-[#04080F]/60 lg:block">
                <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.06)_1px,transparent_1px)] [background-size:36px_36px]" />
                {/* radar rings */}
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                  <div className="absolute -inset-24 rounded-full border border-cyan-400/10" />
                  <div className="absolute -inset-16 rounded-full border border-cyan-400/15" />
                  <div className="absolute -inset-8 rounded-full border border-amber-400/25" />
                  <div className="relative flex flex-col items-center gap-2.5">
                    <span className="h-2 w-2 rounded-full bg-amber-400" />
                    <span className="whitespace-nowrap font-mono text-[9px] tracking-hud-wide text-amber-300">
                      YOUR SITE
                    </span>
                  </div>
                </div>
                <div className="absolute inset-x-0 bottom-0 flex justify-between border-t border-white/[0.06] px-4 py-2.5 font-mono text-[8.5px] tracking-hud-mid text-slate-500">
                  <span>GSD 2 cm/px</span>
                  <span>RTK FIX</span>
                  <span>WX GO</span>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ================================================================== */
/*  Footer                                                             */
/* ================================================================== */

function Footer() {
  return (
    <footer className="border-t border-white/5">
      <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-2">
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-400">
              Survey-grade drone intelligence. LiDAR, multispectral, and
              thermal data — flown, processed, and delivered with rigor.
            </p>
          </div>
          <div>
            <h3 className="font-mono text-[10px] uppercase tracking-hud-mid text-slate-400">
              Platform
            </h3>
            <ul className="mt-4 space-y-2.5 text-sm text-slate-400">
              <li><a href="#sensors" className="transition-colors hover:text-cyan-300">Sensor suite</a></li>
              <li><a href="#data" className="transition-colors hover:text-cyan-300">Data products</a></li>
              <li><a href="#results" className="transition-colors hover:text-cyan-300">Field results</a></li>
              <li><a href="viewer.html" className="transition-colors hover:text-cyan-300">Client scan viewer</a></li>
            </ul>
          </div>
          <div>
            <h3 className="font-mono text-[10px] uppercase tracking-hud-mid text-slate-400">
              Contact
            </h3>
            <ul className="mt-4 space-y-2.5 text-sm text-slate-400">
              <li>
                <a href="mailto:ops@aerodata.io" className="flex items-center gap-2 transition-colors hover:text-cyan-300">
                  <Mail className="h-3.5 w-3.5" /> ops@aerodata.io
                </a>
              </li>
              <li className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5" /> Nationwide deployment
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-white/5 pt-6 font-mono text-[10px] uppercase tracking-hud-mid text-slate-400 sm:flex-row">
          <span>© 2026 AeroData</span>
          <span aria-hidden="true">39.8283° N&nbsp;&nbsp;98.5795° W</span>
          <span>FAA Part 107 · $2M Insured · RTK/PPK</span>
        </div>
      </div>
    </footer>
  );
}

/* ================================================================== */
/*  App                                                                */
/* ================================================================== */

export default function App() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-[#030609] font-sans text-slate-100">
      <HudFrame />
      <Navbar />
      <main>
        <Hero />
        <Ticker />
        <StatsBand />
        <SensorSuite />
        <MissionFlow />
        <DataProducts />
        <Sectors />
        <FieldResults />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
