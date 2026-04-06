"""
Trading Decision Engine — 3-stage basketball prediction market decision system.

Stages:
  PRE-GAME:  Fundamentals + matchup + market pricing analysis
  IN-GAME:   Live game state integration with momentum tracking
  LATE-GAME: Endgame volatility management and exit optimization

Integrates with existing SignalEngine, ensemble, and risk management.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any

import numpy as np
import structlog

from src.config import cfg
from src.etl.odds_transformer import (
    compute_edge,
    compute_expected_value,
    compute_kelly_fraction,
    market_price_to_executable_prob,
)
from src.models.ensemble import compute_confidence_score, compute_ensemble_fair_prob

log = structlog.get_logger(__name__)

THRESHOLDS = cfg["thresholds"]
RISK_CFG = cfg["risk"]


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class GameStage(str, Enum):
    PRE = "PRE"
    IN = "IN"
    LATE = "LATE"


class Action(str, Enum):
    BUY = "BUY"
    ADD = "ADD"
    HOLD = "HOLD"
    TRIM = "TRIM"
    SELL = "SELL"
    SKIP = "SKIP"


class Confidence(str, Enum):
    LOW = "LOW"
    MED = "MED"
    HIGH = "HIGH"


class MispricingVerdict(str, Enum):
    UNDERPRICED = "underpriced"
    OVERPRICED = "overpriced"
    FAIR = "fair"


# ---------------------------------------------------------------------------
# Input Data Models
# ---------------------------------------------------------------------------

@dataclass
class TeamFundamentals:
    name: str
    record: str = ""
    win_rate: float = 0.5
    home_record: str = ""
    away_record: str = ""
    last_5: str = ""
    last_10: str = ""
    points_per_game: float = 0.0
    points_against: float = 0.0
    fg_pct: float = 0.0
    rebounds: float = 0.0
    assists: float = 0.0
    blocks: float = 0.0
    steals: float = 0.0
    # Advanced
    off_rating: float = 110.0
    def_rating: float = 110.0
    net_rating: float = 0.0
    pace: float = 100.0
    efg_pct: float = 0.50
    tov_pct: float = 14.0
    # Form
    last5_net_rating: float = 0.0
    home_net_rating: float = 0.0
    road_net_rating: float = 0.0
    elo_rating: float = 1500.0
    win_streak: int = 0
    # Injury / rest
    rest_days: int = 3
    is_back_to_back: bool = False
    injury_impact: float = 0.0
    has_gtd_star: bool = False


@dataclass
class KalshiMarket:
    yes_price: float
    implied_prob: float
    price_change: str = "flat"  # "up" / "down" / "flat"
    yes_bid: float | None = None
    yes_ask: float | None = None
    spread: float = 0.0
    volume_24h: float = 0.0
    depth_3c_usd: float = 500.0


@dataclass
class GameState:
    """Live game state — only populated for IN-GAME and LATE-GAME stages."""
    home_score: int = 0
    away_score: int = 0
    quarter: int = 1
    time_remaining: str = "12:00"
    momentum: str = ""  # "home" / "away" / "even"
    home_fg_pct_live: float | None = None
    away_fg_pct_live: float | None = None
    lead_changes: int = 0
    largest_lead: int = 0
    largest_lead_team: str = ""


@dataclass
class HeadToHead:
    season_series: str = ""
    home_wins_h2h: int = 0
    away_wins_h2h: int = 0
    avg_margin: float = 0.0
    note: str = ""


@dataclass
class ExistingPosition:
    """Tracks if trader already has a position in this market."""
    side: str = ""  # "YES" / "NO" / ""
    avg_entry_price: float = 0.0
    size_usd: float = 0.0
    contracts: int = 0


@dataclass
class GameInput:
    """All input data for a single trading decision."""
    team_a: TeamFundamentals
    team_b: TeamFundamentals
    stage: GameStage
    market: KalshiMarket
    game_state: GameState | None = None
    h2h: HeadToHead | None = None
    existing_position: ExistingPosition | None = None
    sportsbook_novig_prob: float | None = None
    game_time_utc: datetime | None = None
    fee_pct: float = 0.02


# ---------------------------------------------------------------------------
# Output Data Models
# ---------------------------------------------------------------------------

@dataclass
class ProbabilityEdge:
    true_probability: float
    market_probability: float
    edge: float
    verdict: MispricingVerdict
    ci_lower: float = 0.0
    ci_upper: float = 0.0


@dataclass
class PriceMovementAnalysis:
    direction: str  # "up" / "down" / "flat"
    interpretation: str
    is_justified: bool
    overreaction_score: float = 0.0  # 0-1, higher = more overreaction


@dataclass
class RiskReward:
    upside_pct: float
    downside_pct: float
    risk_reward_ratio: float
    volatility_risk: str  # "LOW" / "MEDIUM" / "HIGH"
    stage_risk_note: str = ""


@dataclass
class ExecutionPlan:
    entry_price: float
    position_size_usd: float
    kelly_fraction: float
    kelly_suggested: float
    max_position_usd: float
    add_zone: str = ""
    trim_zone: str = ""
    hedge_note: str = ""


@dataclass
class ExitStrategy:
    ideal_sell_range: tuple[float, float] = (0.0, 0.0)
    early_exit_zone: tuple[float, float] = (0.0, 0.0)
    aggressive_hold_zone: tuple[float, float] = (0.0, 0.0)
    stop_loss_zone: tuple[float, float] = (0.0, 0.0)
    exit_rationale: str = ""


@dataclass
class ProfitModel:
    expected_profit_if_correct: float = 0.0
    mid_game_exit_profit: float = 0.0
    worst_case_loss: float = 0.0
    breakeven_probability: float = 0.0
    expected_value_per_dollar: float = 0.0


@dataclass
class FinalDecision:
    action: Action
    side: str  # "Team A" / "Team B"
    side_team_name: str = ""
    confidence: Confidence = Confidence.LOW


@dataclass
class TradingDecision:
    """Complete output of the trading decision engine."""
    decision_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    stage: GameStage = GameStage.PRE
    team_a: str = ""
    team_b: str = ""
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    # Core outputs
    final_decision: FinalDecision | None = None
    probability_edge: ProbabilityEdge | None = None
    price_movement: PriceMovementAnalysis | None = None
    risk_reward: RiskReward | None = None
    execution_plan: ExecutionPlan | None = None
    exit_strategy: ExitStrategy | None = None
    profit_model: ProfitModel | None = None

    # Explanations
    key_drivers: list[dict[str, Any]] = field(default_factory=list)
    risk_flags: list[dict[str, Any]] = field(default_factory=list)

    # Game state summary (for IN/LATE)
    game_state_summary: str = ""

    def to_dict(self) -> dict[str, Any]:
        d = {}
        for k, v in self.__dict__.items():
            if hasattr(v, "__dict__") and not isinstance(v, (datetime, type)):
                d[k] = {kk: vv for kk, vv in v.__dict__.items()}
            elif isinstance(v, datetime):
                d[k] = v.isoformat()
            elif isinstance(v, Enum):
                d[k] = v.value
            elif isinstance(v, tuple):
                d[k] = list(v)
            else:
                d[k] = v
        return d


# ---------------------------------------------------------------------------
# Core Trading Decision Engine
# ---------------------------------------------------------------------------

class TradingDecisionEngine:
    """
    3-stage basketball trading decision engine for prediction markets.

    Combines team fundamentals, statistical matchups, market pricing,
    price movement, game state, and risk/reward dynamics into a single
    actionable trading decision with execution strategy.
    """

    def __init__(self, bankroll_usd: float = 10_000.0) -> None:
        self._bankroll = bankroll_usd

    def analyze(self, game_input: GameInput) -> TradingDecision:
        """Main entry point — analyze a game and produce a complete decision."""
        decision = TradingDecision(
            stage=game_input.stage,
            team_a=game_input.team_a.name,
            team_b=game_input.team_b.name,
        )

        # Step 1: Estimate true win probability
        true_prob = self._estimate_true_probability(game_input)

        # Step 2: Compute probability edge vs market
        decision.probability_edge = self._compute_probability_edge(
            true_prob, game_input
        )

        # Step 3: Price movement interpretation
        decision.price_movement = self._analyze_price_movement(
            game_input, decision.probability_edge
        )

        # Step 4: Risk/reward structure
        decision.risk_reward = self._compute_risk_reward(
            game_input, decision.probability_edge
        )

        # Step 5: Execution plan
        decision.execution_plan = self._build_execution_plan(
            game_input, decision.probability_edge
        )

        # Step 6: Exit strategy
        decision.exit_strategy = self._build_exit_strategy(
            game_input, decision.probability_edge
        )

        # Step 7: Profit model
        decision.profit_model = self._build_profit_model(
            game_input, decision.probability_edge, decision.execution_plan
        )

        # Step 8: Key drivers & risk flags
        decision.key_drivers = self._extract_key_drivers(game_input)
        decision.risk_flags = self._extract_risk_flags(game_input)

        # Step 9: Game state summary for live stages
        if game_input.stage in (GameStage.IN, GameStage.LATE) and game_input.game_state:
            decision.game_state_summary = self._summarize_game_state(
                game_input
            )

        # Step 10: Final decision
        decision.final_decision = self._make_final_decision(
            game_input, decision
        )

        log.info(
            "trading_decision_generated",
            stage=game_input.stage.value,
            team_a=game_input.team_a.name,
            team_b=game_input.team_b.name,
            action=decision.final_decision.action.value,
            edge=round(decision.probability_edge.edge, 4),
            confidence=decision.final_decision.confidence.value,
        )

        return decision

    # ------------------------------------------------------------------
    # Step 1: True Win Probability Estimation
    # ------------------------------------------------------------------

    def _estimate_true_probability(self, gi: GameInput) -> float:
        """
        Estimate P(Team A wins) using all available data.
        For PRE-GAME: fundamentals + matchup + sportsbook consensus.
        For IN-GAME / LATE-GAME: adjust with live game state.
        """
        a, b = gi.team_a, gi.team_b

        # --- Base probability from fundamentals ---
        # Net rating differential → win probability (logistic model)
        net_diff = a.net_rating - b.net_rating

        # Location adjustment: Team A is treated as home perspective
        if a.home_net_rating != 0 and b.road_net_rating != 0:
            loc_adj_diff = a.home_net_rating - b.road_net_rating
            net_diff = 0.6 * net_diff + 0.4 * loc_adj_diff

        # Recent form weighting (last 5 games)
        form_diff = a.last5_net_rating - b.last5_net_rating
        adjusted_diff = 0.65 * net_diff + 0.35 * form_diff

        # Home court advantage (~2.5 net rating points)
        home_advantage = cfg.get("home_advantage_net_rating", 2.5)
        adjusted_diff += home_advantage

        # Rest advantage
        rest_bonus = 0.0
        if a.is_back_to_back and not b.is_back_to_back:
            rest_bonus = -1.5
        elif b.is_back_to_back and not a.is_back_to_back:
            rest_bonus = 1.5
        rest_bonus += (a.rest_days - b.rest_days) * 0.3
        adjusted_diff += rest_bonus

        # Injury adjustment
        injury_diff = b.injury_impact - a.injury_impact  # positive = B more hurt
        adjusted_diff += injury_diff * 3.0  # scale injury impact

        # Elo blend
        elo_diff = a.elo_rating - b.elo_rating
        elo_prob = 1.0 / (1 + 10 ** (-elo_diff / 400))

        # Net-rating-based probability (logistic)
        # Empirically, ~2.5 net rating diff ≈ 1 point margin ≈ ~3.5% win prob shift
        fundamentals_prob = 1.0 / (1 + np.exp(-adjusted_diff / 5.5))

        # Blend fundamentals with Elo
        base_prob = 0.70 * float(fundamentals_prob) + 0.30 * elo_prob

        # --- Incorporate sportsbook consensus if available ---
        if gi.sportsbook_novig_prob is not None:
            base_prob = 0.55 * base_prob + 0.45 * gi.sportsbook_novig_prob

        # --- Live game state adjustment ---
        if gi.stage in (GameStage.IN, GameStage.LATE) and gi.game_state:
            base_prob = self._adjust_for_live_state(base_prob, gi)

        # Clamp to [0.02, 0.98]
        return max(0.02, min(0.98, base_prob))

    def _adjust_for_live_state(
        self, pre_game_prob: float, gi: GameInput
    ) -> float:
        """Adjust probability based on live game state."""
        gs = gi.game_state
        if gs is None:
            return pre_game_prob

        score_diff = gs.home_score - gs.away_score  # positive = Team A leading

        # Time-based weight: how much does pre-game prob still matter?
        # Parse time remaining
        total_minutes = self._parse_time_remaining(gs.quarter, gs.time_remaining)
        total_game_minutes = 48.0
        pct_complete = max(0.0, 1.0 - total_minutes / total_game_minutes)

        # As game progresses, live state dominates
        # At Q1: ~25% live, 75% pre-game
        # At Q3: ~65% live, 35% pre-game
        # At Q4 <5min: ~90% live, 10% pre-game
        live_weight = min(0.95, pct_complete ** 0.7)

        # Live win probability based on score differential + time
        # Empirical: each point lead with T minutes left has diminishing value
        if total_minutes <= 0:
            live_prob = 1.0 if score_diff > 0 else (0.5 if score_diff == 0 else 0.0)
        else:
            # Points per minute needed to overcome deficit
            pace_factor = (gi.team_a.pace + gi.team_b.pace) / 200.0
            sigma = np.sqrt(total_minutes) * 2.8 * pace_factor
            if sigma > 0:
                z = score_diff / sigma
                live_prob = float(1.0 / (1 + np.exp(-z * 1.2)))
            else:
                live_prob = 0.5

        # Momentum adjustment (small)
        if gs.momentum == "home":
            live_prob = min(0.99, live_prob + 0.02)
        elif gs.momentum == "away":
            live_prob = max(0.01, live_prob - 0.02)

        # Blend
        adjusted = (1 - live_weight) * pre_game_prob + live_weight * live_prob
        return adjusted

    @staticmethod
    def _parse_time_remaining(quarter: int, time_str: str) -> float:
        """Convert quarter + clock to total minutes remaining."""
        try:
            parts = time_str.split(":")
            minutes = int(parts[0])
            seconds = int(parts[1]) if len(parts) > 1 else 0
            clock_minutes = minutes + seconds / 60.0
        except (ValueError, IndexError):
            clock_minutes = 6.0  # default mid-quarter

        quarters_remaining = max(0, 4 - quarter)
        return quarters_remaining * 12.0 + clock_minutes

    # ------------------------------------------------------------------
    # Step 2: Probability Edge vs Market
    # ------------------------------------------------------------------

    def _compute_probability_edge(
        self, true_prob: float, gi: GameInput
    ) -> ProbabilityEdge:
        market_prob = gi.market.implied_prob
        edge = true_prob - market_prob

        # Confidence interval from ensemble logic
        _, ci_lo, ci_hi = compute_ensemble_fair_prob(
            sportsbook_novig=gi.sportsbook_novig_prob,
            model_prob=true_prob,
            calibrated_prob=None,
            market_mid=gi.market.yes_price,
            liquidity_score=min(1.0, gi.market.depth_3c_usd / 5000),
            time_to_game_hours=24.0,
        )

        # Verdict
        if edge > 0.03:
            verdict = MispricingVerdict.UNDERPRICED
        elif edge < -0.03:
            verdict = MispricingVerdict.OVERPRICED
        else:
            verdict = MispricingVerdict.FAIR

        return ProbabilityEdge(
            true_probability=round(true_prob, 4),
            market_probability=round(market_prob, 4),
            edge=round(edge, 4),
            verdict=verdict,
            ci_lower=ci_lo,
            ci_upper=ci_hi,
        )

    # ------------------------------------------------------------------
    # Step 3: Price Movement Interpretation
    # ------------------------------------------------------------------

    def _analyze_price_movement(
        self, gi: GameInput, pe: ProbabilityEdge
    ) -> PriceMovementAnalysis:
        direction = gi.market.price_change
        edge = pe.edge

        if direction == "flat":
            interpretation = "Market is stable; no significant sentiment shift."
            is_justified = True
            overreaction = 0.0
        elif direction == "up":
            if edge > 0.03:
                interpretation = (
                    "Price rising but still underpriced vs fundamentals. "
                    "Market catching up to true value — edge may narrow."
                )
                is_justified = True
                overreaction = 0.0
            elif edge < -0.03:
                interpretation = (
                    "Price rising beyond fair value. Likely emotional/momentum "
                    "buying. Potential overreaction — watch for mean reversion."
                )
                is_justified = False
                overreaction = min(1.0, abs(edge) / 0.10)
            else:
                interpretation = "Price rise aligned with fair value. Market is efficient."
                is_justified = True
                overreaction = 0.0
        else:  # "down"
            if edge > 0.05:
                interpretation = (
                    "Price dropping while fundamentals remain strong. "
                    "Potential buying opportunity — market may be overreacting "
                    "to short-term noise."
                )
                is_justified = False
                overreaction = min(1.0, edge / 0.10)
            elif edge < -0.03:
                interpretation = (
                    "Price dropping in line with weak fundamentals. "
                    "Market correction is justified."
                )
                is_justified = True
                overreaction = 0.0
            else:
                interpretation = "Price drop within noise range. No clear signal."
                is_justified = True
                overreaction = 0.1

        # Stage-specific interpretation
        if gi.stage == GameStage.LATE and gi.game_state:
            gs = gi.game_state
            total_min = self._parse_time_remaining(gs.quarter, gs.time_remaining)
            if total_min < 5:
                interpretation += (
                    f" LATE-GAME ({total_min:.1f}min left): Price movements "
                    "are highly volatile and driven by live action. "
                    "Reduced confidence in fundamental analysis."
                )
                overreaction = max(overreaction, 0.3)

        return PriceMovementAnalysis(
            direction=direction,
            interpretation=interpretation,
            is_justified=is_justified,
            overreaction_score=round(overreaction, 2),
        )

    # ------------------------------------------------------------------
    # Step 4: Risk/Reward Structure
    # ------------------------------------------------------------------

    def _compute_risk_reward(
        self, gi: GameInput, pe: ProbabilityEdge
    ) -> RiskReward:
        true_prob = pe.true_probability
        market_price = gi.market.yes_price

        # Upside: if we buy YES at market_price and win
        upside_pct = ((1.0 - market_price) / market_price) * 100 if market_price > 0 else 0
        # Downside: we lose our entire stake
        downside_pct = 100.0

        rr_ratio = upside_pct / downside_pct if downside_pct > 0 else 0

        # Volatility risk based on stage
        if gi.stage == GameStage.PRE:
            vol_risk = "MEDIUM"
            stage_note = (
                "Pre-game volatility is moderate. Injury news and line "
                "movement can shift prices before tipoff."
            )
        elif gi.stage == GameStage.IN:
            vol_risk = "HIGH"
            stage_note = (
                "In-game volatility is high. Score swings can cause rapid "
                "price movements. Monitor position actively."
            )
        else:  # LATE
            vol_risk = "HIGH"
            if gi.game_state:
                total_min = self._parse_time_remaining(
                    gi.game_state.quarter, gi.game_state.time_remaining
                )
                score_diff = abs(
                    gi.game_state.home_score - gi.game_state.away_score
                )
                if total_min < 3 and score_diff > 10:
                    vol_risk = "LOW"
                    stage_note = (
                        f"Late-game with {score_diff}pt lead and {total_min:.1f}min left. "
                        "Outcome nearly certain. Low volatility."
                    )
                elif total_min < 3 and score_diff <= 5:
                    vol_risk = "HIGH"
                    stage_note = (
                        f"Late-game with only {score_diff}pt margin and {total_min:.1f}min. "
                        "EXTREME volatility — single possession can flip outcome."
                    )
                else:
                    stage_note = "Late-game with meaningful time left. High volatility persists."
            else:
                stage_note = "Late-game stage. Volatility is elevated."

        return RiskReward(
            upside_pct=round(upside_pct, 1),
            downside_pct=round(downside_pct, 1),
            risk_reward_ratio=round(rr_ratio, 2),
            volatility_risk=vol_risk,
            stage_risk_note=stage_note,
        )

    # ------------------------------------------------------------------
    # Step 5: Trade Execution Plan
    # ------------------------------------------------------------------

    def _build_execution_plan(
        self, gi: GameInput, pe: ProbabilityEdge
    ) -> ExecutionPlan:
        market_price = gi.market.yes_price
        fee_pct = gi.fee_pct
        edge = pe.edge

        # Executable probability (fee-adjusted)
        exec_prob = market_price_to_executable_prob(market_price, fee_pct, "yes")

        # Kelly criterion
        kelly_full = compute_kelly_fraction(pe.true_probability, exec_prob)
        kelly_frac = RISK_CFG["kelly_fraction"]
        kelly_suggested = kelly_full * kelly_frac

        # Position sizing
        max_pct = RISK_CFG["max_position_pct"]
        max_position = self._bankroll * max_pct
        suggested_size = min(self._bankroll * kelly_suggested, max_position)

        # Depth constraint
        depth_cap = gi.market.depth_3c_usd * 0.30
        suggested_size = min(suggested_size, depth_cap)
        suggested_size = max(0.0, suggested_size)

        # Add / trim / hedge zones
        if edge > 0.06:
            add_zone = f"Add if price drops below {market_price - 0.03:.2f} (edge widens)"
        else:
            add_zone = "Do not add — edge is not wide enough for scaling in"

        if edge > 0:
            trim_zone = (
                f"Trim 50% if price rises above {min(0.95, pe.true_probability + 0.02):.2f} "
                "(edge collapses)"
            )
        else:
            trim_zone = "No position to trim"

        # Hedge logic
        if gi.stage == GameStage.LATE and gi.game_state:
            score_diff = abs(gi.game_state.home_score - gi.game_state.away_score)
            total_min = self._parse_time_remaining(
                gi.game_state.quarter, gi.game_state.time_remaining
            )
            if score_diff <= 5 and total_min < 5:
                hedge_note = (
                    "HEDGE RECOMMENDED: Close game in final minutes. "
                    "Consider buying NO side to lock in partial profit."
                )
            else:
                hedge_note = "No hedge needed at current game state."
        elif gi.stage == GameStage.IN:
            hedge_note = (
                "Monitor game flow. Hedge if lead narrows to <3pts in Q4."
            )
        else:
            hedge_note = "Pre-game: no hedge needed. Set alerts for injury news."

        return ExecutionPlan(
            entry_price=market_price,
            position_size_usd=round(suggested_size, 2),
            kelly_fraction=round(kelly_full, 4),
            kelly_suggested=round(kelly_suggested, 4),
            max_position_usd=round(max_position, 2),
            add_zone=add_zone,
            trim_zone=trim_zone,
            hedge_note=hedge_note,
        )

    # ------------------------------------------------------------------
    # Step 6: Exit Strategy
    # ------------------------------------------------------------------

    def _build_exit_strategy(
        self, gi: GameInput, pe: ProbabilityEdge
    ) -> ExitStrategy:
        true_prob = pe.true_probability
        market_price = gi.market.yes_price
        edge = pe.edge

        if edge <= 0:
            return ExitStrategy(
                exit_rationale="No position — edge is non-positive."
            )

        # Ideal sell: when market converges to true value or overshoots
        ideal_lo = min(0.95, true_prob - 0.01)
        ideal_hi = min(0.98, true_prob + 0.05)

        # Early exit: lock in partial profit if market moves favorably
        early_lo = market_price + (edge * 0.4)
        early_hi = market_price + (edge * 0.7)

        # Aggressive hold: when edge is still wide
        hold_lo = market_price
        hold_hi = market_price + (edge * 0.3)

        # Stop loss: cut if price drops significantly
        stop_lo = max(0.02, market_price - 0.08)
        stop_hi = max(0.02, market_price - 0.05)

        # Stage-specific rationale
        if gi.stage == GameStage.PRE:
            rationale = (
                f"PRE-GAME: Enter at {market_price:.2f}. "
                f"Target sell range {ideal_lo:.2f}-{ideal_hi:.2f} as market "
                f"converges to fair value. Stop loss below {stop_hi:.2f}. "
                "Re-evaluate at tipoff if edge narrows."
            )
        elif gi.stage == GameStage.IN:
            rationale = (
                f"IN-GAME: Active management required. "
                f"Take early profit at {early_hi:.2f} if opportunity arises. "
                f"Stop loss at {stop_hi:.2f}. "
                "Adjust based on live score and momentum."
            )
        else:
            rationale = (
                f"LATE-GAME: Decision time. "
                "Either hold to settlement if thesis is intact, "
                f"or exit at {early_lo:.2f}+ to lock profit. "
                f"Hard stop at {stop_hi:.2f}."
            )

        return ExitStrategy(
            ideal_sell_range=(round(ideal_lo, 3), round(ideal_hi, 3)),
            early_exit_zone=(round(early_lo, 3), round(early_hi, 3)),
            aggressive_hold_zone=(round(hold_lo, 3), round(hold_hi, 3)),
            stop_loss_zone=(round(stop_lo, 3), round(stop_hi, 3)),
            exit_rationale=rationale,
        )

    # ------------------------------------------------------------------
    # Step 7: Profit Model
    # ------------------------------------------------------------------

    def _build_profit_model(
        self,
        gi: GameInput,
        pe: ProbabilityEdge,
        ep: ExecutionPlan,
    ) -> ProfitModel:
        size = ep.position_size_usd
        entry = ep.entry_price
        true_prob = pe.true_probability
        fee_pct = gi.fee_pct

        if size <= 0 or entry <= 0 or entry >= 1:
            return ProfitModel()

        # Contracts purchased (each settles at $1)
        contracts = size / entry

        # Profit if correct: contracts * (1 - entry) - fee on profit
        gross_profit = contracts * (1 - entry)
        net_profit = gross_profit * (1 - fee_pct)

        # Worst case: lose entire stake
        worst_case = -size

        # Mid-game exit: assume market moves halfway to fair value
        mid_exit_price = (entry + true_prob) / 2
        mid_exit_profit = contracts * (mid_exit_price - entry) * (1 - fee_pct)

        # Expected value per dollar
        ev_per_dollar = (
            true_prob * (1 - entry) * (1 - fee_pct) / entry
            - (1 - true_prob)
        )

        # Breakeven probability
        breakeven = entry / (1 - fee_pct) / (1 - entry + entry / (1 - fee_pct))
        # Simplified: breakeven ≈ entry / ((1 - entry) * (1 - fee) + entry)
        breakeven = entry / (entry + (1 - entry) * (1 - fee_pct))

        return ProfitModel(
            expected_profit_if_correct=round(net_profit, 2),
            mid_game_exit_profit=round(mid_exit_profit, 2),
            worst_case_loss=round(worst_case, 2),
            breakeven_probability=round(breakeven, 4),
            expected_value_per_dollar=round(ev_per_dollar, 4),
        )

    # ------------------------------------------------------------------
    # Step 8: Key Drivers & Risk Flags
    # ------------------------------------------------------------------

    def _extract_key_drivers(self, gi: GameInput) -> list[dict[str, Any]]:
        a, b = gi.team_a, gi.team_b
        drivers = []

        # Net rating advantage
        net_diff = a.net_rating - b.net_rating
        if abs(net_diff) > 1.0:
            drivers.append({
                "factor": "net_rating_advantage",
                "value": f"{a.name} {'+' if net_diff > 0 else ''}{net_diff:.1f}",
                "impact": "strong" if abs(net_diff) > 4 else "moderate",
                "direction": "favors_a" if net_diff > 0 else "favors_b",
            })

        # Recent form
        form_diff = a.last5_net_rating - b.last5_net_rating
        if abs(form_diff) > 2.0:
            better = a.name if form_diff > 0 else b.name
            drivers.append({
                "factor": "recent_form",
                "value": f"{better} last-5 net rating advantage: {abs(form_diff):.1f}",
                "impact": "strong" if abs(form_diff) > 5 else "moderate",
                "direction": "favors_a" if form_diff > 0 else "favors_b",
            })

        # Rest / B2B
        if a.is_back_to_back != b.is_back_to_back:
            tired = a.name if a.is_back_to_back else b.name
            rested = b.name if a.is_back_to_back else a.name
            drivers.append({
                "factor": "rest_advantage",
                "value": f"{tired} on back-to-back, {rested} rested",
                "impact": "moderate",
                "direction": "favors_b" if a.is_back_to_back else "favors_a",
            })

        # Injury differential
        inj_diff = b.injury_impact - a.injury_impact
        if abs(inj_diff) > 0.1:
            drivers.append({
                "factor": "injury_impact",
                "value": f"Net injury advantage: {abs(inj_diff):.2f}",
                "impact": "strong" if abs(inj_diff) > 0.3 else "moderate",
                "direction": "favors_a" if inj_diff > 0 else "favors_b",
            })

        # Home court
        drivers.append({
            "factor": "home_court",
            "value": f"{a.name} at home",
            "impact": "moderate",
            "direction": "favors_a",
        })

        # Elo
        elo_diff = a.elo_rating - b.elo_rating
        if abs(elo_diff) > 50:
            drivers.append({
                "factor": "elo_rating",
                "value": f"Elo diff: {elo_diff:+.0f}",
                "impact": "strong" if abs(elo_diff) > 100 else "moderate",
                "direction": "favors_a" if elo_diff > 0 else "favors_b",
            })

        # H2H
        if gi.h2h and gi.h2h.season_series:
            drivers.append({
                "factor": "head_to_head",
                "value": gi.h2h.season_series,
                "impact": "low",
                "direction": "neutral",
            })

        # Live game drivers
        if gi.stage != GameStage.PRE and gi.game_state:
            gs = gi.game_state
            score_diff = gs.home_score - gs.away_score
            if abs(score_diff) > 0:
                leader = a.name if score_diff > 0 else b.name
                drivers.append({
                    "factor": "live_score",
                    "value": f"{leader} leads by {abs(score_diff)} (Q{gs.quarter} {gs.time_remaining})",
                    "impact": "strong",
                    "direction": "favors_a" if score_diff > 0 else "favors_b",
                })
            if gs.momentum and gs.momentum != "even":
                drivers.append({
                    "factor": "momentum",
                    "value": f"{'Home' if gs.momentum == 'home' else 'Away'} team has momentum",
                    "impact": "moderate",
                    "direction": "favors_a" if gs.momentum == "home" else "favors_b",
                })

        # Sort by impact (strong > moderate > low)
        impact_order = {"strong": 0, "moderate": 1, "low": 2}
        drivers.sort(key=lambda d: impact_order.get(d["impact"], 3))
        return drivers[:5]

    def _extract_risk_flags(self, gi: GameInput) -> list[dict[str, Any]]:
        flags = []
        a, b = gi.team_a, gi.team_b

        if a.has_gtd_star or b.has_gtd_star:
            team = a.name if a.has_gtd_star else b.name
            flags.append({
                "flag": "gtd_star",
                "severity": "HIGH",
                "note": f"{team} has star player listed as Game-Time Decision",
            })

        if a.injury_impact > 0.4 or b.injury_impact > 0.4:
            team = a.name if a.injury_impact > b.injury_impact else b.name
            flags.append({
                "flag": "high_injury_impact",
                "severity": "MEDIUM",
                "note": f"{team} significant injury impact ({max(a.injury_impact, b.injury_impact):.2f})",
            })

        if gi.market.spread > 0.06:
            flags.append({
                "flag": "wide_spread",
                "severity": "LOW",
                "note": f"Market bid-ask spread is wide ({gi.market.spread:.3f}), execution risk elevated",
            })

        if gi.market.depth_3c_usd < 500:
            flags.append({
                "flag": "low_liquidity",
                "severity": "MEDIUM",
                "note": f"Thin market depth (${gi.market.depth_3c_usd:.0f}), may face slippage",
            })

        if gi.stage == GameStage.LATE and gi.game_state:
            total_min = self._parse_time_remaining(
                gi.game_state.quarter, gi.game_state.time_remaining
            )
            score_diff = abs(gi.game_state.home_score - gi.game_state.away_score)
            if total_min < 3 and score_diff <= 5:
                flags.append({
                    "flag": "endgame_volatility",
                    "severity": "HIGH",
                    "note": (
                        f"Close game ({score_diff}pt margin) with {total_min:.1f}min left. "
                        "Extreme price volatility expected."
                    ),
                })

        if gi.stage == GameStage.IN and gi.game_state:
            if gi.game_state.lead_changes > 10:
                flags.append({
                    "flag": "competitive_game",
                    "severity": "LOW",
                    "note": f"{gi.game_state.lead_changes} lead changes — very competitive game",
                })

        return flags

    # ------------------------------------------------------------------
    # Step 9: Game State Summary
    # ------------------------------------------------------------------

    def _summarize_game_state(self, gi: GameInput) -> str:
        gs = gi.game_state
        if gs is None:
            return ""
        a, b = gi.team_a, gi.team_b
        total_min = self._parse_time_remaining(gs.quarter, gs.time_remaining)
        score_diff = gs.home_score - gs.away_score
        leader = a.name if score_diff > 0 else (b.name if score_diff < 0 else "Tied")

        summary = (
            f"Q{gs.quarter} | {gs.time_remaining} remaining | "
            f"{a.name} {gs.home_score} - {gs.away_score} {b.name} | "
        )
        if score_diff != 0:
            summary += f"{leader} leads by {abs(score_diff)} | "
        else:
            summary += "Game is tied | "

        summary += f"Momentum: {gs.momentum or 'even'} | "
        summary += f"~{total_min:.1f} min left"

        return summary

    # ------------------------------------------------------------------
    # Step 10: Final Decision
    # ------------------------------------------------------------------

    def _make_final_decision(
        self, gi: GameInput, td: TradingDecision
    ) -> FinalDecision:
        pe = td.probability_edge
        rr = td.risk_reward
        ep = td.execution_plan

        if pe is None or rr is None or ep is None:
            return FinalDecision(
                action=Action.SKIP, side="", confidence=Confidence.LOW
            )

        edge = pe.edge
        true_prob = pe.true_probability
        has_position = (
            gi.existing_position is not None
            and gi.existing_position.size_usd > 0
        )

        # Determine which team we favor
        if true_prob > 0.5:
            side = "Team A"
            side_name = gi.team_a.name
        else:
            side = "Team B"
            side_name = gi.team_b.name

        # Confidence scoring
        ci_width = pe.ci_upper - pe.ci_lower
        conf_score, conf_tier = compute_confidence_score(
            fair_prob=true_prob,
            ci_lower=pe.ci_lower,
            ci_upper=pe.ci_upper,
            edge=abs(edge),
            liquidity_score=min(1.0, gi.market.depth_3c_usd / 5000),
            injury_uncertainty=max(gi.team_a.injury_impact, gi.team_b.injury_impact),
        )

        if conf_tier == "HIGH":
            confidence = Confidence.HIGH
        elif conf_tier == "MED":
            confidence = Confidence.MED
        else:
            confidence = Confidence.LOW

        # Decision logic
        high_sev_flags = [f for f in td.risk_flags if f.get("severity") == "HIGH"]

        # SKIP conditions
        if abs(edge) < THRESHOLDS["min_edge"]:
            return FinalDecision(
                action=Action.SKIP, side=side, side_team_name=side_name,
                confidence=confidence,
            )

        if high_sev_flags and confidence == Confidence.LOW:
            return FinalDecision(
                action=Action.SKIP, side=side, side_team_name=side_name,
                confidence=confidence,
            )

        if ep.position_size_usd <= 0:
            return FinalDecision(
                action=Action.SKIP, side=side, side_team_name=side_name,
                confidence=confidence,
            )

        # Stage-specific action logic
        if gi.stage == GameStage.PRE:
            if edge > 0 and not has_position:
                action = Action.BUY
            elif edge > 0 and has_position:
                if edge > 0.06:
                    action = Action.ADD
                else:
                    action = Action.HOLD
            elif edge < -0.03 and has_position:
                action = Action.TRIM
            else:
                action = Action.SKIP

        elif gi.stage == GameStage.IN:
            if edge > 0 and not has_position:
                action = Action.BUY
            elif edge > 0.05 and has_position:
                action = Action.ADD
            elif edge > 0 and has_position:
                action = Action.HOLD
            elif edge < -0.02 and has_position:
                action = Action.TRIM
            elif edge < -0.05 and has_position:
                action = Action.SELL
            else:
                action = Action.SKIP if not has_position else Action.HOLD

        else:  # LATE
            gs = gi.game_state
            if gs:
                total_min = self._parse_time_remaining(gs.quarter, gs.time_remaining)
                score_diff = gs.home_score - gs.away_score
                is_a_leading = score_diff > 0
                favoring_a = true_prob > 0.5

                if total_min < 2 and abs(score_diff) > 10:
                    # Game is effectively over
                    if has_position:
                        action = Action.HOLD  # hold to settlement
                    else:
                        action = Action.SKIP  # too late to enter
                elif total_min < 3 and abs(score_diff) <= 5:
                    # High volatility endgame
                    if has_position:
                        action = Action.SELL  # lock profit / cut loss
                    else:
                        action = Action.SKIP  # too risky to enter
                elif edge > 0.06 and not has_position:
                    action = Action.BUY
                elif edge > 0 and has_position:
                    action = Action.HOLD
                elif edge < -0.03 and has_position:
                    action = Action.SELL
                else:
                    action = Action.SKIP
            else:
                action = Action.SKIP if edge <= 0 else Action.BUY

        return FinalDecision(
            action=action,
            side=side,
            side_team_name=side_name,
            confidence=confidence,
        )


# ---------------------------------------------------------------------------
# Formatted Output Renderer
# ---------------------------------------------------------------------------

def render_trading_decision(td: TradingDecision) -> str:
    """Render a TradingDecision as the strict output format specified."""
    lines = []

    fd = td.final_decision
    pe = td.probability_edge
    pm = td.price_movement
    rr = td.risk_reward
    ep = td.execution_plan
    es = td.exit_strategy
    prof = td.profit_model

    # --- Header ---
    lines.append(f"{'='*60}")
    lines.append(f"  BASKETBALL TRADING DECISION ENGINE")
    lines.append(f"  {td.team_a} vs {td.team_b}")
    lines.append(f"  Stage: {td.stage.value}")
    lines.append(f"  {td.timestamp.strftime('%Y-%m-%d %H:%M UTC')}")
    lines.append(f"{'='*60}")
    lines.append("")

    # --- Game State Summary (if live) ---
    if td.game_state_summary:
        lines.append(f"LIVE: {td.game_state_summary}")
        lines.append("")

    # --- FINAL DECISION ---
    if fd:
        action_emoji = {
            Action.BUY: "+", Action.ADD: "++",
            Action.HOLD: "=", Action.TRIM: "-",
            Action.SELL: "--", Action.SKIP: "X",
        }
        lines.append("FINAL DECISION")
        lines.append("-" * 40)
        lines.append(f"  Action:     {action_emoji.get(fd.action, '')} {fd.action.value}")
        lines.append(f"  Side:       {fd.side} ({fd.side_team_name})")
        lines.append(f"  Confidence: {fd.confidence.value}")
        lines.append("")

    # --- PROBABILITY EDGE ---
    if pe:
        lines.append("PROBABILITY EDGE")
        lines.append("-" * 40)
        lines.append(f"  True Probability:   {pe.true_probability*100:.1f}%")
        lines.append(f"  Market Probability: {pe.market_probability*100:.1f}%")
        lines.append(f"  Edge:               {pe.edge*100:+.1f}%")
        lines.append(f"  95% CI:             [{pe.ci_lower*100:.1f}%, {pe.ci_upper*100:.1f}%]")
        lines.append(f"  Verdict:            {pe.verdict.value.upper()}")
        lines.append("")

    # --- PRICE MOVEMENT ---
    if pm:
        lines.append("PRICE MOVEMENT ANALYSIS")
        lines.append("-" * 40)
        lines.append(f"  Direction:    {pm.direction}")
        lines.append(f"  Justified:    {'Yes' if pm.is_justified else 'No'}")
        if pm.overreaction_score > 0:
            lines.append(f"  Overreaction: {pm.overreaction_score:.0%}")
        lines.append(f"  {pm.interpretation}")
        lines.append("")

    # --- RISK / REWARD ---
    if rr:
        lines.append("RISK / REWARD")
        lines.append("-" * 40)
        lines.append(f"  Upside:       {rr.upside_pct:.1f}%")
        lines.append(f"  Downside:     {rr.downside_pct:.1f}%")
        lines.append(f"  R:R Ratio:    {rr.risk_reward_ratio:.2f}")
        lines.append(f"  Vol Risk:     {rr.volatility_risk}")
        lines.append(f"  {rr.stage_risk_note}")
        lines.append("")

    # --- EXECUTION PLAN ---
    if ep:
        lines.append("EXECUTION PLAN")
        lines.append("-" * 40)
        lines.append(f"  Entry Price:    ${ep.entry_price:.2f}")
        lines.append(f"  Position Size:  ${ep.position_size_usd:.2f}")
        lines.append(f"  Kelly (full):   {ep.kelly_fraction:.2%}")
        lines.append(f"  Kelly (used):   {ep.kelly_suggested:.2%}")
        lines.append(f"  Max Position:   ${ep.max_position_usd:.2f}")
        lines.append(f"  Add:  {ep.add_zone}")
        lines.append(f"  Trim: {ep.trim_zone}")
        lines.append(f"  Hedge: {ep.hedge_note}")
        lines.append("")

    # --- EXIT STRATEGY ---
    if es and es.ideal_sell_range != (0.0, 0.0):
        lines.append("EXIT STRATEGY")
        lines.append("-" * 40)
        lines.append(f"  Ideal Sell:      {es.ideal_sell_range[0]:.3f} - {es.ideal_sell_range[1]:.3f}")
        lines.append(f"  Early Exit:      {es.early_exit_zone[0]:.3f} - {es.early_exit_zone[1]:.3f}")
        lines.append(f"  Aggressive Hold: {es.aggressive_hold_zone[0]:.3f} - {es.aggressive_hold_zone[1]:.3f}")
        lines.append(f"  Stop Loss:       {es.stop_loss_zone[0]:.3f} - {es.stop_loss_zone[1]:.3f}")
        lines.append(f"  {es.exit_rationale}")
        lines.append("")

    # --- PROFIT MODEL ---
    if prof and prof.expected_profit_if_correct != 0:
        lines.append("PROFIT MODEL")
        lines.append("-" * 40)
        lines.append(f"  If Correct:      ${prof.expected_profit_if_correct:+.2f}")
        lines.append(f"  Mid-Game Exit:   ${prof.mid_game_exit_profit:+.2f}")
        lines.append(f"  Worst Case:      ${prof.worst_case_loss:+.2f}")
        lines.append(f"  Breakeven Prob:  {prof.breakeven_probability:.1%}")
        lines.append(f"  EV per Dollar:   ${prof.expected_value_per_dollar:+.4f}")
        lines.append("")

    # --- KEY DRIVERS ---
    if td.key_drivers:
        lines.append("KEY DRIVERS")
        lines.append("-" * 40)
        for i, d in enumerate(td.key_drivers, 1):
            arrow = "^" if d.get("direction") == "favors_a" else (
                "v" if d.get("direction") == "favors_b" else "-"
            )
            lines.append(
                f"  {i}. [{arrow}] {d['factor']}: {d['value']} ({d['impact']})"
            )
        lines.append("")

    # --- RISK FLAGS ---
    if td.risk_flags:
        lines.append("RISK FLAGS")
        lines.append("-" * 40)
        for f in td.risk_flags:
            sev = f["severity"]
            marker = "!!!" if sev == "HIGH" else ("!!" if sev == "MEDIUM" else "!")
            lines.append(f"  {marker} [{sev}] {f['flag']}: {f['note']}")
        lines.append("")

    lines.append(f"{'='*60}")
    return "\n".join(lines)
