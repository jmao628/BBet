import { useEffect, useState, type ReactNode } from "react";
import { useStore } from "../store";

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
  const lang = useStore((s) => s.lang);

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
        title={lang === "zh" ? "评分方法与规则" : "Methodology & rules"}
        className="grid h-7 w-7 place-items-center rounded-full border border-line text-[13px] font-semibold text-muted transition-colors hover:border-signal hover:text-signal"
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
                <h3 className="mt-0.5 text-[17px] font-semibold">
                  {lang === "zh" ? "评分方法与规则" : "Methodology & Rules"}
                </h3>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg border border-line px-3 py-1 text-[13px] text-muted hover:text-text"
              >
                {lang === "zh" ? "关闭 ✕" : "Close ✕"}
              </button>
            </div>

            {lang === "en" ? <EnSections /> : <ZhSections />}
          </div>
        </div>
      )}
    </>
  );
}

function EnSections() {
  return (
    <div className="space-y-5 p-6">
      <Section title="① Funnel Overview">
        <p>
          Bullish seed table (SA) → multi-lens ranking (this page) → screen → catalyst → conviction →
          technical → finalists. Goal: catch mid/small caps getting noticed <b>before</b> the market
          fully discovers them.
        </p>
      </Section>

      <Section title="② Data Source & Cadence">
        <Row k="Price/Tech" v="yfinance (Yahoo) daily OHLCV, via proxy." />
        <Row k="Social" v="Ape Wisdom daily mention snapshot, accrued into a series." />
        <Row k="Market cap" v="yfinance fast_info." />
        <Row
          k="Refresh"
          v={
            <>
              <b>Daily, not live</b>. Price is the latest close vs prior close; each{" "}
              <code className="mx-1 rounded bg-black/30 px-1 font-mono text-signal">technical</code>/
              <code className="mx-1 rounded bg-black/30 px-1 font-mono text-signal">heat</code> run
              refreshes it. No intraday ticks.
            </>
          }
        />
      </Section>

      <Section title="③ Seed Gate (to enter this page)">
        <p>
          Must have a SeekingAlpha <b>rating</b> (Quant score or BUY/STRONG BUY). Analyst-mention-only,
          no-rating names (e.g. IREN) don't enter the ranking.
        </p>
      </Section>

      <Section title="④ Price-Volume Attention Score (0–100)">
        <p>Four weighted parts, measuring how strongly money is paying attention:</p>
        <Row k="RVOL 40%" v="5-day / 20-day avg volume; ≥1.5 = full marks (a surge can't hide)." />
        <Row k="Breakout 25%" v="new 20-day high = full; else linear by distance to the high (within 10%)." />
        <Row k="OBV 20%" v="20-day OBV slope > 0 (accumulation) = full." />
        <Row k="Trend 15%" v="above SMA50 & SMA50 rising = full; only above = half." />
        <p className="text-muted2">
          e.g. PENG RVOL 1.82→0.22, 20d high→0.25, OBV↑→0.20, trend→0.15, total 0.82 → <b>82</b>.
        </p>
      </Section>

      <Section title="⑤ Attention Phase">
        <Row k="breakout" v="new 52-week high and RVOL ≥ 2." />
        <Row k="igniting" v="RVOL ≥ 1.5 and (20d high or within 5% of it) and OBV rising." />
        <Row k="accumulating" v="OBV rising and above SMA50." />
        <Row k="quiet" v="none of the above." />
      </Section>

      <Section title="⑥ The Four Ranking Lenses">
        <Row k="Attention" v="the 0–100 composite above — the primary signal." />
        <Row k="Rel. Volume" v="pure relative volume; money flow only, no direction." />
        <Row k="Momentum 60d" v="return over the last 60 trading days." />
        <Row k="Social Heat" v="Ape Wisdom z-score — mentions vs their own baseline." />
      </Section>

      <Section title="⑦ Advance Rules (to the next round)">
        <p>
          Each lens takes its <b>top 10</b>, and a name lights up PASS only if it <b>clears the bar</b> —
          attention ≥50, RVOL ≥1.5×, momentum ≥+10%, social z ≥0.5. Top-10 below the bar stay dim and
          don't advance; on a weak day nothing lights up. The attention score is coarse (ties at 60), so
          <b> ties break by RVOL then momentum</b>. Advancing = <b>union</b> of three paths: ① any lens's
          top-10 that clears the bar; ② <b>technical gauge = Strong Buy</b> (tagged STRONG, any rank);
          ③ market cap <b>≥ $100B</b> mega-cap bypass (shown in its own card).
        </p>
      </Section>

      <Section title="⑧ Sector Classification">
        <p>
          Sectors come from yfinance (cached, rarely change). The heat page filters advancing names by
          sector and shows the <b>top sector</b> — so you can see why a batch skews to one sector.
        </p>
      </Section>

      <Section title="⑨ Social Heat z (reference)">
        <p>
          x = ln(1+mentions); z = (x − μ) / σ, μ = 60-day median, σ = 1.4826·MAD (floor 0.35). Ignite 0.5,
          detonate 2.0. Mid/small-cap social is sparse, so it's not a hard gate — just one ranking lens.
        </p>
      </Section>

      <Section title="⑩ Technical Gauge / Strong Buy">
        <p>
          Strong buy/sell is a <b>mechanical vote</b> of MAs + oscillators (RSI/Stoch/CCI/W%R/MACD/ROC):
          (MA buy + osc buy) − (MA sell + osc sell) ÷ total, &gt;0.5 = strong buy. It <b>lags</b> — in a
          downtrend it often reads Sell even on a big up day. <b>Strong Buy</b> is now an extra advance
          path in ⑦ (tagged STRONG); the other buckets are reference only.
        </p>
      </Section>
    </div>
  );
}

function ZhSections() {
  return (
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
                  每个维度取<b>前 10 名</b>,且必须<b>达标</b>才点亮入选——达标线:量价注意力 ≥50 分、
                  RVOL ≥1.5×、动量 ≥+10%、社交 z ≥0.5。前 10 但没达标的票<b>灰显、不晋级</b>;
                  弱势那天没票达标就全灰,不硬凑。量价注意力分较粗(常并列 60),<b>同分按
                  RVOL、动量再排</b>,谁进前 10 才有意义。晋级下一轮 = 三条通道的<b>并集</b>:
                  ①任一维度达标前 10;②<b>技术表针 = 强力买入(强买)</b>——不看排第几,标 强买;
                  ③市值 <b>≥ $1000 亿</b>的大票直通(单列在「大票直通」卡)。
                </p>
              </Section>

              <Section title="⑧ 板块分类">
                <p>
                  行业板块来自 yfinance(缓存,基本不变)。热度页顶部可按板块筛选入选票,并显示
                  <b>主导板块</b>——用来看清"为什么这批入选都集中在某个板块"。
                </p>
              </Section>

              <Section title="⑨ 社交热度 z(参考口径)">
                <p>
                  x = ln(1+提及量);z = (x − μ) / σ,μ = 过去 60 天中位数,σ = 1.4826·MAD(下限 0.35)。
                  点火线 0.5、引爆线 2.0。中小盘社交本就稀疏,故不作硬门槛,只作一个排名维度。
                </p>
              </Section>

              <Section title="⑩ 技术表针 / 强力买入">
                <p>
                  强买/强卖是均线 + 震荡指标(RSI/Stoch/CCI/W%R/MACD/ROC)的<b>机械投票</b>:
                  (均线买+震荡买) − (均线卖+震荡卖) ÷ 总数,&gt;0.5 = 强买。它<b>滞后</b>——
                  趋势下行时当天大涨也常显示卖出。其中<b>强力买入</b>现在作为⑦里的一条额外晋级通道
                  (标 强买);其余档位(买入/中性/卖出)仅供参考,不参与筛选。
                </p>
              </Section>
    </div>
  );
}
