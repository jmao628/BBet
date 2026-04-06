"""
Risk Manager — portfolio-level risk controls.
Applied AFTER the per-signal SignalEngine has generated candidates.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any

import structlog

from src.config import cfg

log = structlog.get_logger(__name__)

RISK = cfg["risk"]


@dataclass
class PortfolioState:
    """Current open exposure snapshot (loaded from positions table)."""

    bankroll_usd: float
    daily_risk_used_usd: float = 0.0
    game_exposure: dict[str, float] = field(default_factory=dict)   # game_id → usd
    team_exposure: dict[str, float] = field(default_factory=dict)   # team_abbr → usd
    series_exposure: dict[str, float] = field(default_factory=dict) # series_id → usd

    @property
    def daily_risk_pct(self) -> float:
        return self.daily_risk_used_usd / self.bankroll_usd


class RiskManager:
    """
    Portfolio-level risk gate applied to individual signals.
    Does NOT modify signal probabilities — only adjusts/blocks sizing.
    """

    def __init__(self, bankroll_usd: float) -> None:
        self.bankroll = bankroll_usd

    def apply(
        self,
        signal: Any,              # TradingSignal
        portfolio: PortfolioState,
        game_id: str,
        home_team: str,
        away_team: str,
        series_id: str | None = None,
    ) -> Any:
        """
        Apply risk rules in order. First failure blocks execution.
        Returns modified signal.
        """
        if not signal.is_actionable:
            return signal

        rules = [
            self._check_daily_limit,
            self._check_game_exposure,
            self._check_team_exposure,
            self._check_series_exposure,
            self._check_liquidity_size,
        ]

        for rule in rules:
            signal, passed = rule(signal, portfolio, game_id, home_team, away_team, series_id)
            if not passed:
                break

        return signal

    # ------------------------------------------------------------------
    # Individual risk rules
    # ------------------------------------------------------------------

    def _check_daily_limit(self, signal, portfolio, game_id, home, away, series):
        max_daily_usd = self.bankroll * RISK["max_daily_risk_pct"]
        remaining = max_daily_usd - portfolio.daily_risk_used_usd

        if remaining <= 0:
            signal.is_actionable = False
            signal.skip_reason = f"daily_limit_reached: {portfolio.daily_risk_pct:.1%} used"
            log.info("risk_daily_limit", used_pct=portfolio.daily_risk_pct)
            return signal, False

        if signal.suggested_size_usd and signal.suggested_size_usd > remaining:
            signal.suggested_size_usd = remaining
            signal.risk_flags.append({
                "flag": "size_capped_daily_limit",
                "severity": "LOW",
                "note": f"Size reduced from ${signal.suggested_size_usd:.0f} to ${remaining:.0f}",
            })

        return signal, True

    def _check_game_exposure(self, signal, portfolio, game_id, home, away, series):
        max_game_usd = self.bankroll * RISK["max_game_exposure_pct"]
        current = portfolio.game_exposure.get(game_id, 0.0)
        remaining = max_game_usd - current

        if remaining <= 0:
            signal.is_actionable = False
            signal.skip_reason = f"game_exposure_limit: {current:.0f}/{max_game_usd:.0f}"
            return signal, False

        if signal.suggested_size_usd and signal.suggested_size_usd > remaining:
            signal.suggested_size_usd = remaining

        return signal, True

    def _check_team_exposure(self, signal, portfolio, game_id, home, away, series):
        max_team_usd = self.bankroll * RISK["max_team_exposure_pct"]
        for team in (home, away):
            current = portfolio.team_exposure.get(team, 0.0)
            if current >= max_team_usd:
                signal.is_actionable = False
                signal.skip_reason = f"team_exposure_limit_{team}: {current:.0f}/{max_team_usd:.0f}"
                return signal, False
        return signal, True

    def _check_series_exposure(self, signal, portfolio, game_id, home, away, series):
        if not series:
            return signal, True
        max_series_usd = self.bankroll * RISK["max_series_exposure_pct"]
        current = portfolio.series_exposure.get(series, 0.0)
        if current >= max_series_usd:
            signal.is_actionable = False
            signal.skip_reason = f"series_exposure_limit: {current:.0f}/{max_series_usd:.0f}"
            return signal, False
        return signal, True

    def _check_liquidity_size(self, signal, portfolio, game_id, home, away, series):
        """Cap size at 30% of available 3c-depth."""
        depth = (getattr(signal, "depth_3c_ask", 0) or 0) + (
            getattr(signal, "depth_3c_bid", 0) or 0
        )
        if depth > 0:
            max_from_depth = depth * 0.30
            if signal.suggested_size_usd and signal.suggested_size_usd > max_from_depth:
                signal.suggested_size_usd = max_from_depth
                signal.risk_flags.append({
                    "flag": "size_capped_liquidity",
                    "severity": "LOW",
                    "note": f"Depth-limited size: ${max_from_depth:.0f}",
                })
        return signal, True
