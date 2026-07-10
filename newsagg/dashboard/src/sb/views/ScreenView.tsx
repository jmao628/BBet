import { useMemo } from "react";
import { useStore, useT } from "../../store";
import { buildScreen, buildUniverse, capLabel } from "../pipeline";
import { ViewHead, Card, StatStrip } from "../ui";
import { MethodInfo } from "../MethodInfo";

const GRP_COLOR: Record<string, string> = {
  upstream: "#5fb0e8",
  downstream: "#48c78e",
  peers: "#e9c46a",
};

const PHASE_L: Record<string, { en: string; zh: string }> = {
  detonate: { en: "Detonate", zh: "引爆" },
  ignite: { en: "Ignite", zh: "点火" },
  watch: { en: "Watch", zh: "观察" },
  dead: { en: "Dead", zh: "死水" },
  ultralow: { en: "Ultra-low", zh: "超低覆盖" },
  warming: { en: "Warming", zh: "积累中" },
};

const ATTN_L: Record<string, { en: string; zh: string }> = {
  breakout: { en: "Breakout", zh: "突破" },
  igniting: { en: "Igniting", zh: "量价点火" },
  accumulating: { en: "Accumulating", zh: "吸筹中" },
  quiet: { en: "Quiet", zh: "沉寂" },
};

export function ScreenView() {
  const data = useStore((s) => s.data);
  const heat = useStore((s) => s.heat);
  const technical = useStore((s) => s.technical);
  const marketCaps = useStore((s) => s.marketCaps);
  const supplychain = useStore((s) => s.supplychain);
  const openDetail = useStore((s) => s.openDetail);
  const lang = useStore((s) => s.lang);
  const t = useT();

  const { candidates, total, passedHeat } = useMemo(
    () => buildScreen(data, heat, marketCaps, technical),
    [data, heat, marketCaps, technical],
  );

  // Ecosystem network: which universe tickers connect to OTHER universe tickers.
  // Those are the ones worth building a graph around (they share a supply chain).
  const links = useMemo(() => {
    if (!supplychain) return [];
    const uni = buildUniverse(data);
    const inUni = new Set(uni.map((u) => u.ticker));
    const companyOf = new Map(uni.map((u) => [u.ticker, u.company]));
    type Neighbor = { ticker: string; kind: string };
    const rows: { ticker: string; company: string; neighbors: Neighbor[] }[] = [];
    for (const [tk, m] of Object.entries(supplychain)) {
      const seen = new Set<string>();
      const neighbors: Neighbor[] = [];
      for (const kind of ["upstream", "downstream", "peers"] as const) {
        for (const e of m[kind] ?? []) {
          if (e.ticker && e.ticker !== tk && inUni.has(e.ticker) && !seen.has(e.ticker)) {
            seen.add(e.ticker);
            neighbors.push({ ticker: e.ticker, kind });
          }
        }
      }
      if (neighbors.length) rows.push({ ticker: tk, company: companyOf.get(tk) ?? "", neighbors });
    }
    rows.sort((a, b) => b.neighbors.length - a.neighbors.length);
    return rows;
  }, [supplychain, data]);

  return (
    <div className="view-in">
      <ViewHead
        eyebrow={t("Stage 3 · Screen", "Stage 3 · 发现筛选")}
        title={t("Screen · Mid/Small Caps About to Be Discovered", "发现筛选 · 即将被发现的中小盘")}
        desc={t(
          "Seed table → SA rating gate (no-rating thesis-only mentions excluded) → multi-lens advance (attention / volume / momentum / social top-10, mega-cap bypass) → author-quality second gate (has an analyst thesis) → candidate shortlist.",
          "种子表 → SA 评分门槛（无评分的纯分析师提及不入围）→ 多维排名入选（量价注意力 / 放量 / 动量 / 社交热度，各维度前 10 晋级，大票直通）→ 作者质量二段（有分析师看多论点）→ 发现候选短名单。",
        )}
        actions={<MethodInfo />}
      />

      <StatStrip
        stats={[
          { k: t("Seeds", "种子"), v: total, d: t("all deduped bulls", "去重后全部看多票") },
          { k: t("Advancing", "入选下一轮"), v: passedHeat, d: t("union of per-lens top-10", "各维度前 10 的并集"), color: "#f2a73c" },
          { k: t("Candidates", "发现候选"), v: candidates.length, d: t("+ author quality", "+ 作者质量二段"), color: "#3dd6c4" },
        ]}
      />

      {supplychain && (
        <div className="mb-4">
        <Card
          title={t("Ecosystem Links", "生态关联网络")}
          sub={
            links.length
              ? t(`${links.length} tickers connect to others in your universe`, `${links.length} 只与你 universe 内其它票有关联`)
              : t("no cross-universe links mapped yet", "尚未映射到跨 universe 关联")
          }
          right={<MethodInfo />}
        >
          {links.length === 0 ? (
            <div className="py-6 text-center text-[12.5px] text-muted">
              {t(
                "Once more tickers are mapped (python -m newsagg.supplychain), the ones whose suppliers/customers/peers are also in your universe show up here — the interconnected cluster worth focusing on.",
                "等映射了更多票（python -m newsagg.supplychain），那些上下游/同业也落在你 universe 内的票会出现在这里——就是值得重点看的相互关联簇。",
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {links.map((r) => (
                <div
                  key={r.ticker}
                  onClick={() => openDetail(r.ticker)}
                  className="flex cursor-pointer flex-wrap items-center gap-2 rounded-lg border border-line bg-panel2 px-3 py-2 hover:bg-white/[0.04]"
                >
                  <span className="font-mono text-[13px] font-semibold text-signal">{r.ticker}</span>
                  {r.company && <span className="text-[11px] text-muted">{r.company.slice(0, 22)}</span>}
                  <span className="ml-auto flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[10.5px] text-muted2">
                      {t(`${r.neighbors.length} links`, `${r.neighbors.length} 关联`)}
                    </span>
                    {r.neighbors.map((n) => (
                      <button
                        key={n.ticker}
                        onClick={(e) => {
                          e.stopPropagation();
                          openDetail(n.ticker);
                        }}
                        className="rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium"
                        style={{ color: GRP_COLOR[n.kind], borderColor: `${GRP_COLOR[n.kind]}66`, background: `${GRP_COLOR[n.kind]}14` }}
                        title={n.kind}
                      >
                        {n.ticker}
                      </button>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
        </div>
      )}

      <Card
        title={t("Candidates", "发现候选 · Candidates")}
        sub={t(`${candidates.length} names · large cap first, then by z`, `${candidates.length} 只 · 大盘在前，再按 z 排序`)}
        pad0
      >
        {candidates.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-muted">
            {t("No candidates yet — mid/small caps may not have ignited (heat accrues daily), or market caps aren't wired.", "暂无候选。可能原因：中小盘还没社交点火（热度需每天积累），或市值数据未接入。")}
          </div>
        ) : (
          <div className="max-h-[calc(100vh-320px)] overflow-auto">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead className="sticky top-0 z-[1] bg-panel">
                <tr className="text-[11px] uppercase tracking-wide text-muted2">
                  <th className="px-3 py-2 text-left font-medium">{t("Ticker", "标的")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("Cap", "市值")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("Heat gate", "热度闸")}</th>
                  <th className="px-3 py-2 text-right font-medium">z</th>
                  <th className="px-3 py-2 text-right font-medium">RVOL</th>
                  <th className="px-3 py-2 text-left font-medium">{t("Author", "作者")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("Thesis", "论点")}</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr
                    key={c.ticker}
                    onClick={() => openDetail(c.ticker)}
                    className="cursor-pointer border-t border-line hover:bg-white/[0.03]"
                  >
                    <td className="px-3 py-2.5">
                      <span className="font-mono font-semibold text-signal">{c.ticker}</span>
                      <span className="ml-2 text-[11px] text-muted">{c.company}</span>
                    </td>
                    <td className="px-3 py-2.5 text-[12px] text-muted">{capLabel(c.cap, lang)}</td>
                    <td className="px-3 py-2.5">
                      {c.via === "bypass" ? (
                        <span className="rounded-full border border-signal/40 bg-signal/10 px-2 py-0.5 text-[11px] font-medium text-signal">
                          {t("Mega bypass", "大票直通")}
                        </span>
                      ) : c.via === "social" ? (
                        <span className="rounded-full border border-ignite/40 bg-ignite/10 px-2 py-0.5 text-[11px] font-medium text-ignite">
                          {c.phase ? (PHASE_L[c.phase]?.[lang] ?? c.phase) : t("Ignite", "点火")}
                        </span>
                      ) : (
                        <span className="rounded-full border border-ok/40 bg-ok/10 px-2 py-0.5 text-[11px] font-medium text-ok">
                          {c.attnPhase ? (ATTN_L[c.attnPhase]?.[lang] ?? c.attnPhase) : t("Igniting", "量价点火")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {c.z != null ? c.z.toFixed(2) : <span className="text-muted2">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {c.rvol != null ? `${c.rvol.toFixed(1)}×` : <span className="text-muted2">—</span>}
                    </td>
                    <td className="px-3 py-2.5">{c.author ?? <span className="text-muted2">—</span>}</td>
                    <td className="max-w-[320px] px-3 py-2.5">
                      {c.articleUrl ? (
                        <a
                          href={c.articleUrl}
                          target="_blank"
                          rel="noreferrer"
                          title={c.reasoning}
                          onClick={(e) => e.stopPropagation()}
                          className="block truncate text-signal hover:underline"
                        >
                          {c.reasoning} ↗
                        </a>
                      ) : (
                        <span className="truncate text-muted">{c.reasoning || "—"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
