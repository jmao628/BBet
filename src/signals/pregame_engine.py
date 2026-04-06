"""
Pre-Game Decision Engine — Complete trading decision framework.

Analyzes basketball games BEFORE tipoff to determine:
1. Whether to trade (and which direction)
2. How much to stake (Kelly-based sizing)
3. Entry strategy (full / scale-in)
4. Exit zones (take-profit / stop-loss)
5. Hedge recommendations
6. Risk alerts

All calculations use Kalshi contract math:
  Buy YES at P¢: cost = P/100 per contract
  If YES wins:   payout = $1.00, profit = (100-P)/100 - fee
  If YES loses:  loss = P/100
  Fee: ~2¢ per contract on winning side (capped)
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


# ── Kalshi Fee Structure ─────────────────────────────────────────────
KALSHI_FEE_PER_CONTRACT = 0.02  # $0.02 per contract on winning trades
KALSHI_FEE_RATE = 0.02          # 2% of profit, capped at 2¢


def kalshi_fee(price_cents: int, quantity: int) -> float:
    """Fee on winning side: min(2% of profit, 2¢) per contract."""
    profit_per = (100 - price_cents) / 100
    fee_per = min(profit_per * KALSHI_FEE_RATE, KALSHI_FEE_PER_CONTRACT)
    return fee_per * quantity


# ── Data Structures ──────────────────────────────────────────────────

@dataclass
class FundamentalsProfile:
    """Team fundamental data for pre-game analysis."""
    team_name: str = ""
    season_win_pct: float = 0.5
    home_win_pct: float = 0.5      # or road_win_pct
    is_home: bool = True
    last5_wins: int = 3
    last5_losses: int = 2
    last10_wins: int = 5
    last10_losses: int = 5
    off_rating: float = 110.0      # per 100 possessions
    def_rating: float = 110.0
    net_rating: float = 0.0
    pace: float = 100.0
    elo: float = 1500.0
    win_streak: int = 0            # negative = loss streak
    rest_days: int = 2
    is_b2b: bool = False
    injury_impact: float = 0.0     # 0-1, higher = more injured
    key_injuries: list[str] = field(default_factory=list)
    h2h_wins_season: int = 0
    h2h_losses_season: int = 0
    playoff_context: str = "Regular Season"  # "Playoff R1 G3", "Elimination"


@dataclass
class MarketData:
    """Real-time market data from Kalshi."""
    ticker: str = ""
    team_name: str = ""
    yes_bid: float = 0.0       # best bid to sell YES
    yes_ask: float = 0.0       # best ask to buy YES
    no_bid: float = 0.0        # best bid to sell NO
    no_ask: float = 0.0        # best ask to buy NO
    last_price: float = 0.0
    volume: int = 0
    volume_24h: int = 0
    open_interest: int = 0
    yes_depth: float = 0.0     # $ depth on YES side
    no_depth: float = 0.0      # $ depth on NO side
    spread: float = 0.0        # yes_ask - yes_bid


@dataclass
class ExitZone:
    """A take-profit or stop-loss zone."""
    price: float               # cents
    pct_to_sell: float         # 0-1
    expected_pnl_per_contract: float
    label: str                 # "TP1", "TP2", "TP3", "STOP"


@dataclass
class HedgeRecommendation:
    should_hedge: bool = False
    hedge_side: str = ""           # "YES" or "NO"
    hedge_size_pct: float = 0.0    # % of position to hedge
    hedge_price: float = 0.0       # price to buy hedge at
    hedge_cost: float = 0.0
    reason: str = ""
    guaranteed_min_pnl: float = 0.0  # worst case after hedge


@dataclass
class PreGameAnalysis:
    """Complete pre-game trading decision output."""
    # Core decision
    trade_decision: bool = False
    direction: str = "SKIP"        # YES / NO / SKIP
    skip_reason: str = ""

    # Probability analysis
    fundamental_prob: float = 0.5  # our estimated true probability
    market_prob: float = 0.5       # market-implied probability
    blended_fair_prob: float = 0.5
    prob_source_weights: dict = field(default_factory=dict)

    # Market execution
    entry_price: float = 0.0       # price to buy at (ask)
    entry_price_cents: int = 0
    spread_cents: int = 0

    # Edge analysis
    edge: float = 0.0              # fair_prob - entry_price
    edge_pct: float = 0.0          # edge as % of entry price
    expected_value: float = 0.0    # EV per dollar risked
    expected_value_per_contract: float = 0.0

    # Position sizing (Kalshi contract math)
    kelly_fraction: float = 0.0
    kelly_quarter: float = 0.0
    suggested_stake_usd: float = 0.0
    suggested_contracts: int = 0
    max_position_usd: float = 0.0

    # Entry strategy
    entry_strategy: str = "FULL"   # FULL / SCALE_IN_2 / SCALE_IN_3
    scale_in_tranches: list[dict] = field(default_factory=list)

    # Exit strategy
    stop_loss_price: float = 0.0
    stop_loss_pct: float = 0.0     # % loss at stop
    take_profit_zones: list[ExitZone] = field(default_factory=list)
    trailing_stop_cents: int = 8

    # Hedging
    hedge: HedgeRecommendation = field(default_factory=HedgeRecommendation)

    # Expected outcomes
    expected_profit_if_correct: float = 0.0  # hold to settlement
    expected_profit_pregame: float = 0.0     # sell before game
    max_loss: float = 0.0

    # Confidence
    confidence_score: float = 0.0
    confidence_tier: str = "LOW"

    # Risk
    risk_alerts: list[str] = field(default_factory=list)
    key_factors: list[dict] = field(default_factory=list)

    # Meta
    phase: str = "PRE_GAME"
    analysis_time: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    time_to_game_hours: float = 0.0
    home_team: str = ""
    away_team: str = ""
    game_title: str = ""

    def summary(self) -> str:
        if not self.trade_decision:
            return f"SKIP — {self.skip_reason}"
        return (
            f"{self.direction} {self.suggested_contracts} contracts @ "
            f"{self.entry_price_cents}¢ (${self.suggested_stake_usd:.2f}) | "
            f"Edge {self.edge_pct:.1f}% | EV ${self.expected_value_per_contract:.3f}/contract | "
            f"Conf {self.confidence_tier}"
        )


# ── Pre-Game Engine ──────────────────────────────────────────────────

HOME_COURT_ADV_REGULAR = 0.035   # +3.5% for home team (regular season)
HOME_COURT_ADV_PLAYOFF = 0.020   # +2.0% for home team (playoffs)
REST_ADV_PER_DAY = 0.015         # +1.5% per extra rest day
B2B_PENALTY = 0.030              # -3.0% for back-to-back
MOMENTUM_WEIGHT = 0.010          # per game above .500 in last 5
INJURY_IMPACT_SCALE = 0.15       # max probability shift from injuries
H2H_WEIGHT = 0.005              # per H2H win above 50%


class PreGameEngine:
    """
    Analyzes a basketball game and produces a complete trading recommendation.

    Usage:
        engine = PreGameEngine(bankroll=10000)
        analysis = engine.analyze(
            home_market=MarketData(...),
            away_market=MarketData(...),
            home_fund=FundamentalsProfile(...),
            away_fund=FundamentalsProfile(...),
            time_to_game_hours=12.0,
        )
        print(analysis.summary())
    """

    def __init__(self, bankroll: float = 10000.0, max_position_pct: float = 0.02):
        self.bankroll = bankroll
        self.max_position_pct = max_position_pct

    def analyze(
        self,
        home_market: MarketData,
        away_market: MarketData,
        home_fund: FundamentalsProfile,
        away_fund: FundamentalsProfile,
        time_to_game_hours: float = 12.0,
        existing_exposure_usd: float = 0.0,
    ) -> PreGameAnalysis:
        """Main entry point — produces complete pre-game analysis."""

        result = PreGameAnalysis(
            home_team=home_fund.team_name,
            away_team=away_fund.team_name,
            game_title=f"{away_fund.team_name} at {home_fund.team_name}",
            time_to_game_hours=time_to_game_hours,
        )

        # Step 1: Compute fair probabilities
        fund_prob_home = self._fundamental_fair_prob(home_fund, away_fund)
        market_prob_home = self._market_fair_prob(home_market)
        blended_home = self._blend_probabilities(
            fund_prob_home, market_prob_home, None, time_to_game_hours
        )

        result.fundamental_prob = round(fund_prob_home, 4)
        result.market_prob = round(market_prob_home, 4)
        result.blended_fair_prob = round(blended_home, 4)

        # Step 2: Determine direction — which side has more edge?
        home_ask = home_market.yes_ask
        away_ask = away_market.yes_ask
        home_edge = blended_home - home_ask
        away_edge = (1 - blended_home) - away_ask

        if home_edge > away_edge and home_edge > 0:
            result.direction = "YES"  # bet on home team
            result.entry_price = home_ask
            result.edge = home_edge
            fair = blended_home
            mkt = home_market
        elif away_edge > home_edge and away_edge > 0:
            result.direction = "NO"   # bet on away team (buy away YES)
            result.entry_price = away_ask
            result.edge = away_edge
            fair = 1 - blended_home
            mkt = away_market
        else:
            result.direction = "SKIP"
            result.skip_reason = f"no_positive_edge (home={home_edge:.4f}, away={away_edge:.4f})"
            result.edge = max(home_edge, away_edge)
            self._add_key_factors(result, home_fund, away_fund, fund_prob_home)
            return result

        result.entry_price_cents = round(result.entry_price * 100)
        result.spread_cents = round(abs(mkt.yes_ask - mkt.yes_bid) * 100)
        result.edge_pct = round(result.edge / result.entry_price * 100, 2) if result.entry_price > 0 else 0

        # Step 3: Expected value
        result.expected_value, result.expected_value_per_contract = self._compute_ev(
            fair, result.entry_price
        )

        # Step 4: Kelly sizing
        result.kelly_fraction, result.kelly_quarter, stake, contracts = self._compute_kelly(
            fair, result.entry_price, mkt.yes_depth + mkt.no_depth, existing_exposure_usd
        )
        result.suggested_stake_usd = stake
        result.suggested_contracts = contracts
        result.max_position_usd = round(self.bankroll * self.max_position_pct, 2)

        # Step 5: Confidence scoring
        result.confidence_score, result.confidence_tier = self._compute_confidence(
            result.edge, result.spread_cents, mkt.volume_24h,
            home_fund.injury_impact + away_fund.injury_impact,
            time_to_game_hours, fund_prob_home, market_prob_home,
        )

        # Step 6: Apply go/no-go filters
        passed, reason = self._apply_filters(result, mkt, time_to_game_hours)
        if not passed:
            result.trade_decision = False
            result.direction = "SKIP"
            result.skip_reason = reason
            self._add_key_factors(result, home_fund, away_fund, fund_prob_home)
            return result

        result.trade_decision = True

        # Step 7: Entry strategy
        entry = self._entry_strategy(result.edge, result.confidence_tier,
                                      time_to_game_hours, result.spread_cents,
                                      result.entry_price_cents)
        result.entry_strategy = entry["strategy"]
        result.scale_in_tranches = entry.get("tranches", [])

        # Step 8: Exit zones
        result.take_profit_zones, result.stop_loss_price, result.stop_loss_pct = (
            self._exit_zones(result.entry_price_cents, fair)
        )

        # Step 9: Expected profits
        fee = kalshi_fee(result.entry_price_cents, result.suggested_contracts)
        result.expected_profit_if_correct = round(
            result.suggested_contracts * (100 - result.entry_price_cents) / 100 - fee, 2
        )
        result.max_loss = round(result.suggested_stake_usd, 2)
        # Pre-game exit: if market moves halfway to fair value
        pregame_target = (result.entry_price + fair) / 2
        result.expected_profit_pregame = round(
            result.suggested_contracts * (pregame_target - result.entry_price) - fee * 0.5, 2
        )

        # Step 10: Hedge recommendation
        result.hedge = self._hedge_recommendation(
            result, home_fund, away_fund, home_market, away_market
        )

        # Step 11: Risk alerts
        result.risk_alerts = self._risk_alerts(result, mkt, home_fund, away_fund, time_to_game_hours)

        # Step 12: Key factors
        self._add_key_factors(result, home_fund, away_fund, fund_prob_home)

        return result

    # ── Internal Methods ─────────────────────────────────────────────

    def _fundamental_fair_prob(self, home: FundamentalsProfile, away: FundamentalsProfile) -> float:
        """Compute home win probability from fundamentals."""
        # Base: Elo win probability
        elo_diff = home.elo - away.elo
        elo_prob = 1.0 / (1 + 10 ** (-elo_diff / 400))

        # Net rating adjustment
        nr_diff = home.net_rating - away.net_rating
        nr_adj = nr_diff * 0.015  # ~1.5% per net rating point

        # Home court advantage
        is_playoff = "playoff" in home.playoff_context.lower() or "elimination" in home.playoff_context.lower()
        hca = HOME_COURT_ADV_PLAYOFF if is_playoff else HOME_COURT_ADV_REGULAR

        # Rest advantage
        rest_diff = home.rest_days - away.rest_days
        rest_adj = rest_diff * REST_ADV_PER_DAY
        b2b_adj = 0.0
        if home.is_b2b:
            b2b_adj -= B2B_PENALTY
        if away.is_b2b:
            b2b_adj += B2B_PENALTY

        # Injury adjustment
        inj_adj = (away.injury_impact - home.injury_impact) * INJURY_IMPACT_SCALE

        # Recent form momentum
        home_last5_pct = home.last5_wins / max(home.last5_wins + home.last5_losses, 1)
        away_last5_pct = away.last5_wins / max(away.last5_wins + away.last5_losses, 1)
        momentum_adj = (home_last5_pct - away_last5_pct - (home.season_win_pct - away.season_win_pct)) * MOMENTUM_WEIGHT * 5

        # H2H adjustment
        h2h_total = home.h2h_wins_season + home.h2h_losses_season
        h2h_adj = 0.0
        if h2h_total >= 2:
            h2h_pct = home.h2h_wins_season / h2h_total
            h2h_adj = (h2h_pct - 0.5) * H2H_WEIGHT * h2h_total

        # Combine
        prob = elo_prob + nr_adj + hca + rest_adj + b2b_adj + inj_adj + momentum_adj + h2h_adj
        return max(0.05, min(0.95, prob))

    def _market_fair_prob(self, market: MarketData) -> float:
        """Market-implied probability from bid/ask."""
        if market.yes_bid > 0 and market.yes_ask > 0:
            mid = (market.yes_bid + market.yes_ask) / 2
            # Slight adjustment toward last price (more recent signal)
            if market.last_price > 0:
                return mid * 0.7 + market.last_price * 0.3
            return mid
        return market.last_price if market.last_price > 0 else 0.5

    def _blend_probabilities(
        self, fund_prob: float, market_prob: float,
        model_prob: float | None, time_to_game: float,
    ) -> float:
        """Time-weighted probability blend."""
        if time_to_game > 24:
            # Far from game: fundamentals matter more
            w_fund, w_market = 0.55, 0.45
        elif time_to_game > 6:
            # Medium: balanced
            w_fund, w_market = 0.40, 0.60
        else:
            # Close to game: market is most efficient
            w_fund, w_market = 0.25, 0.75

        if model_prob is not None:
            # If we have a model, split fundamental weight
            w_model = w_fund * 0.5
            w_fund = w_fund * 0.5
            blended = w_fund * fund_prob + w_model * model_prob + w_market * market_prob
        else:
            blended = w_fund * fund_prob + w_market * market_prob

        return max(0.05, min(0.95, blended))

    def _compute_ev(self, fair_prob: float, ask_price: float) -> tuple[float, float]:
        """Expected value per dollar and per contract."""
        if ask_price <= 0 or ask_price >= 1:
            return 0.0, 0.0
        # Per contract: fair_prob * (1 - ask - fee) - (1 - fair_prob) * ask
        payout_if_win = 1.0 - ask_price - KALSHI_FEE_PER_CONTRACT
        cost_if_lose = ask_price
        ev_per_contract = fair_prob * payout_if_win - (1 - fair_prob) * cost_if_lose
        ev_per_dollar = ev_per_contract / ask_price if ask_price > 0 else 0
        return round(ev_per_dollar, 4), round(ev_per_contract, 4)

    def _compute_kelly(
        self, fair_prob: float, ask_price: float,
        depth: float, existing_exposure: float,
    ) -> tuple[float, float, float, int]:
        """Kelly criterion sizing with safety caps."""
        if ask_price <= 0 or ask_price >= 1:
            return 0, 0, 0, 0

        # Net odds: what you get per dollar risked if you win
        b = (1 - ask_price - KALSHI_FEE_PER_CONTRACT) / ask_price
        if b <= 0:
            return 0, 0, 0, 0

        p = fair_prob
        q = 1 - p
        kelly_full = max(0, (b * p - q) / b)
        kelly_quarter = kelly_full * 0.25

        # Caps
        max_from_bankroll = self.bankroll * self.max_position_pct
        max_from_depth = depth * 0.30 if depth > 0 else max_from_bankroll
        max_from_exposure = max(0, self.bankroll * 0.15 - existing_exposure)

        stake = self.bankroll * kelly_quarter
        stake = min(stake, max_from_bankroll, max_from_depth, max_from_exposure)
        stake = max(0, round(stake, 2))

        contracts = int(stake / ask_price) if ask_price > 0 else 0

        return round(kelly_full, 4), round(kelly_quarter, 4), stake, contracts

    def _compute_confidence(
        self, edge: float, spread_cents: int, volume_24h: int,
        total_injury_impact: float, time_to_game: float,
        fund_prob: float, market_prob: float,
    ) -> tuple[float, str]:
        """Composite confidence score [0, 1]."""
        # Edge score: 0-1 (target: >8% is great)
        edge_s = min(1.0, max(0, edge) / 0.10)

        # Spread score: tighter is better
        spread_s = max(0, 1.0 - spread_cents / 8)

        # Liquidity score
        liq_s = min(1.0, volume_24h / 50000) if volume_24h > 0 else 0.1

        # Model-market agreement
        disagree = abs(fund_prob - market_prob)
        agree_s = max(0, 1.0 - disagree / 0.15)

        # Injury certainty
        inj_s = 1.0 - total_injury_impact

        # Time factor: closer to game = more certain
        time_s = min(1.0, max(0, 1.0 - time_to_game / 48))

        score = (
            0.30 * edge_s +
            0.15 * spread_s +
            0.15 * liq_s +
            0.20 * agree_s +
            0.10 * inj_s +
            0.10 * time_s
        )
        score = round(max(0, min(1, score)), 3)
        tier = "HIGH" if score >= 0.70 else "MED" if score >= 0.45 else "LOW"
        return score, tier

    def _apply_filters(self, result: PreGameAnalysis, mkt: MarketData, ttg: float) -> tuple[bool, str]:
        """Go/no-go filters. Returns (passed, reason)."""
        checks = [
            (result.edge < 0.03, f"edge_too_low: {result.edge:.4f} < 0.03"),
            (result.expected_value < 0.02, f"ev_too_low: {result.expected_value:.4f}"),
            (result.confidence_score < 0.35, f"confidence_too_low: {result.confidence_score:.3f}"),
            (result.spread_cents > 10, f"spread_too_wide: {result.spread_cents}¢"),
            (mkt.volume_24h < 500 and mkt.volume < 1000, "liquidity_too_low"),
            (ttg < 0.25, "too_close_to_tipoff"),
            (ttg > 96, "too_far_from_game"),
            (result.suggested_contracts < 1, "position_too_small"),
        ]
        for failed, reason in checks:
            if failed:
                return False, reason
        return True, ""

    def _entry_strategy(
        self, edge: float, tier: str, ttg: float, spread: int, price_cents: int,
    ) -> dict:
        """Determine entry approach."""
        if edge > 0.08 and tier == "HIGH":
            return {"strategy": "FULL", "tranches": [{"pct": 1.0, "price": price_cents}]}

        if edge > 0.06 and spread <= 3:
            return {"strategy": "FULL", "tranches": [{"pct": 1.0, "price": price_cents}]}

        if ttg > 12 and edge > 0.04:
            # Scale in over time
            return {
                "strategy": "SCALE_IN_3",
                "tranches": [
                    {"pct": 0.40, "price": price_cents, "label": "Now"},
                    {"pct": 0.30, "price": max(1, price_cents - 2), "label": f"If drops to {max(1, price_cents-2)}¢"},
                    {"pct": 0.30, "price": max(1, price_cents - 4), "label": f"If drops to {max(1, price_cents-4)}¢"},
                ],
            }

        if spread > 5:
            return {
                "strategy": "SCALE_IN_2",
                "tranches": [
                    {"pct": 0.50, "price": price_cents, "label": "Now"},
                    {"pct": 0.50, "price": max(1, price_cents - 2), "label": f"Limit at {max(1, price_cents-2)}¢"},
                ],
            }

        return {"strategy": "FULL", "tranches": [{"pct": 1.0, "price": price_cents}]}

    def _exit_zones(self, entry_cents: int, fair_prob: float) -> tuple[list[ExitZone], float, float]:
        """Compute take-profit zones and stop-loss."""
        fair_cents = round(fair_prob * 100)
        zones = []

        # TP1: 30% of position at halfway to fair
        tp1 = entry_cents + max(2, (fair_cents - entry_cents) // 2)
        zones.append(ExitZone(
            price=tp1, pct_to_sell=0.30,
            expected_pnl_per_contract=(tp1 - entry_cents) / 100,
            label="TP1 — Early profit",
        ))

        # TP2: 40% at fair value
        tp2 = fair_cents
        zones.append(ExitZone(
            price=tp2, pct_to_sell=0.40,
            expected_pnl_per_contract=(tp2 - entry_cents) / 100,
            label="TP2 — Fair value",
        ))

        # TP3: 30% held for strong move beyond fair
        tp3 = min(95, fair_cents + max(5, (100 - fair_cents) // 3))
        zones.append(ExitZone(
            price=tp3, pct_to_sell=0.30,
            expected_pnl_per_contract=(tp3 - entry_cents) / 100,
            label="TP3 — Strong conviction hold",
        ))

        # Stop loss: 30% below entry
        stop = max(1, round(entry_cents * 0.70))
        stop_pct = (entry_cents - stop) / entry_cents * 100

        return zones, stop, round(stop_pct, 1)

    def _hedge_recommendation(
        self, result: PreGameAnalysis,
        home_fund: FundamentalsProfile, away_fund: FundamentalsProfile,
        home_mkt: MarketData, away_mkt: MarketData,
    ) -> HedgeRecommendation:
        """Determine if position should be hedged."""
        total_injury_unc = home_fund.injury_impact + away_fund.injury_impact
        is_elimination = "elimination" in home_fund.playoff_context.lower()

        # Scenario 1: High injury uncertainty with moderate edge
        if total_injury_unc > 0.5 and result.edge < 0.08:
            hedge_pct = 0.30
            reason = f"High injury uncertainty ({total_injury_unc:.2f}) with moderate edge"
        # Scenario 2: Low confidence but positive edge
        elif result.confidence_tier == "LOW" and result.edge > 0.03:
            hedge_pct = 0.20
            reason = "Low confidence — reduce risk"
        # Scenario 3: Elimination game
        elif is_elimination:
            hedge_pct = 0.15
            reason = "Playoff elimination — high variance game"
        else:
            return HedgeRecommendation(should_hedge=False)

        # Hedge by buying opposite side
        if result.direction == "YES":
            hedge_side = "NO"
            hedge_price = home_mkt.no_ask
        else:
            hedge_side = "YES"
            opp_mkt = home_mkt if result.direction == "NO" else away_mkt
            hedge_price = opp_mkt.yes_ask

        hedge_contracts = int(result.suggested_contracts * hedge_pct)
        hedge_cost = hedge_price * hedge_contracts

        # Guaranteed min P&L if hedged (worst case)
        main_loss = result.entry_price * result.suggested_contracts
        hedge_win = (1 - hedge_price) * hedge_contracts
        guaranteed_min = -(main_loss - hedge_win)

        return HedgeRecommendation(
            should_hedge=True,
            hedge_side=hedge_side,
            hedge_size_pct=hedge_pct,
            hedge_price=hedge_price,
            hedge_cost=round(hedge_cost, 2),
            reason=reason,
            guaranteed_min_pnl=round(guaranteed_min, 2),
        )

    def _risk_alerts(
        self, result: PreGameAnalysis, mkt: MarketData,
        home: FundamentalsProfile, away: FundamentalsProfile,
        ttg: float,
    ) -> list[str]:
        """Generate risk warnings."""
        alerts = []
        if result.spread_cents > 5:
            alerts.append(f"Wide spread ({result.spread_cents}¢) — execution slippage risk")
        if any(home.key_injuries) or any(away.key_injuries):
            all_inj = home.key_injuries + away.key_injuries
            alerts.append(f"Key injuries: {', '.join(all_inj[:3])}")
        if mkt.yes_depth + mkt.no_depth < 5000:
            alerts.append(f"Low liquidity (${mkt.yes_depth + mkt.no_depth:,.0f} depth) — may not fill full size")
        if ttg < 2:
            alerts.append("Game in <2h — odds may shift rapidly on late news")
        if home.is_b2b or away.is_b2b:
            b2b_team = home.team_name if home.is_b2b else away.team_name
            alerts.append(f"{b2b_team} on back-to-back — fatigue risk")
        if "elimination" in home.playoff_context.lower():
            alerts.append("Playoff elimination game — high variance, emotional play")
        if result.edge < 0.05:
            alerts.append(f"Marginal edge ({result.edge:.1%}) — only trade if confident in model")
        if abs(result.fundamental_prob - result.market_prob) > 0.10:
            alerts.append(f"Model-market divergence: {abs(result.fundamental_prob - result.market_prob):.1%} — check assumptions")
        return alerts

    def _add_key_factors(
        self, result: PreGameAnalysis,
        home: FundamentalsProfile, away: FundamentalsProfile,
        fund_prob: float,
    ) -> None:
        """Add key driving factors to the analysis."""
        factors = []
        nr_diff = home.net_rating - away.net_rating
        if abs(nr_diff) > 3:
            factors.append({"factor": "Net Rating Gap", "value": f"{nr_diff:+.1f}", "impact": "strong" if abs(nr_diff) > 6 else "moderate"})

        elo_diff = home.elo - away.elo
        if abs(elo_diff) > 50:
            factors.append({"factor": "Elo Advantage", "value": f"{elo_diff:+.0f}", "impact": "strong" if abs(elo_diff) > 100 else "moderate"})

        if home.is_b2b or away.is_b2b:
            team = home.team_name if home.is_b2b else away.team_name
            factors.append({"factor": "Back-to-Back", "value": team, "impact": "negative"})

        rest_diff = home.rest_days - away.rest_days
        if abs(rest_diff) >= 2:
            factors.append({"factor": "Rest Advantage", "value": f"{rest_diff:+d} days", "impact": "moderate"})

        if home.injury_impact > 0.3 or away.injury_impact > 0.3:
            team = home.team_name if home.injury_impact > away.injury_impact else away.team_name
            factors.append({"factor": "Injury Impact", "value": f"{team} ({max(home.injury_impact, away.injury_impact):.0%})", "impact": "strong"})

        h5_home = home.last5_wins / max(home.last5_wins + home.last5_losses, 1)
        h5_away = away.last5_wins / max(away.last5_wins + away.last5_losses, 1)
        if abs(h5_home - h5_away) > 0.4:
            hot = home.team_name if h5_home > h5_away else away.team_name
            factors.append({"factor": "Recent Form", "value": f"{hot} hot ({int(max(h5_home,h5_away)*5)}-{5-int(max(h5_home,h5_away)*5)} L5)", "impact": "moderate"})

        result.key_factors = factors[:6]
