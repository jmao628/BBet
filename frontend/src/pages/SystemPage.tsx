import { api } from "../lib/api";
import { usePolling } from "../hooks/usePolling";
import MetricCard from "../components/shared/MetricCard";
import Panel from "../components/shared/Panel";
import StatusDot from "../components/shared/StatusDot";
import Badge from "../components/shared/Badge";
import { severityColor, statusColor, timeAgo, num } from "../lib/format";

export default function SystemPage() {
  const { data: health, isLoading: hLoading } = usePolling(
    ["health"],
    api.monitoring.health,
    60_000,
  );
  const { data: alerts, isLoading: aLoading } = usePolling(
    ["alerts"],
    api.monitoring.alerts,
    30_000,
  );

  if (hLoading) {
    return (
      <div className="p-4">
        <div className="animate-pulse h-96 bg-zinc-900 rounded" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-sm font-medium text-zinc-300">System Monitoring</h2>

      {/* Overall status */}
      {health && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <MetricCard
              label="Overall Status"
              value={health.overall_status.toUpperCase()}
              color={statusColor(health.overall_status)}
            />
            <MetricCard
              label="Database"
              value={health.db_connected ? "Connected" : "DOWN"}
              color={health.db_connected ? "text-green-400" : "text-red-400"}
            />
            <MetricCard
              label="Redis"
              value={health.redis_connected ? "Connected" : "DOWN"}
              color={health.redis_connected ? "text-green-400" : "text-red-400"}
            />
            <MetricCard label="Model Version" value={health.model_version} />
            <MetricCard
              label="Uptime"
              value={health.uptime_seconds != null ? formatUptime(health.uptime_seconds) : "—"}
            />
          </div>

          {/* Data source freshness */}
          <Panel title="Data Sources">
            <div className="space-y-2">
              {health.data_sources.map((src) => (
                <div key={src.source} className="flex items-center justify-between p-2 bg-zinc-800/40 rounded">
                  <div className="flex items-center gap-2">
                    <StatusDot status={src.status} />
                    <span className="text-xs text-zinc-300">{src.source}</span>
                    <Badge
                      text={src.status.toUpperCase()}
                      color={
                        src.status === "ok"
                          ? "text-green-400 bg-green-400/10"
                          : src.status === "stale"
                            ? "text-yellow-400 bg-yellow-400/10"
                            : "text-red-400 bg-red-400/10"
                      }
                    />
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <div className="text-zinc-500">
                      Last sync: {src.last_sync ? timeAgo(src.last_sync) : "never"}
                    </div>
                    {src.staleness_minutes != null && (
                      <div className={`tabular-nums ${src.staleness_minutes > src.threshold_minutes ? "text-yellow-400" : "text-zinc-500"}`}>
                        {num(src.staleness_minutes, 0)}m / {src.threshold_minutes}m threshold
                      </div>
                    )}
                    {src.records_last_sync != null && (
                      <div className="text-zinc-600">{src.records_last_sync.toLocaleString()} records</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}

      {/* Alerts */}
      <Panel
        title="Recent Alerts"
        headerRight={
          alerts ? (
            <span className="text-[10px] text-zinc-500">
              {alerts.unacknowledged} unacknowledged
            </span>
          ) : null
        }
      >
        {aLoading ? (
          <div className="animate-pulse h-24 bg-zinc-800 rounded" />
        ) : !alerts || alerts.alerts.length === 0 ? (
          <div className="text-xs text-zinc-600 text-center py-6">
            No recent alerts
          </div>
        ) : (
          <div className="space-y-1.5">
            {alerts.alerts.map((a) => (
              <div key={a.alert_id} className="flex items-start gap-2 text-xs p-2 bg-zinc-800/30 rounded">
                <Badge text={a.severity} color={severityColor(a.severity)} />
                <div className="flex-1">
                  <span className="text-zinc-300">{a.message}</span>
                  <div className="text-zinc-600 mt-0.5">{timeAgo(a.created_at)}</div>
                </div>
                {!a.acknowledged && (
                  <span className="text-yellow-500 text-[10px]">NEW</span>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}
