import { useEffect, useMemo } from "react";
import { useStore } from "../../store";
import {
  buildSeeds,
  buildUniverse,
  capSizeFromCap,
  bypassesHeat,
  passesHeatGate,
} from "../pipeline";
import type { TechTicker } from "../../types";

const CAP_CN: Record<string, string> = { large: "大盘", mid: "中盘", small: "小盘", unknown: "—" };

const GAUGE: Record<string, { cn: string; color: string; pos: number }> = {
  strong_buy: { cn: "强力买入", color: "#48c78e", pos: 0.92 },
  buy: { cn: "买入", color: "#7fce9e", pos: 0.7 },
  neutral: { cn: "中性", color: "#e9c46a", pos: 0.5 },
  sell: { cn: "卖出", color: "#f2a73c", pos: 0.3 },
  strong_sell: { cn: "强力卖出", color: "#ff5a78", pos: 0.08 },
};

const ATTN: Record<string, { cn: string; color: string }> = {
  breakout: { cn: "突破", color: "#ff5a78" },
  igniting: { cn: "量价点火", color: "#3dd6c4" },
  accumulating: { cn: "吸筹中", color: "#5fb0e8" },
  quiet: { cn: "沉寂", color: "#5a6a7c" },
};

const SOCIAL: Record<string, { cn: string; color: string }> = {
  detonate: { cn: "引爆", color: "#ff5a78" },
  ignite: { cn: "点火", color: "#f2a73c" },
  watch: { cn: "观察", color: "#e9c46a" },
  dead: { cn: "死水", color: "#5c7c99" },
  ultralow: { cn: "超低覆盖", color: "#5a6a7c" },
  warming: { cn: "积累中", color: "#3dd6c4" },
};

function Flag({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${
        on ? "border-ok/40 bg-ok/10 text-ok" : "border-line bg-inset text-muted2"
      }`}
    >
      {on ? "✓ " : "· "}
      {children}
    </span>
  );
}

function Stat({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel2 px-3 py-2.5">
      <div className="mb-1 text-[10.5px] uppercase tracking-wide text-muted2">{label}</div>
      <div className="font-mono text-[15px] font-semibold tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function GaugeMeter({ summary }: { summary: string }) {
  const g = GAUGE[summary] ?? GAUGE.neutral;
  return (
    <div>
      <div className="relative h-2.5 w-full overflow-hidden rounded-full">
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(90deg,#ff5a78,#f2a73c,#e9c46a,#7fce9e,#48c78e)",
          }}
        />
        <div
          className="absolute top-1/2 h-4 w-1.5 -translate-y-1/2 rounded-full border-2 border-ink bg-white"
          style={{ left: `calc(${g.pos * 100}% - 3px)` }}
        />
      </div>
      <div className="mt-2 text-center text-[15px] font-semibold" style={{ color: g.color }}>
        {g.cn}
      </div>
    </div>
  );
}

// Price line + volume bars.
function PriceChart({ closes, vols }: { closes: number[]; vols: number[] }) {
  const W = 720,
    H = 200,
    PADL = 40,
    PADR = 12,
    priceH = 130,
    volY = 150,
    volH = H - volY - 8;
  const n = closes.length;
  if (n < 2) return <div className="p-4 text-[12px] text-muted">数据太短。</div>;
  const xs = (i: number) => PADL + (i * (W - PADL - PADR)) / (n - 1);
  const pMax = Math.max(...closes),
    pMin = Math.min(...closes);
  const yP = (v: number) => 10 + (1 - (v - pMin) / (pMax - pMin || 1)) * (priceH - 10);
  const vMax = Math.max(1, ...vols);
  const yV = (v: number) => volY + (1 - v / vMax) * volH;
  const path = closes.map((c, i) => `${xs(i)},${yP(c)}`).join(" L");
  const up = closes[n - 1] >= closes[0];
  const col = up ? "#48c78e" : "#ff5a78";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: "100%" }}>
      {vols.map((v, i) => (
        <rect
          key={i}
          x={xs(i) - (W - PADL - PADR) / n / 2.6}
          y={yV(v)}
          width={(W - PADL - PADR) / n / 1.3}
          height={volY + volH - yV(v)}
          fill="rgba(95,124,153,.35)"
        />
      ))}
      <path d={`M${path}`} fill="none" stroke={col} strokeWidth="1.6" strokeLinejoin="round" />
      <text x="2" y="12" fontSize="9" fill="#5a6a7c">
        {pMax.toFixed(1)}
      </text>
      <text x="2" y={priceH} fontSize="9" fill="#5a6a7c">
        {pMin.toFixed(1)}
      </text>
      <text x="2" y={volY + 8} fontSize="9" fill="#5a6a7c">
        量 {(vMax / 1e6).toFixed(1)}M
      </text>
    </svg>
  );
}

export function StockDetail() {
  const ticker = useStore((s) => s.detail);
  const close = useStore((s) => s.closeDetail);
  const data = useStore((s) => s.data);
  const heat = useStore((s) => s.heat);
  const technical = useStore((s) => s.technical);
  const marketCaps = useStore((s) => s.marketCaps);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const seed = useMemo(
    () => (ticker ? buildSeeds(data).find((s) => s.ticker === ticker) : undefined),
    [data, ticker],
  );
  const caps = useMemo(
    () => (ticker ? buildUniverse(data).find((u) => u.ticker === ticker)?.caps ?? [] : []),
    [data, ticker],
  );

  if (!ticker) return null;
  const tech: TechTicker | undefined = technical?.tickers?.[ticker];
  const h = heat?.tickers?.[ticker];
  const mc = marketCaps?.[ticker];
  const cap = capSizeFromCap(mc, caps);
  const a = tech?.attention;
  const attnIgnites = a?.ignites ?? false;
  const passes = passesHeatGate(mc, h?.phase ?? "", attnIgnites);
  const company = seed?.company ?? "";

  return (
    <div className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm" onClick={close}>
      <div
        className="my-6 h-fit w-full max-w-3xl rounded-2xl border border-line bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-start justify-between border-b border-line px-6 py-4">
          <div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-[22px] font-bold text-signal">{ticker}</span>
              {tech && (
                <span className="font-mono text-[20px] font-semibold tabular-nums">
                  ${tech.price.toFixed(2)}
                </span>
              )}
              {tech?.change_pct != null && (
                <span
                  className="font-mono text-[14px] font-semibold"
                  style={{ color: tech.change_pct >= 0 ? "#48c78e" : "#ff5a78" }}
                >
                  {tech.change_pct >= 0 ? "+" : ""}
                  {tech.change_pct.toFixed(2)}%
                </span>
              )}
            </div>
            <div className="mt-1 text-[12px] text-muted">
              {company || "—"} · {CAP_CN[cap]}
              {mc ? ` · $${(mc / 1e9).toFixed(1)}B` : ""}
            </div>
          </div>
          <button
            onClick={close}
            className="rounded-lg border border-line px-3 py-1 text-[13px] text-muted hover:text-text"
          >
            关闭 ✕
          </button>
        </div>

        <div className="space-y-4 p-6">
          {/* gate summary */}
          <div className="flex flex-wrap items-center gap-2">
            {bypassesHeat(mc) ? (
              <span className="rounded-full border border-signal/40 bg-signal/10 px-3 py-1 text-[12px] font-medium text-signal">
                大票直通（≥$100B）
              </span>
            ) : (
              <span
                className={`rounded-full border px-3 py-1 text-[12px] font-medium ${
                  passes ? "border-ok/40 bg-ok/10 text-ok" : "border-line bg-inset text-muted2"
                }`}
              >
                {passes ? "通过热度闸" : "未过热度闸"}
              </span>
            )}
            {a && (
              <span
                className="rounded-full border px-3 py-1 text-[12px] font-medium"
                style={{
                  color: (ATTN[a.phase] ?? ATTN.quiet).color,
                  borderColor: `${(ATTN[a.phase] ?? ATTN.quiet).color}66`,
                  background: `${(ATTN[a.phase] ?? ATTN.quiet).color}18`,
                }}
              >
                量价 · {(ATTN[a.phase] ?? ATTN.quiet).cn} · {a.score}分
              </span>
            )}
            {h && (
              <span
                className="rounded-full border px-3 py-1 text-[12px] font-medium"
                style={{
                  color: (SOCIAL[h.phase] ?? SOCIAL.dead).color,
                  borderColor: `${(SOCIAL[h.phase] ?? SOCIAL.dead).color}66`,
                  background: `${(SOCIAL[h.phase] ?? SOCIAL.dead).color}18`,
                }}
              >
                社交 · {(SOCIAL[h.phase] ?? SOCIAL.dead).cn}
                {h.z != null ? ` · z ${h.z.toFixed(2)}` : ""}
              </span>
            )}
          </div>

          {!tech && (
            <div className="rounded-xl border border-dashed border-line2 bg-panel2 p-5 text-center text-[13px] text-muted">
              还没有该票的量价数据。在 Mac 上运行{" "}
              <code className="font-mono text-signal">python -m newsagg.technical</code> 后自动出现。
            </div>
          )}

          {tech && (
            <>
              {/* price + volume */}
              <div className="rounded-xl border border-line bg-panel2 p-4">
                <div className="mb-2 text-[12px] font-semibold text-muted">价格 · 成交量（近 {tech.close_series.length} 日）</div>
                <PriceChart closes={tech.close_series} vols={tech.vol_series} />
              </div>

              {/* attention detail */}
              {a && (
                <div className="rounded-xl border border-line bg-panel2 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-[13px] font-semibold">量价注意力信号</div>
                    <div className="text-[12px] text-muted">
                      注意力分 <span className="font-mono font-semibold text-signal">{a.score}</span>/100
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    <Stat label="RVOL 相对量" value={a.rvol != null ? `${a.rvol.toFixed(2)}×` : "—"} color={a.rvol && a.rvol >= 1.5 ? "#3dd6c4" : undefined} />
                    <Stat label="距20日高" value={a.dist_to_high != null ? `${(a.dist_to_high * 100).toFixed(1)}%` : "—"} />
                    <Stat label="ATR 波动" value={tech.atr_pct != null ? `${tech.atr_pct}%` : "—"} />
                    <Stat label="SMA50" value={tech.sma50 != null ? `$${tech.sma50}` : "—"} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Flag on={a.new_high_20d}>20日新高</Flag>
                    <Flag on={a.new_high_52w}>52周新高</Flag>
                    <Flag on={a.obv_up}>OBV 吸筹</Flag>
                    <Flag on={a.above_sma50}>站上 SMA50</Flag>
                    <Flag on={a.sma50_rising}>SMA50 上行</Flag>
                  </div>
                </div>
              )}

              {/* technical gauge (display only) */}
              <div className="rounded-xl border border-line bg-panel2 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-[13px] font-semibold">技术表针（机械聚合）</div>
                  <div className="text-[11px] text-muted2">MA + 震荡指标投票 · 滞后，仅参考</div>
                </div>
                <GaugeMeter summary={tech.gauge.summary} />
                <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <Stat label="均线 买/卖" value={`${tech.gauge.ma_buy} / ${tech.gauge.ma_sell}`} />
                  <Stat label="震荡 买/中/卖" value={`${tech.gauge.osc_buy}/${tech.gauge.osc_neutral}/${tech.gauge.osc_sell}`} />
                  <Stat label="RSI(14)" value={tech.gauge.rsi != null ? tech.gauge.rsi.toFixed(1) : "—"} color={tech.gauge.rsi != null ? (tech.gauge.rsi > 70 ? "#ff5a78" : tech.gauge.rsi < 30 ? "#48c78e" : undefined) : undefined} />
                  <Stat label="MACD 柱" value={tech.gauge.macd_hist != null ? tech.gauge.macd_hist.toFixed(2) : "—"} color={tech.gauge.macd_hist != null ? (tech.gauge.macd_hist >= 0 ? "#48c78e" : "#ff5a78") : undefined} />
                </div>
                <div className="mt-3 text-[11.5px] leading-relaxed text-muted2">
                  注：这是均线与震荡指标的机械投票，趋势下行时即便当天大涨也常显示卖出——
                  用来看当前姿态，不作为筛选依据。
                </div>
              </div>
            </>
          )}

          {/* SA thesis */}
          {seed && (seed.hasThesis || seed.rating) && (
            <div className="rounded-xl border border-line bg-panel2 p-4">
              <div className="mb-2 text-[13px] font-semibold">SeekingAlpha 看多论点</div>
              <div className="mb-2 flex flex-wrap gap-2 text-[12px] text-muted">
                {seed.rating && (
                  <span className="rounded-md border border-gold/40 bg-gold/10 px-2 py-0.5 font-medium text-gold">
                    {seed.rating}
                  </span>
                )}
                {seed.author && <span>分析师：{seed.author}</span>}
              </div>
              {seed.articleUrl ? (
                <a
                  href={seed.articleUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[13px] text-signal hover:underline"
                >
                  {seed.reasoning || "查看文章"} ↗
                </a>
              ) : (
                <div className="text-[13px] text-muted">{seed.reasoning || "—"}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
