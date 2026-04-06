import { api } from "../lib/api";
import { usePolling } from "../hooks/usePolling";
import SummaryBar from "../components/dashboard/SummaryBar";
import GameCard from "../components/dashboard/GameCard";
import Panel from "../components/shared/Panel";
import Badge from "../components/shared/Badge";
import { directionColor, edgeColor, pct, tierColor, timeAgo } from "../lib/format";
import { Link } from "react-router-dom";

export default function DashboardPage() {
  const { data: summary, isLoading: summLoading } = usePolling(
    ["dashboard-summary"],
    api.dashboard.summary,
    60_000,
  );
  const { data: games, isLoading: gamesLoading } = usePolling(
    ["games-today"],
    api.games.today,
    60_000,
  );

  if (summLoading || gamesLoading) {
    return <Loading />;
  }

  // Sort games: signal-having first, then by edge desc
  const sorted = [...(games ?? [])].sort((a, b) => {
    if (a.has_signal !== b.has_signal) return a.has_signal ? -1 : 1;
    return (b.signal_edge ?? 0) - (a.signal_edge ?? 0);
  });

  const actionable = sorted.filter(
    (g) => g.has_signal && g.signal_direction !== "SKIP",
  );

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-300">
          Dashboard
          <span className="text-zinc-600 ml-2 font-normal">
            {summary?.today_date}
          </span>
        </h2>
        <span className="text-[10px] text-zinc-600">
          Last refresh: {summary?.last_refresh ? timeAgo(summary.last_refresh) : "—"}
        </span>
      </div>

      {/* Summary metrics bar */}
      {summary && <SummaryBar data={summary} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Priority signals */}
        <Panel title="Priority Signals" className="lg:col-span-1">
          {actionable.length === 0 ? (
            <div className="text-zinc-600 text-xs py-4 text-center">
              No actionable signals today
            </div>
          ) : (
            <div className="space-y-2">
              {actionable.slice(0, 5).map((g) => (
                <Link
                  key={g.game_id}
                  to={`/game/${g.game_id}`}
                  className="block p-2 rounded bg-zinc-800/50 hover:bg-zinc-800 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs">
                      {g.away_team} @ {g.home_team}
                    </span>
                    <Badge
                      text={g.signal_confidence_tier ?? ""}
                      color={tierColor(g.signal_confidence_tier ?? "")}
                    />
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className={`text-xs font-medium ${directionColor(g.signal_direction ?? "")}`}>
                      {g.signal_direction}
                    </span>
                    <span className={`text-xs tabular-nums ${edgeColor(g.signal_edge ?? 0)}`}>
                      {pct(g.signal_edge)} edge
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Panel>

        {/* Today's games */}
        <Panel title="Today's Games" className="lg:col-span-2">
          {sorted.length === 0 ? (
            <div className="text-zinc-600 text-xs py-8 text-center">
              No games scheduled today
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {sorted.map((g) => (
                <GameCard key={g.game_id} game={g} />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="p-4">
      <div className="animate-pulse space-y-4">
        <div className="h-16 bg-zinc-900 rounded" />
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-16 bg-zinc-900 rounded" />
          ))}
        </div>
      </div>
    </div>
  );
}
