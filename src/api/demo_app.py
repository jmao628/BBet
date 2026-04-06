"""
BPMDE Terminal API — Real Kalshi data + simulated portfolio.
Run with: PYTHONPATH=. uvicorn src.api.demo_app:app --reload --port 8000
"""

from __future__ import annotations

import json
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from src.api.kalshi_real import KalshiRealClient

app = FastAPI(title="BPMDE Terminal", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

START = time.time()
kalshi = KalshiRealClient()

# ── All basketball series on Kalshi ──────────────────────────────────
BASKETBALL_SERIES = [
    "KXNBAGAME",           # NBA moneyline
    "KXNBASPREAD",         # NBA spread
    "KXNBATOTAL",          # NBA total points
    "KXKBLGAME",           # Korea KBL
    "KXCBAGAME",           # China CBA
    "KXEUROLEAGUEGAME",    # EuroLeague
    "KXJBLEAGUEGAME",      # Japan B.League
    "KXNBLGAME",           # Australia NBL
    "KXBUNDESLIGABBGAME",  # Germany Bundesliga Basketball
    "KXITASERIEABBGAME",   # Italy Serie A Basketball
    "KXLIGAACBGAME",       # Spain ACB
    "KXTURKEYBSLGAME",     # Turkey BSL
    "KXABABGAME",          # ABA League
    "KXEUROCUPBBGAME",     # EuroCup Basketball
    "KXFIBAGAME",          # FIBA
    "KXFIBACHAMPGAME",     # FIBA Champions League
    "KXFIBAEUROCUPGAME",   # FIBA Europe Cup
    "KXNCAABGAME",         # NCAA Basketball
    "KXWNBAGAME",          # WNBA
    "KXLNBGAME",           # Argentina LNB
    "KXLNBELITEGAME",      # France LNB Elite
    "KXVTBGAME",           # VTB United League
    "KXTNCBBGAME",         # TNC Basketball
    "KXGBLBBGAME",         # GBL Basketball
]

# ── Simulated Portfolio (persisted to JSON file) ─────────────────────
PORTFOLIO_FILE = Path(__file__).parent.parent.parent / "config" / "portfolio.json"


def _load_portfolio() -> dict:
    if PORTFOLIO_FILE.exists():
        return json.loads(PORTFOLIO_FILE.read_text())
    return {
        "initial_capital": 10000.0,
        "cash": 10000.0,
        "positions": [],
        "trade_history": [],
    }


def _save_portfolio(data: dict):
    PORTFOLIO_FILE.write_text(json.dumps(data, indent=2, default=str))


# ── Cache for market data ────────────────────────────────────────────
_cache: dict[str, Any] = {}
_cache_ts: float = 0
CACHE_TTL = 5  # seconds — fast refresh


async def _get_all_basketball_events() -> list[dict]:
    """Fetch all basketball game events from all series. Cached for CACHE_TTL seconds."""
    global _cache_ts
    if "events" in _cache and (time.time() - _cache_ts) < CACHE_TTL:
        return _cache["events"]

    all_events: list[dict] = []
    for series in BASKETBALL_SERIES:
        try:
            data = await kalshi._request("GET", "/trade-api/v2/events", params={
                "series_ticker": series,
                "limit": 100,
                "status": "open",
                "with_nested_markets": "true",
            })
            events = data.get("events", [])
            for e in events:
                e["_series"] = series
                e["_league"] = _series_to_league(series)
            all_events.extend(events)
        except Exception:
            continue

    # Sort by event date (extract from ticker)
    all_events.sort(key=lambda e: e.get("event_ticker", ""))
    _cache["events"] = all_events
    _cache_ts = time.time()
    return all_events


def _series_to_league(series: str) -> str:
    mapping = {
        "KXNBAGAME": "NBA", "KXNBASPREAD": "NBA Spread", "KXNBATOTAL": "NBA Total",
        "KXKBLGAME": "KBL", "KXCBAGAME": "CBA", "KXEUROLEAGUEGAME": "EuroLeague",
        "KXJBLEAGUEGAME": "B.League", "KXNBLGAME": "NBL", "KXBUNDESLIGABBGAME": "BBL",
        "KXITASERIEABBGAME": "Serie A", "KXLIGAACBGAME": "ACB", "KXTURKEYBSLGAME": "BSL",
        "KXABABGAME": "ABA", "KXEUROCUPBBGAME": "EuroCup", "KXFIBAGAME": "FIBA",
        "KXNCAABGAME": "NCAA", "KXWNBAGAME": "WNBA",
    }
    return mapping.get(series, series.replace("KX", "").replace("GAME", ""))


async def _get_market_with_orderbook(ticker: str) -> dict:
    """Get market data + extract best bid/ask from orderbook."""
    market = await kalshi.get_market(ticker)
    ob = await kalshi.get_orderbook(ticker)
    ob_fp = ob.get("orderbook_fp", ob.get("orderbook", {}))

    yes_bids = ob_fp.get("yes_dollars", ob_fp.get("yes", []))
    no_bids = ob_fp.get("no_dollars", ob_fp.get("no", []))

    # Best YES bid = highest price someone will buy YES at
    best_yes_bid = max((float(lvl[0]) for lvl in yes_bids), default=0) if yes_bids else 0
    # Best YES ask = 1 - highest NO bid price
    best_no_bid = max((float(lvl[0]) for lvl in no_bids), default=0) if no_bids else 0
    best_yes_ask = 1 - (min((float(lvl[0]) for lvl in no_bids), default=1)) if no_bids else 1

    # Calculate total depth
    yes_depth = sum(float(lvl[1]) for lvl in yes_bids) if yes_bids else 0
    no_depth = sum(float(lvl[1]) for lvl in no_bids) if no_bids else 0

    market["_best_yes_bid"] = round(best_yes_bid, 4)
    market["_best_yes_ask"] = round(best_yes_ask, 4)
    market["_yes_mid"] = round((best_yes_bid + best_yes_ask) / 2, 4) if best_yes_bid > 0 else 0
    market["_yes_depth"] = round(yes_depth, 2)
    market["_no_depth"] = round(no_depth, 2)
    market["_orderbook"] = {"yes": yes_bids, "no": no_bids}
    return market


# ── API Endpoints ────────────────────────────────────────────────────

@app.get("/api/games/today")
async def games_today():
    """All basketball games across all leagues."""
    events = await _get_all_basketball_events()

    games = []
    for e in events:
        markets = e.get("markets", [])
        # For moneyline events, get the two outcomes
        home_market = None
        away_market = None

        if len(markets) == 2:
            # Extract team abbrevs from ticker suffix
            home_market = markets[0]
            away_market = markets[1]
        elif len(markets) == 1:
            home_market = markets[0]

        # Extract teams from event title (format: "Away at Home")
        title = e.get("title", "")
        teams = title.split(" at ")
        away_team = teams[0] if len(teams) == 2 else title
        home_team = teams[1] if len(teams) == 2 else ""

        # Try to get pricing from individual markets
        home_pct = 0
        away_pct = 0
        volume = 0
        if home_market:
            volume += home_market.get("volume") or 0
        if away_market:
            volume += away_market.get("volume") or 0

        games.append({
            "game_id": e.get("event_ticker", ""),
            "game_date": str(date.today()),
            "game_time_utc": e.get("close_time", ""),
            "home_team": home_team,
            "away_team": away_team,
            "venue": None,
            "season_type": e.get("_league", "NBA"),
            "league": e.get("_league", "NBA"),
            "series": e.get("_series", ""),
            "is_b2b_home": False,
            "is_b2b_away": False,
            "has_signal": False,
            "signal_direction": None,
            "signal_edge": None,
            "signal_confidence_tier": None,
            "n_markets": len(markets),
            "volume": volume,
            "home_market_ticker": home_market.get("ticker") if home_market else None,
            "away_market_ticker": away_market.get("ticker") if away_market else None,
            "event_ticker": e.get("event_ticker", ""),
        })

    return games


@app.get("/api/games/{game_id}")
async def game_detail(game_id: str):
    """Full game detail with real orderbook data."""
    events = await _get_all_basketball_events()
    event = next((e for e in events if e.get("event_ticker") == game_id), None)
    if not event:
        return {"error": "not_found"}

    markets = event.get("markets", [])
    title = event.get("title", "")
    teams = title.split(" at ")
    away_team = teams[0] if len(teams) == 2 else title
    home_team = teams[1] if len(teams) == 2 else ""

    # Fetch real orderbook data for each market
    enriched_markets = []
    for m in markets:
        try:
            full = await _get_market_with_orderbook(m["ticker"])
            enriched_markets.append({
                "ticker": m["ticker"],
                "title": full.get("title", ""),
                "subtitle": full.get("subtitle", ""),
                "yes_bid": full["_best_yes_bid"],
                "yes_ask": full["_best_yes_ask"],
                "yes_mid": full["_yes_mid"],
                "yes_depth": full["_yes_depth"],
                "no_depth": full["_no_depth"],
                "volume": full.get("volume") or 0,
                "open_interest": full.get("open_interest") or 0,
                "last_price": (full.get("last_price") or 0) / 100,
                "status": full.get("status", ""),
                "close_time": full.get("close_time", ""),
                "orderbook": full["_orderbook"],
            })
        except Exception:
            enriched_markets.append({
                "ticker": m["ticker"],
                "title": m.get("title", ""),
                "yes_bid": 0, "yes_ask": 0, "yes_mid": 0,
                "yes_depth": 0, "no_depth": 0,
                "volume": 0, "open_interest": 0,
                "last_price": 0, "status": "error",
                "orderbook": {"yes": [], "no": []},
            })

    # Compute game-level percentages from markets
    home_pct = 0
    away_pct = 0
    if len(enriched_markets) >= 2:
        # First market = home outcome, second = away outcome (or vice versa)
        m0 = enriched_markets[0]
        m1 = enriched_markets[1]
        home_pct = round(m0["yes_mid"] * 100)
        away_pct = round(m1["yes_mid"] * 100)

    return {
        "game_id": game_id,
        "title": title,
        "home_team": home_team,
        "away_team": away_team,
        "league": event.get("_league", "NBA"),
        "close_time": event.get("close_time", ""),
        "home_pct": home_pct,
        "away_pct": away_pct,
        "markets": enriched_markets,
    }


@app.get("/api/games/{game_id}/price_history")
async def game_price_history(game_id: str, period: str = "1D"):
    """Real price history from Kalshi."""
    events = await _get_all_basketball_events()
    event = next((e for e in events if e.get("event_ticker") == game_id), None)
    if not event:
        return {"error": "not_found"}

    markets = event.get("markets", [])
    title = event.get("title", "")
    teams = title.split(" at ")
    away_team = teams[0] if len(teams) == 2 else title
    home_team = teams[1] if len(teams) == 2 else ""

    # Get history for first market (home team outcome)
    price_history = []
    home_ticker = markets[0]["ticker"] if markets else None
    volume = 0

    if home_ticker:
        try:
            # Compute min_ts based on period
            now_ts = int(time.time())
            period_secs = {"1D": 86400, "1W": 604800, "1M": 2592000, "ALL": 86400 * 365}.get(period, 86400)
            history = await kalshi.get_market_history(home_ticker, limit=500, min_ts=now_ts - period_secs)

            for h in history:
                ts = h.get("ts") or h.get("end_period_ts")
                yes_price = (h.get("yes_price") or h.get("yes_bid") or 0) / 100
                price_history.append({
                    "time": datetime.fromtimestamp(ts, tz=timezone.utc).isoformat() if isinstance(ts, (int, float)) else str(ts),
                    "yes_price": round(yes_price, 4),
                    "no_price": round(1 - yes_price, 4),
                })

            # Get current volume
            m = await kalshi.get_market(home_ticker)
            volume = m.get("volume") or 0
        except Exception:
            pass

    # Current prices
    yes_price = price_history[-1]["yes_price"] if price_history else 0.5
    no_price = 1 - yes_price

    return {
        "game_id": game_id,
        "home_team": home_team,
        "away_team": away_team,
        "game_time_utc": event.get("close_time", ""),
        "question": title,
        "yes_price": round(yes_price, 2),
        "no_price": round(no_price, 2),
        "home_pct": round(yes_price * 100),
        "away_pct": round(no_price * 100),
        "volume": volume,
        "period": period,
        "price_history": price_history,
    }


# ── Simulated Portfolio ─────────────────────────────────────────────

@app.get("/api/portfolio")
async def portfolio(period: str = "1W"):
    """Portfolio value with simulated equity curve."""
    pf = _load_portfolio()

    # Calculate current portfolio value from positions
    total_position_value = 0.0
    for pos in pf.get("positions", []):
        total_position_value += pos.get("current_value", 0)

    total_value = pf["cash"] + total_position_value
    initial = pf["initial_capital"]
    change = total_value - initial
    change_pct = (change / initial) * 100 if initial > 0 else 0

    # Generate equity curve from trade history
    equity_curve = _build_equity_curve(pf, period)

    return {
        "total_value": round(total_value, 2),
        "buying_power": round(pf["cash"], 2),
        "change": round(change, 2),
        "change_pct": round(change_pct, 2),
        "period": period,
        "equity_curve": equity_curve,
    }


@app.get("/api/portfolio/positions")
async def portfolio_positions():
    """All simulated positions."""
    pf = _load_portfolio()
    return {
        "positions": pf.get("positions", []),
        "total_positions": len(pf.get("positions", [])),
    }


@app.post("/api/portfolio/trade")
async def execute_trade(
    ticker: str,
    side: str = Query(..., description="yes or no"),
    action: str = Query(..., description="buy or sell"),
    quantity: int = Query(..., ge=1),
    price_cents: int = Query(..., ge=1, le=99, description="Price in cents"),
):
    """
    Simulate a trade. Calculates cost and updates portfolio.

    Buy YES at 20¢ × 10 contracts = $2.00 cost
    If YES wins: payout = 10 × $1.00 = $10.00, profit = $8.00
    If YES loses: loss = $2.00
    Sell at 40¢: revenue = 10 × $0.40 = $4.00, profit = $2.00
    """
    pf = _load_portfolio()
    price = price_cents / 100.0
    cost = price * quantity

    if action == "buy":
        if cost > pf["cash"]:
            return {"error": "insufficient_funds", "cash": pf["cash"], "cost": cost}

        pf["cash"] -= cost
        position = {
            "id": f"pos-{int(time.time())}",
            "ticker": ticker,
            "side": side.upper(),
            "quantity": quantity,
            "entry_price": price,
            "current_price": price,
            "cost": round(cost, 2),
            "current_value": round(cost, 2),
            "pnl": 0.0,
            "pnl_pct": 0.0,
            "opened_at": datetime.now(timezone.utc).isoformat(),
        }
        pf["positions"].append(position)
        pf["trade_history"].append({
            **position, "action": "buy", "executed_at": position["opened_at"],
        })

    elif action == "sell":
        # Find matching position
        pos_idx = next(
            (i for i, p in enumerate(pf["positions"]) if p["ticker"] == ticker and p["side"] == side.upper()),
            None,
        )
        if pos_idx is None:
            return {"error": "no_position_found"}

        pos = pf["positions"][pos_idx]
        sell_qty = min(quantity, pos["quantity"])
        revenue = price * sell_qty
        pf["cash"] += revenue

        entry_cost = pos["entry_price"] * sell_qty
        pnl = revenue - entry_cost

        pf["trade_history"].append({
            "ticker": ticker, "side": side.upper(), "action": "sell",
            "quantity": sell_qty, "entry_price": pos["entry_price"],
            "exit_price": price, "pnl": round(pnl, 2),
            "executed_at": datetime.now(timezone.utc).isoformat(),
        })

        pos["quantity"] -= sell_qty
        if pos["quantity"] <= 0:
            pf["positions"].pop(pos_idx)
        else:
            pos["cost"] = round(pos["entry_price"] * pos["quantity"], 2)

    _save_portfolio(pf)

    return {
        "status": "ok",
        "action": action,
        "ticker": ticker,
        "side": side,
        "quantity": quantity,
        "price": price,
        "cost": round(cost, 2),
        "cash_remaining": round(pf["cash"], 2),
    }


@app.post("/api/portfolio/reset")
async def reset_portfolio(initial_capital: float = 10000.0):
    """Reset simulated portfolio to starting state."""
    pf = {
        "initial_capital": initial_capital,
        "cash": initial_capital,
        "positions": [],
        "trade_history": [],
    }
    _save_portfolio(pf)
    return {"status": "reset", "cash": initial_capital}


def _build_equity_curve(pf: dict, period: str) -> list[dict]:
    """Build equity curve from trade history."""
    history = pf.get("trade_history", [])
    initial = pf["initial_capital"]

    if not history:
        # No trades yet — flat line
        now = datetime.now(timezone.utc)
        return [
            {"time": (now - timedelta(hours=24)).isoformat(), "value": initial},
            {"time": now.isoformat(), "value": initial},
        ]

    # Reconstruct equity over time
    points = [{"time": history[0].get("executed_at", ""), "value": initial}]
    running = initial
    for trade in history:
        if trade.get("action") == "buy":
            running -= trade.get("cost", 0)
        elif trade.get("action") == "sell":
            running += trade.get("exit_price", 0) * trade.get("quantity", 0)
        points.append({"time": trade.get("executed_at", ""), "value": round(running, 2)})

    # Add current value
    current = pf["cash"] + sum(p.get("current_value", 0) for p in pf.get("positions", []))
    points.append({"time": datetime.now(timezone.utc).isoformat(), "value": round(current, 2)})

    return points


# ── Other existing endpoints (monitoring, etc.) ──────────────────────

@app.get("/api/monitoring/health")
async def health():
    now = datetime.now(timezone.utc)
    return {
        "overall_status": "healthy",
        "timestamp": now.isoformat(),
        "data_sources": [
            {"source": "kalshi_api", "status": "ok", "last_sync": now.isoformat(),
             "staleness_minutes": 0, "threshold_minutes": 5, "records_last_sync": 0, "error_message": None},
        ],
        "model_version": "v0.1",
        "db_connected": True,
        "redis_connected": True,
        "uptime_seconds": round(time.time() - START, 1),
    }


@app.get("/api/monitoring/alerts")
async def alerts():
    return {"alerts": [], "total": 0, "unacknowledged": 0}


@app.get("/api/dashboard/summary")
async def dashboard_summary():
    events = await _get_all_basketball_events()
    pf = _load_portfolio()
    total_value = pf["cash"] + sum(p.get("current_value", 0) for p in pf.get("positions", []))

    return {
        "today_date": str(date.today()),
        "total_games_today": len(events),
        "games_with_markets": len(events),
        "active_signals": 0,
        "actionable_signals": 0,
        "skipped_signals": 0,
        "best_edge": None,
        "best_edge_game": None,
        "avg_edge": None,
        "total_exposure_usd": sum(p.get("cost", 0) for p in pf.get("positions", [])),
        "daily_risk_pct": 0,
        "system_healthy": True,
        "data_sources_ok": 1,
        "data_sources_total": 1,
        "last_refresh": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/ping")
async def ping():
    return {"status": "ok", "uptime_s": round(time.time() - START, 1)}
