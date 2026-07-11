import { useMemo, useState } from "react";
import { useStore, useT } from "../../store";
import { buildScreen, buildUniverse, buildEcoAdjacency, buildFocus, bypassesHeat, capLabel, sectorLabel } from "../pipeline";
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
  const [ecoSector, setEcoSector] = useState<string | null>(null);
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
      // Selection: a discovery target = in-universe, not a mega-cap anchor, and
      // not a tiny/illiquid micro-cap (skip < $300M when the cap is known).
      if (!inUni.has(tk) || bypassesHeat(marketCaps?.[tk])) continue;
      const mc = marketCaps?.[tk];
      if (typeof mc === "number" && mc < 3e8) continue;
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

  const ecoSectorCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of links) {
      const s = sectorOf(r.ticker);
      if (s) c.set(s, (c.get(s) ?? 0) + 1);
    }
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [links, sectors]);
  // The ecosystem graph is always ONE sector (a mixed "All" is an unreadable
  // hairball). Default to the sector with the most targets.
  const effEcoSector = ecoSector ?? ecoSectorCounts[0]?.[0] ?? null;
  const ecoRows = effEcoSector ? links.filter((r) => sectorOf(r.ticker) === effEcoSector) : links;

  // Nodes to "light up" = names scoring high on YOUR Focus List (score ≥ 7/10).
  const hotScores = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of buildFocus(data, heat, technical, marketCaps, sectors, supplychain)) m.set(f.ticker, f.score);
    return m;
  }, [data, heat, technical, marketCaps, sectors, supplychain]);

  const HUB_EN: Record<string, string> = {
    Technology: "Tech",
    Healthcare: "Health",
    "Financial Services": "Finance",
    "Consumer Cyclical": "Cyclical",
    "Consumer Defensive": "Defensive",
    "Communication Services": "Comms",
    "Basic Materials": "Materials",
    Industrials: "Industry",
    "Real Estate": "Real Est.",
    Utilities: "Utilities",
    Energy: "Energy",
  };
  const hubLabel = effEcoSector ? (lang === "zh" ? sectorLabel(effEcoSector, "zh") : HUB_EN[effEcoSector] ?? effEcoSector) : "HUB";

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
              ? t(`${links.length} targets across sectors · pick one below`, `${links.length} 个目标(跨板块) · 下方选板块`)
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
              {/* graph legend */}
              <div className="mb-3 space-y-1.5 rounded-lg border border-line bg-inset px-3 py-2 text-[11px] leading-relaxed">
                <div className="text-muted">
                  {t(
                    "One sector at a time. Centre = the sector; inner gold ring = that sector's mega-cap anchors (≥$100B); outer nodes = discovery targets, placed near the anchors they link to. A glowing node = high Focus score (≥7) on your side. Click any node.",
                    "一次看一个板块。中心 = 该板块；内圈金色 = 该板块的大票锚（≥$1000亿）；外圈 = 发现目标，摆在它关联的锚附近。发光节点 = 你的 Focus 分高（≥7）。点任意节点。",
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="text-muted2">{t("Edge colour = target's role to the anchor:", "连线颜色 = 目标对锚的角色：")}</span>
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
                </div>
              </div>
              {/* sector picker — the graph is always one sector (no "All") */}
              {ecoSectorCounts.length > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10.5px] text-muted2">{t("Sector:", "板块:")}</span>
                  {ecoSectorCounts.map(([sec, n]) => (
                    <button
                      key={sec}
                      onClick={() => setEcoSector(sec)}
                      className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${effEcoSector === sec ? "border-signal/50 bg-signal/10 text-signal" : "border-line text-muted hover:text-text"}`}
                    >
                      {sectorLabel(sec, lang)} {n}
                    </button>
                  ))}
                </div>
              )}
              <EcoGraph rows={ecoRows} scores={hotScores} sectorOf={sectorOf} sector={effEcoSector} hub={hubLabel} onOpen={openDetail} t={t} />
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
                        <span className="inline-block whitespace-nowrap rounded-full border border-signal/40 bg-signal/10 px-2 py-0.5 text-[11px] font-medium text-signal">
                          ✓ {t("Mega bypass", "大票直通")}
                        </span>
                      ) : c.via === "social" ? (
                        <span className="inline-block whitespace-nowrap rounded-full border border-ignite/40 bg-ignite/10 px-2 py-0.5 text-[11px] font-medium text-ignite">
                          ✓ {c.phase ? (PHASE_L[c.phase]?.[lang] ?? c.phase) : t("Ignite", "点火")}
                        </span>
                      ) : (
                        <span className="inline-block whitespace-nowrap rounded-full border border-ok/40 bg-ok/10 px-2 py-0.5 text-[11px] font-medium text-ok">
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

// ── Ecosystem graph ────────────────────────────────────────────────────────
// A radial network: a central hub → the mega-cap anchors (inner ring) → the
// discovery targets (outer ring), each placed near the anchors it links to.
// Connections are drawn as animated "flowing light" edges coloured by role.
type EcoNeighbor = { ticker: string; kind: string; anchor: boolean; importance: number };
type EcoRow = { ticker: string; company: string; neighbors: EcoNeighbor[]; anchors: number; crit: number };

const HOT_SCORE = 7; // Focus score (0-10) at/above which a node lights up

function EcoGraph({
  rows,
  scores,
  sectorOf,
  sector,
  hub,
  onOpen,
  t,
}: {
  rows: EcoRow[];
  scores: Map<string, number>;
  sectorOf: (t: string) => string;
  sector: string | null;
  hub: string;
  onOpen: (t: string) => void;
  t: (en: string, zh: string) => string;
}) {
  const TOPT = 24;
  const pool = rows.filter((r) => r.anchors > 0).slice(0, TOPT);

  // Anchors = mega-caps IN THE SAME SECTOR (so e.g. NVDA doesn't show up as a
  // Healthcare anchor). Pick the most-referenced ones, cap the ring.
  const freq = new Map<string, number>();
  for (const r of pool)
    for (const n of r.neighbors)
      if (n.anchor && (!sector || sectorOf(n.ticker) === sector)) freq.set(n.ticker, (freq.get(n.ticker) ?? 0) + 1);
  const anchors = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map((e) => e[0]);
  const anchorIdx = new Map(anchors.map((a, i) => [a, i]));

  const targets = pool.filter((r) => r.neighbors.some((n) => n.anchor && anchorIdx.has(n.ticker)));
  if (!targets.length || !anchors.length) {
    return (
      <div className="py-10 text-center text-[12.5px] text-muted">
        {t(
          "No anchor-linked targets in this view yet — refresh supply-chain, or widen the sector filter.",
          "此视图暂无挂靠大票锚的目标——刷新供应链数据，或放宽板块筛选。",
        )}
      </div>
    );
  }

  const W = 960;
  const cx = W / 2;
  const cy = 350;
  const H = 700;
  const Ri = 132;
  const Ro = 292;
  const aAngle = (i: number) => (i / anchors.length) * 2 * Math.PI - Math.PI / 2;
  const aPos = (i: number) => ({ x: cx + Ri * Math.cos(aAngle(i)), y: cy + Ri * Math.sin(aAngle(i)) });

  // order targets by the circular mean of their anchor angles, then space evenly
  const withAngle = targets.map((r) => {
    let sx = 0;
    let sy = 0;
    for (const n of r.neighbors) {
      const i = anchorIdx.get(n.ticker);
      if (n.anchor && i != null) {
        sx += Math.cos(aAngle(i));
        sy += Math.sin(aAngle(i));
      }
    }
    return { r, ang: Math.atan2(sy, sx) };
  });
  withAngle.sort((a, b) => a.ang - b.ang);
  const n = withAngle.length;
  const tAngle = (i: number) => (i / n) * 2 * Math.PI - Math.PI / 2;
  const tPos = (i: number) => ({ x: cx + Ro * Math.cos(tAngle(i)), y: cy + Ro * Math.sin(tAngle(i)) });

  const GRP: Record<string, string> = GRP_COLOR;

  return (
    <div>
      <div className="mb-2 text-[11px] text-muted2">
        {t(
          `Top ${targets.length} anchor-linked targets · ${anchors.length} anchors · glowing = high Focus score (≥${HOT_SCORE}) · click any node`,
          `关联最强的 ${targets.length} 个目标 · ${anchors.length} 个大票锚 · 发光 = 你的 Focus 分高(≥${HOT_SCORE}) · 点任意节点`,
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-[#0a1017]">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 680, display: "block" }}>
          <defs>
            <radialGradient id="ecoCoreGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#3dd6c4" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#3dd6c4" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx={cx} cy={cy} r={210} fill="url(#ecoCoreGlow)" />

          {/* center → anchor spokes */}
          {anchors.map((_, i) => {
            const p = aPos(i);
            return <line key={`ca${i}`} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#e9c46a55" strokeWidth={1.2} />;
          })}

          {/* target → anchor edges (animated flowing light) */}
          {withAngle.map(({ r }, ti) => {
            const tp = tPos(ti);
            return r.neighbors
              .filter((nb) => nb.anchor && anchorIdx.has(nb.ticker))
              .map((nb) => {
                const ap = aPos(anchorIdx.get(nb.ticker)!);
                const c = GRP[nb.kind] ?? "#5fb0e8";
                return (
                  <line
                    key={`e${r.ticker}-${nb.ticker}`}
                    className="eco-edge"
                    x1={tp.x}
                    y1={tp.y}
                    x2={ap.x}
                    y2={ap.y}
                    stroke={c}
                    strokeWidth={nb.importance >= 3 ? 2 : 1}
                    strokeOpacity={nb.importance >= 3 ? 0.9 : 0.5}
                  />
                );
              });
          })}

          {/* center hub */}
          <circle cx={cx} cy={cy} r={30} fill="#0e2a3a" stroke="#3dd6c4" strokeWidth={2} style={{ filter: "drop-shadow(0 0 12px #3dd6c4aa)" }} />
          <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize={hub.length > 7 ? 9 : 11} fontWeight="700" fill="#3dd6c4">
            {hub}
          </text>

          {/* anchor nodes */}
          {anchors.map((a, i) => {
            const p = aPos(i);
            return (
              <g key={a} className="eco-node" onClick={() => onOpen(a)}>
                <circle cx={p.x} cy={p.y} r={17} fill="#2a2413" stroke="#e9c46a" strokeWidth={2} style={{ filter: "drop-shadow(0 0 7px #e9c46a99)" }} />
                <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontSize="9.5" fontWeight="700" fontFamily="ui-monospace, monospace" fill="#f0d78a">
                  {a}
                </text>
              </g>
            );
          })}

          {/* target nodes + labels — glow = high Focus score on your side */}
          {withAngle.map(({ r }, ti) => {
            const p = tPos(ti);
            const rad = 5 + Math.min(r.neighbors.length, 8) * 0.9;
            const ang = tAngle(ti);
            const lx = cx + (Ro + 20) * Math.cos(ang);
            const ly = cy + (Ro + 20) * Math.sin(ang);
            const anchorRight = Math.cos(ang) >= 0;
            const score = scores.get(r.ticker) ?? 0;
            const hot = score >= HOT_SCORE;
            return (
              <g key={r.ticker} className="eco-node" onClick={() => onOpen(r.ticker)}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={hot ? rad + 1.5 : rad}
                  fill={hot ? "#3dd6c4" : "#14313a"}
                  stroke={hot ? "#7ff0e2" : "#3dd6c455"}
                  strokeWidth={hot ? 2.5 : 1.2}
                  style={hot ? { filter: "drop-shadow(0 0 8px #3dd6c4)" } : undefined}
                />
                <text
                  x={lx}
                  y={ly + 3}
                  textAnchor={anchorRight ? "start" : "end"}
                  fontSize={hot ? 11.5 : 10}
                  fontFamily="ui-monospace, monospace"
                  fontWeight={hot ? 700 : 500}
                  fill={hot ? "#7ff0e2" : "#8695a3"}
                >
                  {r.ticker}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
