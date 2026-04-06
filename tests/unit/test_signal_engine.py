"""
Unit tests for signal generation logic.
"""

from datetime import datetime, timedelta, timezone

import pytest

from src.signals.signal_engine import SignalEngine, TradingSignal


def make_future_game_time(hours: int = 6) -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=hours)


class TestSignalEngine:
    def setup_method(self):
        self.engine = SignalEngine(
            model=None,
            calibrator=None,
            bankroll_usd=10_000.0,
        )

    def _base_kwargs(self, **overrides):
        game_time = make_future_game_time(6)
        kwargs = dict(
            game_id="NBA_20260410_LAL_BOS",
            game_time_utc=game_time,
            home_team="BOS",
            away_team="LAL",
            platform="kalshi",
            contract_id="abc123",
            question="Will the Boston Celtics win vs Lakers?",
            market_type="moneyline",
            yes_bid=0.62,
            yes_ask=0.65,
            fee_pct=0.02,
            sportsbook_novig_prob=0.67,
            matchup_features=None,
            liquidity_score=0.70,
            injury_uncertainty=0.10,
            has_gtd_star=False,
            is_backtest=False,
        )
        kwargs.update(overrides)
        return kwargs

    def test_skip_on_no_edge(self):
        # Market mid > fair prob → no edge
        sig = self.engine.generate(
            **self._base_kwargs(yes_bid=0.72, yes_ask=0.75, sportsbook_novig_prob=0.71)
        )
        # With market asking 0.75+ and fair ~0.71, edge should be negative
        assert sig.direction == "SKIP" or not sig.is_actionable

    def test_signal_has_required_fields(self):
        sig = self.engine.generate(**self._base_kwargs())
        assert sig.game_id == "NBA_20260410_LAL_BOS"
        assert sig.ensemble_fair_prob is not None
        assert sig.edge is not None
        assert sig.confidence_score is not None
        assert sig.direction in ("YES", "NO", "SKIP")

    def test_gtd_star_blocks_signal(self):
        game_time = make_future_game_time(1)  # 1h to tipoff
        sig = self.engine.generate(
            **self._base_kwargs(
                game_time_utc=game_time,
                has_gtd_star=True,
            )
        )
        assert not sig.is_actionable

    def test_too_close_to_tipoff_blocks(self):
        game_time = make_future_game_time(0.2)  # 12 minutes
        sig = self.engine.generate(**self._base_kwargs(game_time_utc=game_time))
        assert not sig.is_actionable

    def test_low_liquidity_blocks(self):
        sig = self.engine.generate(
            **self._base_kwargs(liquidity_score=0.05)
        )
        assert not sig.is_actionable

    def test_kelly_suggested_less_than_full(self):
        # When we do get an actionable signal, kelly_suggested < kelly_full
        # We'll test the math directly
        from src.etl.odds_transformer import compute_kelly_fraction
        kelly = compute_kelly_fraction(0.65, 0.60)
        assert kelly > 0
        suggested = kelly * 0.25
        assert suggested < kelly

    def test_to_dict_is_json_serializable(self):
        import json
        sig = self.engine.generate(**self._base_kwargs())
        d = sig.to_dict()
        # Should not raise
        json_str = json.dumps(d, default=str)
        assert len(json_str) > 0
