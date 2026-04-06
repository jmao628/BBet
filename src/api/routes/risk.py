"""Risk monitoring endpoints — portfolio exposure and rule hits."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_db
from src.api.schemas import ExposureEntry, RiskExposureResponse
from src.config import cfg
from src.db.models import Game, Position

router = APIRouter()

RISK_CFG = cfg["risk"]


@router.get("/risk/exposure", response_model=RiskExposureResponse)
async def risk_exposure(db: AsyncSession = Depends(get_db)):
    """
    Current portfolio risk state — exposure by game, team, series.
    Refresh: every 30s.
    """
    bankroll = 10_000.0  # Would come from config / user settings

    # Open positions
    open_q = select(Position).where(Position.status == "open")
    positions = (await db.execute(open_q)).scalars().all()

    daily_used = sum(p.size_usd or 0 for p in positions)
    daily_limit = bankroll * RISK_CFG["max_daily_risk_pct"]

    # Group by game
    game_exp: dict[str, float] = {}
    team_exp: dict[str, float] = {}

    for p in positions:
        # Get game for team info
        if p.contract and p.contract.game_id:
            gid = p.contract.game_id
            game_exp[gid] = game_exp.get(gid, 0) + (p.size_usd or 0)

            game = (await db.execute(
                select(Game).where(Game.game_id == gid)
            )).scalar()
            if game:
                for t in (game.home_team, game.away_team):
                    team_exp[t] = team_exp.get(t, 0) + (p.size_usd or 0)

    max_game = bankroll * RISK_CFG["max_game_exposure_pct"]
    max_team = bankroll * RISK_CFG["max_team_exposure_pct"]

    by_game = [
        ExposureEntry(
            label=gid, exposure_usd=exp,
            limit_usd=max_game,
            utilization_pct=exp / max_game * 100 if max_game > 0 else 0,
        )
        for gid, exp in sorted(game_exp.items(), key=lambda x: -x[1])
    ]

    by_team = [
        ExposureEntry(
            label=team, exposure_usd=exp,
            limit_usd=max_team,
            utilization_pct=exp / max_team * 100 if max_team > 0 else 0,
        )
        for team, exp in sorted(team_exp.items(), key=lambda x: -x[1])
    ]

    return RiskExposureResponse(
        bankroll_usd=bankroll,
        daily_risk_used_usd=daily_used,
        daily_risk_limit_usd=daily_limit,
        daily_utilization_pct=daily_used / daily_limit * 100 if daily_limit > 0 else 0,
        by_game=by_game,
        by_team=by_team,
        by_series=[],
        open_positions=len(positions),
    )
