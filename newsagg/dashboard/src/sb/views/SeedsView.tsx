import { useMemo, useState } from "react";
import { useStore, useT } from "../../store";
import { buildSeeds, CATALYST_CN, CATALYST_EN, ROLE_CN, ROLE_EN, sectorLabel } from "../pipeline";
import { ViewHead, Card, Chip } from "../ui";

export function SeedsView() {
  const data = useStore((s) => s.data);
  const technical = useStore((s) => s.technical);
  const sectors = useStore((s) => s.sectors);
  const openDetail = useStore((s) => s.openDetail);
  const lang = useStore((s) => s.lang);
  const t = useT();
  const seeds = useMemo(() => buildSeeds(data), [data]);

  const hasData = (t: string) => !!technical?.tickers?.[t];
  const sectorOf = (t: string) => sectors?.[t]?.sector ?? "";

  const [thesisOnly, setThesisOnly] = useState(false);
  const [noDataOnly, setNoDataOnly] = useState(false);
  const [sectorFilter, setSectorFilter] = useState<string | null>(null);

  const thesisCount = seeds.filter((r) => r.hasThesis).length;
  const noData = useMemo(
    () => (technical ? seeds.filter((r) => !hasData(r.ticker)) : []),
    [seeds, technical],
  );

  const sectorCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const s of seeds) {
      const sec = sectorOf(s.ticker);
      if (sec) c.set(sec, (c.get(sec) ?? 0) + 1);
    }
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [seeds, sectors]);

  let rows = seeds;
  if (thesisOnly) rows = rows.filter((r) => r.hasThesis);
  if (noDataOnly) rows = rows.filter((r) => !hasData(r.ticker));
  if (sectorFilter) rows = rows.filter((r) => sectorOf(r.ticker) === sectorFilter);

  return (
    <div className="view-in">
      <ViewHead
        eyebrow={t("Stage 1 · Collection", "Stage 1 · 采集")}
        title={t("Today's Bullish Seed Table", "当日看多种子表")}
        desc={t(
          "Every bullish seed, deduped to one row per ticker. Analyst-written theses are marked ★; the rest are Quant / screener-list bulls. Price data comes from yfinance — a few OTC / foreign ADRs can't be found (marked No data).",
          "全网看多种子去重成一张表（每票一行）。有分析师发文看多的标 ★ 论点；其余为 Quant / screener 榜单上的看多票。行情/技术数据由 yfinance 补齐，个别 OTC / 海外 ADR 可能查不到（下面标「无数据」）。",
        )}
      />

      {/* filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-line">
          <button
            onClick={() => setThesisOnly(false)}
            className={`px-3 py-1.5 text-[12px] ${!thesisOnly ? "bg-signal/15 text-signal" : "text-muted hover:text-text"}`}
          >
            {t("All", "全部")} {seeds.length}
          </button>
          <button
            onClick={() => setThesisOnly(true)}
            className={`px-3 py-1.5 text-[12px] ${thesisOnly ? "bg-signal/15 text-signal" : "text-muted hover:text-text"}`}
          >
            {t("★ Analyst thesis", "★ 有分析师论点")} {thesisCount}
          </button>
        </div>
        {noData.length > 0 && (
          <button
            onClick={() => setNoDataOnly((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-[12px] ${
              noDataOnly ? "border-bad/50 bg-bad/10 text-bad" : "border-line text-muted hover:text-text"
            }`}
          >
            {t("⚠ No data", "⚠ 无数据")} {noData.length}
          </button>
        )}
        <span className="ml-auto font-mono text-[12px] text-muted2">{t(`${rows.length} rows · deduped`, `${rows.length} 条 · 已去重`)}</span>
      </div>

      {/* sector classification chips */}
      {sectorCounts.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted2">{t("By sector:", "按板块:")}</span>
          <button
            onClick={() => setSectorFilter(null)}
            className={`rounded-full border px-2.5 py-0.5 text-[12px] ${
              sectorFilter === null ? "border-signal/50 bg-signal/10 text-signal" : "border-line text-muted hover:text-text"
            }`}
          >
            {t("All", "全部")}
          </button>
          {sectorCounts.map(([sec, n]) => (
            <button
              key={sec}
              onClick={() => setSectorFilter(sectorFilter === sec ? null : sec)}
              className={`rounded-full border px-2.5 py-0.5 text-[12px] ${
                sectorFilter === sec ? "border-signal/50 bg-signal/10 text-signal" : "border-line text-muted hover:text-text"
              }`}
            >
              {sectorLabel(sec, lang)} {n}
            </button>
          ))}
        </div>
      )}

      {/* the no-data tickers, spelled out */}
      {noData.length > 0 && (
        <div className="mb-3 rounded-lg border border-bad/30 bg-bad/[0.06] px-3.5 py-2.5 text-[12px]">
          <span className="font-medium text-bad">{t(`${noData.length} not found on yfinance`, `yfinance 未找到行情的 ${noData.length} 只`)}</span>
          <span className="text-muted2">{t(" (mostly OTC / foreign ADRs, excluded from heat/technical): ", "（多为 OTC / 海外 ADR，不参与热度/技术）：")}</span>
          <span className="ml-1 font-mono text-muted">
            {noData.map((r) => r.ticker).join("  ·  ")}
          </span>
        </div>
      )}

      <Card pad0>
        {rows.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-muted">
            {t("No seeds yet — run the scraper and bulls will appear here.", "暂无种子。运行抓取器后，看多票会出现在这里。")}
          </div>
        ) : (
          <div className="max-h-[calc(100vh-320px)] overflow-auto">
            <table className="w-full min-w-[920px] text-[13px]">
              <thead className="sticky top-0 z-[1] bg-panel">
                <tr className="text-[11px] uppercase tracking-wide text-muted2">
                  <Th>{t("Ticker", "标的")}</Th>
                  <Th>{t("Sector", "板块")}</Th>
                  <Th>{t("Tags / Source", "标记 / 来源")}</Th>
                  <Th>{t("Author", "作者")}</Th>
                  <Th>Reasoning</Th>
                  <Th right>Quant</Th>
                  <Th>Catalyst</Th>
                  <Th>Role</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const missing = technical != null && !hasData(r.ticker);
                  return (
                    <tr
                      key={r.ticker}
                      className={`cursor-pointer border-t border-line hover:bg-white/[0.02] ${
                        r.hasThesis ? "bg-signal/[0.03]" : ""
                      } ${missing ? "opacity-55" : ""}`}
                      onClick={() => openDetail(r.ticker)}
                    >
                      <td className="px-3 py-2.5">
                        <div className="font-mono font-semibold text-signal">{r.ticker}</div>
                        <div className="text-[11px] text-muted">{r.company}</div>
                      </td>
                      <td className="px-3 py-2.5 text-[12px] text-muted">
                        {sectorOf(r.ticker) ? sectorLabel(sectorOf(r.ticker), lang) : <span className="text-muted2">—</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1">
                          {r.hasThesis && <Chip kind="signal">{t("★ Thesis", "★ 论点")}</Chip>}
                          {missing && <Chip kind="no">{t("No data", "无数据")}</Chip>}
                          {r.tags.map((t) => (
                            <span key={t} className="rounded bg-panel2 px-1.5 py-0.5 text-[10px] text-muted">
                              {t}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">{r.author ?? <span className="text-muted2">—</span>}</td>
                      <td className="max-w-[300px] px-3 py-2.5">
                        {r.reasoning ? (
                          r.articleUrl ? (
                            <a
                              href={r.articleUrl}
                              target="_blank"
                              rel="noreferrer"
                              title={r.reasoning}
                              onClick={(e) => e.stopPropagation()}
                              className="block truncate text-[12.5px] text-signal hover:underline"
                            >
                              {r.reasoning} ↗
                            </a>
                          ) : (
                            <div className="truncate text-[12.5px]">{r.reasoning}</div>
                          )
                        ) : (
                          <span className="text-muted2">—</span>
                        )}
                        {r.rating && !/^[0-5]\.\d{2}$/.test(r.rating) && (
                          <span className="text-[10px] font-semibold text-ok">{r.rating}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {r.quant != null ? (
                          <span className="font-semibold text-ok">{r.quant.toFixed(2)}</span>
                        ) : (
                          <span className="text-muted2">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <Chip kind={r.catalyst === "unknown" ? "wait" : "signal"}>
                          {lang === "zh" ? CATALYST_CN[r.catalyst] : CATALYST_EN[r.catalyst]}
                        </Chip>
                      </td>
                      <td className="px-3 py-2.5 text-muted">{lang === "zh" ? ROLE_CN[r.role] : ROLE_EN[r.role]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-3 py-2 font-medium ${right ? "text-right" : "text-left"}`}>{children}</th>
  );
}
