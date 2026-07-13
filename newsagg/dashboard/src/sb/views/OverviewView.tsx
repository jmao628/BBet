import { memo, useMemo, useState } from "react";
import { useStore, useT } from "../../store";
import { buildFocus, companyMap, noDataSet, belowMinCap, sectorLabel } from "../pipeline";

// Landing page: one "Ignition Strip" per sector — a single move-% axis showing
// ONLY what's firing: breakouts, new 52-week highs, and the sector's top movers,
// each a glowing, labelled node placed by today's move (size = attention,
// pulsing halo = breakout). No distribution clutter. Hover pins a card; click
// opens. The full ranked list sits directly below each strip.

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
// ── Ignition Strip — only what's firing ──────────────────────────────────────
// A single move-% axis showing ONLY the names worth the eye: breakouts, new
// 52-week highs, and the sector's top movers — each a glowing, labelled node
// placed by today's move. No distribution clutter; strong visuals on a few
// signals instead of a faint blob of every name.
const X_MIN = -3,
  X_MAX = 8; // move % domain (clamped)
function xPct(move: number): number {
  const c = Math.max(X_MIN, Math.min(X_MAX, move));
  return 8 + ((c - X_MIN) / (X_MAX - X_MIN)) * 84; // 8%..92%
}
function dotR(m: Mover): number {
  return 5 + Math.min(m.attnScore / 100, 1) * 5; // 5..10px by attention
}

const SectorStrip = memo(function SectorStrip({
  rows,
  color,
  focusSpot,
  onPick,
  lang,
}: {
  rows: Mover[];
  color: string;
  focusSpot: boolean;
  onPick: (t: string) => void;
  lang: "en" | "zh";
}) {
  const [hover, setHover] = useState(-1);
  const rgb = hexToRgb(color);
  const BASE = 76; // axis baseline (% from top)
  const DOT_TOP = 50; // node dots sit here

  // Featured = igniters (breakout / new 52w high); topped up with the strongest
  // movers so a quiet sector still shows its leaders. Capped for breathing room.
  const nodes = useMemo(() => {
    const byMove = rows
      .map((_, i) => i)
      .sort((a, b) => rows[b].changePct - rows[a].changePct);
    const set = new Set<number>();
    for (const i of byMove) {
      if (set.size >= 6) break;
      if (rows[i].breakout || rows[i].newHigh) set.add(i);
    }
    for (const i of byMove) {
      if (set.size >= 3) break;
      set.add(i);
    }
    const idx = [...set].sort((a, b) => rows[a].changePct - rows[b].changePct);
    // label anti-overlap
    const labels: number[] = [];
    const GAP = 14;
    return idx.map((i) => {
      const x = xPct(rows[i].changePct);
      let lx = x;
      const last = labels.length ? labels[labels.length - 1] : -100;
      if (lx - last < GAP) lx = last + GAP;
      lx = Math.min(lx, 93);
      labels.push(lx);
      return { i, x, lx };
    });
  }, [rows]);

  const zeroLeft = xPct(0);
  const hv = hover >= 0 ? rows[hover] : null;

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* axis baseline + 0 marker */}
      <div className="pointer-events-none absolute w-px bg-white/10" style={{ left: `${zeroLeft}%`, top: `${DOT_TOP}%`, bottom: "18%" }} />
      <div className="pointer-events-none absolute inset-x-3 h-px" style={{ top: `${BASE}%`, background: `linear-gradient(90deg, transparent, rgba(${rgb},0.25), transparent)` }} />
      <span className="pointer-events-none absolute font-mono text-[8px] text-muted2/70" style={{ left: `${zeroLeft}%`, top: `${BASE + 4}%`, transform: "translateX(-50%)" }}>
        0
      </span>
      <span className="pointer-events-none absolute bottom-1 right-2 font-mono text-[8.5px] uppercase tracking-[0.14em] text-muted2/60">move % →</span>

      {nodes.map(({ i, x, lx }, k) => {
        const m = rows[i];
        const r = dotR(m);
        const isHover = hover === i;
        const dim = focusSpot && !m.onFocus ? 0.22 : 1;
        const up = m.changePct >= 0;
        return (
          <div key={m.ticker} className="ignite-in" style={{ opacity: dim, animationDelay: `${Math.min(k * 70, 400)}ms` }}>
            {/* connector from the axis up to the node */}
            <div
              className="pointer-events-none absolute w-px"
              style={{ left: `${x}%`, top: `${DOT_TOP}%`, height: `${BASE - DOT_TOP}%`, background: `linear-gradient(180deg, rgba(${rgb},0.7), rgba(${rgb},0.05))` }}
            />
            {/* label — ticker (display font) + today's move */}
            <div className="pointer-events-none absolute -translate-x-1/2 text-center leading-none" style={{ left: `${lx}%`, top: "12%" }}>
              <div className="font-disp text-[11px] font-bold tracking-wide" style={{ color: `rgb(${rgb})`, textShadow: `0 0 8px rgba(${rgb},0.55)` }}>
                {m.ticker}
              </div>
              <div className="mt-0.5 font-mono text-[8.5px] font-semibold" style={{ color: up ? "#48c78e" : "#ff6b6b" }}>
                {up ? "+" : ""}
                {m.changePct.toFixed(1)}%
              </div>
            </div>
            {/* pulsing halo for true igniters */}
            {m.breakout && (
              <span
                className="ignite-halo pointer-events-none absolute rounded-full"
                style={{ left: `${x}%`, top: `${DOT_TOP}%`, width: r * 2.4, height: r * 2.4, marginLeft: 0, marginTop: 0, background: `rgba(${rgb},0.9)` }}
              />
            )}
            {/* the node */}
            <button
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? -1 : h))}
              onClick={() => onPick(m.ticker)}
              className="absolute rounded-full transition-transform duration-150"
              style={{
                left: `${x}%`,
                top: `${DOT_TOP}%`,
                width: r * 2,
                height: r * 2,
                transform: isHover ? "translate(-50%,-50%) scale(1.5)" : "translate(-50%,-50%)",
                background: `radial-gradient(circle at 35% 30%, rgba(${rgb},1), rgba(${rgb},0.55))`,
                boxShadow: `0 0 12px rgba(${rgb},0.85)`,
                border: m.newHigh ? "1.5px solid rgba(255,255,255,0.95)" : `1px solid rgba(${rgb},1)`,
                zIndex: isHover ? 30 : 20,
                cursor: "pointer",
              }}
            />
          </div>
        );
      })}

      {hv && (
        <div className="pointer-events-none absolute inset-x-2 bottom-1.5 z-40 rounded-lg border border-line bg-ink/90 px-3 py-2 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="font-disp text-[13px] font-bold tracking-wide text-text">{hv.ticker}</span>
              <span className="truncate text-[11px] text-muted2">{hv.company}</span>
            </span>
            <span className={`font-mono text-[13px] font-semibold ${hv.changePct >= 0 ? "text-ok" : "text-bad"}`}>
              {hv.changePct >= 0 ? "+" : ""}
              {hv.changePct.toFixed(2)}%
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10.5px] text-muted2">
            <span>RVOL {hv.rvol != null ? `${hv.rvol.toFixed(1)}×` : "—"}</span>
            <span>attn {Math.round(hv.attnScore)}</span>
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

  const [focusSpot, setFocusSpot] = useState(false);

  const focusSet = useMemo(() => {
    const f = buildFocus(data, heat, technical, marketCaps, sectors, supplychain);
    return new Set(f.map((x) => x.ticker));
  }, [data, heat, technical, marketCaps, sectors, supplychain]);

  // Unrated small-caps (< $2B with only a text list "BUY", no quant, no analyst
  // — e.g. the $195M penny stock PERF) are kept off the leaderboard, matching
  // the rest of the funnel.
  const tiny = useMemo(() => belowMinCap(data, marketCaps), [data, marketCaps]);

  const movers = useMemo<Mover[]>(() => {
    const noData = noDataSet(technical);
    const cmap = companyMap(data);
    const out: Mover[] = [];
    for (const [ticker, tt] of Object.entries(technical?.tickers ?? {})) {
      if (noData.has(ticker)) continue;
      if (tt.gauge?.summary !== "strong_buy") continue;
      if (tiny.has(ticker)) continue;
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
  }, [technical, data, sectors, focusSet, tiny]);

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
            {t("live · one ignition strip per sector · ranked by today's move", "实时 · 每板块一条点火轴 · 按当日涨跌排名")}
          </p>
        </div>

        {/* controls */}
        <div className="flex flex-wrap items-center gap-2.5">
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
        <span className="font-medium text-muted">
          {t(
            "Each strip = one sector. Only the names FIRING today are plotted — placed left→right by today's move %.",
            "每条 = 一个板块。只画今天在「点火」的票 —— 按当日涨跌 % 从左到右排。",
          )}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#3dd6c4", boxShadow: "0 0 7px #3dd6c4" }} /> {t("breakout (pulsing)", "突破(脉动)")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full ring-[1.5px] ring-white/80" /> 52w {t("high", "新高")}
        </span>
        <span>{t("dot size = attention · hover to inspect · click to open", "点大小 = 注意力 · 悬停查看 · 点击进入")}</span>
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
                <div className="relative h-[132px] w-full border-b border-line/60">
                  <SectorStrip rows={rows} color={color} focusSpot={focusSpot} onPick={openDetail} lang={lang} />
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
