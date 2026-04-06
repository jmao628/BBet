"""
Real NBA data provider — fetches live team stats from NBA API.
Caches data to avoid rate limiting (NBA API allows ~60 req/min).
"""

from __future__ import annotations

import time
from typing import Any

_cache: dict[str, Any] = {}
_cache_ts: dict[str, float] = {}
CACHE_TTL = 300  # 5 minutes for NBA stats (don't change often)


def _cached(key: str, ttl: float = CACHE_TTL):
    """Check if cache is fresh."""
    if key in _cache and (time.time() - _cache_ts.get(key, 0)) < ttl:
        return _cache[key]
    return None


def _store(key: str, data: Any):
    _cache[key] = data
    _cache_ts[key] = time.time()
    return data


def get_all_team_stats() -> dict[str, dict]:
    """
    Fetch comprehensive stats for all 30 NBA teams.
    Returns dict keyed by team name (e.g. "Orlando Magic").
    """
    cached = _cached("all_team_stats")
    if cached:
        return cached

    from nba_api.stats.endpoints import leaguestandings, leaguedashteamstats
    from nba_api.stats.static import teams as nba_teams
    import time as _time

    result: dict[str, dict] = {}
    season = "2025-26"

    # 1. Standings (wins, losses, win%, L10, streak)
    _time.sleep(0.7)
    standings = leaguestandings.LeagueStandings(season=season)
    df_standings = standings.get_data_frames()[0]

    for _, row in df_standings.iterrows():
        name = f"{row['TeamCity']} {row['TeamName']}"
        result[name] = {
            "team_name": name,
            "team_id": row["TeamID"],
            "wins": int(row["WINS"]),
            "losses": int(row["LOSSES"]),
            "win_pct": float(row["WinPCT"]),
            "conference": row.get("Conference", ""),
            "playoff_rank": int(row.get("PlayoffRank", 0)),
            "l10": row.get("L10", ""),
            "streak": row.get("CurrentStreak", ""),
        }

    # 2. Advanced stats (off/def/net rating, pace, efg, ts)
    _time.sleep(0.7)
    advanced = leaguedashteamstats.LeagueDashTeamStats(
        season=season,
        measure_type_detailed_defense="Advanced",
        per_mode_detailed="Per100Possessions",
    )
    df_adv = advanced.get_data_frames()[0]

    for _, row in df_adv.iterrows():
        name = row["TEAM_NAME"]
        # Match with full city name from standings
        matched = next((k for k in result if name in k), None)
        if matched:
            result[matched].update({
                "off_rating": round(float(row.get("OFF_RATING", 0)), 1),
                "def_rating": round(float(row.get("DEF_RATING", 0)), 1),
                "net_rating": round(float(row.get("NET_RATING", 0)), 1),
                "pace": round(float(row.get("PACE", 100)), 1),
                "efg_pct": round(float(row.get("EFG_PCT", 0.5)), 3),
                "ts_pct": round(float(row.get("TS_PCT", 0.54)), 3),
            })

    # 3. Last 5 games
    _time.sleep(0.7)
    last5 = leaguedashteamstats.LeagueDashTeamStats(season=season, last_n_games=5)
    df5 = last5.get_data_frames()[0]

    for _, row in df5.iterrows():
        name = row["TEAM_NAME"]
        matched = next((k for k in result if name in k), None)
        if matched:
            result[matched].update({
                "last5_wins": int(row["W"]),
                "last5_losses": int(row["L"]),
                "last5_win_pct": float(row["W_PCT"]),
            })

    # 4. Last 10 games
    _time.sleep(0.7)
    last10 = leaguedashteamstats.LeagueDashTeamStats(season=season, last_n_games=10)
    df10 = last10.get_data_frames()[0]

    for _, row in df10.iterrows():
        name = row["TEAM_NAME"]
        matched = next((k for k in result if name in k), None)
        if matched:
            result[matched].update({
                "last10_wins": int(row["W"]),
                "last10_losses": int(row["L"]),
                "last10_win_pct": float(row["W_PCT"]),
            })

    # 5. Home record
    _time.sleep(0.7)
    home = leaguedashteamstats.LeagueDashTeamStats(season=season, location_nullable="Home")
    dfh = home.get_data_frames()[0]

    for _, row in dfh.iterrows():
        name = row["TEAM_NAME"]
        matched = next((k for k in result if name in k), None)
        if matched:
            result[matched].update({
                "home_wins": int(row["W"]),
                "home_losses": int(row["L"]),
                "home_win_pct": float(row["W_PCT"]),
            })

    # 6. Road record
    _time.sleep(0.7)
    road = leaguedashteamstats.LeagueDashTeamStats(season=season, location_nullable="Road")
    dfr = road.get_data_frames()[0]

    for _, row in dfr.iterrows():
        name = row["TEAM_NAME"]
        matched = next((k for k in result if name in k), None)
        if matched:
            result[matched].update({
                "road_wins": int(row["W"]),
                "road_losses": int(row["L"]),
                "road_win_pct": float(row["W_PCT"]),
            })

    # Compute Elo from win% (simple approximation)
    for name, stats in result.items():
        wp = stats.get("win_pct", 0.5)
        stats["elo"] = round(1500 + (wp - 0.5) * 600)  # scale: 1200-1800

    return _store("all_team_stats", result)


def find_team(query: str, all_stats: dict[str, dict]) -> dict | None:
    """Fuzzy match a team name from Kalshi to NBA API team names."""
    query_lower = query.lower().strip()

    # Handle Kalshi abbreviations
    KALSHI_ALIASES = {
        "los angeles l": "Los Angeles Lakers",
        "los angeles c": "Los Angeles Clippers",
        "la lakers": "Los Angeles Lakers",
        "la clippers": "Los Angeles Clippers",
    }
    alias = KALSHI_ALIASES.get(query_lower)
    if alias and alias in all_stats:
        return all_stats[alias]

    # Direct match
    for name, stats in all_stats.items():
        if query_lower == name.lower():
            return stats

    # Partial match (e.g. "Orlando" matches "Orlando Magic")
    for name, stats in all_stats.items():
        parts = name.lower().split()
        if query_lower in parts or any(query_lower in p for p in parts):
            return stats

    # City match
    for name, stats in all_stats.items():
        city = name.rsplit(" ", 1)[0].lower() if " " in name else name.lower()
        if query_lower == city or query_lower in city:
            return stats

    # Nickname match
    for name, stats in all_stats.items():
        nickname = name.rsplit(" ", 1)[-1].lower() if " " in name else ""
        if query_lower == nickname:
            return stats

    return None


def get_today_games() -> list[dict]:
    """Get today's NBA games from the live scoreboard."""
    cached = _cached("today_games", ttl=60)
    if cached:
        return cached

    try:
        from nba_api.live.nba.endpoints import scoreboard
        sb = scoreboard.ScoreBoard()
        data = sb.get_dict()
        games = data.get("scoreboard", {}).get("games", [])
        return _store("today_games", games)
    except Exception:
        return []
