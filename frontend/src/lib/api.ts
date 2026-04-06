const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000/api";

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

/* ---------- Dashboard ---------- */
import type {
  DashboardSummary,
  GameListItem,
  GameDetailResponse,
  GameMarketsResponse,
  SignalsListResponse,
  BacktestSummary,
  BacktestEquityResponse,
  RiskExposureResponse,
  HealthResponse,
  AlertsResponse,
} from "../types/api";

// New types for Robinhood/Kalshi style pages
export interface PortfolioData {
  total_value: number;
  buying_power: number;
  change: number;
  change_pct: number;
  period: string;
  equity_curve: { time: string; value: number }[];
}

export interface PositionItem {
  id: string;
  ticker: string;
  game_id: string;
  home_team: string;
  away_team: string;
  game_time_utc: string;
  side: string;
  team_bet: string;
  entry_price: number;
  current_price: number;
  quantity: number;
  cost: number;
  current_value: number;
  pnl: number;
  pnl_pct: number;
  market_question: string;
  opened_at: string;
}

export interface PriceHistoryData {
  game_id: string;
  home_team: string;
  away_team: string;
  game_time_utc: string;
  question: string;
  yes_price: number;
  no_price: number;
  home_pct: number;
  away_pct: number;
  volume: number;
  period: string;
  price_history: { time: string; yes_price: number; no_price: number }[];
}

export const api = {
  dashboard: {
    summary: () => fetchJSON<DashboardSummary>("/dashboard/summary"),
  },
  portfolio: {
    get: (period = "1W") => fetchJSON<PortfolioData>(`/portfolio?period=${period}`),
    positions: () => fetchJSON<{ positions: PositionItem[]; total_positions: number }>("/portfolio/positions"),
  },
  games: {
    today: () => fetchJSON<GameListItem[]>("/games/today"),
    detail: (id: string) => fetchJSON<GameDetailResponse>(`/games/${id}`),
    markets: (id: string) => fetchJSON<GameMarketsResponse>(`/games/${id}/markets`),
    priceHistory: (id: string, period = "1D") => fetchJSON<PriceHistoryData>(`/games/${id}/price_history?period=${period}`),
  },
  signals: {
    list: (params?: Record<string, string>) => {
      const qs = params ? "?" + new URLSearchParams(params).toString() : "";
      return fetchJSON<SignalsListResponse>(`/signals${qs}`);
    },
  },
  backtest: {
    summary: () => fetchJSON<BacktestSummary[]>("/backtest/summary"),
    equity: (runId: string) =>
      fetchJSON<BacktestEquityResponse>(`/backtest/${runId}/equity`),
  },
  risk: {
    exposure: () => fetchJSON<RiskExposureResponse>("/risk/exposure"),
  },
  monitoring: {
    health: () => fetchJSON<HealthResponse>("/monitoring/health"),
    alerts: () => fetchJSON<AlertsResponse>("/monitoring/alerts"),
  },
};
