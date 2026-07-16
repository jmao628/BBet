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

  // Ecosystem network — grouped strictly BY SECTOR. Each graph contains ONLY
  // that sector's own stocks (Tech shows tech, never WFC). Within a sector the
  // ring is split by MARKET CAP: large caps sit on the inner gold ring, smaller
  // caps on the outer blue ring. Edges are supply-chain ties that stay inside
  // the sector (a member's supplier/customer/peer that is ALSO in this sector).
  const ecoSectors = useMemo(() => {
    const bySector = new Map<string, EcoMember[]>();
    if (!supplychain) return bySector;
    const uni = buildUniverse(data);
    const inUni = new Set(uni.map((u) => u.ticker));
    const companyOf = new Map(uni.map((u) => [u.ticker, u.company]));
    const eco = buildEcoAdjacency(supplychain, marketCaps); // symmetrized
    for (const u of uni) {
      const sec = sectorOf(u.ticker);
      if (!sec) continue;
      const cap = marketCaps?.[u.ticker];
      if (typeof cap === "number" && cap < 3e8) continue; // drop tiny/illiquid
      // Keep only ties whose other end is in THIS sector and in your universe —
      // that is what makes the graph a pure single-sector network.
      const links = (eco.get(u.ticker) ?? [])
        .filter((n) => n.ticker !== u.ticker && inUni.has(n.ticker) && sectorOf(n.ticker) === sec)
        .map((n) => ({ ticker: n.ticker, kind: n.kind, importance: n.importance }));
      const m: EcoMember = {
        ticker: u.ticker,
        company: companyOf.get(u.ticker) ?? "",
        cap: typeof cap === "number" ? cap : 0,
        big: bypassesHeat(cap), // ≥$100B ⇒ inner gold ring
        links,
      };
      if (!bySector.has(sec)) bySector.set(sec, []);
      bySector.get(sec)!.push(m);
    }
    return bySector;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplychain, data, marketCaps, sectors]);

  const ecoSectorCounts = useMemo(
    () => [...ecoSectors.entries()].map(([s, m]) => [s, m.length] as [string, number]).sort((a, b) => b[1] - a[1]),
    [ecoSectors],
  );
  // The ecosystem graph is always ONE sector (a mixed "All" is an unreadable
  // hairball). Default to the sector with the most names.
  const effEcoSector = ecoSector ?? ecoSectorCounts[0]?.[0] ?? null;
  const ecoMembers = effEcoSector ? ecoSectors.get(effEcoSector) ?? [] : [];
  const linkTotal = useMemo(
    () => [...ecoSectors.values()].reduce((s, m) => s + m.length, 0),
    [ecoSectors],
  );

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
            linkTotal
              ? t(`${linkTotal} names · grouped by sector · pick one below`, `${linkTotal} 只 · 按板块分组 · 下方选板块`)
              : t("no in-sector links mapped yet", "尚未映射到板块内关联")
          }
          right={<MethodInfo />}
        >
          {linkTotal === 0 ? (
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
                    "One sector at a time — every node belongs to THIS sector (a Tech graph shows only Tech names). Centre = the sector. Inner gold ring = its large-cap members (≥$100B market cap); outer blue ring = the smaller-cap names. Edges are supply-chain ties that stay inside the sector — a member's supplier, customer, or peer that is also in this sector (edge colour tells you which). A glowing node = it's on your Focus List. Click any node.",
                    "一次看一个板块——每个节点都属于该板块（Tech 图里只有 Tech 的票）。中心 = 该板块。内圈金色 = 板块内大市值成员（≥$1000亿市值）；外圈蓝色 = 小市值成员。连线是留在板块内部的产业链关系——某成员的供应商 / 客户 / 同业且同属该板块（连线颜色区分）。发光节点 = 在你的 Focus 名单里。点任意节点。",
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="flex items-center gap-1.5" style={{ color: "#f0d78a" }}>
                    <span className="h-2 w-2 rounded-full" style={{ background: "#e9c46a" }} />
                    {t("large cap (≥$100B)", "大市值（≥$1000亿）")}
                  </span>
                  <span className="flex items-center gap-1.5" style={{ color: "#8fd6ea" }}>
                    <span className="h-2 w-2 rounded-full" style={{ background: "#5fb0e8" }} />
                    {t("smaller cap", "小市值")}
                  </span>
                  <span className="text-muted2">·</span>
                  <span className="text-muted2">{t("Edge colour = tie type:", "连线颜色 = 关系类型：")}</span>
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
              <EcoGraph members={ecoMembers} scores={hotScores} hub={hubLabel} onOpen={openDetail} t={t} />
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
// A radial network for ONE sector. Centre = the sector hub. Inner gold ring =
// its large-cap members (≥$100B); outer blue ring = the smaller-cap members.
// Every node belongs to this sector — no cross-sector nodes. Edges are
// supply-chain ties that stay inside the sector, coloured by tie type.
type EcoLink = { ticker: string; kind: string; importance: number };
type EcoMember = { ticker: string; company: string; cap: number; big: boolean; links: EcoLink[] };

function EcoGraph({
  members,
  scores,
  hub,
  onOpen,
  t,
}: {
  members: EcoMember[];
  scores: Map<string, number>;
  hub: string;
  onOpen: (t: string) => void;
  t: (en: string, zh: string) => string;
}) {
  const RING_BIG = 16; // max large-caps on the inner ring
  const RING_SMALL = 30; // max smaller-caps on the outer ring
  const byCap = [...members].sort((a, b) => b.cap - a.cap);
  let big = byCap.filter((m) => m.big);
  let small = byCap.filter((m) => !m.big);
  // Fallback: a sector with no true mega-cap still gets a gold "anchor" ring —
  // promote its largest few names so the graph has a readable inner hub.
  if (!big.length && byCap.length) {
    const k = Math.min(3, byCap.length);
    big = byCap.slice(0, k);
    small = byCap.slice(k);
  }
  big = big.slice(0, RING_BIG);
  // Keep the most connected / Focus-listed smaller names when there are many.
  small = [...small]
    .sort(
      (a, b) =>
        (scores.has(b.ticker) ? 1 : 0) - (scores.has(a.ticker) ? 1 : 0) ||
        b.links.length - a.links.length ||
        b.cap - a.cap,
    )
    .slice(0, RING_SMALL);

  if (!big.length && !small.length) {
    return (
      <div className="py-10 text-center text-[12.5px] text-muted">
        {t(
          "No names mapped in this sector yet — refresh supply-chain, or pick another sector.",
          "该板块暂无映射到的票——刷新供应链数据，或换一个板块。",
        )}
      </div>
    );
  }

  const W = 960;
  const cx = W / 2;
  const cy = 350;
  const H = 700;
  const Ri = big.length > 1 ? 150 : 0;
  const Ro = 300;

  const bAngle = (i: number) => (big.length ? (i / big.length) * 2 * Math.PI - Math.PI / 2 : 0);
  const bPos = (i: number) =>
    big.length === 1 ? { x: cx, y: cy } : { x: cx + Ri * Math.cos(bAngle(i)), y: cy + Ri * Math.sin(bAngle(i)) };
  const sAngle = (i: number) => (small.length ? (i / small.length) * 2 * Math.PI - Math.PI / 2 : 0);
  const sPos = (i: number) => ({ x: cx + Ro * Math.cos(sAngle(i)), y: cy + Ro * Math.sin(sAngle(i)) });

  // Position lookup for edge drawing (every drawn node, by ticker).
  const pos = new Map<string, { x: number; y: number }>();
  big.forEach((m, i) => pos.set(m.ticker, bPos(i)));
  small.forEach((m, i) => pos.set(m.ticker, sPos(i)));

  // Same-sector edges, de-duplicated by unordered pair. Keep the strongest tie.
  const edges = new Map<string, { a: string; b: string; kind: string; importance: number }>();
  for (const m of members) {
    if (!pos.has(m.ticker)) continue;
    for (const l of m.links) {
      if (!pos.has(l.ticker)) continue;
      const key = m.ticker < l.ticker ? `${m.ticker}|${l.ticker}` : `${l.ticker}|${m.ticker}`;
      const prev = edges.get(key);
      if (!prev || l.importance > prev.importance)
        edges.set(key, { a: m.ticker, b: l.ticker, kind: l.kind, importance: l.importance });
    }
  }

  const GRP: Record<string, string> = GRP_COLOR;
  const drawn = big.length + small.length;

  return (
    <div>
      <div className="mb-2 text-[11px] text-muted2">
        {t(
          `${hub} sector · ${drawn} names shown (${members.length} total) · ${big.length} large-cap · ${small.length} smaller · glowing = on your Focus List · click any node`,
          `${hub} 板块 · 展示 ${drawn} 只（共 ${members.length}）· ${big.length} 大市值 · ${small.length} 小市值 · 发光 = 在你的 Focus 名单里 · 点任意节点`,
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

          {/* center → large-cap spokes */}
          {big.length > 1 &&
            big.map((_, i) => {
              const p = bPos(i);
              return <line key={`cb${i}`} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#e9c46a55" strokeWidth={1.2} />;
            })}

          {/* same-sector supply-chain edges, coloured by tie type */}
          {[...edges.values()].map((e) => {
            const pa = pos.get(e.a)!;
            const pb = pos.get(e.b)!;
            const c = GRP[e.kind] ?? "#5fb0e8";
            return (
              <line
                key={`e${e.a}-${e.b}`}
                className="eco-edge"
                x1={pa.x}
                y1={pa.y}
                x2={pb.x}
                y2={pb.y}
                stroke={c}
                strokeWidth={e.importance >= 3 ? 2 : 1}
                strokeOpacity={e.importance >= 3 ? 0.85 : 0.45}
              />
            );
          })}

          {/* center hub */}
          <circle cx={cx} cy={cy} r={30} fill="#0e2a3a" stroke="#3dd6c4" strokeWidth={2} style={{ filter: "drop-shadow(0 0 12px #3dd6c4aa)" }} />
          <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize={hub.length > 7 ? 9 : 11} fontWeight="700" fill="#3dd6c4">
            {hub}
          </text>

          {/* large-cap nodes (gold inner ring) */}
          {big.length > 1 &&
            big.map((m, i) => {
              const p = bPos(i);
              const hot = scores.has(m.ticker);
              return (
                <g key={m.ticker} className="eco-node" onClick={() => onOpen(m.ticker)}>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={18}
                    fill="#2a2413"
                    stroke={hot ? "#ffe08a" : "#e9c46a"}
                    strokeWidth={hot ? 2.6 : 2}
                    style={{ filter: `drop-shadow(0 0 ${hot ? 10 : 7}px #e9c46a99)` }}
                  />
                  <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontSize="9.5" fontWeight="700" fontFamily="ui-monospace, monospace" fill="#f0d78a">
                    {m.ticker}
                  </text>
                </g>
              );
            })}

          {/* smaller-cap nodes (blue outer ring) + labels */}
          {small.map((m, i) => {
            const p = sPos(i);
            const rad = 5 + Math.min(m.links.length, 8) * 0.9;
            const ang = sAngle(i);
            const lx = cx + (Ro + 20) * Math.cos(ang);
            const ly = cy + (Ro + 20) * Math.sin(ang);
            const anchorRight = Math.cos(ang) >= 0;
            const hot = scores.has(m.ticker); // in your Focus List → light up
            return (
              <g key={m.ticker} className="eco-node" onClick={() => onOpen(m.ticker)}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={hot ? rad + 1.5 : rad}
                  fill={hot ? "#3dd6c4" : "#123244"}
                  stroke={hot ? "#7ff0e2" : "#5fb0e888"}
                  strokeWidth={hot ? 2.5 : 1.4}
                  style={hot ? { filter: "drop-shadow(0 0 8px #3dd6c4)" } : undefined}
                />
                <text
                  x={lx}
                  y={ly + 3}
                  textAnchor={anchorRight ? "start" : "end"}
                  fontSize={hot ? 11.5 : 10}
                  fontFamily="ui-monospace, monospace"
                  fontWeight={hot ? 700 : 500}
                  fill={hot ? "#7ff0e2" : "#8fb6cc"}
                >
                  {m.ticker}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
