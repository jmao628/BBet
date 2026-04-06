import type { DashboardSummary } from "../../types/api";
import MetricCard from "../shared/MetricCard";
import StatusDot from "../shared/StatusDot";
import { pct, usd } from "../../lib/format";

export default function SummaryBar({ data }: { data: DashboardSummary }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
      <MetricCard
        label="Games Today"
        value={String(data.total_games_today)}
        sub={`${data.games_with_markets} with markets`}
      />
      <MetricCard
        label="Signals"
        value={String(data.active_signals)}
        sub={`${data.actionable_signals} actionable`}
        color="text-blue-400"
      />
      <MetricCard
        label="Best Edge"
        value={data.best_edge != null ? pct(data.best_edge) : "—"}
        sub={data.best_edge_game ?? undefined}
        color="text-green-400"
      />
      <MetricCard
        label="Avg Edge"
        value={data.avg_edge != null ? pct(data.avg_edge) : "—"}
      />
      <MetricCard
        label="Exposure"
        value={usd(data.total_exposure_usd)}
        sub={`${pct(data.daily_risk_pct / 100)} daily risk`}
      />
      <MetricCard
        label="Skipped"
        value={String(data.skipped_signals)}
        color="text-zinc-500"
      />
      <div className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">System</div>
        <div className="flex items-center gap-1.5">
          <StatusDot status={data.system_healthy ? "ok" : "error"} />
          <span className="text-sm">
            {data.data_sources_ok}/{data.data_sources_total} sources
          </span>
        </div>
      </div>
    </div>
  );
}
