"""
Live demo data provider — fetches real market data from Kalshi's public API
and generates realistic signal/feature data for the terminal UI.

No database required. No authentication required for market discovery.
"""

from __future__ import annotations

import hashlib
import math
import random
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx

KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2"

BASKETBALL_KEYWORDS = [
    "NBA", "basketball", "Lakers", "Warriors", "Celtics", "Bucks",
    "Heat", "Nuggets", "Knicks", "Nets", "Suns", "Clippers",
    "76ers", "Bulls", "Pistons", "Pacers", "Cavaliers", "Hornets",
    "Magic", "Raptors", "Hawks", "Wizards", "Finals", "playoff",
    "Conference", "championship", "Thunder", "Timberwolves",
    "Rockets", "Grizzlies", "Pelicans", "Kings", "Spurs", "Blazers",
    "Jazz", "Mavericks",
]

# Team abbrev lookup
TEAM_ABBREVS: dict[str, str] = {
    "lakers": "LAL", "warriors": "GSW", "celtics": "BOS", "bucks": "MIL",
    "heat": "MIA", "nuggets": "DEN", "knicks": "NYK", "nets": "BKN",
    "suns": "PHX", "clippers": "LAC", "76ers": "PHI", "sixers": "PHI",
    "bulls": "CHI", "pistons": "DET", "pacers": "IND", "cavaliers": "CLE",
    "cavs": "CLE", "hornets": "CHA", "magic": "ORL", "raptors": "TOR",
    "hawks": "ATL", "wizards": "WAS", "thunder": "OKC", "timberwolves": "MIN",
    "wolves": "MIN", "rockets": "HOU", "grizzlies": "MEM", "pelicans": "NOP",
    "kings": "SAC", "spurs": "SAS", "blazers": "POR", "trail blazers": "POR",
    "jazz": "UTA", "mavericks": "DAL", "mavs": "DAL",
}

# Seed for deterministic-ish team stats based on team name
def _seed(s: str) -> random.Random:
    return random.Random(hashlib.md5(s.encode()).hexdigest())


def _extract_teams(title: str) -> tuple[str, str]:
    """Best-effort extraction of two team abbreviations from market title."""
    title_lower = title.lower()
    found = []
    for name, abbr in TEAM_ABBREVS.items():
        if name in title_lower and abbr not in found:
            found.append(abbr)
    if len(found) >= 2:
        return found[0], found[1]
    if len(found) == 1:
        return found[0], "OPP"
    return "TM1", "TM2"


def _make_team_stats(abbr: str, rng: random.Random) -> dict:
    net = rng.gauss(0, 5)
    off = 110 + rng.gauss(0, 3)
    def_ = off - net
    return {
        "team_abbr": abbr,
        "off_rating": round(off, 1),
        "def_rating": round(def_, 1),
        "net_rating": round(net, 1),
        "pace": round(98 + rng.gauss(0, 2), 1),
        "efg_pct": round(0.50 + rng.gauss(0, 0.03), 3),
        "ts_pct": round(0.56 + rng.gauss(0, 0.02), 3),
        "tov_pct": round(13.5 + rng.gauss(0, 1.5), 1),
        "orb_pct": round(25 + rng.gauss(0, 3), 1),
        "drb_pct": round(75 + rng.gauss(0, 3), 1),
        "last3_net": round(net + rng.gauss(0, 3), 1),
        "last5_net": round(net + rng.gauss(0, 2), 1),
        "last10_net": round(net + rng.gauss(0, 1.5), 1),
        "home_net": round(net + 2.5, 1),
        "road_net": round(net - 2.5, 1),
        "elo": round(1500 + net * 20 + rng.gauss(0, 30)),
        "win_streak": rng.randint(-5, 8),
        "rest_days": rng.choice([1, 1, 2, 2, 3, 4]),
        "is_b2b": rng.random() < 0.15,
        "injury_impact": round(max(0, rng.gauss(0.1, 0.15)), 2),
    }


def _generate_signal(market: dict, away: str, home: str) -> dict:
    """Generate a realistic signal from a Kalshi market."""
    rng = _seed(market.get("ticker", ""))

    yes_bid = (market.get("yes_bid") or 0) / 100
    yes_ask = (market.get("yes_ask") or 100) / 100
    yes_mid = (yes_bid + yes_ask) / 2
    spread = yes_ask - yes_bid

    # Simulate sportsbook novig — key source of edge.
    # The sportsbook line can diverge meaningfully from Kalshi prices,
    # especially for popular teams or when injury news hits books first.
    # Roughly 30% of games should show actionable edge (>4%).
    book_divergence = rng.choice([
        rng.uniform(0.06, 0.12),   # strong book-market divergence (edge likely)
        rng.uniform(0.03, 0.07),   # moderate divergence
        rng.uniform(-0.02, 0.04),  # mild / neutral
        rng.uniform(-0.04, 0.01),  # market agrees with book
    ])
    book_novig = max(0.05, min(0.95, yes_mid + book_divergence))

    # Simulate model probability — model trained on team features
    # tends to agree with sportsbook but adds its own signal
    model_divergence = book_divergence * rng.uniform(0.5, 1.2) + rng.gauss(0, 0.02)
    model_prob = max(0.05, min(0.95, yes_mid + model_divergence))

    # Ensemble: 35% book + 40% model + 25% market
    fair = 0.35 * book_novig + 0.40 * model_prob + 0.25 * yes_mid
    fair = max(0.05, min(0.95, fair))

    # Fee-adjusted executable probability (what you need to break even buying YES at ask)
    fee_adj = yes_ask / (1 - 0.02)

    # Edge = fair_prob - fee_adj_cost (positive = we think YES is underpriced)
    edge = fair - fee_adj
    ev = fair / fee_adj - 1 if fee_adj > 0 and fee_adj < 1 else 0

    # Kelly
    if fee_adj > 0 and fee_adj < 1:
        b = (1 - fee_adj) / fee_adj
        kelly_full = max(0, (b * fair - (1 - fair)) / b)
    else:
        kelly_full = 0

    kelly_suggested = kelly_full * 0.25
    suggested_size = min(kelly_suggested * 10000, 200)

    # CI
    disagreement = abs(book_novig - model_prob) / 2
    ci_margin = 1.96 * (disagreement + 0.02)
    ci_lower = max(0.01, fair - ci_margin)
    ci_upper = min(0.99, fair + ci_margin)

    # Confidence
    ci_score = max(0, 1 - (ci_upper - ci_lower) / 0.30)
    edge_score = min(1, max(0, edge) / 0.12)
    liq_score = min(1, (market.get("volume") or 0) / 10000)
    conf_score = round(0.30 * ci_score + 0.25 * edge_score + 0.20 * liq_score + 0.25 * 0.7, 3)
    conf_tier = "HIGH" if conf_score >= 0.7 else "MED" if conf_score >= 0.45 else "LOW"

    # Direction
    if edge > 0.04:
        direction = "YES"
        is_actionable = True
        skip_reason = None
    elif edge > 0:
        direction = "YES"
        is_actionable = False
        skip_reason = f"edge_below_threshold: {edge:.4f} < 0.04"
    else:
        direction = "SKIP"
        is_actionable = False
        skip_reason = "no_positive_edge"

    # Apply more realistic filters
    if is_actionable and conf_score < 0.55:
        is_actionable = False
        skip_reason = f"confidence_below_threshold: {conf_score:.3f}"
    if is_actionable and disagreement > 0.10:
        is_actionable = False
        skip_reason = f"model_disagreement_too_high: {disagreement:.3f}"

    # Key drivers
    drivers = []
    net_diff = rng.gauss(0, 5)
    if abs(net_diff) > 2:
        drivers.append({"factor": "net_rating_advantage", "raw_value": round(net_diff, 2), "impact": round(net_diff * 0.004, 3)})
    if rng.random() > 0.5:
        b2b = rng.choice([-1, 0, 1])
        if b2b != 0:
            drivers.append({"factor": "back_to_back_advantage", "raw_value": b2b, "impact": round(b2b * 0.03, 3)})
    if rng.random() > 0.6:
        inj = rng.gauss(0, 0.2)
        drivers.append({"factor": "injury_impact", "raw_value": round(inj, 2), "impact": round(inj * 0.025, 3)})

    # Risk flags
    risk_flags = []
    if spread > 0.06:
        risk_flags.append({"flag": "wide_spread", "severity": "LOW", "note": f"Bid-ask spread = {spread:.3f}"})
    if disagreement > 0.08:
        risk_flags.append({"flag": "model_disagreement", "severity": "MEDIUM", "note": f"Model std = {disagreement:.3f}"})
    if rng.random() > 0.85:
        risk_flags.append({"flag": "gtd_star_unconfirmed", "severity": "HIGH", "note": "Star player GTD with <3h to tipoff"})
        if is_actionable:
            is_actionable = False
            skip_reason = "high_severity_risk: ['gtd_star_unconfirmed']"

    # Filter gates
    gates = [
        {"gate_name": "Positive Edge", "threshold": "> 0", "actual_value": f"{edge:.4f}", "passed": edge > 0},
        {"gate_name": "Min Edge", "threshold": ">= 0.04", "actual_value": f"{edge:.4f}", "passed": edge >= 0.04},
        {"gate_name": "Min EV", "threshold": ">= 0.03", "actual_value": f"{ev:.4f}", "passed": ev >= 0.03},
        {"gate_name": "Liquidity", "threshold": ">= 0.15", "actual_value": f"{liq_score:.3f}", "passed": liq_score >= 0.15},
        {"gate_name": "Confidence Score", "threshold": ">= 0.55", "actual_value": f"{conf_score:.3f}", "passed": conf_score >= 0.55},
        {"gate_name": "Model Agreement", "threshold": "<= 0.10", "actual_value": f"{disagreement:.3f}", "passed": disagreement <= 0.10},
        {"gate_name": "Injury Uncertainty", "threshold": "<= 0.70", "actual_value": f"{rng.random() * 0.5:.3f}", "passed": True},
        {"gate_name": "Time to Game", "threshold": "0.5–96h", "actual_value": f"{rng.uniform(1, 24):.1f}h", "passed": True},
        {"gate_name": "No HIGH Risk Flags", "threshold": "0 HIGH flags",
         "actual_value": str(sum(1 for f in risk_flags if f["severity"] == "HIGH")),
         "passed": not any(f["severity"] == "HIGH" for f in risk_flags)},
    ]

    return {
        "signal_id": hashlib.md5(market.get("ticker", "").encode()).hexdigest()[:16],
        "direction": direction if is_actionable else ("SKIP" if skip_reason else direction),
        "edge": round(edge, 4),
        "expected_value": round(ev, 4),
        "kelly_full": round(kelly_full, 4),
        "kelly_suggested": round(kelly_suggested, 4),
        "suggested_size_usd": round(suggested_size, 2) if is_actionable else None,
        "is_actionable": is_actionable,
        "skip_reason": skip_reason,
        "probability": {
            "sportsbook_novig": round(book_novig, 4),
            "model_raw": round(model_prob, 4),
            "model_calibrated": round(model_prob * 0.98 + 0.01, 4),
            "market_mid": round(yes_mid, 4),
            "ensemble_fair": round(fair, 4),
            "ci_lower": round(ci_lower, 4),
            "ci_upper": round(ci_upper, 4),
            "weights": {"sportsbook": 0.35, "basketball_model": 0.40, "market": 0.25},
        },
        "confidence": {
            "score": conf_score,
            "tier": conf_tier,
            "model_disagreement": round(disagreement, 3),
        },
        "key_drivers": sorted(drivers, key=lambda d: abs(d["impact"]), reverse=True)[:3],
        "risk_flags": risk_flags,
        "filter_gates": gates,
        "yes_bid": round(yes_bid, 4),
        "yes_ask": round(yes_ask, 4),
        "yes_mid": round(yes_mid, 4),
        "spread": round(spread, 4),
        "volume_24h": market.get("volume"),
        "open_interest": market.get("open_interest"),
        "liquidity_score": round(liq_score, 3),
    }


async def fetch_kalshi_basketball_markets() -> list[dict]:
    """
    Fetch NBA single-game markets from Kalshi.
    Filters out multi-sport parlays. Falls back to synthetic if no
    real single-game NBA markets are available.
    """
    async with httpx.AsyncClient(base_url=KALSHI_BASE, timeout=30.0) as client:
        markets: list[dict] = []
        cursor: str | None = None

        for _ in range(5):
            params: dict[str, Any] = {"limit": 200, "status": "open"}
            if cursor:
                params["cursor"] = cursor

            try:
                resp = await client.get("/markets", params=params)
                if resp.status_code != 200:
                    break
            except Exception:
                break

            data = resp.json()
            batch = data.get("markets", [])
            for m in batch:
                title = (m.get("title") or "").upper()
                subtitle = (m.get("subtitle") or "").upper()
                category = (m.get("category") or "").lower()
                series = (m.get("series_ticker") or "").upper()
                combined = f"{title} {subtitle} {series} {category}"

                # Must have NBA keyword AND yes_bid (real pricing)
                is_nba = any(kw.upper() in combined for kw in BASKETBALL_KEYWORDS)
                has_pricing = m.get("yes_bid") is not None and m.get("yes_ask") is not None
                # Filter out multi-sport parlays (they have many commas in the title)
                is_parlay = title.count(",") > 2

                if is_nba and has_pricing and not is_parlay:
                    markets.append(m)

            cursor = data.get("cursor")
            if not cursor or len(batch) < 200:
                break

        return markets


def build_demo_game(market: dict, idx: int) -> dict:
    """Transform a Kalshi market dict into a game + signal for the terminal."""
    title = market.get("title") or market.get("ticker") or f"Market {idx}"
    away, home = _extract_teams(title)
    rng = _seed(market.get("ticker", str(idx)))

    game_time = datetime.now(timezone.utc) + timedelta(hours=rng.uniform(1, 8))
    game_id = f"NBA_{date.today().strftime('%Y%m%d')}_{away}_{home}_{idx}"

    signal = _generate_signal(market, away, home)

    home_stats = _make_team_stats(home, _seed(home))
    away_stats = _make_team_stats(away, _seed(away))

    return {
        "game_id": game_id,
        "game_date": str(date.today()),
        "game_time_utc": game_time.isoformat(),
        "home_team": home,
        "away_team": away,
        "venue": f"{home} Arena",
        "season_type": rng.choice(["Regular", "Regular", "Playoff"]),
        "series_info": None,
        "is_b2b_home": rng.random() < 0.15,
        "is_b2b_away": rng.random() < 0.15,
        "market": {
            "contract_id": market.get("ticker", ""),
            "platform": "kalshi",
            "market_type": "moneyline",
            "question": title,
            "outcome": f"{home} wins",
            "status": market.get("status", "open"),
            "yes_bid": signal["yes_bid"],
            "yes_ask": signal["yes_ask"],
            "yes_mid": signal["yes_mid"],
            "spread": signal["spread"],
            "volume_24h": signal["volume_24h"],
            "open_interest": signal["open_interest"],
            "fee_pct": 0.02,
        },
        "signal": signal,
        "home_stats": home_stats,
        "away_stats": away_stats,
        "home_injuries": _make_injuries(home, rng),
        "away_injuries": _make_injuries(away, rng),
    }


def _make_injuries(team: str, rng: random.Random) -> list[dict]:
    """Generate 0-3 realistic injuries."""
    n = rng.choices([0, 1, 2, 3], weights=[0.3, 0.35, 0.25, 0.1])[0]
    names = [
        "J. Smith", "A. Johnson", "M. Williams", "D. Brown", "K. Davis",
        "T. Wilson", "C. Moore", "R. Taylor", "L. Anderson", "S. Thomas",
    ]
    statuses = ["Out", "Doubtful", "Questionable", "Probable", "Game Time Decision"]
    injuries = []
    for i in range(n):
        bpm = round(rng.gauss(1, 3), 1)
        status = rng.choice(statuses)
        injuries.append({
            "player_name": rng.choice(names),
            "status": status,
            "injury_type": rng.choice(["Knee", "Ankle", "Hamstring", "Back", "Illness"]),
            "bpm": bpm,
            "usg_pct": round(rng.uniform(0.12, 0.30), 2),
            "impact_weight": round(max(0, bpm / 5) * {"Out": 1.0, "Doubtful": 0.75, "Questionable": 0.5, "Probable": 0.15, "Game Time Decision": 0.4}.get(status, 0.3), 2),
            "is_star": bpm >= 3.0,
        })
    return injuries


def _make_backtest_runs() -> list[dict]:
    """Generate sample backtest runs."""
    return [
        {
            "run_id": "bt-v01-full-season",
            "run_name": "Full Season v0.1",
            "start_date": "2025-10-22",
            "end_date": "2026-04-05",
            "model_version": "v0.1",
            "total_signals": 2847,
            "signals_executed": 412,
            "hit_rate": 0.563,
            "roi_pct": 8.7,
            "total_pnl_usd": 870.42,
            "sharpe_ratio": 1.82,
            "max_drawdown_pct": -4.3,
            "avg_hold_hours": 3.2,
            "avg_edge": 0.062,
            "by_confidence": {
                "HIGH": {"count": 89, "hit_rate": 0.62, "roi_pct": 14.2},
                "MED": {"count": 198, "hit_rate": 0.56, "roi_pct": 7.8},
                "LOW": {"count": 125, "hit_rate": 0.52, "roi_pct": 3.1},
            },
            "by_market_type": {
                "moneyline": {"count": 380, "hit_rate": 0.57, "roi_pct": 9.1},
                "series_winner": {"count": 32, "hit_rate": 0.50, "roi_pct": 4.2},
            },
        },
        {
            "run_id": "bt-v01-playoffs",
            "run_name": "Playoff Only v0.1",
            "start_date": "2025-04-19",
            "end_date": "2025-06-20",
            "model_version": "v0.1",
            "total_signals": 340,
            "signals_executed": 68,
            "hit_rate": 0.588,
            "roi_pct": 12.4,
            "total_pnl_usd": 1240.00,
            "sharpe_ratio": 2.15,
            "max_drawdown_pct": -3.1,
            "avg_hold_hours": 2.8,
            "avg_edge": 0.071,
            "by_confidence": None,
            "by_market_type": None,
        },
    ]


# Cache for the session
_cache: dict[str, Any] = {}


async def get_demo_data() -> dict[str, Any]:
    """Fetch and cache demo data for the current session."""
    if "games" in _cache:
        return _cache

    try:
        raw_markets = await fetch_kalshi_basketball_markets()
    except Exception:
        raw_markets = []

    # If no markets found, create synthetic ones
    if not raw_markets:
        raw_markets = _synthetic_markets()

    games = [build_demo_game(m, i) for i, m in enumerate(raw_markets[:20])]

    _cache["games"] = games
    _cache["backtest_runs"] = _make_backtest_runs()
    _cache["fetched_at"] = datetime.now(timezone.utc).isoformat()
    return _cache


def _synthetic_markets() -> list[dict]:
    """Realistic NBA matchups with varied edge profiles."""
    # bid/ask in cents — model divergence baked into spread and levels
    matchups = [
        # Strong edges (model sees value)
        ("Will the Celtics beat the Heat?", "BOS", "MIA", 58, 62, 8500, 42000),
        ("Will the Thunder beat the Nuggets?", "OKC", "DEN", 61, 65, 12000, 55000),
        # Moderate edges
        ("Will the Knicks beat the Pacers?", "NYK", "IND", 53, 58, 6200, 31000),
        ("Will the Cavaliers beat the Bucks?", "CLE", "MIL", 55, 59, 7800, 38000),
        # Close / marginal
        ("Will the Mavericks beat the Suns?", "DAL", "PHX", 47, 52, 4100, 22000),
        ("Will the Lakers beat the Warriors?", "LAL", "GSW", 42, 47, 9500, 61000),
        # Negative edge (market fairly priced)
        ("Will the Timberwolves beat the Rockets?", "MIN", "HOU", 50, 55, 3200, 18000),
        ("Will the Kings beat the Clippers?", "SAC", "LAC", 38, 43, 2800, 15000),
        # Playoff-like markets
        ("Will the Nuggets beat the 76ers?", "DEN", "PHI", 64, 68, 15000, 72000),
        ("Will the Hawks beat the Magic?", "ATL", "ORL", 44, 49, 1900, 9500),
        ("Will the Grizzlies beat the Pelicans?", "MEM", "NOP", 57, 61, 5500, 28000),
        ("Will the Pacers beat the Raptors?", "IND", "TOR", 66, 70, 4300, 21000),
    ]
    markets = []
    for title, home, away, bid, ask, vol, oi in matchups:
        markets.append({
            "ticker": f"NBA-{home}-{away}-{date.today().strftime('%Y%m%d')}",
            "title": title,
            "subtitle": f"{away} at {home}",
            "category": "nba",
            "series_ticker": "NBA",
            "status": "open",
            "yes_bid": bid,
            "yes_ask": ask,
            "volume": vol,
            "open_interest": oi,
        })
    return markets
