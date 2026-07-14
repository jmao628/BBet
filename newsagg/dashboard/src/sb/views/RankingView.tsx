import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore, useT } from "../../store";
import {
  buildConviction,
  buildConvictionRanking,
  buildFocus,
  buildShortlist,
  capLabel,
  sectorLabel,
  RANK_COLORS,
  RANK_LENSES,
  RANK_MIN_CONVICTION,
  type RankingRow,
} from "../pipeline";
import { ViewHead } from "../ui";

const MEDAL = ["#f0c862", "#cdd6e2", "#cd8b5e"]; // gold · silver · bronze
const medalColor = (rank: number): string => MEDAL[rank - 1] ?? "#6f7f8e";

// A distinct hue per GICS sector, for the per-sector section headers.
const SECTOR_HUE: Record<string, string> = {
  Technology: "#5fb0e8",
  Healthcare: "#48c78e",
  "Financial Services": "#7bd88f",
  "Consumer Cyclical": "#e0785a",
  "Consumer Defensive": "#c9a86a",
  Industrials: "#9aa7b4",
  Energy: "#e0b45a",
  "Basic Materials": "#b58bd6",
  "Communication Services": "#3dd6c4",
  Utilities: "#6f8fb0",
  "Real Estate": "#d68b9a",
};
const sectorHue = (s: string): string => SECTOR_HUE[s] ?? "#8aa0b2";

const DIMS = [
  { key: "conv" as const, en: "Conviction", zh: "语气", color: RANK_COLORS.conv },
  { key: "cat" as const, en: "Catalyst", zh: "催化", color: RANK_COLORS.cat },
  { key: "core" as const, en: "Core", zh: "核心", color: RANK_COLORS.core },
  { key: "attn" as const, en: "Attention", zh: "注意力", color: RANK_COLORS.attn },
];

// FLIP: glide each row from its previous position to its new one when the order
// changes, so re-ranking under a new lens animates instead of snapping.
function useFlip(orderKey: string) {
  const refs = useRef(new Map<string, HTMLElement>());
  const prev = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) {
      refs.current.forEach((el, k) => {
        const p = prev.current.get(k);
        const n = el.getBoundingClientRect();
        if (p) {
          const dy = p.top - n.top;
          if (Math.abs(dy) > 1) {
            el.animate(
              [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
              { duration: 480, easing: "cubic-bezier(0.22,0.61,0.36,1)" },
            );
          }
        }
      });
    }
    const m = new Map<string, DOMRect>();
    refs.current.forEach((el, k) => m.set(k, el.getBoundingClientRect()));
    prev.current = m;
  }, [orderKey]);
  return refs;
}

// A four-axis radar of the raw (unweighted) signals — the shape at a glance.
function Radar({ r, size = 128 }: { r: RankingRow; size?: number }) {
  const c = size / 2;
  const R = size / 2 - 20;
  const vals = [
    { v: r.convScore / 10, a: -90, color: RANK_COLORS.conv, lab: "语" },
    { v: Math.max(0, r.catScore) / 10, a: 0, color: RANK_COLORS.cat, lab: "催" },
    { v: r.focusScore / 10, a: 90, color: RANK_COLORS.core, lab: "核" },
    { v: (r.attnScore ?? 0) / 100, a: 180, color: RANK_COLORS.attn, lab: "注" },
  ];
  const pt = (v: number, a: number, rad = R) => {
    const t = (a * Math.PI) / 180;
    return [c + Math.cos(t) * rad * v, c + Math.sin(t) * rad * v];
  };
  const poly = vals.map((x) => pt(x.v, x.a).join(",")).join(" ");
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-none">
      {[0.33, 0.66, 1].map((g) => (
        <polygon
          key={g}
          points={vals.map((x) => pt(1, x.a, R * g).join(",")).join(" ")}
          fill="none"
          stroke="var(--line2,#2b3a48)"
          strokeWidth="1"
        />
      ))}
      {vals.map((x) => {
        const [px, py] = pt(1, x.a);
        return <line key={x.a} x1={c} y1={c} x2={px} y2={py} stroke="var(--line,#22303c)" strokeWidth="1" />;
      })}
      <polygon points={poly} fill="rgba(61,214,196,0.16)" stroke={RANK_COLORS.core} strokeWidth="1.5" />
      {vals.map((x) => {
        const [px, py] = pt(x.v, x.a);
        const [lx, ly] = pt(1.24, x.a);
        return (
          <g key={x.lab}>
            <circle cx={px} cy={py} r="3" fill={x.color} />
            <text x={lx} y={ly + 3} textAnchor="middle" fontSize="9" fill="var(--muted2,#5f7183)">{x.lab}</text>
          </g>
        );
      })}
    </svg>
  );
}

// Stacked contribution bar: filled width = composite (0-100); coloured segments
// show how conviction / catalyst / core / attention each built that score.
function SegBar({ r }: { r: RankingRow }) {
  const total = Math.max(r.composite, 0.001);
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-inset">
      <div className="flex h-full transition-[width] duration-500" style={{ width: `${Math.min(100, r.composite)}%` }}>
        {DIMS.map((d) => (
          <span
            key={d.key}
            className="h-full transition-[flex-grow] duration-500"
            style={{ flexGrow: r.parts[d.key], flexBasis: 0, background: d.color, opacity: 0.92 }}
            title={`${d.en} ${r.parts[d.key].toFixed(1)}`}
          />
        ))}
      </div>
      <span className="sr-only">{total}</span>
    </div>
  );
}

function PodiumCard({ r, rank, onOpen, t }: { r: RankingRow; rank: number; onOpen: (x: string) => void; t: (en: string, zh: string) => string }) {
  const col = medalColor(rank);
  const lifted = rank === 1;
  return (
    <button
      onClick={() => onOpen(r.ticker)}
      className="rank-rise group relative flex flex-1 flex-col items-center rounded-2xl border bg-panel2 px-3 pb-4 pt-5 text-center transition-[transform,box-shadow] duration-200 hover:-translate-y-1"
      style={{
        borderColor: `${col}66`,
        boxShadow: lifted ? `0 0 34px ${col}33` : `0 0 18px ${col}22`,
        marginTop: lifted ? 0 : 22,
        background: `linear-gradient(180deg, ${col}14, transparent 60%)`,
      }}
    >
      <span
        className="mb-2 grid h-9 w-9 place-items-center rounded-xl font-disp text-[16px] font-bold"
        style={{ color: "#0b0f14", background: col, boxShadow: `0 0 16px ${col}88` }}
      >
        {rank}
      </span>
      {lifted && <span className="absolute -top-3 text-[16px]" style={{ color: col }}>♛</span>}
      <span className="font-disp text-[19px] font-bold tracking-tight text-text transition-colors group-hover:text-signal">{r.ticker}</span>
      <span className="mt-0.5 max-w-full truncate text-[10px] text-muted2">{r.company || "—"}</span>
      <span className="mt-2 font-disp text-[30px] font-bold leading-none tabular-nums" style={{ color: col }}>{r.composite.toFixed(1)}</span>
      <span className="text-[9px] uppercase tracking-wide text-muted2">{t("composite", "综合分")}</span>
      <div className="mt-3 w-full"><SegBar r={r} /></div>
    </button>
  );
}

function RankRow({
  r,
  rank,
  open,
  onToggle,
  onOpen,
  lang,
  t,
  setRef,
}: {
  r: RankingRow;
  rank: number;
  open: boolean;
  onToggle: () => void;
  onOpen: (x: string) => void;
  lang: "en" | "zh";
  t: (en: string, zh: string) => string;
  setRef: (el: HTMLElement | null) => void;
}) {
  const col = medalColor(rank);
  const top = rank <= 3;
  return (
    <div ref={setRef} className="overflow-hidden rounded-xl border bg-panel2" style={{ borderColor: top ? `${col}44` : "var(--line,#22303c)" }}>
      <button onClick={onToggle} className="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.02]">
        <span
          className="grid h-8 w-8 flex-none place-items-center rounded-lg font-disp text-[14px] font-bold tabular-nums"
          style={{ color: top ? "#0b0f14" : "#c7d2dc", background: top ? col : "transparent", border: top ? "none" : "1px solid var(--line2,#2b3a48)" }}
        >
          {rank}
        </span>
        <div className="min-w-0 flex-[1.4]">
          <div className="flex items-center gap-2">
            <span className="font-disp text-[15px] font-bold tracking-tight text-text group-hover:text-signal">{r.ticker}</span>
            <span className="text-[9.5px] uppercase tracking-wide" style={{ color: col }}>{t("Tier 1", "金档")}</span>
          </div>
          <div className="truncate text-[10.5px] text-muted2">{r.company || "—"} · {capLabel(r.cap, lang)}{r.sector ? ` · ${sectorLabel(r.sector, lang)}` : ""}</div>
        </div>
        <div className="hidden min-w-0 flex-[1.6] sm:block"><SegBar r={r} /></div>
        <div className="w-[62px] flex-none text-right">
          <span key={r.composite} className="num-pop inline-block font-disp text-[19px] font-bold leading-none tabular-nums" style={{ color: col }}>{r.composite.toFixed(1)}</span>
        </div>
        <span className="flex-none text-[11px] text-muted2 transition-transform" style={{ transform: open ? "rotate(90deg)" : "none" }}>›</span>
      </button>

      {open && (
        <div className="view-in grid gap-4 border-t border-line px-4 py-4 sm:grid-cols-[auto_1fr]">
          <div className="flex flex-col items-center">
            <Radar r={r} />
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
              {DIMS.map((d) => (
                <div key={d.key} className="flex items-center gap-1.5 text-[10px] text-muted2">
                  <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                  {lang === "zh" ? d.zh : d.en}
                  <span className="font-mono text-text">
                    {d.key === "attn" ? Math.round(r.attnScore) : (d.key === "conv" ? r.convScore : d.key === "cat" ? r.catScore : r.focusScore).toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <span className="rounded px-1.5 py-[1px] text-[9.5px] font-semibold uppercase tracking-wide" style={{ color: "#0b0f14", background: RANK_COLORS.conv }}>
                {t("Conviction", "语气")} {r.convScore.toFixed(1)}
              </span>
              {r.conv.source === "upstream_anchor" && (
                <span className="rounded px-1.5 py-[1px] text-[9.5px] font-semibold uppercase tracking-wide" style={{ color: "#e0b45a", background: "#e0b45a1a" }}>
                  ⇡ {r.conv.anchor_ticker || t("anchor", "上游锚")}
                </span>
              )}
              <span className="text-[10.5px] text-muted2">{r.conv.call_ref || t("call", "电话会")}{r.conv.call_date ? ` · ${r.conv.call_date}` : ""}</span>
            </div>
            {r.conv.summary && <p className="text-[11.5px] leading-relaxed text-muted">{r.conv.summary}</p>}
            <button onClick={() => onOpen(r.ticker)} className="mt-2.5 text-[11px] text-signal hover:underline">
              {t("full breakdown ↗", "完整拆解 ↗")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function RankingView() {
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

  const [lensIdx, setLensIdx] = useState(0);
  const [mode, setMode] = useState<"overall" | "sector">("overall");
  const [open, setOpen] = useState<string | null>(null);
  const lens = RANK_LENSES[lensIdx];

  const convRows = useMemo(() => {
    const focus = buildFocus(data, heat, technical, marketCaps, sectors, supplychain);
    const shortlist = buildShortlist(focus, catalyst);
    return buildConviction(shortlist, conviction);
  }, [data, heat, technical, marketCaps, sectors, supplychain, catalyst, conviction]);

  const rows = useMemo(() => buildConvictionRanking(convRows, lens.w), [convRows, lens]);
  // FLIP only animates the overall flat list; the sector view re-renders plainly.
  const orderKey = mode === "overall" ? lensIdx + "|" + rows.map((r) => r.ticker).join(",") : "sector";
  const refs = useFlip(orderKey);

  // Per-sector leaderboards — rows are already composite-sorted, so each sector
  // list keeps that order; sections are ordered by size then by their leader.
  const bySector = useMemo(() => {
    const m = new Map<string, RankingRow[]>();
    for (const r of rows) {
      const k = r.sector || "__none";
      const arr = m.get(k);
      if (arr) arr.push(r);
      else m.set(k, [r]);
    }
    return [...m.entries()].sort(
      (a, b) => b[1].length - a[1].length || (b[1][0]?.composite ?? 0) - (a[1][0]?.composite ?? 0) || a[0].localeCompare(b[0]),
    );
  }, [rows]);

  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);

  return (
    <div className="view-in">
      <ViewHead
        eyebrow={t("Conviction Gate · Composite Rank", "语气闸 · 综合排行")}
        title={t("Composite Rank · Tier-1 Finalists", "综合排行 · 金档决选")}
        desc={t(
          `The synthesis at the Conviction gate: Shortlist Tier-1 names whose management-tone read cleared ${RANK_MIN_CONVICTION}, ranked by a weighted blend of all four deep signals — Conviction · Catalyst · Core · Attention. Switch lenses to re-weight and re-rank live.`,
          `语气闸的综合裁决:登顶金档(Tier 1)中、管理层语气 > ${RANK_MIN_CONVICTION} 的票,按四维深层信号加权排名——语气 · 催化 · 核心 · 注意力。切换视角即时重排。`,
        )}
      />

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line2 bg-panel2 p-8 text-center text-[13px] text-muted">
          {t(`No Tier-1 name has cleared Conviction ${RANK_MIN_CONVICTION} yet — run catalyst + conviction first.`, `暂无金档票的语气分 > ${RANK_MIN_CONVICTION} —— 先跑 catalyst + conviction。`)}
        </div>
      ) : (
        <>
          {/* lens switcher + scope toggle */}
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className="text-[10.5px] uppercase tracking-wide text-muted2">{t("Lens", "视角")}</span>
            <div className="flex flex-wrap gap-1.5">
              {RANK_LENSES.map((l, i) => (
                <button
                  key={l.key}
                  onClick={() => setLensIdx(i)}
                  className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${i === lensIdx ? "border-signal/60 bg-signal/10 text-signal" : "border-line text-muted hover:text-text"}`}
                >
                  {lang === "zh" ? l.zh : l.en}
                </button>
              ))}
            </div>
            {/* overall vs by-sector */}
            <div className="ml-auto flex rounded-full border border-line p-0.5">
              {(["overall", "sector"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-full px-3 py-1 text-[12px] transition-colors ${mode === m ? "bg-signal/15 text-signal" : "text-muted hover:text-text"}`}
                >
                  {m === "overall" ? t("Overall", "总榜") : t("By sector", "分板块")}
                </button>
              ))}
            </div>
          </div>

          {/* active weights */}
          <div className="mb-5 flex flex-wrap items-center gap-3">
            {DIMS.map((d) => (
              <span key={d.key} className="flex items-center gap-1 text-[10.5px] text-muted2">
                <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                {lang === "zh" ? d.zh : d.en} <span className="font-mono text-text">{Math.round(lens.w[d.key] * 100)}%</span>
              </span>
            ))}
          </div>

          {mode === "overall" ? (
            <>
              {/* podium */}
              {podium.length >= 2 && (
                <div className="mb-6 flex items-end gap-3">
                  {podium.length === 3 && <PodiumCard r={podium[1]} rank={2} onOpen={openDetail} t={t} />}
                  <PodiumCard r={podium[0]} rank={1} onOpen={openDetail} t={t} />
                  {podium[2] && <PodiumCard r={podium[2]} rank={3} onOpen={openDetail} t={t} />}
                  {podium.length === 2 && <div className="flex-1" />}
                </div>
              )}

              {/* full ranked list */}
              <div className="space-y-2">
                {rest.map((r, i) => (
                  <RankRow
                    key={r.ticker}
                    r={r}
                    rank={i + 4}
                    open={open === r.ticker}
                    onToggle={() => setOpen(open === r.ticker ? null : r.ticker)}
                    onOpen={openDetail}
                    lang={lang}
                    t={t}
                    setRef={(el) => {
                      if (el) refs.current.set(r.ticker, el);
                      else refs.current.delete(r.ticker);
                    }}
                  />
                ))}
              </div>
            </>
          ) : (
            /* per-sector leaderboards */
            <div className="space-y-7">
              {bySector.map(([sec, secRows]) => {
                const hue = sec === "__none" ? "#8aa0b2" : sectorHue(sec);
                return (
                  <section key={sec} className="rank-rise">
                    <div className="mb-3 flex items-center gap-2.5 border-b border-line pb-2">
                      <span className="h-3.5 w-1 flex-none rounded-full" style={{ background: hue, boxShadow: `0 0 8px ${hue}88` }} />
                      <h3 className="font-disp text-[15px] font-semibold tracking-tight" style={{ color: hue }}>
                        {sec === "__none" ? t("Unclassified", "未分类") : sectorLabel(sec, lang)}
                      </h3>
                      <span className="rounded-full bg-white/[0.06] px-1.5 py-[1px] font-mono text-[10.5px] text-muted2">{secRows.length}</span>
                    </div>
                    <div className="space-y-2">
                      {secRows.map((r, i) => (
                        <RankRow
                          key={r.ticker}
                          r={r}
                          rank={i + 1}
                          open={open === r.ticker}
                          onToggle={() => setOpen(open === r.ticker ? null : r.ticker)}
                          onOpen={openDetail}
                          lang={lang}
                          t={t}
                          setRef={() => {}}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          <p className="mt-5 text-[11px] leading-relaxed text-muted2">
            {t(
              `Composite = Conviction·${Math.round(lens.w.conv * 100)}% + Catalyst·${Math.round(lens.w.cat * 100)}% + Core·${Math.round(lens.w.core * 100)}% + Attention·${Math.round(lens.w.attn * 100)}%, each normalised 0-1 → 0-100. Bar segments show each signal's contribution.`,
              `综合分 = 语气·${Math.round(lens.w.conv * 100)}% + 催化·${Math.round(lens.w.cat * 100)}% + 核心·${Math.round(lens.w.core * 100)}% + 注意力·${Math.round(lens.w.attn * 100)}%,各归一 0-1 → 0-100。条形分段即各信号贡献。`,
            )}
          </p>
        </>
      )}
    </div>
  );
}
