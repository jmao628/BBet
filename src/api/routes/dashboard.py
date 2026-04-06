"""Dashboard endpoints — summary metrics for the terminal home page."""

from __future__ import annotations

from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.schemas import DashboardSummary, GameListItem
from src.db.models import Game, MarketContract, Signal, Position
from src.api.deps import get_db

router = APIRouter()


@router.get("/dashboard/summary", response_model=DashboardSummary)
async def dashboard_summary(db: AsyncSession = Depends(get_db)):
    """
    Top-level metrics for the dashboard header bar.
    Refresh: every 60s via polling.
    """
    today = date.today()

    # Count today's games
    games_q = select(func.count()).where(Game.game_date == today)
    total_games = (await db.execute(games_q)).scalar() or 0

    # Games with at least one market contract
    mkt_q = (
        select(func.count(func.distinct(MarketContract.game_id)))
        .join(Game, Game.game_id == MarketContract.game_id)
        .where(Game.game_date == today, MarketContract.status == "open")
    )
    games_with_markets = (await db.execute(mkt_q)).scalar() or 0

    # Today's signals
    sig_q = (
        select(Signal)
        .join(Game, Game.game_id == Signal.game_id)
        .where(Game.game_date == today, Signal.is_backtest.is_(False))
    )
    signals = (await db.execute(sig_q)).scalars().all()
    active = len(signals)
    actionable = sum(1 for s in signals if s.direction in ("YES", "NO") and s.skip_reason is None)
    skipped = active - actionable

    best_edge = max((s.edge for s in signals if s.edge), default=None)
    best_game = next((s.game_id for s in signals if s.edge == best_edge), None) if best_edge else None
    edges = [s.edge for s in signals if s.edge and s.edge > 0]
    avg_edge = sum(edges) / len(edges) if edges else None

    # Open exposure
    pos_q = select(func.coalesce(func.sum(Position.size_usd), 0.0)).where(
        Position.status == "open"
    )
    total_exposure = (await db.execute(pos_q)).scalar() or 0.0

    return DashboardSummary(
        today_date=today,
        total_games_today=total_games,
        games_with_markets=games_with_markets,
        active_signals=active,
        actionable_signals=actionable,
        skipped_signals=skipped,
        best_edge=best_edge,
        best_edge_game=best_game,
        avg_edge=avg_edge,
        total_exposure_usd=total_exposure,
        daily_risk_pct=0.0,  # computed from PortfolioState in production
        system_healthy=True,
        data_sources_ok=4,
        data_sources_total=4,
        last_refresh=datetime.now(timezone.utc),
    )


@router.get("/games/today", response_model=list[GameListItem])
async def games_today(db: AsyncSession = Depends(get_db)):
    """
    All games for today, enriched with signal summary.
    Refresh: every 60s.
    """
    today = date.today()
    q = select(Game).where(Game.game_date == today).order_by(Game.game_time_utc)
    games = (await db.execute(q)).scalars().all()

    result = []
    for g in games:
        # Get best signal for this game
        sig_q = (
            select(Signal)
            .where(Signal.game_id == g.game_id, Signal.is_backtest.is_(False))
            .order_by(Signal.edge.desc())
            .limit(1)
        )
        sig = (await db.execute(sig_q)).scalar()

        # Count markets
        mkt_q = select(func.count()).where(
            MarketContract.game_id == g.game_id,
            MarketContract.status == "open",
        )
        n_markets = (await db.execute(mkt_q)).scalar() or 0

        result.append(GameListItem(
            game_id=g.game_id,
            game_date=g.game_date,
            game_time_utc=g.game_time_utc,
            home_team=g.home_team,
            away_team=g.away_team,
            venue=g.venue,
            season_type=g.season_type,
            is_b2b_home=g.is_back_to_back_home or False,
            is_b2b_away=g.is_back_to_back_away or False,
            has_signal=sig is not None,
            signal_direction=sig.direction if sig else None,
            signal_edge=sig.edge if sig else None,
            signal_confidence_tier=sig.confidence_tier if sig else None,
            n_markets=n_markets,
        ))

    return result
