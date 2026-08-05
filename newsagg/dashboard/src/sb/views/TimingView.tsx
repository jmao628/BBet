import { useMemo, useState } from "react";
import { useStore, useT } from "../../store";
import {
  buildFocus,
  buildShortlist,
  buildTimingBoard,
  sectorLabel,
  TIMING_META,
  TIMING_ORDER,
  TIMING_BUY_STATES,
  type TimingRow,
} from "../pipeline";
import { ViewHead, TimingBadge } from "../ui";
import type { TechTiming } from "../../types";

// Section accent per state tone, matched to the TimingBadge palette.
const TONE_COLOR: Record<"buy" | "watch" | "hot" | "idle", string> = {
  buy: "#5fe3a1",
  watch: "#f0c862",
  hot: "#c99bf0",
  idle: "#7f8f9e",
};

function pctbBar(pctb: number): { label: string; color: string; pos: number } {
  // Map %B onto a 0..1 rail position (clamped a bit beyond the bands).
  const pos = Math.max(0, Math.min(1, (pctb + 0.15) / 1.3));
  const color = pctb < 0.05 ? "#48c78e" : pctb > 1 ? "#c99bf0" : "#5fb0e8";
  return { label: pctb.toFixed(2), color, pos };
}

function Row({
  r,
  rank,
  lang,
  onOpen,
  t,
}: {
  r: TimingRow;
  rank: number;
  lang: "en" | "zh";
  onOpen: (x: string) => void;
  t: (en: string, zh: string) => string;
}) {
  const tm = r.timing;
  const pb = pctbBar(tm.bb.pctb);
  const showReb = tm.timing === "strong_buy" || tm.timing === "band_break" || tm.timing === "oversold_watch";
  return (
    <div
      onClick={() => onOpen(r.ticker)}
      className="group flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-panel2 px-3 py-2.5 transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-signal/40"
    >
      <span className="w-6 flex-none text-right font-mono text-[12px] text-muted2">{rank}</span>

      <div className="min-w-0 flex-[1.4]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-disp text-[15px] font-bold tracking-tight text-text group-hover:text-signal">{r.ticker}</span>
          <TimingBadge timing={tm} />
          {tm.divergence && <span className="text-[9px] text-signal" title="RSI bullish divergence">◈</span>}
          {tm.squeeze && <span className="text-[9px] text-gold" title="Bollinger squeeze">⧗</span>}
        </div>
        <div className="mt-0.5 truncate text-[10.5px] text-muted2">
          {r.company || "—"}
          {r.sector ? ` · ${sectorLabel(r.sector, lang)}` : ""} · {t("Tier", "档")} {r.tier}
        </div>
      </div>

      {/* %B position on the band rail */}
      <div className="hidden w-[150px] flex-none md:block">
        <div className="mb-1 flex items-baseline justify-between text-[8.5px] uppercase tracking-wide text-muted2">
          <span>{t("lower", "下轨")}</span>
          <span className="text-muted">%B {pb.label}</span>
          <span>{t("upper", "上轨")}</span>
        </div>
        <div className="relative h-[6px] w-full rounded-full bg-inset">
          {/* mid (MA20) marker */}
          <span className="absolute top-[-2px] h-[10px] w-px bg-white/25" style={{ left: `${((0.5 + 0.15) / 1.3) * 100}%` }} />
          <span className="absolute top-1/2 h-[10px] w-[10px] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${pb.pos * 100}%`, background: pb.color, boxShadow: `0 0 8px ${pb.color}aa` }} />
        </div>
      </div>

      {/* rebound momentum (buy-A) or MACD state */}
      <div className="hidden w-[92px] flex-none text-right sm:block">
        {showReb ? (
          <>
            <div className="font-mono text-[15px] font-semibold" style={{ color: tm.rebound >= 50 ? "#48c78e" : "#f0c862" }}>{tm.rebound}</div>
            <div className="text-[8.5px] uppercase tracking-wide text-muted2">{t("rebound", "反弹动能")}</div>
          </>
        ) : (
          <>
            <div className="font-mono text-[13px] font-semibold" style={{ color: tm.macd.cross === "bull" ? "#48c78e" : "#ff5a78" }}>
              {tm.macd.cross === "bull" ? t("bull", "金叉") : t("bear", "死叉")}
            </div>
            <div className="text-[8.5px] uppercase tracking-wide text-muted2">MACD</div>
          </>
        )}
      </div>

      {/* entry score */}
      <div className="w-[56px] flex-none text-right">
        <div className="font-disp text-[17px] font-semibold leading-none" style={{ color: TONE_COLOR[TIMING_META[tm.timing].tone] }}>{tm.score}</div>
        <div className="text-[8.5px] uppercase tracking-wide text-muted2">{t("entry", "买点")}</div>
      </div>
    </div>
  );
}

function StateSection({
  state,
  rows,
  lang,
  onOpen,
  t,
}: {
  state: TechTiming["timing"];
  rows: TimingRow[];
  lang: "en" | "zh";
  onOpen: (x: string) => void;
  t: (en: string, zh: string) => string;
}) {
  const meta = TIMING_META[state];
  const color = TONE_COLOR[meta.tone];
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
        <span className="font-disp text-[14px] font-semibold" style={{ color }}>{lang === "zh" ? meta.zh : meta.en}</span>
        <span className="font-mono text-[12px] text-muted2">{rows.length}</span>
        <span className="text-[10.5px] text-muted2">· {lang === "zh" ? meta.hint.zh : meta.hint.en}</span>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <Row key={r.ticker} r={r} rank={i + 1} lang={lang} onOpen={onOpen} t={t} />
        ))}
      </div>
    </div>
  );
}

export function TimingView() {
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

  const [sector, setSector] = useState<string | null>(null);
  const [buysOnly, setBuysOnly] = useState(false);

  const focus = useMemo(
    () => buildFocus(data, heat, technical, marketCaps, sectors, supplychain),
    [data, heat, technical, marketCaps, sectors, supplychain],
  );
  const shortlist = useMemo(() => buildShortlist(focus, catalyst), [focus, catalyst]);
  const board = useMemo(() => buildTimingBoard(shortlist, technical), [shortlist, technical]);

  const shown = useMemo(() => (sector ? board.filter((r) => r.sector === sector) : board), [board, sector]);
  const byState = useMemo(() => {
    const m = new Map<TechTiming["timing"], TimingRow[]>();
    for (const r of shown) {
      const arr = m.get(r.timing.timing) ?? [];
      arr.push(r);
      m.set(r.timing.timing, arr);
    }
    return m;
  }, [shown]);

  const buyCount = TIMING_BUY_STATES.reduce((s, st) => s + (byState.get(st)?.length ?? 0), 0);

  const sectorCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of board) if (r.sector) m.set(r.sector, (m.get(r.sector) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [board]);

  const statesToShow = buysOnly ? TIMING_BUY_STATES : TIMING_ORDER.filter((s) => s !== "neutral");

  return (
    <div className="view-in">
      <ViewHead
        eyebrow={t("Final · Buy Timing", "终章 · 择时买点")}
        title={t("Buy Timing · Bollinger + MACD", "择时买点 · 布林带 + MACD")}
        desc={t(
          "A buy-only entry overlay on the vetted names: the funnel already decided a company is good — this decides whether NOW is a good price. Two setups — buy oversold weakness once the bounce confirms (Strong Buy), or buy the pullback back into the bands after a breakout (Pullback Buy). It never filters; a good name at a bad price simply waits.",
          "在已筛出的好公司上叠加的『只做买点』择时:漏斗决定了公司好不好,这里决定现在是不是好价格。两个买点——超卖见底、反弹确认后买入(强买入),或突破后回落进轨道再买(强势回踩)。它从不做筛选;好公司但价格不好,就等。",
        )}
      />

      {board.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line2 bg-panel2 p-8 text-center text-[13px] text-muted">
          {t("No entry-timing data yet. Run ", "暂无择时数据。在 Mac 上运行 ")}
          <code className="font-mono text-signal">python -m newsagg.technical</code>
          {t(" on the Mac.", " 后自动出现。")}
        </div>
      ) : (
        <>
          {/* actionable summary */}
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel2 px-4 py-3">
            <div className="flex items-baseline gap-2">
              <span className="font-disp text-[26px] font-bold leading-none text-signal">{buyCount}</span>
              <span className="text-[12px] text-muted">{t("names are a BUY right now", "只票现在是买点")}</span>
            </div>
            <span className="text-muted2">·</span>
            <span className="text-[12px] text-muted2">{t(`${board.length} vetted names scored`, `已对 ${board.length} 只入围票打分`)}</span>
          </div>

          {/* filters */}
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <span className="text-[10.5px] text-muted2">{t("Sector:", "板块:")}</span>
            <button
              onClick={() => setSector(null)}
              className={`rounded-full border px-2.5 py-0.5 text-[12px] transition-colors ${sector === null ? "border-signal/50 bg-signal/10 text-signal" : "border-line text-muted hover:text-text"}`}
            >
              {t("All", "全部")} {board.length}
            </button>
            {sectorCounts.slice(0, 8).map(([sec, n]) => (
              <button
                key={sec}
                onClick={() => setSector(sector === sec ? null : sec)}
                className={`rounded-full border px-2.5 py-0.5 text-[12px] transition-colors ${sector === sec ? "border-signal/50 bg-signal/10 text-signal" : "border-line text-muted hover:text-text"}`}
              >
                {sectorLabel(sec, lang)} {n}
              </button>
            ))}
            <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[12px] text-muted">
              <input type="checkbox" checked={buysOnly} onChange={(e) => setBuysOnly(e.target.checked)} className="accent-signal" />
              {t("Buy signals only", "只看买点")}
            </label>
          </div>

          {statesToShow.map((st) => {
            const rows = byState.get(st) ?? [];
            if (rows.length === 0) return null;
            return <StateSection key={st} state={st} rows={rows} lang={lang} onOpen={openDetail} t={t} />;
          })}

          {statesToShow.every((st) => (byState.get(st)?.length ?? 0) === 0) && (
            <div className="rounded-xl border border-dashed border-line2 bg-panel2 p-8 text-center text-[13px] text-muted">
              {t("No names in these states right now.", "当前没有符合的票。")}
            </div>
          )}
        </>
      )}
    </div>
  );
}
