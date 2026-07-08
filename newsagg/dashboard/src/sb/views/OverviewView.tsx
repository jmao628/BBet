import { useStore } from "../../store";
import { buildSeeds, buildUniverse } from "../pipeline";
import { ViewHead, StatStrip, Card, Chip, TickerCell } from "../ui";
import { FUNNEL } from "../nav";

export function OverviewView() {
  const data = useStore((s) => s.data);
  const setView = useStore((s) => s.setView);
  const seeds = buildSeeds(data);
  const universe = buildUniverse(data);

  return (
    <div>
      <ViewHead
        eyebrow={`Discovery run · ${data?.generated_at?.slice(0, 10) ?? "—"}`}
        title="发现机器 · 当日运行总览"
        desc="从全网看多种子表出发，经热度择时 → 发现筛选 → 催化剂 → 管理层 conviction → Boll 技术五道闸，收敛出「即将被发现」的中小盘做多候选。"
      />

      <StatStrip
        stats={[
          {
            k: "种子条数 seeds",
            v: seeds.length,
            d: `其中 ${seeds.filter((s) => s.hasThesis).length} 只有分析师论点`,
          },
          { k: "热度点火 ignition", v: "—", d: "待接 X / Ape Wisdom", color: "#f2a73c" },
          { k: "通关候选 finalists", v: "—", d: "五闸全过", color: "#3dd6c4" },
          { k: "覆盖标的 universe", v: universe.length, d: "去重后 tickers" },
        ]}
      />

      <div className="grid gap-4">
        <Card title="漏斗状态 · Pipeline" sub="各层数据接入进度" pad0>
          <table className="w-full text-[13px]">
            <tbody>
              {FUNNEL.map((s) => {
                const ready = s.key === "seeds";
                return (
                  <tr
                    key={s.key}
                    onClick={() => setView(s.key)}
                    className="cursor-pointer border-t border-line first:border-t-0 hover:bg-white/[0.02]"
                  >
                    <td className="px-4 py-2.5">
                      <span className="mr-2 font-mono text-muted2">{s.step}</span>
                      {s.lbl}
                      <span className="ml-2 text-[11px] text-muted2">{s.sub}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {ready ? (
                        <Chip kind="ok">已接入</Chip>
                      ) : (
                        <Chip kind="wait">待接入计算</Chip>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card title="种子 universe · 覆盖标的" sub={`${universe.length} 只 · 按 Quant 分排序`} pad0>
          {universe.length === 0 ? (
            <div className="p-6 text-center text-[13px] text-muted">暂无数据，运行抓取器后填充。</div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-panel">
                  <tr className="text-[11px] uppercase tracking-wide text-muted2">
                    <th className="px-4 py-2 text-left font-medium">标的</th>
                    <th className="px-4 py-2 text-left font-medium">来源板块</th>
                    <th className="px-4 py-2 text-right font-medium">Quant</th>
                  </tr>
                </thead>
                <tbody>
                  {universe.slice(0, 60).map((u) => (
                    <tr
                      key={u.ticker}
                      className="cursor-pointer border-t border-line hover:bg-white/[0.02]"
                      onClick={() => useStore.getState().setTicker(u.ticker)}
                    >
                      <td className="px-4 py-2.5">
                        <TickerCell ticker={u.ticker} company={u.company} />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {u.tags.map((t) => (
                            <span
                              key={t}
                              className="rounded bg-panel2 px-1.5 py-0.5 text-[10px] text-muted"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                        {u.quant != null ? (
                          <span className="font-semibold text-ok">{u.quant.toFixed(2)}</span>
                        ) : (
                          <span className="text-muted2">—</span>
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
    </div>
  );
}
