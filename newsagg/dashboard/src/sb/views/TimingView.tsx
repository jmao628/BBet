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
import { ViewHead, TimingBadge, SignalChips } from "../ui";
import type { TechTiming } from "../../types";

// Tone → accent, matched to the TimingBadge palette.
const TONE_COLOR: Record<"buy" | "watch" | "hot" | "idle", string> = {
  buy: "#5fe3a1",
  watch: "#f0c862",
  hot: "#c99bf0",
  idle: "#7f8f9e",
};
const stateColor = (s: TechTiming["timing"]): string => TONE_COLOR[TIMING_META[s].tone];
const isBuy = (s: TechTiming["timing"]): boolean => TIMING_BUY_STATES.includes(s);

// A horizontal Bollinger gauge: lower rail — MA20 tick — upper rail, with the
// price dot placed by %B. The band position at a glance.
function BandGauge({ pctb }: { pctb: number }) {
  // Map %B onto a 0..1 rail (a little headroom beyond each band).
  const pos = Math.max(0, Math.min(1, (pctb + 0.15) / 1.3));
  const midPos = (0.5 + 0.15) / 1.3;
  const color = pctb < 0.05 ? "#48c78e" : pctb > 1 ? "#c99bf0" : "#5fb0e8";
  return (
    <div className="w-full">
      <div className="relative h-[7px] w-full rounded-full" style={{ background: "linear-gradient(90deg, rgba(72,199,142,0.28), rgba(95,176,232,0.14) 50%, rgba(201,155,240,0.28))" }}>
        <span className="absolute top-[-3px] h-[13px] w-px bg-white/30" style={{ left: `${midPos * 100}%` }} />
        <span
          className="absolute top-1/2 h-[12px] w-[12px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#0b0f14]"
          style={{ left: `${pos * 100}%`, background: color, boxShadow: `0 0 10px ${color}` }}
        />
      </div>
    </div>
  );
}

// A featured card for the very best buy points (podium look, glowing).
function FeatureCard({ r, rank, lang, onOpen, t }: { r: TimingRow; rank: number; lang: "en" | "zh"; onOpen: (x: string) => void; t: (en: string, zh: string) => string }) {
  const tm = r.timing;
  const col = stateColor(tm.timing);
  const lifted = rank === 1;
  const showReb = tm.timing === "strong_buy" || tm.timing === "band_break" || tm.timing === "oversold_watch";
  return (
    <button
      onClick={() => onOpen(r.ticker)}
      className="rank-rise group relative flex flex-1 flex-col rounded-2xl border bg-panel2 px-4 pb-4 pt-4 text-left transition-[transform,box-shadow] duration-200 hover:-translate-y-1"
      style={{ borderColor: `${col}66`, boxShadow: lifted ? `0 0 34px ${col}33` : `0 0 18px ${col}22`, marginTop: lifted ? 0 : 16, background: `linear-gradient(180deg, ${col}16, transparent 62%)` }}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg font-disp text-[13px] font-bold" style={{ color: "#0b0f14", background: col, boxShadow: `0 0 14px ${col}88` }}>{rank}</span>
          <span className="font-disp text-[20px] font-bold tracking-tight text-text group-hover:text-signal">{r.ticker}</span>
        </div>
        <div className="text-right">
          <div className="font-disp text-[26px] font-bold leading-none tabular-nums" style={{ color: col }}>{tm.score}</div>
          <div className="text-[8.5px] uppercase tracking-wide text-muted2">{t("entry", "买点分")}</div>
        </div>
      </div>
      <div className="mb-2 truncate text-[10.5px] text-muted2">{r.company || "—"}{r.sector ? ` · ${sectorLabel(r.sector, lang)}` : ""} · {t("Tier", "档")} {r.tier}</div>
      <div className="mb-2"><TimingBadge timing={tm} size="md" /></div>
      <SignalChips signals={tm.signals} lang={lang} />
      <div className="mt-3 flex items-center gap-3">
        <div className="min-w-0 flex-1"><BandGauge pctb={tm.bb.pctb} /></div>
        <span className="flex-none font-mono text-[11px] text-muted">%B {tm.bb.pctb.toFixed(2)}</span>
      </div>
      {showReb && (
        <div className="mt-2 flex items-center gap-2 text-[10px] text-muted2">
          <span>{t("rebound", "反弹动能")}</span>
          <div className="h-[4px] flex-1 overflow-hidden rounded-full bg-inset">
            <span className="block h-full rounded-full" style={{ width: `${tm.rebound}%`, background: tm.rebound >= 50 ? "#48c78e" : "#f0c862" }} />
          </div>
          <span className="font-mono" style={{ color: tm.rebound >= 50 ? "#48c78e" : "#f0c862" }}>{tm.rebound}</span>
        </div>
      )}
    </button>
  );
}

function Row({ r, rank, lang, onOpen, t }: { r: TimingRow; rank: number; lang: "en" | "zh"; onOpen: (x: string) => void; t: (en: string, zh: string) => string }) {
  const tm = r.timing;
  const col = stateColor(tm.timing);
  const showReb = tm.timing === "strong_buy" || tm.timing === "band_break" || tm.timing === "oversold_watch";
  return (
    <div
      onClick={() => onOpen(r.ticker)}
      className="group flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-panel2 px-3 py-2.5 transition-[transform,border-color] duration-200 hover:-translate-y-0.5"
      style={{ borderColor: "var(--line,#22303c)" }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = `${col}55`)}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--line,#22303c)")}
    >
      <span className="w-6 flex-none text-right font-mono text-[12px] text-muted2">{rank}</span>

      {/* name + signal chips */}
      <div className="min-w-0 flex-[1.7]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-disp text-[15px] font-bold tracking-tight text-text group-hover:text-signal">{r.ticker}</span>
          <span className="truncate text-[10px] text-muted2">{r.company || "—"}{r.sector ? ` · ${sectorLabel(r.sector, lang)}` : ""} · {t("Tier", "档")} {r.tier}</span>
        </div>
        <div className="mt-1"><SignalChips signals={tm.signals} lang={lang} max={4} /></div>
      </div>

      {/* Bollinger gauge */}
      <div className="hidden w-[160px] flex-none md:block">
        <BandGauge pctb={tm.bb.pctb} />
        <div className="mt-1 flex justify-between text-[8.5px] uppercase tracking-wide text-muted2">
          <span>{t("lower", "下轨")}</span>
          <span className="text-muted">%B {tm.bb.pctb.toFixed(2)}</span>
          <span>{t("upper", "上轨")}</span>
        </div>
      </div>

      {/* rebound (buy-A) or MACD cross */}
      <div className="hidden w-[76px] flex-none text-right sm:block">
        {showReb ? (
          <>
            <div className="font-mono text-[14px] font-semibold" style={{ color: tm.rebound >= 50 ? "#48c78e" : "#f0c862" }}>{tm.rebound}</div>
            <div className="text-[8px] uppercase tracking-wide text-muted2">{t("rebound", "反弹动能")}</div>
          </>
        ) : (
          <>
            <div className="font-mono text-[12px] font-semibold" style={{ color: tm.macd.cross === "bull" ? "#48c78e" : "#ff5a78" }}>{tm.macd.cross === "bull" ? t("bull", "金叉") : t("bear", "死叉")}</div>
            <div className="text-[8px] uppercase tracking-wide text-muted2">MACD</div>
          </>
        )}
      </div>

      {/* entry score */}
      <div className="w-[52px] flex-none text-right">
        <div className="font-disp text-[17px] font-semibold leading-none" style={{ color: col }}>{tm.score}</div>
        <div className="text-[8px] uppercase tracking-wide text-muted2">{t("entry", "买点")}</div>
      </div>
    </div>
  );
}

function StateSection({ state, rows, lang, onOpen, t }: { state: TechTiming["timing"]; rows: TimingRow[]; lang: "en" | "zh"; onOpen: (x: string) => void; t: (en: string, zh: string) => string }) {
  const meta = TIMING_META[state];
  const col = stateColor(state);
  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center gap-2.5 border-b pb-2" style={{ borderColor: `${col}44` }}>
        <span className="h-3.5 w-1 flex-none rounded-full" style={{ background: col, boxShadow: `0 0 8px ${col}` }} />
        <h3 className="font-disp text-[15px] font-semibold tracking-tight" style={{ color: col }}>{lang === "zh" ? meta.zh : meta.en}</h3>
        <span className="rounded-full bg-white/[0.06] px-1.5 py-[1px] font-mono text-[10.5px] text-muted2">{rows.length}</span>
        <span className="ml-auto text-[10px] text-muted2">{lang === "zh" ? meta.hint.zh : meta.hint.en}</span>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <Row key={r.ticker} r={r} rank={i + 1} lang={lang} onOpen={onOpen} t={t} />
        ))}
      </div>
    </section>
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

  // The very best buy points across all buy states → the podium.
  const topBuys = useMemo(
    () => shown.filter((r) => isBuy(r.timing.timing)).sort((a, b) => b.timing.score - a.timing.score).slice(0, 3),
    [shown],
  );

  const buyCount = shown.filter((r) => isBuy(r.timing.timing)).length;
  const buyBreakdown = TIMING_BUY_STATES.map((st) => ({ st, n: byState.get(st)?.length ?? 0 })).filter((x) => x.n > 0);

  const sectorCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of board) if (r.sector) m.set(r.sector, (m.get(r.sector) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [board]);

  const statesToShow = TIMING_ORDER.filter((s) => s !== "neutral");

  return (
    <div className="view-in">
      <ViewHead
        eyebrow={t("Final · Buy Timing", "终章 · 择时买点")}
        title={t("Buy Timing · Bollinger + MACD", "择时买点 · 布林带 + MACD")}
        desc={t(
          "A buy-only entry overlay on the vetted names: the funnel decided the company is good — this decides whether NOW is a good price. Each name carries its signal receipts (broke lower band, MACD turned, RSI divergence, …). It never filters; a good name at a bad price simply waits.",
          "在已筛出的好公司上叠加的『只做买点』择时:漏斗决定了公司好不好,这里决定现在是不是好价格。每只票都标出它的信号凭据(跌破下轨、MACD 拐头、RSI 底背离……)。它从不做筛选;好公司但价格不好,就等。",
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
          {/* hero: buy count + buy-state distribution */}
          <div className="mb-5 overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-[#48c78e14] to-transparent p-5">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              <div className="flex items-baseline gap-2.5">
                <span className="font-disp text-[44px] font-bold leading-none" style={{ color: "#5fe3a1" }}>{buyCount}</span>
                <div className="leading-tight">
                  <div className="text-[13px] font-semibold text-text">{t("names are a BUY right now", "只票现在是买点")}</div>
                  <div className="text-[11px] text-muted2">{t(`of ${board.length} vetted names scored`, `共 ${board.length} 只入围票已打分`)}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {buyBreakdown.map(({ st, n }) => (
                  <div key={st} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1" style={{ borderColor: `${stateColor(st)}44`, background: `${stateColor(st)}10` }}>
                    <span className="h-2 w-2 rounded-full" style={{ background: stateColor(st) }} />
                    <span className="text-[11px] font-medium text-text">{lang === "zh" ? TIMING_META[st].zh : TIMING_META[st].en}</span>
                    <span className="font-mono text-[12px] font-semibold" style={{ color: stateColor(st) }}>{n}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* podium — the strongest buy points */}
          {topBuys.length >= 2 && (
            <div className="mb-6 flex items-start gap-3">
              {topBuys[1] && <FeatureCard r={topBuys[1]} rank={2} lang={lang} onOpen={openDetail} t={t} />}
              <FeatureCard r={topBuys[0]} rank={1} lang={lang} onOpen={openDetail} t={t} />
              {topBuys[2] && <FeatureCard r={topBuys[2]} rank={3} lang={lang} onOpen={openDetail} t={t} />}
            </div>
          )}

          {/* sector filter */}
          <div className="mb-5 flex flex-wrap items-center gap-1.5">
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
