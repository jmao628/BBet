import { useMemo } from "react";
import { useStore, useT } from "../../store";
import { buildScreen, buildUniverse, bypassesHeat, capLabel } from "../pipeline";
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

  // Ecosystem network. SELECTION RULE — a ticker earns a row (becomes the
  // "subject") only if it is a *discovery target*: in your universe AND not a
  // mega-cap (≥$100B). Mega-caps (AMZN, NVDA, MSFT…) are anchors — you don't
  // "discover" them, so they never sit on the left; they only appear as chips
  // that a target is tied to. RANKING — by how many other universe names it
  // links to (its centrality); ties broken alphabetically. That's why CRDO (a
  // small cap) is a row and AMZN (its mega-cap customer) is only a chip.
  const links = useMemo(() => {
    if (!supplychain) return [];
    const uni = buildUniverse(data);
    const inUni = new Set(uni.map((u) => u.ticker));
    const companyOf = new Map(uni.map((u) => [u.ticker, u.company]));
    type Neighbor = { ticker: string; kind: string; anchor: boolean };
    const rows: { ticker: string; company: string; neighbors: Neighbor[]; anchors: number }[] = [];
    for (const [tk, m] of Object.entries(supplychain)) {
      // Selection: subject must be a non-mega-cap universe name.
      if (!inUni.has(tk) || bypassesHeat(marketCaps?.[tk])) continue;
      const seen = new Set<string>();
      const neighbors: Neighbor[] = [];
      for (const kind of ["upstream", "downstream", "peers"] as const) {
        for (const e of m[kind] ?? []) {
          if (e.ticker && e.ticker !== tk && inUni.has(e.ticker) && !seen.has(e.ticker)) {
            seen.add(e.ticker);
            neighbors.push({ ticker: e.ticker, kind, anchor: bypassesHeat(marketCaps?.[e.ticker]) });
          }
        }
      }
      if (neighbors.length)
        rows.push({
          ticker: tk,
          company: companyOf.get(tk) ?? "",
          neighbors,
          anchors: neighbors.filter((n) => n.anchor).length,
        });
    }
    // Rank by total links, then by number of mega-cap anchors, then alpha.
    rows.sort(
      (a, b) => b.neighbors.length - a.neighbors.length || b.anchors - a.anchors || a.ticker.localeCompare(b.ticker),
    );
    return rows;
  }, [supplychain, data, marketCaps]);

  return (
    <div className="view-in">
      <ViewHead
        eyebrow={t("Stage 2 · Screen (quality net)", "Stage 2 · 发现筛选（质量网）")}
        title={t("Screen · The Quality Net", "发现筛选 · 质量筛")}
        desc={t(
          "Run in parallel with Heat, not after it. The quality net keeps seeds that (1) carry an SA rating (thesis-only mentions with no rating are out) and (2) have an analyst thesis. The ✓ column marks names that ALSO cleared the Heat attention board — that overlap is what later stages act on.",
          "与热度点火并行，不是它的下游。质量网留下同时满足：(1) 有 SA 评分（无评分的纯提及出局）、(2) 有分析师看多论点 的种子。带 ✓ 的是同时也过了热度注意力榜的票——两网交集才是后续阶段真正处理的对象。",
        )}
        actions={<MethodInfo />}
      />

      <StatStrip
        stats={[
          { k: t("Seeds", "种子"), v: total, d: t("all deduped bulls", "去重后全部看多票") },
          { k: t("Quality net", "质量网"), v: candidates.length, d: t("rating + thesis", "有评分 + 有论点"), color: "#3dd6c4" },
          { k: t("In both nets", "两网交集"), v: passedHeat, d: t("also cleared Heat", "同时过热度榜"), color: "#f2a73c" },
        ]}
      />

      {supplychain && (
        <div className="mb-4">
        <Card
          title={t("Ecosystem Links", "生态关联网络")}
          sub={
            links.length
              ? t(`${links.length} discovery targets · ranked by links`, `${links.length} 个发现目标 · 按关联数排`)
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
            <>
              {/* rules: who becomes a row, and what a chip's colour means */}
              <div className="mb-3 space-y-1.5 rounded-lg border border-line bg-inset px-3 py-2 text-[11px] leading-relaxed">
                <div className="text-muted">
                  {t(
                    "Rows = discovery targets: universe names under $100B. Mega-caps are anchors — they only appear as chips, never as a row. Ranked by number of links.",
                    "左侧成行的 = 发现目标：universe 内 <$100B 的票。大票是锚，只作为标签出现、不单独成行。按关联数排名。",
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="text-muted2">{t("Chip colour = its role vs the row ticker:", "标签颜色 = 它相对左侧票的角色：")}</span>
                  {(["upstream", "downstream", "peers"] as const).map((k) => (
                    <span key={k} className="flex items-center gap-1.5" style={{ color: GRP_COLOR[k] }}>
                      <span className="h-2 w-2 rounded-full" style={{ background: GRP_COLOR[k] }} />
                      {k === "upstream"
                        ? t("supplier (upstream)", "供应商（上游）")
                        : k === "downstream"
                          ? t("customer (downstream)", "客户（下游）")
                          : t("peer", "同业")}
                    </span>
                  ))}
                  <span className="flex items-center gap-1.5 text-muted2">
                    <span className="grid h-3 w-3 place-items-center rounded-full border border-muted2 text-[7px]">⚓</span>
                    {t("= mega-cap anchor", "= 大票锚")}
                  </span>
                </div>
              </div>
              <div className="space-y-1.5">
                {links.map((r, idx) => {
                  const maxN = links[0].neighbors.length || 1;
                  return (
                    <div
                      key={r.ticker}
                      onClick={() => openDetail(r.ticker)}
                      className="group flex cursor-pointer items-center gap-3 rounded-lg border border-line bg-panel2 px-3 py-2 transition-colors hover:border-line2 hover:bg-white/[0.05]"
                    >
                      <span className="w-5 flex-none text-right font-mono text-[11px] text-muted2">{idx + 1}</span>
                      <div className="flex w-[168px] flex-none items-baseline gap-2">
                        <span className="font-mono text-[13px] font-semibold text-signal group-hover:underline">{r.ticker}</span>
                        {r.company && <span className="truncate text-[11px] text-muted">{r.company}</span>}
                      </div>
                      {/* strength bar */}
                      <div className="hidden h-1.5 w-16 flex-none overflow-hidden rounded-full bg-inset sm:block">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${(r.neighbors.length / maxN) * 100}%`, background: "#3dd6c4" }}
                        />
                      </div>
                      <span className="w-14 flex-none font-mono text-[11px] text-muted2">
                        {t(`${r.neighbors.length} link${r.neighbors.length > 1 ? "s" : ""}`, `${r.neighbors.length} 关联`)}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        {r.neighbors.map((n) => (
                          <button
                            key={n.ticker}
                            onClick={(e) => {
                              e.stopPropagation();
                              openDetail(n.ticker);
                            }}
                            className="rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium transition-transform hover:scale-105"
                            style={{ color: GRP_COLOR[n.kind], borderColor: `${GRP_COLOR[n.kind]}66`, background: `${GRP_COLOR[n.kind]}16` }}
                            title={
                              n.kind === "upstream"
                                ? t(`${n.ticker} is ${r.ticker}'s supplier`, `${n.ticker} 是 ${r.ticker} 的供应商`)
                                : n.kind === "downstream"
                                  ? t(`${n.ticker} is ${r.ticker}'s customer`, `${n.ticker} 是 ${r.ticker} 的客户`)
                                  : t(`${n.ticker} competes with ${r.ticker}`, `${n.ticker} 与 ${r.ticker} 同业竞争`)
                            }
                          >
                            {n.anchor ? "⚓ " : ""}
                            {n.ticker}
                          </button>
                        ))}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Card>
        </div>
      )}

      <Card
        title={t("Quality Net", "质量网 · Screen")}
        sub={t(`${candidates.length} names · in-both-nets first, then by cap`, `${candidates.length} 只 · 两网交集在前，再按市值`)}
        pad0
      >
        {candidates.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-muted">
            {t("No candidates yet — no rated seed has an analyst thesis yet, or the SA scrape hasn't run.", "暂无候选。可能：还没有带评分的种子有分析师论点，或 SA 抓取还没跑。")}
          </div>
        ) : (
          <div className="max-h-[calc(100vh-320px)] overflow-auto">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead className="sticky top-0 z-[1] bg-panel">
                <tr className="text-[11px] uppercase tracking-wide text-muted2">
                  <th className="px-3 py-2 text-left font-medium">{t("Ticker", "标的")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("Cap", "市值")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("Heat overlap", "热度交集")}</th>
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
                      {!c.advanced ? (
                        <span className="text-[11px] text-muted2">{t("· not in heat", "· 未过热度")}</span>
                      ) : c.via === "bypass" ? (
                        <span className="rounded-full border border-signal/40 bg-signal/10 px-2 py-0.5 text-[11px] font-medium text-signal">
                          ✓ {t("Mega bypass", "大票直通")}
                        </span>
                      ) : c.via === "social" ? (
                        <span className="rounded-full border border-ignite/40 bg-ignite/10 px-2 py-0.5 text-[11px] font-medium text-ignite">
                          ✓ {c.phase ? (PHASE_L[c.phase]?.[lang] ?? c.phase) : t("Ignite", "点火")}
                        </span>
                      ) : (
                        <span className="rounded-full border border-ok/40 bg-ok/10 px-2 py-0.5 text-[11px] font-medium text-ok">
                          ✓ {c.attnPhase ? (ATTN_L[c.attnPhase]?.[lang] ?? c.attnPhase) : t("Igniting", "量价点火")}
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
