"""Tests for the price-volume attention + technical gauge computation.

The indicators are deterministic arithmetic, so we assert on constructed
series where the expected signal is unambiguous.
"""

import math

from newsagg.technical import (
    TechParams,
    _obv,
    _rsi,
    compute_attention,
    compute_gauge,
    compute_ticker,
)

P = TechParams()


def _flat(n: int, price: float = 50.0, vol: float = 1_000_000.0):
    highs = [price * 1.01] * n
    lows = [price * 0.99] * n
    closes = [price] * n
    vols = [vol] * n
    return highs, lows, closes, vols


def test_rsi_all_gains_is_100():
    # A monotonically rising series has no losses → RSI pins at 100.
    closes = [float(i) for i in range(1, 40)]
    assert _rsi(closes) == 100.0


def test_obv_tracks_direction():
    closes = [10, 11, 12, 11]  # up, up, down
    vols = [100, 200, 300, 400]
    obv = _obv(closes, vols)
    assert obv == [0, 200, 500, 100]  # +200 +300 -400


def test_flat_series_does_not_ignite():
    highs, lows, closes, vols = _flat(120)
    a = compute_attention(highs, lows, closes, vols, P)
    assert a["ignites"] is False
    assert a["phase"] in ("quiet", "accumulating")
    assert a["rvol"] is not None and abs(a["rvol"] - 1.0) < 0.01


def test_volume_breakout_ignites():
    # Gentle uptrend, then the last 3 days break to new highs on 3x volume.
    n = 260
    closes, highs, lows, vols = [], [], [], []
    price = 20.0
    for i in range(n):
        price *= 1.0 + 0.0015 + 0.02 * math.sin(i / 9)
        closes.append(price)
        highs.append(price * 1.01)
        lows.append(price * 0.99)
        vols.append(1_000_000.0)
    for k in (3, 2, 1):
        closes[-k] = closes[-4] * (1.03 + 0.02 * (3 - k))
        highs[-k] = closes[-k] * 1.01
        lows[-k] = closes[-k] * 0.985
        vols[-k] = 1_000_000.0 * (2.5 + 0.8 * (3 - k))
    a = compute_attention(highs, lows, closes, vols, P)
    assert a["ignites"] is True
    assert a["phase"] in ("igniting", "breakout")
    assert a["new_high_20d"] is True
    assert a["obv_up"] is True
    assert a["rvol"] is not None and a["rvol"] >= P.rvol_min


def test_gauge_summary_is_a_known_bucket():
    highs, lows, closes, _ = _flat(220, price=50.0)
    # nudge into a mild uptrend so MAs disagree a bit
    closes = [50 + i * 0.05 for i in range(220)]
    highs = [c * 1.01 for c in closes]
    lows = [c * 0.99 for c in closes]
    g = compute_gauge(highs, lows, closes, P)
    assert g["summary"] in ("strong_buy", "buy", "neutral", "sell", "strong_sell")
    assert g["rsi"] is None or 0.0 <= g["rsi"] <= 100.0


def test_compute_ticker_shape():
    highs, lows, closes, vols = _flat(120)
    out = compute_ticker(
        {"highs": highs, "lows": lows, "closes": closes, "volumes": vols}, P
    )
    assert out is not None
    for key in ("price", "attention", "gauge", "close_series", "vol_series"):
        assert key in out
    assert len(out["close_series"]) <= 60


def test_too_short_history_is_none():
    highs, lows, closes, vols = _flat(10)
    assert compute_ticker(
        {"highs": highs, "lows": lows, "closes": closes, "volumes": vols}, P
    ) is None
