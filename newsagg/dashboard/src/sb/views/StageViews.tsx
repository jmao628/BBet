import type { ReactNode } from "react";
import { useT } from "../../store";
import { ViewHead, Card, Pending } from "../ui";

// The computed pipeline stages. Structure + the framework's method as a
// reference; each fills with real numbers once its computation is wired.

function Ref({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <Card title={t("Method", "方法 · Method")}>
      <div className="space-y-2 text-[12.5px] leading-relaxed text-muted">{children}</div>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-32 flex-none font-mono text-[11px] uppercase tracking-wide text-muted2">{k}</span>
      <span>{v}</span>
    </div>
  );
}

export function TechnicalView() {
  const t = useT();
  return (
    <div className="view-in">
      <ViewHead
        eyebrow={t("Stage 5 · Bollinger", "Stage 5 · Boll 技术")}
        title={t("Bollinger · Riding-the-Band Timing", "Boll 技术 · 骑轨择时")}
        desc={t(
          "Bollinger timing: close riding between +2σ and +3σ, SMA20 slope positive, bands expanding → entry. Overheated (≥+3σ) don't chase; unconfirmed (<+2σ) wait.",
          "布林带择时：收盘骑在 +2σ~+3σ 之间、SMA20 斜率为正、带宽扩张，才算进场；过热(≥+3σ)不追，未确认(<+2σ)则等。",
        )}
      />
      <div className="grid gap-4">
        <Pending
          title={t("Pending: daily close series", "待接入：日线收盘价序列")}
          needs={t(
            "Price source: yfinance / vendor daily close|Mid SMA20; σ = 20-period stdev; upper = +2σ; top = +3σ; width = (upper−lower)/mid|Entry: close ∈ [+2σ,+3σ] & SMA20 slope>0 & width expanding|Output: technical_ok + band position",
            "价格源：yfinance / 数据商日线收盘|中轨 SMA20；σ=20期标准差；上轨=+2σ；最上轨=+3σ；带宽=(上−下)/中|进场：收盘∈[+2σ,+3σ] & SMA20 斜率>0 & 带宽扩张|产出：technical_ok + 所在轨位（几σ / 相对结构低点）",
          ).split("|")}
        />
        <Ref>
          <Row k={t("Cut / wait", "淘汰/等待")} v={t("close ≥+3σ overheated, don't chase; close <+2σ momentum unconfirmed, wait", "收盘≥+3σ 过热不追；收盘<+2σ 动量未确认，等")} />
          <Row k={t("Coiled setup", "埋伏形态")} v={t("above SMA20, structure low intact, width tightening, no blow-off break", "站上 SMA20、未破结构低点、带宽收窄蓄势、无放量破位")} />
        </Ref>
      </div>
    </div>
  );
}

export function CandidatesView() {
  const t = useT();
  const GATES = [t("Heat", "热度"), t("Screen", "筛选"), t("Catalyst", "催化剂"), "Conviction", t("Technical", "技术")];
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
