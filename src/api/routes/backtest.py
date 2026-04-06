"""Backtest endpoints — historical performance and equity curves."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_db
from src.api.schemas import BacktestEquityResponse, BacktestSummary, EquityPoint
from src.db.models import BacktestRun

router = APIRouter()


@router.get("/backtest/summary", response_model=list[BacktestSummary])
async def backtest_summary(
    limit: int = Query(10, le=50),
    db: AsyncSession = Depends(get_db),
):
    """
    List recent backtest runs with summary metrics.
    Cache: indefinitely (historical data).
    """
    q = select(BacktestRun).order_by(BacktestRun.run_at.desc()).limit(limit)
    runs = (await db.execute(q)).scalars().all()

    return [
        BacktestSummary(
            run_id=str(r.run_id),
            run_name=r.run_name or "",
            start_date=r.start_date,
            end_date=r.end_date,
            model_version=r.model_version or "v0.1",
            total_signals=r.total_signals or 0,
            signals_executed=r.signals_executed or 0,
            hit_rate=r.hit_rate or 0,
            roi_pct=r.roi_pct or 0,
            total_pnl_usd=r.total_pnl_usd or 0,
            sharpe_ratio=r.sharpe_ratio or 0,
            max_drawdown_pct=r.max_drawdown_pct or 0,
            avg_hold_hours=r.avg_hold_hours or 0,
            avg_edge=r.avg_edge,
            by_confidence=r.by_confidence,
            by_market_type=r.by_market_type,
        )
        for r in runs
    ]


@router.get("/backtest/{run_id}/equity", response_model=BacktestEquityResponse)
async def backtest_equity(run_id: str, db: AsyncSession = Depends(get_db)):
    """
    Equity curve for a specific backtest run.
    Reconstructed from signals + positions for that run.
    Cache: indefinitely.
    """
    run = (await db.execute(
        select(BacktestRun).where(BacktestRun.run_id == run_id)
    )).scalar()

    if not run:
        raise HTTPException(404, f"Backtest run {run_id} not found")

    # In production, reconstruct equity curve from backtest signals/positions
    # For now, return summary-only response
    return BacktestEquityResponse(
        run_id=str(run.run_id),
        initial_capital=10_000.0,
        equity_curve=[],  # Would be populated from position-level P&L
        summary=BacktestSummary(
            run_id=str(run.run_id),
            run_name=run.run_name or "",
            start_date=run.start_date,
            end_date=run.end_date,
            model_version=run.model_version or "v0.1",
            total_signals=run.total_signals or 0,
            signals_executed=run.signals_executed or 0,
            hit_rate=run.hit_rate or 0,
            roi_pct=run.roi_pct or 0,
            total_pnl_usd=run.total_pnl_usd or 0,
            sharpe_ratio=run.sharpe_ratio or 0,
            max_drawdown_pct=run.max_drawdown_pct or 0,
            avg_hold_hours=run.avg_hold_hours or 0,
            avg_edge=run.avg_edge,
            by_confidence=run.by_confidence,
            by_market_type=run.by_market_type,
        ),
    )
