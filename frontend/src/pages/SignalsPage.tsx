import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { usePolling } from "../hooks/usePolling";
import MetricCard from "../components/shared/MetricCard";
import Badge from "../components/shared/Badge";
import {
  directionColor,
  edgeColor,
  gameTime,
  pct,
  tierColor,
  num,
} from "../lib/format";

type SortKey = "edge" | "confidence" | "signal_time";

export default function SignalsPage() {
  const [sortBy, setSortBy] = useState<SortKey>("edge");
  const [dirFilter, setDirFilter] = useState<string>("");
  const [tierFilter, setTierFilter] = useState<string>("");

  const params: Record<string, string> = { sort_by: sortBy, sort_dir: "desc" };
  if (dirFilter) params.direction = dirFilter;
  if (tierFilter) params.confidence_tier = tierFilter;

  const { data, isLoading } = usePolling(
    ["signals", sortBy, dirFilter, tierFilter],
    () => api.signals.list(params),
    30_000,
  );

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-sm font-medium text-zinc-300">Signals</h2>

      {/* Summary bar */}
      {data && (
        <div className="grid grid-cols-4 gap-2">
          <MetricCard label="Total" value={String(data.total)} />
          <MetricCard label="Actionable" value={String(data.actionable_count)} color="text-green-400" />
          <MetricCard label="Skipped" value={String(data.skipped_count)} color="text-zinc-500" />
          <MetricCard
            label="Top Edge"
            value={data.signals.length > 0 ? pct(data.signals[0]?.edge) : "—"}
            color="text-green-400"
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 text-xs">
        <span className="text-zinc-500">Filter:</span>
        <select
          value={dirFilter}
          onChange={(e) => setDirFilter(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300"
        >
          <option value="">All Directions</option>
          <option value="YES">YES</option>
          <option value="NO">NO</option>
          <option value="SKIP">SKIP</option>
        </select>
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300"
        >
          <option value="">All Tiers</option>
          <option value="HIGH">HIGH</option>
          <option value="MED">MED</option>
          <option value="LOW">LOW</option>
        </select>
        <span className="text-zinc-500 ml-2">Sort:</span>
        {(["edge", "confidence", "signal_time"] as SortKey[]).map((k) => (
          <button
            key={k}
            onClick={() => setSortBy(k)}
            className={`px-2 py-0.5 rounded ${sortBy === k ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            {k}
          </button>
        ))}
      </div>

      {/* Signal table */}
      {isLoading ? (
        <div className="animate-pulse h-64 bg-zinc-900 rounded" />
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-zinc-500 border-b border-zinc-800">
                <th className="text-left px-3 py-2 font-normal">Game</th>
                <th className="text-left px-3 py-2 font-normal">Time</th>
                <th className="text-center px-3 py-2 font-normal">Dir</th>
                <th className="text-right px-3 py-2 font-normal">Edge</th>
                <th className="text-right px-3 py-2 font-normal">EV</th>
                <th className="text-right px-3 py-2 font-normal">Fair</th>
                <th className="text-right px-3 py-2 font-normal">Market</th>
                <th className="text-center px-3 py-2 font-normal">Conf</th>
                <th className="text-right px-3 py-2 font-normal">Kelly</th>
                <th className="text-right px-3 py-2 font-normal">Liq</th>
                <th className="text-center px-3 py-2 font-normal">Flags</th>
                <th className="text-left px-3 py-2 font-normal">Skip Reason</th>
              </tr>
            </thead>
            <tbody>
              {data?.signals.map((s) => (
                <tr
                  key={s.signal_id}
                  className="border-t border-zinc-800/50 hover:bg-zinc-800/30 transition-colors"
                >
                  <td className="px-3 py-1.5">
                    <Link
                      to={`/game/${s.game_id}`}
                      className="text-zinc-300 hover:text-zinc-100"
                    >
                      {s.away_team} @ {s.home_team}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 text-zinc-500 tabular-nums">
                    {gameTime(s.game_time_utc)}
                  </td>
                  <td className={`px-3 py-1.5 text-center font-medium ${directionColor(s.direction)}`}>
                    {s.direction}
                  </td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${edgeColor(s.edge)}`}>
                    {pct(s.edge)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-zinc-300">
                    {pct(s.expected_value)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-zinc-300">
                    {pct(s.fair_prob)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-zinc-400">
                    {pct(s.market_mid)}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <Badge text={s.confidence_tier} color={tierColor(s.confidence_tier)} />
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-zinc-400">
                    {pct(s.kelly_suggested)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-zinc-400">
                    {num(s.liquidity_score, 2)}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {s.n_risk_flags > 0 ? (
                      <span className="text-yellow-400">{s.n_risk_flags}</span>
                    ) : (
                      <span className="text-zinc-700">0</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-zinc-500 max-w-[200px] truncate">
                    {s.skip_reason ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
