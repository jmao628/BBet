import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore, useT, type Lang } from "../../store";
import {
  buildSeeds,
  buildUniverse,
  buildFocus,
  buildRankings,
  capSizeFromCap,
  bypassesHeat,
  passesHeatGate,
  sectorLabel,
  capLabel,
  catLiveScore10,
  catLiveDays,
  catLiveBest,
  catTickerScore,
  catalystTypeLabel,
  CATALYST_BAR,
  type FocusItem,
} from "../pipeline";
import type { Catalyst, CatalystTicker, ConvictionTicker, SupplyEdge, SupplyMap, TechTicker } from "../../types";

// Human labels for the ranking lenses a name advanced in (Heat Ignition).
const LENS_LABEL: Record<string, { en: string; zh: string }> = {
  rvol: { en: "Rel. Volume", zh: "放量" },
  momentum: { en: "Momentum 60d", zh: "动量 60 日" },
  strongbuy: { en: "Strong Buy", zh: "强力买入" },
  bypass: { en: "Mega-cap", zh: "大票直通" },
};

// Transparent Focus-score breakdown for one ticker: every component of the 0-10
// composite, shown with its formula so you can see exactly how the score is built.
function ScoreBreakdown({
  item,
  advBy,
  lang,
  t,
}: {
  item: FocusItem;
  advBy: string[];
  lang: Lang;
  t: (en: string, zh: string) => string;
}) {
  const buyBase = item.strongBuy ? 2.5 : item.gBuy ? 1.3 : 0;
  const streakAdd = (Math.min(item.buyStreak, 5) / 5) * 1.5;
  const rows: { label: string; note: string; val: number; max: number; color: string }[] = [
    {
      label: t("Buy", "买入"),
      note: `${item.strongBuy ? t("strong-buy 2.5", "强买 2.5") : item.gBuy ? t("buy 1.3", "买入 1.3") : "0"} + ${t(`${item.buyStreak}d streak`, `连买 ${item.buyStreak} 天`)} ${streakAdd.toFixed(1)}`,
      val: buyBase + streakAdd,
      max: 4,
      color: "#48c78e",
    },
    {
      label: t("Ecosystem", "生态"),
      note: t(`eco-weight ${item.ecoWeight} ÷ 16 ×4.5 (capped)`, `生态权重 ${item.ecoWeight} ÷ 16 ×4.5（封顶）`),
      val: Math.min(item.ecoWeight / 16, 1) * 4.5,
      max: 4.5,
      color: "#5fb0e8",
    },
    {
      label: t("Thesis", "论点"),
      note: item.gThesis ? t("analyst thesis +1", "有分析师论点 +1") : t("none", "无"),
      val: item.gThesis ? 1 : 0,
      max: 1,
      color: "#9aa7b3",
    },
    {
      label: t("Both-nets", "双网"),
      note: item.inBoth ? t("in quality ∩ advancing +0.5", "质量∩被关注 +0.5") : t("no", "否"),
      val: item.inBoth ? 0.5 : 0,
      max: 0.5,
      color: "#e9c46a",
    },
  ];
  return (
    <div className="rounded-xl border border-line bg-panel2 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[13px] font-semibold">{t("Focus score — how it's built", "重点名单打分 · 拆解")}</div>
        <div className="flex items-center gap-2 text-[12px]">
          <span className="font-mono text-muted2">{t(`gates ${item.gates}/3`, `过闸 ${item.gates}/3`)}</span>
          {item.core && (
            <span className="rounded-full border border-gold/50 bg-gold/10 px-1.5 py-0.5 text-[10px] text-gold">★ {t("Core", "核心")}</span>
          )}
          <span className="font-mono text-[15px] font-semibold text-signal">
            {item.score.toFixed(1)}
            <span className="text-[10px] text-muted2">/10</span>
          </span>
        </div>
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3 text-[12px]">
            <span className="w-16 flex-none text-muted">{r.label}</span>
            <span className="h-1.5 w-24 flex-none overflow-hidden rounded-full bg-inset">
              <span className="block h-full rounded-full" style={{ width: `${Math.max(4, (r.val / r.max) * 100)}%`, background: r.color }} />
            </span>
            <span className="flex-1 truncate text-[11px] text-muted2">{r.note}</span>
            <span className="w-10 flex-none text-right font-mono text-text">{r.val.toFixed(1)}</span>
          </div>
        ))}
      </div>
      {advBy.length > 0 && (
        <div className="mt-3 border-t border-line pt-2 text-[11px] text-muted2">
          {t("Advancing via: ", "被关注来自: ")}
          {advBy.map((k) => (LENS_LABEL[k] ? (lang === "zh" ? LENS_LABEL[k].zh : LENS_LABEL[k].en) : k)).join(" · ")}
        </div>
      )}
    </div>
  );
}

// Each catalyst type gets its own accent colour, rendered as a small live
// "signal" glyph (a solid core with a slow pulsing halo) — cleaner and more
// premium than an emoji, and the motion reads as "active".
const TYPE_COLOR: Record<string, string> = {
  earnings: "#5fb0e8",
  guidance: "#8aa2ff",
  approval: "#48c78e",
  order: "#3dd6c4",
  m_and_a: "#e9c46a",
  capital_return: "#f2a73c",
  policy: "#c98bff",
  index: "#7fce9e",
  mgmt: "#9aa7b3",
  revision: "#e08bd0",
  other: "#9b8cf0",
};

function TypeGlyph({ type }: { type: string }) {
  const c = TYPE_COLOR[type] ?? TYPE_COLOR.other;
  return (
    <span className="relative grid h-3.5 w-3.5 flex-none place-items-center" aria-hidden>
      <span
        className="absolute inset-0 rounded-full"
        style={{ background: c, opacity: 0.16, animation: "catpulse 2.6s ease-in-out infinite" }}
      />
      <span className="h-[7px] w-[7px] rounded-full" style={{ background: c, boxShadow: `0 0 6px ${c}` }} />
    </span>
  );
}

function catDayLabel(c: Catalyst, t: (en: string, zh: string) => string): { label: string; near: boolean } {
  const d = catLiveDays(c);
  if (c.cls === "B") return d == null ? { label: t("window TBD", "窗口待定"), near: false } : { label: t(`~${d}d`, `~${d}天`), near: d <= 30 };
  if (d == null) return { label: t("TBD", "待定"), near: false };
  if (d < 0) return { label: t(`${-d}d ago`, `${-d}天前`), near: false };
  if (d === 0) return { label: t("today", "今天"), near: true };
  return { label: t(`in ${d}d`, `${d}天后`), near: d <= 30 };
}

// Animated ring for the composite catalyst score.
function Ring({ score, color }: { score: number; color: string }) {
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setGrown(true), 60);
    return () => clearTimeout(id);
  }, []);
  const R = 22;
  const C = 2 * Math.PI * R;
  const shown = grown ? score : 0;
  return (
    <svg width="58" height="58" viewBox="0 0 58 58" className="flex-none">
      <circle cx="29" cy="29" r={R} fill="none" stroke="#1c2734" strokeWidth="5" />
      <circle
        cx="29"
        cy="29"
        r={R}
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - shown / 10)}
        transform="rotate(-90 29 29)"
        style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.22,0.61,0.36,1)" }}
      />
      <text x="29" y="33.5" textAnchor="middle" fill="#e7edf4" fontFamily="ui-monospace, monospace" fontSize="14" fontWeight="700">
        {score.toFixed(1)}
      </text>
    </svg>
  );
}

function TpmnRow({ tpmn }: { tpmn: Catalyst["tpmn"] }) {
  const dims: [string, number, number, string][] = [
    ["T", tpmn.T, 25, "#9b8cf0"],
    ["P", tpmn.P, 3, "#5fb0e8"],
    ["M", tpmn.M, 3, "#e9c46a"],
    ["N", tpmn.N, 2, "#48c78e"],
  ];
  return (
    <div className="flex items-center gap-2.5">
      {dims.map(([k, v, max, c]) => (
        <div key={k} className="flex items-center gap-1" title={`${k} ${k === "T" ? v.toFixed(1) : v}/${max}`}>
          <span className="font-mono text-[9px] text-muted2">{k}</span>
          <span className="h-1.5 w-8 overflow-hidden rounded-full bg-inset">
            <span className="block h-full rounded-full" style={{ width: `${Math.max(6, (v / max) * 100)}%`, background: c }} />
          </span>
        </div>
      ))}
    </div>
  );
}

// One catalyst, fully recorded: icon + type + title + timing + score, its
// summary, the P/M/N justification, its T/P/M/N meter, and a source link.
function CatItem({ c, lang, t }: { c: Catalyst; lang: Lang; t: (en: string, zh: string) => string }) {
  const cd = catDayLabel(c, t);
  const sc = catLiveScore10(c);
  return (
    <div className="rounded-lg border border-line/60 bg-white/[0.02] p-2.5 transition-colors hover:bg-white/[0.045]">
      <div className="flex items-center gap-2">
        <TypeGlyph type={c.type} />
        <span className="flex-none rounded border border-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted">{catalystTypeLabel(c.type, lang)}</span>
        <span className="min-w-0 flex-1 text-[12px] leading-snug text-text">{c.title}</span>
        <span className={`flex-none font-mono text-[10px] ${cd.near ? "text-ok" : "text-muted2"}`}>{cd.label}</span>
        <span className="flex-none font-mono text-[13px] font-semibold" style={{ color: sc >= CATALYST_BAR ? "#48c78e" : "#c7d2dc" }}>
          {sc.toFixed(1)}
        </span>
      </div>
      {c.summary && <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{c.summary}</p>}
      {c.evidence && <p className="mt-1 text-[10px] italic text-muted2">P/M/N · {c.evidence}</p>}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <TpmnRow tpmn={c.tpmn} />
        <a
          href={c.source_url}
          target="_blank"
          rel="noreferrer"
          className="flex-none font-mono text-[10px] text-signal/80 hover:text-signal hover:underline"
        >
          {t("source", "来源")} ↗
        </a>
      </div>
    </div>
  );
}

// Full catalyst record for a ticker: an animated score ring, a base+depth
// composition bar, and every catalyst laid out in detail.
function CatBreakdown({ cat, lang, t }: { cat: CatalystTicker; lang: Lang; t: (en: string, zh: string) => string }) {
  const total = catTickerScore(cat);
  const prim = catLiveBest(cat) ?? cat.catalysts[0];
  const primScore = catLiveScore10(prim);
  const depth = Math.round((total - primScore) * 10) / 10;
  const color = total >= CATALYST_BAR ? "#48c78e" : "#c7d2dc";
  const n = cat.catalysts.length;
  return (
    <div className="rounded-xl border border-line bg-panel2 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[13px] font-semibold">{t("Catalyst score — how it's built", "催化剂打分 · 全部记录")}</div>
          <div className="mt-0.5 text-[11px] text-muted2">{n} {t(n === 1 ? "catalyst" : "catalysts", "条催化剂")}</div>
        </div>
        <Ring score={total} color={color} />
      </div>

      {/* composition — base (strongest) + depth toward 10 */}
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between text-[10px]">
          <span className="text-muted2">
            {t("Base (strongest)", "主分(最强)")} <span className="font-mono text-muted">{primScore.toFixed(1)}</span>
          </span>
          <span className="text-gold">
            +{depth.toFixed(1)} {t("depth", "深度加成")}
          </span>
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-inset">
          <div className="h-full" style={{ width: `${(primScore / 10) * 100}%`, background: color, transition: "width 0.8s ease" }} />
          <div className="h-full" style={{ width: `${(depth / 10) * 100}%`, background: "#e9c46a", transition: "width 0.8s ease" }} />
        </div>
      </div>

      {/* every catalyst, full detail — strongest (live) first */}
      <div className="space-y-2">
        {[...cat.catalysts]
          .sort((a, b) => catLiveScore10(b) - catLiveScore10(a))
          .map((c, i) => (
            <CatItem key={i} c={c} lang={lang} t={t} />
          ))}
      </div>

      <div className="mt-2.5 border-t border-line pt-2 text-[10.5px] leading-relaxed text-muted2">
        {t(
          "Base = the strongest catalyst; the rest fill the remaining headroom to 10, weighted by their own strength (P/M/N) with diminishing returns.",
          "基准 = 最强那条;其余按各自强度(P/M/N)递减加权,填补到 10 分的余量。",
        )}
      </div>
    </div>
  );
}

type L = { en: string; zh: string; color: string };
const lbl = (m: L, lang: Lang) => (lang === "zh" ? m.zh : m.en);

const GAUGE: Record<string, L & { pos: number }> = {
  strong_buy: { en: "Strong Buy", zh: "强力买入", color: "#48c78e", pos: 0.92 },
  buy: { en: "Buy", zh: "买入", color: "#7fce9e", pos: 0.7 },
  neutral: { en: "Neutral", zh: "中性", color: "#e9c46a", pos: 0.5 },
  sell: { en: "Sell", zh: "卖出", color: "#f2a73c", pos: 0.3 },
  strong_sell: { en: "Strong Sell", zh: "强力卖出", color: "#ff5a78", pos: 0.08 },
};

const ATTN: Record<string, L> = {
  breakout: { en: "Breakout", zh: "突破", color: "#ff5a78" },
  igniting: { en: "Igniting", zh: "量价点火", color: "#3dd6c4" },
  accumulating: { en: "Accumulating", zh: "吸筹中", color: "#5fb0e8" },
  quiet: { en: "Quiet", zh: "沉寂", color: "#5a6a7c" },
};

const SOCIAL: Record<string, L> = {
  detonate: { en: "Detonate", zh: "引爆", color: "#ff5a78" },
  ignite: { en: "Ignite", zh: "点火", color: "#f2a73c" },
  watch: { en: "Watch", zh: "观察", color: "#e9c46a" },
  dead: { en: "Dead", zh: "死水", color: "#5c7c99" },
  ultralow: { en: "Ultra-low", zh: "超低覆盖", color: "#5a6a7c" },
  warming: { en: "Warming", zh: "积累中", color: "#3dd6c4" },
};

// Stage 5 — the four-layer management-tone read for this ticker (conviction.py).
const CONV_LAYERS: { key: "L1" | "L2" | "L3" | "L4"; color: string; en: string; zh: string }[] = [
  { key: "L1", color: "#5fb0e8", en: "Tone", zh: "语气" },
  { key: "L2", color: "#3dd6c4", en: "Directness", zh: "直白" },
  { key: "L3", color: "#48c78e", en: "Hard vs soft", zh: "硬软" },
  { key: "L4", color: "#f0c862", en: "Walk the talk", zh: "言行" },
];
function convColor(total: number): string {
  if (total >= 7.5) return "#48c78e";
  if (total >= 6) return "#7bd88f";
  if (total >= 4) return "#f0c862";
  return "#e0785a";
}
function ConvBreakdown({ conv, lang, t }: { conv: ConvictionTicker; lang: Lang; t: (en: string, zh: string) => string }) {
  const col = convColor(conv.total);
  const anchor = conv.source === "upstream_anchor";
  return (
    <div className="rounded-xl border border-line bg-panel2 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">{t("Management Conviction", "管理层语气")}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted2">
            <span
              className="rounded px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wide"
              style={{ color: anchor ? "#e0b45a" : "#7bd88f", background: anchor ? "#e0b45a1a" : "#7bd88f1a" }}
            >
              {anchor ? `⇡ ${t("anchor", "上游锚")}${conv.anchor_ticker ? " · " + conv.anchor_ticker : ""}` : `● ${t("own call", "自身")}`}
            </span>
            <span className="truncate">{conv.call_ref || t("call", "电话会")}{conv.call_date ? ` · ${conv.call_date}` : ""}</span>
          </div>
        </div>
        <div className="flex-none text-right">
          <div className="font-disp text-[24px] font-bold leading-none tabular-nums" style={{ color: col }}>
            {conv.total.toFixed(0)}<span className="text-[12px] text-muted2">/10</span>
          </div>
          <div className="text-[9px] uppercase tracking-wide text-muted2">{t("conf", "置信")} {Math.round(conv.confidence * 100)}%</div>
        </div>
      </div>
      <div className="space-y-2.5">
        {CONV_LAYERS.map((l) => {
          const d = conv.layers[l.key];
          return (
            <div key={l.key} className="flex gap-3 border-t border-line/60 pt-2.5 first:border-t-0 first:pt-0">
              <div className="w-[118px] flex-none">
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-[10px] uppercase tracking-wide text-muted2">{lang === "zh" ? l.zh : l.en}</span>
                  <span className="font-mono text-[10.5px] font-semibold" style={{ color: l.color }}>{d.score}<span className="text-muted2">/{d.max}</span></span>
                </div>
                <div className="flex gap-1">
                  {Array.from({ length: d.max }).map((_, i) => (
                    <span key={i} className="h-1.5 flex-1 rounded-full" style={{ background: i < d.score ? l.color : "rgba(255,255,255,0.07)" }} />
                  ))}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                {d.evidence
                  ? <p className="text-[11px] leading-relaxed text-muted">“{d.evidence}”</p>
                  : <p className="text-[10.5px] italic text-muted2">{lang === "zh" ? "无可引用原话" : "no verbatim quote"}</p>}
              </div>
            </div>
          );
        })}
      </div>
      {conv.summary && <p className="mt-3 text-[11.5px] leading-relaxed text-muted">{conv.summary}</p>}
      {conv.source_url && (
        <a href={conv.source_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[11px] text-signal hover:underline">
          {t("source ↗", "原文 ↗")}
        </a>
      )}
    </div>
  );
}

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
  const lang = useStore((s) => s.lang);
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
        {lbl(g, lang)}
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

// Ecosystem map. Suppliers flow in from the left, customers out to the right —
// a clean two-sided value chain (links stay in their own half, so they never
// cross). Competitors (peers) aren't a flow, so they sit in a chip strip below.
// Nodes in our own Buy universe glow with a ↗ badge and are clickable.
const SC_GROUPS = {
  upstream: { en: "Upstream · suppliers", zh: "上游 · 供应商", color: "#5fb0e8" },
  downstream: { en: "Downstream · customers", zh: "下游 · 客户", color: "#48c78e" },
  peers: { en: "Peers · competitors", zh: "同业 · 竞品", color: "#e9c46a" },
} as const;

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function SupplyChainGraph({
  ticker,
  company,
  map,
  inUniverse,
}: {
  ticker: string;
  company: string;
  map: SupplyMap;
  inUniverse: Set<string>;
}) {
  const openDetail = useStore((s) => s.openDetail);
  const lang = useStore((s) => s.lang);
  const t = useT();

  const up = map.upstream ?? [];
  const down = map.downstream ?? [];
  const peers = map.peers ?? [];
  const groups: { key: keyof typeof SC_GROUPS; edges: SupplyEdge[] }[] = [
    { key: "upstream", edges: up },
    { key: "downstream", edges: down },
    { key: "peers", edges: peers },
  ];
  if (up.length + down.length + peers.length === 0) return null;

  const inUni = (e: SupplyEdge) => !!e.ticker && e.ticker !== ticker && inUniverse.has(e.ticker);

  // --- two-column flow geometry ---
  const W = 640;
  const cx = W / 2;
  const nodeW = 108;
  const nodeH = 34;
  const rowH = 54;
  const topPad = 18;
  const rows = Math.max(up.length, down.length, 1);
  const H = topPad * 2 + rows * rowH;
  const cy = topPad + (rows * rowH) / 2;
  const leftX = 92;
  const rightX = W - 92;
  const colY = (i: number, n: number) => cy + (i - (n - 1) / 2) * rowH;
  const cW = 138;
  const cH = 46;

  function SideNode({ e, x, y, color, dir }: { e: SupplyEdge; x: number; y: number; color: string; dir: 1 | -1 }) {
    const hot = inUni(e);
    const hasBoth = !!e.ticker && !!e.name;
    const label = e.ticker || trunc(e.name, 15);
    const bx = x + (nodeW / 2) * dir; // outer corner for the badge
    return (
      <g
        style={{ cursor: hot ? "pointer" : "default" }}
        onClick={hot ? () => openDetail(e.ticker) : undefined}
      >
        <title>{(e.name || e.ticker) + (e.reason ? ` — ${e.reason}` : "")}</title>
        <rect
          x={x - nodeW / 2}
          y={y - nodeH / 2}
          width={nodeW}
          height={nodeH}
          rx={9}
          fill={hot ? `${color}2b` : "#131c25"}
          stroke={hot ? color : `${color}3a`}
          strokeWidth={hot ? 2.4 : 1}
          style={hot ? { filter: `drop-shadow(0 0 7px ${color})` } : undefined}
        />
        <text
          x={x}
          y={hasBoth ? y - 1 : y + 3.5}
          textAnchor="middle"
          fontSize={e.ticker ? 12 : 10.5}
          fontFamily={e.ticker ? "ui-monospace, monospace" : "inherit"}
          fontWeight={hot ? 700 : 500}
          fill={hot ? "#fff" : "#9aa7b3"}
        >
          {label}
        </text>
        {hasBoth && (
          <text x={x} y={y + 10} textAnchor="middle" fontSize="7.5" fill={hot ? color : "#5f6d7a"}>
            {trunc(e.name, 18)}
          </text>
        )}
        {hot && (
          <>
            <circle cx={bx - 3 * dir} cy={y - nodeH / 2 + 3} r="7.5" fill={color} />
            <text x={bx - 3 * dir} y={y - nodeH / 2 + 6.5} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#0c141b">
              ↗
            </text>
          </>
        )}
      </g>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-panel2 p-4">
      <div className="mb-1 flex items-center justify-between">
        <div className="text-[13px] font-semibold">{t("Supply-Chain Ecosystem", "供应链生态图")}</div>
        <div className="flex gap-3 text-[10.5px]">
          {groups.map((g) => (
            <span key={g.key} className="flex items-center gap-1 text-muted2">
              <span className="h-2 w-2 rounded-full" style={{ background: SC_GROUPS[g.key].color }} />
              {lbl({ ...SC_GROUPS[g.key] }, lang)}
            </span>
          ))}
        </div>
      </div>
      <div className="mb-2 text-[11px] leading-relaxed text-muted2">
        {t(
          "AI-derived, major relationships only — not exhaustive. Suppliers flow in from the left, customers out to the right. A ↗ node is in your Buy universe — click it (or its card below) to open that ticker.",
          "AI 推断，仅列主要关系，非穷举。左边流入的是供应商，右边流出的是客户。带 ↗ 的节点在你的 Buy universe 内——点它（或下方卡片）即可跳到那只票。",
        )}
        {map.model ? ` · ${map.model}` : ""}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: "100%" }}>
        {/* curved connectors — left links stay left, right links stay right */}
        {up.map((e, i) => {
          const y = colY(i, up.length);
          const sx = cx - cW / 2;
          const ex = leftX + nodeW / 2;
          const hot = inUni(e);
          return (
            <path
              key={`ul${i}`}
              d={`M${sx},${cy} C${sx - 46},${cy} ${ex + 46},${y} ${ex},${y}`}
              fill="none"
              stroke={hot ? SC_GROUPS.upstream.color : `${SC_GROUPS.upstream.color}40`}
              strokeWidth={hot ? 2 : 1.1}
            />
          );
        })}
        {down.map((e, i) => {
          const y = colY(i, down.length);
          const sx = cx + cW / 2;
          const ex = rightX - nodeW / 2;
          const hot = inUni(e);
          return (
            <path
              key={`dl${i}`}
              d={`M${sx},${cy} C${sx + 46},${cy} ${ex - 46},${y} ${ex},${y}`}
              fill="none"
              stroke={hot ? SC_GROUPS.downstream.color : `${SC_GROUPS.downstream.color}40`}
              strokeWidth={hot ? 2 : 1.1}
            />
          );
        })}
        {/* center node */}
        <rect
          x={cx - cW / 2}
          y={cy - cH / 2}
          width={cW}
          height={cH}
          rx={11}
          fill="#0e2a3a"
          stroke="#3dd6c4"
          strokeWidth="2"
          style={{ filter: "drop-shadow(0 0 9px #3dd6c477)" }}
        />
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize="15" fontFamily="ui-monospace, monospace" fontWeight="700" fill="#3dd6c4">
          {ticker}
        </text>
        <text x={cx} y={cy + 13} textAnchor="middle" fontSize="8.5" fill="#8aa">
          {trunc(company || "", 24)}
        </text>
        {/* nodes */}
        {up.map((e, i) => (
          <SideNode key={`un${i}`} e={e} x={leftX} y={colY(i, up.length)} color={SC_GROUPS.upstream.color} dir={-1} />
        ))}
        {down.map((e, i) => (
          <SideNode key={`dn${i}`} e={e} x={rightX} y={colY(i, down.length)} color={SC_GROUPS.downstream.color} dir={1} />
        ))}
      </svg>

      {/* peers — a competitor strip (not a flow), clickable when in-universe */}
      {peers.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: SC_GROUPS.peers.color }}>
            <span className="h-2 w-2 rounded-full" style={{ background: SC_GROUPS.peers.color }} />
            {lbl({ ...SC_GROUPS.peers }, lang)}
          </span>
          {peers.map((e, i) => {
            const hot = inUni(e);
            return (
              <button
                key={i}
                onClick={hot ? () => openDetail(e.ticker) : undefined}
                title={(e.name || e.ticker) + (e.reason ? ` — ${e.reason}` : "")}
                className={`rounded-full border px-2.5 py-0.5 font-mono text-[11.5px] font-medium ${hot ? "cursor-pointer text-white" : "cursor-default"}`}
                style={{
                  borderColor: hot ? SC_GROUPS.peers.color : `${SC_GROUPS.peers.color}3a`,
                  background: hot ? `${SC_GROUPS.peers.color}26` : "transparent",
                  color: hot ? "#fff" : "#9aa7b3",
                  boxShadow: hot ? `0 0 7px ${SC_GROUPS.peers.color}` : undefined,
                }}
              >
                {e.ticker || trunc(e.name, 16)}
                {hot ? " ↗" : ""}
              </button>
            );
          })}
        </div>
      )}

      {/* relationship reader — every edge with its reason, always visible */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: SC_GROUPS[g.key].color }}>
              <span className="h-2 w-2 rounded-full" style={{ background: SC_GROUPS[g.key].color }} />
              {lbl({ ...SC_GROUPS[g.key] }, lang)}
              <span className="text-muted2">· {g.edges.length}</span>
            </div>
            <div className="space-y-1.5">
              {g.edges.length === 0 && <div className="text-[11px] text-muted2">—</div>}
              {g.edges.map((e, i) => {
                const hot = inUni(e);
                return (
                  <div
                    key={i}
                    onClick={hot ? () => openDetail(e.ticker) : undefined}
                    className={`rounded-lg border px-2.5 py-1.5 ${
                      hot
                        ? "cursor-pointer border-line2 bg-white/[0.04] hover:bg-white/[0.08]"
                        : "border-line bg-panel"
                    }`}
                    style={hot ? { borderColor: `${SC_GROUPS[g.key].color}66` } : undefined}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[12px] font-semibold" style={{ color: hot ? SC_GROUPS[g.key].color : "#c7d2dc" }}>
                        {e.ticker || trunc(e.name, 15)}
                      </span>
                      {hot && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold"
                          style={{ color: "#0c141b", background: SC_GROUPS[g.key].color }}
                        >
                          {t("open ↗", "打开 ↗")}
                        </span>
                      )}
                    </div>
                    {e.ticker && e.name && <div className="text-[10.5px] text-muted">{e.name}</div>}
                    {e.reason && <div className="mt-0.5 text-[11px] leading-snug text-muted2">{e.reason}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StockDetail() {
  const ticker = useStore((s) => s.detail);
  const close = useStore((s) => s.closeDetail);
  const data = useStore((s) => s.data);
  const heat = useStore((s) => s.heat);
  const technical = useStore((s) => s.technical);
  const sectors = useStore((s) => s.sectors);
  const supplychain = useStore((s) => s.supplychain);
  const catalyst = useStore((s) => s.catalyst);
  const conviction = useStore((s) => s.conviction);
  const marketCaps = useStore((s) => s.marketCaps);
  const lang = useStore((s) => s.lang);
  const t = useT();

  // Live per-ticker refresh: the daily launchd job only rewrites the shared
  // technical file once a day, so opening a ticker hits the server's on-demand
  // /api/quote endpoint for a fresh yfinance pull, then re-polls every 60s while
  // the panel is open. Falls back to the cached file if the fetch fails.
  const [live, setLive] = useState<(TechTicker & { generated_at?: string }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [liveErr, setLiveErr] = useState(false);

  const refresh = useCallback(async () => {
    if (!ticker) return;
    setLoading(true);
    setLiveErr(false);
    try {
      const res = await fetch(`/api/quote?ticker=${encodeURIComponent(ticker)}&t=${Date.now()}`);
      if (!res.ok) throw new Error(String(res.status));
      const j = await res.json();
      if (j && typeof j.price === "number") setLive(j as TechTicker & { generated_at?: string });
      else throw new Error("no data");
    } catch {
      setLiveErr(true);
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => {
    setLive(null);
    setLiveErr(false);
    if (!ticker) return;
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [ticker, refresh]);

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
  const inUniverse = useMemo(
    () => new Set(buildUniverse(data).map((u) => u.ticker)),
    [data],
  );
  const focusItem = useMemo(
    () =>
      ticker
        ? buildFocus(data, heat, technical, marketCaps, sectors, supplychain).find((f) => f.ticker === ticker)
        : undefined,
    [data, heat, technical, marketCaps, sectors, supplychain, ticker],
  );
  const advBy = useMemo(
    () => (ticker ? buildRankings(data, heat, technical, marketCaps).advancingBy.get(ticker) ?? [] : []),
    [data, heat, technical, marketCaps, ticker],
  );

  if (!ticker) return null;
  const tech: TechTicker | undefined = live ?? technical?.tickers?.[ticker];
  const liveTime = live?.generated_at
    ? new Date(live.generated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;
  // When the on-demand live fetch fails (e.g. no VPN to Yahoo), show WHEN the
  // cached daily snapshot was taken instead of a vague label.
  const snapTime = technical?.generated_at
    ? new Date(technical.generated_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;
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
              <button
                onClick={refresh}
                disabled={loading}
                title={t("Refresh live quote", "刷新实时报价")}
                className="ml-1 grid h-6 w-6 place-items-center rounded-md border border-line text-[13px] text-muted hover:text-text disabled:opacity-50"
              >
                <span className={loading ? "inline-block animate-spin" : ""}>⟳</span>
              </button>
              {liveTime ? (
                <span className="flex items-center gap-1 text-[11px] text-ok">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" />
                  {t(`Live · ${liveTime}`, `实时 · ${liveTime}`)}
                </span>
              ) : liveErr ? (
                <span
                  className="flex items-center gap-1 text-[11px] text-muted2"
                  title={t(
                    "Live quote fetch failed (needs the VPN proxy to reach Yahoo). Showing the latest daily snapshot — it auto-upgrades to Live once the fetch works.",
                    "实时报价抓取失败（需要 VPN 代理才能连 Yahoo）。显示最近一次每日快照——抓取一旦成功会自动切回实时。",
                  )}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-muted2/60" />
                  {snapTime ? t(`snapshot · ${snapTime}`, `快照 · ${snapTime}`) : t("daily snapshot", "每日快照")}
                </span>
              ) : loading ? (
                <span className="text-[11px] text-muted2">{t("· fetching…", "· 抓取中…")}</span>
              ) : null}
            </div>
            <div className="mt-1 text-[12px] text-muted">
              {company || "—"} · {capLabel(cap, lang)}
              {mc ? ` · $${(mc / 1e9).toFixed(1)}B` : ""}
              {sectors?.[ticker]?.sector ? ` · ${sectorLabel(sectors[ticker].sector, lang)}` : ""}
              {sectors?.[ticker]?.industry ? ` · ${sectors[ticker].industry}` : ""}
            </div>
          </div>
          <button
            onClick={close}
            className="rounded-lg border border-line px-3 py-1 text-[13px] text-muted hover:text-text"
          >
            {t("Close ✕", "关闭 ✕")}
          </button>
        </div>

        <div className="space-y-4 p-6">
          {/* gate summary */}
          <div className="flex flex-wrap items-center gap-2">
            {bypassesHeat(mc) ? (
              <span className="rounded-full border border-signal/40 bg-signal/10 px-3 py-1 text-[12px] font-medium text-signal">
                {t("Mega-cap bypass (≥$100B)", "大票直通（≥$100B）")}
              </span>
            ) : (
              <span
                className={`rounded-full border px-3 py-1 text-[12px] font-medium ${
                  passes ? "border-ok/40 bg-ok/10 text-ok" : "border-line bg-inset text-muted2"
                }`}
              >
                {passes ? t("Passes heat gate", "通过热度闸") : t("No heat gate", "未过热度闸")}
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
                {t("PV", "量价")} · {lbl(ATTN[a.phase] ?? ATTN.quiet, lang)} · {a.score}
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
                {t("Social", "社交")} · {lbl(SOCIAL[h.phase] ?? SOCIAL.dead, lang)}
                {h.z != null ? ` · z ${h.z.toFixed(2)}` : ""}
              </span>
            )}
          </div>

          {focusItem && <ScoreBreakdown item={focusItem} advBy={advBy} lang={lang} t={t} />}

          {catalyst?.[ticker] && catalyst[ticker].catalysts.length > 0 && (
            <CatBreakdown cat={catalyst[ticker]} lang={lang} t={t} />
          )}

          {conviction?.[ticker] && conviction[ticker].ok && (
            <ConvBreakdown conv={conviction[ticker]} lang={lang} t={t} />
          )}

          {!tech && (
            <div className="rounded-xl border border-dashed border-line2 bg-panel2 p-5 text-center text-[13px] text-muted">
              {t("No price-volume data for this ticker yet. Run ", "还没有该票的量价数据。在 Mac 上运行 ")}
              <code className="font-mono text-signal">python -m newsagg.technical</code>
              {t(" on the Mac.", " 后自动出现。")}
            </div>
          )}

          {tech && (
            <>
              {/* price + volume */}
              <div className="rounded-xl border border-line bg-panel2 p-4">
                <div className="mb-2 text-[12px] font-semibold text-muted">
                  {t(`Price · Volume (last ${tech.close_series.length}d)`, `价格 · 成交量（近 ${tech.close_series.length} 日）`)}
                </div>
                <PriceChart closes={tech.close_series} vols={tech.vol_series} />
              </div>

              {/* attention detail */}
              {a && (
                <div className="rounded-xl border border-line bg-panel2 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-[13px] font-semibold">{t("Price-Volume Attention", "量价注意力信号")}</div>
                    <div className="text-[12px] text-muted">
                      {t("score", "注意力分")} <span className="font-mono font-semibold text-signal">{a.score}</span>/100
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    <Stat label={t("RVOL", "RVOL 相对量")} value={a.rvol != null ? `${a.rvol.toFixed(2)}×` : "—"} color={a.rvol && a.rvol >= 1.5 ? "#3dd6c4" : undefined} />
                    <Stat label={t("Dist. to 20d high", "距20日高")} value={a.dist_to_high != null ? `${(a.dist_to_high * 100).toFixed(1)}%` : "—"} />
                    <Stat label={t("ATR", "ATR 波动")} value={tech.atr_pct != null ? `${tech.atr_pct}%` : "—"} />
                    <Stat label="SMA50" value={tech.sma50 != null ? `$${tech.sma50}` : "—"} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Flag on={a.new_high_20d}>{t("20d high", "20日新高")}</Flag>
                    <Flag on={a.new_high_52w}>{t("52w high", "52周新高")}</Flag>
                    <Flag on={a.obv_up}>{t("OBV up", "OBV 吸筹")}</Flag>
                    <Flag on={a.above_sma50}>{t("Above SMA50", "站上 SMA50")}</Flag>
                    <Flag on={a.sma50_rising}>{t("SMA50 rising", "SMA50 上行")}</Flag>
                  </div>
                </div>
              )}

              {/* technical gauge (display only) */}
              <div className="rounded-xl border border-line bg-panel2 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-[13px] font-semibold">{t("Technical Gauge (mechanical)", "技术表针（机械聚合）")}</div>
                  <div className="text-[11px] text-muted2">{t("MA + oscillator vote · lags, reference only", "MA + 震荡指标投票 · 滞后，仅参考")}</div>
                </div>
                <GaugeMeter summary={tech.gauge.summary} />
                {tech.buy_streak != null && (
                  <div className="mt-3 flex items-center justify-center gap-2 text-[12px]">
                    <span className="text-muted2">{t("Sustained buy", "持续买入迹象")}</span>
                    <span
                      className="rounded-full border px-2 py-0.5 font-mono text-[11px] font-semibold"
                      style={
                        tech.buy_streak >= 5
                          ? { color: "#48c78e", borderColor: "#48c78e66", background: "#48c78e18" }
                          : { color: "#8695a3", borderColor: "var(--line, #2a3a49)" }
                      }
                    >
                      {t(`${tech.buy_streak} / 5 days`, `连续 ${tech.buy_streak} / 5 天`)}
                    </span>
                  </div>
                )}
                <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <Stat label={t("MA buy/sell", "均线 买/卖")} value={`${tech.gauge.ma_buy} / ${tech.gauge.ma_sell}`} />
                  <Stat label={t("Osc buy/neu/sell", "震荡 买/中/卖")} value={`${tech.gauge.osc_buy}/${tech.gauge.osc_neutral}/${tech.gauge.osc_sell}`} />
                  <Stat label="RSI(14)" value={tech.gauge.rsi != null ? tech.gauge.rsi.toFixed(1) : "—"} color={tech.gauge.rsi != null ? (tech.gauge.rsi > 70 ? "#ff5a78" : tech.gauge.rsi < 30 ? "#48c78e" : undefined) : undefined} />
                  <Stat label={t("MACD hist", "MACD 柱")} value={tech.gauge.macd_hist != null ? tech.gauge.macd_hist.toFixed(2) : "—"} color={tech.gauge.macd_hist != null ? (tech.gauge.macd_hist >= 0 ? "#48c78e" : "#ff5a78") : undefined} />
                </div>
                <div className="mt-3 text-[11.5px] leading-relaxed text-muted2">
                  {t(
                    "Note: a mechanical MA + oscillator vote — in a downtrend it often reads Sell even on a big up day. Read it for posture, not as a filter.",
                    "注：这是均线与震荡指标的机械投票，趋势下行时即便当天大涨也常显示卖出——用来看当前姿态，不作为筛选依据。",
                  )}
                </div>
              </div>
            </>
          )}

          {/* supply-chain ecosystem */}
          {supplychain?.[ticker] &&
            (supplychain[ticker].upstream?.length ||
              supplychain[ticker].downstream?.length ||
              supplychain[ticker].peers?.length) ? (
            <SupplyChainGraph
              ticker={ticker}
              company={company}
              map={supplychain[ticker]}
              inUniverse={inUniverse}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-line2 bg-panel2 p-4 text-center text-[12px] text-muted2">
              {t(
                "No supply-chain map yet. It appears after ",
                "还没有供应链生态图。在 Mac 上运行 ",
              )}
              <code className="font-mono text-signal">python -m newsagg.supplychain</code>
              {t(" runs on the Mac (needs OPENAI_API_KEY).", " 后出现（需 OPENAI_API_KEY）。")}
            </div>
          )}

          {/* SA thesis */}
          {seed && (seed.hasThesis || seed.rating) && (
            <div className="rounded-xl border border-line bg-panel2 p-4">
              <div className="mb-2 text-[13px] font-semibold">{t("SeekingAlpha Bull Thesis", "SeekingAlpha 看多论点")}</div>
              <div className="mb-2 flex flex-wrap gap-2 text-[12px] text-muted">
                {seed.rating && (
                  <span className="rounded-md border border-gold/40 bg-gold/10 px-2 py-0.5 font-medium text-gold">
                    {seed.rating}
                  </span>
                )}
                {seed.author && <span>{t("Analyst: ", "分析师：")}{seed.author}</span>}
              </div>
              {seed.articleUrl ? (
                <a
                  href={seed.articleUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[13px] text-signal hover:underline"
                >
                  {seed.reasoning || t("View article", "查看文章")} ↗
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
