import { useMemo, useState } from "react";
import { useStore } from "../../store";
import {
  companyMap,
  buildUniverse,
  capSizeFromCap,
  bypassesHeat,
  passesHeatGate,
  type CapSize,
} from "../pipeline";
import { ViewHead, Card, StatStrip } from "../ui";
import type { HeatTicker } from "../../types";

const PHASE: Record<string, { cn: string; color: string }> = {
  detonate: { cn: "引爆", color: "#ff5a78" },
  ignite: { cn: "点火", color: "#f2a73c" },
  watch: { cn: "观察", color: "#e9c46a" },
  dead: { cn: "死水", color: "#5c7c99" },
  ultralow: { cn: "超低覆盖", color: "#5a6a7c" },
  warming: { cn: "积累中", color: "#3dd6c4" },
};

const ATTN: Record<string, { cn: string; color: string }> = {
  breakout: { cn: "突破", color: "#ff5a78" },
  igniting: { cn: "量价点火", color: "#3dd6c4" },
  accumulating: { cn: "吸筹中", color: "#5fb0e8" },
  quiet: { cn: "沉寂", color: "#5a6a7c" },
};

function Chip({ cn, color }: { cn: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{ color, borderColor: `${color}66`, background: `${color}18` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {cn}
    </span>
  );
}

const CAP_CN: Record<CapSize, string> = {
  large: "大盘",
  mid: "中盘",
  small: "小盘",
  unknown: "—",
};

// Heat gate: mega caps (≥$100B) bypass; else social ignite OR price-volume ignite.
function GateChip({
  marketCap,
  phase,
  attnIgnites,
}: {
  marketCap: number | undefined;
  phase: string;
  attnIgnites: boolean;
}) {
  if (bypassesHeat(marketCap))
    return (
      <span className="rounded-full border border-signal/40 bg-signal/10 px-2 py-0.5 text-[11px] font-medium text-signal">
        大票直通
      </span>
    );
  const social = phase === "ignite" || phase === "detonate";
  const ok = passesHeatGate(marketCap, phase, attnIgnites);
  const label = social ? "社交点火" : attnIgnites ? "量价点火" : "待点火";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        ok ? "border-ok/40 bg-ok/10 text-ok" : "border-line bg-inset text-muted2"
      }`}
    >
      {label}
    </span>
  );
}

interface Row {
  ticker: string;
  mentions: number | null;
  z: number | null;
  vel: number | null;
  phase: string | null;
  series: number[] | null;
  z_series: (number | null)[] | null;
  days: number;
  attnScore: number | null;
  attnPhase: string | null;
  rvol: number | null;
  attnIgnites: boolean;
}

export function HeatView() {
  const heat = useStore((s) => s.heat);
  const technical = useStore((s) => s.technical);
  const data = useStore((s) => s.data);
  const marketCaps = useStore((s) => s.marketCaps);
  const openDetail = useStore((s) => s.openDetail);
  const cmap = useMemo(() => companyMap(data), [data]);
  const [mineOnly, setMineOnly] = useState(true);

  const uni = useMemo(() => buildUniverse(data), [data]);
  const capBy = useMemo(() => {
    const m = new Map<string, CapSize>();
    for (const u of uni) m.set(u.ticker, capSizeFromCap(marketCaps?.[u.ticker], u.caps));
    return m;
  }, [uni, marketCaps]);
  const ratedSet = useMemo(() => new Set(uni.filter((u) => u.rated).map((u) => u.ticker)), [uni]);

  const allRows = useMemo<Row[]>(() => {
    const ht = heat?.tickers ?? {};
    const tt = technical?.tickers ?? {};
    // Mine = rated seed universe (social OR price-volume). Otherwise = raw social board.
    const tickers = mineOnly ? [...ratedSet] : Object.keys(ht);
    const rows = tickers.map((t) => {
      const h = ht[t];
      const a = tt[t]?.attention;
      return {
        ticker: t,
        mentions: h?.mentions ?? null,
        z: h?.z ?? null,
        vel: h?.vel ?? null,
        phase: h?.phase ?? null,
        series: h?.series ?? null,
        z_series: h?.z_series ?? null,
        days: h?.days ?? 0,
        attnScore: a?.score ?? null,
        attnPhase: a?.phase ?? null,
        rvol: a?.rvol ?? null,
        attnIgnites: a?.ignites ?? false,
      } as Row;
    });
    // In "mine", drop rows with no signal at all (no social, no technical yet).
    const filtered = mineOnly ? rows.filter((r) => r.phase != null || r.attnScore != null) : rows;
    filtered.sort((x, y) => (y.z ?? -99) - (x.z ?? -99) || (y.attnScore ?? -1) - (x.attnScore ?? -1));
    return filtered;
  }, [heat, technical, mineOnly, ratedSet]);

  const mineCount = useMemo(
    () => allRows.length, // already scoped by mineOnly
    [allRows],
  );
  const rows = allRows;

  const socialBoardCount = useMemo(() => Object.keys(heat?.tickers ?? {}).length, [heat]);

  const stats = useMemo(() => {
    let detonate = 0,
      ignite = 0,
      vol = 0,
      pass = 0;
    for (const r of rows) {
      if (r.phase === "detonate") detonate++;
      if (r.phase === "ignite") ignite++;
      if (r.attnIgnites) vol++;
      if (passesHeatGate(marketCaps?.[r.ticker], r.phase ?? "", r.attnIgnites)) pass++;
    }
    return { detonate, ignite, vol, pass };
  }, [rows, marketCaps]);

  const focused = useMemo(() => rows.find((r) => r.series && r.series.length >= 2), [rows]);

  const hasAny = (heat && Object.keys(heat.tickers).length) || (technical && Object.keys(technical.tickers).length);
  if (!hasAny) {
    return (
      <div>
        <ViewHead
          eyebrow="Stage 2 · 热度信号"
          title="热度信号 · 社交 z + 量价注意力"
          desc="社交提及 z / 涨速 / 相位（Ape Wisdom，需每天积累）+ 量价注意力（RVOL / 突破 / OBV，yfinance）。中小盘社交太稀疏时，量价先亮。"
        />
        <Card>
          <div className="p-6 text-center text-[13px] text-muted">
            还没有热度或量价数据。运行{" "}
            <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-signal">
              python -m newsagg.heat
            </code>{" "}
            与{" "}
            <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-signal">
              python -m newsagg.technical
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
        eyebrow="Stage 2 · 热度信号"
        title="热度信号 · 社交 z + 量价注意力"
        desc="大票已被充分覆盖 → 直接跳过热度闸；中小盘要么社交点火，要么量价点火。社交：z=(x−μ)/σ，点火 0.5 / 引爆 2.0。量价：RVOL≥1.5 放量 + 20日新高 + OBV 吸筹 → 点火。点击任一行看单票详情。"
      />

      <StatStrip
        stats={[
          { k: "引爆 detonate", v: stats.detonate, color: "#ff5a78" },
          { k: "社交点火 ignite", v: stats.ignite, color: "#f2a73c" },
          { k: "量价点火", v: stats.vol, color: "#3dd6c4" },
          { k: "过热度闸", v: stats.pass, color: "#48c78e" },
        ]}
      />

      {focused && focused.series && focused.z_series && (
        <Card
          title={`${focused.ticker} · 社交热度双联图`}
          sub={`${cmap.get(focused.ticker) ?? ""} · ${focused.days} 天历史 · 社交最强`}
        >
          <HeatChart
            t={{
              mentions: focused.mentions ?? 0,
              z: focused.z,
              vel: focused.vel,
              accel: null,
              phase: (focused.phase ?? "dead") as HeatTicker["phase"],
              days: focused.days,
              series: focused.series,
              z_series: focused.z_series,
            }}
          />
        </Card>
      )}

      <div className="mt-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-line">
            <button
              onClick={() => setMineOnly(true)}
              className={`px-3 py-1.5 text-[12px] ${mineOnly ? "bg-signal/15 text-signal" : "text-muted hover:text-text"}`}
            >
              我的票（有SA评分）{mineOnly ? mineCount : ""}
            </button>
            <button
              onClick={() => setMineOnly(false)}
              className={`px-3 py-1.5 text-[12px] ${!mineOnly ? "bg-signal/15 text-signal" : "text-muted hover:text-text"}`}
            >
              全部社交热榜 {socialBoardCount}
            </button>
          </div>
          <span className="text-[11px] text-muted2">
            {mineOnly
              ? "有 SA 评分的种子票：社交 z 与量价注意力并列，任一点火即过闸"
              : "Ape Wisdom 全部社交热榜（仅社交信号）"}
          </span>
        </div>
        <Card title="热度榜 · 社交 z / 量价" sub={`${rows.length} 只 · 点击看详情`} pad0>
          {rows.length === 0 && (
            <div className="p-6 text-center text-[13px] text-muted">
              暂无信号。社交需每天积累提及；量价需运行 <code className="font-mono">newsagg.technical</code>。
            </div>
          )}
          <div className="max-h-[440px] overflow-y-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead className="sticky top-0 bg-panel">
                <tr className="text-[11px] uppercase tracking-wide text-muted2">
                  <th className="px-3 py-2 text-left font-medium">标的</th>
                  <th className="px-3 py-2 text-left font-medium">市值</th>
                  <th className="px-3 py-2 text-right font-medium">提及</th>
                  <th className="px-3 py-2 text-right font-medium">z</th>
                  <th className="px-3 py-2 text-left font-medium">社交相位</th>
                  <th className="px-3 py-2 text-right font-medium">RVOL</th>
                  <th className="px-3 py-2 text-left font-medium">量价</th>
                  <th className="px-3 py-2 text-left font-medium">热度闸</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 80).map((r) => {
                  const cap = capBy.get(r.ticker) ?? "unknown";
                  const ap = r.attnPhase ? ATTN[r.attnPhase] ?? ATTN.quiet : null;
                  const sp = r.phase ? PHASE[r.phase] ?? PHASE.dead : null;
                  return (
                    <tr
                      key={r.ticker}
                      onClick={() => openDetail(r.ticker)}
                      className="cursor-pointer border-t border-line hover:bg-white/[0.03]"
                    >
                      <td className="px-3 py-2">
                        <span className="font-mono font-semibold text-signal">{r.ticker}</span>
                        <span className="ml-2 text-[11px] text-muted">{cmap.get(r.ticker) ?? ""}</span>
                      </td>
                      <td className="px-3 py-2 text-[11px] text-muted2">{CAP_CN[cap]}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {r.mentions ?? <span className="text-muted2">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {r.z != null ? r.z.toFixed(2) : <span className="text-muted2">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {sp ? <Chip cn={sp.cn} color={sp.color} /> : <span className="text-muted2">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {r.rvol != null ? `${r.rvol.toFixed(1)}×` : <span className="text-muted2">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {ap ? <Chip cn={ap.cn} color={ap.color} /> : <span className="text-muted2">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <GateChip marketCap={marketCaps?.[r.ticker]} phase={r.phase ?? ""} attnIgnites={r.attnIgnites} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

// Dual chart: mention bars (top) + z-score line with ignite/detonate lines and
// phase-colored bands (bottom).
function HeatChart({ t }: { t: HeatTicker }) {
  const W = 720;
  const H = 260;
  const PADL = 34;
  const PADR = 12;
  const topH = 92;
  const gap = 20;
  const botY = topH + gap;
  const botH = H - botY - 22;

  const n = t.series.length;
  if (n < 2) return <div className="p-4 text-[12px] text-muted">历史太短，无法出图。</div>;

  const xs = (i: number) => PADL + (i * (W - PADL - PADR)) / (n - 1);

  const maxM = Math.max(1, ...t.series);
  const yM = (v: number) => topH - (v / maxM) * (topH - 10);

  const zVals = t.z_series.filter((z): z is number => z != null);
  const zMax = Math.max(2.4, ...zVals);
  const zMin = Math.min(-0.6, ...zVals);
  const yZ = (v: number) => botY + (1 - (v - zMin) / (zMax - zMin)) * botH;

  const bands: [number, number, string][] = [
    [2.0, zMax, "rgba(255,90,120,.10)"],
    [0.5, 2.0, "rgba(242,167,60,.10)"],
    [zMin, 0.5, "rgba(92,124,153,.07)"],
  ];

  const zPath = t.z_series
    .map((z, i) => (z == null ? null : `${xs(i)},${yZ(z)}`))
    .filter(Boolean)
    .join(" L");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: "100%" }}>
      {/* mention bars */}
      {t.series.map((m, i) => (
        <rect
          key={i}
          x={xs(i) - (W - PADL - PADR) / n / 2.6}
          y={yM(m)}
          width={(W - PADL - PADR) / n / 1.3}
          height={topH - yM(m) + 2}
          rx="1"
          fill="rgba(61,214,196,.45)"
        />
      ))}
      <text x="2" y="12" fontSize="9" fill="#5a6a7c">
        提及 {maxM}
      </text>

      {/* z phase bands */}
      {bands.map(([a, b, c], i) => (
        <rect key={i} x={PADL} y={yZ(b)} width={W - PADL - PADR} height={yZ(a) - yZ(b)} fill={c} />
      ))}
      {/* ignite / detonate / zero lines */}
      {[
        [2.0, "#ff5a78", "引爆 2.0"],
        [0.5, "#f2a73c", "点火 0.5"],
        [0, "#293a4e", "0"],
      ].map(([v, col, lbl], i) => (
        <g key={i}>
          <line
            x1={PADL}
            y1={yZ(v as number)}
            x2={W - PADR}
            y2={yZ(v as number)}
            stroke={col as string}
            strokeWidth="1"
            strokeDasharray={v === 0 ? "1 0" : "4 3"}
          />
          <text x={W - PADR} y={yZ(v as number) - 3} fontSize="9" fill={col as string} textAnchor="end">
            {lbl}
          </text>
        </g>
      ))}
      {/* z line */}
      {zPath && <path d={`M${zPath}`} fill="none" stroke="#3dd6c4" strokeWidth="2" strokeLinejoin="round" />}
      <text x="2" y={botY + 10} fontSize="9" fill="#5a6a7c">
        z-score
      </text>
    </svg>
  );
}
