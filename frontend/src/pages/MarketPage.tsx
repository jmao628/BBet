import { useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { api } from "../lib/api";
import { usePolling } from "../hooks/usePolling";
import { ArrowLeft } from "lucide-react";

const PERIODS = ["1D", "1W", "1M", "ALL"] as const;

export default function MarketPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const [period, setPeriod] = useState<string>("1D");
  const [buyTab, setBuyTab] = useState<"buy" | "sell">("buy");
  const [selectedSide, setSelectedSide] = useState<"yes" | "no">("yes");
  const [quantity, setQuantity] = useState<number>(10);
  const [limitPrice, setLimitPrice] = useState<number>(0);
  const [tradeStatus, setTradeStatus] = useState<string>("");

  // Real-time data — refresh every 5 seconds
  const { data: priceData, refetch: refetchPrice } = usePolling(
    ["price-history", gameId!, period],
    () => api.games.priceHistory(gameId!, period),
    5_000,
    { enabled: !!gameId },
  );

  const { data: gameDetail, refetch: refetchGame } = usePolling(
    ["game-detail", gameId!],
    () => api.games.detail(gameId!),
    5_000,
    { enabled: !!gameId },
  );

  // Set initial limit price from market data
  const market0 = (gameDetail as any)?.markets?.[0];
  const market1 = (gameDetail as any)?.markets?.[1];

  const homeTeam = priceData?.home_team || (gameDetail as any)?.home_team || "";
  const awayTeam = priceData?.away_team || (gameDetail as any)?.away_team || "";

  // Get best bid/ask from orderbook
  const homeBid = market0?.yes_bid ?? 0;
  const homeAsk = market0?.yes_ask ?? 0;
  const homeMid = market0?.yes_mid ?? 0;
  const awayBid = market1?.yes_bid ?? 0;
  const awayAsk = market1?.yes_ask ?? 0;
  const awayMid = market1?.yes_mid ?? 0;

  const homePct = Math.round(homeMid * 100);
  const awayPct = Math.round(awayMid * 100);

  // Current ticker for the selected side
  const selectedTicker = selectedSide === "yes" ? market0?.ticker : market1?.ticker;
  const selectedBid = selectedSide === "yes" ? homeBid : awayBid;
  const selectedAsk = selectedSide === "yes" ? homeAsk : awayAsk;

  // Calculate cost and potential outcomes
  const priceCents = limitPrice || Math.round((buyTab === "buy" ? selectedAsk : selectedBid) * 100);
  const totalCost = (priceCents / 100) * quantity;
  const maxProfit = buyTab === "buy" ? (1 - priceCents / 100) * quantity : (priceCents / 100) * quantity;
  const maxLoss = buyTab === "buy" ? totalCost : (1 - priceCents / 100) * quantity;

  // Execute trade
  const executeTrade = useCallback(async () => {
    if (!selectedTicker || priceCents <= 0 || quantity <= 0) return;
    setTradeStatus("executing...");
    try {
      const res = await fetch(
        `http://localhost:8000/api/portfolio/trade?ticker=${selectedTicker}&side=${selectedSide}&action=${buyTab}&quantity=${quantity}&price_cents=${priceCents}`,
        { method: "POST" },
      );
      const data = await res.json();
      if (data.error) {
        setTradeStatus(`Error: ${data.error}`);
      } else {
        setTradeStatus(`${buyTab === "buy" ? "Bought" : "Sold"} ${quantity} × ${priceCents}¢ = $${(priceCents / 100 * quantity).toFixed(2)}`);
        refetchPrice();
        refetchGame();
      }
    } catch (e) {
      setTradeStatus(`Failed: ${e}`);
    }
    setTimeout(() => setTradeStatus(""), 4000);
  }, [selectedTicker, selectedSide, buyTab, quantity, priceCents, refetchPrice, refetchGame]);

  if (!gameDetail) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="animate-pulse text-zinc-600">Loading market data...</div>
      </div>
    );
  }

  const title = (gameDetail as any)?.title || `${awayTeam} vs ${homeTeam}`;
  const league = (gameDetail as any)?.league || "NBA";
  const volume0 = market0?.volume ?? 0;
  const volume1 = market1?.volume ?? 0;
  const totalVolume = volume0 + volume1;

  return (
    <div className="flex h-full">
      {/* Main: Chart area */}
      <div className="flex-1 overflow-auto">
        <div className="px-6 pt-5">
          {/* Header */}
          <div className="flex items-start gap-3 mb-1">
            <Link to="/" className="text-zinc-500 hover:text-white mt-1">
              <ArrowLeft size={18} />
            </Link>
            <div>
              <div className="text-xs text-zinc-500 mb-0.5">
                Sports · Basketball · {league}
              </div>
              <h1 className="text-xl font-bold text-white">{title}</h1>
            </div>
          </div>

          {/* Live odds display */}
          <div className="ml-7 flex items-center gap-4 text-xs text-zinc-500 mb-6">
            <span>
              {homeTeam}: <span className="text-green-400 font-medium">{homePct}%</span>
              <span className="text-zinc-600 ml-1">(bid {Math.round(homeBid * 100)}¢ / ask {Math.round(homeAsk * 100)}¢)</span>
            </span>
            <span>
              {awayTeam}: <span className="text-blue-400 font-medium">{awayPct}%</span>
              <span className="text-zinc-600 ml-1">(bid {Math.round(awayBid * 100)}¢ / ask {Math.round(awayAsk * 100)}¢)</span>
            </span>
          </div>

          {/* Price chart */}
          <div className="h-72 -mx-2">
            {priceData && priceData.price_history.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={priceData.price_history}>
                  <XAxis
                    dataKey="time"
                    tickFormatter={(t) => new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                    tick={{ fill: "#71717a", fontSize: 10 }}
                    axisLine={{ stroke: "#27272a" }}
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={60}
                  />
                  <YAxis
                    domain={[0, 1]}
                    tickFormatter={(v) => `${Math.round(v * 100)}%`}
                    tick={{ fill: "#71717a", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={45}
                    ticks={[0, 0.25, 0.5, 0.75, 1]}
                  />
                  <ReferenceLine y={0.5} stroke="#3f3f46" strokeDasharray="3 3" />
                  <Tooltip
                    contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }}
                    labelFormatter={(t) => new Date(t as string).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" })}
                    formatter={(v, name) => [`${Math.round(Number(v) * 100)}%`, name === "yes_price" ? homeTeam : awayTeam]}
                  />
                  <Line type="monotone" dataKey="yes_price" stroke="#22c55e" strokeWidth={2.5} dot={false} name="yes_price" />
                  <Line type="monotone" dataKey="no_price" stroke="#3b82f6" strokeWidth={2.5} dot={false} name="no_price" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
                No price history available yet
              </div>
            )}
          </div>

          {/* Chart legend + team percentages */}
          <div className="flex items-center justify-between mt-2 mb-2 px-2">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                <span className="text-sm font-bold text-green-400">{homeTeam}</span>
                <span className="text-lg font-bold text-green-400">{homePct}%</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                <span className="text-sm font-bold text-blue-400">{awayTeam}</span>
                <span className="text-lg font-bold text-blue-400">{awayPct}%</span>
              </div>
            </div>
          </div>

          {/* Volume + period selector */}
          <div className="flex items-center justify-between py-3 border-t border-zinc-800">
            <span className="text-sm text-zinc-500">
              ${totalVolume.toLocaleString()} vol
            </span>
            <div className="flex items-center gap-1">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${period === p ? "text-white bg-zinc-800" : "text-zinc-500 hover:text-zinc-300"}`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Orderbook depth */}
          <div className="border-t border-zinc-800 pt-3 pb-3">
            <div className="text-xs text-zinc-500 mb-2">Order Book Depth</div>
            <div className="grid grid-cols-2 gap-4">
              {market0 && (
                <div>
                  <div className="text-xs text-zinc-400 mb-1">{homeTeam}</div>
                  <div className="flex justify-between text-[10px] text-zinc-500">
                    <span>YES depth: ${(market0.yes_depth ?? 0).toLocaleString()}</span>
                    <span>NO depth: ${(market0.no_depth ?? 0).toLocaleString()}</span>
                  </div>
                </div>
              )}
              {market1 && (
                <div>
                  <div className="text-xs text-zinc-400 mb-1">{awayTeam}</div>
                  <div className="flex justify-between text-[10px] text-zinc-500">
                    <span>YES depth: ${(market1.yes_depth ?? 0).toLocaleString()}</span>
                    <span>NO depth: ${(market1.no_depth ?? 0).toLocaleString()}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Chance table */}
          <div className="border-t border-zinc-800 pt-3 pb-6">
            <div className="text-sm text-zinc-400 mb-3">Chance</div>
            <div className="space-y-2">
              <ChanceRow
                team={homeTeam}
                pct={homePct}
                yesCents={Math.round(homeAsk * 100)}
                noCents={Math.round((1 - homeBid) * 100)}
              />
              <ChanceRow
                team={awayTeam}
                pct={awayPct}
                yesCents={Math.round(awayAsk * 100)}
                noCents={Math.round((1 - awayBid) * 100)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Right sidebar: Buy/Sell panel */}
      <div className="w-80 shrink-0 border-l border-zinc-800 overflow-auto">
        <div className="p-4">
          {/* Market title */}
          <div className="text-sm text-zinc-300 mb-1">{title}</div>
          <div className="text-xs mb-4">
            <span className={selectedSide === "yes" ? "text-green-400" : "text-red-400"}>
              {buyTab === "buy" ? "Buy" : "Sell"} {selectedSide.toUpperCase()}
            </span>
            <span className="text-zinc-600"> · </span>
            <span className="text-white">{selectedSide === "yes" ? homeTeam : awayTeam}</span>
          </div>

          {/* Buy / Sell tabs */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setBuyTab("buy")}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${buyTab === "buy" ? "bg-green-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
            >
              Buy
            </button>
            <button
              onClick={() => setBuyTab("sell")}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${buyTab === "sell" ? "bg-red-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
            >
              Sell
            </button>
          </div>

          {/* Yes / No buttons */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setSelectedSide("yes")}
              className={`flex-1 py-3 rounded-lg text-sm font-bold transition-colors ${selectedSide === "yes" ? "bg-green-500/20 text-green-400 border-2 border-green-500" : "bg-zinc-800 text-zinc-400 border-2 border-transparent hover:border-zinc-600"}`}
            >
              Yes {Math.round(homeAsk * 100)}¢
            </button>
            <button
              onClick={() => setSelectedSide("no")}
              className={`flex-1 py-3 rounded-lg text-sm font-bold transition-colors ${selectedSide === "no" ? "bg-red-500/20 text-red-400 border-2 border-red-500" : "bg-zinc-800 text-zinc-400 border-2 border-transparent hover:border-zinc-600"}`}
            >
              No {Math.round(awayAsk * 100)}¢
            </button>
          </div>

          {/* Quantity */}
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 mb-3">
            <div className="text-xs text-zinc-500 mb-2">Contracts</div>
            <div className="flex items-center gap-2">
              {[1, 5, 10, 25, 50, 100].map(q => (
                <button
                  key={q}
                  onClick={() => setQuantity(q)}
                  className={`px-2 py-1 rounded text-xs ${quantity === q ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
                >
                  {q}
                </button>
              ))}
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-14 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white text-right"
                min={1}
              />
            </div>
          </div>

          {/* Limit price */}
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 mb-3">
            <div className="text-xs text-zinc-500 mb-2">Price (cents)</div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={limitPrice || priceCents}
                onChange={(e) => setLimitPrice(Math.max(1, Math.min(99, parseInt(e.target.value) || 1)))}
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                min={1}
                max={99}
              />
              <span className="text-xs text-zinc-500">¢</span>
            </div>
            <div className="flex justify-between text-[10px] text-zinc-600 mt-1.5">
              <span>Bid: {Math.round(selectedBid * 100)}¢</span>
              <span>Ask: {Math.round(selectedAsk * 100)}¢</span>
            </div>
          </div>

          {/* Cost / Payout summary */}
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 mb-4 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-500">{buyTab === "buy" ? "Total cost" : "Revenue"}</span>
              <span className="text-white font-medium">${totalCost.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-zinc-500">If {selectedSide.toUpperCase()} wins</span>
              <span className="text-green-400">+${maxProfit.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-zinc-500">If {selectedSide.toUpperCase()} loses</span>
              <span className="text-red-400">-${maxLoss.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs border-t border-zinc-800 pt-1.5">
              <span className="text-zinc-500">Return if win</span>
              <span className="text-green-400">
                {totalCost > 0 ? `+${((maxProfit / totalCost) * 100).toFixed(0)}%` : "—"}
              </span>
            </div>
          </div>

          {/* Execute button */}
          <button
            onClick={executeTrade}
            disabled={!selectedTicker || priceCents <= 0}
            className={`w-full py-3.5 font-medium rounded-lg transition-colors text-sm ${
              buyTab === "buy"
                ? "bg-green-500 hover:bg-green-600 text-white"
                : "bg-red-500 hover:bg-red-600 text-white"
            } disabled:opacity-30 disabled:cursor-not-allowed`}
          >
            {buyTab === "buy" ? "Buy" : "Sell"} {quantity} × {selectedSide.toUpperCase()} at {priceCents}¢
          </button>

          {/* Trade status */}
          {tradeStatus && (
            <div className={`mt-3 text-xs text-center py-2 rounded ${
              tradeStatus.startsWith("Error") || tradeStatus.startsWith("Failed")
                ? "bg-red-500/10 text-red-400"
                : "bg-green-500/10 text-green-400"
            }`}>
              {tradeStatus}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


function ChanceRow({ team, pct, yesCents, noCents }: {
  team: string; pct: number; yesCents: number; noCents: number;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-3">
        <span className="text-sm text-white">{team}</span>
        <span className="text-sm font-bold text-white">{pct}%</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="px-4 py-1.5 rounded-full bg-green-500/15 text-green-400 text-xs font-medium">
          Yes {yesCents}¢
        </span>
        <span className="px-4 py-1.5 rounded-full bg-red-500/15 text-red-400 text-xs font-medium">
          No {noCents}¢
        </span>
      </div>
    </div>
  );
}
