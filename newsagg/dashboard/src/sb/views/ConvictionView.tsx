import { useMemo, useState } from "react";
import { useStore, useT } from "../../store";
import type { ConvictionLayer, ConvictionTicker } from "../../types";
import {
  buildConviction,
  buildFocus,
  buildShortlist,
  capLabel,
  sectorLabel,
  CONVICTION_BAR,
  type ConvictionRow,
} from "../pipeline";
import { ViewHead } from "../ui";

// The four tone layers, in reading order. Each carries its 0..max scale and the
// short labels for each rung so a score reads as words, not just a number.
const LAYERS = [
  {
    key: "L1" as const,
    color: "#5fb0e8",
    en: "Tone baseline",
    zh: "语气基线",
    rungs: { en: ["downgrade", "flat", "clear upgrade"], zh: ["降级", "持平", "明显升级"] },
  },
  {
    key: "L2" as const,
    color: "#3dd6c4",
    en: "Directness",
    zh: "回避闪躲",
    rungs: { en: ["dodges", "vague", "occasional", "straight numbers"], zh: ["反复回避", "避重就轻", "偶有闪躲", "直球给数"] },
  },
  {
    key: "L3" as const,
    color: "#48c78e",
    en: "Hard vs soft",
    zh: "硬话软话",
    rungs: { en: ["all soft", "mostly soft", "mixed", "hard commitments"], zh: ["全软", "软多硬少", "软硬掺半", "大量硬承诺"] },
  },
  {
    key: "L4" as const,
    color: "#f0c862",
    en: "Walk the talk",
    zh: "言行一致",
    rungs: { en: ["talks up but sells", "no signal", "bullish & buying"], zh: ["嘴热手减持", "无信号", "看多且增持"] },
  },
];

const TIER_COLOR: Record<1 | 2 | 3, string> = { 1: "#f0c862", 2: "#cdd6e2", 3: "#cd8b5e" };

// Total 0-10 → a warmth. Backs the thesis (≥ bar) glows green; lukewarm ambers;
// weak / no read stays muted.
function totalColor(total: number): string {
  if (total < 0) return "#5a6a7c";
  if (total >= CONVICTION_BAR + 1.5) return "#48c78e";
  if (total >= CONVICTION_BAR) return "#7bd88f";
  if (total >= 4) return "#f0c862";
  return "#e0785a";
}

// Segmented pips: `score` filled of `max`, plus the rung word underneath.
function LayerMeter({
  layer,
  data,
  lang,
}: {
  layer: (typeof LAYERS)[number];
  data: ConvictionLayer | undefined;
  lang: "en" | "zh";
}) {
  const max = data?.max ?? (layer.key === "L1" || layer.key === "L4" ? 2 : 3);
  const score = data?.score ?? 0;
  const rungs = lang === "zh" ? layer.rungs.zh : layer.rungs.en;
  const rung = rungs[Math.min(score, rungs.length - 1)] ?? "";
  const conf = data?.confidence ?? 0;
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted2">{lang === "zh" ? layer.zh : layer.en}</span>
        <span className="font-mono text-[10.5px] font-semibold" style={{ color: layer.color }}>
          {score}
          <span className="text-muted2">/{max}</span>
        </span>
      </div>
      <div className="flex gap-1">
        {Array.from({ length: max }).map((_, i) => (
          <span
            key={i}
            className="h-1.5 flex-1 rounded-full transition-colors"
            style={{
              background: i < score ? layer.color : "rgba(255,255,255,0.07)",
              boxShadow: i < score ? `0 0 6px ${layer.color}66` : undefined,
            }}
          />
        ))}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="truncate text-[10.5px]" style={{ color: score > 0 ? "#c7d2dc" : "#5a6a7c" }}>
          {rung}
        </span>
        {/* per-layer confidence — a subtle dot, brighter = better-sourced grade */}
        {data && <span className="h-1 w-1 flex-none rounded-full bg-signal" style={{ opacity: 0.25 + conf * 0.75 }} title={`confidence ${(conf * 100).toFixed(0)}%`} />}
      </div>
      {data?.evidence && <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted">“{data.evidence}”</p>}
    </div>
  );
}

function SourceBadge({ conv, lang, t }: { conv: ConvictionTicker; lang: "en" | "zh"; t: (en: string, zh: string) => string }) {
  const anchor = conv.source === "upstream_anchor";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-[2px] text-[9.5px] font-semibold uppercase tracking-wide"
      style={{
        color: anchor ? "#e0b45a" : "#7bd88f",
        background: anchor ? "#e0b45a1a" : "#7bd88f1a",
        border: `1px solid ${anchor ? "#e0b45a44" : "#7bd88f44"}`,
      }}
      title={anchor ? t("read from an upstream anchor's call", "用上游锚公司的电话会读出") : t("the company's own call", "公司自身的电话会")}
    >
      {anchor ? (
        <>
          ⇡ {lang === "zh" ? "上游锚" : "ANCHOR"}
          {conv.anchor_ticker ? ` · ${conv.anchor_ticker}` : ""}
        </>
      ) : (
        <>● {lang === "zh" ? "自身" : "OWN"}</>
      )}
    </span>
  );
}

function ConvCard({ r, idx, lang, onOpen, t }: { r: ConvictionRow; idx: number; lang: "en" | "zh"; onOpen: (x: string) => void; t: (en: string, zh: string) => string }) {
  const conv = r.conv;
  const col = totalColor(r.total);
  const tierCol = TIER_COLOR[r.tier];
  const pending = r.status === "pending";
  const unsourced = r.status === "unsourced";
  return (
    <div
      className="ignite-in flex flex-col gap-3 rounded-2xl border bg-panel2 p-4 transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5"
      style={{
        borderColor: r.status === "advance" ? `${col}55` : "var(--line,#22303c)",
        boxShadow: r.status === "advance" ? `0 0 20px ${col}22` : undefined,
        animationDelay: `${Math.min(idx * 40, 500)}ms`,
      }}
    >
      {/* header */}
      <div className="flex items-start gap-3">
        <button onClick={() => onOpen(r.ticker)} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-disp text-[16px] font-bold tracking-tight text-text hover:text-signal">{r.ticker}</span>
            <span className="h-2 w-2 rounded-full" style={{ background: tierCol }} title={t(`Shortlist Tier ${r.tier}`, `登顶榜第 ${r.tier} 级`)} />
            {conv && conv.ok && <SourceBadge conv={conv} lang={lang} t={t} />}
          </div>
          <div className="mt-0.5 truncate text-[10.5px] text-muted2">
            {r.company || "—"} · {capLabel(r.cap, lang)}
            {r.sector ? ` · ${sectorLabel(r.sector, lang)}` : ""}
          </div>
        </button>
        {/* total dial */}
        <div className="flex flex-none flex-col items-end">
          <div className="font-disp text-[26px] font-bold leading-none tabular-nums" style={{ color: col }}>
            {r.total >= 0 ? r.total.toFixed(0) : "—"}
            {r.total >= 0 && <span className="text-[13px] text-muted2">/10</span>}
          </div>
          <span className="mt-0.5 text-[9px] uppercase tracking-wide text-muted2">{t("conviction", "语气分")}</span>
        </div>
      </div>

      {pending ? (
        <div className="rounded-lg border border-dashed border-line2 py-4 text-center text-[11.5px] text-muted2">
          {t("Not read yet — the LLM will score this name on the next conviction run.", "尚未阅读 —— 下一次 conviction 运行会给它打分。")}
        </div>
      ) : unsourced ? (
        <div className="rounded-lg border border-dashed border-line2 py-4 text-center text-[11.5px] text-muted2">
          {t("No citable call/filing found — low confidence, will retry.", "未找到可引用的电话会/公告 —— 置信度低,将重试。")}
        </div>
      ) : (
        <>
          {/* four layers */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {LAYERS.map((l) => (
              <LayerMeter key={l.key} layer={l} data={conv?.layers[l.key]} lang={lang} />
            ))}
          </div>

          {/* summary */}
          {conv?.summary && <p className="text-[11.5px] leading-relaxed text-muted">{conv.summary}</p>}

          {/* footer: call ref + confidence + source link */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5 text-[10.5px] text-muted2">
            <span className="min-w-0 truncate">
              {conv?.call_ref || t("call", "电话会")}
              {conv?.call_date ? ` · ${conv.call_date}` : ""}
            </span>
            <div className="flex items-center gap-2.5">
              <span title={t("overall confidence", "整体置信度")}>
                {t("conf", "置信")} {Math.round((conv?.confidence ?? 0) * 100)}%
              </span>
              {conv?.source_url && (
                <a
                  href={conv.source_url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-signal hover:underline"
                >
                  {t("source ↗", "原文 ↗")}
                </a>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function ConvictionView() {
  const data = useStore((s) => s.data);
  const heat = useStore((s) => s.heat);
  const technical = useStore((s) => s.technical);
  const sectors = useStore((s) => s.sectors);
  const supplychain = useStore((s) => s.supplychain);
  const marketCaps = useStore((s) => s.marketCaps);
  const catalyst = useStore((s) => s.catalyst);
  const conviction = useStore((s) => s.conviction);
  const openDetail = useStore((s) => s.openDetail);
  const lang = useStore((s) => s.lang);
  const t = useT();

  const focus = useMemo(
    () => buildFocus(data, heat, technical, marketCaps, sectors, supplychain),
    [data, heat, technical, marketCaps, sectors, supplychain],
  );
  const shortlist = useMemo(() => buildShortlist(focus, catalyst), [focus, catalyst]);
  const rows = useMemo(() => buildConviction(shortlist, conviction), [shortlist, conviction]);

  const [filter, setFilter] = useState<"all" | "read" | "advance">("all");
  const [sector, setSector] = useState<string | null>(null);

  // Sector chips — counts over the whole survivor set (independent of the
  // status filter, so switching status never hides a sector you're browsing).
  const sectorCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.sector) m.set(r.sector, (m.get(r.sector) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const bySector = useMemo(() => (sector ? rows.filter((r) => r.sector === sector) : rows), [rows, sector]);
  const shown = useMemo(() => {
    if (filter === "read") return bySector.filter((r) => r.status === "advance" || r.status === "watch");
    if (filter === "advance") return bySector.filter((r) => r.status === "advance");
    return bySector;
  }, [bySector, filter]);

  const nRead = bySector.filter((r) => r.status === "advance" || r.status === "watch").length;
  const nAdvance = bySector.filter((r) => r.status === "advance").length;

  const FILTERS: { key: "all" | "read" | "advance"; label: string; n: number }[] = [
    { key: "all", label: t("All survivors", "全部入围"), n: bySector.length },
    { key: "read", label: t("Read", "已读"), n: nRead },
    { key: "advance", label: t(`Backs thesis · ≥ ${CONVICTION_BAR}`, `撑起论点 · ≥ ${CONVICTION_BAR}`), n: nAdvance },
  ];

  return (
    <div className="view-in">
      <ViewHead
        eyebrow={t("Stage 5 · Conviction", "Stage 5 · 管理层语气")}
        title={t("Management Conviction · Four Tones", "管理层 Conviction · 四层语气")}
        desc={t(
          "An LLM reads the latest earnings call / filing — the ticker's own, or an upstream anchor's read through — and scores four tone layers out of 10 (L1 tone 0-2 · L2 directness 0-3 · L3 hard-vs-soft 0-3 · L4 walk-the-talk 0-2), each with source-text evidence + confidence. Scoped to the Shortlist survivors (Tier 1 + 2).",
          "由 LLM 阅读最新电话会/公告——用自身,或用上游锚公司读出——按四层语气打分,满分 10（L1 语气 0-2 · L2 直白度 0-3 · L3 硬软 0-3 · L4 言行 0-2），每层附原文证据 + 置信度。范围锁定登顶榜入围者（第一名 + 第二名）。",
        )}
      />

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line2 bg-panel2 p-8 text-center text-[13px] text-muted">
          {t("No Shortlist survivors yet — run technical + catalyst first.", "暂无登顶榜入围者 —— 先跑 technical + catalyst。")}
        </div>
      ) : (
        <>
          {/* sector filter */}
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[10.5px] text-muted2">{t("Sector:", "板块:")}</span>
            <button
              onClick={() => setSector(null)}
              className={`rounded-full border px-2.5 py-0.5 text-[12px] transition-colors ${sector === null ? "border-signal/50 bg-signal/10 text-signal" : "border-line text-muted hover:text-text"}`}
            >
              {t("All", "全部")} {rows.length}
            </button>
            {sectorCounts.slice(0, 9).map(([sec, n]) => (
              <button
                key={sec}
                onClick={() => setSector(sector === sec ? null : sec)}
                className={`rounded-full border px-2.5 py-0.5 text-[12px] transition-colors ${sector === sec ? "border-signal/50 bg-signal/10 text-signal" : "border-line text-muted hover:text-text"}`}
              >
                {sectorLabel(sec, lang)} {n}
              </button>
            ))}
          </div>

          {/* status filter */}
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full border px-2.5 py-0.5 text-[12px] transition-colors ${
                  filter === f.key ? "border-signal/50 bg-signal/10 text-signal" : "border-line text-muted hover:text-text"
                }`}
              >
                {f.label} {f.n}
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line2 bg-panel2 p-8 text-center text-[13px] text-muted">
              {t("None in this filter yet.", "该筛选下暂无。")}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {shown.map((r, i) => (
                <ConvCard key={r.ticker} r={r} idx={i} lang={lang} onOpen={openDetail} t={t} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
