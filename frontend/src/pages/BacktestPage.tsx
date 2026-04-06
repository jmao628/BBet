import { useState } from "react";
import { api } from "../lib/api";
import { usePolling } from "../hooks/usePolling";
import MetricCard from "../components/shared/MetricCard";
import Panel from "../components/shared/Panel";
import { pctRaw, usd, num } from "../lib/format";

export default function BacktestPage() {
  const { data: runs, isLoading } = usePolling(
    ["backtest-summary"],
    api.backtest.summary,
    300_000, // 5min — historical data
  );
  const [selectedRun, setSelectedRun] = useState<string | null>(null);

  const active = selectedRun
    ? runs?.find((r) => r.run_id === selectedRun)
    : runs?.[0];

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-300">Backtest Analysis</h2>
        {runs && runs.length > 0 && (
          <select
            value={selectedRun ?? runs[0]?.run_id ?? ""}
            onChange={(e) => setSelectedRun(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300"
          >
            {runs.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                {r.run_name} ({r.start_date} → {r.end_date})
              </option>
            ))}
          </select>
        )}
      </div>

      {isLoading ? (
        <div className="animate-pulse h-96 bg-zinc-900 rounded" />
      ) : !active ? (
        <Panel title="No Backtest Runs">
          <div className="text-xs text-zinc-600 text-center py-8">
            No backtest runs found. Run a backtest to see results here.
          </div>
        </Panel>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            <MetricCard
              label="ROI"
              value={pctRaw(active.roi_pct)}
              color={active.roi_pct >= 0 ? "text-green-400" : "text-red-400"}
            />
            <MetricCard label="Total P&L" value={usd(active.total_pnl_usd)} color={active.total_pnl_usd >= 0 ? "text-green-400" : "text-red-400"} />
            <MetricCard label="Hit Rate" value={pctRaw(active.hit_rate * 100)} />
            <MetricCard label="Sharpe" value={num(active.sharpe_ratio)} />
            <MetricCard label="Max DD" value={pctRaw(active.max_drawdown_pct)} color="text-red-400" />
            <MetricCard label="Signals" value={String(active.total_signals)} sub={`${active.signals_executed} exec`} />
            <MetricCard label="Avg Hold" value={`${num(active.avg_hold_hours, 1)}h`} />
            <MetricCard label="Model" value={active.model_version} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Equity Curve placeholder */}
            <Panel title="Equity Curve">
              <div className="h-64 flex items-center justify-center text-xs text-zinc-600">
                <div className="text-center">
                  <div>Equity curve visualization</div>
                  <div className="mt-1 text-zinc-700">
                    Connect /backtest/{"{run_id}"}/equity endpoint for time-series data
                  </div>
                </div>
              </div>
            </Panel>

            {/* Drawdown placeholder */}
            <Panel title="Drawdown">
              <div className="h-64 flex items-center justify-center text-xs text-zinc-600">
                <div className="text-center">
                  <div>Drawdown chart</div>
                  <div className="mt-1 text-zinc-700">Max DD: {pctRaw(active.max_drawdown_pct)}</div>
                </div>
              </div>
            </Panel>
          </div>

          {/* Breakdown tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {active.by_confidence && (
              <Panel title="By Confidence Tier">
                <BreakdownTable data={active.by_confidence as Record<string, Record<string, number>>} />
              </Panel>
            )}
            {active.by_market_type && (
              <Panel title="By Market Type">
                <BreakdownTable data={active.by_market_type as Record<string, Record<string, number>>} />
              </Panel>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function BreakdownTable({ data }: { data: Record<string, Record<string, number>> }) {
  const keys = Object.keys(data);
  if (keys.length === 0) return <div className="text-xs text-zinc-600">No data</div>;

  const subKeys = Object.keys(data[keys[0]] ?? {});

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-zinc-500 border-b border-zinc-800">
          <th className="text-left py-1 font-normal">Bucket</th>
          {subKeys.map((k) => (
            <th key={k} className="text-right py-1 font-normal">{k}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => (
          <tr key={k} className="border-t border-zinc-800/50">
            <td className="py-1 text-zinc-300">{k}</td>
            {subKeys.map((sk) => (
              <td key={sk} className="text-right py-1 tabular-nums text-zinc-400">
                {num(data[k]?.[sk] ?? 0)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
