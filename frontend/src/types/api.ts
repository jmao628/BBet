/* ------------------------------------------------------------------ */
/* API response types — mirrors src/api/schemas.py exactly             */
/* ------------------------------------------------------------------ */

// Shared primitives
export interface ProbabilityBreakdown {
  sportsbook_novig: number | null;
  model_raw: number | null;
  model_calibrated: number | null;
  market_mid: number | null;
  ensemble_fair: number | null;
  ci_lower: number | null;
  ci_upper: number | null;
  weights: Record<string, number>;
}

export interface DecisionMetrics {
  direction: "YES" | "NO" | "SKIP";
  edge: number;
  expected_value: number;
  kelly_full: number;
  kelly_suggested: number;
  suggested_size_usd: number | null;
  max_size_usd: number | null;
}

export interface ConfidenceInfo {
  score: number;
  tier: "HIGH" | "MED" | "LOW";
  model_disagreement: number;
}

export interface RiskFlag {
  flag: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  note: string;
}

export interface KeyDriver {
  factor: string;
  raw_value: number;
  impact: number;
}

export interface FilterGate {
  gate_name: string;
  threshold: string;
  actual_value: string;
  passed: boolean;
}

// Dashboard
export interface DashboardSummary {
  today_date: string;
  total_games_today: number;
  games_with_markets: number;
  active_signals: number;
  actionable_signals: number;
  skipped_signals: number;
  best_edge: number | null;
  best_edge_game: string | null;
  avg_edge: number | null;
  total_exposure_usd: number;
  daily_risk_pct: number;
  system_healthy: boolean;
  data_sources_ok: number;
  data_sources_total: number;
  last_refresh: string | null;
}

export interface GameListItem {
  game_id: string;
  game_date: string;
  game_time_utc: string;
  home_team: string;
  away_team: string;
  venue: string | null;
  season_type: string;
  is_b2b_home: boolean;
  is_b2b_away: boolean;
  has_signal: boolean;
  signal_direction: string | null;
  signal_edge: number | null;
  signal_confidence_tier: string | null;
  n_markets: number;
}

// Game Detail
export interface TeamStats {
  team_abbr: string;
  off_rating: number;
  def_rating: number;
  net_rating: number;
  pace: number;
  efg_pct: number;
  ts_pct: number;
  tov_pct: number;
  orb_pct: number;
  drb_pct: number;
  last3_net: number;
  last5_net: number;
  last10_net: number;
  home_net: number;
  road_net: number;
  elo: number;
  win_streak: number;
  rest_days: number;
  is_b2b: boolean;
  injury_impact: number;
}

export interface InjuryDetail {
  player_name: string;
  status: string;
  injury_type: string | null;
  bpm: number;
  usg_pct: number;
  impact_weight: number;
  is_star: boolean;
}

export interface MarketContractInfo {
  contract_id: string;
  platform: string;
  market_type: string;
  question: string;
  outcome: string;
  status: string;
  yes_bid: number;
  yes_ask: number;
  yes_mid: number;
  spread: number;
  volume_24h: number | null;
  open_interest: number | null;
  fee_pct: number;
}

export interface OrderbookLevel {
  price: number;
  size: number;
}

export interface OrderbookData {
  contract_id: string;
  snapshot_time: string;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  best_bid: number;
  best_ask: number;
  depth_3c_bid: number;
  depth_3c_ask: number;
  imbalance: number;
}

export interface PricePoint {
  time: string;
  yes_mid: number;
  yes_bid: number | null;
  yes_ask: number | null;
  volume: number | null;
}

export interface GameDetailResponse {
  game_id: string;
  game_date: string;
  game_time_utc: string;
  home_team: string;
  away_team: string;
  venue: string | null;
  season_type: string;
  series_info: string | null;
  home_stats: TeamStats;
  away_stats: TeamStats;
  home_injuries: InjuryDetail[];
  away_injuries: InjuryDetail[];
  markets: MarketContractInfo[];
  probability: ProbabilityBreakdown | null;
  decision: DecisionMetrics | null;
  confidence: ConfidenceInfo | null;
  key_drivers: KeyDriver[];
  risk_flags: RiskFlag[];
  filter_gates: FilterGate[];
  is_actionable: boolean;
  skip_reason: string | null;
}

export interface GameMarketsResponse {
  game_id: string;
  contracts: MarketContractInfo[];
  orderbooks: Record<string, OrderbookData>;
  price_history: Record<string, PricePoint[]>;
}

// Signals
export interface SignalListItem {
  signal_id: string;
  game_id: string;
  home_team: string;
  away_team: string;
  game_time_utc: string;
  platform: string;
  market_type: string;
  direction: string;
  edge: number;
  expected_value: number;
  confidence_score: number;
  confidence_tier: string;
  fair_prob: number | null;
  market_mid: number | null;
  kelly_suggested: number;
  suggested_size_usd: number | null;
  liquidity_score: number;
  is_actionable: boolean;
  skip_reason: string | null;
  n_risk_flags: number;
  signal_time: string;
}

export interface SignalsListResponse {
  signals: SignalListItem[];
  total: number;
  actionable_count: number;
  skipped_count: number;
}

// Backtest
export interface BacktestSummary {
  run_id: string;
  run_name: string;
  start_date: string;
  end_date: string;
  model_version: string;
  total_signals: number;
  signals_executed: number;
  hit_rate: number;
  roi_pct: number;
  total_pnl_usd: number;
  sharpe_ratio: number;
  max_drawdown_pct: number;
  avg_hold_hours: number;
  avg_edge: number | null;
  by_confidence: Record<string, unknown> | null;
  by_market_type: Record<string, unknown> | null;
}

export interface EquityPoint {
  date: string;
  cumulative_pnl: number;
  capital: number;
  drawdown: number;
  n_trades: number;
}

export interface BacktestEquityResponse {
  run_id: string;
  initial_capital: number;
  equity_curve: EquityPoint[];
  summary: BacktestSummary;
}

// Risk
export interface ExposureEntry {
  label: string;
  exposure_usd: number;
  limit_usd: number;
  utilization_pct: number;
}

export interface RiskExposureResponse {
  bankroll_usd: number;
  daily_risk_used_usd: number;
  daily_risk_limit_usd: number;
  daily_utilization_pct: number;
  by_game: ExposureEntry[];
  by_team: ExposureEntry[];
  by_series: ExposureEntry[];
  open_positions: number;
  risk_rule_hits: Record<string, unknown>[];
}

// Monitoring
export interface DataSourceStatus {
  source: string;
  status: "ok" | "stale" | "error";
  last_sync: string | null;
  staleness_minutes: number | null;
  threshold_minutes: number;
  records_last_sync: number | null;
  error_message: string | null;
}

export interface HealthResponse {
  overall_status: "healthy" | "degraded" | "critical";
  timestamp: string;
  data_sources: DataSourceStatus[];
  model_version: string;
  db_connected: boolean;
  redis_connected: boolean;
  uptime_seconds: number | null;
}

export interface AlertEntry {
  alert_id: string;
  alert_type: string;
  severity: string;
  message: string;
  details: Record<string, unknown>;
  created_at: string;
  acknowledged: boolean;
}

export interface AlertsResponse {
  alerts: AlertEntry[];
  total: number;
  unacknowledged: number;
}
