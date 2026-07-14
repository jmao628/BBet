import { useT } from "../../store";
import { ViewHead, Card, Pending } from "../ui";

// The final output view. Structure + the framework's method as a reference;
// fills with real numbers once every gate computes.

export function CandidatesView() {
  const t = useT();
  const GATES = [t("Heat", "热度"), t("Screen", "筛选"), t("Catalyst", "催化剂"), "Conviction"];
  return (
    <div className="view-in">
      <ViewHead
        eyebrow={t("Output · Finalists", "Output · 通关候选")}
        title={t("Finalists · All Five Gates", "通关候选 · 五闸全过")}
        desc={t(
          "Judged by absolute, reproducible rules with short-circuit: any gate fails → cut/wait; all five pass → a long candidate, ranked by composite score.",
          "按绝对且可复现的规则短路判定：任一闸不过即剔除/等待，五闸全过才成为做多候选，按综合分排序。",
        )}
      />
      <div className="grid gap-4">
        <Pending
          title={t("Pending: auto-generated once the five gates compute", "待接入：五道闸计算完成后自动生成")}
          needs={t(
            "Depends on Stages 2-6 all wired (heat / screen / catalyst / conviction / technical)|Composite = 0.30·catalyst + 0.28·conviction×10 + 0.22·heat + 0.20·technical|Decision: any gate fail → cut/wait; all five pass → long candidate",
            "依赖 Stage 2-6 全部接入（热度 / 筛选 / 催化剂 / Conviction / 技术）|综合分 = 0.30×催化剂 + 0.28×Conviction×10 + 0.22×热度分 + 0.20×技术|决策：任一闸 fail → 剔除/等待；五闸 pass → 做多候选",
          ).split("|")}
        />
        <Card title={t("Gates", "五闸结构 · Gates")} sub={t("short-circuit order", "short-circuit 顺序判定")} pad0>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted2">
                <th className="px-4 py-2 text-left font-medium">{t("Ticker", "标的")}</th>
                {GATES.map((g) => (
                  <th key={g} className="px-3 py-2 text-center font-medium">
                    {g}
                  </th>
                ))}
                <th className="px-4 py-2 text-right font-medium">{t("Score", "综合分")}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-line">
                <td className="px-4 py-6 text-center text-muted" colSpan={GATES.length + 2}>
                  {t("Finalists will appear here once the five gates compute.", "五道闸计算接入后，通关候选将出现在这里。")}
                </td>
              </tr>
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
