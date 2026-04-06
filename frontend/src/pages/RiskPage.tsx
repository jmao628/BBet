import { api } from "../lib/api";
import { usePolling } from "../hooks/usePolling";
import MetricCard from "../components/shared/MetricCard";
import Panel from "../components/shared/Panel";
import { usd, pctRaw } from "../lib/format";

export default function RiskPage() {
  const { data, isLoading } = usePolling(
    ["risk-exposure"],
    api.risk.exposure,
    30_000,
  );

  if (isLoading || !data) {
    return (
      <div className="p-4">
        <div className="animate-pulse h-96 bg-zinc-900 rounded" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-sm font-medium text-zinc-300">Risk Monitor</h2>

      {/* Top-level risk KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MetricCard label="Bankroll" value={usd(data.bankroll_usd)} />
        <MetricCard
          label="Daily Risk Used"
          value={usd(data.daily_risk_used_usd)}
          sub={`of ${usd(data.daily_risk_limit_usd)} limit`}
          color={data.daily_utilization_pct > 80 ? "text-red-400" : data.daily_utilization_pct > 50 ? "text-yellow-400" : "text-green-400"}
        />
        <MetricCard
          label="Daily Utilization"
          value={pctRaw(data.daily_utilization_pct)}
          color={data.daily_utilization_pct > 80 ? "text-red-400" : "text-zinc-100"}
        />
        <MetricCard label="Open Positions" value={String(data.open_positions)} />
      </div>

      {/* Daily utilization bar */}
      <Panel title="Daily Risk Utilization">
        <div className="mb-2 flex justify-between text-xs text-zinc-500">
          <span>{usd(data.daily_risk_used_usd)} used</span>
          <span>{usd(data.daily_risk_limit_usd)} limit</span>
        </div>
        <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              data.daily_utilization_pct > 80
                ? "bg-red-500"
                : data.daily_utilization_pct > 50
                  ? "bg-yellow-500"
                  : "bg-green-500"
            }`}
            style={{ width: `${Math.min(100, data.daily_utilization_pct)}%` }}
          />
        </div>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* By Game */}
        <Panel title="Exposure by Game">
          {data.by_game.length === 0 ? (
            <Empty />
          ) : (
            <ExposureTable entries={data.by_game} />
          )}
        </Panel>

        {/* By Team */}
        <Panel title="Exposure by Team">
          {data.by_team.length === 0 ? (
            <Empty />
          ) : (
            <ExposureTable entries={data.by_team} />
          )}
        </Panel>

        {/* By Series */}
        <Panel title="Exposure by Series">
          {data.by_series.length === 0 ? (
            <Empty />
          ) : (
            <ExposureTable entries={data.by_series} />
          )}
        </Panel>
      </div>

      {/* Risk rule hit log */}
      {data.risk_rule_hits.length > 0 && (
        <Panel title="Risk Rule Hits">
          <div className="space-y-1">
            {data.risk_rule_hits.map((hit, i) => (
              <div key={i} className="text-xs text-yellow-400">
                {JSON.stringify(hit)}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

function Empty() {
  return <div className="text-xs text-zinc-600 text-center py-4">No open exposure</div>;
}

interface ExposureTableProps {
  entries: { label: string; exposure_usd: number; limit_usd: number; utilization_pct: number }[];
}

function ExposureTable({ entries }: ExposureTableProps) {
  return (
    <div className="space-y-2">
      {entries.map((e) => (
        <div key={e.label}>
          <div className="flex justify-between text-xs mb-0.5">
            <span className="text-zinc-300">{e.label}</span>
            <span className="text-zinc-500 tabular-nums">
              {usd(e.exposure_usd)} / {usd(e.limit_usd)}
            </span>
          </div>
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${
                e.utilization_pct > 80
                  ? "bg-red-500"
                  : e.utilization_pct > 50
                    ? "bg-yellow-500"
                    : "bg-blue-500"
              }`}
              style={{ width: `${Math.min(100, e.utilization_pct)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
