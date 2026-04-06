import { useState, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { api } from "../lib/api";
import type { GameAnalysis } from "../lib/api";
import { usePolling } from "../hooks/usePolling";
import { useLivePrices } from "../hooks/useLivePrices";
import type { GameListItem } from "../types/api";
import {
  AlertTriangle, Shield, Clock, Activity, Target, Zap, WifiOff,
} from "lucide-react";

export default function TerminalPage() {
  const [selectedGameId, setSelectedGameId] = useState<string>("");
  const { connected: wsConnected, getGamePrices } = useLivePrices();

  const { data: games } = usePolling(["games-today"], api.games.today, 5_000);
  const { data: analysisData } = usePolling(["analysis-all"], api.analysis.all, 30_000);

  const analyses = analysisData?.analyses ?? [];

  // Auto-select first actionable game
  useEffect(() => {
    if (!selectedGameId && analyses.length > 0) {
      const first = analyses.find(a => a.trade_decision) ?? analyses[0];
      if (first) setSelectedGameId(first.game_id);
    }
  }, [analyses, selectedGameId]);

  const selected = analyses.find(a => a.game_id === selectedGameId);
  const selectedGame = (games ?? []).find(g => g.game_id === selectedGameId);

  return (
    <div className="flex h-full bg-[#0a0a0f] text-zinc-100">
      {/* LEFT: Signal Feed */}
      <div className="w-[320px] shrink-0 border-r border-zinc-800/50 flex flex-col">
        <div className="px-4 py-3 border-b border-zinc-800/50 flex items-center gap-2">
          <Zap size={14} className="text-green-400" />
          <span className="text-xs font-semibold tracking-wider uppercase text-zinc-400">Signal Feed</span>
          <div className="ml-auto flex items-center gap-2">
            {wsConnected ? (
              <div className="flex items-center gap-1">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
                <span className="text-[9px] text-green-500">LIVE</span>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <WifiOff size={10} className="text-zinc-600" />
                <span className="text-[9px] text-zinc-600">OFFLINE</span>
              </div>
            )}
            <span className="text-[10px] text-zinc-600">{analyses.length}</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {analyses.map(a => {
            const lp = getGamePrices(a.game_id);
            return (
              <SignalCard
                key={a.game_id}
                analysis={a}
                game={(games ?? []).find(g => g.game_id === a.game_id)}
                livePrices={lp}
                isSelected={a.game_id === selectedGameId}
                onClick={() => setSelectedGameId(a.game_id)}
              />
            );
          })}
          {analyses.length === 0 && (
            <div className="text-zinc-600 text-xs text-center py-12">
              Loading signals...
            </div>
          )}
        </div>
      </div>

      {/* CENTER: Decision Engine */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <DecisionPanel analysis={selected} gameId={selectedGameId} livePrices={getGamePrices(selectedGameId)} />
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-600">
            Select a game from the signal feed
          </div>
        )}
      </div>

      {/* RIGHT: Execution Panel */}
      <div className="w-[320px] shrink-0 border-l border-zinc-800/50 flex flex-col">
        {selected ? (
          <ExecutionPanel analysis={selected} game={selectedGame} />
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-600 text-xs">
            No game selected
          </div>
        )}
      </div>
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════
   LEFT PANEL — SIGNAL CARD
   ══════════════════════════════════════════════════════════════════════ */

function SignalCard({ analysis: a, game, livePrices, isSelected, onClick }: {
  analysis: GameAnalysis; game?: GameListItem; livePrices: { yes_bid: number; yes_ask: number; team: string }[]; isSelected: boolean; onClick: () => void;
}) {
  // Use live WebSocket prices if available, fall back to analysis data
  const lp0 = livePrices[0];
  const lp1 = livePrices[1];
  const edgeColor = a.edge > 0.06 ? "text-green-400" : a.edge > 0.03 ? "text-yellow-400" : a.edge > 0 ? "text-zinc-400" : "text-red-400";
  const actionColor = a.trade_decision ? (a.direction === "YES" ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400") : "bg-zinc-800 text-zinc-500";
  const action = a.trade_decision ? (a.direction === "YES" ? "BUY" : "SELL") : "SKIP";
  const g = game as any;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-zinc-800/30 transition-all ${
        isSelected ? "bg-zinc-800/40 border-l-2 border-l-green-500" : "hover:bg-zinc-900/50 border-l-2 border-l-transparent"
      }`}
    >
      {/* Row 1: Teams + Action */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[13px] font-medium text-zinc-200 truncate mr-2">
          {a.away_team} <span className="text-zinc-600">@</span> {a.home_team}
        </span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${actionColor}`}>
          {action}
        </span>
      </div>

      {/* Row 2: Edge + Confidence + Phase */}
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-xs font-semibold tabular-nums ${edgeColor}`}>
          {a.edge > 0 ? "+" : ""}{(a.edge * 100).toFixed(1)}%
        </span>
        <span className="text-[10px] text-zinc-600">edge</span>
        <span className={`text-[10px] px-1 rounded ${
          a.confidence_tier === "HIGH" ? "bg-green-500/10 text-green-400" :
          a.confidence_tier === "MED" ? "bg-yellow-500/10 text-yellow-400" :
          "bg-zinc-800 text-zinc-500"
        }`}>
          {a.confidence_tier}
        </span>
        <span className="text-[10px] text-zinc-600 ml-auto">{a.phase.replace("_", " ")}</span>
      </div>

      {/* Row 3: Fair vs Market + Risk tags */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-zinc-500">
          Fair <span className="text-zinc-400">{(a.blended_fair_prob * 100).toFixed(0)}%</span>
          {" "}vs Mkt <span className="text-zinc-400">{(a.market_prob * 100).toFixed(0)}%</span>
        </span>
        {a.risk_alerts.length > 0 && (
          <AlertTriangle size={10} className="text-yellow-500 ml-auto" />
        )}
        {(lp0 || g?.home_pct > 0) && (
          <span className="text-[10px] text-zinc-600 tabular-nums">
            {lp0 ? `${Math.round(lp0.yes_ask * 100)}¢` : `${g?.home_pct}¢`}
            /
            {lp1 ? `${Math.round(lp1.yes_ask * 100)}¢` : `${g?.away_pct}¢`}
          </span>
        )}
      </div>
    </button>
  );
}


/* ══════════════════════════════════════════════════════════════════════
   CENTER PANEL — DECISION ENGINE
   ══════════════════════════════════════════════════════════════════════ */

function DecisionPanel({ analysis: a, gameId, livePrices }: {
  analysis: GameAnalysis; gameId: string;
  livePrices: { yes_bid: number; yes_ask: number; no_bid?: number; no_ask?: number; last_price: number; team: string; ts: string }[];
}) {
  const [period, setPeriod] = useState("1D");
  const { data: priceData } = usePolling(
    ["price-history", gameId, period],
    () => api.games.priceHistory(gameId, period),
    10_000,  // slower polling since WebSocket handles live updates
    { enabled: !!gameId },
  );

  // Append live price point to chart data
  const liveHome = livePrices[0];
  const chartData = [...(priceData?.price_history ?? [])];
  if (liveHome && chartData.length > 0) {
    // Add or update the last point with live data
    const livePoint = {
      time: liveHome.ts,
      yes_price: liveHome.last_price || (liveHome.yes_bid + liveHome.yes_ask) / 2,
      no_price: 1 - (liveHome.last_price || (liveHome.yes_bid + liveHome.yes_ask) / 2),
    };
    // If last chart point is older than live, append
    const lastChart = chartData[chartData.length - 1];
    if (lastChart && new Date(liveHome.ts) > new Date(lastChart.time)) {
      chartData.push(livePoint);
    }
  }

  const isActionable = a.trade_decision;
  const dirColor = a.direction === "YES" ? "text-green-400" : a.direction === "NO" ? "text-red-400" : "text-zinc-500";

  // Live price display
  const liveYesBid = liveHome?.yes_bid ? Math.round(liveHome.yes_bid * 100) : null;
  const liveYesAsk = liveHome?.yes_ask ? Math.round(liveHome.yes_ask * 100) : null;

  return (
    <div className="p-5 max-w-[900px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Decision Engine · {a.phase.replace("_"," ")}</div>
          <h1 className="text-xl font-bold text-white">{a.away_team} at {a.home_team}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Clock size={11} className="text-zinc-500" />
            <span className="text-xs text-zinc-500">{a.time_to_game_hours.toFixed(1)}h to tipoff</span>
          </div>
        </div>
        <div className={`text-right ${isActionable ? "" : "opacity-50"}`}>
          <div className={`text-3xl font-black ${dirColor}`}>{a.direction}</div>
          <div className="text-xs text-zinc-500 mt-0.5">{a.suggested_contracts} contracts @ {a.entry_price_cents}¢</div>
        </div>
      </div>

      {/* Verdict bar */}
      <div className={`rounded-xl p-4 mb-5 ${
        isActionable ? "bg-green-500/5 ring-1 ring-green-500/20" : "bg-zinc-900 ring-1 ring-zinc-800"
      }`}>
        <div className="text-xs font-medium text-zinc-400 mb-1">
          {isActionable ? "📡 SIGNAL ACTIVE" : "— NO SIGNAL"}
        </div>
        <div className="text-sm text-zinc-200">{a.summary}</div>
      </div>

      {/* Price Chart */}
      <div className="bg-zinc-900/40 rounded-xl p-4 mb-5 ring-1 ring-zinc-800/50">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-zinc-500 font-medium">Price History</span>
          <div className="flex gap-0.5 bg-zinc-800/50 rounded-lg p-0.5">
            {(["1D","1W","1M","ALL"] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-2 py-1 rounded text-[10px] font-semibold ${period === p ? "bg-zinc-700 text-white" : "text-zinc-500"}`}>
                {p}
              </button>
            ))}
          </div>
        </div>
        {/* Live price ticker */}
        {liveYesBid != null && (
          <div className="flex items-center gap-3 mb-2 text-[11px]">
            <span className="flex items-center gap-1">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
              </span>
              <span className="text-zinc-500">LIVE</span>
            </span>
            <span className="text-red-400 tabular-nums">{a.home_team} {liveYesBid}/{liveYesAsk}¢</span>
            <span className="text-blue-400 tabular-nums">{a.away_team} {liveHome ? Math.round(liveHome.no_bid! * 100) : "—"}/{liveHome ? Math.round(liveHome.no_ask! * 100) : "—"}¢</span>
            <span className="text-zinc-600 ml-auto">{liveHome?.ts ? new Date(liveHome.ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }) : ""}</span>
          </div>
        )}
        <div className="h-48">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <XAxis dataKey="time" hide />
                <YAxis domain={["auto","auto"]} tickFormatter={v => `${Math.round(v*100)}%`}
                  tick={{ fill: "#3f3f46", fontSize: 9 }} axisLine={false} tickLine={false} width={35} />
                <ReferenceLine y={0.5} stroke="#1f1f23" strokeDasharray="3 3" />
                <Tooltip contentStyle={{ background: "#09090b", border: "1px solid #27272a", borderRadius: 8, fontSize: 11 }}
                  labelFormatter={t => new Date(t as string).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  formatter={(v, name) => [`${Math.round(Number(v)*100)}¢`, name === "yes_price" ? a.home_team : a.away_team]} />
                <Line type="stepAfter" dataKey="yes_price" stroke="#f87171" strokeWidth={2} dot={false}
                  activeDot={{ r: 5, fill: "#f87171", stroke: "#0a0a0f", strokeWidth: 2 }} />
                <Line type="stepAfter" dataKey="no_price" stroke="#60a5fa" strokeWidth={2} dot={false}
                  activeDot={{ r: 5, fill: "#60a5fa", stroke: "#0a0a0f", strokeWidth: 2 }} />
                {/* Pulsing live dot — YES line (red) */}
                <Line type="stepAfter" dataKey="yes_price" stroke="none" dot={(props: any) => {
                  if (props.index !== chartData.length - 1) return <></>;
                  return (
                    <g>
                      <circle cx={props.cx} cy={props.cy} r={6} fill="#f87171" opacity={0.3}>
                        <animate attributeName="r" values="4;8;4" dur="1.5s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.4;0.1;0.4" dur="1.5s" repeatCount="indefinite" />
                      </circle>
                      <circle cx={props.cx} cy={props.cy} r={3} fill="#f87171" />
                    </g>
                  );
                }} />
                {/* Pulsing live dot — NO line (blue) */}
                <Line type="stepAfter" dataKey="no_price" stroke="none" dot={(props: any) => {
                  if (props.index !== chartData.length - 1) return <></>;
                  return (
                    <g>
                      <circle cx={props.cx} cy={props.cy} r={6} fill="#60a5fa" opacity={0.3}>
                        <animate attributeName="r" values="4;8;4" dur="1.5s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.4;0.1;0.4" dur="1.5s" repeatCount="indefinite" />
                      </circle>
                      <circle cx={props.cx} cy={props.cy} r={3} fill="#60a5fa" />
                    </g>
                  );
                }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-700 text-xs">No trades yet</div>
          )}
        </div>
      </div>

      {/* Probability Analysis */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <MetricBox label="Fundamental" value={`${(a.fundamental_prob*100).toFixed(1)}%`} sub="Our estimate" />
        <MetricBox label="Market" value={`${(a.market_prob*100).toFixed(1)}%`} sub="Kalshi implied" />
        <MetricBox label="Blended Fair" value={`${(a.blended_fair_prob*100).toFixed(1)}%`}
          sub={`Edge ${a.edge_pct.toFixed(1)}%`}
          highlight={a.edge > 0.04} />
      </div>

      {/* Edge & EV */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <MetricBox label="Edge" value={`${(a.edge*100).toFixed(1)}%`} color={a.edge > 0.04 ? "text-green-400" : "text-zinc-300"} />
        <MetricBox label="EV / Dollar" value={`${(a.expected_value*100).toFixed(1)}%`} color={a.expected_value > 0 ? "text-green-400" : "text-red-400"} />
        <MetricBox label="Kelly (1/4)" value={`${(a.kelly_quarter*100).toFixed(2)}%`} />
        <MetricBox label="Confidence" value={a.confidence_tier}
          color={a.confidence_tier === "HIGH" ? "text-green-400" : a.confidence_tier === "MED" ? "text-yellow-400" : "text-zinc-500"} />
      </div>

      {/* Exit Zones */}
      {a.take_profit_zones.length > 0 && (
        <div className="bg-zinc-900/40 rounded-xl p-4 mb-5 ring-1 ring-zinc-800/50">
          <div className="text-xs text-zinc-500 font-medium mb-3">Exit Strategy</div>
          <div className="space-y-2">
            {a.take_profit_zones.map((z, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Target size={11} className="text-green-500" />
                  <span className="text-zinc-300">{z.label}</span>
                </div>
                <div className="flex items-center gap-4 tabular-nums">
                  <span className="text-zinc-500">sell {(z.pct*100).toFixed(0)}%</span>
                  <span className="text-zinc-400">at {z.price}¢</span>
                  <span className="text-green-400">+${z.pnl.toFixed(2)}/ct</span>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between text-xs pt-1 border-t border-zinc-800/50">
              <div className="flex items-center gap-2">
                <Shield size={11} className="text-red-500" />
                <span className="text-red-400">Stop Loss</span>
              </div>
              <span className="text-red-400 tabular-nums">at {a.stop_loss_price}¢ (-{a.stop_loss_pct}%)</span>
            </div>
          </div>
        </div>
      )}

      {/* Key Factors */}
      {a.key_factors.length > 0 && (
        <div className="bg-zinc-900/40 rounded-xl p-4 mb-5 ring-1 ring-zinc-800/50">
          <div className="text-xs text-zinc-500 font-medium mb-3">Key Factors</div>
          <div className="space-y-1.5">
            {a.key_factors.map((f, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-zinc-300">{f.factor}</span>
                <span className={f.impact === "strong" ? "text-yellow-400 font-medium" : "text-zinc-400"}>
                  {f.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Risk Alerts */}
      {a.risk_alerts.length > 0 && (
        <div className="bg-yellow-500/5 rounded-xl p-4 ring-1 ring-yellow-500/10">
          <div className="text-xs text-yellow-500 font-medium mb-2">Risk Alerts</div>
          <div className="space-y-1">
            {a.risk_alerts.map((r, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <AlertTriangle size={11} className="text-yellow-500 mt-0.5 shrink-0" />
                <span className="text-zinc-400">{r}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════
   RIGHT PANEL — EXECUTION PANEL
   ══════════════════════════════════════════════════════════════════════ */

function ExecutionPanel({ analysis: a, game }: { analysis: GameAnalysis; game?: GameListItem }) {
  const [quantity, setQuantity] = useState(a.suggested_contracts || 10);
  const [priceCents, setPriceCents] = useState(a.entry_price_cents || 50);
  const [tradeStatus, setTradeStatus] = useState("");

  // Sync with analysis when game changes
  useEffect(() => {
    setQuantity(a.suggested_contracts || 10);
    setPriceCents(a.entry_price_cents || 50);
  }, [a.game_id, a.suggested_contracts, a.entry_price_cents]);

  const totalCost = (priceCents / 100) * quantity;
  const fee = Math.min((100 - priceCents) / 100 * 0.02, 0.02) * quantity;
  const profitIfWin = quantity * (100 - priceCents) / 100 - fee;
  const maxLoss = totalCost;
  const roi = totalCost > 0 ? (profitIfWin / totalCost * 100) : 0;

  const g = game as any;
  const homePct = g?.home_pct || Math.round(a.market_prob * 100);
  const awayPct = g?.away_pct || Math.round((1 - a.market_prob) * 100);

  const executeTrade = async () => {
    // Determine ticker based on direction
    const ticker = a.direction === "YES"
      ? (g?.home_market_ticker || a.game_id + "-HOME")
      : (g?.away_market_ticker || a.game_id + "-AWAY");
    const side = a.direction === "YES" ? "yes" : "no";

    setTradeStatus("executing...");
    try {
      const res = await fetch(
        `http://localhost:8000/api/portfolio/trade?ticker=${ticker}&side=${side}&action=buy&quantity=${quantity}&price_cents=${priceCents}`,
        { method: "POST" },
      );
      const data = await res.json();
      if (data.error) setTradeStatus(data.error);
      else setTradeStatus(`Bought ${quantity} @ ${priceCents}¢`);
    } catch {
      setTradeStatus("Network error");
    }
    setTimeout(() => setTradeStatus(""), 4000);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800/50">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-green-400" />
          <span className="text-xs font-semibold tracking-wider uppercase text-zinc-400">Execute</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Game summary */}
        <div className="bg-zinc-900/50 rounded-xl p-3 ring-1 ring-zinc-800/50">
          <div className="text-sm font-medium text-zinc-200 mb-2">{a.away_team} at {a.home_team}</div>
          <div className="flex items-center justify-between">
            <div className="text-center">
              <div className="text-lg font-bold text-blue-400">{awayPct}%</div>
              <div className="text-[10px] text-zinc-500">{a.away_team}</div>
            </div>
            <div className="text-zinc-700 text-xs">vs</div>
            <div className="text-center">
              <div className="text-lg font-bold text-red-400">{homePct}%</div>
              <div className="text-[10px] text-zinc-500">{a.home_team}</div>
            </div>
          </div>
        </div>

        {/* Direction */}
        <div className={`rounded-xl p-3 text-center ring-1 ${
          a.trade_decision
            ? "bg-green-500/5 ring-green-500/20"
            : "bg-zinc-900 ring-zinc-800"
        }`}>
          <div className="text-[10px] text-zinc-500 mb-1">Recommended</div>
          <div className={`text-lg font-black ${a.direction === "YES" ? "text-green-400" : a.direction === "NO" ? "text-red-400" : "text-zinc-500"}`}>
            {a.trade_decision ? `BUY ${a.direction}` : "NO TRADE"}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">{a.home_team} {a.direction === "YES" ? "wins" : "loses"}</div>
        </div>

        {/* Contracts */}
        <div className="bg-zinc-900/50 rounded-xl p-3 ring-1 ring-zinc-800/50">
          <div className="text-[10px] text-zinc-500 mb-2">Contracts</div>
          <div className="flex gap-1 flex-wrap">
            {[5, 10, 25, 50, 100, a.suggested_contracts].filter((v, i, a) => a.indexOf(v) === i).map(q => (
              <button key={q} onClick={() => setQuantity(q)}
                className={`px-2 py-1 rounded-lg text-[11px] font-medium ${quantity === q ? "bg-green-500/20 text-green-400 ring-1 ring-green-500/30" : "bg-zinc-800 text-zinc-500"}`}>
                {q}{q === a.suggested_contracts ? "*" : ""}
              </button>
            ))}
          </div>
        </div>

        {/* Price */}
        <div className="bg-zinc-900/50 rounded-xl p-3 ring-1 ring-zinc-800/50">
          <div className="flex justify-between mb-2">
            <span className="text-[10px] text-zinc-500">Price</span>
            <button onClick={() => setPriceCents(a.entry_price_cents)}
              className="text-[10px] text-green-500 hover:text-green-400">Market</button>
          </div>
          <div className="flex items-center gap-2">
            <input type="number" value={priceCents} onChange={e => setPriceCents(Math.max(1, Math.min(99, parseInt(e.target.value) || 1)))}
              className="flex-1 bg-zinc-800 ring-1 ring-zinc-700 rounded-lg px-3 py-2 text-sm text-white text-center focus:ring-green-500/50 focus:outline-none" min={1} max={99} />
            <span className="text-xs text-zinc-500">¢</span>
          </div>
          <div className="flex justify-between text-[10px] text-zinc-600 mt-1">
            <span>Bid: {a.entry_price_cents > 0 ? a.entry_price_cents - 1 : 0}¢</span>
            <span>Ask: {a.entry_price_cents}¢</span>
          </div>
        </div>

        {/* P&L Summary */}
        <div className="bg-zinc-900/50 rounded-xl p-3 ring-1 ring-zinc-800/50 space-y-1.5">
          <PnlRow label="Total cost" value={`$${totalCost.toFixed(2)}`} bold />
          <PnlRow label="Fee (est.)" value={`$${fee.toFixed(2)}`} dim />
          <div className="border-t border-zinc-800/50 pt-1.5 mt-1.5" />
          <PnlRow label="If correct" value={`+$${profitIfWin.toFixed(2)}`} color="text-green-400" />
          <PnlRow label="If wrong" value={`-$${maxLoss.toFixed(2)}`} color="text-red-400" />
          <PnlRow label="ROI if win" value={`+${roi.toFixed(0)}%`} color="text-green-400" />
        </div>

        {/* Hedge info */}
        {a.hedge.should_hedge && (
          <div className="bg-yellow-500/5 rounded-xl p-3 ring-1 ring-yellow-500/10">
            <div className="text-[10px] text-yellow-500 font-medium mb-1">Hedge Suggested</div>
            <div className="text-xs text-zinc-400">{a.hedge.reason}</div>
            <div className="text-[10px] text-zinc-500 mt-1">
              Buy {a.hedge.side} {(a.hedge.size_pct*100).toFixed(0)}% at {(a.hedge.price*100).toFixed(0)}¢
            </div>
          </div>
        )}
      </div>

      {/* Execute button — pinned bottom */}
      <div className="p-4 border-t border-zinc-800/50">
        <button onClick={executeTrade} disabled={!a.trade_decision || priceCents <= 0}
          className={`w-full py-3.5 rounded-xl font-semibold text-sm transition-all active:scale-[0.98] ${
            a.trade_decision
              ? "bg-green-500 hover:bg-green-400 text-black shadow-lg shadow-green-500/20"
              : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
          }`}>
          {a.trade_decision ? `Buy ${quantity} × ${a.direction} @ ${priceCents}¢` : "No Signal"}
        </button>
        {tradeStatus && (
          <div className={`mt-2 text-[11px] text-center py-1.5 rounded-lg ${
            tradeStatus.includes("error") ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400"
          }`}>{tradeStatus}</div>
        )}
      </div>
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════
   SHARED COMPONENTS
   ══════════════════════════════════════════════════════════════════════ */

function MetricBox({ label, value, sub, color, highlight }: {
  label: string; value: string; sub?: string; color?: string; highlight?: boolean;
}) {
  return (
    <div className={`rounded-xl p-3 ring-1 ${highlight ? "bg-green-500/5 ring-green-500/20" : "bg-zinc-900/40 ring-zinc-800/50"}`}>
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-bold mt-0.5 tabular-nums ${color ?? "text-zinc-100"}`}>{value}</div>
      {sub && <div className="text-[10px] text-zinc-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function PnlRow({ label, value, color, bold, dim }: {
  label: string; value: string; color?: string; bold?: boolean; dim?: boolean;
}) {
  return (
    <div className="flex justify-between text-xs">
      <span className={dim ? "text-zinc-600" : "text-zinc-500"}>{label}</span>
      <span className={`tabular-nums ${color ?? "text-zinc-200"} ${bold ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}
