import { useEffect, useMemo, useState } from "react";
import { useStore, useT } from "../../store";
import { buildFocus, buildShortlist } from "../pipeline";
import {
  ENTRY_META,
  optimize,
  runBacktest,
  type BtParams,
  type BtResult,
  type EntryKind,
  type SweepResult,
} from "../backtest";
import { ViewHead } from "../ui";

const GOOD = "#48c78e";
const BAD = "#e0785a";
const pctS = (v: number, d = 1): string => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`;

const DEFAULT_P: BtParams = { entry: "breakout", lookback: 10, threshold: 0.05, holdDays: 5, stopLoss: 0.05, takeProfit: 0.12 };
const STORE_KEY = "midea.backtest.v1";
function loadParams(): BtParams {
  try {
    const s = localStorage.getItem(STORE_KEY);
    if (s) return { ...DEFAULT_P, ...(JSON.parse(s) as Partial<BtParams>) };
  } catch {
    /* ignore */
  }
  return DEFAULT_P;
}

function Slider({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt: (v: number) => string }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11px] text-muted2">{label}</span>
        <span className="font-mono text-[12px] font-semibold text-text">{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" style={{ accentColor: "var(--signal, #3dd6c4)" }} />
    </label>
  );
}

function Tile({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel2 px-3.5 py-3">
      <div className="text-[10px] uppercase tracking-wide text-muted2">{label}</div>
      <div className="mt-1 font-disp text-[22px] font-bold leading-none tabular-nums" style={{ color: color ?? "var(--text)" }}>{value}</div>
      {sub && <div className="mt-1 text-[10px] text-muted2">{sub}</div>}
    </div>
  );
}

function EquityCurve({ equity, sig }: { equity: number[]; sig: string }) {
  if (equity.length < 2) return <div className="grid h-56 place-items-center text-[12px] text-muted2">no trades under these rules</div>;
  const W = 100, H = 100;
  const min = Math.min(...equity, 0);
  const max = Math.max(...equity, 0);
  const x = (i: number) => (i / (equity.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / (max - min || 1)) * H;
  const pts = equity.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`);
  const line = "M" + pts.join(" L");
  const area = `M${x(0)},${H} L` + pts.join(" L") + ` L${x(equity.length - 1)},${H} Z`;
  const up = equity[equity.length - 1] >= 0;
  const col = up ? GOOD : BAD;
  const yb = y(0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-56 w-full">
      <defs>
        <linearGradient id="eqg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={col} stopOpacity="0.24" />
          <stop offset="1" stopColor={col} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" y1={yb} x2={W} y2={yb} stroke="var(--line2,#2b3a48)" strokeWidth="0.5" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      <path d={area} fill="url(#eqg)" />
      <path key={sig} d={line} className="bt-draw" fill="none" stroke={col} strokeWidth="1.6" pathLength={1} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function Histogram({ hist }: { hist: BtResult["hist"] }) {
  const maxC = Math.max(1, ...hist.map((b) => b.count));
  const lab = (lo: number, hi: number) => {
    if (lo === -Infinity) return `<${Math.round(hi * 100)}`;
    if (hi === Infinity) return `>${Math.round(lo * 100)}`;
    return `${Math.round(lo * 100)}`;
  };
  return (
    <div className="flex h-32 items-end gap-1">
      {hist.map((b, i) => {
        const col = b.hi <= 0 ? BAD : GOOD;
        return (
          <div key={i} className="flex flex-1 flex-col items-center justify-end">
            <span className="mb-1 font-mono text-[9px] text-muted2">{b.count || ""}</span>
            <div className="w-full rounded-t transition-[height] duration-500" style={{ height: `${(b.count / maxC) * 100}%`, minHeight: b.count ? 2 : 0, background: col, opacity: 0.9 }} />
            <span className="mt-1 font-mono text-[8px] text-muted2">{lab(b.lo, b.hi)}</span>
          </div>
        );
      })}
    </div>
  );
}

function Heatmap({ sweep, onPick, t }: { sweep: SweepResult; onPick: (hold: number, colKey: SweepResult["cols"]["key"], colVal: number) => void; t: (en: string, zh: string) => string }) {
  const maxAbs = Math.max(0.005, ...sweep.cells.flat().map((c) => Math.abs(c.avg)));
  return (
    <div className="overflow-x-auto">
      <div className="inline-grid gap-1" style={{ gridTemplateColumns: `auto repeat(${sweep.cols.values.length}, minmax(52px, 1fr))` }}>
        <div />
        {sweep.cols.values.map((cv) => (
          <div key={cv} className="pb-1 text-center font-mono text-[10px] text-muted2">{sweep.cols.fmt(cv)}</div>
        ))}
        {sweep.cells.map((row, r) => (
          <div key={r} className="contents">
            <div className="flex items-center justify-end pr-1.5 font-mono text-[10px] text-muted2">{sweep.rows.fmt(sweep.rows.values[r])}</div>
            {row.map((cell, c) => {
              const isBest = sweep.best?.r === r && sweep.best?.c === c;
              const bg = cell.avg >= 0 ? `rgba(72,199,142,${(cell.avg / maxAbs) * 0.6 + 0.06})` : `rgba(224,120,90,${(Math.abs(cell.avg) / maxAbs) * 0.6 + 0.06})`;
              return (
                <button
                  key={c}
                  onClick={() => onPick(sweep.rows.values[r], sweep.cols.key, cell.cv)}
                  title={`${cell.n} trades`}
                  className="grid h-11 place-items-center rounded-md text-[11px] font-semibold tabular-nums transition-transform hover:scale-[1.05]"
                  style={{ background: bg, color: "#e9eef3", outline: isBest ? "2px solid #f0c862" : "none", boxShadow: isBest ? "0 0 14px #f0c86255" : undefined }}
                >
                  {cell.n < 5 ? "·" : pctS(cell.avg, 1)}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 text-[10px] text-muted2">{t("Cell = avg return per trade under those exit rules. Gold = best (≥8 trades). Click to apply.", "格子 = 该退出参数下每笔平均收益。金框 = 最优(≥8 笔)。点击套用。")}</div>
    </div>
  );
}

function Spark({ c }: { c: number[] | undefined }) {
  if (!c || c.length < 2) return null;
  const min = Math.min(...c);
  const max = Math.max(...c);
  const pts = c.map((v, i) => `${((i / (c.length - 1)) * 100).toFixed(1)},${(28 - ((v - min) / (max - min || 1)) * 26).toFixed(1)}`).join(" ");
  const up = c[c.length - 1] >= c[0];
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-6 w-20">
      <polyline points={pts} fill="none" stroke={up ? GOOD : BAD} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const UNIS = [
  { key: "mylist", en: "My list", zh: "我的清单" },
  { key: "focus", en: "Focus List", zh: "重点名单" },
  { key: "tier1", en: "Shortlist T1", zh: "登顶金档" },
  { key: "tier2", en: "Shortlist T1+2", zh: "登顶金+银" },
  { key: "all", en: "All priced", zh: "全部有价" },
] as const;
type UniKey = (typeof UNIS)[number]["key"];
const WATCH_KEY = "midea.backtest.watch.v1";

export function BacktestView() {
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

  const [p, setP] = useState<BtParams>(loadParams);
  const [uni, setUni] = useState<UniKey>("tier2");
  const [sweep, setSweep] = useState<SweepResult | null>(null);
  const [watchText, setWatchText] = useState<string>(() => {
    try {
      return localStorage.getItem(WATCH_KEY) ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
  }, [p]);
  useEffect(() => {
    try {
      localStorage.setItem(WATCH_KEY, watchText);
    } catch {
      /* ignore */
    }
  }, [watchText]);

  // My-list tickers, parsed from the free-text box (comma / space / newline).
  const myList = useMemo(() => [...new Set(watchText.toUpperCase().split(/[^A-Z0-9.]+/).filter(Boolean))], [watchText]);

  const universes = useMemo(() => {
    const focus = buildFocus(data, heat, technical, marketCaps, sectors, supplychain);
    const shortlist = buildShortlist(focus, catalyst);
    return {
      mylist: myList,
      focus: focus.map((f) => f.ticker),
      tier1: shortlist.filter((r) => r.tier === 1).map((r) => r.ticker),
      tier2: shortlist.filter((r) => r.tier <= 2).map((r) => r.ticker),
      all: Object.keys(technical?.tickers ?? {}),
    } as Record<UniKey, string[]>;
  }, [data, heat, technical, marketCaps, sectors, supplychain, catalyst, myList]);

  const tickers = universes[uni];
  const res = useMemo(() => runBacktest(technical, tickers, p), [technical, tickers, p]);
  const sig = `${uni}|${p.entry}|${p.lookback}|${p.threshold}|${p.holdDays}|${p.stopLoss}|${p.takeProfit}|${res.n}`;

  const set = (patch: Partial<BtParams>) => setP((x) => ({ ...x, ...patch }));
  const meta = ENTRY_META[p.entry];

  return (
    <div className="view-in">
      <ViewHead
        eyebrow={t("Lab · Backtest", "实验室 · 回测")}
        title={t("Backtest · Tune Your Entry Points", "回测 · 打磨你的交易点位")}
        desc={t(
          "Run an entry/exit strategy over the recent daily price history of a chosen universe. See how the trade points would have performed, which stocks worked best, then let the optimizer sweep the exit rules to find and apply the best settings. Your tuned rule is remembered.",
          "在选定股票池的近期日线价格上,跑一套进出场策略,看这些交易点位的历史表现、哪些股票最吃这套规则,再用优化器扫描退出参数、找出并一键套用最优设定。你调好的规则会被记住。",
        )}
      />

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* ── controls ── */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-line bg-panel p-4">
            <div className="mb-2 text-[11px] uppercase tracking-wide text-muted2">{t("Universe", "股票池")}</div>
            <div className="mb-4 grid grid-cols-2 gap-1.5">
              {UNIS.map((u) => (
                <button key={u.key} onClick={() => setUni(u.key)} className={`rounded-lg border px-2 py-1.5 text-[12px] transition-colors ${uni === u.key ? "border-signal/60 bg-signal/10 text-signal" : "border-line text-muted hover:text-text"}`}>
                  {lang === "zh" ? u.zh : u.en}
                </button>
              ))}
            </div>

            {uni === "mylist" && (
              <div className="mb-4">
                <textarea
                  value={watchText}
                  onChange={(e) => setWatchText(e.target.value)}
                  placeholder={t("Add your tickers: NVDA MSFT AAPL …", "加入你的代码：NVDA MSFT AAPL …")}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-line bg-inset px-2.5 py-2 font-mono text-[12px] text-text placeholder:text-muted2 focus:border-signal/60 focus:outline-none"
                />
                {myList.length > 0 && (
                  <>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {myList.map((tk) => {
                        const has = !!technical?.tickers?.[tk]?.close_series;
                        return (
                          <span key={tk} className="rounded px-1.5 py-[1px] font-mono text-[10px]" style={{ color: has ? "var(--text)" : BAD, background: has ? "rgba(255,255,255,0.06)" : "#e0785a1a" }} title={has ? "" : t("no price data in the system yet", "系统里暂无价格数据")}>
                            {tk}{has ? "" : " ✕"}
                          </span>
                        );
                      })}
                    </div>
                    <p className="mt-1.5 text-[10px] text-muted2">
                      {t(
                        `${myList.filter((tk) => technical?.tickers?.[tk]?.close_series).length}/${myList.length} have price history — the rest are skipped (add them to the price fetch to include).`,
                        `${myList.filter((tk) => technical?.tickers?.[tk]?.close_series).length}/${myList.length} 有价格历史,其余跳过(需把它们加进价格抓取才能纳入)。`,
                      )}
                    </p>
                  </>
                )}
              </div>
            )}

            <div className="mb-2 text-[11px] uppercase tracking-wide text-muted2">{t("Entry signal", "进场信号")}</div>
            <div className="mb-1 grid grid-cols-2 gap-1.5">
              {(Object.keys(ENTRY_META) as EntryKind[]).map((k) => (
                <button key={k} onClick={() => set({ entry: k })} className={`rounded-lg border px-2 py-1.5 text-[12px] transition-colors ${p.entry === k ? "border-signal/60 bg-signal/10 text-signal" : "border-line text-muted hover:text-text"}`}>
                  {lang === "zh" ? ENTRY_META[k].zh : ENTRY_META[k].en}
                </button>
              ))}
            </div>
            <p className="mb-4 text-[10.5px] text-muted2">{lang === "zh" ? meta.desc.zh : meta.desc.en}</p>

            <div className="space-y-3.5">
              {meta.usesLookback && <Slider label={t("Lookback (days)", "回看 (天)")} value={p.lookback} min={3} max={40} step={1} onChange={(v) => set({ lookback: v })} fmt={(v) => String(v)} />}
              {meta.usesThreshold && <Slider label={t("Momentum threshold", "动量阈值")} value={p.threshold} min={0} max={0.3} step={0.01} onChange={(v) => set({ threshold: v })} fmt={(v) => `${Math.round(v * 100)}%`} />}
              <Slider label={t("Max hold (days)", "最长持有 (天)")} value={p.holdDays} min={1} max={30} step={1} onChange={(v) => set({ holdDays: v })} fmt={(v) => String(v)} />
              <Slider label={t("Stop-loss", "止损")} value={p.stopLoss} min={0} max={0.25} step={0.01} onChange={(v) => set({ stopLoss: v })} fmt={(v) => (v === 0 ? t("off", "关") : `${Math.round(v * 100)}%`)} />
              <Slider label={t("Take-profit", "止盈")} value={p.takeProfit} min={0} max={0.5} step={0.01} onChange={(v) => set({ takeProfit: v })} fmt={(v) => (v === 0 ? t("off", "关") : `${Math.round(v * 100)}%`)} />
            </div>

            <div className="mt-4 flex gap-2">
              <button onClick={() => setSweep(optimize(technical, tickers, p))} className="flex-1 rounded-lg border border-gold/50 bg-gold/10 px-3 py-2 text-[12px] font-semibold text-gold transition-colors hover:bg-gold/20" style={{ borderColor: "#f0c86288", color: "#f0c862", background: "#f0c86214" }}>
                {t("⚡ Optimize", "⚡ 优化")}
              </button>
              <button onClick={() => setP(DEFAULT_P)} className="rounded-lg border border-line px-3 py-2 text-[12px] text-muted hover:text-text">{t("Reset", "重置")}</button>
            </div>
          </div>

          <p className="px-1 text-[10px] leading-relaxed text-muted2">
            {t(`Window ≈ last ${res.window} trading days · ${tickers.length} names. Short-horizon, in-sample — a signal-quality check, not a promise.`, `窗口 ≈ 近 ${res.window} 个交易日 · ${tickers.length} 只。短周期、样本内 —— 是信号质量检验,不是收益承诺。`)}
          </p>
        </div>

        {/* ── results ── */}
        <div className="space-y-4">
          {/* stat tiles */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label={t("Trades", "交易数")} value={String(res.n)} />
            <Tile label={t("Win rate", "胜率")} value={`${Math.round(res.winRate * 100)}%`} color={res.winRate >= 0.5 ? GOOD : BAD} />
            <Tile label={t("Avg / trade", "每笔均收")} value={pctS(res.avg)} color={res.avg >= 0 ? GOOD : BAD} />
            <Tile label={t("Median", "中位")} value={pctS(res.median)} color={res.median >= 0 ? GOOD : BAD} />
            <Tile label={t("Cum. P&L", "累计盈亏")} value={pctS(res.total)} color={res.total >= 0 ? GOOD : BAD} sub={t("Σ, fixed size / trade", "Σ·每笔固定仓")} />
            <Tile label={t("Max drawdown", "最大回撤")} value={pctS(res.maxDD)} color={BAD} sub={t("of cum. P&L", "累计盈亏口径")} />
            <Tile label={t("Profit factor", "盈亏比")} value={res.profitFactor === Infinity ? "∞" : res.profitFactor.toFixed(2)} color={res.profitFactor >= 1 ? GOOD : BAD} sub={t("gross win / loss", "总盈/总亏")} />
            <Tile label={t("Buy & hold", "买入持有")} value={pctS(res.benchmark)} sub={t("window baseline", "窗口基准")} />
          </div>

          {/* equity + histogram */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <div className="rounded-2xl border border-line bg-panel p-4">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-[12px] font-semibold">{t("Equity curve", "资金曲线")}</span>
                <span className="font-mono text-[11px]" style={{ color: res.total >= 0 ? GOOD : BAD }}>{pctS(res.total)}</span>
              </div>
              <EquityCurve equity={res.equity} sig={sig} />
            </div>
            <div className="rounded-2xl border border-line bg-panel p-4">
              <div className="mb-2 text-[12px] font-semibold">{t("Return distribution", "收益分布")}</div>
              <Histogram hist={res.hist} />
              <div className="mt-1 text-center text-[9px] text-muted2">{t("per-trade return (%)", "每笔收益 (%)")}</div>
            </div>
          </div>

          {/* optimizer heatmap */}
          {sweep && (
            <div className="view-in rounded-2xl border border-line bg-panel p-4">
              <div className="mb-3 flex items-baseline gap-2">
                <span className="text-[12px] font-semibold" style={{ color: "#f0c862" }}>{t("Optimizer", "优化器")}</span>
                <span className="text-[10.5px] text-muted2">{sweep.rows.label} × {sweep.cols.label}</span>
                <button onClick={() => setSweep(null)} className="ml-auto text-[11px] text-muted2 hover:text-text">{t("hide", "收起")}</button>
              </div>
              <Heatmap sweep={sweep} onPick={(hold, key, val) => set({ holdDays: hold, [key]: val } as Partial<BtParams>)} t={t} />
            </div>
          )}

          {/* per-ticker leaderboard */}
          <div className="rounded-2xl border border-line bg-panel p-4">
            <div className="mb-3 text-[12px] font-semibold">{t("Which stocks worked best", "哪些股票最吃这套规则")}</div>
            {res.perTicker.length === 0 ? (
              <div className="py-6 text-center text-[12px] text-muted2">{t("No trades — loosen the rules.", "没有交易 —— 放宽规则。")}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-muted2">
                      <th className="py-1.5 text-left font-medium">{t("Ticker", "标的")}</th>
                      <th className="px-2 text-right font-medium">{t("Trades", "笔")}</th>
                      <th className="px-2 text-right font-medium">{t("Win", "胜率")}</th>
                      <th className="px-2 text-right font-medium">{t("Avg", "均收")}</th>
                      <th className="px-2 text-right font-medium">{t("Total", "累计")}</th>
                      <th className="px-2 text-right font-medium">{t("Recent", "近况")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.perTicker.slice(0, 14).map((s) => (
                      <tr key={s.ticker} onClick={() => openDetail(s.ticker)} className="cursor-pointer border-t border-line/60 hover:bg-white/[0.02]">
                        <td className="py-1.5 font-disp font-bold text-text">{s.ticker}</td>
                        <td className="px-2 text-right tabular-nums text-muted">{s.n}</td>
                        <td className="px-2 text-right tabular-nums" style={{ color: s.win >= 0.5 ? GOOD : BAD }}>{Math.round(s.win * 100)}%</td>
                        <td className="px-2 text-right tabular-nums" style={{ color: s.avg >= 0 ? GOOD : BAD }}>{pctS(s.avg)}</td>
                        <td className="px-2 text-right font-semibold tabular-nums" style={{ color: s.total >= 0 ? GOOD : BAD }}>{pctS(s.total)}</td>
                        <td className="px-2"><div className="flex justify-end"><Spark c={technical?.tickers?.[s.ticker]?.close_series} /></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
