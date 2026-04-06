"""
BPMDE Terminal API — Real Kalshi data + simulated portfolio.
Run with: PYTHONPATH=. uvicorn src.api.demo_app:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
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
CACHE_TTL = 3  # seconds — real-time sync


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


async def _get_market_fast(ticker: str) -> dict:
    """Get market data using direct dollar fields — no orderbook call needed."""
    market = await kalshi.get_market(ticker)
    best_yes_bid = float(market.get("yes_bid_dollars", 0) or 0)
    best_yes_ask = float(market.get("yes_ask_dollars", 0) or 0)
    last_price = float(market.get("last_price_dollars", 0) or 0)
    prev_price = float(market.get("previous_price_dollars", 0) or 0)
    yes_mid = (best_yes_bid + best_yes_ask) / 2 if best_yes_bid > 0 and best_yes_ask > 0 else last_price

    market["_best_yes_bid"] = round(best_yes_bid, 4)
    market["_best_yes_ask"] = round(best_yes_ask, 4)
    market["_yes_mid"] = round(yes_mid, 4)
    market["_last_price"] = round(last_price, 4)
    market["_prev_price"] = round(prev_price, 4)
    market["_yes_depth"] = float(market.get("yes_ask_size_fp", 0) or 0)
    market["_no_depth"] = float(market.get("no_ask_size_fp", 0) or 0) if market.get("no_ask_size_fp") else 0
    market["_orderbook"] = {"yes": [], "no": []}
    market["_volume"] = int(float(market.get("volume_fp", 0) or 0))
    market["_volume_24h"] = int(float(market.get("volume_24h_fp", 0) or 0))
    market["_open_interest"] = int(float(market.get("open_interest_fp", 0) or 0))
    market["_no_bid"] = float(market.get("no_bid_dollars", 0) or 0)
    market["_no_ask"] = float(market.get("no_ask_dollars", 0) or 0)
    market["_yes_sub_title"] = market.get("yes_sub_title", "")
    market["_no_sub_title"] = market.get("no_sub_title", "")
    return market


async def _get_market_with_orderbook(ticker: str) -> dict:
    """Get market data with real Kalshi bid/ask + orderbook depth."""
    market = await kalshi.get_market(ticker)
    ob = await kalshi.get_orderbook(ticker)
    ob_fp = ob.get("orderbook_fp", ob.get("orderbook", {}))

    yes_bids = ob_fp.get("yes_dollars", ob_fp.get("yes", []))
    no_bids = ob_fp.get("no_dollars", ob_fp.get("no", []))

    # Use Kalshi's direct bid/ask fields — these are the real NBBO
    best_yes_bid = float(market.get("yes_bid_dollars", 0) or 0)
    best_yes_ask = float(market.get("yes_ask_dollars", 0) or 0)
    last_price = float(market.get("last_price_dollars", 0) or 0)
    prev_price = float(market.get("previous_price_dollars", 0) or 0)

    # Calculate total depth from orderbook
    yes_depth = sum(float(lvl[1]) for lvl in yes_bids) if yes_bids else 0
    no_depth = sum(float(lvl[1]) for lvl in no_bids) if no_bids else 0

    yes_mid = (best_yes_bid + best_yes_ask) / 2 if best_yes_bid > 0 and best_yes_ask > 0 else last_price

    market["_best_yes_bid"] = round(best_yes_bid, 4)
    market["_best_yes_ask"] = round(best_yes_ask, 4)
    market["_yes_mid"] = round(yes_mid, 4)
    market["_last_price"] = round(last_price, 4)
    market["_prev_price"] = round(prev_price, 4)
    market["_yes_depth"] = round(yes_depth, 2)
    market["_no_depth"] = round(no_depth, 2)
    market["_orderbook"] = {"yes": yes_bids, "no": no_bids}
    # Copy direct dollar fields for frontend
    market["_volume"] = int(float(market.get("volume_fp", 0) or 0))
    market["_volume_24h"] = int(float(market.get("volume_24h_fp", 0) or 0))
    market["_open_interest"] = int(float(market.get("open_interest_fp", 0) or 0))
    market["_no_bid"] = float(market.get("no_bid_dollars", 0) or 0)
    market["_no_ask"] = float(market.get("no_ask_dollars", 0) or 0)
    market["_yes_sub_title"] = market.get("yes_sub_title", "")
    market["_no_sub_title"] = market.get("no_sub_title", "")
    return market


# ── API Endpoints ────────────────────────────────────────────────────

@app.get("/api/games/today")
async def games_today():
    """All basketball games across all leagues with real-time odds."""
    events = await _get_all_basketball_events()

    games = []
    for e in events:
        markets = e.get("markets", [])
        home_market = markets[0] if len(markets) >= 1 else None
        away_market = markets[1] if len(markets) >= 2 else None

        # Extract teams from event title (format: "Away at Home")
        title = e.get("title", "")
        parts = title.split(" at ")
        away_team = parts[0].strip() if len(parts) == 2 else title
        home_team = parts[1].strip() if len(parts) == 2 else ""

        # Also get team names from market sub_titles (more accurate)
        home_sub = home_market.get("yes_sub_title", "") if home_market else ""
        away_sub = away_market.get("yes_sub_title", "") if away_market else ""
        if home_sub:
            home_team = home_sub
        if away_sub:
            away_team = away_sub

        # Real-time prices from market dollar fields
        home_bid = float(home_market.get("yes_bid_dollars", 0) or 0) if home_market else 0
        home_ask = float(home_market.get("yes_ask_dollars", 0) or 0) if home_market else 0
        home_last = float(home_market.get("last_price_dollars", 0) or 0) if home_market else 0
        home_mid = (home_bid + home_ask) / 2 if home_bid > 0 else home_last

        away_bid = float(away_market.get("yes_bid_dollars", 0) or 0) if away_market else 0
        away_ask = float(away_market.get("yes_ask_dollars", 0) or 0) if away_market else 0
        away_last = float(away_market.get("last_price_dollars", 0) or 0) if away_market else 0
        away_mid = (away_bid + away_ask) / 2 if away_bid > 0 else away_last

        home_pct = round(home_mid * 100) if home_mid > 0 else 0
        away_pct = round(away_mid * 100) if away_mid > 0 else 0

        # Volume from fp fields (more accurate)
        home_vol = int(float(home_market.get("volume_fp", 0) or 0)) if home_market else 0
        away_vol = int(float(away_market.get("volume_fp", 0) or 0)) if away_market else 0
        total_vol = home_vol + away_vol

        # Game start time = expected_expiration_time - 3 hours
        # Kalshi's expected_expiration is when market settles (after game ends)
        # NBA games typically last ~2.5h, so tipoff ≈ settlement - 3h
        exp_time = ""
        if home_market:
            exp_time = home_market.get("expected_expiration_time", "")
        if not exp_time:
            exp_time = e.get("close_time", "")

        # Convert to actual game start time
        game_start = exp_time
        if exp_time:
            try:
                exp_dt = datetime.fromisoformat(exp_time.replace("Z", "+00:00"))
                start_dt = exp_dt - timedelta(hours=3)
                game_start = start_dt.isoformat()
            except Exception:
                game_start = exp_time

        games.append({
            "game_id": e.get("event_ticker", ""),
            "game_date": str(date.today()),
            "game_time_utc": game_start,
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
            "volume": total_vol,
            # Real-time odds
            "home_pct": home_pct,
            "away_pct": away_pct,
            "home_bid": round(home_bid, 2),
            "home_ask": round(home_ask, 2),
            "away_bid": round(away_bid, 2),
            "away_ask": round(away_ask, 2),
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

    # Fetch real-time data for each market
    enriched_markets = []
    for m in markets:
        try:
            full = await _get_market_with_orderbook(m["ticker"])
            enriched_markets.append({
                "ticker": m["ticker"],
                "title": full.get("title", ""),
                "subtitle": full.get("subtitle", ""),
                "team_name": full["_yes_sub_title"] or "",
                # Prices — direct from Kalshi NBBO
                "yes_bid": full["_best_yes_bid"],
                "yes_ask": full["_best_yes_ask"],
                "yes_mid": full["_yes_mid"],
                "no_bid": full["_no_bid"],
                "no_ask": full["_no_ask"],
                "last_price": full["_last_price"],
                "prev_price": full["_prev_price"],
                # Depth
                "yes_depth": full["_yes_depth"],
                "no_depth": full["_no_depth"],
                # Volume
                "volume": full["_volume"],
                "volume_24h": full["_volume_24h"],
                "open_interest": full["_open_interest"],
                # Meta
                "status": full.get("status", ""),
                "close_time": full.get("close_time", ""),
                "expected_expiration_time": full.get("expected_expiration_time", ""),
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

    # Compute game start time (settlement - 3h)
    game_start = ""
    if enriched_markets:
        exp = enriched_markets[0].get("expected_expiration_time", "")
        if exp:
            try:
                exp_dt = datetime.fromisoformat(exp.replace("Z", "+00:00"))
                game_start = (exp_dt - timedelta(hours=3)).isoformat()
            except Exception:
                game_start = exp

    return {
        "game_id": game_id,
        "title": title,
        "home_team": home_team,
        "away_team": away_team,
        "league": event.get("_league", "NBA"),
        "game_time_utc": game_start,
        "close_time": event.get("close_time", ""),
        "home_pct": home_pct,
        "away_pct": away_pct,
        "markets": enriched_markets,
    }


@app.get("/api/games/{game_id}/price_history")
async def game_price_history(game_id: str, period: str = "1D"):
    """Real price history from Kalshi trade data."""
    events = await _get_all_basketball_events()
    event = next((e for e in events if e.get("event_ticker") == game_id), None)
    if not event:
        return {"error": "not_found"}

    markets = event.get("markets", [])
    title = event.get("title", "")
    teams = title.split(" at ")
    away_team = teams[0] if len(teams) == 2 else title
    home_team = teams[1] if len(teams) == 2 else ""

    # Get trade history for first market (home team outcome)
    price_history = []
    home_ticker = markets[0]["ticker"] if markets else None
    volume = 0
    yes_bid = 0.0
    yes_ask = 0.0
    last_price = 0.0

    if home_ticker:
        try:
            # Fetch real trades
            trades_data = await kalshi.get_market_trades(home_ticker, limit=500)
            trades = trades_data.get("trades", [])

            # Trades come newest first — reverse for chronological order
            trades.reverse()

            for t in trades:
                ts = t.get("created_time", "")
                yes_p = float(t.get("yes_price_dollars", 0))
                no_p = float(t.get("no_price_dollars", 0))
                size = float(t.get("count_fp", "0").replace(",", ""))
                price_history.append({
                    "time": ts,
                    "yes_price": round(yes_p, 4),
                    "no_price": round(no_p, 4),
                    "size": size,
                })

            # Get current market data
            m = await kalshi.get_market(home_ticker)
            volume = int(float(m.get("volume_fp", 0)))
            yes_bid = float(m.get("yes_bid_dollars", 0))
            yes_ask = float(m.get("yes_ask_dollars", 0))
            last_price = float(m.get("last_price_dollars", 0))
        except Exception:
            pass

    # Current prices
    yes_mid = (yes_bid + yes_ask) / 2 if yes_bid > 0 else (last_price or 0.5)
    no_mid = 1 - yes_mid

    # Game start time = expected_expiration - 3 hours
    game_start = ""
    if home_ticker:
        try:
            m = await kalshi.get_market(home_ticker)
            exp = m.get("expected_expiration_time", "")
            if exp:
                exp_dt = datetime.fromisoformat(exp.replace("Z", "+00:00"))
                game_start = (exp_dt - timedelta(hours=3)).isoformat()
        except Exception:
            pass
    if not game_start:
        game_start = event.get("close_time", "")

    return {
        "game_id": game_id,
        "home_team": home_team,
        "away_team": away_team,
        "game_time_utc": game_start,
        "question": title,
        "yes_price": round(yes_mid, 2),
        "no_price": round(no_mid, 2),
        "yes_bid": round(yes_bid, 2),
        "yes_ask": round(yes_ask, 2),
        "home_pct": round(yes_mid * 100),
        "away_pct": round(no_mid * 100),
        "volume": volume,
        "period": period,
        "price_history": price_history,
    }


# ── Pre-Game Analysis ────────────────────────────────────────────────

@app.get("/api/games/{game_id}/analysis")
async def game_analysis(game_id: str):
    """Run pre-game decision engine on a specific game."""
    from src.signals.pregame_engine import PreGameEngine, FundamentalsProfile, MarketData as PGMarketData

    events = await _get_all_basketball_events()
    event = next((e for e in events if e.get("event_ticker") == game_id), None)
    if not event:
        return {"error": "not_found"}

    markets = event.get("markets", [])
    if len(markets) < 2:
        return {"error": "need_two_markets"}

    title = event.get("title", "")
    parts = title.split(" at ")
    away_name = parts[0].strip() if len(parts) == 2 else title
    home_name = parts[1].strip() if len(parts) == 2 else ""

    # Fetch real market data — parallel for speed
    import asyncio as _aio
    try:
        m0, m1 = await _aio.gather(
            _get_market_fast(markets[0]["ticker"]),
            _get_market_fast(markets[1]["ticker"]),
        )
    except Exception:
        return {"error": "market_fetch_failed"}

    home_sub = m0.get("_yes_sub_title", "") or home_name
    away_sub = m1.get("_yes_sub_title", "") or away_name

    home_mkt = PGMarketData(
        ticker=markets[0]["ticker"], team_name=home_sub,
        yes_bid=m0["_best_yes_bid"], yes_ask=m0["_best_yes_ask"],
        no_bid=float(m0.get("no_bid_dollars", 0) or 0),
        no_ask=float(m0.get("no_ask_dollars", 0) or 0),
        last_price=m0["_last_price"],
        volume=m0["_volume"], volume_24h=int(float(m0.get("volume_24h_fp", 0) or 0)),
        open_interest=m0["_open_interest"],
        yes_depth=m0["_yes_depth"], no_depth=m0["_no_depth"],
        spread=round(m0["_best_yes_ask"] - m0["_best_yes_bid"], 4),
    )
    away_mkt = PGMarketData(
        ticker=markets[1]["ticker"], team_name=away_sub,
        yes_bid=m1["_best_yes_bid"], yes_ask=m1["_best_yes_ask"],
        no_bid=float(m1.get("no_bid_dollars", 0) or 0),
        no_ask=float(m1.get("no_ask_dollars", 0) or 0),
        last_price=m1["_last_price"],
        volume=m1["_volume"], volume_24h=int(float(m1.get("volume_24h_fp", 0) or 0)),
        open_interest=m1["_open_interest"],
        yes_depth=m1["_yes_depth"], no_depth=m1["_no_depth"],
        spread=round(m1["_best_yes_ask"] - m1["_best_yes_bid"], 4),
    )

    # Build fundamentals from REAL NBA data
    from src.api.nba_data import get_all_team_stats, find_team

    try:
        all_nba = get_all_team_stats()
    except Exception:
        all_nba = {}

    home_nba = find_team(home_sub, all_nba) if all_nba else None
    away_nba = find_team(away_sub, all_nba) if all_nba else None

    def _build_fund(name: str, is_home: bool, nba: dict | None, mkt_mid: float) -> FundamentalsProfile:
        if nba:
            # Get extended data (rest days, H2H, player data)
            from src.api.nba_extended import get_team_schedule_info, get_h2h_record, get_team_key_players
            team_id = nba.get("team_id", 0)

            try:
                sched = get_team_schedule_info(team_id)
            except Exception:
                sched = {"rest_days": 2, "is_b2b": False}

            # Get opponent team ID for H2H
            opp_name = away_sub if is_home else home_sub
            opp_nba = find_team(opp_name, all_nba) if all_nba else None
            opp_id = opp_nba.get("team_id", 0) if opp_nba else 0

            h2h_wins, h2h_losses = 0, 0
            if opp_id:
                try:
                    h2h = get_h2h_record(team_id, opp_id)
                    h2h_wins = h2h.get("wins", 0)
                    h2h_losses = h2h.get("losses", 0)
                except Exception:
                    pass

            # Get key players and infer injury impact
            injury_impact = 0.0
            key_injuries = []
            try:
                players = get_team_key_players(team_id)
                for p in players[:8]:
                    if p.get("possibly_injured"):
                        injury_impact += min(0.2, p["impact_score"] / 60)
                        key_injuries.append(f"{p['name']} (missed {p['games_missed']}G)")
                injury_impact = min(1.0, injury_impact)
            except Exception:
                pass

            # Parse win streak
            streak_raw = nba.get("streak", 0)
            streak = int(streak_raw) if isinstance(streak_raw, (int, float)) else 0

            return FundamentalsProfile(
                team_name=nba["team_name"],
                is_home=is_home,
                season_win_pct=nba.get("win_pct", 0.5),
                home_win_pct=nba.get("home_win_pct", 0.5) if is_home else nba.get("road_win_pct", 0.5),
                last5_wins=nba.get("last5_wins", 3),
                last5_losses=nba.get("last5_losses", 2),
                last10_wins=nba.get("last10_wins", 5),
                last10_losses=nba.get("last10_losses", 5),
                off_rating=nba.get("off_rating", 110),
                def_rating=nba.get("def_rating", 110),
                net_rating=nba.get("net_rating", 0),
                elo=nba.get("elo", 1500),
                win_streak=streak,
                rest_days=sched.get("rest_days", 2),
                is_b2b=sched.get("is_b2b", False),
                injury_impact=injury_impact,
                key_injuries=key_injuries,
                h2h_wins_season=h2h_wins,
                h2h_losses_season=h2h_losses,
            )
        else:
            # Fallback: estimate from market price
            return FundamentalsProfile(
                team_name=name, is_home=is_home,
                season_win_pct=mkt_mid if mkt_mid > 0 else 0.5,
                elo=1500 + (mkt_mid - 0.5) * 200 if mkt_mid > 0 else 1500,
            )

    home_fund = _build_fund(home_sub, True, home_nba, (home_mkt.yes_bid + home_mkt.yes_ask) / 2)
    away_fund = _build_fund(away_sub, False, away_nba, (away_mkt.yes_bid + away_mkt.yes_ask) / 2)

    # Time to game
    exp = m0.get("expected_expiration_time", "")
    ttg = 12.0
    if exp:
        try:
            from datetime import datetime, timedelta, timezone
            exp_dt = datetime.fromisoformat(exp.replace("Z", "+00:00"))
            start_dt = exp_dt - timedelta(hours=3)
            ttg = max(0, (start_dt - datetime.now(timezone.utc)).total_seconds() / 3600)
        except Exception:
            pass

    pf = _load_portfolio()
    exposure = sum(p.get("cost", 0) for p in pf.get("positions", []))

    engine = PreGameEngine(bankroll=pf.get("cash", 10000) + exposure)
    analysis = engine.analyze(home_mkt, away_mkt, home_fund, away_fund, ttg, exposure)

    # Serialize to JSON-friendly dict
    return {
        "trade_decision": analysis.trade_decision,
        "direction": analysis.direction,
        "skip_reason": analysis.skip_reason,
        "fundamental_prob": analysis.fundamental_prob,
        "market_prob": analysis.market_prob,
        "blended_fair_prob": analysis.blended_fair_prob,
        "entry_price_cents": analysis.entry_price_cents,
        "spread_cents": analysis.spread_cents,
        "edge": round(analysis.edge, 4),
        "edge_pct": analysis.edge_pct,
        "expected_value": analysis.expected_value,
        "ev_per_contract": analysis.expected_value_per_contract,
        "kelly_full": analysis.kelly_fraction,
        "kelly_quarter": analysis.kelly_quarter,
        "suggested_stake_usd": analysis.suggested_stake_usd,
        "suggested_contracts": analysis.suggested_contracts,
        "entry_strategy": analysis.entry_strategy,
        "scale_in_tranches": analysis.scale_in_tranches,
        "stop_loss_price": analysis.stop_loss_price,
        "stop_loss_pct": analysis.stop_loss_pct,
        "take_profit_zones": [
            {"price": z.price, "pct": z.pct_to_sell, "pnl": z.expected_pnl_per_contract, "label": z.label}
            for z in analysis.take_profit_zones
        ],
        "hedge": {
            "should_hedge": analysis.hedge.should_hedge,
            "side": analysis.hedge.hedge_side,
            "size_pct": analysis.hedge.hedge_size_pct,
            "price": analysis.hedge.hedge_price,
            "cost": analysis.hedge.hedge_cost,
            "reason": analysis.hedge.reason,
            "guaranteed_min_pnl": analysis.hedge.guaranteed_min_pnl,
        },
        "profit_if_correct": analysis.expected_profit_if_correct,
        "profit_pregame": analysis.expected_profit_pregame,
        "max_loss": analysis.max_loss,
        "confidence_score": analysis.confidence_score,
        "confidence_tier": analysis.confidence_tier,
        "risk_alerts": analysis.risk_alerts,
        "key_factors": analysis.key_factors,
        "phase": analysis.phase,
        "time_to_game_hours": round(ttg, 1),
        "home_team": analysis.home_team,
        "away_team": analysis.away_team,
        "summary": analysis.summary(),
    }


@app.get("/api/scores/live")
async def live_scores():
    """Real-time NBA scores from NBA Live API."""
    from src.api.nba_extended import get_live_scores
    return {"games": get_live_scores()}


@app.get("/api/analysis/all")
async def all_game_analyses(league: str = ""):
    """Run pre-game analysis on games. Cached to avoid hammering Kalshi."""
    global _cache

    cache_key = f"analysis_all_{league}"
    if cache_key in _cache and (time.time() - _cache.get(f"{cache_key}_ts", 0)) < 15:
        return _cache[cache_key]

    events = await _get_all_basketball_events()
    results = []

    # Filter to requested league, default to NBA only for speed
    target_leagues = {"NBA"} if not league else {league}
    if league == "ALL":
        target_leagues = set()  # no filter

    filtered = [e for e in events if not target_leagues or e.get("_league") in target_leagues]

    # Parallel analysis for all games — much faster
    import asyncio as _aio

    async def _analyze_one(event_ticker: str):
        try:
            a = await game_analysis(event_ticker)
            if isinstance(a, dict) and "error" not in a:
                a["game_id"] = event_ticker
                return a
        except Exception:
            pass
        return None

    tasks = [_analyze_one(e.get("event_ticker", "")) for e in filtered[:20]]
    batch = await _aio.gather(*tasks)
    results = [r for r in batch if r is not None]

    results.sort(key=lambda x: x.get("edge", 0), reverse=True)
    response = {"analyses": results, "total": len(results)}

    _cache[cache_key] = response
    _cache[f"{cache_key}_ts"] = time.time()
    return response


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


# ══════════════════════════════════════════════════════════════════════
# WebSocket — Real-time price streaming (1-2 second updates)
# ══════════════════════════════════════════════════════════════════════

_ws_clients: set[WebSocket] = set()
_live_prices: dict[str, dict] = {}  # ticker -> latest price data
_streamer_running = False


async def _price_streamer():
    """Background task: polls Kalshi every 1.5s and pushes to all WebSocket clients."""
    global _live_prices, _streamer_running
    _streamer_running = True

    while True:
        try:
            events = await _get_all_basketball_events()
            # Only stream NBA games (most active)
            nba = [e for e in events if e.get("_league") == "NBA"]

            # Parallel fetch all NBA market prices
            tickers = []
            for e in nba:
                markets = e.get("markets", [])
                for m in markets:
                    tickers.append((e.get("event_ticker", ""), m.get("ticker", ""), e.get("title", "")))

            async def _fetch_price(event_id: str, ticker: str, title: str):
                try:
                    m = await kalshi.get_market(ticker)
                    return {
                        "event_id": event_id,
                        "ticker": ticker,
                        "title": title,
                        "team": m.get("yes_sub_title", ""),
                        "yes_bid": float(m.get("yes_bid_dollars", 0) or 0),
                        "yes_ask": float(m.get("yes_ask_dollars", 0) or 0),
                        "no_bid": float(m.get("no_bid_dollars", 0) or 0),
                        "no_ask": float(m.get("no_ask_dollars", 0) or 0),
                        "last_price": float(m.get("last_price_dollars", 0) or 0),
                        "volume": int(float(m.get("volume_fp", 0) or 0)),
                        "ts": datetime.now(timezone.utc).isoformat(),
                    }
                except Exception:
                    return None

            results = await asyncio.gather(*[_fetch_price(eid, t, title) for eid, t, title in tickers[:40]])
            updates = [r for r in results if r is not None]

            # Store latest prices
            for u in updates:
                _live_prices[u["ticker"]] = u

            # Push to all connected clients
            if _ws_clients and updates:
                msg = json.dumps({
                    "type": "price_update",
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "prices": updates,
                })
                dead = set()
                for ws in _ws_clients.copy():
                    try:
                        await ws.send_text(msg)
                    except Exception:
                        dead.add(ws)
                _ws_clients -= dead

        except Exception:
            pass

        await asyncio.sleep(1.5)  # Poll every 1.5 seconds


@app.websocket("/ws/prices")
async def ws_prices(websocket: WebSocket):
    """WebSocket endpoint for real-time price streaming."""
    await websocket.accept()
    _ws_clients.add(websocket)

    # Send current cached prices immediately
    if _live_prices:
        await websocket.send_text(json.dumps({
            "type": "price_update",
            "ts": datetime.now(timezone.utc).isoformat(),
            "prices": list(_live_prices.values()),
        }))

    # Start streamer if not running
    global _streamer_running
    if not _streamer_running:
        asyncio.create_task(_price_streamer())

    try:
        while True:
            # Keep connection alive, handle client messages
            data = await websocket.receive_text()
            # Client can request specific game subscription
            if data.startswith("subscribe:"):
                pass  # future: per-game subscriptions
    except WebSocketDisconnect:
        _ws_clients.discard(websocket)


@app.on_event("startup")
async def start_streamer():
    """Start the price streaming background task on server startup."""
    asyncio.create_task(_price_streamer())


@app.get("/api/prices/live")
async def live_prices():
    """REST fallback: get latest cached prices (for clients that can't use WebSocket)."""
    return {
        "prices": list(_live_prices.values()),
        "count": len(_live_prices),
        "ts": datetime.now(timezone.utc).isoformat(),
    }
