"""
Ensemble / blending layer.
Combines sportsbook no-vig probability, basketball model, and market price
into a single fair probability estimate with confidence interval.
"""

from __future__ import annotations

import numpy as np

from src.config import cfg


def compute_ensemble_fair_prob(
    sportsbook_novig: float | None,
    model_prob: float | None,
    calibrated_prob: float | None,
    market_mid: float | None,
    liquidity_score: float = 0.5,
    time_to_game_hours: float = 24.0,
) -> tuple[float, float, float]:
    """
    Blend multiple probability estimates into a single fair probability.

    Returns
    -------
    (fair_prob, ci_lower, ci_upper)
        fair_prob: best estimate of true probability [0, 1]
        ci_lower:  95% confidence interval lower bound
        ci_upper:  95% confidence interval upper bound
    """
    weights_cfg = cfg["models"]["ensemble_weights"]
    W_BOOK = weights_cfg["sportsbook"]
    W_MODEL = weights_cfg["basketball_model"]
    W_MARKET = weights_cfg["market"]

    # --- Adjust weights based on available data ---
    components = {}

    if sportsbook_novig is not None and 0 < sportsbook_novig < 1:
        # Time-to-game adjustment: sportsbook more trusted close to tipoff
        if time_to_game_hours < 2:
            book_w = W_BOOK * 1.2
        elif time_to_game_hours > 48:
            book_w = W_BOOK * 0.8
        else:
            book_w = W_BOOK
        components["sportsbook"] = (sportsbook_novig, book_w)

    if calibrated_prob is not None and 0 < calibrated_prob < 1:
        components["model"] = (calibrated_prob, W_MODEL)
    elif model_prob is not None and 0 < model_prob < 1:
        # Fall back to uncalibrated if no calibrator
        components["model"] = (model_prob, W_MODEL * 0.85)

    if market_mid is not None and 0 < market_mid < 1:
        # Scale market weight by liquidity
        market_w = W_MARKET * liquidity_score
        components["market"] = (market_mid, market_w)

    if not components:
        return 0.5, 0.3, 0.7  # no data → maximum uncertainty

    # --- Weighted average ---
    total_weight = sum(w for _, w in components.values())
    fair_prob = sum(p * w for p, w in components.values()) / total_weight

    # --- Uncertainty estimation ---
    probs = [p for p, _ in components.values()]
    model_disagreement = float(np.std(probs)) if len(probs) > 1 else 0.10

    # Additional uncertainty from time-to-game (farther out = less certain)
    time_uncertainty = min(0.05, time_to_game_hours / 96 * 0.04)

    total_uncertainty = model_disagreement + time_uncertainty

    # 95% CI using normal approximation
    margin = 1.96 * total_uncertainty

    ci_lower = max(0.01, fair_prob - margin)
    ci_upper = min(0.99, fair_prob + margin)

    return round(fair_prob, 4), round(ci_lower, 4), round(ci_upper, 4)


def compute_confidence_score(
    fair_prob: float,
    ci_lower: float,
    ci_upper: float,
    edge: float,
    liquidity_score: float,
    injury_uncertainty: float,
) -> tuple[float, str]:
    """
    Compute a composite confidence score [0, 1] and tier (HIGH/MED/LOW).

    Factors:
    - How far from 50/50 (higher certainty = easier to be right)
    - CI width (tighter = more confident)
    - Edge magnitude
    - Liquidity quality
    - Injury uncertainty (higher = less confident)
    """
    ci_width = ci_upper - ci_lower
    prob_extremity = abs(fair_prob - 0.5) * 2  # [0,1]: 0=coin flip, 1=certain

    # Component scores
    ci_score = max(0.0, 1.0 - ci_width / 0.30)   # ideal: < 0.10 width
    edge_score = min(1.0, edge / 0.12)             # ideal: > 12% edge
    liq_score = liquidity_score
    injury_penalty = 1.0 - injury_uncertainty
    extremity_score = prob_extremity

    # Weighted composite
    score = (
        0.30 * ci_score +
        0.25 * edge_score +
        0.20 * liq_score +
        0.15 * injury_penalty +
        0.10 * extremity_score
    )
    score = max(0.0, min(1.0, score))

    if score >= 0.70:
        tier = "HIGH"
    elif score >= 0.45:
        tier = "MED"
    else:
        tier = "LOW"

    return round(score, 3), tier
