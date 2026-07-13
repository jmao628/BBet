import { useMemo, useState } from "react";
import { useStore, useT } from "../../store";
import { buildFocus, buildShortlist, capLabel, sectorLabel, type ShortlistRow } from "../pipeline";
import { ViewHead, StatStrip } from "../ui";

const TOP_OPTS = [10, 15, 20, 25];

// Per-lens accent colours.
const LENS = {
  focus: "#3dd6c4",
  attn: "#5fb0e8",
  cat: "#48c78e",
} as const;

function breadthColor(b: number): string {
  return b >= 3 ? "#e9c46a" : b === 2 ? "#3dd6c4" : b === 1 ? "#8aa0b4" : "#4a5a6a";
}

// One lens cell: rank (# — green when top-N) over the raw value.
function Lens({
  label,
  rank,
  value,
  top,
  color,
  na,
}: {
  label: string;
  rank: number;
  value: string;
  top: boolean;
  color: string;
  na?: boolean;
}) {
  return (
    <div
      className="flex-1 rounded-lg border px-2.5 py-1.5 text-center transition-colors"
      style={{
        borderColor: top ? `${color}66` : "var(--line,#22303c)",
        background: top ? `${color}14` : "transparent",
      }}
    >
      <div className="text-[9px] uppercase tracking-wide text-muted2">{label}</div>
      {na ? (
        <div className="mt-0.5 font-mono text-[13px] font-semibold text-muted2">—</div>
      ) : (
        <>
          <div className="mt-0.5 font-mono text-[13px] font-semibold" style={{ color: top ? color : "#c7d2dc" }}>
            #{rank}
          </div>
          <div className="font-mono text-[9.5px] text-muted2">{value}</div>
        </>
      )}
    </div>
  );
}

function Row({ r, rank, lang, onOpen, t }: { r: ShortlistRow; rank: number; lang: "en" | "zh"; onOpen: (x: string) => void; t: (en: string, zh: string) => string }) {
  const bc = breadthColor(r.breadth);
  return (
    <div
      className="flex items-center gap-3 rounded-xl border bg-panel2 px-3 py-2.5 transition-[transform,border-color] duration-150 hover:-translate-y-0.5"
      style={{ borderColor: r.breadth >= 3 ? `${bc}55` : "var(--line,#22303c)" }}
    >
      <span className="w-6 flex-none text-right font-mono text-[11px] tabular-nums text-muted2">{rank}</span>

      {/* podium breadth badge */}
      <span
        className="grid h-9 w-9 flex-none place-items-center rounded-lg font-disp text-[15px] font-bold"
        style={{ color: r.breadth >= 1 ? "#0b0f14" : "#7b8da0", background: r.breadth >= 1 ? bc : "transparent", boxShadow: r.breadth >= 3 ? `0 0 10px ${bc}77` : undefined, border: r.breadth === 0 ? "1px solid var(--line,#22303c)" : "none" }}
        title={t(`top-N in ${r.breadth} of 3 lenses`, `三维中 ${r.breadth}/3 进前列`)}
      >
        {r.breadth}
      </span>

      {/* name */}
      <button onClick={() => onOpen(r.ticker)} className="min-w-0 flex-[1.4] text-left">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[14px] font-bold tracking-tight text-text transition-colors hover:text-signal">{r.ticker}</span>
          {r.breadth >= 3 && <span className="text-[10px] text-gold" title={t("top across all three lenses", "三维全进前列")}>★</span>}
        </div>
        <div className="truncate text-[10.5px] text-muted2">
          {r.company || "—"} · {capLabel(r.cap, lang)}
          {r.sector ? ` · ${sectorLabel(r.sector, lang)}` : ""}
        </div>
      </button>

      {/* three lenses */}
      <div className="flex flex-[2] items-stretch gap-1.5">
        <Lens label={t("Focus", "重点")} rank={r.focusRank} value={r.focusScore.toFixed(1)} top={r.focusTop} color={LENS.focus} />
        <Lens label={t("Attention", "注意力")} rank={r.attnRank} value={Math.round(r.attnScore).toString()} top={r.attnTop} color={LENS.attn} />
        <Lens label={t("Catalyst", "催化剂")} rank={r.catRank} value={r.catScore >= 0 ? r.catScore.toFixed(1) : "—"} top={r.catTop} color={LENS.cat} na={r.catScore < 0} />
      </div>

      {/* composite */}
      <div className="w-16 flex-none text-right">
        <div className="font-disp text-[16px] font-semibold" style={{ color: bc }}>{r.composite}</div>
        <div className="text-[8.5px] uppercase tracking-wide text-muted2">{t("composite", "综合")}</div>
      </div>
    </div>
  );
}

type Filter = "all" | "podium" | "two";

export function ShortlistView() {
  const data = useStore((s) => s.data);
  const heat = useStore((s) => s.heat);
  const technical = useStore((s) => s.technical);
  const sectors = useStore((s) => s.sectors);
  const supplychain = useStore((s) => s.supplychain);
  const marketCaps = useStore((s) => s.marketCaps);
  const catalyst = useStore((s) => s.catalyst);
  const openDetail = useStore((s) => s.openDetail);
  const lang = useStore((s) => s.lang);
  const t = useT();

  const [topN, setTopN] = useState(15);
  const [filter, setFilter] = useState<Filter>("two");
  const [sector, setSector] = useState<string | null>(null);

  const focus = useMemo(
    () => buildFocus(data, heat, technical, marketCaps, sectors, supplychain),
    [data, heat, technical, marketCaps, sectors, supplychain],
  );
  const rows = useMemo(() => buildShortlist(focus, catalyst, topN), [focus, catalyst, topN]);

  const podium = rows.filter((r) => r.breadth >= 3).length;
  const two = rows.filter((r) => r.breadth >= 2).length;
  const one = rows.filter((r) => r.breadth >= 1).length;

  const sectorCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.sector && r.breadth >= 1) m.set(r.sector, (m.get(r.sector) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const shown = useMemo(() => {
    let list = rows;
    if (filter === "podium") list = list.filter((r) => r.breadth >= 3);
    else if (filter === "two") list = list.filter((r) => r.breadth >= 2);
    else list = list.filter((r) => r.breadth >= 1); // "all" = anything that placed
    if (sector) list = list.filter((r) => r.sector === sector);
    return list;
  }, [rows, filter, sector]);

  const FILTERS: { k: Filter; label: string; n: number }[] = [
    { k: "podium", label: t("★ Podium 3/3", "★ 三维全中"), n: podium },
    { k: "two", label: t("2+ lenses", "≥2 维"), n: two },
    { k: "all", label: t("Placed (≥1)", "上榜(≥1)"), n: one },
  ];

  return (
    <div className="view-in">
      <ViewHead
        eyebrow={t("Stage 4 · Shortlist", "Stage 4 · 登顶广度")}
        title={t("Shortlist · Podium Breadth", "登顶广度 · 三维交集")}
        desc={t(
          `The catalyst score compresses at the top, so no single lens cleanly separates names. Instead each Focus name is RANKED in three independent lenses — Focus (buy × ecosystem) · Attention (price-volume) · Catalyst (TPMN) — and scored by how many it lands in the top ${topN} of. Names on the podium of 2-3 lenses are the clearest basket to carry into Conviction.`,
          `催化剂分在顶部太挤,单一维度分不开。于是每只 Focus 票在三个独立维度里各排一次名——重点(买入×生态) · 注意力(量价) · 催化剂(TPMN)——按"进了几个前 ${topN}"给广度分。三维里进 2-3 个前列的,就是带进管理层语气(Conviction)最明确的一篮。`,
        )}
      />

      {focus.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line2 bg-panel2 p-8 text-center text-[13px] text-muted">
          {t("No Focus List yet — run technical + supplychain first.", "暂无重点名单 —— 先跑 technical + supplychain。")}
        </div>
      ) : (
        <>
          <StatStrip
            stats={[
              { k: t("★ Podium 3/3", "★ 三维全中"), v: podium, d: t("top in all three lenses", "三维都进前列"), color: "#e9c46a" },
              { k: t("2+ lenses", "≥2 维"), v: two, d: t("the clear basket", "明确的一篮"), color: "#3dd6c4" },
              { k: t("Placed ≥1", "上榜 ≥1"), v: one, d: t(`top-${topN} in a lens`, `某维进前 ${topN}`) },
              { k: t("Catalyst cover", "催化剂覆盖"), v: `${rows.filter((r) => r.catScore >= 0).length}/${rows.length}` },
            ]}
          />

          {/* controls */}
          <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.k}
                  onClick={() => setFilter(f.k)}
                  className={`rounded-full border px-2.5 py-0.5 text-[12px] transition-colors ${
                    filter === f.k ? "border-signal/50 bg-signal/10 text-signal" : "border-line text-muted hover:text-text"
                  }`}
                >
                  {f.label} <span className="font-mono text-[11px] opacity-70">{f.n}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10.5px] uppercase tracking-wide text-muted2">{t("top", "前")}</span>
              {TOP_OPTS.map((n) => (
                <button
                  key={n}
                  onClick={() => setTopN(n)}
                  className={`rounded px-1.5 py-0.5 font-mono text-[11px] transition-colors ${
                    topN === n ? "bg-signal/15 text-signal" : "text-muted2 hover:text-text"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            {sector && (
              <button onClick={() => setSector(null)} className="rounded-full border border-signal/50 bg-signal/10 px-2.5 py-0.5 text-[12px] text-signal">
                {sectorLabel(sector, lang)} ✕
              </button>
            )}
            {!sector &&
              sectorCounts.slice(0, 7).map(([sec, n]) => (
                <button key={sec} onClick={() => setSector(sec)} className="rounded-full border border-line px-2.5 py-0.5 text-[12px] text-muted hover:text-text">
                  {sectorLabel(sec, lang)} {n}
                </button>
              ))}
          </div>

          {shown.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line2 bg-panel2 p-8 text-center text-[13px] text-muted">
              {t("No names match this filter.", "该筛选下没有匹配的票。")}
            </div>
          ) : (
            <div className="space-y-2">
              {shown.map((r, i) => (
                <Row key={r.ticker} r={r} rank={i + 1} lang={lang} onOpen={openDetail} t={t} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
