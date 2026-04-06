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

const LEAGUE_ORDER = ["NBA", "NBA Spread", "NBA Total", "CBA", "KBL", "EuroLeague", "B.League", "NBL", "VTB", "ACB", "BSL", "ABA", "FIBA", "NCAA", "WNBA"];

export default function HomePage() {
  const [selectedLeague, setSelectedLeague] = useState<string>("ALL");

  const { data: portfolio } = usePolling(
    ["portfolio"],
    () => api.portfolio.get("ALL"),
    10_000,
  );
  const { data: positions } = usePolling(
    ["positions"],
    () => api.portfolio.positions(),
    5_000,
  );
  const { data: games } = usePolling(
    ["games-today"],
    api.games.today,
    5_000, // refresh every 5 seconds for real-time odds
  );

  // Group games by league
  const leagues = new Map<string, GameListItem[]>();
  for (const g of games ?? []) {
    const league = (g as any).league || g.season_type || "Other";
    if (!leagues.has(league)) leagues.set(league, []);
    leagues.get(league)!.push(g);
  }

  // Sort leagues by predefined order
  const sortedLeagues = [...leagues.keys()].sort((a, b) => {
    const ai = LEAGUE_ORDER.indexOf(a);
    const bi = LEAGUE_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const filteredGames = selectedLeague === "ALL"
    ? (games ?? [])
    : (leagues.get(selectedLeague) ?? []);

  // Net P&L calculation
  const netPnl = (positions?.positions ?? []).reduce((sum, p) => sum + (p.pnl || 0), 0);
  const totalCost = (positions?.positions ?? []).reduce((sum, p) => sum + (p.cost || 0), 0);
  const netPnlPct = totalCost > 0 ? (netPnl / totalCost) * 100 : 0;
  const isUp = netPnl >= 0;

  // Build P&L curve from portfolio equity curve
  const pnlCurve = (portfolio?.equity_curve ?? []).map(pt => ({
    time: pt.time,
    value: pt.value - (portfolio?.equity_curve?.[0]?.value ?? 0),
  }));

  return (
    <div className="flex h-full">
      {/* Main content */}
      <div className="flex-1 overflow-auto">
        {/* Net P&L section */}
        <div className="px-6 pt-6">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Net Profit / Loss</div>
          <div className="mb-1">
            <span className={`text-4xl font-bold tracking-tight ${isUp ? "text-green-400" : "text-red-400"}`}>
              {isUp ? "+" : "-"}${Math.abs(netPnl).toFixed(2)}
            </span>
          </div>
          <div className="flex items-center gap-1 mb-4">
            <span className={`text-sm font-medium ${isUp ? "text-green-400" : "text-red-400"}`}>
              {isUp ? "▲" : "▼"} {Math.abs(netPnlPct).toFixed(2)}%
            </span>
            <span className="text-sm text-zinc-500 ml-1">
              on ${totalCost.toFixed(2)} invested
            </span>
          </div>

          {/* P&L curve */}
          {pnlCurve.length > 1 && (
            <div className="h-36 -mx-2 mb-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={pnlCurve}>
                  <XAxis dataKey="time" hide />
                  <YAxis domain={["auto", "auto"]} hide />
                  <Tooltip
                    contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ display: "none" }}
                    formatter={(v) => [`${Number(v) >= 0 ? "+" : ""}$${Number(v).toFixed(2)}`, "P&L"]}
                  />
                  <Line type="monotone" dataKey="value" stroke={isUp ? "#22c55e" : "#ef4444"} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Buying power */}
          <div className="flex items-center justify-between py-3 border-t border-zinc-800">
            <span className="text-sm text-zinc-400">Buying power</span>
            <span className="text-sm text-white font-medium">
              ${portfolio?.buying_power?.toLocaleString("en-US", { minimumFractionDigits: 2 }) ?? "—"}
            </span>
          </div>
        </div>

        {/* League tabs */}
        <div className="px-6 pt-3 border-t border-zinc-800">
          <div className="flex items-center gap-1 overflow-x-auto pb-3 scrollbar-hide">
            <LeagueTab label="All" count={games?.length ?? 0} active={selectedLeague === "ALL"} onClick={() => setSelectedLeague("ALL")} />
            {sortedLeagues.map(league => (
              <LeagueTab
                key={league}
                label={league}
                count={leagues.get(league)?.length ?? 0}
                active={selectedLeague === league}
                onClick={() => setSelectedLeague(league)}
              />
            ))}
          </div>
        </div>

        {/* Games list */}
        <div className="px-6 pb-6">
          <div className="space-y-0">
            {filteredGames.map((g) => (
              <GameRow key={g.game_id} game={g} />
            ))}
            {filteredGames.length === 0 && (
              <div className="text-zinc-600 text-sm py-8 text-center">
                No games in this category
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right sidebar: Positions */}
      <div className="w-80 shrink-0 border-l border-zinc-800 overflow-auto">
        <div className="px-4 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="text-sm font-medium text-zinc-300">My Positions</h3>
          <span className={`text-xs font-medium ${isUp ? "text-green-400" : netPnl < 0 ? "text-red-400" : "text-zinc-500"}`}>
            {isUp ? "+" : ""}{netPnl.toFixed(2)}
          </span>
        </div>
        <div className="p-3 space-y-2">
          {(positions?.positions ?? []).length === 0 ? (
            <div className="text-zinc-600 text-xs text-center py-8">
              No open positions<br />
              <span className="text-zinc-700">Click a game to start trading</span>
            </div>
          ) : (
            (positions?.positions ?? []).map((pos, i) => (
              <PositionCard key={pos.ticker || i} position={pos} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}


function LeagueTab({ label, count, active, onClick }: {
  label: string; count: number; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
        active
          ? "bg-green-600 text-white"
          : "text-zinc-400 hover:text-white hover:bg-zinc-800 bg-zinc-900"
      }`}
    >
      {label} <span className={active ? "text-green-200" : "text-zinc-600"}>{count}</span>
    </button>
  );
}


function GameRow({ game }: { game: GameListItem }) {
  // Extract real odds from game data (comes from Kalshi API)
  const vol = (game as any).volume || 0;

  return (
    <Link
      to={`/game/${game.game_id}`}
      className="flex items-center justify-between py-3 px-2 -mx-2 rounded-lg hover:bg-zinc-900 transition-colors border-b border-zinc-800/50"
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white truncate">
          {game.away_team}
          <span className="text-zinc-600 mx-1.5">vs</span>
          {game.home_team}
        </div>
        <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-2">
          <span className="text-zinc-600">{(game as any).league || game.season_type}</span>
          {vol > 0 && <span>${vol.toLocaleString()} vol</span>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-2">
        <span className="text-xs text-zinc-500">{game.n_markets} mkt{game.n_markets !== 1 ? "s" : ""}</span>
        <span className="text-zinc-700">›</span>
      </div>
    </Link>
  );
}


function PositionCard({ position }: { position: PositionItem }) {
  const isUp = position.pnl >= 0;
  const ticker = position.ticker || "";
  // Extract game info from ticker
  const displayName = ticker.replace("KXNBAGAME-", "").replace("KXCBAGAME-", "").replace("KXKBLGAME-", "");

  return (
    <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-white truncate mr-2">
          {displayName || position.game_id}
        </span>
        <span className={`text-xs font-bold ${isUp ? "text-green-400" : "text-red-400"}`}>
          {isUp ? "+" : ""}${position.pnl.toFixed(2)}
        </span>
      </div>
      <div className="flex items-center justify-between text-[10px] text-zinc-500">
        <span>
          <span className={position.side === "YES" ? "text-green-400" : "text-red-400"}>
            {position.side}
          </span>
          {" "}× {position.quantity}
        </span>
        <span className={isUp ? "text-green-400" : "text-red-400"}>
          {position.pnl_pct > 0 ? "+" : ""}{position.pnl_pct}%
        </span>
      </div>
      <div className="flex items-center justify-between text-[10px] text-zinc-600 mt-1">
        <span>Avg {(position.entry_price * 100).toFixed(0)}¢</span>
        <span>Cost ${position.cost.toFixed(2)}</span>
      </div>
    </div>
  );
}
