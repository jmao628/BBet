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

export function CatalystView() {
  const t = useT();
  return (
    <div className="view-in">
      <ViewHead
        eyebrow={t("Stage 3 · Catalyst", "Stage 3 · 催化剂")}
        title={t("Catalyst Score · T × P × M × N", "催化剂评分 · T × P × M × N")}
        desc={t(
          "Pull every candidate catalyst on the ticker (seed table + earnings calendar), score each on TPMN, take the strongest as the primary (not summed); the rest are secondary catalysts.",
          "抽出这只票身上所有候选催化剂（种子表 + 财报日历），每个各算 TPMN 分，取最强的当主分（不相加），其余列为次要催化剂。",
        )}
      />
      <div className="grid gap-4">
        <Pending
          title={t("Pending: catalyst list + TPMN scoring", "待接入：催化剂清单 + TPMN 打分")}
          needs={t(
            "Collect: seed catalyst_type (earnings/guidance/new_order/policy/m&a) + earnings calendar|A/B class: A timed (has date) / B untimed (window midpoint)|T = 25·exp(−((days−14)²)/(2·21²)), days<0→0; peak at 14d|P probability 0-3 · M magnitude 0-3 · N narrative 0-2; each ticker takes its strongest catalyst",
            "收集：种子表 catalyst_type（earnings/guidance/new_order/policy/m&a）+ 财报日历自动加 earnings|A/B 分类：A 定时(有日历) / B 不定时(窗口中点)|T=25×exp(−((天数−14)²)/(2×21²))，天数<0→0；峰在 14 天|P 概率0-3 · M 幅度0-3 · N 叙事0-2；每票取最强催化剂当主分",
          ).split("|")}
        />
        <Ref>
          <Row k={t("A (timed)", "A 类(定时)")} v={t("earnings, dated policy, lockup expiry → days = calendar date − today", "earnings、有裁定日 policy、锁定期到期 → 天数=日历日−今天")} />
          <Row k={t("B (untimed)", "B 类(不定时)")} v={t("new_order, m&a, ad-hoc guidance, supply-chain read → days = expected window midpoint", "new_order、m&a、非定期 guidance、供应链读通 → 天数=预计窗口中点")} />
          <Row k={t("Primary rule", "主分规则")} v={t("with multiple catalysts, the highest TPMN is the ticker's score; others are notes", "多个催化剂取 TPMN 最高那一个当票的催化剂分，其余记为次要备注")} />
        </Ref>
      </div>
    </div>
  );
}

export function ConvictionView() {
  const t = useT();
  return (
    <div className="view-in">
      <ViewHead
        eyebrow={t("Stage 4 · Conviction", "Stage 4 · Conviction")}
        title={t("Management Conviction · Four Tones", "管理层 Conviction · 四层语气")}
        desc={t(
          "Score management tone from calls/filings, out of 10 (L1+L2+L3+L4), each layer with source-text evidence + confidence, noting whether it's the ticker's own or an upstream anchor's call.",
          "从电话会/公告的管理层语气打分，满分 10（L1+L2+L3+L4），每层附原文证据 + 置信度，注明用自身还是上游锚的电话会。",
        )}
      />
      <div className="grid gap-4">
        <Pending
          title={t("Pending: call transcripts + LLM tone analysis", "待接入：电话会文本 + LLM 语气分析")}
          needs={t(
            "Text source: the ticker's own or an upstream anchor's call/filing|LLM scores the four layers + extracts evidence + confidence|Anchor note: own vs upstream-anchor call",
            "文本源：自身或上游锚公司的电话会/公告（Schwab 字幕、SA 正文等）|LLM 按四层打分 + 抽原文证据 + 置信度|锚标注：用的是自身还是上游锚的电话会",
          ).split("|")}
        />
        <Ref>
          <Row k="L1" v={t("Tone baseline 0-2: downgrade 0 / flat 1 / clear upgrade 2", "语气基线 0-2：降级0 / 持平1 / 明显升级2")} />
          <Row k="L2" v={t("Evasion 0-3: dodges 0 / vague 1 / occasional 2 / straight numbers 3", "回避闪躲 0-3：反复回避0 / 避重就轻1 / 偶有闪躲2 / 直球给数3")} />
          <Row k="L3" v={t("Hard vs soft 0-3: all soft 0 / mostly soft 1 / mixed 2 / hard commitments 3", "硬话软话 0-3：全软0 / 软多硬少1 / 软硬掺半2 / 大量硬承诺3")} />
          <Row k="L4" v={t("Walk the talk 0-2: talks up but sells 0 / no signal 1 / bullish & buying 2", "言行一致 0-2：嘴热手减持0 / 无信号1 / 看多且增持回购2")} />
        </Ref>
      </div>
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
