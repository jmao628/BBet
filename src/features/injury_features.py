"""
Injury feature engineering.
Converts raw injury reports into quantified impact scores.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from src.config import cfg

INJURY_STATUS_WEIGHTS: dict[str, float] = cfg.get("injury_status_weights", {
    "Out": 1.0,
    "Doubtful": 0.75,
    "Questionable": 0.50,
    "Probable": 0.15,
    "Game Time Decision": 0.40,
    "Active": 0.0,
})

# BPM threshold to classify a player as a "star"
STAR_BPM_THRESHOLD = 3.0


@dataclass
class InjuryReport:
    player_id: int
    player_name: str
    team_abbr: str
    status: str          # Out / Doubtful / Questionable / Probable / GTD
    player_bpm: float    # Box Plus/Minus (player quality proxy)
    player_usg_pct: float = 0.20


def compute_injury_impact(
    injuries: list[InjuryReport],
    team_avg_bpm: float = 0.0,
) -> dict[str, Any]:
    """
    Quantify the expected negative impact of injuries on team performance.

    Impact model:
        For each injured player:
            base_impact = max(0, player_bpm - team_avg_bpm)
            status_weight = INJURY_STATUS_WEIGHTS[status]
            player_impact = base_impact * status_weight
        team_impact = sum(player_impacts) / normalizer

    Returns dict with:
        injury_impact: float [0, 1]
        has_gtd_star: bool
        n_out: int
        n_questionable: int
        impact_details: list of per-player breakdowns
    """
    if not injuries:
        return {
            "injury_impact": 0.0,
            "has_gtd_star": False,
            "n_out": 0,
            "n_questionable": 0,
            "impact_details": [],
        }

    total_impact = 0.0
    has_gtd_star = False
    n_out = 0
    n_questionable = 0
    details = []

    for inj in injuries:
        status_weight = INJURY_STATUS_WEIGHTS.get(inj.status, 0.3)
        # Only count players above team average BPM as impactful
        bpm_above_avg = max(0.0, inj.player_bpm - team_avg_bpm)
        player_impact = bpm_above_avg * status_weight

        # Star player GTD flag (used for risk management)
        if inj.player_bpm >= STAR_BPM_THRESHOLD and inj.status in (
            "Game Time Decision", "Questionable"
        ):
            has_gtd_star = True

        if inj.status == "Out":
            n_out += 1
        elif inj.status in ("Questionable", "Game Time Decision"):
            n_questionable += 1

        total_impact += player_impact
        details.append({
            "player": inj.player_name,
            "status": inj.status,
            "bpm": inj.player_bpm,
            "status_weight": status_weight,
            "computed_impact": player_impact,
        })

    # Normalize: assume max single-player impact ≈ 5 BPM stars
    # Typical: best player is ~5-8 BPM above team avg
    normalizer = 5.0 * 1.0  # 5 BPM × fully out weight=1.0
    injury_impact = min(1.0, total_impact / normalizer)

    return {
        "injury_impact": injury_impact,
        "has_gtd_star": has_gtd_star,
        "n_out": n_out,
        "n_questionable": n_questionable,
        "impact_details": details,
    }


def compute_injury_uncertainty(
    injuries: list[InjuryReport],
) -> float:
    """
    Uncertainty score [0, 1] — how unknown the situation is.
    High uncertainty = more GTD / Questionable stars → hold signal.
    """
    if not injuries:
        return 0.0

    uncertainty = 0.0
    for inj in injuries:
        if inj.status in ("Game Time Decision", "Questionable"):
            star_factor = min(1.0, max(0.0, inj.player_bpm) / 8.0)
            uncertainty += star_factor * 0.5
        elif inj.status == "Doubtful":
            star_factor = min(1.0, max(0.0, inj.player_bpm) / 8.0)
            uncertainty += star_factor * 0.25

    return min(1.0, uncertainty)
