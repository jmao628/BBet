import { useEffect, useState, type ReactNode } from "react";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="mb-1.5 text-[13px] font-semibold text-signal">{title}</h4>
      <div className="space-y-1.5 text-[12.5px] leading-relaxed text-muted">{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="min-w-[92px] flex-none font-mono text-[11.5px] text-text">{k}</span>
      <span className="flex-1">{v}</span>
    </div>
  );
}

// Reusable "ⓘ 方法" button + modal describing the scoring rules. Drop into a
// ViewHead's `actions` slot on any funnel page.
export function MethodInfo() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="评分方法与规则"
        className="grid h-7 w-7 place-items-center rounded-full border border-line text-[13px] font-semibold text-muted hover:border-signal hover:text-signal"
      >
        ⓘ
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="my-6 h-fit w-full max-w-2xl rounded-2xl border border-line bg-panel shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal">
                  Methodology
                </div>
                <h3 className="mt-0.5 text-[17px] font-semibold">评分方法与规则</h3>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg border border-line px-3 py-1 text-[13px] text-muted hover:text-text"
              >
                关闭 ✕
              </button>
            </div>

            <div className="space-y-5 p-6">
              <Section title="① 漏斗总览">
                <p>
                  看多种子表(SA)→ 多维排名(本页)→ 发现筛选 → 催化剂 → 信念分级 →
                  技术形态 → 通关候选。目标:在中小盘被市场充分发现<b>之前</b>,捕捉正在被注意的票。
                </p>
              </Section>

              <Section title="② 数据来源与频率">
                <Row k="价量/技术" v="yfinance(雅虎)日线 OHLCV,经代理拉取。" />
                <Row k="社交热度" v="Ape Wisdom 每日提及量快照,累积成序列。" />
                <Row k="市值" v="yfinance fast_info。" />
                <Row
                  k="刷新"
                  v={
                    <>
                      <b>日频,非实时</b>。价格是最近一个收盘价 vs 前收;跑一次
                      <code className="mx-1 rounded bg-black/30 px-1 font-mono text-signal">technical</code>/
                      <code className="mx-1 rounded bg-black/30 px-1 font-mono text-signal">heat</code>
                      刷新一次,盘中不跳动。
                    </>
                  }
                />
              </Section>

              <Section title="③ 种子门槛(进入本页的前提)">
                <p>
                  必须在 SeekingAlpha 有<b>评分</b>(Quant 分数或 BUY/STRONG BUY)。只有分析师提及、
                  无评分的票(如 IREN)不进入排名。
                </p>
              </Section>

              <Section title="④ 量价注意力分(0–100)">
                <p>四项加权,衡量"资金正在注意"的强度:</p>
                <Row k="RVOL 40%" v="近 5 日均量 / 近 20 日均量;≥1.5 记满档(放量藏不住)。" />
                <Row k="突破 25%" v="创 20 日新高记满;否则按距 20 日高的远近线性给分(≤10%内)。" />
                <Row k="OBV 20%" v="近 20 日 OBV 斜率 > 0(有人吸筹)记满。" />
                <Row k="趋势 15%" v="站上 SMA50 且 SMA50 上行记满;仅站上记半档。" />
                <p className="text-muted2">
                  例:PENG RVOL 1.82→0.22,20日新高→0.25,OBV↑→0.20,趋势→0.15,合计
                  0.82 → <b>82 分</b>。
                </p>
              </Section>

              <Section title="⑤ 量价相位">
                <Row k="突破 breakout" v="创 52 周新高 且 RVOL≥2。" />
                <Row k="量价点火 igniting" v="RVOL≥1.5 且(20日新高或距高≤5%)且 OBV 上行。" />
                <Row k="吸筹中 accumulating" v="OBV 上行 且 站上 SMA50。" />
                <Row k="沉寂 quiet" v="以上都不满足。" />
              </Section>

              <Section title="⑥ 四个排名维度(本页)">
                <Row k="量价注意力" v="上面的 0–100 综合分,主力信号。" />
                <Row k="放量 RVOL" v="纯相对成交量,只看资金异动,不看方向。" />
                <Row k="动量 60 日" v="近 60 个交易日的涨幅。" />
                <Row k="社交热度" v="Ape Wisdom z 分数,提及量相对自身基线的异常度。" />
              </Section>

              <Section title="⑦ 入选规则(晋级下一轮)">
                <p>
                  每个维度<b>各取前 10 名</b>入选;某只票只要在<b>任一维度</b>进前 10 就晋级。
                  各维度前 10 的<b>并集</b>= "入选下一轮"。市值 <b>≥ $1000 亿</b>的大票已被充分覆盖,
                  <b>直通</b>晋级不占名额。
                </p>
              </Section>

              <Section title="⑧ 社交热度 z(参考口径)">
                <p>
                  x = ln(1+提及量);z = (x − μ) / σ,μ = 过去 60 天中位数,σ = 1.4826·MAD(下限 0.35)。
                  点火线 0.5、引爆线 2.0。中小盘社交本就稀疏,故不作硬门槛,只作一个排名维度。
                </p>
              </Section>

              <Section title="⑨ 技术表针(仅展示,不参与筛选)">
                <p>
                  详情页里的强买/强卖,是均线 + 震荡指标(RSI/Stoch/CCI/W%R/MACD/ROC)的<b>机械投票</b>,
                  <b>滞后</b>——趋势下行时当天大涨也常显示卖出。只用来看当前姿态,<b>不作为筛选依据</b>。
                </p>
              </Section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
