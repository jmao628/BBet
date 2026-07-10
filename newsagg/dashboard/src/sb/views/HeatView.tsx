import { useMemo, useState } from "react";
import { useStore } from "../../store";
import { buildRankings, sectorCN, type Ranking } from "../pipeline";
import { ViewHead, Card, StatStrip } from "../ui";
import { MethodInfo } from "../MethodInfo";

const LENS_COLOR: Record<string, string> = {
  attention: "#3dd6c4",
  rvol: "#5fb0e8",
  momentum: "#f2a73c",
  social: "#e9c46a",
};

function RankingCard({ ranking, filter }: { ranking: Ranking; filter: string | null }) {
  const openDetail = useStore((s) => s.openDetail);
  const color = LENS_COLOR[ranking.key] ?? "#3dd6c4";
  const advancing = ranking.rows.filter((r) => r.advancing).length;
  const rows = (filter ? ranking.rows.filter((r) => r.sector === filter) : ranking.rows).slice(0, 15);
  return (
    <Card
      title={ranking.label}
      sub={`${advancing} 达标入选 · 共 ${ranking.rows.length} 只`}
      pad0
      right={<span className="h-2 w-2 rounded-full" style={{ background: color }} />}
    >
      <div className="px-[18px] pb-1 pt-2 text-[11px] text-muted2">{ranking.desc}</div>
      <div className="max-h-[360px] overflow-y-auto">
        <table className="w-full text-[13px]">
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="px-[18px] py-4 text-[12px] text-muted2">该板块在此维度暂无标的。</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.ticker}
                onClick={() => openDetail(r.ticker)}
                className={`cursor-pointer border-t border-line hover:bg-white/[0.03] ${
                  r.advancing ? "" : "opacity-45"
                }`}
              >
                <td className="w-8 py-2 pl-[18px] pr-1 text-right font-mono text-[11px] text-muted2">
                  {r.rank}
                </td>
                <td className="py-2 pl-2">
                  <span className="font-mono font-semibold text-signal">{r.ticker}</span>
                  <span className="ml-2 text-[11px] text-muted">{r.company}</span>
                </td>
                <td className="py-2 text-[11px] text-muted2">{sectorCN(r.sector)}</td>
                <td
                  className="py-2 pr-2 text-right font-mono tabular-nums"
                  style={{ color: r.advancing ? color : undefined }}
                >
                  {r.display}
                </td>
                <td className="w-12 py-2 pr-[18px] text-right">
                  {r.advancing && (
                    <span
                      className="rounded-full border px-1.5 py-0.5 text-[10px] font-medium"
                      style={{ color, borderColor: `${color}66`, background: `${color}18` }}
                    >
                      入选
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function HeatView() {
  const data = useStore((s) => s.data);
  const heat = useStore((s) => s.heat);
  const technical = useStore((s) => s.technical);
  const sectors = useStore((s) => s.sectors);
  const marketCaps = useStore((s) => s.marketCaps);
  const [filter, setFilter] = useState<string | null>(null);

  const bundle = useMemo(
    () => buildRankings(data, heat, technical, marketCaps, sectors),
    [data, heat, technical, marketCaps, sectors],
  );

  // Sector breakdown of the advancing set — shows why it skews to one sector.
  const sectorCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const t of bundle.advancing) {
      const sec = sectors?.[t]?.sector ?? "";
      if (sec) c.set(sec, (c.get(sec) ?? 0) + 1);
    }
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [bundle.advancing, sectors]);

  if (bundle.rankings.length === 0) {
    return (
      <div>
        <ViewHead
          eyebrow="Stage 2 · 热度点火"
          title="热度点火 · 多维排名"
          desc="全部有 SA 评分的票,按量价注意力 / 放量 / 动量 / 社交热度多个维度分别排名。"
          actions={<MethodInfo />}
        />
        <Card>
          <div className="p-6 text-center text-[13px] text-muted">
            还没有量价或热度数据。运行{" "}
            <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-signal">
              python -m newsagg.technical
            </code>{" "}
            与{" "}
            <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-signal">
              python -m newsagg.heat
            </code>
            。
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <ViewHead
        eyebrow="Stage 2 · 热度点火"
        title="热度点火 · 多维排名"
        desc="种子池全部在此,按多个独立维度分别排名——量价注意力、放量 RVOL、60 日动量、社交热度。每个维度取前 10 且达标才点亮入选(弱势那天没票达标就全灰,不硬凑)。任一维度入选即晋级下一轮。点行看详情。"
        actions={<MethodInfo />}
      />

      <StatStrip
        stats={[
          { k: "种子池", v: bundle.universe, d: "有 SA 评分的票" },
          { k: "入选下一轮", v: bundle.advancing.size, d: "各维度达标前 10 的并集", color: "#3dd6c4" },
          { k: "排名维度", v: bundle.rankings.length, d: "量价/放量/动量/社交" },
          {
            k: "主导板块",
            v: sectorCounts.length ? sectorCN(sectorCounts[0][0]) : "—",
            d: sectorCounts.length ? `${sectorCounts[0][1]} 只入选` : "待板块数据",
            color: "#f2a73c",
          },
        ]}
      />

      {/* sector filter */}
      {sectorCounts.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted2">按板块看入选:</span>
          <button
            onClick={() => setFilter(null)}
            className={`rounded-full border px-2.5 py-0.5 text-[12px] ${
              filter === null ? "border-signal/50 bg-signal/10 text-signal" : "border-line text-muted hover:text-text"
            }`}
          >
            全部 {bundle.advancing.size}
          </button>
          {sectorCounts.map(([sec, n]) => (
            <button
              key={sec}
              onClick={() => setFilter(filter === sec ? null : sec)}
              className={`rounded-full border px-2.5 py-0.5 text-[12px] ${
                filter === sec ? "border-signal/50 bg-signal/10 text-signal" : "border-line text-muted hover:text-text"
              }`}
            >
              {sectorCN(sec)} {n}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(360px,1fr))]">
        {bundle.rankings.map((r) => (
          <RankingCard key={r.key} ranking={r} filter={filter} />
        ))}
      </div>
    </div>
  );
}
