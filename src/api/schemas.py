"""
Pydantic response schemas for the terminal API.
Maps directly to frontend component data needs.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Shared primitives
# ---------------------------------------------------------------------------

class ProbabilityBreakdown(BaseModel):
    sportsbook_novig: float | None = None
    model_raw: float | None = None
    model_calibrated: float | None = None
    market_mid: float | None = None
    ensemble_fair: float | None = None
    ci_lower: float | None = None
    ci_upper: float | None = None
    weights: dict[str, float] = Field(default_factory=dict)


class DecisionMetrics(BaseModel):
    direction: str  # YES / NO / SKIP
    edge: float
    expected_value: float
    kelly_full: float
    kelly_suggested: float
    suggested_size_usd: float | None = None
    max_size_usd: float | None = None


class ConfidenceInfo(BaseModel):
    score: float
    tier: str  # HIGH / MED / LOW
    model_disagreement: float


class RiskFlag(BaseModel):
    flag: str
    severity: str  # HIGH / MEDIUM / LOW
    note: str


class KeyDriver(BaseModel):
    factor: str
    raw_value: float
    impact: float


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

class DashboardSummary(BaseModel):
    today_date: date
    total_games_today: int
    games_with_markets: int
    active_signals: int
    actionable_signals: int
    skipped_signals: int
    best_edge: float | None = None
    best_edge_game: str | None = None
    avg_edge: float | None = None
    total_exposure_usd: float
    daily_risk_pct: float
    system_healthy: bool
    data_sources_ok: int
    data_sources_total: int
    last_refresh: datetime | None = None


class GameListItem(BaseModel):
    game_id: str
    game_date: date
    game_time_utc: datetime
    home_team: str
    away_team: str
    venue: str | None = None
    season_type: str
    is_b2b_home: bool = False
    is_b2b_away: bool = False
    has_signal: bool = False
    signal_direction: str | None = None
    signal_edge: float | None = None
    signal_confidence_tier: str | None = None
    n_markets: int = 0


# ---------------------------------------------------------------------------
# Game Detail
# ---------------------------------------------------------------------------

class TeamStats(BaseModel):
    team_abbr: str
    off_rating: float
    def_rating: float
    net_rating: float
    pace: float
    efg_pct: float
    ts_pct: float
    tov_pct: float
    orb_pct: float
    drb_pct: float
    last3_net: float
    last5_net: float
    last10_net: float
    home_net: float
    road_net: float
    elo: float
    win_streak: int
    rest_days: int
    is_b2b: bool
    injury_impact: float


class InjuryDetail(BaseModel):
    player_name: str
    status: str
    injury_type: str | None = None
    bpm: float
    usg_pct: float
    impact_weight: float
    is_star: bool = False


class MarketContractInfo(BaseModel):
    contract_id: str
    platform: str
    market_type: str
    question: str
    outcome: str
    status: str
    yes_bid: float
    yes_ask: float
    yes_mid: float
    spread: float
    volume_24h: float | None = None
    open_interest: float | None = None
    fee_pct: float


class OrderbookLevel(BaseModel):
    price: float
    size: float


class OrderbookData(BaseModel):
    contract_id: str
    snapshot_time: datetime
    bids: list[OrderbookLevel]
    asks: list[OrderbookLevel]
    best_bid: float
    best_ask: float
    depth_3c_bid: float
    depth_3c_ask: float
    imbalance: float


class PricePoint(BaseModel):
    time: datetime
    yes_mid: float
    yes_bid: float | None = None
    yes_ask: float | None = None
    volume: float | None = None


class FilterGate(BaseModel):
    gate_name: str
    threshold: str
    actual_value: str
    passed: bool


class GameDetailResponse(BaseModel):
    game_id: str
    game_date: date
    game_time_utc: datetime
    home_team: str
    away_team: str
    venue: str | None = None
    season_type: str
    series_info: str | None = None
    home_stats: TeamStats
    away_stats: TeamStats
    home_injuries: list[InjuryDetail]
    away_injuries: list[InjuryDetail]
    markets: list[MarketContractInfo]
    probability: ProbabilityBreakdown | None = None
    decision: DecisionMetrics | None = None
    confidence: ConfidenceInfo | None = None
    key_drivers: list[KeyDriver] = Field(default_factory=list)
    risk_flags: list[RiskFlag] = Field(default_factory=list)
    filter_gates: list[FilterGate] = Field(default_factory=list)
    is_actionable: bool = False
    skip_reason: str | None = None


# ---------------------------------------------------------------------------
# Markets sub-detail
# ---------------------------------------------------------------------------

class GameMarketsResponse(BaseModel):
    game_id: str
    contracts: list[MarketContractInfo]
    orderbooks: dict[str, OrderbookData] = Field(default_factory=dict)
    price_history: dict[str, list[PricePoint]] = Field(default_factory=dict)


class GameFeaturesResponse(BaseModel):
    game_id: str
    home_stats: TeamStats
    away_stats: TeamStats
    matchup_features: dict[str, float]
    home_injuries: list[InjuryDetail]
    away_injuries: list[InjuryDetail]
    home_injury_impact: float
    away_injury_impact: float
    injury_uncertainty: float


# ---------------------------------------------------------------------------
# Signals
# ---------------------------------------------------------------------------

class SignalListItem(BaseModel):
    signal_id: str
    game_id: str
    home_team: str
    away_team: str
    game_time_utc: datetime
    platform: str
    market_type: str
    direction: str
    edge: float
    expected_value: float
    confidence_score: float
    confidence_tier: str
    fair_prob: float | None = None
    market_mid: float | None = None
    kelly_suggested: float
    suggested_size_usd: float | None = None
    liquidity_score: float
    is_actionable: bool
    skip_reason: str | None = None
    n_risk_flags: int = 0
    signal_time: datetime


class SignalDetailResponse(BaseModel):
    signal_id: str
    game_id: str
    home_team: str
    away_team: str
    game_time_utc: datetime | None = None
    platform: str
    market_type: str
    question: str
    # Price
    yes_bid: float
    yes_ask: float
    yes_mid: float
    spread: float
    # Probability
    probability: ProbabilityBreakdown
    # Decision
    decision: DecisionMetrics
    confidence: ConfidenceInfo
    # Explanation
    key_drivers: list[KeyDriver]
    risk_flags: list[RiskFlag]
    filter_gates: list[FilterGate]
    # Status
    is_actionable: bool
    skip_reason: str | None = None
    signal_time: datetime
    time_to_game_hours: float


class SignalsListResponse(BaseModel):
    signals: list[SignalListItem]
    total: int
    actionable_count: int
    skipped_count: int


# ---------------------------------------------------------------------------
# Backtest
# ---------------------------------------------------------------------------

class BacktestSummary(BaseModel):
    run_id: str
    run_name: str
    start_date: date
    end_date: date
    model_version: str
    total_signals: int
    signals_executed: int
    hit_rate: float
    roi_pct: float
    total_pnl_usd: float
    sharpe_ratio: float
    max_drawdown_pct: float
    avg_hold_hours: float
    avg_edge: float | None = None
    by_confidence: dict[str, Any] | None = None
    by_market_type: dict[str, Any] | None = None


class EquityPoint(BaseModel):
    date: date
    cumulative_pnl: float
    capital: float
    drawdown: float
    n_trades: int


class BacktestEquityResponse(BaseModel):
    run_id: str
    initial_capital: float
    equity_curve: list[EquityPoint]
    summary: BacktestSummary


# ---------------------------------------------------------------------------
# Risk
# ---------------------------------------------------------------------------

class ExposureEntry(BaseModel):
    label: str  # game_id, team_abbr, or series_id
    exposure_usd: float
    limit_usd: float
    utilization_pct: float


class RiskExposureResponse(BaseModel):
    bankroll_usd: float
    daily_risk_used_usd: float
    daily_risk_limit_usd: float
    daily_utilization_pct: float
    by_game: list[ExposureEntry]
    by_team: list[ExposureEntry]
    by_series: list[ExposureEntry]
    open_positions: int
    risk_rule_hits: list[dict[str, Any]] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Monitoring
# ---------------------------------------------------------------------------

class DataSourceStatus(BaseModel):
    source: str  # kalshi / odds_api / nba_stats / injuries
    status: str  # ok / stale / error
    last_sync: datetime | None = None
    staleness_minutes: float | None = None
    threshold_minutes: float
    records_last_sync: int | None = None
    error_message: str | None = None


class HealthResponse(BaseModel):
    overall_status: str  # healthy / degraded / critical
    timestamp: datetime
    data_sources: list[DataSourceStatus]
    model_version: str
    db_connected: bool
    redis_connected: bool
    uptime_seconds: float | None = None


class AlertEntry(BaseModel):
    alert_id: str
    alert_type: str  # signal / anomaly / system
    severity: str  # INFO / WARNING / ERROR / CRITICAL
    message: str
    details: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    acknowledged: bool = False


class AlertsResponse(BaseModel):
    alerts: list[AlertEntry]
    total: int
    unacknowledged: int
