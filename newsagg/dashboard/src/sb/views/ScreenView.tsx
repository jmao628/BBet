import { useMemo } from "react";
import { useStore } from "../../store";
import { buildScreen, type CapSize } from "../pipeline";
import { ViewHead, Card, StatStrip } from "../ui";

const CAP_CN: Record<CapSize, string> = { large: "大盘", mid: "中盘", small: "小盘", unknown: "—" };

const PHASE_CN: Record<string, string> = {
  detonate: "引爆",
  ignite: "点火",
  watch: "观察",
  dead: "死水",
  ultralow: "超低覆盖",
  warming: "积累中",
};

export function ScreenView() {
  const data = useStore((s) => s.data);
  const heat = useStore((s) => s.heat);
  const marketCaps = useStore((s) => s.marketCaps);
  const setTicker = useStore((s) => s.setTicker);

  const { candidates, total, passedHeat } = useMemo(
    () => buildScreen(data, heat, marketCaps),
    [data, heat, marketCaps],
  );

  return (
    <div>
      <ViewHead
        eyebrow="Stage 3 · 发现筛选"
        title="发现筛选 · 即将被发现的中小盘"
        desc="种子表 → SA 评分门槛（无评分的纯分析师提及不入围）→ 过热度闸（大票直通 / 中小盘点火）→ 作者质量二段（有分析师看多论点）→ 发现候选短名单。作者白名单接入后，二段将换成精确的 author_weight 过滤。"
      />

      <StatStrip
        stats={[
          { k: "种子 seeds", v: total, d: "去重后全部看多票" },
          { k: "过热度闸", v: passedHeat, d: "大票直通 + 中小盘点火", color: "#f2a73c" },
          { k: "发现候选", v: candidates.length, d: "+ 作者质量二段", color: "#3dd6c4" },
        ]}
      />

      <Card
        title="发现候选 · Candidates"
        sub={`${candidates.length} 只 · 大盘在前，再按 z 排序`}
        pad0
      >
        {candidates.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-muted">
            暂无候选。可能原因：中小盘还没社交点火（热度需每天积累），或市值数据未接入。
          </div>
        ) : (
          <div className="max-h-[calc(100vh-320px)] overflow-auto">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead className="sticky top-0 z-[1] bg-panel">
                <tr className="text-[11px] uppercase tracking-wide text-muted2">
                  <th className="px-3 py-2 text-left font-medium">标的</th>
                  <th className="px-3 py-2 text-left font-medium">市值</th>
                  <th className="px-3 py-2 text-left font-medium">热度闸</th>
                  <th className="px-3 py-2 text-right font-medium">z</th>
                  <th className="px-3 py-2 text-left font-medium">作者</th>
                  <th className="px-3 py-2 text-left font-medium">论点</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr
                    key={c.ticker}
                    onClick={() => setTicker(c.ticker)}
                    className="cursor-pointer border-t border-line hover:bg-white/[0.03]"
                  >
                    <td className="px-3 py-2.5">
                      <span className="font-mono font-semibold text-signal">{c.ticker}</span>
                      <span className="ml-2 text-[11px] text-muted">{c.company}</span>
                    </td>
                    <td className="px-3 py-2.5 text-[12px] text-muted">{CAP_CN[c.cap]}</td>
                    <td className="px-3 py-2.5">
                      {c.bypass ? (
                        <span className="rounded-full border border-signal/40 bg-signal/10 px-2 py-0.5 text-[11px] font-medium text-signal">
                          大票直通
                        </span>
                      ) : (
                        <span className="rounded-full border border-ignite/40 bg-ignite/10 px-2 py-0.5 text-[11px] font-medium text-ignite">
                          {c.phase ? PHASE_CN[c.phase] ?? c.phase : "点火"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {c.z != null ? c.z.toFixed(2) : <span className="text-muted2">—</span>}
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
