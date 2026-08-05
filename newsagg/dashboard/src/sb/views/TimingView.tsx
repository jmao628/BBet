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

type TabKey = TechTiming["timing"] | "buys";

// Tone → accent, matched to the TimingBadge palette.
const TONE_COLOR: Record<string, string> = {
  buy: "#5fe3a1",
  watch: "#f0c862",
  hot: "#c99bf0",
  idle: "#7f8f9e",
  sell: "#ff6b81",
  trim: "#e8935f",
};
const stateColor = (s: TechTiming["timing"]): string => TONE_COLOR[TIMING_META[s].tone] ?? "#7f8f9e";
const hasReb = (s: TechTiming["timing"]): boolean => s === "strong_buy" || s === "band_break" || s === "oversold_watch";
const isSell = (s: TechTiming["timing"]): boolean => s === "breakdown" || s === "trim";

// A horizontal Bollinger gauge: lower rail — MA20 tick — upper rail, dot by %B.
function BandGauge({ pctb }: { pctb: number }) {
  const pos = Math.max(0, Math.min(1, (pctb + 0.15) / 1.3));
  const midPos = (0.5 + 0.15) / 1.3;
  const color = pctb < 0.05 ? "#48c78e" : pctb > 1 ? "#c99bf0" : "#5fb0e8";
  return (
    <div className="w-full">
      <div className="relative h-[7px] w-full rounded-full" style={{ background: "linear-gradient(90deg, rgba(72,199,142,0.28), rgba(95,176,232,0.14) 50%, rgba(201,155,240,0.28))" }}>
        <span className="absolute top-[-3px] h-[13px] w-px bg-white/30" style={{ left: `${midPos * 100}%` }} />
        <span
          className="absolute top-1/2 h-[12px] w-[12px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#0b0f14] transition-[left] duration-500"
          style={{ left: `${pos * 100}%`, background: color, boxShadow: `0 0 10px ${color}` }}
        />
      </div>
    </div>
  );
}

// A featured card for the strongest buy points (podium look, glowing).
function FeatureCard({ r, rank, lang, onOpen, t }: { r: TimingRow; rank: number; lang: "en" | "zh"; onOpen: (x: string) => void; t: (en: string, zh: string) => string }) {
  const tm = r.timing;
  const col = stateColor(tm.timing);
  const lifted = rank === 1;
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
          <div className="text-[8.5px] uppercase tracking-wide text-muted2">{isSell(tm.timing) ? t("de-risk", "减仓分") : t("entry", "买点分")}</div>
        </div>
      </div>
      <div className="mb-2 truncate text-[10.5px] text-muted2">{r.company || "—"}{r.sector ? ` · ${sectorLabel(r.sector, lang)}` : ""} · {t("Tier", "档")} {r.tier}</div>
      <div className="mb-2"><TimingBadge timing={tm} size="md" /></div>
      <SignalChips signals={tm.signals} lang={lang} />
      <div className="mt-3 flex items-center gap-3">
        <div className="min-w-0 flex-1"><BandGauge pctb={tm.bb.pctb} /></div>
        <span className="flex-none font-mono text-[11px] text-muted">%B {tm.bb.pctb.toFixed(2)}</span>
      </div>
      {hasReb(tm.timing) && (
        <div className="mt-2 flex items-center gap-2 text-[10px] text-muted2">
          <span>{t("rebound", "反弹动能")}</span>
          <div className="h-[4px] flex-1 overflow-hidden rounded-full bg-inset">
            <span className="block h-full rounded-full transition-[width] duration-700" style={{ width: `${tm.rebound}%`, background: tm.rebound >= 50 ? "#48c78e" : "#f0c862" }} />
          </div>
          <span className="font-mono" style={{ color: tm.rebound >= 50 ? "#48c78e" : "#f0c862" }}>{tm.rebound}</span>
        </div>
      )}
      {isSell(tm.timing) && (
        <div className="mt-2 flex items-center gap-2 text-[10px] text-muted2">
          <span>{t("breakdown", "破位强度")}</span>
          <div className="h-[4px] flex-1 overflow-hidden rounded-full bg-inset">
            <span className="block h-full rounded-full transition-[width] duration-700" style={{ width: `${tm.breakdown}%`, background: col }} />
          </div>
          <span className="font-mono" style={{ color: col }}>{tm.breakdown}</span>
        </div>
      )}
    </button>
  );
}

function Row({ r, rank, lang, onOpen, t }: { r: TimingRow; rank: number; lang: "en" | "zh"; onOpen: (x: string) => void; t: (en: string, zh: string) => string }) {
  const tm = r.timing;
  const col = stateColor(tm.timing);
  return (
    <div
      onClick={() => onOpen(r.ticker)}
      className="group flex cursor-pointer items-center gap-3 rounded-xl border bg-panel2 px-3 py-2.5 transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5"
      style={{ borderColor: "var(--line,#22303c)" }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${col}66`; e.currentTarget.style.boxShadow = `0 0 16px ${col}18`; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--line,#22303c)"; e.currentTarget.style.boxShadow = "none"; }}
    >
      <span className="grid h-7 w-7 flex-none place-items-center rounded-lg font-mono text-[12px] font-semibold" style={{ color: rank <= 3 ? "#0b0f14" : "#c7d2dc", background: rank <= 3 ? col : "transparent", border: rank <= 3 ? "none" : "1px solid var(--line2,#2b3a48)" }}>{rank}</span>

      {/* name + state badge + signal chips */}
      <div className="min-w-0 flex-[1.7]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-disp text-[15px] font-bold tracking-tight text-text group-hover:text-signal">{r.ticker}</span>
          <TimingBadge timing={tm} />
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

      {/* rebound (buy) · breakdown (sell) · or MACD cross */}
      <div className="hidden w-[76px] flex-none text-right sm:block">
        {hasReb(tm.timing) ? (
          <>
            <div className="font-mono text-[14px] font-semibold" style={{ color: tm.rebound >= 50 ? "#48c78e" : "#f0c862" }}>{tm.rebound}</div>
            <div className="text-[8px] uppercase tracking-wide text-muted2">{t("rebound", "反弹动能")}</div>
          </>
        ) : isSell(tm.timing) ? (
          <>
            <div className="font-mono text-[14px] font-semibold" style={{ color: col }}>{tm.breakdown}</div>
            <div className="text-[8px] uppercase tracking-wide text-muted2">{t("breakdown", "破位强度")}</div>
          </>
        ) : (
          <>
            <div className="font-mono text-[12px] font-semibold" style={{ color: tm.macd.cross === "bull" ? "#48c78e" : "#ff5a78" }}>{tm.macd.cross === "bull" ? t("bull", "金叉") : t("bear", "死叉")}</div>
            <div className="text-[8px] uppercase tracking-wide text-muted2">MACD</div>
          </>
        )}
      </div>

      {/* score */}
      <div className="w-[52px] flex-none text-right">
        <div className="font-disp text-[17px] font-semibold leading-none" style={{ color: col }}>{tm.score}</div>
        <div className="text-[8px] uppercase tracking-wide text-muted2">{isSell(tm.timing) ? t("de-risk", "减仓") : t("entry", "买点")}</div>
      </div>
    </div>
  );
}

// A big, clickable state filter — the primary navigation (jump to a category
// without scrolling). Active tab glows in its state color.
function StateTab({ label, count, color, active, onClick }: { label: string; count: number; color: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="relative flex items-center gap-2 rounded-xl border px-3 py-2 transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5"
      style={{
        borderColor: active ? color : `${color}33`,
        background: active ? `linear-gradient(130deg, ${color}26, ${color}0a)` : "transparent",
        boxShadow: active ? `0 0 18px ${color}33` : undefined,
      }}
    >
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color, boxShadow: active ? `0 0 8px ${color}` : undefined }} />
      <span className="text-[12.5px] font-semibold tracking-tight" style={{ color: active ? color : "#c7d2dc" }}>{label}</span>
      <span className="font-disp text-[16px] font-bold tabular-nums" style={{ color: active ? color : "#6f7f8e" }}>{count}</span>
    </button>
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

  const [tab, setTab] = useState<TabKey>("buys");
  const [sector, setSector] = useState<string | null>(null);

  const focus = useMemo(
    () => buildFocus(data, heat, technical, marketCaps, sectors, supplychain),
    [data, heat, technical, marketCaps, sectors, supplychain],
  );
  const shortlist = useMemo(() => buildShortlist(focus, catalyst), [focus, catalyst]);
  const board = useMemo(() => buildTimingBoard(shortlist, technical), [shortlist, technical]);

  const shown = useMemo(() => (sector ? board.filter((r) => r.sector === sector) : board), [board, sector]);

  const counts = useMemo(() => {
    const m = new Map<TechTiming["timing"], number>();
    for (const r of shown) m.set(r.timing.timing, (m.get(r.timing.timing) ?? 0) + 1);
    return m;
  }, [shown]);
  const buyCount = TIMING_BUY_STATES.reduce((s, st) => s + (counts.get(st) ?? 0), 0);

  // Tabs: "All Buys" first, then each populated state in funnel order.
  const tabs = useMemo(() => {
    const out: { key: TabKey; label: string; count: number; color: string }[] = [
      { key: "buys", label: lang === "zh" ? "全部买点" : "All Buys", count: buyCount, color: "#5fe3a1" },
    ];
    for (const st of TIMING_ORDER) {
      if (st === "neutral" || st === "breakdown" || st === "trim") continue; // sells live on the Risk page
      const c = counts.get(st) ?? 0;
      if (c === 0) continue;
      out.push({ key: st, label: lang === "zh" ? TIMING_META[st].zh : TIMING_META[st].en, count: c, color: stateColor(st) });
    }
    return out;
  }, [counts, buyCount, lang]);

  // If the active tab emptied out (sector switch), fall back to "buys".
  const activeTab: TabKey = tabs.some((x) => x.key === tab) ? tab : "buys";
  const activeStates: TechTiming["timing"][] = activeTab === "buys" ? TIMING_BUY_STATES : [activeTab];

  // The rows for the current selection, one combined list ranked by entry score.
  const rows = useMemo(
    () => shown.filter((r) => activeStates.includes(r.timing.timing)).sort((a, b) => b.timing.score - a.timing.score),
    [shown, activeStates],
  );
  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);

  const sectorCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of board) if (r.sector) m.set(r.sector, (m.get(r.sector) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [board]);

  return (
    <div className="view-in">
      <ViewHead
        eyebrow={t("Final · Buy Timing", "终章 · 择时买点")}
        title={t("Buy Timing · Bollinger + MACD", "择时买点 · 布林带 + MACD")}
        desc={t(
          "An entry-timing overlay on the vetted names: the funnel decided the company is good — this decides whether NOW is a good price. Mostly buy points (broke lower band, MACD turned, RSI divergence, …), plus de-risk WARNINGS when a name breaks down through MA20 with momentum falling — a trim signal, never a forced exit. Refreshes daily with new prices.",
          "在已筛出的好公司上叠加的择时:漏斗决定了公司好不好,这里决定现在是不是好价格。主要是买点(跌破下轨、MACD 拐头、RSI 底背离……),另有跌破 MA20、动能向下时的**减仓预警**——只提示去风险,不强制清仓。每日随新价格自动重排。",
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
          {/* hero */}
          <div className="mb-4 overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-[#48c78e14] to-transparent p-5">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
              <div className="flex items-baseline gap-2.5">
                <span className="font-disp text-[44px] font-bold leading-none" style={{ color: "#5fe3a1" }}>{buyCount}</span>
                <div className="leading-tight">
                  <div className="text-[13px] font-semibold text-text">{t("names are a BUY right now", "只票现在是买点")}</div>
                  <div className="text-[11px] text-muted2">{t(`of ${board.length} vetted names · re-scored daily`, `共 ${board.length} 只入围票 · 每日重排`)}</div>
                </div>
              </div>
            </div>
          </div>

          {/* STATE FILTER BUTTONS — jump to a category without scrolling */}
          <div className="mb-4 flex flex-wrap gap-2">
            {tabs.map((x) => (
              <StateTab key={x.key} label={x.label} count={x.count} color={x.color} active={activeTab === x.key} onClick={() => setTab(x.key)} />
            ))}
          </div>

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

          {/* the board — re-animates on every tab/sector change */}
          <div key={`${activeTab}-${sector ?? "all"}`} className="view-in">
            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line2 bg-panel2 p-8 text-center text-[13px] text-muted">
                {t("No names in this category right now.", "该分类当前没有票。")}
              </div>
            ) : (
              <>
                {podium.length >= 2 && (
                  <div className="mb-5 flex items-start gap-3">
                    {podium[1] && <FeatureCard r={podium[1]} rank={2} lang={lang} onOpen={openDetail} t={t} />}
                    <FeatureCard r={podium[0]} rank={1} lang={lang} onOpen={openDetail} t={t} />
                    {podium[2] && <FeatureCard r={podium[2]} rank={3} lang={lang} onOpen={openDetail} t={t} />}
                  </div>
                )}
                <div className="space-y-2">
                  {(podium.length >= 2 ? rest : rows).map((r, i) => (
                    <Row key={r.ticker} r={r} rank={(podium.length >= 2 ? 3 : 0) + i + 1} lang={lang} onOpen={openDetail} t={t} />
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
