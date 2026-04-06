"""
Game Resolver — matches prediction market contracts and sportsbook odds
to canonical game_ids in the games table.

Uses fuzzy team name matching + date proximity.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Any

from rapidfuzz import fuzz, process

# Standard NBA team name aliases (covers common variations)
NBA_TEAM_ALIASES: dict[str, str] = {
    # Full name → abbreviation
    "Atlanta Hawks": "ATL",
    "Boston Celtics": "BOS",
    "Brooklyn Nets": "BKN",
    "Charlotte Hornets": "CHA",
    "Chicago Bulls": "CHI",
    "Cleveland Cavaliers": "CLE",
    "Dallas Mavericks": "DAL",
    "Denver Nuggets": "DEN",
    "Detroit Pistons": "DET",
    "Golden State Warriors": "GSW",
    "Houston Rockets": "HOU",
    "Indiana Pacers": "IND",
    "LA Clippers": "LAC",
    "Los Angeles Clippers": "LAC",
    "LA Lakers": "LAL",
    "Los Angeles Lakers": "LAL",
    "Memphis Grizzlies": "MEM",
    "Miami Heat": "MIA",
    "Milwaukee Bucks": "MIL",
    "Minnesota Timberwolves": "MIN",
    "New Orleans Pelicans": "NOP",
    "New York Knicks": "NYK",
    "Oklahoma City Thunder": "OKC",
    "Orlando Magic": "ORL",
    "Philadelphia 76ers": "PHI",
    "Philadelphia Sixers": "PHI",
    "Phoenix Suns": "PHX",
    "Portland Trail Blazers": "POR",
    "Sacramento Kings": "SAC",
    "San Antonio Spurs": "SAS",
    "Toronto Raptors": "TOR",
    "Utah Jazz": "UTA",
    "Washington Wizards": "WAS",
    # Nicknames
    "Hawks": "ATL",
    "Celtics": "BOS",
    "Nets": "BKN",
    "Hornets": "CHA",
    "Bulls": "CHI",
    "Cavaliers": "CLE",
    "Cavs": "CLE",
    "Mavericks": "DAL",
    "Mavs": "DAL",
    "Nuggets": "DEN",
    "Pistons": "DET",
    "Warriors": "GSW",
    "Rockets": "HOU",
    "Pacers": "IND",
    "Clippers": "LAC",
    "Lakers": "LAL",
    "Grizzlies": "MEM",
    "Grizz": "MEM",
    "Heat": "MIA",
    "Bucks": "MIL",
    "Timberwolves": "MIN",
    "Wolves": "MIN",
    "Pelicans": "NOP",
    "Knicks": "NYK",
    "Thunder": "OKC",
    "Magic": "ORL",
    "76ers": "PHI",
    "Sixers": "PHI",
    "Suns": "PHX",
    "Trail Blazers": "POR",
    "Blazers": "POR",
    "Kings": "SAC",
    "Spurs": "SAS",
    "Raptors": "TOR",
    "Jazz": "UTA",
    "Wizards": "WAS",
}

ALL_TEAM_NAMES = list(NBA_TEAM_ALIASES.keys())


def fuzzy_team_to_abbr(name: str, threshold: int = 70) -> str | None:
    """
    Fuzzy-match a team name string to its 3-letter abbreviation.
    Returns None if no confident match found.
    """
    # Direct lookup first
    direct = NBA_TEAM_ALIASES.get(name)
    if direct:
        return direct

    # Fuzzy match
    match, score, _ = process.extractOne(
        name, ALL_TEAM_NAMES, scorer=fuzz.token_sort_ratio
    )
    if score >= threshold:
        return NBA_TEAM_ALIASES.get(match)
    return None


def build_game_id(
    league: str,
    game_date: date | str,
    away_abbr: str,
    home_abbr: str,
) -> str:
    if isinstance(game_date, str):
        game_date = datetime.fromisoformat(game_date[:10]).date()
    return f"{league}_{game_date.strftime('%Y%m%d')}_{away_abbr}_{home_abbr}"


def parse_game_from_kalshi_title(title: str) -> dict[str, Any]:
    """
    Extract team names and intent from Kalshi market title.
    Examples:
      "Will the Lakers beat the Celtics on Apr 10?"
      "Lakers vs Celtics - Apr 10 Game Winner"
      "NBA: Will Boston Celtics win vs Los Angeles Lakers (4/10)?"
    """
    result: dict[str, Any] = {
        "team_a": None,
        "team_b": None,
        "team_a_abbr": None,
        "team_b_abbr": None,
        "game_date": None,
        "confidence": 0.0,
    }

    title_clean = title.strip()

    # Pattern: "Lakers vs Celtics"
    vs_pattern = re.search(
        r"([A-Za-z ]+?)\s+(?:vs\.?|versus|beat|win(?:s)?(?: against)?)\s+([A-Za-z ]+)",
        title_clean,
        re.IGNORECASE,
    )
    if vs_pattern:
        raw_a = vs_pattern.group(1).strip()
        raw_b = vs_pattern.group(2).strip()
        result["team_a"] = raw_a
        result["team_b"] = raw_b
        result["team_a_abbr"] = fuzzy_team_to_abbr(raw_a)
        result["team_b_abbr"] = fuzzy_team_to_abbr(raw_b)
        result["confidence"] = 0.8

    # Date parsing
    date_patterns = [
        r"(\w+ \d{1,2},?\s*\d{4})",       # Apr 10, 2026
        r"(\d{1,2}/\d{1,2}/?\d{0,4})",     # 4/10 or 4/10/2026
        r"on (\w+ \d{1,2})",               # on Apr 10
    ]
    for pattern in date_patterns:
        m = re.search(pattern, title_clean, re.IGNORECASE)
        if m:
            result["game_date"] = m.group(1)
            break

    return result


def resolve_game_id_from_contract(
    contract: dict[str, Any],
    games_lookup: dict[str, Any],  # date → list of game dicts
) -> str | None:
    """
    Match a prediction market contract to a canonical game_id.

    Parameters
    ----------
    contract : dict with 'question', 'close_time', 'platform'
    games_lookup : {date_str: [{game_id, home_team, away_team, game_date}]}
    """
    parsed = parse_game_from_kalshi_title(contract.get("question", ""))

    if not parsed["team_a_abbr"] or not parsed["team_b_abbr"]:
        return None

    # Candidate dates: close_time ± 2 days
    close_time = contract.get("close_time")
    if close_time:
        if isinstance(close_time, str):
            close_dt = datetime.fromisoformat(close_time[:10])
        else:
            close_dt = close_time
        candidate_dates = [
            (close_dt - timedelta(days=i)).strftime("%Y%m%d")
            for i in range(-1, 3)
        ]
    else:
        candidate_dates = list(games_lookup.keys())

    team_a = parsed["team_a_abbr"]
    team_b = parsed["team_b_abbr"]

    for date_str in candidate_dates:
        games_on_date = games_lookup.get(date_str, [])
        for game in games_on_date:
            home = game["home_team"]
            away = game["away_team"]
            # Match regardless of home/away order
            if (home in (team_a, team_b) and away in (team_a, team_b)):
                return game["game_id"]

    return None
