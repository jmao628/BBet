"""
LightGBM basketball prediction model.
Input: matchup feature dict
Output: P(home team wins) ∈ [0, 1]
"""

from __future__ import annotations

import json
import pickle
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import lightgbm as lgb
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import log_loss, brier_score_loss

import structlog

log = structlog.get_logger(__name__)

# Feature columns used by the model (order matters for inference)
MODEL_FEATURES = [
    # Core efficiency
    "net_rating_diff",
    "off_rating_diff",
    "def_rating_diff",
    "location_adj_net",
    "expected_margin",
    "home_off_vs_away_def",
    "away_off_vs_home_def",
    # Rolling form
    "last5_diff",
    "last3_diff",
    "home_last5_net",
    "away_last5_net",
    # Rest / B2B
    "rest_diff",
    "b2b_advantage",
    "home_rest_days",
    "away_rest_days",
    "travel_diff",
    # Injury
    "injury_diff",
    "home_injury_impact",
    "away_injury_impact",
    "home_has_gtd_star",
    "away_has_gtd_star",
    # Matchup
    "pace_diff",
    "efg_diff",
    "tov_diff",
    # Elo
    "elo_diff",
    "elo_win_prob",
    # Form momentum
    "momentum_diff",
    # Context
    "is_playoff",
    "is_elimination",
    "season_pct_played",
    # Raw stats (tree models can use these directly)
    "home_off_rating",
    "home_def_rating",
    "home_net_rating",
    "away_off_rating",
    "away_def_rating",
    "away_net_rating",
    "home_pace",
    "away_pace",
    "home_home_net",
    "away_road_net",
    # Sportsbook (as soft prior)
    "sportsbook_novig_prob",
]

DEFAULT_PARAMS = {
    "objective": "binary",
    "metric": ["binary_logloss", "auc"],
    "n_estimators": 500,
    "learning_rate": 0.02,
    "num_leaves": 31,
    "min_child_samples": 50,
    "feature_fraction": 0.7,
    "bagging_fraction": 0.8,
    "bagging_freq": 5,
    "lambda_l1": 0.1,
    "lambda_l2": 0.1,
    "verbose": -1,
    "random_state": 42,
}


class BasketballLGBModel:
    """
    Walk-forward trained LightGBM model for NBA game outcome prediction.
    """

    def __init__(
        self,
        features: list[str] | None = None,
        params: dict | None = None,
        version: str = "v0.1",
    ) -> None:
        self.features = features or MODEL_FEATURES
        self.params = params or DEFAULT_PARAMS
        self.version = version
        self._model: lgb.Booster | None = None
        self._feature_importance: pd.DataFrame | None = None

    # ------------------------------------------------------------------
    # Training
    # ------------------------------------------------------------------

    def train(
        self,
        df: pd.DataFrame,
        label_col: str = "home_won",
        date_col: str = "game_date",
        val_start_date: str | None = None,
        early_stopping_rounds: int = 50,
    ) -> dict[str, float]:
        """
        Train with walk-forward validation.

        Time split:
          Train: all data before val_start_date
          Val:   val_start_date onwards (used for early stopping only)

        IMPORTANT: Never use future data — df must already be filtered
        to only include features available at signal_time.
        """
        df = df.copy()
        df[date_col] = pd.to_datetime(df[date_col])

        # Fill missing features with 0 (log when doing so in production)
        X = df[self.features].fillna(0)
        y = df[label_col].astype(int)

        if val_start_date:
            val_mask = df[date_col] >= pd.to_datetime(val_start_date)
        else:
            # Default: last 20% of data as validation
            n_val = max(100, int(len(df) * 0.2))
            val_mask = pd.Series([False] * (len(df) - n_val) + [True] * n_val)
            val_mask.index = df.index

        X_train, y_train = X[~val_mask], y[~val_mask]
        X_val, y_val = X[val_mask], y[val_mask]

        log.info(
            "training_lgb",
            n_train=len(X_train),
            n_val=len(X_val),
            version=self.version,
        )

        dtrain = lgb.Dataset(X_train, label=y_train, feature_name=self.features)
        dval = lgb.Dataset(X_val, label=y_val, reference=dtrain)

        callbacks = [
            lgb.early_stopping(early_stopping_rounds, verbose=False),
            lgb.log_evaluation(period=100),
        ]

        self._model = lgb.train(
            self.params,
            dtrain,
            valid_sets=[dval],
            callbacks=callbacks,
        )

        # Evaluation
        val_preds = self._model.predict(X_val)
        metrics = {
            "val_log_loss": log_loss(y_val, val_preds),
            "val_brier_score": brier_score_loss(y_val, val_preds),
            "n_trees": self._model.num_trees(),
            "n_train": len(X_train),
            "n_val": len(X_val),
        }
        log.info("training_complete", **metrics)

        # Feature importance
        self._feature_importance = pd.DataFrame({
            "feature": self.features,
            "importance_gain": self._model.feature_importance(importance_type="gain"),
            "importance_split": self._model.feature_importance(importance_type="split"),
        }).sort_values("importance_gain", ascending=False)

        return metrics

    # ------------------------------------------------------------------
    # Inference
    # ------------------------------------------------------------------

    def predict(self, features: dict[str, float]) -> float:
        """Predict P(home wins) for a single game."""
        if self._model is None:
            raise RuntimeError("Model not trained or loaded")
        X = pd.DataFrame([features])[self.features].fillna(0)
        prob = float(self._model.predict(X)[0])
        return max(0.01, min(0.99, prob))

    def predict_batch(self, df: pd.DataFrame) -> np.ndarray:
        """Batch prediction."""
        if self._model is None:
            raise RuntimeError("Model not trained or loaded")
        X = df[self.features].fillna(0)
        return self._model.predict(X)

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def save(self, path: str | Path) -> None:
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        self._model.save_model(str(path / f"lgb_{self.version}.txt"))
        with open(path / f"meta_{self.version}.json", "w") as f:
            json.dump({
                "version": self.version,
                "features": self.features,
                "params": self.params,
            }, f, indent=2)
        log.info("model_saved", path=str(path), version=self.version)

    @classmethod
    def load(cls, path: str | Path, version: str = "v0.1") -> "BasketballLGBModel":
        path = Path(path)
        with open(path / f"meta_{version}.json") as f:
            meta = json.load(f)
        obj = cls(features=meta["features"], params=meta["params"], version=version)
        obj._model = lgb.Booster(model_file=str(path / f"lgb_{version}.txt"))
        log.info("model_loaded", path=str(path), version=version)
        return obj

    def feature_importance_df(self) -> pd.DataFrame:
        if self._feature_importance is None:
            raise RuntimeError("Train model first")
        return self._feature_importance
