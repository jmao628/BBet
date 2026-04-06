import { useParams, Link } from "react-router-dom";
import { api } from "../lib/api";
import { usePolling } from "../hooks/usePolling";
import ProbabilityPanel from "../components/game/ProbabilityPanel";
import DecisionPanel from "../components/game/DecisionPanel";
import TeamComparisonPanel from "../components/game/TeamComparisonPanel";
import InjuryPanel from "../components/game/InjuryPanel";
import FilterGatesPanel from "../components/game/FilterGatesPanel";
import RiskFlagsPanel from "../components/game/RiskFlagsPanel";
import MarketPanel from "../components/game/MarketPanel";
import Badge from "../components/shared/Badge";
import { directionColor, gameTime, tierColor } from "../lib/format";
import { ArrowLeft } from "lucide-react";

export default function GameDetailPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const { data: game, isLoading } = usePolling(
    ["game-detail", gameId!],
    () => api.games.detail(gameId!),
    30_000,
    { enabled: !!gameId },
  );

  if (isLoading || !game) {
    return (
      <div className="p-4">
        <div className="animate-pulse h-96 bg-zinc-900 rounded" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/" className="text-zinc-500 hover:text-zinc-300">
          <ArrowLeft size={16} />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium">
              {game.away_team} @ {game.home_team}
            </h2>
            {game.season_type !== "Regular" && (
              <Badge text={game.season_type} color="text-purple-400 bg-purple-400/10" />
            )}
            {game.series_info && (
              <Badge text={game.series_info} color="text-purple-400 bg-purple-400/10" />
            )}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">
            {game.game_date} · {gameTime(game.game_time_utc)}
            {game.venue && ` · ${game.venue}`}
          </div>
        </div>

        {/* Actionable verdict */}
        {game.decision && (
          <div className="flex items-center gap-2">
            <span className={`text-lg font-bold ${directionColor(game.decision.direction)}`}>
              {game.decision.direction}
            </span>
            {game.confidence && (
              <Badge text={game.confidence.tier} color={tierColor(game.confidence.tier)} />
            )}
          </div>
        )}
        {game.skip_reason && (
          <Badge text="SKIP" color="text-zinc-500 bg-zinc-800" />
        )}
      </div>

      {/* Skip reason banner */}
      {game.skip_reason && (
        <div className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs text-zinc-400">
          <span className="text-zinc-500">Skip reason:</span>{" "}
          <span className="text-yellow-400">{game.skip_reason}</span>
        </div>
      )}

      {/* Two-column layout: Decision left, Analysis right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left column: Decision pipeline */}
        <div className="space-y-4">
          {game.probability && <ProbabilityPanel prob={game.probability} />}
          {game.decision && game.confidence && (
            <DecisionPanel decision={game.decision} confidence={game.confidence} />
          )}
          <FilterGatesPanel gates={game.filter_gates} />
        </div>

        {/* Middle column: Team fundamentals */}
        <div className="space-y-4">
          <TeamComparisonPanel home={game.home_stats} away={game.away_stats} />
          <InjuryPanel
            homeTeam={game.home_team}
            awayTeam={game.away_team}
            homeInjuries={game.home_injuries}
            awayInjuries={game.away_injuries}
          />
        </div>

        {/* Right column: Markets & Risk */}
        <div className="space-y-4">
          <MarketPanel markets={game.markets} />
          <RiskFlagsPanel riskFlags={game.risk_flags} keyDrivers={game.key_drivers} />
        </div>
      </div>
    </div>
  );
}
