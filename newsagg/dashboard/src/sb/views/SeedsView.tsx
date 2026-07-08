import { useMemo, useState } from "react";
import { useStore } from "../../store";
import { buildSeeds, CATALYST_CN, ROLE_CN } from "../pipeline";
import { ViewHead, Card, Chip } from "../ui";

export function SeedsView() {
  const data = useStore((s) => s.data);
  const seeds = useMemo(() => buildSeeds(data), [data]);
  const [thesisOnly, setThesisOnly] = useState(false);

  const thesisCount = seeds.filter((r) => r.hasThesis).length;
  const rows = thesisOnly ? seeds.filter((r) => r.hasThesis) : seeds;

  return (
    <div>
      <ViewHead
        eyebrow="Stage 1 · 采集"
        title="当日看多种子表"
        desc="全网看多种子去重成一张表（每票一行）。有分析师发文看多的标 ★ 论点；其余为 Quant / 分析师覆盖榜单上的看多票。catalyst / role / evidence / followers / author_weight 待 LLM 归一步骤接入。"
      />

      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-line">
          <button
            onClick={() => setThesisOnly(false)}
            className={`px-3 py-1.5 text-[12px] ${!thesisOnly ? "bg-signal/15 text-signal" : "text-muted hover:text-text"}`}
          >
            全部 {seeds.length}
          </button>
          <button
            onClick={() => setThesisOnly(true)}
            className={`px-3 py-1.5 text-[12px] ${thesisOnly ? "bg-signal/15 text-signal" : "text-muted hover:text-text"}`}
          >
            ★ 有分析师论点 {thesisCount}
          </button>
        </div>
        <span className="ml-auto font-mono text-[12px] text-muted2">{rows.length} 条 · 已去重</span>
      </div>

      <Card pad0>
        {rows.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-muted">
            暂无种子。运行抓取器后，SeekingAlpha 的看多票会出现在这里。
          </div>
        ) : (
          <div className="max-h-[calc(100vh-260px)] overflow-auto">
            <table className="w-full min-w-[920px] text-[13px]">
              <thead className="sticky top-0 z-[1] bg-panel">
                <tr className="text-[11px] uppercase tracking-wide text-muted2">
                  <Th>标的</Th>
                  <Th>标记 / 来源</Th>
                  <Th>作者</Th>
                  <Th right>Followers</Th>
                  <Th>Reasoning</Th>
                  <Th right>Quant</Th>
                  <Th>Catalyst</Th>
                  <Th>Role</Th>
                  <Th right>Weight</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.ticker}
                    className={`border-t border-line hover:bg-white/[0.02] ${r.hasThesis ? "bg-signal/[0.03]" : ""}`}
                    onClick={() => useStore.getState().setTicker(r.ticker)}
                  >
                    <td className="px-3 py-2.5">
                      <div className="font-mono font-semibold text-signal">{r.ticker}</div>
                      <div className="text-[11px] text-muted">{r.company}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1">
                        {r.hasThesis && <Chip kind="signal">★ 论点</Chip>}
                        {r.tags.map((t) => (
                          <span key={t} className="rounded bg-panel2 px-1.5 py-0.5 text-[10px] text-muted">
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">{r.author ?? <span className="text-muted2">—</span>}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-muted2">{r.followers ?? "—"}</td>
                    <td className="max-w-[300px] px-3 py-2.5">
                      {r.reasoning ? (
                        <div className="truncate text-[12.5px]">{r.reasoning}</div>
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
                        {CATALYST_CN[r.catalyst]}
                      </Chip>
                    </td>
                    <td className="px-3 py-2.5 text-muted">{ROLE_CN[r.role]}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-muted2">{r.weight ?? "—"}</td>
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

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-3 py-2 font-medium ${right ? "text-right" : "text-left"}`}>{children}</th>
  );
}
