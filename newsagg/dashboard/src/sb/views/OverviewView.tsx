import { useEffect, useMemo, useRef } from "react";
import { useStore, useT } from "../../store";
import { buildFocus, companyMap, noDataSet, sectorLabel } from "../pipeline";

// The landing page: a live, interactive "strong-buy universe" globe (every
// strong-buy name orbits as a glowing node, sized by today's move) sitting on
// top of a per-sector leaderboard where every name is reachable by scrolling.

interface Mover {
  ticker: string;
  company: string;
  sector: string;
  changePct: number;
  onFocus: boolean;
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

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ── The rotating globe ──────────────────────────────────────────────────────
function StrongBuyGlobe({
  movers,
  onPick,
}: {
  movers: Mover[];
  onPick: (t: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // mutable render/interaction state (kept off React to avoid re-renders)
  const st = useRef({
    yaw: 0,
    dragging: false,
    moved: false,
    lastX: 0,
    hover: -1,
    projected: [] as { x: number; y: number; r: number; i: number }[],
  });

  // stable lat/lon per ticker so a name always sits in the same place
  const pts = useMemo(
    () =>
      movers.slice(0, 150).map((m) => {
        const u = (hash(m.ticker) % 997) / 997;
        const v = (hash(m.ticker + "^") % 991) / 991;
        return { ...m, lat: Math.asin(2 * u - 1), lon: v * Math.PI * 2 };
      }),
    [movers],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const tilt = -0.34; // slight pitch so the poles show

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // the handful of names we ever label (biggest movers), to keep it uncluttered
    const topSet = new Set(
      [...pts]
        .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
        .slice(0, 6)
        .map((p) => pts.indexOf(p)),
    );

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

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(now - last, 50);
      last = now;
      const s = st.current;
      if (!s.dragging) s.yaw += 0.0022 * (dt / 16.7);

      const W = canvas.width,
        H = canvas.height;
      const cx = W / 2,
        cy = H / 2;
      const R = Math.min(W, H) * 0.4;
      ctx.clearRect(0, 0, W, H);

      // atmosphere
      const glow = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.6);
      glow.addColorStop(0, "rgba(61,214,196,0.12)");
      glow.addColorStop(0.55, "rgba(61,214,196,0.03)");
      glow.addColorStop(1, "rgba(61,214,196,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      // wireframe — latitudes
      ctx.lineWidth = dpr;
      for (let li = -2; li <= 2; li++) {
        const lat = (li * Math.PI) / 6;
        ctx.beginPath();
        for (let a = 0; a <= 72; a++) {
          const p = rot(lat, (a / 72) * Math.PI * 2, s.yaw);
          const sx = cx + p.x * R,
            sy = cy - p.y * R;
          a === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
        }
        ctx.strokeStyle = "rgba(125,155,180,0.10)";
        ctx.stroke();
      }
      // wireframe — meridians
      for (let mi = 0; mi < 12; mi++) {
        const lon = (mi * Math.PI) / 6;
        ctx.beginPath();
        for (let a = 0; a <= 72; a++) {
          const p = rot(-Math.PI / 2 + (a / 72) * Math.PI, lon, s.yaw);
          const sx = cx + p.x * R,
            sy = cy - p.y * R;
          a === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
        }
        ctx.strokeStyle = "rgba(125,155,180,0.07)";
        ctx.stroke();
      }
      // rim
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(125,155,180,0.20)";
      ctx.lineWidth = dpr * 1.1;
      ctx.stroke();

      // nodes — draw back-to-front for correct occlusion
      const proj = pts
        .map((p, i) => ({ i, ...rot(p.lat, p.lon, s.yaw) }))
        .sort((a, b) => a.z - b.z);
      s.projected = [];
      const labels: { x: number; y: number; text: string; up: boolean }[] = [];
      for (const q of proj) {
        const p = pts[q.i];
        const sx = cx + q.x * R,
          sy = cy - q.y * R;
        const persp = 0.55 + ((q.z + 1) / 2) * 0.7;
        const mag = Math.min(Math.abs(p.changePct) / 8, 1);
        const rad = (2.2 + mag * 4.6) * persp * dpr;
        const up = p.changePct >= 0;
        const front = q.z > 0;
        const a = front ? 1 : 0.25;
        const col = up ? "61,214,196" : "232,120,120";
        const hovered = s.hover === q.i;
        ctx.beginPath();
        ctx.arc(sx, sy, hovered ? rad * 1.5 : rad, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${col},${(hovered ? 1 : 0.9) * a})`;
        ctx.shadowBlur = (8 + mag * 16) * persp;
        ctx.shadowColor = `rgba(${col},${a})`;
        ctx.fill();
        ctx.shadowBlur = 0;
        if (hovered) {
          ctx.beginPath();
          ctx.arc(sx, sy, rad * 1.5 + 3 * dpr, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${col},0.9)`;
          ctx.lineWidth = dpr;
          ctx.stroke();
        }
        if (front) {
          s.projected.push({ x: sx / dpr, y: sy / dpr, r: Math.max(rad / dpr, 7), i: q.i });
          if (hovered || (topSet.has(q.i) && q.z > 0.2))
            labels.push({ x: sx, y: sy - rad - 4 * dpr, text: p.ticker, up });
        }
      }
      // labels last so they sit above nodes
      ctx.font = `600 ${11 * dpr}px ui-monospace, SFMono-Regular, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      for (const l of labels) {
        ctx.fillStyle = "rgba(6,10,16,0.7)";
        const w = ctx.measureText(l.text).width + 8 * dpr;
        ctx.fillRect(l.x - w / 2, l.y - 13 * dpr, w, 14 * dpr);
        ctx.fillStyle = l.up ? "rgba(120,235,215,1)" : "rgba(240,150,150,1)";
        ctx.fillText(l.text, l.x, l.y);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [pts]);

  // ── pointer interaction ──
  const hitTest = (x: number, y: number) => {
    let best = -1,
      bd = Infinity;
    for (const p of st.current.projected) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < p.r + 6 && d < bd) {
        bd = d;
        best = p.i;
      }
    }
    return best;
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
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    if (s.dragging) {
      const dx = e.clientX - s.lastX;
      if (Math.abs(dx) > 2) s.moved = true;
      s.yaw += dx * 0.008;
      s.lastX = e.clientX;
    } else {
      s.hover = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      (e.target as HTMLElement).style.cursor = s.hover >= 0 ? "pointer" : "grab";
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const s = st.current;
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    if (s.dragging && !s.moved) {
      const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      if (hit >= 0) onPick(pts[hit].ticker);
    }
    s.dragging = false;
  };
  const onLeave = () => {
    st.current.hover = -1;
    st.current.dragging = false;
  };

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={onLeave}
      className="h-full w-full touch-none select-none"
      style={{ cursor: "grab" }}
    />
  );
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
        top ? "bg-white/[0.03] ring-1 ring-inset" : ""
      }`}
      style={top ? { boxShadow: `inset 0 0 0 1px ${color}44` } : undefined}
    >
      <span
        className="grid h-5 w-5 flex-none place-items-center rounded font-mono text-[10px] font-semibold"
        style={{
          background: top ? color : "transparent",
          color: top ? "#08131a" : "#7b8da0",
        }}
      >
        {rank}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-[13px] font-semibold text-text">{m.ticker}</span>
          {m.onFocus && <span className="text-[10px] text-gold" title={lang === "zh" ? "在重点名单" : "on Focus List"}>★</span>}
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
      out.push({
        ticker,
        company: cmap.get(ticker) ?? "",
        sector: sectors?.[ticker]?.sector ?? "",
        changePct: tt.change_pct ?? 0,
        onFocus: focusSet.has(ticker),
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

  return (
    <div className="view-in space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="flex items-center gap-2.5 font-disp text-[22px] font-semibold tracking-tight">
          {t("Strong-Buy Leaderboard", "强力买入榜")}
          <span className="rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 font-mono text-[12px] font-semibold text-gold">
            {movers.length}
          </span>
        </h1>
        <span className="font-mono text-[11px] text-muted2">
          {t("ranked by today's move · grouped by sector · click to open", "按当日涨跌排名 · 按板块分组 · 点击查看")}
        </span>
      </div>

      {/* GLOBE HERO */}
      <div className="relative overflow-hidden rounded-2xl border border-line bg-panel2">
        <div className="pointer-events-none absolute left-5 top-4 z-[1]">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-signal">
            {t("Strong-Buy Universe", "强力买入星图")}
          </div>
          <div className="mt-1 text-[12px] text-muted2">
            {t(
              `${movers.length} names in orbit · drag to spin · click a node`,
              `${movers.length} 只在轨 · 拖动旋转 · 点击节点`,
            )}
          </div>
        </div>
        <div className="pointer-events-none absolute right-5 top-4 z-[1] flex items-center gap-3 font-mono text-[10.5px] text-muted2">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "#3dd6c4", boxShadow: "0 0 8px #3dd6c4" }} /> {t("up", "涨")}</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "#e88", boxShadow: "0 0 8px #e88" }} /> {t("down", "跌")}</span>
          <span>{t("size = today's move", "大小 = 当日幅度")}</span>
        </div>
        <div className="h-[380px] w-full">
          {movers.length > 0 ? (
            <StrongBuyGlobe movers={movers} onPick={openDetail} />
          ) : (
            <div className="grid h-full place-items-center text-[13px] text-muted">
              {t("No strong-buy names yet — run the technical job.", "暂无强力买入标的 — 先跑技术数据。")}
            </div>
          )}
        </div>
      </div>

      {/* SECTOR LEADERBOARD GRID — every name reachable by scrolling inside a card */}
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
              <div className="max-h-[340px] overflow-y-auto p-1.5">
                {rows.map((m, i) => (
                  <MoverRow
                    key={m.ticker}
                    rank={i + 1}
                    m={m}
                    max={max}
                    color={color}
                    lang={lang}
                    onClick={() => openDetail(m.ticker)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
