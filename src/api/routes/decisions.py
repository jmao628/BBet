"""
Trading Decision API routes.

Provides endpoints for the 3-stage basketball trading decision engine.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

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

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class TeamFundamentalsRequest(BaseModel):
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
    off_rating: float = 110.0
    def_rating: float = 110.0
    net_rating: float = 0.0
    pace: float = 100.0
    efg_pct: float = 0.50
    tov_pct: float = 14.0
    last5_net_rating: float = 0.0
    home_net_rating: float = 0.0
    road_net_rating: float = 0.0
    elo_rating: float = 1500.0
    win_streak: int = 0
    rest_days: int = 3
    is_back_to_back: bool = False
    injury_impact: float = 0.0
    has_gtd_star: bool = False


class KalshiMarketRequest(BaseModel):
    yes_price: float
    implied_prob: float
    price_change: str = "flat"
    yes_bid: float | None = None
    yes_ask: float | None = None
    spread: float = 0.0
    volume_24h: float = 0.0
    depth_3c_usd: float = 500.0


class GameStateRequest(BaseModel):
    home_score: int = 0
    away_score: int = 0
    quarter: int = 1
    time_remaining: str = "12:00"
    momentum: str = ""
    home_fg_pct_live: float | None = None
    away_fg_pct_live: float | None = None
    lead_changes: int = 0
    largest_lead: int = 0
    largest_lead_team: str = ""


class HeadToHeadRequest(BaseModel):
    season_series: str = ""
    home_wins_h2h: int = 0
    away_wins_h2h: int = 0
    avg_margin: float = 0.0
    note: str = ""


class ExistingPositionRequest(BaseModel):
    side: str = ""
    avg_entry_price: float = 0.0
    size_usd: float = 0.0
    contracts: int = 0


class TradingDecisionRequest(BaseModel):
    team_a: TeamFundamentalsRequest
    team_b: TeamFundamentalsRequest
    stage: str = "PRE"
    market: KalshiMarketRequest
    game_state: GameStateRequest | None = None
    h2h: HeadToHeadRequest | None = None
    existing_position: ExistingPositionRequest | None = None
    sportsbook_novig_prob: float | None = None
    fee_pct: float = 0.02
    bankroll_usd: float = 10_000.0


class ProbabilityEdgeResponse(BaseModel):
    true_probability: float
    market_probability: float
    edge: float
    verdict: str
    ci_lower: float
    ci_upper: float


class FinalDecisionResponse(BaseModel):
    action: str
    side: str
    side_team_name: str
    confidence: str


class TradingDecisionResponse(BaseModel):
    decision_id: str
    stage: str
    team_a: str
    team_b: str
    final_decision: FinalDecisionResponse
    probability_edge: ProbabilityEdgeResponse
    formatted_output: str
    key_drivers: list[dict] = Field(default_factory=list)
    risk_flags: list[dict] = Field(default_factory=list)
    game_state_summary: str = ""


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


def _to_game_input(req: TradingDecisionRequest) -> GameInput:
    """Convert API request to internal GameInput."""
    team_a = TeamFundamentals(**req.team_a.model_dump())
    team_b = TeamFundamentals(**req.team_b.model_dump())
    market = KalshiMarket(**req.market.model_dump())

    game_state = None
    if req.game_state:
        game_state = GameState(**req.game_state.model_dump())

    h2h = None
    if req.h2h:
        h2h = HeadToHead(**req.h2h.model_dump())

    existing = None
    if req.existing_position:
        existing = ExistingPosition(**req.existing_position.model_dump())

    stage = GameStage(req.stage.upper())

    return GameInput(
        team_a=team_a,
        team_b=team_b,
        stage=stage,
        market=market,
        game_state=game_state,
        h2h=h2h,
        existing_position=existing,
        sportsbook_novig_prob=req.sportsbook_novig_prob,
        fee_pct=req.fee_pct,
    )


@router.post("/decisions", response_model=TradingDecisionResponse)
async def create_trading_decision(req: TradingDecisionRequest):
    """
    Generate a complete trading decision for a basketball game.

    Supports three stages:
    - PRE: Pre-game analysis based on fundamentals + market pricing
    - IN: In-game analysis incorporating live game state
    - LATE: Late-game/endgame analysis with volatility management
    """
    game_input = _to_game_input(req)
    engine = TradingDecisionEngine(bankroll_usd=req.bankroll_usd)
    td = engine.analyze(game_input)

    formatted = render_trading_decision(td)

    return TradingDecisionResponse(
        decision_id=td.decision_id,
        stage=td.stage.value,
        team_a=td.team_a,
        team_b=td.team_b,
        final_decision=FinalDecisionResponse(
            action=td.final_decision.action.value,
            side=td.final_decision.side,
            side_team_name=td.final_decision.side_team_name,
            confidence=td.final_decision.confidence.value,
        ),
        probability_edge=ProbabilityEdgeResponse(
            true_probability=td.probability_edge.true_probability,
            market_probability=td.probability_edge.market_probability,
            edge=td.probability_edge.edge,
            verdict=td.probability_edge.verdict.value,
            ci_lower=td.probability_edge.ci_lower,
            ci_upper=td.probability_edge.ci_upper,
        ),
        formatted_output=formatted,
        key_drivers=td.key_drivers,
        risk_flags=td.risk_flags,
        game_state_summary=td.game_state_summary,
    )


@router.post("/decisions/text")
async def create_trading_decision_text(req: TradingDecisionRequest):
    """Return just the formatted text output for terminal display."""
    game_input = _to_game_input(req)
    engine = TradingDecisionEngine(bankroll_usd=req.bankroll_usd)
    td = engine.analyze(game_input)
    return {"output": render_trading_decision(td)}
