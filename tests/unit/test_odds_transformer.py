"""
Unit tests for odds transformation logic.
"""

import pytest
from src.etl.odds_transformer import (
    american_to_implied,
    remove_vig_simple,
    remove_vig_shin,
    compute_edge,
    compute_expected_value,
    compute_kelly_fraction,
    market_price_to_executable_prob,
    OddsLine,
    process_odds_line,
)


class TestAmericanToImplied:
    def test_even_money(self):
        assert american_to_implied(100) == pytest.approx(0.5)
        assert american_to_implied(-100) == pytest.approx(0.5)

    def test_favorite(self):
        # -150 favorite
        p = american_to_implied(-150)
        assert p == pytest.approx(0.6, abs=0.01)

    def test_underdog(self):
        # +130 underdog
        p = american_to_implied(130)
        assert p == pytest.approx(0.4348, abs=0.001)

    def test_overround(self):
        # Typical vig: -110 / -110 (spread market)
        p1 = american_to_implied(-110)
        p2 = american_to_implied(-110)
        assert p1 + p2 > 1.0  # overround exists


class TestRemoveVig:
    def test_simple_normalization(self):
        p_home, p_away = remove_vig_simple(0.55, 0.50)
        assert p_home + p_away == pytest.approx(1.0, abs=1e-9)
        assert p_home > p_away

    def test_shin_method_sums_to_one(self):
        p_home, p_away = remove_vig_shin(0.55, 0.50)
        assert p_home + p_away == pytest.approx(1.0, abs=0.01)

    def test_shin_vs_simple_close(self):
        # For typical vig (~5%), Shin and simple should be within 1%
        p_home_s, _ = remove_vig_simple(0.55, 0.50)
        p_home_sh, _ = remove_vig_shin(0.55, 0.50)
        assert abs(p_home_s - p_home_sh) < 0.02


class TestEdgeAndEV:
    def test_positive_edge(self):
        edge = compute_edge(0.60, 0.55)
        assert edge == pytest.approx(0.05)

    def test_negative_edge(self):
        edge = compute_edge(0.50, 0.60)
        assert edge < 0

    def test_ev_positive_when_edge_positive(self):
        ev = compute_expected_value(0.60, 0.55)
        assert ev > 0

    def test_kelly_positive_when_edge_positive(self):
        k = compute_kelly_fraction(0.60, 0.55)
        assert k > 0

    def test_kelly_zero_when_no_edge(self):
        k = compute_kelly_fraction(0.50, 0.55)
        assert k == 0.0


class TestMarketPriceAdjustment:
    def test_fee_increases_breakeven(self):
        # If market mid = 0.60, effective cost > 0.60 after fee
        adjusted = market_price_to_executable_prob(0.60, fee_pct=0.02)
        assert adjusted > 0.60

    def test_no_fee(self):
        adjusted = market_price_to_executable_prob(0.60, fee_pct=0.0)
        assert adjusted == pytest.approx(0.60)


class TestProcessOddsLine:
    def test_full_pipeline(self):
        line = OddsLine(sportsbook="pinnacle", home_ml=-150, away_ml=130)
        result = process_odds_line(line)
        assert result.home_novig_prob + result.away_novig_prob == pytest.approx(1.0, abs=0.01)
        assert result.home_novig_prob > result.away_novig_prob
        assert result.overround > 1.0
        assert result.vig_pct > 0
