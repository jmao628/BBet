"""
Extended NBA data: injuries (inferred), rest days, H2H, player impact.
Supplements nba_data.py with deeper analysis.
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, date
from typing import Any

_ext_cache: dict[str, Any] = {}
_ext_cache_ts: dict[str, float] = {}
EXT_TTL = 600  # 10 min cache

def _ext_cached(key: str):
    if key in _ext_cache and (time.time() - _ext_cache_ts.get(key, 0)) < EXT_TTL:
        return _ext_cache[key]
    return None

def _ext_store(key: str, data: Any):
    _ext_cache[key] = data
    _ext_cache_ts[key] = time.time()
    return data


def get_team_schedule_info(team_id: int) -> dict:
    """Get rest days and B2B status from recent game schedule."""
    key = f"schedule_{team_id}"
    cached = _ext_cached(key)
    if cached:
        return cached

    from nba_api.stats.endpoints import leaguegamefinder
    time.sleep(0.7)

    try:
        gf = leaguegamefinder.LeagueGameFinder(
            season_nullable="2025-26",
            team_id_nullable=str(team_id),
            season_type_nullable="Regular Season",
        )
        df = gf.get_data_frames()[0]
        if df.empty:
            return _ext_store(key, {"rest_days": 2, "is_b2b": False, "last_game_date": None})

        # Games sorted by date desc
        df["GAME_DATE"] = df["GAME_DATE"].apply(lambda x: datetime.strptime(x, "%Y-%m-%d").date())
        df = df.sort_values("GAME_DATE", ascending=False)

        last_game = df.iloc[0]["GAME_DATE"]
        today = date.today()
        rest_days = (today - last_game).days

        # Check B2B: did they play yesterday?
        is_b2b = rest_days <= 1

        # Previous game before last
        prev_game = df.iloc[1]["GAME_DATE"] if len(df) > 1 else None

        return _ext_store(key, {
            "rest_days": rest_days,
            "is_b2b": is_b2b,
            "last_game_date": str(last_game),
            "last_game_result": df.iloc[0].get("WL", ""),
            "last_game_matchup": df.iloc[0].get("MATCHUP", ""),
        })
    except Exception:
        return _ext_store(key, {"rest_days": 2, "is_b2b": False})


def get_h2h_record(team_id: int, vs_team_id: int) -> dict:
    """Head-to-head record this season."""
    key = f"h2h_{team_id}_{vs_team_id}"
    cached = _ext_cached(key)
    if cached:
        return cached

    from nba_api.stats.endpoints import leaguegamefinder
    time.sleep(0.7)

    try:
        gf = leaguegamefinder.LeagueGameFinder(
            season_nullable="2025-26",
            team_id_nullable=str(team_id),
            vs_team_id_nullable=str(vs_team_id),
        )
        df = gf.get_data_frames()[0]

        wins = len(df[df["WL"] == "W"])
        losses = len(df[df["WL"] == "L"])
        games = []
        for _, row in df.iterrows():
            games.append({
                "date": row["GAME_DATE"],
                "result": row["WL"],
                "pts": int(row["PTS"]),
                "matchup": row["MATCHUP"],
            })

        return _ext_store(key, {
            "wins": wins,
            "losses": losses,
            "total": wins + losses,
            "games": games[:5],
        })
    except Exception:
        return _ext_store(key, {"wins": 0, "losses": 0, "total": 0, "games": []})


def get_team_key_players(team_id: int) -> list[dict]:
    """Get top players by minutes/impact for a team. Infer injuries from recent absence."""
    key = f"players_{team_id}"
    cached = _ext_cached(key)
    if cached:
        return cached

    from nba_api.stats.endpoints import teamplayerdashboard
    time.sleep(0.7)

    try:
        tp = teamplayerdashboard.TeamPlayerDashboard(
            team_id=str(team_id),
            season="2025-26",
        )
        df = tp.get_data_frames()[1]  # individual players

        players = []
        for _, row in df.iterrows():
            gp = int(row.get("GP", 0))
            min_total = float(row.get("MIN", 0))
            ppg = float(row.get("PTS", 0)) / max(gp, 1)
            rpg = float(row.get("REB", 0)) / max(gp, 1)
            apg = float(row.get("AST", 0)) / max(gp, 1)
            plus_minus = float(row.get("PLUS_MINUS", 0))
            pm_per_game = plus_minus / max(gp, 1)
            mpg = min_total / max(gp, 1)

            players.append({
                "name": row["PLAYER_NAME"],
                "player_id": int(row["PLAYER_ID"]),
                "gp": gp,
                "mpg": round(mpg, 1),
                "ppg": round(ppg, 1),
                "rpg": round(rpg, 1),
                "apg": round(apg, 1),
                "plus_minus_total": round(plus_minus, 1),
                "pm_per_game": round(pm_per_game, 1),
                "impact_score": round(ppg * 0.4 + rpg * 0.2 + apg * 0.3 + pm_per_game * 0.1, 2),
            })

        # Sort by impact
        players.sort(key=lambda p: p["impact_score"], reverse=True)

        # Infer injuries: players with low GP relative to team games
        team_max_gp = max((p["gp"] for p in players), default=82)
        for p in players:
            p["games_missed"] = team_max_gp - p["gp"]
            p["availability_pct"] = round(p["gp"] / max(team_max_gp, 1) * 100, 1)
            # Flag as potentially injured if missing >20% of games and is a key player
            p["possibly_injured"] = p["games_missed"] > team_max_gp * 0.2 and p["impact_score"] > 5

        return _ext_store(key, players[:15])
    except Exception:
        return _ext_store(key, [])


def get_live_scores() -> list[dict]:
    """Get real-time scores for ongoing NBA games."""
    key = "live_scores"
    cached = _ext_cached(key)
    if cached and (time.time() - _ext_cache_ts.get(key, 0)) < 15:  # 15s cache for live
        return cached

    try:
        from nba_api.live.nba.endpoints import scoreboard
        sb = scoreboard.ScoreBoard()
        data = sb.get_dict()
        games = data.get("scoreboard", {}).get("games", [])

        result = []
        for g in games:
            home = g.get("homeTeam", {})
            away = g.get("awayTeam", {})
            result.append({
                "game_id": g.get("gameId", ""),
                "status": g.get("gameStatusText", ""),
                "status_code": g.get("gameStatus", 1),  # 1=pregame, 2=live, 3=final
                "period": g.get("period", 0),
                "clock": g.get("gameClock", ""),
                "home_team": home.get("teamTricode", ""),
                "home_name": f"{home.get('teamCity', '')} {home.get('teamName', '')}",
                "home_score": home.get("score", 0),
                "away_team": away.get("teamTricode", ""),
                "away_name": f"{away.get('teamCity', '')} {away.get('teamName', '')}",
                "away_score": away.get("score", 0),
                "home_leaders": _extract_leaders(home),
                "away_leaders": _extract_leaders(away),
            })

        return _ext_store(key, result)
    except Exception:
        return _ext_store(key, [])


def _extract_leaders(team: dict) -> dict:
    """Extract team leaders from live data."""
    leaders = {}
    for cat in team.get("statistics", {}).get("leaders", []):
        cat_name = cat.get("name", "")
        players = cat.get("players", [])
        if players:
            p = players[0]
            leaders[cat_name] = {
                "name": p.get("name", ""),
                "value": p.get("value", ""),
            }
    return leaders
