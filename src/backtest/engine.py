"""
Backtest Engine — walk-forward simulation with realistic execution modeling.

Rules:
  - Only uses data available at signal_time (strict no-lookahead)
  - Models slippage, partial fills, and liquidity constraints
  - Settles positions against historical market resolutions
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Generator

import numpy as np
import pandas as pd
import structlog

from src.config import cfg
from src.signals.signal_engine import SignalEngine, TradingSignal

log = structlog.get_logger(__name__)

BT_CFG = cfg["backtest"]


@dataclass
class BacktestConfig:
    start_date: date
    end_date: date
    initial_capital_usd: float = 10_000.0
    kelly_fraction: float = 0.25
    max_position_pct: float = 0.02
    max_daily_risk_pct: float = 0.15
    min_edge: float = 0.04
    fee_pct: float = 0.02
    slippage_pct: float = 0.005
    signal_offset_min: int = -60     # signal generated N min before tipoff
    min_fill_usd: float = 10.0
    max_book_depth_pct: float = 0.30
    model_version: str = "v0.1"
    run_name: str = "backtest_run"


@dataclass
class Fill:
    fill_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    contract_id: str = ""
    game_id: str = ""
    direction: str = ""          # YES / NO
    filled_usd: float = 0.0
    entry_price: float = 0.0
    fill_time: datetime | None = None
    platform: str = ""
    is_simulated: bool = True


@dataclass
class ClosedPosition:
    fill: Fill
    exit_price: float
    exit_time: datetime
    yes_wins: bool
    pnl_usd: float
    pnl_pct: float
    hold_hours: float


@dataclass
class BacktestResult:
    config: BacktestConfig
    signals: list[TradingSignal]
    fills: list[Fill]
    closed_positions: list[ClosedPosition]
    metrics: dict[str, Any]


class BacktestEngine:
    """
    Walk-forward backtesting engine.

    Usage:
        engine = BacktestEngine(config, signal_engine, data_loader)
        result = engine.run()
    """

    def __init__(
        self,
        config: BacktestConfig,
        signal_engine: SignalEngine,
        data_loader: Any,  # DataLoader interface defined separately
    ) -> None:
        self.cfg = config
        self.signal_engine = signal_engine
        self.data_loader = data_loader
        self._capital = config.initial_capital_usd

    def run(self) -> BacktestResult:
        """Execute full backtest."""
        log.info("backtest_start", config=self.cfg.__dict__)

        all_signals: list[TradingSignal] = []
        all_fills: list[Fill] = []
        all_closed: list[ClosedPosition] = []

        # Iterate game-by-game in chronological order
        games = self.data_loader.get_games(self.cfg.start_date, self.cfg.end_date)

        for game in games:
            signal_time = game["game_time_utc"] + timedelta(
                minutes=self.cfg.signal_offset_min
            )

            # ---- Generate signal ----
            try:
                signal = self._generate_signal_for_game(game, signal_time)
            except Exception as exc:
                log.warning("signal_failed", game_id=game["game_id"], error=str(exc))
                continue

            all_signals.append(signal)

            if not signal.is_actionable:
                continue

            # ---- Simulate fill ----
            fill = self._simulate_fill(signal, game, signal_time)
            if fill is None:
                continue

            all_fills.append(fill)

            # ---- Settle ----
            resolution = self.data_loader.get_market_resolution(
                game["game_id"], game.get("contract_id", "")
            )
            if resolution is None:
                log.debug("no_resolution", game_id=game["game_id"])
                continue

            closed = self._settle_position(fill, resolution, game["game_time_utc"])
            all_closed.append(closed)

            # Update capital
            self._capital += closed.pnl_usd

        metrics = compute_backtest_metrics(all_signals, all_fills, all_closed, self.cfg)

        log.info(
            "backtest_complete",
            n_signals=len(all_signals),
            n_executed=len(all_fills),
            roi_pct=metrics.get("roi_pct"),
            hit_rate=metrics.get("hit_rate"),
            max_drawdown=metrics.get("max_drawdown_pct"),
        )

        return BacktestResult(
            config=self.cfg,
            signals=all_signals,
            fills=all_fills,
            closed_positions=all_closed,
            metrics=metrics,
        )

    def _generate_signal_for_game(
        self, game: dict, signal_time: datetime
    ) -> TradingSignal:
        """Build signal using only data available at signal_time."""
        features = self.data_loader.get_matchup_features(game["game_id"], signal_time)
        quote = self.data_loader.get_market_quote_at(game["game_id"], signal_time)

        if quote is None:
            raise ValueError(f"No market quote at {signal_time} for {game['game_id']}")

        sportsbook = self.data_loader.get_sportsbook_novig(game["game_id"], signal_time)
        orderbook = self.data_loader.get_orderbook_at(game["game_id"], signal_time)
        injuries = self.data_loader.get_injuries_as_of(game["game_id"], signal_time)

        from src.features.injury_features import compute_injury_impact, compute_injury_uncertainty
        home_injury = compute_injury_impact(injuries.get("home", []))
        away_injury = compute_injury_impact(injuries.get("away", []))
        inj_uncertainty = compute_injury_uncertainty(
            injuries.get("home", []) + injuries.get("away", [])
        )
        has_gtd_star = (
            home_injury.get("has_gtd_star", False) or
            away_injury.get("has_gtd_star", False)
        )

        from src.features.market_features import MarketMicrostructureFeatures
        mkt_feats = MarketMicrostructureFeatures.compute(
            contract_id=game.get("contract_id", ""),
            signal_time=signal_time,
            quote_history=self.data_loader.get_quote_history(
                game["game_id"], signal_time
            ),
            current_orderbook=orderbook,
            sportsbook_novig=sportsbook,
        )

        return self.signal_engine.generate(
            game_id=game["game_id"],
            game_time_utc=game["game_time_utc"],
            home_team=game["home_team"],
            away_team=game["away_team"],
            platform=game.get("platform", "kalshi"),
            contract_id=game.get("contract_id", ""),
            question=game.get("question", ""),
            market_type=game.get("market_type", "moneyline"),
            yes_bid=quote["yes_bid"],
            yes_ask=quote["yes_ask"],
            fee_pct=self.cfg.fee_pct,
            sportsbook_novig_prob=sportsbook,
            matchup_features=features,
            liquidity_score=mkt_feats.liquidity_score,
            injury_uncertainty=inj_uncertainty,
            has_gtd_star=has_gtd_star,
            is_backtest=True,
            signal_time=signal_time,
        )

    def _simulate_fill(
        self, signal: TradingSignal, game: dict, signal_time: datetime
    ) -> Fill | None:
        """Simulate order execution with depth and slippage constraints."""
        if signal.direction == "YES":
            base_price = signal.yes_ask
            available_depth = getattr(signal, "depth_3c_ask", 1000) or 1000
        else:
            base_price = signal.yes_bid
            available_depth = getattr(signal, "depth_3c_bid", 1000) or 1000

        desired = signal.suggested_size_usd or 0
        max_depth_fill = available_depth * self.cfg.max_book_depth_pct
        fill_usd = min(desired, max_depth_fill)

        if fill_usd < self.cfg.min_fill_usd:
            return None

        # Slippage
        effective_price = base_price * (1 + self.cfg.slippage_pct)

        return Fill(
            contract_id=signal.contract_id,
            game_id=signal.game_id,
            direction=signal.direction,
            filled_usd=fill_usd,
            entry_price=min(1.0, effective_price),
            fill_time=signal_time,
            platform=signal.platform,
            is_simulated=True,
        )

    def _settle_position(
        self,
        fill: Fill,
        resolution: dict,
        game_time_utc: datetime,
    ) -> ClosedPosition:
        """Calculate P&L at settlement."""
        yes_wins: bool = resolution["yes_wins"]
        won = (fill.direction == "YES" and yes_wins) or (
            fill.direction == "NO" and not yes_wins
        )

        # P&L calculation
        # Invest: fill.filled_usd at price fill.entry_price
        # Shares: fill.filled_usd / fill.entry_price (each share pays $1 if win)
        # Win: shares × $1 - fill.filled_usd = fill.filled_usd × (1/price - 1)
        # Lose: -fill.filled_usd
        # Fee: fill.filled_usd × (1/price - 1) × fee_pct (on net profit)
        if won:
            gross_profit = fill.filled_usd * (1 / fill.entry_price - 1)
            fee = gross_profit * self.cfg.fee_pct
            pnl = gross_profit - fee
        else:
            pnl = -fill.filled_usd

        exit_time = resolution.get("resolved_at") or game_time_utc + timedelta(hours=3)
        if isinstance(exit_time, str):
            exit_time = datetime.fromisoformat(exit_time)

        hold_hours = (exit_time - fill.fill_time).total_seconds() / 3600 if fill.fill_time else 0

        return ClosedPosition(
            fill=fill,
            exit_price=1.0 if won else 0.0,
            exit_time=exit_time,
            yes_wins=yes_wins,
            pnl_usd=pnl,
            pnl_pct=pnl / fill.filled_usd,
            hold_hours=hold_hours,
        )


# ------------------------------------------------------------------
# Metrics computation
# ------------------------------------------------------------------


def compute_backtest_metrics(
    signals: list[TradingSignal],
    fills: list[Fill],
    closed: list[ClosedPosition],
    config: BacktestConfig,
) -> dict[str, Any]:
    if not closed:
        return {"error": "no_closed_positions"}

    pnl_series = np.array([c.pnl_usd for c in closed])
    stake_series = np.array([c.fill.filled_usd for c in closed])
    edge_series = np.array([c.fill.filled_usd for c in closed])  # placeholder

    cumulative = np.cumsum(pnl_series)
    running_max = np.maximum.accumulate(cumulative)
    drawdown = cumulative - running_max
    max_dd = float(drawdown.min())
    max_dd_pct = max_dd / (config.initial_capital_usd + running_max.max() + 1e-9) * 100

    roi_pct = float(pnl_series.sum() / stake_series.sum() * 100)
    hit_rate = float((pnl_series > 0).mean())
    avg_hold = float(np.mean([c.hold_hours for c in closed]))

    # Sharpe-like (daily grouping would need dates — simplified here)
    if len(pnl_series) > 1:
        sharpe = float(pnl_series.mean() / (pnl_series.std() + 1e-9) * np.sqrt(252))
    else:
        sharpe = 0.0

    n_skip = sum(1 for s in signals if not s.is_actionable)

    return {
        "total_signals": len(signals),
        "signals_executed": len(fills),
        "signals_skipped": n_skip,
        "closed_positions": len(closed),
        "hit_rate": round(hit_rate, 4),
        "roi_pct": round(roi_pct, 2),
        "total_pnl_usd": round(float(pnl_series.sum()), 2),
        "total_staked_usd": round(float(stake_series.sum()), 2),
        "avg_pnl_per_trade": round(float(pnl_series.mean()), 2),
        "avg_hold_hours": round(avg_hold, 1),
        "sharpe_ratio": round(sharpe, 3),
        "max_drawdown_usd": round(max_dd, 2),
        "max_drawdown_pct": round(max_dd_pct, 2),
        "final_capital": round(config.initial_capital_usd + float(pnl_series.sum()), 2),
        "model_version": config.model_version,
    }
