import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
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

  const { data: priceData } = usePolling(
    ["price-history", gameId!, period],
    () => api.games.priceHistory(gameId!, period),
    30_000,
    { enabled: !!gameId },
  );

  const { data: gameDetail } = usePolling(
    ["game-detail", gameId!],
    () => api.games.detail(gameId!),
    30_000,
    { enabled: !!gameId },
  );

  if (!priceData || !gameDetail) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="animate-pulse text-zinc-600">Loading...</div>
      </div>
    );
  }

  const yesCents = Math.round(priceData.yes_price * 100);
  const noCents = Math.round(priceData.no_price * 100);
  const timeToGame = getTimeToGame(priceData.game_time_utc);

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
                Sports · Basketball · NBA
              </div>
              <h1 className="text-xl font-bold text-white">
                {priceData.away_team} vs {priceData.home_team}
              </h1>
            </div>
          </div>

          {/* Time to game */}
          <div className="ml-7 text-xs text-zinc-500 mb-6">
            Begins in {timeToGame} · {new Date(priceData.game_time_utc).toLocaleString("en-US", {
              month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
            })}
          </div>

          {/* Price chart — two lines */}
          <div className="h-72 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={priceData.price_history}>
                <XAxis
                  dataKey="time"
                  tickFormatter={(t) => {
                    const d = new Date(t);
                    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
                  }}
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
                <Tooltip
                  contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }}
                  labelFormatter={(t) => new Date(t as string).toLocaleString("en-US", {
                    hour: "numeric", minute: "2-digit", month: "short", day: "numeric",
                  })}
                  formatter={(v, name) => [
                    `${Math.round(Number(v) * 100)}%`,
                    name === "yes_price" ? priceData.home_team : priceData.away_team,
                  ]}
                />
                {/* Home team (YES) line — green */}
                <Line
                  type="monotone"
                  dataKey="yes_price"
                  stroke="#22c55e"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 5, fill: "#22c55e", stroke: "#000", strokeWidth: 2 }}
                />
                {/* Away team (NO) line — blue */}
                <Line
                  type="monotone"
                  dataKey="no_price"
                  stroke="#3b82f6"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 5, fill: "#3b82f6", stroke: "#000", strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Team labels on chart */}
          <div className="flex items-center justify-between ml-12 -mt-2 mb-2">
            <div />
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                <span className="text-sm font-bold text-green-400">{priceData.home_team}</span>
                <span className="text-lg font-bold text-green-400">{priceData.home_pct}%</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                <span className="text-sm font-bold text-blue-400">{priceData.away_team}</span>
                <span className="text-lg font-bold text-blue-400">{priceData.away_pct}%</span>
              </div>
            </div>
          </div>

          {/* Volume + period selector */}
          <div className="flex items-center justify-between py-3 border-t border-zinc-800">
            <span className="text-sm text-zinc-500">
              ${priceData.volume.toLocaleString()} vol
            </span>
            <div className="flex items-center gap-1">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    period === p
                      ? "text-white"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Chance table */}
          <div className="border-t border-zinc-800 pt-3">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-zinc-400">Chance</span>
            </div>
            <div className="space-y-2">
              <TeamOddsRow
                team={`${priceData.home_team} wins`}
                pct={priceData.home_pct}
                yesCents={yesCents}
                noCents={noCents}
              />
              <TeamOddsRow
                team={`${priceData.away_team} wins`}
                pct={priceData.away_pct}
                yesCents={100 - yesCents}
                noCents={100 - noCents}
              />
            </div>
          </div>

          {/* Signal analysis (collapsed by default) */}
          {gameDetail.decision && (
            <div className="border-t border-zinc-800 mt-4 pt-4 pb-6">
              <h3 className="text-sm font-medium text-zinc-400 mb-3">Model Analysis</h3>
              <div className="grid grid-cols-3 gap-3">
                <AnalysisCard label="Edge" value={`${(gameDetail.decision.edge * 100).toFixed(1)}%`} color={gameDetail.decision.edge > 0.04 ? "text-green-400" : "text-zinc-300"} />
                <AnalysisCard label="Fair Prob" value={`${((gameDetail.probability?.ensemble_fair ?? 0) * 100).toFixed(0)}%`} />
                <AnalysisCard label="Confidence" value={gameDetail.confidence?.tier ?? "—"} color={gameDetail.confidence?.tier === "HIGH" ? "text-green-400" : gameDetail.confidence?.tier === "MED" ? "text-yellow-400" : "text-zinc-400"} />
                <AnalysisCard label="Kelly (1/4)" value={`${(gameDetail.decision.kelly_suggested * 100).toFixed(1)}%`} />
                <AnalysisCard label="EV" value={`${(gameDetail.decision.expected_value * 100).toFixed(1)}%`} />
                <AnalysisCard label="Direction" value={gameDetail.decision.direction} color={gameDetail.decision.direction === "YES" ? "text-green-400" : gameDetail.decision.direction === "NO" ? "text-red-400" : "text-zinc-500"} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right sidebar: Buy/Sell panel (Kalshi-style) */}
      <div className="w-80 shrink-0 border-l border-zinc-800 overflow-auto">
        <div className="p-4">
          {/* Market title */}
          <div className="text-sm text-zinc-300 mb-1">
            {priceData.away_team} vs {priceData.home_team}
          </div>
          <div className="text-xs mb-4">
            <span className="text-green-400">Buy Yes</span>
            <span className="text-zinc-600"> · </span>
            <span className="text-white">{priceData.home_team}</span>
          </div>

          {/* Buy / Sell tabs */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setBuyTab("buy")}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                buyTab === "buy"
                  ? "bg-green-600 text-white"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
              }`}
            >
              Buy
            </button>
            <button
              onClick={() => setBuyTab("sell")}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                buyTab === "sell"
                  ? "bg-zinc-600 text-white"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
              }`}
            >
              Sell
            </button>
          </div>

          {/* Yes / No buttons */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setSelectedSide("yes")}
              className={`flex-1 py-3 rounded-lg text-sm font-bold transition-colors ${
                selectedSide === "yes"
                  ? "bg-green-500/20 text-green-400 border-2 border-green-500"
                  : "bg-zinc-800 text-zinc-400 border-2 border-transparent hover:border-zinc-600"
              }`}
            >
              Yes {yesCents}¢
            </button>
            <button
              onClick={() => setSelectedSide("no")}
              className={`flex-1 py-3 rounded-lg text-sm font-bold transition-colors ${
                selectedSide === "no"
                  ? "bg-red-500/20 text-red-400 border-2 border-red-500"
                  : "bg-zinc-800 text-zinc-400 border-2 border-transparent hover:border-zinc-600"
              }`}
            >
              No {noCents}¢
            </button>
          </div>

          {/* Amount */}
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 mb-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-zinc-400">Amount</div>
                <div className="text-xs text-green-400 mt-0.5">Earn 3.25% Interest</div>
              </div>
              <span className="text-2xl text-zinc-600 font-light">$0</span>
            </div>
          </div>

          {/* Sign up / Trade button */}
          <button className="w-full py-3.5 bg-green-500 hover:bg-green-600 text-white font-medium rounded-lg transition-colors text-sm">
            Sign up to trade
          </button>

          {/* Model recommendation */}
          {gameDetail.decision && gameDetail.is_actionable && (
            <div className="mt-4 p-3 bg-green-500/5 border border-green-500/20 rounded-lg">
              <div className="text-xs text-green-400 font-medium mb-1">Model Recommendation</div>
              <div className="text-xs text-zinc-400">
                Buy <span className="text-green-400 font-medium">{gameDetail.decision.direction}</span> at{" "}
                {selectedSide === "yes" ? yesCents : noCents}¢ ·{" "}
                Edge {(gameDetail.decision.edge * 100).toFixed(1)}% ·{" "}
                Suggested ${gameDetail.decision.suggested_size_usd?.toFixed(0) ?? "—"}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


function TeamOddsRow({ team, pct, yesCents, noCents }: {
  team: string; pct: number; yesCents: number; noCents: number;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-3">
        <span className="text-sm text-white">{team}</span>
        <span className="text-sm font-bold text-white">{pct}%</span>
      </div>
      <div className="flex items-center gap-2">
        <button className="px-4 py-1.5 rounded-full bg-green-500/15 text-green-400 text-xs font-medium hover:bg-green-500/25 transition-colors">
          Yes {yesCents}¢
        </button>
        <button className="px-4 py-1.5 rounded-full bg-red-500/15 text-red-400 text-xs font-medium hover:bg-red-500/25 transition-colors">
          No {noCents}¢
        </button>
      </div>
    </div>
  );
}


function AnalysisCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</div>
      <div className={`text-sm font-bold mt-0.5 ${color ?? "text-zinc-200"}`}>{value}</div>
    </div>
  );
}


function getTimeToGame(utcStr: string): string {
  const diff = new Date(utcStr).getTime() - Date.now();
  if (diff <= 0) return "Started";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}
