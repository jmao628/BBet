import { useMemo, useState } from "react";
import { useStore } from "../../store";
import { companyMap, buildUniverse, capSizeOf, passesHeatGate, type CapSize } from "../pipeline";
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

function PhaseChip({ phase }: { phase: string }) {
  const m = PHASE[phase] ?? PHASE.dead;
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{ color: m.color, borderColor: `${m.color}66`, background: `${m.color}18` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />
      {m.cn}
    </span>
  );
}

const CAP_CN: Record<CapSize, string> = {
  large: "大盘",
  mid: "中盘",
  small: "小盘",
  unknown: "—",
};

// Heat gate: big caps pass straight through; mid/small caps must ignite.
function GateChip({ cap, phase }: { cap: CapSize; phase: string }) {
  if (cap === "large")
    return (
      <span className="rounded-full border border-signal/40 bg-signal/10 px-2 py-0.5 text-[11px] font-medium text-signal">
        大票直通
      </span>
    );
  const ok = passesHeatGate(cap, phase);
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        ok ? "border-ok/40 bg-ok/10 text-ok" : "border-line bg-inset text-muted2"
      }`}
    >
      {ok ? "点火通过" : "待点火"}
    </span>
  );
}

export function HeatView() {
  const heat = useStore((s) => s.heat);
  const data = useStore((s) => s.data);
  const focus = useStore((s) => s.ticker);
  const setTicker = useStore((s) => s.setTicker);
  const cmap = useMemo(() => companyMap(data), [data]);
  const [mineOnly, setMineOnly] = useState(true);

  const capBy = useMemo(() => {
    const m = new Map<string, CapSize>();
    for (const u of buildUniverse(data)) m.set(u.ticker, capSizeOf(u.caps));
    return m;
  }, [data]);
  const universe = useMemo(() => new Set(capBy.keys()), [capBy]);

  const allRows = useMemo(() => {
    const t = heat?.tickers ?? {};
    return Object.entries(t)
      .map(([ticker, h]) => ({ ticker, ...h }))
      .sort((a, b) => (b.z ?? -99) - (a.z ?? -99));
  }, [heat]);

  const mineCount = useMemo(
    () => allRows.filter((r) => universe.has(r.ticker)).length,
    [allRows, universe],
  );
  const rows = mineOnly ? allRows.filter((r) => universe.has(r.ticker)) : allRows;

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.phase] = (c[r.phase] ?? 0) + 1;
    return c;
  }, [rows]);

  const focused = rows.find((r) => r.ticker === focus) ?? rows[0];

  if (!heat || allRows.length === 0) {
    return (
      <div>
        <ViewHead
          eyebrow="Stage 2 · 热度信号"
          title="热度信号 · z / 涨速 / 相位"
          desc="每票的每日提及序列 → z 分数 / 涨速 / 相位。Ape Wisdom 只给当日快照，需每天积累成序列后计算。"
        />
        <Card>
          <div className="p-6 text-center text-[13px] text-muted">
            还没有热度数据。运行{" "}
            <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-signal">
              python -m newsagg.heat
            </code>{" "}
            开始每日积累提及量；攒够约 1–2 周 z 才有意义。
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <ViewHead
        eyebrow="Stage 2 · 热度信号"
        title="热度信号 · z / 涨速 / 相位"
        desc="大票已被充分覆盖 → 直接跳过热度闸进入筛选；只有中小盘需要社交热度点火。x=ln(1+m)；z=(x−μ)/σ（μ=过去60天中位数，σ=1.4826·MAD≥0.35）；涨速=近3天z斜率。点火 0.5 / 引爆 2.0。"
      />

      <StatStrip
        stats={[
          { k: "引爆 detonate", v: counts.detonate ?? 0, color: "#ff5a78" },
          { k: "点火 ignite", v: counts.ignite ?? 0, color: "#f2a73c" },
          { k: "观察 watch", v: counts.watch ?? 0, color: "#e9c46a" },
          { k: "积累中 warming", v: counts.warming ?? 0, color: "#3dd6c4" },
        ]}
      />

      {focused && (
        <Card
          title={`${focused.ticker} · 热度双联图`}
          sub={`${cmap.get(focused.ticker) ?? ""} · ${focused.days} 天历史`}
        >
          <HeatChart t={focused} />
        </Card>
      )}

      <div className="mt-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-line">
            <button
              onClick={() => setMineOnly(true)}
              className={`px-3 py-1.5 text-[12px] ${mineOnly ? "bg-signal/15 text-signal" : "text-muted hover:text-text"}`}
            >
              我的票 {mineCount}
            </button>
            <button
              onClick={() => setMineOnly(false)}
              className={`px-3 py-1.5 text-[12px] ${!mineOnly ? "bg-signal/15 text-signal" : "text-muted hover:text-text"}`}
            >
              全部社交热榜 {allRows.length}
            </button>
          </div>
          <span className="text-[11px] text-muted2">
            {mineOnly
              ? "只看种子表里的票（其余票社交无讨论，属超低覆盖）"
              : "Ape Wisdom 全部社交热榜"}
          </span>
        </div>
        <Card title="热度榜 · 按 z 排序" sub={`${rows.length} 只 · 点击看图`} pad0>
          {rows.length === 0 && (
            <div className="p-6 text-center text-[13px] text-muted">
              种子表里的票暂无社交提及（都还没进 Ape Wisdom 热榜）。切到「全部社交热榜」看大盘热度。
            </div>
          )}
          <div className="max-h-[420px] overflow-y-auto">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-panel">
                <tr className="text-[11px] uppercase tracking-wide text-muted2">
                  <th className="px-3 py-2 text-left font-medium">标的</th>
                  <th className="px-3 py-2 text-left font-medium">市值</th>
                  <th className="px-3 py-2 text-right font-medium">提及</th>
                  <th className="px-3 py-2 text-right font-medium">z</th>
                  <th className="px-3 py-2 text-right font-medium">涨速</th>
                  <th className="px-3 py-2 text-left font-medium">相位</th>
                  <th className="px-3 py-2 text-left font-medium">热度闸</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 80).map((r) => {
                  const cap = capBy.get(r.ticker) ?? "unknown";
                  return (
                    <tr
                      key={r.ticker}
                      onClick={() => setTicker(r.ticker)}
                      className={`cursor-pointer border-t border-line hover:bg-white/[0.03] ${
                        focused?.ticker === r.ticker ? "bg-signal/10" : ""
                      }`}
                    >
                      <td className="px-3 py-2">
                        <span className="font-mono font-semibold text-signal">{r.ticker}</span>
                        <span className="ml-2 text-[11px] text-muted">{cmap.get(r.ticker) ?? ""}</span>
                      </td>
                      <td className="px-3 py-2 text-[11px] text-muted2">{CAP_CN[cap]}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{r.mentions}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {r.z != null ? r.z.toFixed(2) : <span className="text-muted2">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
                        {r.vel != null ? r.vel.toFixed(2) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <PhaseChip phase={r.phase} />
                      </td>
                      <td className="px-3 py-2">
                        <GateChip cap={cap} phase={r.phase} />
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
