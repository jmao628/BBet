import { Link } from "react-router-dom";
import type { GameListItem } from "../../types/api";
import Badge from "../shared/Badge";
import { directionColor, edgeColor, gameTime, pct, tierColor } from "../../lib/format";

export default function GameCard({ game }: { game: GameListItem }) {
  return (
    <Link
      to={`/game/${game.game_id}`}
      className="block bg-zinc-900 border border-zinc-800 rounded px-3 py-2 hover:border-zinc-600 transition-colors"
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] text-zinc-500">{gameTime(game.game_time_utc)}</span>
        <div className="flex gap-1">
          {game.is_b2b_home && <Badge text="B2B H" color="text-yellow-400 bg-yellow-400/10" />}
          {game.is_b2b_away && <Badge text="B2B A" color="text-yellow-400 bg-yellow-400/10" />}
          {game.season_type !== "Regular" && (
            <Badge text={game.season_type} color="text-purple-400 bg-purple-400/10" />
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium">{game.away_team}</span>
          <span className="text-zinc-600 mx-1.5">@</span>
          <span className="text-sm font-medium">{game.home_team}</span>
        </div>
        <span className="text-[10px] text-zinc-500">{game.n_markets} mkts</span>
      </div>

      {game.has_signal && (
        <div className="mt-2 pt-2 border-t border-zinc-800 flex items-center gap-3">
          <span className={directionColor(game.signal_direction ?? "")}>
            {game.signal_direction}
          </span>
          <span className={edgeColor(game.signal_edge ?? 0)}>
            Edge {pct(game.signal_edge)}
          </span>
          {game.signal_confidence_tier && (
            <Badge text={game.signal_confidence_tier} color={tierColor(game.signal_confidence_tier)} />
          )}
        </div>
      )}
    </Link>
  );
}
