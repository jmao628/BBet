"""
Team-level feature engineering.
Combines raw stats into model-ready features for a single game.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np


HOME_ADVANTAGE_NET_RATING = 2.5  # empirical NBA home court advantage


@dataclass
class TeamSnapshot:
    """All features for one team before a specific game."""

    team_abbr: str
    # Efficiency
    off_rating: float = 0.0
    def_rating: float = 0.0
    net_rating: float = 0.0
    pace: float = 100.0
    efg_pct: float = 0.50
    ts_pct: float = 0.54
    tov_pct: float = 14.0
    orb_pct: float = 25.0
    drb_pct: float = 75.0
    three_par: float = 0.38
    ftr: float = 0.22
    # Rolling
    last3_net_rating: float = 0.0
    last5_net_rating: float = 0.0
    last10_net_rating: float = 0.0
    last3_off_rating: float = 0.0
    last3_def_rating: float = 0.0
    # Home/road splits
    home_net_rating: float = 0.0
    road_net_rating: float = 0.0
    # Strength splits
    vs_top10_net: float = 0.0
    vs_bot10_net: float = 0.0
    # Ratings
    elo_rating: float = 1500.0
    power_rank: float = 15.0
    # Form
    win_streak: int = 0
    rest_days: int = 3
    is_back_to_back: bool = False
    travel_km: float = 0.0
    # Injury impact
    injury_impact: float = 0.0
    has_gtd_star: bool = False


@dataclass
class MatchupFeatures:
    """
    Computed features for a specific game matchup.
    Home team perspective: positive = home advantage.
    """

    game_id: str
    home: TeamSnapshot
    away: TeamSnapshot
    is_playoff: bool = False
    is_elimination: bool = False
    season_pct_played: float = 0.5

    # Will be computed
    features: dict[str, float] = field(default_factory=dict)

    def compute(self) -> "MatchupFeatures":
        h = self.home
        a = self.away

        # ----------------------------------------------------------------
        # Core efficiency differentials (home - away)
        # ----------------------------------------------------------------
        net_rating_diff = h.net_rating - a.net_rating
        off_rating_diff = h.off_rating - a.off_rating
        def_rating_diff = h.def_rating - a.def_rating  # lower is better for home

        # Location-adjusted: home plays at home, away plays away
        location_adj_net = h.home_net_rating - a.road_net_rating

        # ----------------------------------------------------------------
        # Expected margin proxy
        # ----------------------------------------------------------------
        expected_margin = (
            net_rating_diff / 2.0  # rough: ~2 net rating pts ≈ 1 point per game
            + HOME_ADVANTAGE_NET_RATING
        )

        # ----------------------------------------------------------------
        # Rolling form
        # ----------------------------------------------------------------
        last5_diff = h.last5_net_rating - a.last5_net_rating
        last3_diff = h.last3_net_rating - a.last3_net_rating

        # ----------------------------------------------------------------
        # Rest / travel
        # ----------------------------------------------------------------
        rest_diff = h.rest_days - a.rest_days
        b2b_advantage = (
            (1 if a.is_back_to_back else 0) -
            (1 if h.is_back_to_back else 0)
        )  # positive = home has rest advantage

        travel_diff = a.travel_km - h.travel_km  # positive = away traveled more

        # ----------------------------------------------------------------
        # Injury
        # ----------------------------------------------------------------
        injury_diff = a.injury_impact - h.injury_impact  # positive = away more injured

        # ----------------------------------------------------------------
        # Matchup-level features
        # ----------------------------------------------------------------
        pace_diff = h.pace - a.pace
        efg_diff = h.efg_pct - a.efg_pct
        tov_diff = a.tov_pct - h.tov_pct  # positive = away turns over more

        # Home offense vs away defense
        home_off_vs_away_def = h.off_rating - a.def_rating
        away_off_vs_home_def = a.off_rating - h.def_rating

        # ----------------------------------------------------------------
        # Elo
        # ----------------------------------------------------------------
        elo_diff = h.elo_rating - a.elo_rating
        elo_win_prob = 1.0 / (1 + 10 ** (-elo_diff / 400))

        # ----------------------------------------------------------------
        # Form momentum
        # ----------------------------------------------------------------
        home_momentum = np.tanh(h.win_streak / 5.0)   # normalize
        away_momentum = np.tanh(a.win_streak / 5.0)
        momentum_diff = home_momentum - away_momentum

        self.features = {
            # Core
            "net_rating_diff": net_rating_diff,
            "off_rating_diff": off_rating_diff,
            "def_rating_diff": def_rating_diff,
            "location_adj_net": location_adj_net,
            "expected_margin": expected_margin,
            # Rolling
            "last5_diff": last5_diff,
            "last3_diff": last3_diff,
            "home_last5_net": h.last5_net_rating,
            "away_last5_net": a.last5_net_rating,
            # Rest
            "rest_diff": rest_diff,
            "b2b_advantage": float(b2b_advantage),
            "home_rest_days": float(h.rest_days),
            "away_rest_days": float(a.rest_days),
            "travel_diff": travel_diff,
            # Injury
            "injury_diff": injury_diff,
            "home_injury_impact": h.injury_impact,
            "away_injury_impact": a.injury_impact,
            "home_has_gtd_star": float(h.has_gtd_star),
            "away_has_gtd_star": float(a.has_gtd_star),
            # Matchup
            "pace_diff": pace_diff,
            "efg_diff": efg_diff,
            "tov_diff": tov_diff,
            "home_off_vs_away_def": home_off_vs_away_def,
            "away_off_vs_home_def": away_off_vs_home_def,
            # Elo
            "elo_diff": elo_diff,
            "elo_win_prob": elo_win_prob,
            # Form
            "home_momentum": home_momentum,
            "away_momentum": away_momentum,
            "momentum_diff": momentum_diff,
            # Context
            "is_playoff": float(self.is_playoff),
            "is_elimination": float(self.is_elimination),
            "season_pct_played": self.season_pct_played,
            # Raw team stats (for tree models)
            "home_off_rating": h.off_rating,
            "home_def_rating": h.def_rating,
            "home_net_rating": h.net_rating,
            "away_off_rating": a.off_rating,
            "away_def_rating": a.def_rating,
            "away_net_rating": a.net_rating,
            "home_pace": h.pace,
            "away_pace": a.pace,
            "home_efg": h.efg_pct,
            "away_efg": a.efg_pct,
            "home_tov_pct": h.tov_pct,
            "away_tov_pct": a.tov_pct,
            "home_home_net": h.home_net_rating,
            "away_road_net": a.road_net_rating,
        }
        return self

    def to_model_input(self) -> dict[str, float]:
        """Return feature dict for model inference."""
        if not self.features:
            self.compute()
        return self.features
