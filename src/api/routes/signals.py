"""Signal endpoints — browsing and filtering trading signals."""

from __future__ import annotations

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_db
from src.api.schemas import (
    ConfidenceInfo,
    DecisionMetrics,
    FilterGate,
    KeyDriver,
    ProbabilityBreakdown,
    RiskFlag,
    SignalDetailResponse,
    SignalListItem,
    SignalsListResponse,
)
from src.db.models import Game, Signal

router = APIRouter()


@router.get("/signals", response_model=SignalsListResponse)
async def list_signals(
    game_date: date | None = None,
    direction: str | None = Query(None, description="YES / NO / SKIP"),
    confidence_tier: str | None = Query(None, description="HIGH / MED / LOW"),
    min_edge: float | None = Query(None),
    sort_by: str = Query("edge", description="edge / confidence / signal_time"),
    sort_dir: Literal["asc", "desc"] = "desc",
    limit: int = Query(50, le=200),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    """
    Filterable signal list for the Signals page.
    Refresh: every 30s for today's signals.
    Cache: 5min for historical dates.
    """
    q = select(Signal).where(Signal.is_backtest.is_(False))

    if game_date:
        q = q.join(Game, Game.game_id == Signal.game_id).where(Game.game_date == game_date)

    if direction:
        q = q.where(Signal.direction == direction)

    if confidence_tier:
        q = q.where(Signal.confidence_tier == confidence_tier)

    if min_edge is not None:
        q = q.where(Signal.edge >= min_edge)

    # Sorting
    sort_col = {
        "edge": Signal.edge,
        "confidence": Signal.confidence_score,
        "signal_time": Signal.signal_time,
    }.get(sort_by, Signal.edge)

    if sort_dir == "desc":
        q = q.order_by(sort_col.desc())
    else:
        q = q.order_by(sort_col.asc())

    # Count totals
    count_q = select(func.count()).where(Signal.is_backtest.is_(False))
    if game_date:
        count_q = count_q.join(Game, Game.game_id == Signal.game_id).where(Game.game_date == game_date)
    total = (await db.execute(count_q)).scalar() or 0

    q = q.offset(offset).limit(limit)
    signals = (await db.execute(q)).scalars().all()

    items = []
    for s in signals:
        # Get game info
        game = (await db.execute(select(Game).where(Game.game_id == s.game_id))).scalar()
        items.append(SignalListItem(
            signal_id=str(s.signal_id),
            game_id=s.game_id,
            home_team=game.home_team if game else "",
            away_team=game.away_team if game else "",
            game_time_utc=game.game_time_utc if game else s.signal_time,
            platform=s.contract.platform if s.contract else "",
            market_type="moneyline",
            direction=s.direction or "SKIP",
            edge=s.edge or 0,
            expected_value=s.expected_value or 0,
            confidence_score=s.confidence_score or 0,
            confidence_tier=s.confidence_tier or "LOW",
            fair_prob=s.ensemble_fair_prob,
            market_mid=s.market_yes_mid,
            kelly_suggested=s.suggested_fraction or 0,
            suggested_size_usd=None,
            liquidity_score=s.liquidity_score or 0,
            is_actionable=s.direction in ("YES", "NO") and s.skip_reason is None,
            skip_reason=s.skip_reason,
            n_risk_flags=len(s.risk_flags) if s.risk_flags else 0,
            signal_time=s.signal_time,
        ))

    actionable = sum(1 for i in items if i.is_actionable)
    skipped = sum(1 for i in items if not i.is_actionable)

    return SignalsListResponse(
        signals=items,
        total=total,
        actionable_count=actionable,
        skipped_count=skipped,
    )


@router.get("/signals/{signal_id}", response_model=SignalDetailResponse)
async def signal_detail(signal_id: str, db: AsyncSession = Depends(get_db)):
    """Full signal detail with filter gate breakdown."""
    sig = (await db.execute(
        select(Signal).where(Signal.signal_id == signal_id)
    )).scalar()

    if not sig:
        raise HTTPException(404, f"Signal {signal_id} not found")

    game = (await db.execute(select(Game).where(Game.game_id == sig.game_id))).scalar()

    from src.api.routes.games import _build_filter_gates
    gates = _build_filter_gates(sig)

    return SignalDetailResponse(
        signal_id=str(sig.signal_id),
        game_id=sig.game_id,
        home_team=game.home_team if game else "",
        away_team=game.away_team if game else "",
        game_time_utc=game.game_time_utc if game else None,
        platform=sig.contract.platform if sig.contract else "",
        market_type="moneyline",
        question=sig.contract.question if sig.contract else "",
        yes_bid=sig.market_yes_mid or 0,  # approximate
        yes_ask=sig.market_yes_mid or 0,
        yes_mid=sig.market_yes_mid or 0,
        spread=0,
        probability=ProbabilityBreakdown(
            sportsbook_novig=sig.sportsbook_novig_prob,
            model_raw=sig.model_prob,
            model_calibrated=sig.calibrated_prob,
            market_mid=sig.market_yes_mid,
            ensemble_fair=sig.ensemble_fair_prob,
            ci_lower=sig.prob_ci_lower,
            ci_upper=sig.prob_ci_upper,
        ),
        decision=DecisionMetrics(
            direction=sig.direction or "SKIP",
            edge=sig.edge or 0,
            expected_value=sig.expected_value or 0,
            kelly_full=sig.kelly_full or 0,
            kelly_suggested=sig.suggested_fraction or 0,
        ),
        confidence=ConfidenceInfo(
            score=sig.confidence_score or 0,
            tier=sig.confidence_tier or "LOW",
            model_disagreement=sig.model_disagreement or 0,
        ),
        key_drivers=[KeyDriver(**d) for d in (sig.key_drivers or [])],
        risk_flags=[RiskFlag(**f) for f in (sig.risk_flags or [])],
        filter_gates=gates,
        is_actionable=sig.direction in ("YES", "NO") and sig.skip_reason is None,
        skip_reason=sig.skip_reason,
        signal_time=sig.signal_time,
        time_to_game_hours=0,
    )
