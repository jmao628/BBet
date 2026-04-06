"""
Odds Transformer — converts raw bookmaker odds to unified probability space.

All outputs are in [0, 1] representing P(home team wins) unless otherwise noted.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

from src.config import cfg


@dataclass
class OddsLine:
    sportsbook: str
    home_ml: int       # American odds, e.g. -150
    away_ml: int       # American odds, e.g. +130


@dataclass
class ProbabilityLine:
    sportsbook: str
    home_raw_prob: float
    away_raw_prob: float
    overround: float
    home_novig_prob: float   # Shin method
    away_novig_prob: float
    home_novig_simple: float  # simple normalization
    away_novig_simple: float
    vig_pct: float


# ---------------------------------------------------------------------------
# Core conversion functions
# ---------------------------------------------------------------------------


def american_to_implied(odds: int) -> float:
    """Raw implied probability from American odds (includes bookmaker margin)."""
    if odds > 0:
        return 100.0 / (odds + 100.0)
    else:
        return abs(odds) / (abs(odds) + 100.0)


def decimal_to_implied(odds: float) -> float:
    return 1.0 / odds


def implied_to_american(prob: float) -> int:
    """No-vig probability back to American odds (for display)."""
    if prob >= 0.5:
        return round(-prob / (1 - prob) * 100)
    else:
        return round((1 - prob) / prob * 100)


def remove_vig_simple(p_home: float, p_away: float) -> tuple[float, float]:
    """
    Simple normalization: divide each implied prob by overround.
    Assumes bookmaker distributes vig equally across outcomes.
    """
    overround = p_home + p_away
    return p_home / overround, p_away / overround


def remove_vig_shin(p_home: float, p_away: float) -> tuple[float, float]:
    """
    Shin method for removing bookmaker margin.
    More accurate when vig is unevenly distributed (favorites taxed differently).

    Reference: Shin, H.S. (1992) "Prices of State Contingent Claims with Insider
    Traders, and the Favourite-Longshot Bias."
    """
    overround = p_home + p_away

    # Shin's z parameter (approximation — closed-form solution)
    # Iterative solution converges in <5 steps
    z = 0.0
    for _ in range(20):
        z_new = (overround - 1) / (
            (2 * overround - 1)
            - 2 * math.sqrt(
                overround * (overround - 1) * (1 - 1 / (1 + z if z > 0 else 1))
            )
            if z > 0
            else (2 * overround - 1)
        )
        if abs(z_new - z) < 1e-8:
            break
        z = z_new

    # Shin probabilities
    p_home_shin = (p_home - z / overround) / (1 - z)
    p_away_shin = (p_away - z / overround) / (1 - z)

    # Clamp to [0, 1] for numerical safety
    p_home_shin = max(0.0, min(1.0, p_home_shin))
    p_away_shin = max(0.0, min(1.0, p_away_shin))

    return p_home_shin, p_away_shin


def process_odds_line(line: OddsLine) -> ProbabilityLine:
    """Full pipeline: American odds → cleaned no-vig probability."""
    p_home_raw = american_to_implied(line.home_ml)
    p_away_raw = american_to_implied(line.away_ml)
    overround = p_home_raw + p_away_raw
    vig_pct = (overround - 1.0) / overround * 100

    p_home_simple, p_away_simple = remove_vig_simple(p_home_raw, p_away_raw)
    p_home_shin, p_away_shin = remove_vig_shin(p_home_raw, p_away_raw)

    return ProbabilityLine(
        sportsbook=line.sportsbook,
        home_raw_prob=p_home_raw,
        away_raw_prob=p_away_raw,
        overround=overround,
        home_novig_prob=p_home_shin,
        away_novig_prob=p_away_shin,
        home_novig_simple=p_home_simple,
        away_novig_simple=p_away_simple,
        vig_pct=vig_pct,
    )


# ---------------------------------------------------------------------------
# Consensus probability across multiple sportsbooks
# ---------------------------------------------------------------------------


def compute_consensus_novig_prob(
    prob_lines: list[ProbabilityLine],
    use_shin: bool = True,
) -> tuple[float, float]:
    """
    Weighted average of no-vig probabilities across sportsbooks.
    Pinnacle weighted 3x (most efficient market).
    Returns (home_consensus_prob, away_consensus_prob).
    """
    weights: dict[str, float] = cfg.get("sportsbook_weights", {})
    default_weight = 1.0

    total_weight = 0.0
    weighted_home = 0.0

    for pl in prob_lines:
        w = weights.get(pl.sportsbook, default_weight)
        prob = pl.home_novig_prob if use_shin else pl.home_novig_simple
        weighted_home += w * prob
        total_weight += w

    if total_weight == 0:
        return 0.5, 0.5

    home_consensus = weighted_home / total_weight
    away_consensus = 1.0 - home_consensus
    return home_consensus, away_consensus


# ---------------------------------------------------------------------------
# Prediction market price adjustment
# ---------------------------------------------------------------------------


def market_price_to_executable_prob(
    mid_price: float,
    fee_pct: float = 0.02,
    direction: Literal["yes", "no"] = "yes",
) -> float:
    """
    Convert prediction market mid-price to the effective break-even probability
    for a buyer, accounting for platform fees.

    For a YES buyer at price C:
        - Pay C upfront
        - If wins: receive 1.0, platform takes fee from profit
        - Net profit if win: (1 - C) × (1 - fee)  [if fee on profit]
        - OR: receive (1 - fee) if C=0, i.e. effective payoff = (1-fee)/C per unit
        - Break-even: p × (1-fee)/C × C - (1-p) × C = 0
          → p_breakeven = C / (1 - fee)   [when fee is on gross return]

    Kalshi: fee is charged on net profit, so breakeven is approximately:
        p_breakeven ≈ ask_price / (1 - fee × (1 - ask_price))

    We use the simpler approximation for MVP:
    """
    if direction == "yes":
        return min(1.0, mid_price / (1 - fee_pct))
    else:
        return min(1.0, (1 - mid_price) / (1 - fee_pct))


# ---------------------------------------------------------------------------
# Edge and EV calculation
# ---------------------------------------------------------------------------


def compute_edge(fair_prob: float, executable_prob: float) -> float:
    """Edge = our estimated fair probability - market's executable cost."""
    return fair_prob - executable_prob


def compute_expected_value(edge: float, executable_prob: float) -> float:
    """
    EV per dollar risked on the YES side.
    If we buy YES at price P_exec and true prob is P_fair:
        EV = P_fair × (1/P_exec - 1) - (1 - P_fair) × 1
           = P_fair/P_exec - 1
           ≈ edge / P_exec (for small edge)
    """
    if executable_prob <= 0 or executable_prob >= 1:
        return 0.0
    return fair_prob / executable_prob - 1  # exact formula


def compute_kelly_fraction(fair_prob: float, executable_prob: float) -> float:
    """
    Full Kelly criterion: fraction of bankroll to wager.
    f* = (b×p - q) / b
    where b = (1-P_exec)/P_exec  (net odds per dollar at risk),
          p = fair_prob,
          q = 1 - fair_prob
    """
    if executable_prob <= 0 or executable_prob >= 1:
        return 0.0
    b = (1 - executable_prob) / executable_prob  # net odds
    p = fair_prob
    q = 1 - fair_prob
    kelly = (b * p - q) / b
    return max(0.0, kelly)


# Fix the EV function signature
def compute_expected_value(
    fair_prob: float, executable_prob: float
) -> float:
    if executable_prob <= 0 or executable_prob >= 1:
        return 0.0
    return fair_prob / executable_prob - 1
