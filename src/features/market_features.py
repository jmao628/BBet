"""
Market microstructure features — computed from price history and order books.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any


@dataclass
class MarketMicrostructureFeatures:
    """
    Time-series-derived features from a contract's price history and orderbook.
    All times relative to current signal_time.
    """

    contract_id: str
    signal_time: datetime

    # Current quote
    yes_bid: float = 0.0
    yes_ask: float = 0.0
    yes_mid: float = 0.0
    spread: float = 0.0

    # Price movement (historical vs current)
    open_to_current_move: float = 0.0   # current_mid - opening_mid
    last_24h_move: float = 0.0
    last_6h_move: float = 0.0
    last_1h_move: float = 0.0
    last_30min_move: float = 0.0

    # Momentum
    price_acceleration: float = 0.0    # 1h_move rate vs 3h_move rate

    # Orderbook
    depth_3c_bid: float = 0.0
    depth_3c_ask: float = 0.0
    depth_5c_bid: float = 0.0
    depth_5c_ask: float = 0.0
    ob_imbalance: float = 0.0          # (bid - ask) / (bid + ask)
    liquidity_score: float = 0.0       # [0,1] composite

    # Volume
    volume_24h: float = 0.0
    open_interest: float = 0.0

    # Cross-platform
    cross_platform_basis: float = 0.0  # kalshi_mid - poly_mid

    # vs sportsbook
    vs_sportsbook_basis: float = 0.0   # market_mid - sportsbook_novig

    @classmethod
    def compute(
        cls,
        contract_id: str,
        signal_time: datetime,
        quote_history: list[dict],          # [{quote_time, yes_mid, ...}, ...]
        current_orderbook: dict | None,
        sportsbook_novig: float | None = None,
        poly_mid: float | None = None,
        liquidity_cfg: dict | None = None,
    ) -> "MarketMicrostructureFeatures":
        obj = cls(contract_id=contract_id, signal_time=signal_time)

        if not quote_history:
            return obj

        # Sort by time descending
        history = sorted(
            quote_history,
            key=lambda x: x["quote_time"],
            reverse=True,
        )

        current = history[0]
        obj.yes_bid = current.get("yes_bid", 0)
        obj.yes_ask = current.get("yes_ask", 1)
        obj.yes_mid = current.get("yes_mid", 0.5)
        obj.spread = current.get("spread", 0)

        def find_mid_n_hours_ago(hours: float) -> float | None:
            target = signal_time - timedelta(hours=hours)
            candidates = [
                h for h in history
                if h["quote_time"] <= target
            ]
            return candidates[0]["yes_mid"] if candidates else None

        opening_mid = history[-1]["yes_mid"] if history else None
        mid_24h = find_mid_n_hours_ago(24)
        mid_6h = find_mid_n_hours_ago(6)
        mid_1h = find_mid_n_hours_ago(1)
        mid_30m = find_mid_n_hours_ago(0.5)
        mid_3h = find_mid_n_hours_ago(3)

        if opening_mid is not None:
            obj.open_to_current_move = obj.yes_mid - opening_mid
        if mid_24h is not None:
            obj.last_24h_move = obj.yes_mid - mid_24h
        if mid_6h is not None:
            obj.last_6h_move = obj.yes_mid - mid_6h
        if mid_1h is not None:
            obj.last_1h_move = obj.yes_mid - mid_1h
        if mid_30m is not None:
            obj.last_30min_move = obj.yes_mid - mid_30m

        # Acceleration: recent 1h rate vs 3h rate
        if mid_1h is not None and mid_3h is not None:
            rate_1h = obj.last_1h_move / 1.0
            rate_3h = (obj.yes_mid - mid_3h) / 3.0
            obj.price_acceleration = rate_1h - rate_3h

        # Orderbook
        if current_orderbook:
            obj.depth_3c_bid = current_orderbook.get("depth_3c_bid", 0)
            obj.depth_3c_ask = current_orderbook.get("depth_3c_ask", 0)
            obj.depth_5c_bid = current_orderbook.get("depth_5c_bid", 0)
            obj.depth_5c_ask = current_orderbook.get("depth_5c_ask", 0)
            obj.ob_imbalance = current_orderbook.get("imbalance", 0)
            obj.liquidity_score = cls._compute_liquidity_score(
                depth_3c=obj.depth_3c_bid + obj.depth_3c_ask,
                spread=obj.spread,
                volume_24h=current.get("volume_24h", 0),
                cfg=liquidity_cfg or {},
            )

        obj.volume_24h = current.get("volume_24h", 0)
        obj.open_interest = current.get("open_interest", 0)

        # Cross-platform basis
        if poly_mid is not None:
            obj.cross_platform_basis = obj.yes_mid - poly_mid

        # vs sportsbook
        if sportsbook_novig is not None:
            obj.vs_sportsbook_basis = obj.yes_mid - sportsbook_novig

        return obj

    @staticmethod
    def _compute_liquidity_score(
        depth_3c: float,
        spread: float,
        volume_24h: float,
        cfg: dict,
    ) -> float:
        """
        Composite liquidity score [0, 1].
        Higher = more liquid = can trade larger size.
        """
        tiers = cfg.get("liquidity_tiers", {})
        high_min = tiers.get("high", {}).get("min_depth_3c_usd", 5000)
        med_min = tiers.get("medium", {}).get("min_depth_3c_usd", 1000)
        low_min = tiers.get("low", {}).get("min_depth_3c_usd", 300)

        # Depth score
        if depth_3c >= high_min:
            depth_score = 1.0
        elif depth_3c >= med_min:
            depth_score = 0.7
        elif depth_3c >= low_min:
            depth_score = 0.4
        else:
            depth_score = 0.1

        # Spread score (inverted — tighter is better)
        max_spread = 0.08
        spread_score = max(0.0, 1.0 - spread / max_spread)

        # Volume score
        vol_score = min(1.0, volume_24h / 10000)

        return 0.5 * depth_score + 0.3 * spread_score + 0.2 * vol_score

    def to_feature_dict(self) -> dict[str, float]:
        return {
            "mkt_yes_mid": self.yes_mid,
            "mkt_spread": self.spread,
            "mkt_open_to_current": self.open_to_current_move,
            "mkt_last_24h_move": self.last_24h_move,
            "mkt_last_6h_move": self.last_6h_move,
            "mkt_last_1h_move": self.last_1h_move,
            "mkt_last_30m_move": self.last_30min_move,
            "mkt_price_accel": self.price_acceleration,
            "mkt_depth_3c_bid": self.depth_3c_bid,
            "mkt_depth_3c_ask": self.depth_3c_ask,
            "mkt_ob_imbalance": self.ob_imbalance,
            "mkt_liquidity_score": self.liquidity_score,
            "mkt_volume_24h": self.volume_24h,
            "mkt_cross_platform_basis": self.cross_platform_basis,
            "mkt_vs_sportsbook_basis": self.vs_sportsbook_basis,
        }
