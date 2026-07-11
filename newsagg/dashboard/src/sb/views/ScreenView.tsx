import { useMemo, useState } from "react";
import { useStore, useT } from "../../store";
import { buildScreen, buildUniverse, buildEcoAdjacency, bypassesHeat, capLabel, sectorLabel } from "../pipeline";
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
  const sectors = useStore((s) => s.sectors);
  const marketCaps = useStore((s) => s.marketCaps);
  const supplychain = useStore((s) => s.supplychain);
  const openDetail = useStore((s) => s.openDetail);
  const lang = useStore((s) => s.lang);
  const t = useT();
  const [scSector, setScSector] = useState<string | null>(null);
  const sectorOf = (tk: string) => sectors?.[tk]?.sector ?? "";

  const { candidates, total, passedHeat } = useMemo(
    () => buildScreen(data, heat, marketCaps, technical),
    [data, heat, marketCaps, technical],
  );
  const scSectorCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const x of candidates) {
      const s = sectorOf(x.ticker);
      if (s) c.set(s, (c.get(s) ?? 0) + 1);
    }
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, sectors]);
  const shownCands = scSector ? candidates.filter((x) => sectorOf(x.ticker) === scSector) : candidates;

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
    const eco = buildEcoAdjacency(supplychain, marketCaps); // symmetrized
    type Neighbor = { ticker: string; kind: string; anchor: boolean; importance: number };
    const rows: { ticker: string; company: string; neighbors: Neighbor[]; anchors: number; crit: number }[] = [];
    for (const [tk, ns] of eco) {
      // Selection: subject must be a non-mega-cap universe name (a discovery target).
      if (!inUni.has(tk) || bypassesHeat(marketCaps?.[tk])) continue;
      const neighbors = ns
        .filter((n) => inUni.has(n.ticker) && n.ticker !== tk)
        .sort((a, b) => Number(b.anchor) - Number(a.anchor) || b.importance - a.importance);
      if (!neighbors.length) continue;
      rows.push({
        ticker: tk,
        company: companyOf.get(tk) ?? "",
        neighbors,
        anchors: neighbors.filter((n) => n.anchor).length,
        crit: neighbors.filter((n) => n.importance >= 3).length,
      });
    }
    // Rank by total links, then mega-cap anchors, then critical ties, then alpha.
    rows.sort(
      (a, b) =>
        b.neighbors.length - a.neighbors.length ||
        b.anchors - a.anchors ||
        b.crit - a.crit ||
        a.ticker.localeCompare(b.ticker),
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
                    "Rows = discovery targets: universe names under $100B. Mega-caps are anchors — chips only, never a row. Links are bidirectional (a reverse edge is inferred when only one side names the other), so coverage is fuller. ! = critical / hard-to-replace. Ranked by links.",
                    "左侧成行的 = 发现目标：universe 内 <$100B 的票。大票是锚，只作标签、不单独成行。关联是双向的（只要一方点名另一方，就补上反向边），覆盖更全。! = 关键/非他不可。按关联数排名。",
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
              <div className="space-y-2">
                {links.map((r, idx) => {
                  const maxN = links[0].neighbors.length || 1;
                  return (
                    <div
                      key={r.ticker}
                      onClick={() => openDetail(r.ticker)}
                      className="group grid cursor-pointer grid-cols-[auto_180px_1fr] items-center gap-3 rounded-xl border border-line bg-panel2 px-3 py-2.5 transition-all hover:-translate-y-px hover:border-signal/40 hover:bg-white/[0.04]"
                    >
                      {/* rank */}
                      <span className="grid h-6 w-6 flex-none place-items-center rounded-lg bg-inset font-mono text-[11px] text-muted2">
                        {idx + 1}
                      </span>
                      {/* subject + strength */}
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-[14px] font-semibold text-signal group-hover:underline">{r.ticker}</span>
                          <span className="truncate text-[11px] text-muted">{r.company}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-inset">
                            <div className="h-full rounded-full bg-gradient-to-r from-signal/40 to-signal" style={{ width: `${(r.neighbors.length / maxN) * 100}%` }} />
                          </div>
                          <span className="font-mono text-[10px] text-muted2">
                            {r.neighbors.length}
                            {r.anchors > 0 ? ` · ⚓${r.anchors}` : ""}
                            {r.crit > 0 ? ` · !${r.crit}` : ""}
                          </span>
                        </div>
                      </div>
                      {/* chips */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {r.neighbors.slice(0, 9).map((n) => {
                          const crit = n.importance >= 3;
                          return (
                            <button
                              key={n.ticker}
                              onClick={(e) => {
                                e.stopPropagation();
                                openDetail(n.ticker);
                              }}
                              className="rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-medium transition-transform hover:scale-110"
                              style={{
                                color: crit ? "#0c141b" : GRP_COLOR[n.kind],
                                borderColor: `${GRP_COLOR[n.kind]}${crit ? "" : "55"}`,
                                background: crit ? GRP_COLOR[n.kind] : `${GRP_COLOR[n.kind]}14`,
                              }}
                              title={
                                (n.kind === "upstream"
                                  ? t(`${n.ticker} supplies ${r.ticker}`, `${n.ticker} 供应 ${r.ticker}`)
                                  : n.kind === "downstream"
                                    ? t(`${n.ticker} is ${r.ticker}'s customer`, `${n.ticker} 是 ${r.ticker} 的客户`)
                                    : t(`${n.ticker} competes with ${r.ticker}`, `${n.ticker} 与 ${r.ticker} 同业`)) +
                                (crit ? t(" · critical", " · 关键/非他不可") : "")
                              }
                            >
                              {n.anchor ? "⚓" : ""}
                              {n.ticker}
                            </button>
                          );
                        })}
                        {r.neighbors.length > 9 && (
                          <span className="text-[10px] text-muted2">+{r.neighbors.length - 9}</span>
                        )}
                      </div>
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
        sub={t(`${shownCands.length} names · in-both-nets first, then by cap`, `${shownCands.length} 只 · 两网交集在前，再按市值`)}
        pad0
      >
        {scSectorCounts.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-[18px] py-2.5">
            <span className="text-[10.5px] text-muted2">{t("Sector:", "板块:")}</span>
            <button
              onClick={() => setScSector(null)}
              className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${scSector === null ? "border-signal/50 bg-signal/10 text-signal" : "border-line text-muted hover:text-text"}`}
            >
              {t("All", "全部")} {candidates.length}
            </button>
            {scSectorCounts.map(([sec, n]) => (
              <button
                key={sec}
                onClick={() => setScSector(scSector === sec ? null : sec)}
                className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${scSector === sec ? "border-signal/50 bg-signal/10 text-signal" : "border-line text-muted hover:text-text"}`}
              >
                {sectorLabel(sec, lang)} {n}
              </button>
            ))}
          </div>
        )}
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
                  <th className="px-3 py-2 text-left font-medium">{t("Sector", "板块")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("Cap", "市值")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("Heat overlap", "热度交集")}</th>
                  <th className="px-3 py-2 text-right font-medium">z</th>
                  <th className="px-3 py-2 text-right font-medium">RVOL</th>
                  <th className="px-3 py-2 text-left font-medium">{t("Author", "作者")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("Thesis", "论点")}</th>
                </tr>
              </thead>
              <tbody>
                {shownCands.map((c) => (
                  <tr
                    key={c.ticker}
                    onClick={() => openDetail(c.ticker)}
                    className="cursor-pointer border-t border-line hover:bg-white/[0.03]"
                  >
                    <td className="px-3 py-2.5">
                      <span className="font-mono font-semibold text-signal">{c.ticker}</span>
                      <span className="ml-2 text-[11px] text-muted">{c.company}</span>
                    </td>
                    <td className="px-3 py-2.5 text-[12px] text-muted">
                      {sectorOf(c.ticker) ? sectorLabel(sectorOf(c.ticker), lang) : <span className="text-muted2">—</span>}
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
