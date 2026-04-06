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

export const api = {
  dashboard: {
    summary: () => fetchJSON<DashboardSummary>("/dashboard/summary"),
  },
  games: {
    today: () => fetchJSON<GameListItem[]>("/games/today"),
    detail: (id: string) => fetchJSON<GameDetailResponse>(`/games/${id}`),
    markets: (id: string) => fetchJSON<GameMarketsResponse>(`/games/${id}/markets`),
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
