"""
Standalone demo API — serves live Kalshi data + synthetic signals.
No database required. Run with: uvicorn src.api.demo_app:app --reload
"""

from __future__ import annotations

import time
from datetime import date, datetime, timedelta, timezone

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse

from src.api.live_demo import get_demo_data

app = FastAPI(title="BPMDE Terminal — Live Demo", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

START = time.time()


# ── Dashboard ────────────────────────────────────────────────────────

@app.get("/api/dashboard/summary")
async def dashboard_summary():
    data = await get_demo_data()
    games = data.get("games", [])
    signals = [g["signal"] for g in games]
    actionable = [s for s in signals if s["is_actionable"]]
    edges = [s["edge"] for s in signals if s["edge"] > 0]

    return {
        "today_date": str(date.today()),
        "total_games_today": len(games),
        "games_with_markets": len(games),
        "active_signals": len(signals),
        "actionable_signals": len(actionable),
        "skipped_signals": len(signals) - len(actionable),
        "best_edge": max(edges) if edges else None,
        "best_edge_game": next(
            (g["game_id"] for g in games if g["signal"]["edge"] == max(edges)),
            None,
        ) if edges else None,
        "avg_edge": sum(edges) / len(edges) if edges else None,
        "total_exposure_usd": sum(s.get("suggested_size_usd") or 0 for s in actionable),
        "daily_risk_pct": 4.2,
        "system_healthy": True,
        "data_sources_ok": 4,
        "data_sources_total": 4,
        "last_refresh": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/games/today")
async def games_today():
    data = await get_demo_data()
    games = data.get("games", [])
    return [
        {
            "game_id": g["game_id"],
            "game_date": g["game_date"],
            "game_time_utc": g["game_time_utc"],
            "home_team": g["home_team"],
            "away_team": g["away_team"],
            "venue": g["venue"],
            "season_type": g["season_type"],
            "is_b2b_home": g["is_b2b_home"],
            "is_b2b_away": g["is_b2b_away"],
            "has_signal": True,
            "signal_direction": g["signal"]["direction"],
            "signal_edge": g["signal"]["edge"],
            "signal_confidence_tier": g["signal"]["confidence"]["tier"],
            "n_markets": 1,
        }
        for g in games
    ]


# ── Game Detail ──────────────────────────────────────────────────────

@app.get("/api/games/{game_id}")
async def game_detail(game_id: str):
    data = await get_demo_data()
    game = next((g for g in data["games"] if g["game_id"] == game_id), None)
    if not game:
        return {"error": "not_found"}

    sig = game["signal"]
    return {
        "game_id": game["game_id"],
        "game_date": game["game_date"],
        "game_time_utc": game["game_time_utc"],
        "home_team": game["home_team"],
        "away_team": game["away_team"],
        "venue": game["venue"],
        "season_type": game["season_type"],
        "series_info": game["series_info"],
        "home_stats": game["home_stats"],
        "away_stats": game["away_stats"],
        "home_injuries": game["home_injuries"],
        "away_injuries": game["away_injuries"],
        "markets": [game["market"]],
        "probability": sig["probability"],
        "decision": {
            "direction": sig["direction"],
            "edge": sig["edge"],
            "expected_value": sig["expected_value"],
            "kelly_full": sig["kelly_full"],
            "kelly_suggested": sig["kelly_suggested"],
            "suggested_size_usd": sig["suggested_size_usd"],
            "max_size_usd": 200.0,
        },
        "confidence": sig["confidence"],
        "key_drivers": sig["key_drivers"],
        "risk_flags": sig["risk_flags"],
        "filter_gates": sig["filter_gates"],
        "is_actionable": sig["is_actionable"],
        "skip_reason": sig["skip_reason"],
    }


@app.get("/api/games/{game_id}/markets")
async def game_markets(game_id: str):
    data = await get_demo_data()
    game = next((g for g in data["games"] if g["game_id"] == game_id), None)
    if not game:
        return {"error": "not_found"}
    return {
        "game_id": game_id,
        "contracts": [game["market"]],
        "orderbooks": {},
        "price_history": {},
    }


@app.get("/api/games/{game_id}/features")
async def game_features(game_id: str):
    data = await get_demo_data()
    game = next((g for g in data["games"] if g["game_id"] == game_id), None)
    if not game:
        return {"error": "not_found"}
    return {
        "game_id": game_id,
        "home_stats": game["home_stats"],
        "away_stats": game["away_stats"],
        "matchup_features": {},
        "home_injuries": game["home_injuries"],
        "away_injuries": game["away_injuries"],
        "home_injury_impact": game["home_stats"]["injury_impact"],
        "away_injury_impact": game["away_stats"]["injury_impact"],
        "injury_uncertainty": 0.15,
    }


# ── Signals ──────────────────────────────────────────────────────────

@app.get("/api/signals")
async def list_signals(
    direction: str | None = None,
    confidence_tier: str | None = None,
    sort_by: str = "edge",
    sort_dir: str = "desc",
):
    data = await get_demo_data()
    signals = []
    for g in data["games"]:
        sig = g["signal"]
        item = {
            "signal_id": sig["signal_id"],
            "game_id": g["game_id"],
            "home_team": g["home_team"],
            "away_team": g["away_team"],
            "game_time_utc": g["game_time_utc"],
            "platform": "kalshi",
            "market_type": "moneyline",
            "direction": sig["direction"],
            "edge": sig["edge"],
            "expected_value": sig["expected_value"],
            "confidence_score": sig["confidence"]["score"],
            "confidence_tier": sig["confidence"]["tier"],
            "fair_prob": sig["probability"]["ensemble_fair"],
            "market_mid": sig["probability"]["market_mid"],
            "kelly_suggested": sig["kelly_suggested"],
            "suggested_size_usd": sig["suggested_size_usd"],
            "liquidity_score": sig["liquidity_score"],
            "is_actionable": sig["is_actionable"],
            "skip_reason": sig["skip_reason"],
            "n_risk_flags": len(sig["risk_flags"]),
            "signal_time": g["game_time_utc"],
        }

        if direction and item["direction"] != direction:
            continue
        if confidence_tier and item["confidence_tier"] != confidence_tier:
            continue
        signals.append(item)

    key = {"edge": "edge", "confidence": "confidence_score", "signal_time": "signal_time"}.get(sort_by, "edge")
    reverse = sort_dir == "desc"
    signals.sort(key=lambda s: s.get(key, 0) or 0, reverse=reverse)

    actionable = sum(1 for s in signals if s["is_actionable"])
    return {
        "signals": signals,
        "total": len(signals),
        "actionable_count": actionable,
        "skipped_count": len(signals) - actionable,
    }


# ── Backtest ─────────────────────────────────────────────────────────

@app.get("/api/backtest/summary")
async def backtest_summary():
    data = await get_demo_data()
    return data.get("backtest_runs", [])


@app.get("/api/backtest/{run_id}/equity")
async def backtest_equity(run_id: str):
    data = await get_demo_data()
    run = next((r for r in data.get("backtest_runs", []) if r["run_id"] == run_id), None)
    if not run:
        return {"error": "not_found"}
    return {
        "run_id": run_id,
        "initial_capital": 10000,
        "equity_curve": [],
        "summary": run,
    }


# ── Risk ─────────────────────────────────────────────────────────────

@app.get("/api/risk/exposure")
async def risk_exposure():
    data = await get_demo_data()
    games = data.get("games", [])
    actionable = [g for g in games if g["signal"]["is_actionable"]]

    bankroll = 10000.0
    daily_used = sum(g["signal"].get("suggested_size_usd") or 0 for g in actionable)
    daily_limit = bankroll * 0.15

    by_game = []
    by_team: dict[str, float] = {}
    for g in actionable:
        size = g["signal"].get("suggested_size_usd") or 0
        max_game = bankroll * 0.05
        by_game.append({
            "label": f"{g['away_team']}@{g['home_team']}",
            "exposure_usd": size,
            "limit_usd": max_game,
            "utilization_pct": size / max_game * 100 if max_game else 0,
        })
        for t in (g["home_team"], g["away_team"]):
            by_team[t] = by_team.get(t, 0) + size

    max_team = bankroll * 0.08
    teams = [
        {
            "label": t,
            "exposure_usd": exp,
            "limit_usd": max_team,
            "utilization_pct": exp / max_team * 100 if max_team else 0,
        }
        for t, exp in sorted(by_team.items(), key=lambda x: -x[1])
    ]

    return {
        "bankroll_usd": bankroll,
        "daily_risk_used_usd": round(daily_used, 2),
        "daily_risk_limit_usd": daily_limit,
        "daily_utilization_pct": round(daily_used / daily_limit * 100, 1) if daily_limit else 0,
        "by_game": by_game,
        "by_team": teams,
        "by_series": [],
        "open_positions": len(actionable),
        "risk_rule_hits": [],
    }


# ── Monitoring ───────────────────────────────────────────────────────

@app.get("/api/monitoring/health")
async def health():
    now = datetime.now(timezone.utc)
    return {
        "overall_status": "healthy",
        "timestamp": now.isoformat(),
        "data_sources": [
            {
                "source": "kalshi_markets",
                "status": "ok",
                "last_sync": now.isoformat(),
                "staleness_minutes": 0.5,
                "threshold_minutes": 5,
                "records_last_sync": 12,
                "error_message": None,
            },
            {
                "source": "sportsbook_lines",
                "status": "ok",
                "last_sync": (now - timedelta(minutes=8)).isoformat(),
                "staleness_minutes": 8.0,
                "threshold_minutes": 20,
                "records_last_sync": 48,
                "error_message": None,
            },
            {
                "source": "player_injuries",
                "status": "ok",
                "last_sync": (now - timedelta(hours=2)).isoformat(),
                "staleness_minutes": 120.0,
                "threshold_minutes": 240,
                "records_last_sync": 23,
                "error_message": None,
            },
            {
                "source": "team_features",
                "status": "ok",
                "last_sync": (now - timedelta(hours=6)).isoformat(),
                "staleness_minutes": 360.0,
                "threshold_minutes": 1440,
                "records_last_sync": 30,
                "error_message": None,
            },
        ],
        "model_version": "v0.1",
        "db_connected": True,
        "redis_connected": True,
        "uptime_seconds": round(time.time() - START, 1),
    }


@app.get("/api/monitoring/alerts")
async def alerts():
    now = datetime.now(timezone.utc)
    return {
        "alerts": [
            {
                "alert_id": "a1",
                "alert_type": "signal",
                "severity": "INFO",
                "message": "New HIGH confidence signal: BOS vs MIA (edge 6.8%)",
                "details": {},
                "created_at": (now - timedelta(minutes=15)).isoformat(),
                "acknowledged": True,
            },
            {
                "alert_id": "a2",
                "alert_type": "anomaly",
                "severity": "WARNING",
                "message": "Cross-platform basis > 10% on OKC-DEN market",
                "details": {"basis": 0.112},
                "created_at": (now - timedelta(minutes=45)).isoformat(),
                "acknowledged": False,
            },
        ],
        "total": 2,
        "unacknowledged": 1,
    }


# ── Portfolio ─────────────────────────────────────────────────────────

@app.get("/api/portfolio")
async def portfolio(period: str = "1W"):
    """Robinhood-style portfolio value with equity curve."""
    import math
    import random as _rng

    _rng.seed(42)  # deterministic

    base_value = 5014.15
    buying_power = 2805.57

    # Generate equity curve based on period
    period_map = {"1D": 24, "1W": 7 * 24, "1M": 30 * 24, "3M": 90 * 24, "1Y": 365, "ALL": 730}
    n_points = min(period_map.get(period, 168), 500)

    points = []
    val = base_value * 0.88  # start lower
    for i in range(n_points):
        val += _rng.gauss(0.4, 8)  # upward drift with noise
        val = max(val, base_value * 0.7)
        t = datetime.now(timezone.utc) - timedelta(hours=n_points - i)
        points.append({"time": t.isoformat(), "value": round(val, 2)})

    # End at current value
    points[-1]["value"] = base_value

    start_val = points[0]["value"]
    change = base_value - start_val
    change_pct = (change / start_val) * 100

    return {
        "total_value": base_value,
        "buying_power": buying_power,
        "change": round(change, 2),
        "change_pct": round(change_pct, 2),
        "period": period,
        "equity_curve": points,
    }


@app.get("/api/portfolio/positions")
async def portfolio_positions():
    """User's open positions (bets placed)."""
    data = await get_demo_data()
    games = data.get("games", [])

    # Simulate some open positions on a few games
    positions = []
    for i, g in enumerate(games[:4]):  # user has bets on first 4 games
        import random as _rng
        _rng.seed(i + 100)
        side = "YES" if _rng.random() > 0.3 else "NO"
        entry_price = _rng.randint(30, 75) / 100
        qty = _rng.randint(10, 80)
        current_mid = g["signal"]["yes_mid"] if side == "YES" else (1 - g["signal"]["yes_mid"])
        cost = round(entry_price * qty, 2)
        current_val = round(current_mid * qty, 2)
        pnl = round(current_val - cost, 2)

        positions.append({
            "game_id": g["game_id"],
            "home_team": g["home_team"],
            "away_team": g["away_team"],
            "game_time_utc": g["game_time_utc"],
            "side": side,
            "team_bet": g["home_team"] if side == "YES" else g["away_team"],
            "entry_price": entry_price,
            "current_price": round(current_mid, 2),
            "quantity": qty,
            "cost": cost,
            "current_value": current_val,
            "pnl": pnl,
            "pnl_pct": round((pnl / cost) * 100, 1) if cost > 0 else 0,
            "market_question": g["market"]["question"],
        })

    return {"positions": positions, "total_positions": len(positions)}


@app.get("/api/games/{game_id}/price_history")
async def game_price_history(game_id: str, period: str = "1D"):
    """Kalshi-style price history for YES and NO sides."""
    import random as _rng

    data = await get_demo_data()
    game = next((g for g in data["games"] if g["game_id"] == game_id), None)
    if not game:
        return {"error": "not_found"}

    yes_mid = game["signal"]["yes_mid"]
    _rng.seed(hash(game_id))

    period_map = {"1D": 48, "1W": 168, "1M": 120, "ALL": 200}
    n = period_map.get(period, 48)

    # Generate realistic price movement around current mid
    points = []
    val = yes_mid + _rng.gauss(0, 0.05)
    for i in range(n):
        val += _rng.gauss(0, 0.008)
        val = max(0.05, min(0.95, val))
        t = datetime.now(timezone.utc) - timedelta(hours=n - i)
        points.append({
            "time": t.isoformat(),
            "yes_price": round(val, 4),
            "no_price": round(1 - val, 4),
        })

    # End at current price
    points[-1]["yes_price"] = round(yes_mid, 4)
    points[-1]["no_price"] = round(1 - yes_mid, 4)

    home_pct = round(yes_mid * 100)
    away_pct = 100 - home_pct

    return {
        "game_id": game_id,
        "home_team": game["home_team"],
        "away_team": game["away_team"],
        "game_time_utc": game["game_time_utc"],
        "question": game["market"]["question"],
        "yes_price": round(yes_mid, 2),
        "no_price": round(1 - yes_mid, 2),
        "home_pct": home_pct,
        "away_pct": away_pct,
        "volume": game["signal"]["volume_24h"] or 0,
        "period": period,
        "price_history": points,
    }


@app.get("/api/ping")
async def ping():
    return {"status": "ok", "uptime_s": round(time.time() - START, 1)}
