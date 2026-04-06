"""
SQLAlchemy ORM models — all 12 core tables.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, relationship
from sqlalchemy.sql import func


def _uuid():
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# Reference table
# ---------------------------------------------------------------------------


class Team(Base):
    __tablename__ = "teams"

    team_id = Column(Integer, primary_key=True, autoincrement=True)
    abbreviation = Column(String(8), unique=True, nullable=False)   # BOS
    full_name = Column(String(64), nullable=False)                   # Boston Celtics
    city = Column(String(64))
    conference = Column(String(8))  # East / West
    division = Column(String(32))
    nba_team_id = Column(Integer, unique=True)                       # NBA API team id
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ---------------------------------------------------------------------------
# 1. games
# ---------------------------------------------------------------------------


class Game(Base):
    __tablename__ = "games"

    game_id = Column(String(64), primary_key=True)
    # e.g. NBA_20260410_LAL_BOS
    league = Column(String(16), nullable=False)
    season = Column(String(16), nullable=False)
    season_type = Column(String(32), nullable=False)   # Regular / Playoff / PlayIn
    game_date = Column(Date, nullable=False)
    game_time_utc = Column(DateTime(timezone=True), nullable=False)
    home_team = Column(String(8), nullable=False)
    away_team = Column(String(8), nullable=False)
    venue = Column(String(128))
    home_team_id = Column(Integer, ForeignKey("teams.team_id"))
    away_team_id = Column(Integer, ForeignKey("teams.team_id"))
    series_id = Column(String(64))
    series_game_num = Column(SmallInteger)
    playoff_round = Column(String(32))                 # First Round / ECF / Finals
    is_back_to_back_home = Column(Boolean, default=False)
    is_back_to_back_away = Column(Boolean, default=False)
    home_rest_days = Column(SmallInteger)
    away_rest_days = Column(SmallInteger)
    home_travel_km = Column(Float)
    away_travel_km = Column(Float)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    home_team_ref = relationship("Team", foreign_keys=[home_team_id])
    away_team_ref = relationship("Team", foreign_keys=[away_team_id])
    result = relationship("GameResult", back_populates="game", uselist=False)
    market_contracts = relationship("MarketContract", back_populates="game")
    sportsbook_lines = relationship("SportsbookLine", back_populates="game")


# ---------------------------------------------------------------------------
# 2. market_contracts
# ---------------------------------------------------------------------------


class MarketContract(Base):
    __tablename__ = "market_contracts"
    __table_args__ = (UniqueConstraint("platform", "platform_id"),)

    contract_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    game_id = Column(String(64), ForeignKey("games.game_id"))
    platform = Column(String(32), nullable=False)   # kalshi / polymarket
    platform_id = Column(String(256), nullable=False)
    market_type = Column(String(64), nullable=False)  # moneyline / series_winner / champion
    question = Column(Text, nullable=False)
    outcome = Column(String(128), nullable=False)    # What YES resolves to
    resolution_source = Column(Text)
    resolution_criteria = Column(Text)
    open_time = Column(DateTime(timezone=True))
    close_time = Column(DateTime(timezone=True))
    status = Column(String(32), nullable=False, default="open")  # open/closed/resolved
    resolved_value = Column(Boolean)                 # TRUE=YES wins
    resolved_at = Column(DateTime(timezone=True))
    platform_fee_pct = Column(Float, default=0.02)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    game = relationship("Game", back_populates="market_contracts")
    quotes = relationship("MarketQuote", back_populates="contract")
    orderbooks = relationship("OrderbookSnapshot", back_populates="contract")
    resolutions = relationship("MarketResolution", back_populates="contract")
    signals = relationship("Signal", back_populates="contract")


# ---------------------------------------------------------------------------
# 3. market_quotes  (TimescaleDB hypertable on quote_time)
# ---------------------------------------------------------------------------


class MarketQuote(Base):
    __tablename__ = "market_quotes"

    quote_time = Column(DateTime(timezone=True), primary_key=True, nullable=False)
    contract_id = Column(UUID(as_uuid=True), ForeignKey("market_contracts.contract_id"), primary_key=True)
    yes_bid = Column(Float, nullable=False)
    yes_ask = Column(Float, nullable=False)
    yes_mid = Column(Float, nullable=False)
    no_bid = Column(Float, nullable=False)
    no_ask = Column(Float, nullable=False)
    spread = Column(Float, nullable=False)
    last_trade_price = Column(Float)
    volume_24h = Column(Float)
    open_interest = Column(Float)

    contract = relationship("MarketContract", back_populates="quotes")


# ---------------------------------------------------------------------------
# 4. orderbook_snapshots
# ---------------------------------------------------------------------------


class OrderbookSnapshot(Base):
    __tablename__ = "orderbook_snapshots"

    snapshot_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contract_id = Column(UUID(as_uuid=True), ForeignKey("market_contracts.contract_id"))
    snapshot_time = Column(DateTime(timezone=True), nullable=False)
    side = Column(String(4), nullable=False)   # yes / no
    depth_json = Column(JSONB, nullable=False)  # [{price, size}, ...]
    best_bid = Column(Float)
    best_ask = Column(Float)
    depth_3c_bid = Column(Float)
    depth_3c_ask = Column(Float)
    depth_5c_bid = Column(Float)
    depth_5c_ask = Column(Float)
    imbalance = Column(Float)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    contract = relationship("MarketContract", back_populates="orderbooks")


# ---------------------------------------------------------------------------
# 5. sportsbook_lines
# ---------------------------------------------------------------------------


class SportsbookLine(Base):
    __tablename__ = "sportsbook_lines"

    line_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    game_id = Column(String(64), ForeignKey("games.game_id"))
    sportsbook = Column(String(64), nullable=False)
    odds_timestamp = Column(DateTime(timezone=True), nullable=False)
    market_type = Column(String(32), nullable=False)  # h2h / spread / total
    # Moneyline
    home_ml_american = Column(Integer)
    away_ml_american = Column(Integer)
    home_implied_prob = Column(Float)
    away_implied_prob = Column(Float)
    home_novig_prob = Column(Float)
    away_novig_prob = Column(Float)
    # Spread
    home_spread = Column(Float)
    home_spread_price = Column(Integer)
    away_spread = Column(Float)
    away_spread_price = Column(Integer)
    # Totals
    total_line = Column(Float)
    over_price = Column(Integer)
    under_price = Column(Integer)
    # Metadata
    is_opening_line = Column(Boolean, default=False)
    is_closing_line = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    game = relationship("Game", back_populates="sportsbook_lines")


# ---------------------------------------------------------------------------
# 6. team_features
# ---------------------------------------------------------------------------


class TeamFeature(Base):
    __tablename__ = "team_features"
    __table_args__ = (UniqueConstraint("team_id", "game_id"),)

    feature_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    team_id = Column(Integer, ForeignKey("teams.team_id"))
    game_id = Column(String(64), ForeignKey("games.game_id"))
    as_of_date = Column(Date, nullable=False)
    season = Column(String(16), nullable=False)
    # Efficiency (per 100 possessions)
    off_rating = Column(Float)
    def_rating = Column(Float)
    net_rating = Column(Float)
    pace = Column(Float)
    # Shooting quality
    efg_pct = Column(Float)
    ts_pct = Column(Float)
    three_par = Column(Float)
    ftr = Column(Float)
    # Rebounding / turnovers
    orb_pct = Column(Float)
    drb_pct = Column(Float)
    tov_pct = Column(Float)
    # Rolling windows
    last3_net_rating = Column(Float)
    last5_net_rating = Column(Float)
    last10_net_rating = Column(Float)
    last3_off_rating = Column(Float)
    last3_def_rating = Column(Float)
    last5_off_rating = Column(Float)
    last5_def_rating = Column(Float)
    # Home/road splits
    home_net_rating = Column(Float)
    road_net_rating = Column(Float)
    # Strength-of-schedule splits
    vs_top10_net = Column(Float)
    vs_bot10_net = Column(Float)
    # Ratings
    elo_rating = Column(Float)
    power_rank = Column(Float)
    # Form
    win_streak = Column(Integer)          # positive=win streak, negative=loss streak
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    team = relationship("Team")


# ---------------------------------------------------------------------------
# 7. player_injuries
# ---------------------------------------------------------------------------


class PlayerInjury(Base):
    __tablename__ = "player_injuries"

    injury_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    game_id = Column(String(64), ForeignKey("games.game_id"))
    team_id = Column(Integer, ForeignKey("teams.team_id"))
    player_id = Column(Integer, nullable=False)
    player_name = Column(String(128), nullable=False)
    status = Column(String(64), nullable=False)   # Out/Doubtful/Questionable/Probable/GTD
    injury_type = Column(String(128))
    body_part = Column(String(64))
    side = Column(String(8))                       # Left / Right
    player_bpm = Column(Float)                     # Box Plus/Minus
    player_vorp = Column(Float)
    player_usg_pct = Column(Float)
    impact_weight = Column(Float)                  # computed [0,1]
    confirmed_at = Column(DateTime(timezone=True))
    source = Column(String(128))
    raw_text = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# ---------------------------------------------------------------------------
# 8. game_results
# ---------------------------------------------------------------------------


class GameResult(Base):
    __tablename__ = "game_results"

    game_id = Column(String(64), ForeignKey("games.game_id"), primary_key=True)
    home_score = Column(Integer)
    away_score = Column(Integer)
    home_won = Column(Boolean)
    total_points = Column(Integer)
    home_spread_actual = Column(Float)   # home_score - away_score
    overtime = Column(Boolean, default=False)
    ot_periods = Column(SmallInteger, default=0)
    home_actual_off_rtg = Column(Float)
    home_actual_def_rtg = Column(Float)
    away_actual_off_rtg = Column(Float)
    away_actual_def_rtg = Column(Float)
    actual_pace = Column(Float)
    recorded_at = Column(DateTime(timezone=True), server_default=func.now())

    game = relationship("Game", back_populates="result")


# ---------------------------------------------------------------------------
# 9. market_resolutions
# ---------------------------------------------------------------------------


class MarketResolution(Base):
    __tablename__ = "market_resolutions"

    resolution_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contract_id = Column(UUID(as_uuid=True), ForeignKey("market_contracts.contract_id"))
    game_id = Column(String(64), ForeignKey("games.game_id"))
    platform = Column(String(32))
    resolved_at = Column(DateTime(timezone=True))
    yes_wins = Column(Boolean)
    resolution_price = Column(Float)   # 1.0 if yes wins, 0.0 if no wins
    settlement_note = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    contract = relationship("MarketContract", back_populates="resolutions")


# ---------------------------------------------------------------------------
# 10. signals
# ---------------------------------------------------------------------------


class Signal(Base):
    __tablename__ = "signals"

    signal_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contract_id = Column(UUID(as_uuid=True), ForeignKey("market_contracts.contract_id"))
    game_id = Column(String(64), ForeignKey("games.game_id"))
    signal_time = Column(DateTime(timezone=True), nullable=False)
    # Probability layer
    market_yes_mid = Column(Float)
    sportsbook_novig_prob = Column(Float)
    model_prob = Column(Float)
    calibrated_prob = Column(Float)
    ensemble_fair_prob = Column(Float)
    prob_ci_lower = Column(Float)
    prob_ci_upper = Column(Float)
    # Decision layer
    edge = Column(Float)
    expected_value = Column(Float)
    kelly_full = Column(Float)
    suggested_fraction = Column(Float)
    # Direction
    direction = Column(String(8))        # YES / NO / SKIP
    skip_reason = Column(Text)
    # Confidence
    confidence_score = Column(Float)
    confidence_tier = Column(String(8))  # HIGH / MED / LOW
    model_disagreement = Column(Float)
    # Risk factors
    liquidity_score = Column(Float)
    injury_uncertainty = Column(Float)
    # Drivers (top 3)
    key_drivers = Column(JSONB)
    risk_flags = Column(JSONB)
    # Execution
    is_backtest = Column(Boolean, default=False)
    executed_price = Column(Float)
    pnl = Column(Float)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    contract = relationship("MarketContract", back_populates="signals")
    position = relationship("Position", back_populates="signal", uselist=False)


# ---------------------------------------------------------------------------
# 11. positions
# ---------------------------------------------------------------------------


class Position(Base):
    __tablename__ = "positions"

    position_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    signal_id = Column(UUID(as_uuid=True), ForeignKey("signals.signal_id"))
    contract_id = Column(UUID(as_uuid=True), ForeignKey("market_contracts.contract_id"))
    platform = Column(String(32))
    direction = Column(String(8))
    size_usd = Column(Float)
    entry_price = Column(Float)
    entry_time = Column(DateTime(timezone=True))
    exit_price = Column(Float)
    exit_time = Column(DateTime(timezone=True))
    pnl_usd = Column(Float)
    pnl_pct = Column(Float)
    status = Column(String(32), default="open")  # open / closed / voided
    is_simulated = Column(Boolean, default=True)
    notes = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    signal = relationship("Signal", back_populates="position")


# ---------------------------------------------------------------------------
# 12. backtest_runs
# ---------------------------------------------------------------------------


class BacktestRun(Base):
    __tablename__ = "backtest_runs"

    run_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_name = Column(String(128))
    start_date = Column(Date)
    end_date = Column(Date)
    config_json = Column(JSONB)
    # Performance metrics
    total_signals = Column(Integer)
    signals_executed = Column(Integer)
    hit_rate = Column(Float)
    roi_pct = Column(Float)
    avg_edge = Column(Float)
    avg_ev = Column(Float)
    sharpe_ratio = Column(Float)
    max_drawdown_pct = Column(Float)
    total_pnl_usd = Column(Float)
    avg_hold_hours = Column(Float)
    # Breakdown
    by_league = Column(JSONB)
    by_market_type = Column(JSONB)
    by_confidence = Column(JSONB)
    by_time_to_game = Column(JSONB)
    # Meta
    model_version = Column(String(64))
    run_at = Column(DateTime(timezone=True), server_default=func.now())
    run_duration_s = Column(Float)
