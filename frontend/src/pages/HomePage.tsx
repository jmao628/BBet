import { useState } from "react";
import { Link } from "react-router-dom";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { api } from "../lib/api";
import type { PositionItem } from "../lib/api";
import { usePolling } from "../hooks/usePolling";
import type { GameListItem } from "../types/api";
import { gameTime, pct } from "../lib/format";

const PERIODS = ["1D", "1W", "1M", "3M", "1Y", "ALL"] as const;

export default function HomePage() {
  const [period, setPeriod] = useState<string>("1W");

  const { data: portfolio } = usePolling(
    ["portfolio", period],
    () => api.portfolio.get(period),
    60_000,
  );
  const { data: positions } = usePolling(
    ["positions"],
    () => api.portfolio.positions(),
    30_000,
  );
  const { data: games } = usePolling(
    ["games-today"],
    api.games.today,
    60_000,
  );

  const isUp = (portfolio?.change ?? 0) >= 0;
  const accentColor = isUp ? "#22c55e" : "#ef4444";

  return (
    <div className="flex h-full">
      {/* Main content: portfolio + games */}
      <div className="flex-1 overflow-auto">
        {/* Portfolio section */}
        <div className="px-6 pt-6">
          {/* Total value */}
          <div className="mb-1">
            <span className="text-4xl font-bold text-white tracking-tight">
              ${portfolio?.total_value?.toLocaleString("en-US", { minimumFractionDigits: 2 }) ?? "—"}
            </span>
          </div>
          <div className="flex items-center gap-1 mb-6">
            <span style={{ color: accentColor }} className="text-sm font-medium">
              {isUp ? "▲" : "▼"} ${Math.abs(portfolio?.change ?? 0).toFixed(2)} ({Math.abs(portfolio?.change_pct ?? 0).toFixed(2)}%)
            </span>
            <span className="text-sm text-zinc-500 ml-1">
              Past {period === "1D" ? "day" : period === "1W" ? "week" : period === "1M" ? "month" : period === "3M" ? "3 months" : period === "1Y" ? "year" : "time"}
            </span>
          </div>

          {/* Equity curve */}
          <div className="h-52 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={portfolio?.equity_curve ?? []}>
                <XAxis dataKey="time" hide />
                <YAxis domain={["auto", "auto"]} hide />
                <Tooltip
                  contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ display: "none" }}
                  formatter={(v) => [`$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, ""]}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={accentColor}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: accentColor }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Period selector */}
          <div className="flex items-center gap-1 mt-2 mb-6">
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  period === p
                    ? "bg-green-600 text-white"
                    : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Buying power */}
          <div className="flex items-center justify-between py-3 border-t border-zinc-800">
            <span className="text-sm text-zinc-400">Buying power</span>
            <span className="text-sm text-white font-medium">
              ${portfolio?.buying_power?.toLocaleString("en-US", { minimumFractionDigits: 2 }) ?? "—"}
            </span>
          </div>
        </div>

        {/* Games list */}
        <div className="px-6 pt-4 pb-6">
          <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">
            Basketball Markets
          </h2>
          <div className="space-y-0">
            {(games ?? []).map((g) => (
              <GameRow key={g.game_id} game={g} />
            ))}
            {(!games || games.length === 0) && (
              <div className="text-zinc-600 text-sm py-8 text-center">
                No basketball markets available
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right sidebar: Positions */}
      <div className="w-80 shrink-0 border-l border-zinc-800 overflow-auto">
        <div className="px-4 py-4 border-b border-zinc-800">
          <h3 className="text-sm font-medium text-zinc-300">My Positions</h3>
        </div>
        <div className="p-3 space-y-2">
          {(positions?.positions ?? []).length === 0 ? (
            <div className="text-zinc-600 text-xs text-center py-8">
              No open positions
            </div>
          ) : (
            (positions?.positions ?? []).map((pos) => (
              <PositionCard key={pos.game_id} position={pos} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}


function GameRow({ game }: { game: GameListItem }) {
  return (
    <Link
      to={`/game/${game.game_id}`}
      className="flex items-center justify-between py-3 px-2 -mx-2 rounded-lg hover:bg-zinc-900 transition-colors border-b border-zinc-800/50"
    >
      <div className="flex-1">
        <div className="text-sm font-medium text-white">
          {game.away_team} vs {game.home_team}
        </div>
        <div className="text-xs text-zinc-500 mt-0.5">
          {gameTime(game.game_time_utc)}
          {game.season_type !== "Regular" && (
            <span className="ml-2 text-purple-400">{game.season_type}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {game.has_signal && game.signal_direction !== "SKIP" && (
          <span className={`text-xs px-2 py-0.5 rounded ${
            game.signal_direction === "YES"
              ? "bg-green-500/10 text-green-400"
              : "bg-red-500/10 text-red-400"
          }`}>
            {game.signal_direction} {pct(game.signal_edge)}
          </span>
        )}
        <span className="text-zinc-500 text-xs">{game.n_markets} mkt</span>
      </div>
    </Link>
  );
}


function PositionCard({ position }: { position: PositionItem }) {
  const isUp = position.pnl >= 0;
  return (
    <Link
      to={`/game/${position.game_id}`}
      className="block p-3 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-white">
          {position.away_team} vs {position.home_team}
        </span>
        <span className={`text-xs font-medium ${isUp ? "text-green-400" : "text-red-400"}`}>
          {isUp ? "+" : ""}${position.pnl.toFixed(2)}
        </span>
      </div>
      <div className="flex items-center justify-between text-[10px] text-zinc-500">
        <span>
          <span className={position.side === "YES" ? "text-green-400" : "text-red-400"}>
            {position.side}
          </span>
          {" "}{position.team_bet} · {position.quantity} contracts
        </span>
        <span className={isUp ? "text-green-400" : "text-red-400"}>
          {position.pnl_pct > 0 ? "+" : ""}{position.pnl_pct}%
        </span>
      </div>
      <div className="flex items-center justify-between text-[10px] text-zinc-600 mt-1">
        <span>Avg {(position.entry_price * 100).toFixed(0)}¢</span>
        <span>Current {(position.current_price * 100).toFixed(0)}¢</span>
      </div>
    </Link>
  );
}
