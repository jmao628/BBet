"""
NBA stats data client — wraps nba_api library.
All operations are sync (nba_api does not support async).
Run in a thread pool executor for async contexts.
"""

from __future__ import annotations

import time
from datetime import date, timedelta
from typing import Any

import pandas as pd
import structlog
from nba_api.stats.endpoints import (
    LeagueDashTeamStats,
    TeamGameLog,
    LeagueGameFinder,
    CommonTeamRoster,
    PlayerDashboardByYearOverYear,
)
from nba_api.stats.static import teams as nba_teams_static

log = structlog.get_logger(__name__)

# NBA API requires a short delay between requests to avoid throttling
NBA_API_DELAY = 0.6  # seconds


TEAM_ABBR_MAP: dict[str, str] = {
    t["abbreviation"]: t["full_name"]
    for t in nba_teams_static.get_teams()
}

TEAM_ID_MAP: dict[str, int] = {
    t["abbreviation"]: t["id"]
    for t in nba_teams_static.get_teams()
}


class NBAStatsClient:
    """
    Wraps nba_api to fetch team efficiency, game logs, and roster data.
    All methods return pandas DataFrames.
    """

    def __init__(self, season: str = "2025-26") -> None:
        self.season = season

    def _sleep(self) -> None:
        time.sleep(NBA_API_DELAY)

    # ------------------------------------------------------------------
    # Team efficiency stats
    # ------------------------------------------------------------------

    def get_team_efficiency(
        self,
        season: str | None = None,
        measure_type: str = "Advanced",  # Advanced | Base | Four Factors
        per_mode: str = "PerGame",
    ) -> pd.DataFrame:
        """
        Returns offensive rating, defensive rating, net rating, pace, etc.
        for all teams in a season.
        """
        season = season or self.season
        self._sleep()
        endpoint = LeagueDashTeamStats(
            season=season,
            measure_type_detailed_defense=measure_type,
            per_mode_simple=per_mode,
        )
        df = endpoint.get_data_frames()[0]
        df.columns = [c.lower() for c in df.columns]

        cols_needed = {
            "team_id", "team_name",
            "off_rating", "def_rating", "net_rating", "pace",
            "e_pace", "poss", "ast_ratio", "oreb_pct", "dreb_pct",
            "reb_pct", "e_tov_pct", "efg_pct", "ts_pct",
        }
        available = set(df.columns)
        use_cols = list(cols_needed & available)
        return df[use_cols]

    def get_team_efficiency_home_road(
        self,
        season: str | None = None,
    ) -> pd.DataFrame:
        """Get efficiency split by home/road."""
        season = season or self.season
        dfs = []
        for location in ("Home", "Road"):
            self._sleep()
            ep = LeagueDashTeamStats(
                season=season,
                measure_type_detailed_defense="Advanced",
                per_mode_simple="PerGame",
                location_nullable=location,
            )
            df = ep.get_data_frames()[0]
            df.columns = [c.lower() for c in df.columns]
            df["location"] = location.lower()
            dfs.append(df)
        return pd.concat(dfs, ignore_index=True)

    # ------------------------------------------------------------------
    # Rolling game logs
    # ------------------------------------------------------------------

    def get_team_game_log(
        self,
        team_abbr: str,
        season: str | None = None,
        season_type: str = "Regular Season",
    ) -> pd.DataFrame:
        """Returns game-level log for a team (most recent games first)."""
        season = season or self.season
        team_id = TEAM_ID_MAP.get(team_abbr)
        if not team_id:
            raise ValueError(f"Unknown team abbreviation: {team_abbr}")

        self._sleep()
        endpoint = TeamGameLog(
            team_id=team_id,
            season=season,
            season_type_all_star=season_type,
        )
        df = endpoint.get_data_frames()[0]
        df.columns = [c.lower() for c in df.columns]

        # Parse date
        df["game_date"] = pd.to_datetime(df["game_date"], format="%b %d, %Y")

        # Compute net rating proxy from game log (limited data)
        # Full efficiency requires BoxScore endpoint; use +/- as proxy
        df = df.sort_values("game_date", ascending=False).reset_index(drop=True)
        return df

    def compute_rolling_stats(
        self,
        game_log: pd.DataFrame,
        windows: list[int] | None = None,
    ) -> dict[str, float]:
        """
        Compute rolling net rating proxies from game log.
        Uses W/L margin as proxy when full efficiency not available.
        """
        windows = windows or [3, 5, 10]
        result: dict[str, float] = {}

        if "plus_minus" not in game_log.columns:
            return result

        for w in windows:
            recent = game_log.head(w)
            result[f"last{w}_margin"] = recent["plus_minus"].mean()
            result[f"last{w}_win_pct"] = (recent["wl"] == "W").mean()

        return result

    # ------------------------------------------------------------------
    # Schedule / rest days
    # ------------------------------------------------------------------

    def get_upcoming_games(
        self,
        n_days: int = 7,
        season: str | None = None,
    ) -> pd.DataFrame:
        """Return upcoming NBA games in the next N days."""
        season = season or self.season
        today = date.today()
        end_date = today + timedelta(days=n_days)

        self._sleep()
        endpoint = LeagueGameFinder(
            league_id_nullable="00",  # NBA
            season_nullable=season,
            date_from_nullable=today.strftime("%m/%d/%Y"),
            date_to_nullable=end_date.strftime("%m/%d/%Y"),
        )
        df = endpoint.get_data_frames()[0]
        df.columns = [c.lower() for c in df.columns]
        df["game_date"] = pd.to_datetime(df["game_date"])
        return df

    def compute_rest_days(
        self, team_abbr: str, game_date: date, game_log: pd.DataFrame
    ) -> int:
        """Days since last game for a team before game_date."""
        past_games = game_log[game_log["game_date"].dt.date < game_date]
        if past_games.empty:
            return 7  # assume well-rested if no prior game found
        last_game = past_games["game_date"].max().date()
        return (game_date - last_game).days

    def is_back_to_back(
        self, team_abbr: str, game_date: date, game_log: pd.DataFrame
    ) -> bool:
        return self.compute_rest_days(team_abbr, game_date, game_log) == 1

    # ------------------------------------------------------------------
    # Roster and player stats (for injury impact computation)
    # ------------------------------------------------------------------

    def get_player_advanced_stats(
        self, season: str | None = None
    ) -> pd.DataFrame:
        """
        BPM-like stats from NBA API (limited — uses Box Plus/Minus proxy).
        Returns player_id, team_id, bpm, usg_pct, vorp, etc.
        """
        season = season or self.season
        # NBA API doesn't directly expose BPM; use estimated from Box Score data
        # For MVP we use PIE (Player Impact Estimate) as a proxy
        from nba_api.stats.endpoints import LeagueDashPlayerStats
        self._sleep()
        endpoint = LeagueDashPlayerStats(
            season=season,
            measure_type_detailed_defense="Advanced",
            per_mode_simple="PerGame",
        )
        df = endpoint.get_data_frames()[0]
        df.columns = [c.lower() for c in df.columns]

        cols = {"player_id", "player_name", "team_id", "team_abbreviation",
                "pie", "usg_pct", "min"}
        use = list(cols & set(df.columns))
        return df[use]

    # ------------------------------------------------------------------
    # Full feature snapshot for a team before a specific game
    # ------------------------------------------------------------------

    def build_team_feature_snapshot(
        self,
        team_abbr: str,
        game_date: date,
        season: str | None = None,
    ) -> dict[str, Any]:
        """
        Build a complete feature dict for a team as of a specific game_date.
        Used by the feature engine to populate team_features table.
        """
        season = season or self.season

        efficiency = self.get_team_efficiency(season)
        team_row = efficiency[
            efficiency["team_id"] == TEAM_ID_MAP.get(team_abbr)
        ]

        game_log = self.get_team_game_log(team_abbr, season)
        rolling = self.compute_rolling_stats(game_log)
        rest_days = self.compute_rest_days(team_abbr, game_date, game_log)
        b2b = self.is_back_to_back(team_abbr, game_date, game_log)

        # Streak calculation
        streak = 0
        for _, row in game_log.iterrows():
            if row["game_date"].date() >= game_date:
                continue
            if row["wl"] == "W":
                if streak >= 0:
                    streak += 1
                else:
                    break
            else:
                if streak <= 0:
                    streak -= 1
                else:
                    break

        base: dict[str, Any] = {
            "team_abbr": team_abbr,
            "as_of_date": game_date.isoformat(),
            "season": season,
            "rest_days": rest_days,
            "is_back_to_back": b2b,
            "win_streak": streak,
        }

        if not team_row.empty:
            row = team_row.iloc[0]
            base.update(
                {
                    "off_rating": row.get("off_rating"),
                    "def_rating": row.get("def_rating"),
                    "net_rating": row.get("net_rating"),
                    "pace": row.get("pace"),
                    "efg_pct": row.get("efg_pct"),
                    "ts_pct": row.get("ts_pct"),
                    "tov_pct": row.get("e_tov_pct"),
                    "orb_pct": row.get("oreb_pct"),
                    "drb_pct": row.get("dreb_pct"),
                }
            )

        base.update(rolling)
        return base
