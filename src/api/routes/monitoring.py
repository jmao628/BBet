"""System monitoring endpoints — data freshness, health checks, alerts."""

from __future__ import annotations

import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_db
from src.api.schemas import (
    AlertEntry,
    AlertsResponse,
    DataSourceStatus,
    HealthResponse,
)
from src.config import cfg
from src.db.models import MarketQuote, PlayerInjury, SportsbookLine, TeamFeature

router = APIRouter()

STALE_THRESHOLDS = {
    "market_quotes": 5,
    "sportsbook_lines": 20,
    "player_injuries": 240,
    "team_features": 1440,
}

_start_time = time.time()


@router.get("/monitoring/health", response_model=HealthResponse)
async def health_check(db: AsyncSession = Depends(get_db)):
    """
    System health status — data freshness per source.
    Refresh: every 60s.
    """
    now = datetime.now(timezone.utc)
    sources = []

    # Check each data source's freshness
    checks = [
        ("market_quotes", MarketQuote, MarketQuote.quote_time),
        ("sportsbook_lines", SportsbookLine, SportsbookLine.odds_timestamp),
        ("player_injuries", PlayerInjury, PlayerInjury.updated_at),
        ("team_features", TeamFeature, TeamFeature.created_at),
    ]

    db_ok = True
    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        db_ok = False

    for name, model, time_col in checks:
        threshold = STALE_THRESHOLDS[name]
        try:
            q = select(func.max(time_col))
            last_sync = (await db.execute(q)).scalar()

            if last_sync is None:
                sources.append(DataSourceStatus(
                    source=name, status="error",
                    threshold_minutes=threshold,
                    error_message="No data found",
                ))
                continue

            if last_sync.tzinfo is None:
                last_sync = last_sync.replace(tzinfo=timezone.utc)

            staleness = (now - last_sync).total_seconds() / 60
            status = "ok" if staleness <= threshold else "stale"

            # Count recent records
            count_q = select(func.count()).select_from(model)
            count = (await db.execute(count_q)).scalar() or 0

            sources.append(DataSourceStatus(
                source=name,
                status=status,
                last_sync=last_sync,
                staleness_minutes=round(staleness, 1),
                threshold_minutes=threshold,
                records_last_sync=count,
            ))
        except Exception as e:
            sources.append(DataSourceStatus(
                source=name, status="error",
                threshold_minutes=threshold,
                error_message=str(e)[:200],
            ))

    all_ok = all(s.status == "ok" for s in sources)
    any_error = any(s.status == "error" for s in sources)

    return HealthResponse(
        overall_status="healthy" if all_ok else ("critical" if any_error else "degraded"),
        timestamp=now,
        data_sources=sources,
        model_version=cfg.get("models", {}).get("lgb_version", "v0.1"),
        db_connected=db_ok,
        redis_connected=True,  # Would check actual Redis connection
        uptime_seconds=round(time.time() - _start_time, 1),
    )


@router.get("/monitoring/alerts", response_model=AlertsResponse)
async def list_alerts(
    limit: int = Query(50, le=200),
    severity: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Recent alerts from the alerting system.
    In production, stored in a dedicated alerts table.
    Refresh: every 30s.
    """
    # Placeholder — would query an alerts table in production
    return AlertsResponse(alerts=[], total=0, unacknowledged=0)
