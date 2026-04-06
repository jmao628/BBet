"""
Signal Engine — the core decision pipeline.

Flow:
  raw market data + features
  → probability layer
  → ensemble fair prob
  → edge / EV / Kelly
  → risk filters
  → structured TradingSignal output
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import structlog

from src.config import cfg
from src.etl.odds_transformer import (
    compute_edge,
    compute_expected_value,
    compute_kelly_fraction,
    market_price_to_executable_prob,
)
from src.models.calibration import ProbabilityCalibrator
from src.models.ensemble import compute_ensemble_fair_prob, compute_confidence_score
from src.models.lgb_model import BasketballLGBModel

log = structlog.get_logger(__name__)

THRESHOLDS = cfg["thresholds"]
RISK_CFG = cfg["risk"]


@dataclass
class TradingSignal:
    """Complete structured output for one market contract at one point in time."""

    # Identity
    signal_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    game_id: str = ""
    game_time_utc: datetime | None = None
    home_team: str = ""
    away_team: str = ""
    platform: str = ""
    contract_id: str = ""
    question: str = ""
    market_type: str = "moneyline"

    # Price layer
    yes_bid: float = 0.0
    yes_ask: float = 0.0
    yes_mid: float = 0.0
    spread: float = 0.0

    # Probability layer
    sportsbook_novig_prob: float | None = None
    market_fee_adj_prob: float | None = None
    model_prob: float | None = None
    calibrated_prob: float | None = None
    ensemble_fair_prob: float | None = None
    prob_ci_lower: float | None = None
    prob_ci_upper: float | None = None
    model_disagreement: float = 0.0

    # Decision layer
    direction: str = "SKIP"    # YES / NO / SKIP
    edge: float = 0.0
    expected_value: float = 0.0
    kelly_full: float = 0.0
    kelly_suggested: float = 0.0
    suggested_size_usd: float | None = None
    max_size_usd: float | None = None

    # Confidence
    confidence_score: float = 0.0
    confidence_tier: str = "LOW"

    # Risk
    liquidity_score: float = 0.0
    injury_uncertainty: float = 0.0
    time_to_game_hours: float = 24.0

    # Explanations
    key_drivers: list[dict[str, Any]] = field(default_factory=list)
    risk_flags: list[dict[str, Any]] = field(default_factory=list)

    # Status
    is_actionable: bool = False
    skip_reason: str | None = None
    is_backtest: bool = False
    signal_time: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict[str, Any]:
        d = {k: v for k, v in self.__dict__.items()}
        if isinstance(d.get("game_time_utc"), datetime):
            d["game_time_utc"] = d["game_time_utc"].isoformat()
        if isinstance(d.get("signal_time"), datetime):
            d["signal_time"] = d["signal_time"].isoformat()
        return d


class SignalEngine:
    """
    Orchestrates the full signal generation pipeline for a single market.
    """

    def __init__(
        self,
        model: BasketballLGBModel | None = None,
        calibrator: ProbabilityCalibrator | None = None,
        bankroll_usd: float = 10_000.0,
    ) -> None:
        self._model = model
        self._calibrator = calibrator
        self._bankroll = bankroll_usd

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    def generate(
        self,
        game_id: str,
        game_time_utc: datetime,
        home_team: str,
        away_team: str,
        platform: str,
        contract_id: str,
        question: str,
        market_type: str,
        # Price data
        yes_bid: float,
        yes_ask: float,
        fee_pct: float = 0.02,
        # Probability inputs
        sportsbook_novig_prob: float | None = None,
        matchup_features: dict[str, float] | None = None,
        # Market features
        liquidity_score: float = 0.5,
        injury_uncertainty: float = 0.0,
        has_gtd_star: bool = False,
        quote_history: list[dict] | None = None,
        # Meta
        is_backtest: bool = False,
        signal_time: datetime | None = None,
    ) -> TradingSignal:
        signal = TradingSignal(
            game_id=game_id,
            game_time_utc=game_time_utc,
            home_team=home_team,
            away_team=away_team,
            platform=platform,
            contract_id=contract_id,
            question=question,
            market_type=market_type,
            yes_bid=yes_bid,
            yes_ask=yes_ask,
            yes_mid=(yes_bid + yes_ask) / 2,
            spread=yes_ask - yes_bid,
            sportsbook_novig_prob=sportsbook_novig_prob,
            liquidity_score=liquidity_score,
            injury_uncertainty=injury_uncertainty,
            is_backtest=is_backtest,
            signal_time=signal_time or datetime.now(timezone.utc),
        )

        # Time to game
        now = signal.signal_time
        if game_time_utc.tzinfo is None:
            game_time_utc = game_time_utc.replace(tzinfo=timezone.utc)
        signal.time_to_game_hours = max(
            0.0, (game_time_utc - now).total_seconds() / 3600
        )

        # Step 1: Compute model probability
        signal = self._compute_model_prob(signal, matchup_features)

        # Step 2: Market executable probability (fee-adjusted)
        signal.market_fee_adj_prob = market_price_to_executable_prob(
            signal.yes_ask, fee_pct, "yes"
        )

        # Step 3: Ensemble
        fair, ci_lo, ci_hi = compute_ensemble_fair_prob(
            sportsbook_novig=sportsbook_novig_prob,
            model_prob=signal.model_prob,
            calibrated_prob=signal.calibrated_prob,
            market_mid=signal.yes_mid,
            liquidity_score=liquidity_score,
            time_to_game_hours=signal.time_to_game_hours,
        )
        signal.ensemble_fair_prob = fair
        signal.prob_ci_lower = ci_lo
        signal.prob_ci_upper = ci_hi
        signal.model_disagreement = self._compute_disagreement(signal)

        # Step 4: Direction and edge (YES side)
        edge_yes = compute_edge(fair, signal.market_fee_adj_prob)
        ev_yes = compute_expected_value(fair, signal.market_fee_adj_prob)
        kelly_yes = compute_kelly_fraction(fair, signal.market_fee_adj_prob)

        # NO side
        no_exec = market_price_to_executable_prob(
            1 - yes_bid, fee_pct, "no"
        )
        edge_no = compute_edge(1 - fair, no_exec)
        ev_no = compute_expected_value(1 - fair, no_exec)
        kelly_no = compute_kelly_fraction(1 - fair, no_exec)

        if edge_yes >= edge_no and edge_yes > 0:
            signal.direction = "YES"
            signal.edge = edge_yes
            signal.expected_value = ev_yes
            signal.kelly_full = kelly_yes
        elif edge_no > edge_yes and edge_no > 0:
            signal.direction = "NO"
            signal.edge = edge_no
            signal.expected_value = ev_no
            signal.kelly_full = kelly_no
        else:
            signal.direction = "SKIP"
            signal.edge = max(edge_yes, edge_no)

        # Step 5: Confidence
        signal.confidence_score, signal.confidence_tier = compute_confidence_score(
            fair_prob=fair,
            ci_lower=ci_lo,
            ci_upper=ci_hi,
            edge=signal.edge,
            liquidity_score=liquidity_score,
            injury_uncertainty=injury_uncertainty,
        )

        # Step 6: Kelly sizing
        kelly_frac = RISK_CFG["kelly_fraction"]
        signal.kelly_suggested = signal.kelly_full * kelly_frac
        max_pct = RISK_CFG["max_position_pct"]
        max_size = self._bankroll * max_pct
        suggested = self._bankroll * signal.kelly_suggested
        signal.suggested_size_usd = min(suggested, max_size)
        signal.max_size_usd = max_size

        # Step 7: Key drivers
        signal.key_drivers = self._extract_key_drivers(signal, matchup_features)

        # Step 8: Risk flags
        signal.risk_flags = self._extract_risk_flags(
            signal, has_gtd_star, injury_uncertainty
        )

        # Step 9: Final filter
        signal = self._apply_thresholds(signal)

        log.info(
            "signal_generated",
            game_id=game_id,
            direction=signal.direction,
            edge=round(signal.edge, 4),
            is_actionable=signal.is_actionable,
            confidence_tier=signal.confidence_tier,
        )

        return signal

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _compute_model_prob(
        self,
        signal: TradingSignal,
        matchup_features: dict | None,
    ) -> TradingSignal:
        if self._model is not None and matchup_features is not None:
            try:
                raw_prob = self._model.predict(matchup_features)
                signal.model_prob = raw_prob
                if self._calibrator is not None:
                    signal.calibrated_prob = self._calibrator.calibrate(raw_prob)
                else:
                    signal.calibrated_prob = raw_prob
            except Exception as exc:
                log.warning("model_predict_failed", error=str(exc))
        return signal

    def _compute_disagreement(self, signal: TradingSignal) -> float:
        probs = [
            p for p in [
                signal.sportsbook_novig_prob,
                signal.calibrated_prob,
                signal.yes_mid,
            ]
            if p is not None
        ]
        if len(probs) < 2:
            return 0.10
        import numpy as np
        return float(np.std(probs))

    def _extract_key_drivers(
        self,
        signal: TradingSignal,
        features: dict | None,
    ) -> list[dict]:
        drivers = []
        if features is None:
            return drivers

        # Top contributing factors (simplified heuristic for MVP)
        factor_map = {
            "net_rating_diff": ("net_rating_advantage", 0.004),
            "b2b_advantage": ("back_to_back_advantage", 0.03),
            "injury_diff": ("injury_impact", 0.025),
            "elo_diff": ("elo_advantage", 0.001),
            "last5_diff": ("recent_form", 0.004),
            "location_adj_net": ("home_away_split", 0.004),
        }

        for feat, (label, scale) in factor_map.items():
            val = features.get(feat, 0)
            impact = val * scale
            if abs(impact) >= 0.01:
                drivers.append({
                    "factor": label,
                    "raw_value": round(val, 2),
                    "impact": round(impact, 3),
                })

        # Sort by absolute impact
        drivers.sort(key=lambda x: abs(x["impact"]), reverse=True)
        return drivers[:3]

    def _extract_risk_flags(
        self,
        signal: TradingSignal,
        has_gtd_star: bool,
        injury_uncertainty: float,
    ) -> list[dict]:
        flags = []
        cfg_thresh = THRESHOLDS

        if has_gtd_star and signal.time_to_game_hours < 3:
            flags.append({
                "flag": "gtd_star_unconfirmed",
                "severity": "HIGH",
                "note": "Star player GTD with <3h to tipoff",
            })

        if injury_uncertainty > 0.6:
            flags.append({
                "flag": "high_injury_uncertainty",
                "severity": "MEDIUM",
                "note": f"Injury uncertainty = {injury_uncertainty:.2f}",
            })

        if signal.spread > 0.06:
            flags.append({
                "flag": "wide_spread",
                "severity": "LOW",
                "note": f"Bid-ask spread = {signal.spread:.3f}",
            })

        if signal.model_disagreement > 0.08:
            flags.append({
                "flag": "model_disagreement",
                "severity": "MEDIUM",
                "note": f"Model std = {signal.model_disagreement:.3f}",
            })

        ci_width = (signal.prob_ci_upper or 1) - (signal.prob_ci_lower or 0)
        if ci_width > 0.20:
            flags.append({
                "flag": "wide_confidence_interval",
                "severity": "MEDIUM",
                "note": f"CI width = {ci_width:.3f}",
            })

        return flags

    def _apply_thresholds(self, signal: TradingSignal) -> TradingSignal:
        """Apply all go/no-go filters."""
        if signal.direction == "SKIP":
            signal.is_actionable = False
            signal.skip_reason = "no_positive_edge"
            return signal

        checks = [
            (signal.edge < THRESHOLDS["min_edge"],
             f"edge_below_threshold: {signal.edge:.4f} < {THRESHOLDS['min_edge']}"),
            (signal.expected_value < THRESHOLDS["min_ev"],
             f"ev_below_threshold: {signal.expected_value:.4f} < {THRESHOLDS['min_ev']}"),
            (signal.liquidity_score < 0.15,
             "liquidity_too_low"),
            (signal.confidence_score < THRESHOLDS["min_confidence_score"],
             f"confidence_below_threshold: {signal.confidence_score:.3f}"),
            (signal.model_disagreement > THRESHOLDS["max_model_disagreement"],
             f"model_disagreement_too_high: {signal.model_disagreement:.3f}"),
            (signal.injury_uncertainty > THRESHOLDS["max_injury_uncertainty"],
             f"injury_uncertainty_too_high: {signal.injury_uncertainty:.3f}"),
            (signal.time_to_game_hours < THRESHOLDS["min_time_to_game_hours"],
             "too_close_to_tipoff"),
            (signal.time_to_game_hours > THRESHOLDS["max_time_to_game_hours"],
             "too_far_from_game"),
            # High-severity risk flags block the signal
            (any(f["severity"] == "HIGH" for f in signal.risk_flags),
             f"high_severity_risk: {[f['flag'] for f in signal.risk_flags if f['severity'] == 'HIGH']}"),
        ]

        for failed, reason in checks:
            if failed:
                signal.is_actionable = False
                signal.direction = "SKIP"
                signal.skip_reason = reason
                return signal

        signal.is_actionable = True
        return signal
