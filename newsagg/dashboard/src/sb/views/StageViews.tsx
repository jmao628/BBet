import type { ReactNode } from "react";
import { ViewHead, Card, Pending } from "../ui";

// The computed pipeline stages. Structure + the framework's method as a
// reference; each fills with real numbers once its computation is wired.

function Ref({ children }: { children: ReactNode }) {
  return (
    <Card title="方法 · Method">
      <div className="space-y-2 text-[12.5px] leading-relaxed text-muted">{children}</div>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-28 flex-none font-mono text-[11px] uppercase tracking-wide text-muted2">
        {k}
      </span>
      <span>{v}</span>
    </div>
  );
}

export function HeatView() {
  return (
    <div>
      <ViewHead
        eyebrow="Stage 2 · 热度信号"
        title="热度信号 · z / 涨速 / 相位"
        desc="把每只票的每日提及序列变成 z 分数、涨速、相位，并出一张两联图（提及柱+区间带 / z 曲线+点火线+相位色带）。"
      />
      <div className="grid gap-4">
        <Pending
          title="待接入：X 每日提及序列 + 计算"
          needs={[
            "Ape Wisdom 每票每日提及量序列 m（采集器已写，接入 mentions_*.json）",
            "z 计算：x=ln(1+m)；μ=过去60天中位数(滞后1)，σ=1.4826×MAD，σ≥0.35；z=(x−μ)/σ",
            "涨速 vel=最近3天 z 线性斜率；加速度 accel=vel 日变化",
            "两联热度图（提及柱+区间带 / z 曲线+点火0.5/引爆2.0线）",
          ]}
        />
        <Ref>
          <Row k="相位 phase" v="死水 z<0.5 / 点火 z∈[0.5,2.0)&vel≥0.15&accel≥0 / 引爆 z≥2.0 / 超低覆盖 中位提及<5" />
          <Row k="参数默认" v="窗口60 · 滞后1 · σ下限0.35 · z_low 0.5 · z_high 2.0 · 涨速门槛0.15 · 涨速窗3 · 超低阈5" />
          <Row k="产出" v="每票 {z, vel, accel, phase} + 两联图" />
        </Ref>
      </div>
    </div>
  );
}

export function ScreenView() {
  return (
    <div>
      <ViewHead
        eyebrow="Stage 3 · 发现筛选"
        title="发现筛选 · 即将被发现的中小盘"
        desc="从种子表 + 热度里，筛出一小批「即将被发现」的中小盘 bull 候选。这是发现机器的核心。"
      />
      <div className="grid gap-4">
        <Pending
          title="待接入：相位 + 市值 + 作者质量"
          needs={[
            "热度入口 A：取相位=点火的票（z∈[0.5,2.0)、vel≥0.15、accel≥0）",
            "作者质量二段：命中后校验白名单作者权重 > 0",
            "市值：数据商 / yfinance，过滤中小盘（市值上限阈值）",
            "产出：发现候选短名单",
          ]}
        />
        <Ref>
          <Row k="入口 A" v="热度点火 → 作者质量二段" />
          <Row k="核心目标" v="被市场共识重新定价之前，先挖出中小盘 bull 候选" />
        </Ref>
      </div>
    </div>
  );
}

export function CatalystView() {
  return (
    <div>
      <ViewHead
        eyebrow="Stage 4 · 催化剂"
        title="催化剂评分 · T × P × M × N"
        desc="抽出这只票身上所有候选催化剂（种子表 + 财报日历），每个各算 TPMN 分，取最强的当主分（不相加），其余列为次要催化剂。"
      />
      <div className="grid gap-4">
        <Pending
          title="待接入：催化剂清单 + TPMN 打分"
          needs={[
            "收集：种子表 catalyst_type（earnings/guidance/new_order/policy/m&a）+ 财报日历自动加 earnings",
            "A/B 分类：A 定时(有日历) / B 不定时(窗口中点)",
            "T=25×exp(−((天数−14)²)/(2×21²))，天数<0→0；峰在 14 天",
            "P 概率0-3 · M 幅度0-3 · N 叙事0-2；每票取最强催化剂当主分",
          ]}
        />
        <Ref>
          <Row k="A 类(定时)" v="earnings、有裁定日 policy、锁定期到期 → 天数=日历日−今天" />
          <Row k="B 类(不定时)" v="new_order、m&a、非定期 guidance、供应链读通 → 天数=预计窗口中点" />
          <Row k="主分规则" v="多个催化剂取 TPMN 最高那一个当票的催化剂分，其余记为次要备注" />
        </Ref>
      </div>
    </div>
  );
}

export function ConvictionView() {
  return (
    <div>
      <ViewHead
        eyebrow="Stage 5 · Conviction"
        title="管理层 Conviction · 四层语气"
        desc="从电话会/公告的管理层语气打分，满分 10（L1+L2+L3+L4），每层附原文证据 + 置信度，注明用自身还是上游锚的电话会。"
      />
      <div className="grid gap-4">
        <Pending
          title="待接入：电话会文本 + LLM 语气分析"
          needs={[
            "文本源：自身或上游锚公司的电话会/公告（Schwab 字幕、SA 正文等）",
            "LLM 按四层打分 + 抽原文证据 + 置信度",
            "锚标注：用的是自身还是上游锚的电话会",
          ]}
        />
        <Ref>
          <Row k="L1 语气基线" v="0-2：降级0 / 持平1 / 明显升级2" />
          <Row k="L2 回避闪躲" v="0-3：反复回避0 / 避重就轻1 / 偶有闪躲2 / 直球给数3" />
          <Row k="L3 硬话软话" v="0-3：全软0 / 软多硬少1 / 软硬掺半2 / 大量硬承诺3" />
          <Row k="L4 言行一致" v="0-2：嘴热手减持0 / 无信号1 / 看多且增持回购2" />
        </Ref>
      </div>
    </div>
  );
}

export function TechnicalView() {
  return (
    <div>
      <ViewHead
        eyebrow="Stage 6 · Boll 技术"
        title="Boll 技术 · 骑轨择时"
        desc="布林带择时：收盘骑在 +2σ~+3σ 之间、SMA20 斜率为正、带宽扩张，才算进场；过热(≥+3σ)不追，未确认(<+2σ)则等。"
      />
      <div className="grid gap-4">
        <Pending
          title="待接入：日线收盘价序列"
          needs={[
            "价格源：yfinance / 数据商日线收盘",
            "中轨 SMA20；σ=20期标准差；上轨=+2σ；最上轨=+3σ；带宽=(上−下)/中",
            "进场：收盘∈[+2σ,+3σ] & SMA20 斜率>0 & 带宽扩张",
            "产出：technical_ok + 所在轨位（几σ / 相对结构低点）",
          ]}
        />
        <Ref>
          <Row k="淘汰/等待" v="收盘≥+3σ 过热不追；收盘<+2σ 动量未确认，等" />
          <Row k="埋伏形态" v="站上 SMA20、未破结构低点、带宽收窄蓄势、无放量破位" />
        </Ref>
      </div>
    </div>
  );
}

export function CandidatesView() {
  const GATES = ["热度", "筛选", "催化剂", "Conviction", "技术"];
  return (
    <div>
      <ViewHead
        eyebrow="Output · 通关候选"
        title="通关候选 · 五闸全过"
        desc="按绝对且可复现的规则短路判定：任一闸不过即剔除/等待，五闸全过才成为做多候选，按综合分排序。"
      />
      <div className="grid gap-4">
        <Pending
          title="待接入：五道闸计算完成后自动生成"
          needs={[
            "依赖 Stage 2-6 全部接入（热度 / 筛选 / 催化剂 / Conviction / 技术）",
            "综合分 = 0.30×催化剂 + 0.28×Conviction×10 + 0.22×热度分 + 0.20×技术",
            "决策：任一闸 fail → 剔除/等待；五闸 pass → 做多候选",
          ]}
        />
        <Card title="五闸结构 · Gates" sub="short-circuit 顺序判定" pad0>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted2">
                <th className="px-4 py-2 text-left font-medium">标的</th>
                {GATES.map((g) => (
                  <th key={g} className="px-3 py-2 text-center font-medium">
                    {g}
                  </th>
                ))}
                <th className="px-4 py-2 text-right font-medium">综合分</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-line">
                <td className="px-4 py-6 text-center text-muted" colSpan={GATES.length + 2}>
                  五道闸计算接入后，通关候选将出现在这里。
                </td>
              </tr>
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
