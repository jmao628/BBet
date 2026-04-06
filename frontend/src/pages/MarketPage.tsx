import { useState, useCallback, useEffect } from "react";
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

// Kalshi fee structure: 2% on profits, capped at 2¢ per contract
const KALSHI_FEE_RATE = 0.02;
const KALSHI_FEE_CAP_CENTS = 2;

function calcFee(priceCents: number, quantity: number): number {
  // Fee = min(2% of potential profit, 2¢) per contract
  const potentialProfit = (100 - priceCents) / 100; // profit per contract if win
  const feePerContract = Math.min(potentialProfit * KALSHI_FEE_RATE, KALSHI_FEE_CAP_CENTS / 100);
  return feePerContract * quantity;
}

export default function MarketPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const [period, setPeriod] = useState<string>("1D");
  const [buyTab, setBuyTab] = useState<"buy" | "sell">("buy");
  const [selectedSide, setSelectedSide] = useState<"yes" | "no">("yes");
  const [quantity, setQuantity] = useState<number>(10);
  const [limitPrice, setLimitPrice] = useState<number>(0);
  const [tradeStatus, setTradeStatus] = useState<string>("");
  const [countdown, setCountdown] = useState<string>("");

  const { data: priceData, refetch: refetchPrice } = usePolling(
    ["price-history", gameId!, period],
    () => api.games.priceHistory(gameId!, period),
    3_000,
    { enabled: !!gameId },
  );

  const { data: gameDetail, refetch: refetchGame } = usePolling(
    ["game-detail", gameId!],
    () => api.games.detail(gameId!),
    3_000,
    { enabled: !!gameId },
  );

  // Live countdown timer
  useEffect(() => {
    const gameTime = priceData?.game_time_utc;
    if (!gameTime) return;
    const interval = setInterval(() => {
      const diff = new Date(gameTime).getTime() - Date.now();
      if (diff <= 0) { setCountdown("LIVE"); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdown(`${h}h ${m}m ${s}s`);
    }, 1000);
    return () => clearInterval(interval);
  }, [priceData?.game_time_utc]);

  const market0 = (gameDetail as any)?.markets?.[0]; // first outcome (usually home)
  const market1 = (gameDetail as any)?.markets?.[1]; // second outcome (usually away)

  // Team names from market sub_titles (most accurate from Kalshi)
  const homeTeam = market0?.team_name || priceData?.home_team || (gameDetail as any)?.home_team || "";
  const awayTeam = market1?.team_name || priceData?.away_team || (gameDetail as any)?.away_team || "";

  // Real-time prices — direct from Kalshi NBBO (dollars)
  const homeBid = market0?.yes_bid ?? 0;
  const homeAsk = market0?.yes_ask ?? 0;
  const homeNoBid = market0?.no_bid ?? 0;
  const homeNoAsk = market0?.no_ask ?? 0;

  const awayAsk = market1?.yes_ask ?? 0;
  const awayNoAsk = market1?.no_ask ?? 0;

  // Auto-sync price to market — use correct Kalshi NBBO
  // YES side uses market0 (home outcome), NO side uses market0's NO prices
  const selectedAsk = selectedSide === "yes" ? homeAsk : homeNoAsk;
  const selectedBid = selectedSide === "yes" ? homeBid : homeNoBid;
  const autoPrice = Math.round((buyTab === "buy" ? selectedAsk : selectedBid) * 100);
  const priceCents = limitPrice || autoPrice || 50;

  // Kalshi contract math
  const totalCost = (priceCents / 100) * quantity;
  const fee = calcFee(priceCents, quantity);
  const potentialPayout = quantity * 1.0; // each contract pays $1 if correct
  const netProfit = potentialPayout - totalCost - fee;
  const maxLoss = totalCost;
  const returnPct = totalCost > 0 ? (netProfit / totalCost) * 100 : 0;

  // Chart data
  const homePct = priceData?.home_pct ?? Math.round((market0?.yes_mid ?? 0.5) * 100);
  const awayPct = priceData?.away_pct ?? Math.round((market1?.yes_mid ?? 0.5) * 100);

  const executeTrade = useCallback(async () => {
    if (!market0?.ticker || priceCents <= 0 || quantity <= 0) return;
    const ticker = selectedSide === "yes" ? market0?.ticker : market1?.ticker;
    if (!ticker) return;
    setTradeStatus("executing...");
    try {
      const res = await fetch(
        `http://localhost:8000/api/portfolio/trade?ticker=${ticker}&side=${selectedSide}&action=${buyTab}&quantity=${quantity}&price_cents=${priceCents}`,
        { method: "POST" },
      );
      const data = await res.json();
      if (data.error) {
        setTradeStatus(`${data.error}`);
      } else {
        setTradeStatus(`${buyTab === "buy" ? "Bought" : "Sold"} ${quantity} contracts at ${priceCents}¢`);
        refetchPrice();
        refetchGame();
      }
    } catch {
      setTradeStatus("Network error");
    }
    setTimeout(() => setTradeStatus(""), 4000);
  }, [market0, market1, selectedSide, buyTab, quantity, priceCents, refetchPrice, refetchGame]);

  if (!gameDetail) {
    return <div className="flex h-full items-center justify-center"><div className="text-zinc-600">Loading...</div></div>;
  }

  const title = (gameDetail as any)?.title || `${awayTeam} at ${homeTeam}`;
  const league = (gameDetail as any)?.league || "NBA";
  const totalVolume = (market0?.volume ?? 0) + (market1?.volume ?? 0);
  const volume24h = (market0?.volume_24h ?? 0) + (market1?.volume_24h ?? 0);

  return (
    <div className="flex h-full">
      {/* ── Main chart area ─────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <div className="px-6 pt-5 pb-6 max-w-[1000px]">

          {/* Header */}
          <div className="flex items-start gap-4 mb-1">
            <Link to="/" className="text-zinc-500 hover:text-white mt-2 transition-colors">
              <ArrowLeft size={20} />
            </Link>
            <div className="flex-1">
              <div className="text-xs text-zinc-500 tracking-wide">
                Sports · Basketball · {league}
              </div>
              <h1 className="text-2xl font-bold text-white mt-1">{title}</h1>
              <div className="flex items-center gap-3 mt-2 text-xs text-zinc-500">
                <span className={countdown === "LIVE" ? "text-green-400 font-medium" : ""}>
                  {countdown === "LIVE" ? "● LIVE" : `Begins in ${countdown || "—"}`}
                </span>
                <span>·</span>
                <span>
                  {priceData?.game_time_utc
                    ? new Date(priceData.game_time_utc).toLocaleString("en-US", {
                        month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
                      })
                    : "—"}
                </span>
              </div>
            </div>
          </div>

          {/* ── Price chart ──────────────────────────────── */}
          <div className="mt-6 h-80 bg-zinc-900/30 rounded-xl p-3">
            {priceData && priceData.price_history.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={priceData.price_history} margin={{ top: 10, right: 60, bottom: 5, left: 5 }}>
                  <XAxis
                    dataKey="time"
                    tickFormatter={(t) => {
                      const d = new Date(t);
                      return period === "1D"
                        ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                        : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                    }}
                    tick={{ fill: "#52525b", fontSize: 10 }}
                    axisLine={{ stroke: "#27272a" }}
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={80}
                  />
                  <YAxis
                    domain={["auto", "auto"]}
                    tickFormatter={(v) => `${Math.round(v * 100)}%`}
                    tick={{ fill: "#52525b", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                  />
                  <ReferenceLine y={0.5} stroke="#27272a" strokeDasharray="4 4" />
                  <Tooltip
                    contentStyle={{ background: "#09090b", border: "1px solid #27272a", borderRadius: 10, padding: "8px 12px", fontSize: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
                    labelFormatter={(t) => new Date(t as string).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" })}
                    formatter={(v, name) => [`${Math.round(Number(v) * 100)}¢`, name === "yes_price" ? homeTeam : awayTeam]}
                  />
                  <Line type="stepAfter" dataKey="yes_price" stroke="#f87171" strokeWidth={2} dot={false} name="yes_price" />
                  <Line type="stepAfter" dataKey="no_price" stroke="#60a5fa" strokeWidth={2} dot={false} name="no_price" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
                Waiting for trade data...
              </div>
            )}
          </div>

          {/* Team labels with live percentages */}
          <div className="flex items-center justify-end gap-6 mt-3 mr-4">
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 bg-red-400 rounded" />
              <span className="text-xs font-semibold text-red-400">{homeTeam}</span>
              <span className="text-lg font-bold text-red-400">{homePct}%</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 bg-blue-400 rounded" />
              <span className="text-xs font-semibold text-blue-400">{awayTeam}</span>
              <span className="text-lg font-bold text-blue-400">{awayPct}%</span>
            </div>
          </div>

          {/* Volume + period selector */}
          <div className="flex items-center justify-between py-4 border-b border-zinc-800/60 mt-2">
            <span className="text-sm text-zinc-500 font-medium">
              ${totalVolume.toLocaleString()} vol
              {volume24h > 0 && <span className="text-zinc-600 ml-2">(${volume24h.toLocaleString()} 24h)</span>}
            </span>
            <div className="flex items-center gap-0.5 bg-zinc-900 rounded-lg p-0.5">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${period === p ? "bg-zinc-700 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-300"}`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* ── Chance table ──────────────────────────────── */}
          <div className="pt-4 pb-2">
            <div className="text-sm text-zinc-400 font-medium mb-4">Chance</div>
            <ChanceRow team={homeTeam} pct={homePct}
              yesAskCents={Math.round(homeAsk * 100)}
              noAskCents={Math.round(homeNoAsk * 100)}
              color="red" />
            <ChanceRow team={awayTeam} pct={awayPct}
              yesAskCents={Math.round(awayAsk * 100)}
              noAskCents={Math.round(awayNoAsk * 100)}
              color="blue" />
          </div>

          {/* Orderbook depth */}
          <div className="border-t border-zinc-800/60 pt-4 pb-4">
            <div className="text-xs text-zinc-500 mb-3">Depth</div>
            <div className="grid grid-cols-2 gap-6">
              <DepthCard team={homeTeam} yesDepth={market0?.yes_depth} noDepth={market0?.no_depth} />
              <DepthCard team={awayTeam} yesDepth={market1?.yes_depth} noDepth={market1?.no_depth} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Right sidebar: Trade panel ─────────────────────── */}
      <div className="w-[340px] shrink-0 border-l border-zinc-800 bg-zinc-950 flex flex-col">
        <div className="p-5 flex-1 overflow-y-auto">

          {/* Title */}
          <div className="text-sm font-medium text-zinc-200 mb-0.5">{title}</div>
          <div className="text-xs mb-5">
            <span className={buyTab === "buy" ? "text-green-400" : "text-red-400"}>
              {buyTab === "buy" ? "Buy" : "Sell"} {selectedSide.toUpperCase()}
            </span>
            <span className="text-zinc-600"> · </span>
            <span className="text-zinc-300">{selectedSide === "yes" ? homeTeam : awayTeam}</span>
          </div>

          {/* Buy / Sell tabs */}
          <div className="flex gap-2 mb-5">
            <button onClick={() => setBuyTab("buy")}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${buyTab === "buy" ? "bg-green-600 text-white shadow-lg shadow-green-600/20" : "bg-zinc-800/80 text-zinc-400 hover:bg-zinc-700"}`}>
              Buy
            </button>
            <button onClick={() => setBuyTab("sell")}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${buyTab === "sell" ? "bg-red-600 text-white shadow-lg shadow-red-600/20" : "bg-zinc-800/80 text-zinc-400 hover:bg-zinc-700"}`}>
              Sell
            </button>
          </div>

          {/* Yes / No — prices from Kalshi NBBO */}
          <div className="flex gap-2 mb-5">
            <button onClick={() => { setSelectedSide("yes"); setLimitPrice(0); }}
              className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${selectedSide === "yes" ? "bg-green-500/15 text-green-400 ring-2 ring-green-500/60" : "bg-zinc-800/60 text-zinc-500 ring-1 ring-zinc-700 hover:ring-zinc-600"}`}>
              Yes {Math.round(homeAsk * 100)}¢
            </button>
            <button onClick={() => { setSelectedSide("no"); setLimitPrice(0); }}
              className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${selectedSide === "no" ? "bg-red-500/15 text-red-400 ring-2 ring-red-500/60" : "bg-zinc-800/60 text-zinc-500 ring-1 ring-zinc-700 hover:ring-zinc-600"}`}>
              No {Math.round(homeNoAsk * 100)}¢
            </button>
          </div>

          {/* Contracts */}
          <div className="bg-zinc-900/60 ring-1 ring-zinc-800 rounded-xl p-4 mb-4">
            <div className="text-xs text-zinc-500 mb-2.5">Contracts</div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {[1, 5, 10, 25, 50, 100].map(q => (
                <button key={q} onClick={() => setQuantity(q)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${quantity === q ? "bg-zinc-600 text-white" : "bg-zinc-800/80 text-zinc-500 hover:text-zinc-300"}`}>
                  {q}
                </button>
              ))}
              <input type="number" value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-16 bg-zinc-800/80 ring-1 ring-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white text-center focus:ring-green-500/50 focus:outline-none transition-all"
                min={1} />
            </div>
          </div>

          {/* Price input */}
          <div className="bg-zinc-900/60 ring-1 ring-zinc-800 rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs text-zinc-500">Price</span>
              <button onClick={() => setLimitPrice(0)} className="text-[10px] text-green-500 hover:text-green-400">
                Market
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input type="number" value={limitPrice || priceCents}
                onChange={(e) => setLimitPrice(Math.max(1, Math.min(99, parseInt(e.target.value) || 1)))}
                className="flex-1 bg-zinc-800/80 ring-1 ring-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white text-center focus:ring-green-500/50 focus:outline-none transition-all"
                min={1} max={99} />
              <span className="text-sm text-zinc-500 font-medium">¢</span>
            </div>
            <div className="flex justify-between text-[10px] text-zinc-600 mt-2">
              <span>Bid: {Math.round(selectedBid * 100)}¢</span>
              <span>Ask: {Math.round(selectedAsk * 100)}¢</span>
            </div>
          </div>

          {/* Cost breakdown — Kalshi contract math */}
          <div className="bg-zinc-900/60 ring-1 ring-zinc-800 rounded-xl p-4 mb-5 space-y-2">
            <Row label={buyTab === "buy" ? "Total cost" : "Revenue"} value={`$${totalCost.toFixed(2)}`} bold />
            <Row label="Transaction fee" value={`$${fee.toFixed(2)}`} dim />
            <div className="border-t border-zinc-800/60 pt-2 mt-2">
              <Row label={`If ${selectedSide.toUpperCase()} wins`} value={`+$${netProfit.toFixed(2)}`} color="text-green-400" />
              <Row label={`If ${selectedSide.toUpperCase()} loses`} value={`-$${maxLoss.toFixed(2)}`} color="text-red-400" />
            </div>
            <div className="border-t border-zinc-800/60 pt-2">
              <Row label="Payout if correct" value={`$${potentialPayout.toFixed(2)}`} />
              <Row label="Return on investment" value={`${returnPct > 0 ? "+" : ""}${returnPct.toFixed(0)}%`} color={returnPct >= 0 ? "text-green-400" : "text-red-400"} />
            </div>
          </div>

          {/* Execute button */}
          <button onClick={executeTrade} disabled={priceCents <= 0}
            className={`w-full py-4 font-semibold rounded-xl transition-all text-sm ${
              buyTab === "buy"
                ? "bg-green-500 hover:bg-green-400 text-black shadow-lg shadow-green-500/20"
                : "bg-red-500 hover:bg-red-400 text-white shadow-lg shadow-red-500/20"
            } disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.98]`}>
            {buyTab === "buy" ? "Buy" : "Sell"} {quantity} × {selectedSide.toUpperCase()} at {priceCents}¢
          </button>

          {tradeStatus && (
            <div className={`mt-3 text-xs text-center py-2.5 rounded-lg font-medium ${
              tradeStatus.includes("error") || tradeStatus.includes("insufficient")
                ? "bg-red-500/10 text-red-400 ring-1 ring-red-500/20"
                : "bg-green-500/10 text-green-400 ring-1 ring-green-500/20"
            }`}>
              {tradeStatus}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, color, bold, dim }: { label: string; value: string; color?: string; bold?: boolean; dim?: boolean }) {
  return (
    <div className="flex justify-between text-xs py-0.5">
      <span className={dim ? "text-zinc-600" : "text-zinc-500"}>{label}</span>
      <span className={`${color ?? "text-zinc-200"} ${bold ? "font-semibold" : ""} tabular-nums`}>{value}</span>
    </div>
  );
}

function ChanceRow({ team, pct, yesAskCents, noAskCents, color }: {
  team: string; pct: number; yesAskCents: number; noAskCents: number; color: "red" | "blue";
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-zinc-800/40">
      <div className="flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full ${color === "red" ? "bg-red-400" : "bg-blue-400"}`} />
        <span className="text-sm text-white font-medium">{team}</span>
        <span className={`text-sm font-bold ${color === "red" ? "text-red-400" : "text-blue-400"}`}>{pct}%</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="px-4 py-1.5 rounded-full bg-green-500/10 text-green-400 text-xs font-semibold ring-1 ring-green-500/20">
          Yes {yesAskCents}¢
        </span>
        <span className="px-4 py-1.5 rounded-full bg-red-500/10 text-red-400 text-xs font-semibold ring-1 ring-red-500/20">
          No {noAskCents}¢
        </span>
      </div>
    </div>
  );
}

function DepthCard({ team, yesDepth, noDepth }: { team: string; yesDepth?: number; noDepth?: number }) {
  return (
    <div className="bg-zinc-900/40 rounded-lg p-3">
      <div className="text-xs text-zinc-400 font-medium mb-2">{team}</div>
      <div className="flex justify-between text-[10px]">
        <span className="text-zinc-600">YES: <span className="text-zinc-400">${(yesDepth ?? 0).toLocaleString()}</span></span>
        <span className="text-zinc-600">NO: <span className="text-zinc-400">${(noDepth ?? 0).toLocaleString()}</span></span>
      </div>
    </div>
  );
}
