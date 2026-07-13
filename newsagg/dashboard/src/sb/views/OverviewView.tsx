import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useStore, useT } from "../../store";
import { buildFocus, companyMap, noDataSet, sectorLabel } from "../pipeline";

// Landing page: one interactive globe PER sector. Each node is a strong-buy name;
// size encodes a switchable signal (move / attention / rvol), rings flag Focus-
// List / new-high / breakout, hovering pins a detail card and pauses the spin,
// clicking opens the ticker. All globes share one rAF loop and pause off-screen.

type SizeKey = "move" | "attn" | "rvol";

interface Mover {
  ticker: string;
  company: string;
  sector: string;
  changePct: number;
  onFocus: boolean;
  attnScore: number;
  rvol: number | null;
  buyStreak: number;
  newHigh: boolean;
  breakout: boolean;
  obvUp: boolean;
}

const SECTOR_COLOR: Record<string, string> = {
  Technology: "#5fb0e8",
  "Financial Services": "#e9c46a",
  "Consumer Cyclical": "#e879a6",
  Healthcare: "#48c78e",
  Energy: "#f4a261",
  "Consumer Defensive": "#3dd6c4",
  Industrials: "#9b8cf0",
  "Basic Materials": "#c98a5e",
  "Communication Services": "#6ee7d6",
  Utilities: "#7fa8c9",
  "Real Estate": "#d4a373",
};
const secColor = (s: string) => SECTOR_COLOR[s] ?? "#8aa0b4";
function hexToRgb(h: string): string {
  const n = parseInt(h.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function magOf(m: Mover, key: SizeKey): number {
  if (key === "attn") return Math.min(m.attnScore / 100, 1);
  if (key === "rvol") return Math.min((m.rvol ?? 0) / 4, 1);
  return Math.min(Math.abs(m.changePct) / 8, 1);
}

// ── Shared render loop — one rAF drives every on-screen globe ────────────────
const _globes = new Set<(now: number) => void>();
let _raf = 0;
function _loop(now: number) {
  _globes.forEach((fn) => fn(now));
  _raf = requestAnimationFrame(_loop);
}
function registerGlobe(fn: (now: number) => void) {
  _globes.add(fn);
  if (!_raf) _raf = requestAnimationFrame(_loop);
  return () => {
    _globes.delete(fn);
    if (_globes.size === 0) {
      cancelAnimationFrame(_raf);
      _raf = 0;
    }
  };
}

// Pre-rendered radial glow sprite per colour — blitted instead of shadowBlur.
const _sprite = new Map<string, HTMLCanvasElement>();
function glowSprite(rgb: string): HTMLCanvasElement {
  const cached = _sprite.get(rgb);
  if (cached) return cached;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `rgba(${rgb},1)`);
  grad.addColorStop(0.18, `rgba(${rgb},0.9)`);
  grad.addColorStop(0.5, `rgba(${rgb},0.22)`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  _sprite.set(rgb, c);
  return c;
}

interface Proj {
  x: number;
  y: number;
  r: number;
  i: number;
  cx: number;
  cy: number;
  front: boolean;
}

const SectorGlobe = memo(function SectorGlobe({
  rows,
  color,
  sizeKey,
  focusSpot,
  onPick,
  lang,
}: {
  rows: Mover[];
  color: string;
  sizeKey: SizeKey;
  focusSpot: boolean;
  onPick: (t: string) => void;
  lang: "en" | "zh";
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState(-1);
  const st = useRef({
    yaw: 0,
    dragging: false,
    moved: false,
    paused: false,
    lastX: 0,
    hover: -1,
    last: 0,
    active: true,
    sizeKey,
    focusSpot,
    projected: [] as Proj[],
    grad: null as CanvasGradient | null,
    gradW: 0,
    gradH: 0,
  });
  st.current.sizeKey = sizeKey;
  st.current.focusSpot = focusSpot;

  const pts = useMemo(
    () =>
      rows.slice(0, 90).map((m) => {
        const u = (hash(m.ticker) % 997) / 997;
        const v = (hash(m.ticker + "^") % 991) / 991;
        return { ...m, lat: Math.asin(2 * u - 1), lon: v * Math.PI * 2 };
      }),
    [rows],
  );
  const ptsRef = useRef(pts);
  ptsRef.current = pts;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rgb = hexToRgb(color);
    const sprite = glowSprite(rgb);
    const gold = "233,196,106";
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const tilt = -0.34;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      st.current.grad = null;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => (st.current.active = e.isIntersecting), {
      rootMargin: "150px",
    });
    io.observe(canvas);

    const rot = (lat: number, lon: number, yaw: number) => {
      const l = lon + yaw;
      const x = Math.cos(lat) * Math.sin(l);
      const y0 = Math.sin(lat);
      const z0 = Math.cos(lat) * Math.cos(l);
      return {
        x,
        y: y0 * Math.cos(tilt) - z0 * Math.sin(tilt),
        z: y0 * Math.sin(tilt) + z0 * Math.cos(tilt),
      };
    };

    const render = (now: number) => {
      const s = st.current;
      if (!s.active) {
        s.last = now;
        return;
      }
      const dt = Math.min(now - s.last, 50);
      s.last = now;
      if (!s.dragging && !s.paused) s.yaw += 0.0016 * (dt / 16.7);
      const pulse = 0.5 + 0.5 * Math.sin(now / 380);

      const W = canvas.width,
        H = canvas.height;
      const cx = W / 2,
        cy = H / 2;
      const R = Math.min(W, H) * 0.42;
      ctx.clearRect(0, 0, W, H);

      if (!s.grad || s.gradW !== W || s.gradH !== H) {
        const g = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.7);
        g.addColorStop(0, `rgba(${rgb},0.12)`);
        g.addColorStop(0.55, `rgba(${rgb},0.03)`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        s.grad = g;
        s.gradW = W;
        s.gradH = H;
      }
      ctx.fillStyle = s.grad;
      ctx.fillRect(0, 0, W, H);

      // wireframe
      ctx.lineWidth = dpr;
      for (let li = -2; li <= 2; li++) {
        const lat = (li * Math.PI) / 6;
        ctx.beginPath();
        for (let a = 0; a <= 48; a++) {
          const p = rot(lat, (a / 48) * Math.PI * 2, s.yaw);
          const sx = cx + p.x * R,
            sy = cy - p.y * R;
          a === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
        }
        ctx.strokeStyle = `rgba(${rgb},0.09)`;
        ctx.stroke();
      }
      for (let mi = 0; mi < 9; mi++) {
        const lon = (mi * Math.PI) / 9;
        ctx.beginPath();
        for (let a = 0; a <= 48; a++) {
          const p = rot(-Math.PI / 2 + (a / 48) * Math.PI, lon, s.yaw);
          const sx = cx + p.x * R,
            sy = cy - p.y * R;
          a === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
        }
        ctx.strokeStyle = `rgba(${rgb},0.055)`;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${rgb},0.18)`;
      ctx.lineWidth = dpr * 1.1;
      ctx.stroke();

      // node glows (additive)
      const nodes = ptsRef.current;
      const proj = nodes
        .map((p, i) => ({ i, ...rot(p.lat, p.lon, s.yaw) }))
        .sort((a, b) => a.z - b.z);
      s.projected = [];
      ctx.globalCompositeOperation = "lighter";
      for (const q of proj) {
        const p = nodes[q.i];
        const sx = cx + q.x * R,
          sy = cy - q.y * R;
        const persp = 0.55 + ((q.z + 1) / 2) * 0.7;
        const mag = magOf(p, s.sizeKey);
        const rad = (5.5 + mag * 10) * persp * dpr * (s.hover === q.i ? 1.4 : 1);
        const front = q.z > 0;
        const dim = s.focusSpot && !p.onFocus ? 0.16 : 1;
        ctx.globalAlpha = Math.min((front ? 1 : 0.3) * (0.62 + mag * 0.38) * dim, 1);
        ctx.drawImage(sprite, sx - rad, sy - rad, rad * 2, rad * 2);
        s.projected.push({ x: sx / dpr, y: sy / dpr, r: Math.max(rad / dpr, 9), i: q.i, cx: sx, cy: sy, front });
      }
      // signal rings (crisp, on top)
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      for (const pr of s.projected) {
        if (!pr.front) continue;
        const p = nodes[pr.i];
        const dim = s.focusSpot && !p.onFocus ? 0.16 : 1;
        if (dim < 1) continue;
        const base = pr.r * dpr;
        if (p.breakout) {
          ctx.beginPath();
          ctx.arc(pr.cx, pr.cy, base + (3 + pulse * 4) * dpr, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${rgb},${0.35 + pulse * 0.4})`;
          ctx.lineWidth = 1.4 * dpr;
          ctx.stroke();
        }
        if (p.onFocus) {
          ctx.beginPath();
          ctx.arc(pr.cx, pr.cy, base + 2 * dpr, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${gold},0.95)`;
          ctx.lineWidth = 1.6 * dpr;
          ctx.stroke();
        }
        if (p.newHigh) {
          ctx.beginPath();
          ctx.arc(pr.cx, pr.cy, base + 5 * dpr, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(235,245,250,0.75)";
          ctx.lineWidth = 1 * dpr;
          ctx.stroke();
        }
      }
      // hover ring
      if (s.hover >= 0) {
        const hp = s.projected.find((p) => p.i === s.hover && p.front);
        if (hp) {
          ctx.beginPath();
          ctx.arc(hp.cx, hp.cy, hp.r * dpr + 6 * dpr, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${rgb},0.9)`;
          ctx.lineWidth = 1.4 * dpr;
          ctx.stroke();
        }
      }
    };

    const unregister = registerGlobe(render);
    return () => {
      unregister();
      ro.disconnect();
      io.disconnect();
    };
  }, [color]);

  const hitTest = (x: number, y: number) => {
    let best = -1,
      bd = Infinity;
    for (const p of st.current.projected) {
      if (!p.front) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < p.r + 5 && d < bd) {
        bd = d;
        best = p.i;
      }
    }
    return best;
  };
  const setHov = (i: number) => {
    if (st.current.hover === i) return;
    st.current.hover = i;
    st.current.paused = i >= 0;
    setHover(i);
  };
  const onDown = (e: React.PointerEvent) => {
    const s = st.current;
    s.dragging = true;
    s.moved = false;
    s.lastX = e.clientX;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const s = st.current;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (s.dragging) {
      const dx = e.clientX - s.lastX;
      if (Math.abs(dx) > 2) s.moved = true;
      s.yaw += dx * 0.008;
      s.lastX = e.clientX;
    } else {
      const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      setHov(hit);
      (e.currentTarget as HTMLElement).style.cursor = hit >= 0 ? "pointer" : "grab";
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const s = st.current;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (s.dragging && !s.moved) {
      const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      if (hit >= 0) onPick(pts[hit].ticker);
    }
    s.dragging = false;
  };
  const onLeave = () => {
    st.current.dragging = false;
    setHov(-1);
  };

  const hv = hover >= 0 ? pts[hover] : null;

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onLeave}
        className="h-full w-full touch-none select-none"
        style={{ cursor: "grab" }}
      />
      {hv && (
        <div className="pointer-events-none absolute inset-x-2 bottom-2 rounded-lg border border-line bg-ink/85 px-3 py-2 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="font-mono text-[13px] font-semibold text-text">{hv.ticker}</span>
              <span className="truncate text-[11px] text-muted2">{hv.company}</span>
            </span>
            <span className={`font-mono text-[13px] font-semibold ${hv.changePct >= 0 ? "text-ok" : "text-bad"}`}>
              {hv.changePct >= 0 ? "+" : ""}
              {hv.changePct.toFixed(2)}%
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10.5px] text-muted2">
            <span>{t2(lang, "Attn", "注意")} {Math.round(hv.attnScore)}</span>
            <span>RVOL {hv.rvol != null ? `${hv.rvol.toFixed(1)}×` : "—"}</span>
            <span>{hv.buyStreak}{t2(lang, "d streak", "天连买")}</span>
            {hv.onFocus && <span className="text-gold">★ {t2(lang, "Focus", "重点")}</span>}
            {hv.newHigh && <span className="text-signal">52w {t2(lang, "high", "新高")}</span>}
            {hv.breakout && <span className="text-ignite">{t2(lang, "breakout", "突破")}</span>}
            {hv.obvUp && <span className="text-ok">{t2(lang, "accum", "吸筹")}</span>}
          </div>
        </div>
      )}
    </div>
  );
});

function t2(lang: "en" | "zh", en: string, zh: string) {
  return lang === "zh" ? zh : en;
}

function MoverRow({
  rank,
  m,
  max,
  color,
  onClick,
  lang,
}: {
  rank: number;
  m: Mover;
  max: number;
  color: string;
  onClick: () => void;
  lang: "en" | "zh";
}) {
  const up = m.changePct >= 0;
  const top = rank === 1;
  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/[0.04] ${
        top ? "bg-white/[0.03]" : ""
      }`}
      style={top ? { boxShadow: `inset 0 0 0 1px ${color}44` } : undefined}
    >
      <span
        className="grid h-5 w-5 flex-none place-items-center rounded font-mono text-[10px] font-semibold"
        style={{ background: top ? color : "transparent", color: top ? "#08131a" : "#7b8da0" }}
      >
        {rank}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-[13px] font-semibold text-text">{m.ticker}</span>
          {m.onFocus && (
            <span className="text-[10px] text-gold" title={lang === "zh" ? "在重点名单" : "on Focus List"}>
              ★
            </span>
          )}
          {m.newHigh && <span className="text-[9px] text-signal" title="52-week high">52w</span>}
        </span>
        <span className="block truncate text-[11px] text-muted2">{m.company}</span>
      </span>
      <span className="flex flex-none items-center gap-2">
        <span className="h-1.5 w-14 overflow-hidden rounded-full bg-inset">
          <span
            className="block h-full rounded-full"
            style={{
              width: `${Math.max(6, (Math.abs(m.changePct) / max) * 100)}%`,
              background: up ? "linear-gradient(90deg,#2fae9e,#3dd6c4)" : "linear-gradient(90deg,#c96,#e88)",
            }}
          />
        </span>
        <span className={`w-16 text-right font-mono text-[12.5px] font-semibold ${up ? "text-ok" : "text-bad"}`}>
          {up ? "+" : ""}
          {m.changePct.toFixed(2)}%
        </span>
      </span>
    </button>
  );
}

export function OverviewView() {
  const data = useStore((s) => s.data);
  const heat = useStore((s) => s.heat);
  const technical = useStore((s) => s.technical);
  const sectors = useStore((s) => s.sectors);
  const supplychain = useStore((s) => s.supplychain);
  const marketCaps = useStore((s) => s.marketCaps);
  const openDetail = useStore((s) => s.openDetail);
  const lang = useStore((s) => s.lang);
  const t = useT();

  const [sizeKey, setSizeKey] = useState<SizeKey>("move");
  const [focusSpot, setFocusSpot] = useState(false);

  const focusSet = useMemo(() => {
    const f = buildFocus(data, heat, technical, marketCaps, sectors, supplychain);
    return new Set(f.map((x) => x.ticker));
  }, [data, heat, technical, marketCaps, sectors, supplychain]);

  const movers = useMemo<Mover[]>(() => {
    const noData = noDataSet(technical);
    const cmap = companyMap(data);
    const out: Mover[] = [];
    for (const [ticker, tt] of Object.entries(technical?.tickers ?? {})) {
      if (noData.has(ticker)) continue;
      if (tt.gauge?.summary !== "strong_buy") continue;
      const at = tt.attention;
      out.push({
        ticker,
        company: cmap.get(ticker) ?? "",
        sector: sectors?.[ticker]?.sector ?? "",
        changePct: tt.change_pct ?? 0,
        onFocus: focusSet.has(ticker),
        attnScore: at?.score ?? 0,
        rvol: at?.rvol ?? null,
        buyStreak: tt.buy_streak ?? 0,
        newHigh: !!at?.new_high_52w,
        breakout: at?.phase === "breakout" || at?.phase === "igniting",
        obvUp: !!at?.obv_up,
      });
    }
    return out.sort((a, b) => b.changePct - a.changePct);
  }, [technical, data, sectors, focusSet]);

  const bySector = useMemo(() => {
    const m = new Map<string, Mover[]>();
    for (const mv of movers) {
      const key = mv.sector || "Other";
      const arr = m.get(key);
      if (arr) arr.push(mv);
      else m.set(key, [mv]);
    }
    for (const arr of m.values()) arr.sort((a, b) => b.changePct - a.changePct);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [movers]);

  const focusCount = movers.filter((m) => m.onFocus).length;

  const SIZE_OPTS: { k: SizeKey; label: string }[] = [
    { k: "move", label: t("Move", "涨跌") },
    { k: "attn", label: t("Attention", "注意力") },
    { k: "rvol", label: t("RVOL", "放量") },
  ];

  return (
    <div className="view-in space-y-5">
      {/* HEADER */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 font-disp text-[23px] font-semibold tracking-tight">
            {t("Strong-Buy Leaderboard", "强力买入榜")}
            <span className="inline-flex items-center rounded-full border border-gold/30 bg-gold/[0.07] px-2.5 py-0.5">
              <span className="pill-sheen font-mono text-[13px] font-bold">{movers.length}</span>
            </span>
          </h1>
          <p className="caption-scan relative mt-1.5 flex w-fit items-center gap-2 text-[11.5px] text-muted2">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-ok" />
            </span>
            {t("live · ranked by today's move · one globe per sector", "实时 · 按当日涨跌排名 · 每个板块一颗星球")}
          </p>
        </div>

        {/* controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 rounded-xl border border-line bg-panel2/70 px-2 py-1.5">
            <span className="pl-1 text-[10.5px] uppercase tracking-wide text-muted2">{t("Size", "大小")}</span>
            <div className="flex overflow-hidden rounded-lg border border-line">
              {SIZE_OPTS.map((o) => (
                <button
                  key={o.k}
                  onClick={() => setSizeKey(o.k)}
                  className={`px-2.5 py-1 text-[11.5px] transition-colors ${
                    sizeKey === o.k ? "bg-signal/15 text-signal" : "text-muted hover:text-text"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => setFocusSpot((v) => !v)}
            className={`rounded-xl border px-3 py-2 text-[11.5px] transition-colors ${
              focusSpot ? "border-gold/50 bg-gold/10 text-gold" : "border-line bg-panel2/70 text-muted hover:text-text"
            }`}
            title={t("Spotlight Focus-List names", "只高亮重点名单")}
          >
            ★ {t("Focus", "重点")} {focusCount}
          </button>
        </div>
      </div>

      {/* legend */}
      <div className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-muted2">
        <span className="flex items-center gap-1.5">
          <span className="flex items-end gap-1">
            {[3, 5, 8].map((d, i) => (
              <span key={d} className="ramp-dot rounded-full bg-signal" style={{ width: d, height: d, animationDelay: `${i * 0.3}s` }} />
            ))}
          </span>
          {t("size = selected signal", "大小 = 所选信号")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full ring-2 ring-gold" /> ★ {t("on Focus List", "重点名单")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full ring-1 ring-white/70" /> 52w {t("high", "新高")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full ring-2 ring-ignite" /> {t("breakout", "突破")}
        </span>
        <span>{t("hover to inspect · click to open", "悬停查看 · 点击进入")}</span>
      </div>

      {movers.length === 0 ? (
        <div className="grid h-64 place-items-center rounded-2xl border border-line bg-panel2 text-[13px] text-muted">
          {t("No strong-buy names yet — run the technical job.", "暂无强力买入标的 — 先跑技术数据。")}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {bySector.map(([sec, rows]) => {
            const color = secColor(sec);
            const max = Math.max(...rows.map((r) => Math.abs(r.changePct)), 0.01);
            return (
              <div key={sec} className="flex flex-col overflow-hidden rounded-2xl border border-line bg-panel2">
                <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
                  <span className="flex items-center gap-2 text-[13px] font-semibold">
                    <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                    {sectorLabel(sec === "Other" ? undefined : sec, lang)}
                  </span>
                  <span className="font-mono text-[11px] text-muted2">{rows.length}</span>
                </header>
                <div className="relative h-[172px] w-full border-b border-line/60">
                  <SectorGlobe
                    rows={rows}
                    color={color}
                    sizeKey={sizeKey}
                    focusSpot={focusSpot}
                    onPick={openDetail}
                    lang={lang}
                  />
                </div>
                <div className="max-h-[300px] overflow-y-auto p-1.5">
                  {rows.map((m, i) => (
                    <MoverRow key={m.ticker} rank={i + 1} m={m} max={max} color={color} lang={lang} onClick={() => openDetail(m.ticker)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
