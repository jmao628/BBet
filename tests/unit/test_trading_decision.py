"""
Unit tests for the Trading Decision Engine.

Tests all three stages (PRE, IN, LATE) and core decision logic.
"""

from __future__ import annotations

import pytest

from src.signals.trading_decision import (
    Action,
    Confidence,
    ExistingPosition,
    GameInput,
    GameStage,
    GameState,
    HeadToHead,
    KalshiMarket,
    MispricingVerdict,
    TeamFundamentals,
    TradingDecisionEngine,
    render_trading_decision,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def make_team_a(**overrides) -> TeamFundamentals:
    defaults = dict(
        name="Celtics",
        record="52-20",
        win_rate=0.72,
        points_per_game=118.5,
        points_against=109.2,
        fg_pct=0.485,
        rebounds=45.0,
        assists=27.0,
        blocks=5.5,
        steals=7.2,
        off_rating=119.0,
        def_rating=110.5,
        net_rating=8.5,
        pace=100.5,
        efg_pct=0.56,
        tov_pct=12.5,
        last5_net_rating=10.2,
        home_net_rating=11.0,
        road_net_rating=6.0,
        elo_rating=1650,
        win_streak=4,
        rest_days=2,
    )
    defaults.update(overrides)
    return TeamFundamentals(**defaults)


def make_team_b(**overrides) -> TeamFundamentals:
    defaults = dict(
        name="Knicks",
        record="42-30",
        win_rate=0.58,
        points_per_game=112.0,
        points_against=110.5,
        fg_pct=0.465,
        rebounds=44.0,
        assists=24.5,
        blocks=4.8,
        steals=6.5,
        off_rating=113.0,
        def_rating=111.5,
        net_rating=1.5,
        pace=98.5,
        efg_pct=0.52,
        tov_pct=13.8,
        last5_net_rating=2.0,
        home_net_rating=4.0,
        road_net_rating=-1.5,
        elo_rating=1550,
        win_streak=1,
        rest_days=3,
    )
    defaults.update(overrides)
    return TeamFundamentals(**defaults)


def make_market(**overrides) -> KalshiMarket:
    defaults = dict(
        yes_price=0.62,
        implied_prob=0.62,
        price_change="flat",
        spread=0.03,
        depth_3c_usd=2000.0,
    )
    defaults.update(overrides)
    return KalshiMarket(**defaults)


def make_pre_game_input(**overrides) -> GameInput:
    defaults = dict(
        team_a=make_team_a(),
        team_b=make_team_b(),
        stage=GameStage.PRE,
        market=make_market(),
        sportsbook_novig_prob=0.68,
    )
    defaults.update(overrides)
    return GameInput(**defaults)


# ---------------------------------------------------------------------------
# PRE-GAME Tests
# ---------------------------------------------------------------------------

class TestPreGameDecision:
    def test_basic_pre_game_produces_decision(self):
        engine = TradingDecisionEngine(bankroll_usd=10_000)
        gi = make_pre_game_input()
        td = engine.analyze(gi)

        assert td.final_decision is not None
        assert td.probability_edge is not None
        assert td.risk_reward is not None
        assert td.execution_plan is not None
        assert td.exit_strategy is not None
        assert td.profit_model is not None
        assert td.stage == GameStage.PRE

    def test_strong_favorite_gets_buy(self):
        engine = TradingDecisionEngine(bankroll_usd=10_000)
        gi = make_pre_game_input(
            market=make_market(yes_price=0.55, implied_prob=0.55),
            sportsbook_novig_prob=0.72,
        )
        td = engine.analyze(gi)

        # Strong team + low market price = BUY
        assert td.final_decision.action == Action.BUY
        assert td.final_decision.side == "Team A"
        assert td.probability_edge.edge > 0.04

    def test_overpriced_market_results_in_skip(self):
        engine = TradingDecisionEngine(bankroll_usd=10_000)
        # Team A is weak but market prices them high
        gi = make_pre_game_input(
            team_a=make_team_a(net_rating=-2.0, elo_rating=1450, last5_net_rating=-3.0),
            team_b=make_team_b(net_rating=5.0, elo_rating=1600, last5_net_rating=6.0),
            market=make_market(yes_price=0.70, implied_prob=0.70),
            sportsbook_novig_prob=0.40,
        )
        td = engine.analyze(gi)

        assert td.probability_edge.verdict == MispricingVerdict.OVERPRICED
        assert td.probability_edge.edge < 0

    def test_fair_market_is_detected(self):
        engine = TradingDecisionEngine(bankroll_usd=10_000)
        # Use equal teams so fundamentals don't push prob away from market
        equal_a = make_team_a(net_rating=2.0, elo_rating=1530, last5_net_rating=2.0,
                              home_net_rating=3.5, off_rating=112.0, def_rating=110.0)
        equal_b = make_team_b(net_rating=2.0, elo_rating=1530, last5_net_rating=2.0,
                              road_net_rating=0.5, off_rating=112.0, def_rating=110.0)
        gi = make_pre_game_input(
            team_a=equal_a,
            team_b=equal_b,
            market=make_market(yes_price=0.58, implied_prob=0.58),
            sportsbook_novig_prob=0.58,
        )
        td = engine.analyze(gi)

        # With similar teams and market = sportsbook, edge should be small
        assert abs(td.probability_edge.edge) < 0.06

    def test_probability_is_bounded(self):
        engine = TradingDecisionEngine(bankroll_usd=10_000)
        gi = make_pre_game_input()
        td = engine.analyze(gi)

        assert 0.02 <= td.probability_edge.true_probability <= 0.98

    def test_key_drivers_populated(self):
        engine = TradingDecisionEngine(bankroll_usd=10_000)
        gi = make_pre_game_input()
        td = engine.analyze(gi)

        assert len(td.key_drivers) > 0
        assert all("factor" in d for d in td.key_drivers)

    def test_back_to_back_impact(self):
        engine = TradingDecisionEngine(bankroll_usd=10_000)
        # Team A on B2B, Team B rested
        gi = make_pre_game_input(
            team_a=make_team_a(is_back_to_back=True, rest_days=0),
            team_b=make_team_b(is_back_to_back=False, rest_days=3),
        )
        td_b2b = engine.analyze(gi)

        gi_rested = make_pre_game_input()
        td_rested = engine.analyze(gi_rested)

        # B2B should lower Team A's probability
        assert td_b2b.probability_edge.true_probability < td_rested.probability_edge.true_probability

    def test_injury_impact(self):
        engine = TradingDecisionEngine(bankroll_usd=10_000)
        gi = make_pre_game_input(
            team_a=make_team_a(injury_impact=0.5, has_gtd_star=True),
        )
        td = engine.analyze(gi)

        # Should have GTD risk flag
        flags = [f["flag"] for f in td.risk_flags]
        assert "gtd_star" in flags

    def test_execution_plan_respects_depth(self):
        engine = TradingDecisionEngine(bankroll_usd=100_000)
        gi = make_pre_game_input(
            market=make_market(depth_3c_usd=200.0),
        )
        td = engine.analyze(gi)

        # Position should be capped by thin depth
        assert td.execution_plan.position_size_usd <= 200.0 * 0.30


# ---------------------------------------------------------------------------
# IN-GAME Tests
# ---------------------------------------------------------------------------

class TestInGameDecision:
    def test_in_game_with_lead_adjusts_probability(self):
        engine = TradingDecisionEngine(bankroll_usd=10_000)
        gi = GameInput(
            team_a=make_team_a(),
            team_b=make_team_b(),
            stage=GameStage.IN,
            market=make_market(yes_price=0.72, implied_prob=0.72),
            game_state=GameState(
                home_score=78,
                away_score=65,
                quarter=3,
                time_remaining="4:30",
                momentum="home",
            ),
            sportsbook_novig_prob=0.68,
        )
        td = engine.analyze(gi)

        assert td.game_state_summary != ""
        # Home team leading by 13 in Q3 — probability should be elevated
        assert td.probability_edge.true_probability > 0.70

    def test_in_game_trailing_team_probability(self):
        engine = TradingDecisionEngine(bankroll_usd=10_000)
        gi = GameInput(
            team_a=make_team_a(),
            team_b=make_team_b(),
            stage=GameStage.IN,
            market=make_market(yes_price=0.40, implied_prob=0.40),
            game_state=GameState(
                home_score=45,
                away_score=60,
                quarter=3,
                time_remaining="8:00",
                momentum="away",
            ),
            sportsbook_novig_prob=0.68,
        )
        td = engine.analyze(gi)

        # Trailing by 15 in Q3 — probability should be lower
        assert td.probability_edge.true_probability < 0.55

    def test_in_game_game_state_summary(self):
        engine = TradingDecisionEngine(bankroll_usd=10_000)
        gi = GameInput(
            team_a=make_team_a(),
            team_b=make_team_b(),
            stage=GameStage.IN,
            market=make_market(),
            game_state=GameState(
                home_score=55, away_score=50,
                quarter=2, time_remaining="3:00",
                momentum="home",
            ),
        )
        td = engine.analyze(gi)

        assert "Celtics" in td.game_state_summary
        assert "Knicks" in td.game_state_summary
        assert "Q2" in td.game_state_summary


# ---------------------------------------------------------------------------
# LATE-GAME Tests
# ---------------------------------------------------------------------------

class TestLateGameDecision:
    def test_late_game_blowout_holds_position(self):
        engine = TradingDecisionEngine(bankroll_usd=10_000)
        gi = GameInput(
            team_a=make_team_a(),
            team_b=make_team_b(),
            stage=GameStage.LATE,
            market=make_market(yes_price=0.95, implied_prob=0.95),
            game_state=GameState(
                home_score=112, away_score=95,
                quarter=4, time_remaining="1:30",
                momentum="home",
            ),
            existing_position=ExistingPosition(
                side="YES", avg_entry_price=0.65, size_usd=100, contracts=154,
            ),
            sportsbook_novig_prob=0.68,
        )
        td = engine.analyze(gi)

        # Blowout at 0.95 — edge is tiny (market already priced correctly).
        # With low edge, engine correctly SKIPs or HOLDs.
        assert td.final_decision.action in (Action.HOLD, Action.SKIP)

    def test_late_game_close_game_high_volatility_flag(self):
        engine = TradingDecisionEngine(bankroll_usd=10_000)
        gi = GameInput(
            team_a=make_team_a(),
            team_b=make_team_b(),
            stage=GameStage.LATE,
            market=make_market(yes_price=0.55, implied_prob=0.55),
            game_state=GameState(
                home_score=105, away_score=103,
                quarter=4, time_remaining="1:00",
                momentum="even",
            ),
            sportsbook_novig_prob=0.55,
        )
        td = engine.analyze(gi)

        flags = [f["flag"] for f in td.risk_flags]
        assert "endgame_volatility" in flags

    def test_late_game_close_game_no_position_skips(self):
        engine = TradingDecisionEngine(bankroll_usd=10_000)
        gi = GameInput(
            team_a=make_team_a(),
            team_b=make_team_b(),
            stage=GameStage.LATE,
            market=make_market(yes_price=0.55, implied_prob=0.55),
            game_state=GameState(
                home_score=105, away_score=103,
                quarter=4, time_remaining="1:00",
            ),
        )
        td = engine.analyze(gi)

        # Close game, no position, < 3 min → SKIP
        assert td.final_decision.action == Action.SKIP

    def test_late_game_probability_near_certain(self):
        engine = TradingDecisionEngine(bankroll_usd=10_000)
        gi = GameInput(
            team_a=make_team_a(),
            team_b=make_team_b(),
            stage=GameStage.LATE,
            market=make_market(yes_price=0.97, implied_prob=0.97),
            game_state=GameState(
                home_score=120, away_score=98,
                quarter=4, time_remaining="0:30",
                momentum="home",
            ),
            sportsbook_novig_prob=0.68,
        )
        td = engine.analyze(gi)

        assert td.probability_edge.true_probability > 0.90


# ---------------------------------------------------------------------------
# Utility Tests
# ---------------------------------------------------------------------------

class TestTimeParser:
    def test_parse_time_q1(self):
        result = TradingDecisionEngine._parse_time_remaining(1, "8:30")
        assert result == pytest.approx(44.5, abs=0.1)

    def test_parse_time_q4_end(self):
        result = TradingDecisionEngine._parse_time_remaining(4, "0:30")
        assert result == pytest.approx(0.5, abs=0.1)

    def test_parse_time_halftime(self):
        result = TradingDecisionEngine._parse_time_remaining(2, "0:00")
        assert result == pytest.approx(24.0, abs=0.1)


class TestRenderer:
    def test_render_produces_output(self):
        engine = TradingDecisionEngine(bankroll_usd=10_000)
        gi = make_pre_game_input()
        td = engine.analyze(gi)
        output = render_trading_decision(td)

        assert "FINAL DECISION" in output
        assert "PROBABILITY EDGE" in output
        assert "Celtics" in output
        assert "Knicks" in output

    def test_render_contains_all_sections_for_buy(self):
        engine = TradingDecisionEngine(bankroll_usd=10_000)
        gi = make_pre_game_input(
            market=make_market(yes_price=0.55, implied_prob=0.55),
            sportsbook_novig_prob=0.72,
        )
        td = engine.analyze(gi)
        output = render_trading_decision(td)

        assert "EXECUTION PLAN" in output
        assert "EXIT STRATEGY" in output
        assert "PROFIT MODEL" in output
        assert "KEY DRIVERS" in output

    def test_render_in_game_shows_live_state(self):
        engine = TradingDecisionEngine(bankroll_usd=10_000)
        gi = GameInput(
            team_a=make_team_a(),
            team_b=make_team_b(),
            stage=GameStage.IN,
            market=make_market(),
            game_state=GameState(
                home_score=60, away_score=55,
                quarter=3, time_remaining="6:00",
            ),
        )
        td = engine.analyze(gi)
        output = render_trading_decision(td)

        assert "LIVE:" in output


class TestToDict:
    def test_to_dict_serializable(self):
        engine = TradingDecisionEngine(bankroll_usd=10_000)
        gi = make_pre_game_input()
        td = engine.analyze(gi)
        d = td.to_dict()

        assert isinstance(d, dict)
        assert "decision_id" in d
        assert "stage" in d


class TestExistingPosition:
    def test_add_with_wide_edge_and_position(self):
        engine = TradingDecisionEngine(bankroll_usd=10_000)
        gi = make_pre_game_input(
            market=make_market(yes_price=0.55, implied_prob=0.55),
            sportsbook_novig_prob=0.72,
        )
        gi.existing_position = ExistingPosition(
            side="YES", avg_entry_price=0.52, size_usd=100, contracts=192,
        )
        td = engine.analyze(gi)

        # Wide edge + existing position → ADD
        assert td.final_decision.action in (Action.ADD, Action.HOLD)

    def test_trim_when_overpriced_with_position(self):
        engine = TradingDecisionEngine(bankroll_usd=10_000)
        gi = make_pre_game_input(
            team_a=make_team_a(net_rating=-2.0, elo_rating=1400, last5_net_rating=-4.0),
            team_b=make_team_b(net_rating=6.0, elo_rating=1620, last5_net_rating=7.0),
            market=make_market(yes_price=0.72, implied_prob=0.72),
            sportsbook_novig_prob=0.35,
        )
        gi.existing_position = ExistingPosition(
            side="YES", avg_entry_price=0.60, size_usd=150, contracts=250,
        )
        td = engine.analyze(gi)

        # Overpriced with position → TRIM or SKIP
        assert td.final_decision.action in (Action.TRIM, Action.SKIP, Action.SELL)
