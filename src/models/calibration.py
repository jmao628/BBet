"""
Probability calibration layer.
Maps raw model outputs → well-calibrated probabilities.
"""

from __future__ import annotations

import pickle
from pathlib import Path
from typing import Literal

import numpy as np
import pandas as pd
from sklearn.calibration import calibration_curve
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression

import structlog

log = structlog.get_logger(__name__)


def expected_calibration_error(
    y_true: np.ndarray,
    y_prob: np.ndarray,
    n_bins: int = 10,
) -> float:
    """
    Expected Calibration Error (ECE).
    Lower is better. Target: < 0.03.
    """
    bin_edges = np.linspace(0, 1, n_bins + 1)
    ece = 0.0
    n = len(y_true)

    for i in range(n_bins):
        mask = (y_prob >= bin_edges[i]) & (y_prob < bin_edges[i + 1])
        if mask.sum() == 0:
            continue
        bin_conf = y_prob[mask].mean()
        bin_acc = y_true[mask].mean()
        ece += mask.sum() / n * abs(bin_acc - bin_conf)

    return ece


class ProbabilityCalibrator:
    """
    Wraps isotonic regression (preferred) or Platt scaling.
    Supports stratified calibration by liquidity bucket, market type, etc.
    """

    def __init__(
        self,
        method: Literal["isotonic", "platt"] = "isotonic",
        min_samples: int = 100,
    ) -> None:
        self.method = method
        self.min_samples = min_samples
        self._global_cal: IsotonicRegression | LogisticRegression | None = None
        self._stratified: dict[str, IsotonicRegression | LogisticRegression] = {}

    def _make_calibrator(self):
        if self.method == "isotonic":
            return IsotonicRegression(out_of_bounds="clip")
        else:
            return LogisticRegression()

    def _fit_one(self, raw_probs: np.ndarray, y: np.ndarray):
        cal = self._make_calibrator()
        if self.method == "isotonic":
            cal.fit(raw_probs, y)
        else:
            cal.fit(raw_probs.reshape(-1, 1), y)
        return cal

    def _predict_one(self, cal, raw_probs: np.ndarray) -> np.ndarray:
        if self.method == "isotonic":
            return cal.predict(raw_probs)
        else:
            return cal.predict_proba(raw_probs.reshape(-1, 1))[:, 1]

    # ------------------------------------------------------------------
    # Training
    # ------------------------------------------------------------------

    def fit(
        self,
        raw_probs: np.ndarray,
        y_true: np.ndarray,
        strata: pd.Series | None = None,
    ) -> dict[str, float]:
        """
        Fit global calibrator + optional per-stratum calibrators.

        Parameters
        ----------
        raw_probs : array of shape (n,) — raw model probabilities
        y_true    : array of shape (n,) — binary labels
        strata    : optional Series (same length) — e.g. "high_liq", "playoff"
        """
        raw_probs = np.array(raw_probs, dtype=float)
        y_true = np.array(y_true, dtype=float)

        # Global calibrator
        self._global_cal = self._fit_one(raw_probs, y_true)

        before_ece = expected_calibration_error(y_true, raw_probs)
        after_preds = self._predict_one(self._global_cal, raw_probs)
        after_ece = expected_calibration_error(y_true, after_preds)

        log.info(
            "calibration_fit",
            method=self.method,
            n_samples=len(y_true),
            ece_before=round(before_ece, 4),
            ece_after=round(after_ece, 4),
        )

        # Stratified calibration
        if strata is not None:
            for bucket in strata.unique():
                mask = strata == bucket
                if mask.sum() < self.min_samples:
                    log.debug("strata_skipped_few_samples", bucket=bucket, n=mask.sum())
                    continue
                self._stratified[str(bucket)] = self._fit_one(
                    raw_probs[mask], y_true[mask]
                )
                log.debug("strata_calibrator_fit", bucket=bucket, n=mask.sum())

        return {
            "ece_before": before_ece,
            "ece_after": after_ece,
            "n_strata": len(self._stratified),
        }

    # ------------------------------------------------------------------
    # Inference
    # ------------------------------------------------------------------

    def calibrate(
        self,
        raw_prob: float,
        stratum: str | None = None,
    ) -> float:
        """Calibrate a single raw probability."""
        if self._global_cal is None:
            return raw_prob  # no calibration fitted, return as-is

        if stratum and stratum in self._stratified:
            cal = self._stratified[stratum]
        else:
            cal = self._global_cal

        result = float(self._predict_one(cal, np.array([raw_prob]))[0])
        return max(0.01, min(0.99, result))

    def calibrate_array(
        self,
        raw_probs: np.ndarray,
        strata: list[str] | None = None,
    ) -> np.ndarray:
        """Calibrate a batch of probabilities."""
        if self._global_cal is None:
            return raw_probs

        if strata is None:
            return self._predict_one(self._global_cal, raw_probs)

        result = np.empty_like(raw_probs)
        for i, (prob, stratum) in enumerate(zip(raw_probs, strata)):
            result[i] = self.calibrate(prob, stratum)
        return np.clip(result, 0.01, 0.99)

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def save(self, path: str | Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as f:
            pickle.dump(self, f)

    @classmethod
    def load(cls, path: str | Path) -> "ProbabilityCalibrator":
        with open(path, "rb") as f:
            return pickle.load(f)
