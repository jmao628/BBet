"""Price-volume *attention* signal + a technical summary for the seed universe.

Mid/small caps that are starting to get market attention usually show it in
price/volume long before Reddit does. This module computes, per ticker, from
daily OHLCV (yfinance — the same Yahoo bars TradingView/investing.com use, so
every indicator here is deterministic arithmetic that matches any provider):

  * an **attention** signal — relative volume, breakout, OBV accumulation and
    trend — that lets a mid/small cap pass the heat gate even when social
    mentions are too sparse to ignite; and
  * a **gauge** — the investing.com-style MA + oscillator mechanical aggregate
    (Strong Buy…Strong Sell). Display only, and it lags — never a filter.

Writes ``data/newsagg/technical_latest.json`` = {ticker: {...}}.

    python -m newsagg.technical
"""

from __future__ import annotations

import argparse
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from newsagg.config import load_settings
from newsagg.marketcap import seed_tickers

logger = logging.getLogger("newsagg.technical")

TECHNICAL_FILE = "technical_latest.json"


@dataclass
class TechParams:
    rvol_short: int = 5  # recent-volume window
    rvol_long: int = 20  # baseline-volume window
    rvol_min: float = 1.5  # relative-volume ignition threshold
    breakout_window: int = 20  # N-day high for breakout
    near_high_pct: float = 0.05  # "within 5% of the 20-day high" counts as coiled
    obv_window: int = 20  # OBV-slope lookback
    detonate_rvol: float = 2.0  # 52-week-high breakout needs this much volume


# ---------------------------------------------------------------- math helpers


def _sma(xs: list[float], n: int) -> float | None:
    if len(xs) < n:
        return None
    return sum(xs[-n:]) / n


def _ema_series(xs: list[float], n: int) -> list[float | None]:
    if len(xs) < n:
        return []
    k = 2 / (n + 1)
    e = sum(xs[:n]) / n
    out: list[float | None] = [None] * (n - 1) + [e]
    for x in xs[n:]:
        e = x * k + e * (1 - k)
        out.append(e)
    return out


def _slope(ys: list[float]) -> float:
    n = len(ys)
    if n < 2:
        return 0.0
    mx = (n - 1) / 2
    my = sum(ys) / n
    denom = sum((i - mx) ** 2 for i in range(n))
    if denom == 0:
        return 0.0
    return sum((i - mx) * (y - my) for i, y in enumerate(ys)) / denom


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _rsi(closes: list[float], n: int = 14) -> float | None:
    if len(closes) < n + 1:
        return None
    gains, losses = [], []
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
    avg_g = sum(gains[:n]) / n
    avg_l = sum(losses[:n]) / n
    for i in range(n, len(gains)):  # Wilder smoothing
        avg_g = (avg_g * (n - 1) + gains[i]) / n
        avg_l = (avg_l * (n - 1) + losses[i]) / n
    if avg_l == 0:
        return 100.0
    rs = avg_g / avg_l
    return 100 - 100 / (1 + rs)


def _macd(closes: list[float]) -> tuple[float, float, float] | None:
    e12 = _ema_series(closes, 12)
    e26 = _ema_series(closes, 26)
    if not e26 or e26[-1] is None:
        return None
    line_series = [
        (a - b) if (a is not None and b is not None) else None for a, b in zip(e12, e26)
    ]
    vals = [m for m in line_series if m is not None]
    sig = _ema_series(vals, 9)
    line = line_series[-1] or 0.0
    if not sig or sig[-1] is None:
        return (line, line, 0.0)
    signal = sig[-1]
    return (line, signal, line - signal)


def _stoch_k(highs, lows, closes, n: int = 14) -> float | None:
    if len(closes) < n:
        return None
    hh, ll = max(highs[-n:]), min(lows[-n:])
    if hh == ll:
        return 50.0
    return 100 * (closes[-1] - ll) / (hh - ll)


def _cci(highs, lows, closes, n: int = 20) -> float | None:
    if len(closes) < n:
        return None
    tp = [(highs[i] + lows[i] + closes[i]) / 3 for i in range(len(closes))][-n:]
    ma = sum(tp) / n
    md = sum(abs(x - ma) for x in tp) / n
    if md == 0:
        return 0.0
    return (tp[-1] - ma) / (0.015 * md)


def _williams_r(highs, lows, closes, n: int = 14) -> float | None:
    if len(closes) < n:
        return None
    hh, ll = max(highs[-n:]), min(lows[-n:])
    if hh == ll:
        return -50.0
    return -100 * (hh - closes[-1]) / (hh - ll)


def _atr(highs, lows, closes, n: int = 14) -> float | None:
    if len(closes) < n + 1:
        return None
    trs = []
    for i in range(1, len(closes)):
        trs.append(
            max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1]))
        )
    a = sum(trs[:n]) / n
    for t in trs[n:]:
        a = (a * (n - 1) + t) / n
    return a


def _obv(closes: list[float], volumes: list[float]) -> list[float]:
    o = [0.0]
    for i in range(1, len(closes)):
        if closes[i] > closes[i - 1]:
            o.append(o[-1] + volumes[i])
        elif closes[i] < closes[i - 1]:
            o.append(o[-1] - volumes[i])
        else:
            o.append(o[-1])
    return o


# ------------------------------------------------------------ attention signal


def compute_attention(highs, lows, closes, volumes, p: TechParams) -> dict:
    n = len(closes)
    price = closes[-1]

    v_short = sum(volumes[-p.rvol_short :]) / min(p.rvol_short, n)
    v_long = sum(volumes[-p.rvol_long :]) / min(p.rvol_long, n)
    rvol = (v_short / v_long) if v_long > 0 else None

    prior_high = max(highs[-(p.breakout_window + 1) : -1]) if n >= p.breakout_window + 1 else max(highs[:-1] or highs)
    new_high_20 = price >= prior_high
    win_high = max(highs[-p.breakout_window :])
    dist_to_high = (win_high - price) / win_high if win_high > 0 else None

    prior_52 = max(highs[-253:-1]) if n >= 253 else max(highs[:-1] or highs)
    new_high_52 = price >= prior_52

    obv = _obv(closes, volumes)
    obv_slope = _slope(obv[-p.obv_window :])
    obv_up = obv_slope > 0

    sma50 = _sma(closes, 50)
    sma50_prev = _sma(closes[:-5], 50)
    above50 = sma50 is not None and price > sma50
    sma50_up = sma50 is not None and sma50_prev is not None and sma50 > sma50_prev

    vol_s = _clamp(((rvol or 0) - 1) / 1.5, 0, 1)
    if new_high_20:
        bo_s = 1.0
    elif dist_to_high is not None:
        bo_s = _clamp(1 - dist_to_high / 0.10, 0, 1)
    else:
        bo_s = 0.0
    obv_s = 1.0 if obv_up else 0.0
    tr_s = 1.0 if (above50 and sma50_up) else (0.5 if above50 else 0.0)
    score = round(100 * (0.40 * vol_s + 0.25 * bo_s + 0.20 * obv_s + 0.15 * tr_s))

    if new_high_52 and rvol and rvol >= p.detonate_rvol:
        phase = "breakout"
    elif (
        rvol
        and rvol >= p.rvol_min
        and (new_high_20 or (dist_to_high is not None and dist_to_high <= p.near_high_pct))
        and obv_up
    ):
        phase = "igniting"
    elif obv_up and above50:
        phase = "accumulating"
    else:
        phase = "quiet"

    return {
        "score": score,
        "phase": phase,
        "ignites": phase in ("igniting", "breakout"),
        "rvol": round(rvol, 2) if rvol is not None else None,
        "new_high_20d": new_high_20,
        "new_high_52w": new_high_52,
        "dist_to_high": round(dist_to_high, 3) if dist_to_high is not None else None,
        "obv_up": obv_up,
        "above_sma50": above50,
        "sma50_rising": sma50_up,
    }


# --------------------------------------------------------------- gauge (display)


def _vote_osc(rsi, stoch, cci, wr, macd_hist, roc) -> tuple[int, int, int]:
    buy = sell = neut = 0

    def tally(v: int):
        nonlocal buy, sell, neut
        buy += v == 1
        sell += v == -1
        neut += v == 0

    if rsi is not None:
        tally(1 if rsi < 30 else -1 if rsi > 70 else 0)
    if stoch is not None:
        tally(1 if stoch < 20 else -1 if stoch > 80 else 0)
    if cci is not None:
        tally(1 if cci < -100 else -1 if cci > 100 else 0)
    if wr is not None:
        tally(1 if wr < -80 else -1 if wr > -20 else 0)
    if macd_hist is not None:
        tally(1 if macd_hist > 0 else -1)
    if roc is not None:
        tally(1 if roc > 0 else -1 if roc < 0 else 0)
    return buy, sell, neut


def compute_gauge(highs, lows, closes, p: TechParams) -> dict:
    price = closes[-1]
    ma_buy = ma_sell = 0
    for n in (5, 10, 20, 50, 100, 200):
        s = _sma(closes, n)
        if s is not None:
            ma_buy += price > s
            ma_sell += price <= s
        e = _ema_series(closes, n)
        if e and e[-1] is not None:
            ma_buy += price > e[-1]
            ma_sell += price <= e[-1]

    rsi = _rsi(closes)
    stoch = _stoch_k(highs, lows, closes)
    cci = _cci(highs, lows, closes)
    wr = _williams_r(highs, lows, closes)
    macd = _macd(closes)
    macd_hist = macd[2] if macd else None
    roc = 100 * (closes[-1] - closes[-13]) / closes[-13] if len(closes) >= 13 and closes[-13] else None
    osc_buy, osc_sell, osc_neut = _vote_osc(rsi, stoch, cci, wr, macd_hist, roc)

    buy = ma_buy + osc_buy
    sell = ma_sell + osc_sell
    total = buy + sell + osc_neut
    frac = (buy - sell) / total if total else 0.0
    if frac > 0.5:
        summary = "strong_buy"
    elif frac > 0.1:
        summary = "buy"
    elif frac < -0.5:
        summary = "strong_sell"
    elif frac < -0.1:
        summary = "sell"
    else:
        summary = "neutral"

    return {
        "summary": summary,
        "ma_buy": ma_buy,
        "ma_sell": ma_sell,
        "osc_buy": osc_buy,
        "osc_sell": osc_sell,
        "osc_neutral": osc_neut,
        "rsi": round(rsi, 1) if rsi is not None else None,
        "macd_hist": round(macd_hist, 3) if macd_hist is not None else None,
    }


def _buy_streak(highs, lows, closes, p: TechParams, max_days: int = 5) -> int:
    """How many of the most-recent trading days read Buy/Strong-Buy in a row.

    Recomputed retroactively from the daily series (no history file needed): for
    each of the last ``max_days`` days we re-run the mechanical gauge on the data
    *as it stood that day* and count consecutive Buy days ending today. A high
    streak = a sustained buy posture, not a one-day blip.
    """
    streak = 0
    for k in range(max_days):
        n = len(closes) - k
        if n < 50:
            break
        g = compute_gauge(highs[:n], lows[:n], closes[:n], p)
        if g["summary"] in ("buy", "strong_buy"):
            streak += 1
        else:
            break
    return streak


def compute_ticker(bars: dict, p: TechParams) -> dict | None:
    highs, lows, closes, volumes = bars["highs"], bars["lows"], bars["closes"], bars["volumes"]
    if len(closes) < 30:
        return None
    price = closes[-1]
    prev = closes[-2] if len(closes) >= 2 else price
    atr = _atr(highs, lows, closes)
    tail = 60
    out = {
        "price": round(price, 2),
        "change_pct": round(100 * (price - prev) / prev, 2) if prev else None,
        "atr_pct": round(100 * atr / price, 2) if atr and price else None,
        "sma20": round(_sma(closes, 20), 2) if _sma(closes, 20) else None,
        "sma50": round(_sma(closes, 50), 2) if _sma(closes, 50) else None,
        "sma200": round(_sma(closes, 200), 2) if _sma(closes, 200) else None,
        "days": len(closes),
        "attention": compute_attention(highs, lows, closes, volumes, p),
        "gauge": compute_gauge(highs, lows, closes, p),
        "buy_streak": _buy_streak(highs, lows, closes, p),
        "close_series": [round(c, 2) for c in closes[-tail:]],
        "vol_series": [int(v) for v in volumes[-tail:]],
    }
    return out


# ---------------------------------------------------------------------- fetch


def _fetch_bars(ticker: str) -> dict | None:
    import yfinance as yf

    df = yf.Ticker(ticker.replace(".", "-")).history(period="1y", auto_adjust=False)
    if df is None or df.empty:
        return None
    highs, lows, closes, volumes = [], [], [], []
    for h, low, c, v in zip(df["High"], df["Low"], df["Close"], df["Volume"]):
        if c != c or v != v:  # skip NaN rows
            continue
        highs.append(float(h))
        lows.append(float(low))
        closes.append(float(c))
        volumes.append(float(v))
    return {"highs": highs, "lows": lows, "closes": closes, "volumes": volumes}


def build_technical(tickers: list[str], p: TechParams | None = None, workers: int = 8) -> dict:
    from concurrent.futures import ThreadPoolExecutor, as_completed

    p = p or TechParams()

    def one(t: str) -> tuple[str, dict | None]:
        try:
            bars = _fetch_bars(t)
            return t, (compute_ticker(bars, p) if bars else None)
        except Exception:  # noqa: BLE001
            return t, None

    out: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futures = [ex.submit(one, t) for t in tickers]
        for i, fut in enumerate(as_completed(futures), 1):
            t, res = fut.result()
            if res:
                out[t] = res
            if i % 40 == 0:
                logger.info("  %d/%d…", i, len(tickers))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Compute price-volume attention + technical gauge (yfinance)")
    ap.add_argument("--config", default=None)
    ap.add_argument("--tickers", default=None, help="comma-separated override (e.g. FORM,IREN)")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s | %(message)s")

    settings = load_settings(args.config)
    if args.tickers:
        tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    else:
        tickers = seed_tickers(settings.output_dir)
    if not tickers:
        logger.warning("no tickers (run the SA scrape first, or pass --tickers)")
        return 1

    logger.info("computing technicals for %d tickers…", len(tickers))
    tech = build_technical(tickers)
    out_path = settings.output_dir / TECHNICAL_FILE

    if not tech:
        if out_path.exists():
            logger.warning("computed 0 technicals (network?); keeping existing file")
        else:
            logger.warning(
                "computed 0 technicals and no existing file — is Yahoo reachable? "
                "try: HTTPS_PROXY=http://127.0.0.1:<port> python -m newsagg.technical"
            )
        return 1

    # Tickers we ACTUALLY tried this run but got nothing for = confirmed no-data
    # (OTC / foreign ADRs). The dashboard hides only these — a newly-added seed
    # that simply hasn't been fetched yet is NOT in this list, so it still shows.
    no_data = sorted(set(tickers) - set(tech.keys()))
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "tickers": tech,
        "no_data": no_data,
    }
    settings.output_dir.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload))
    logger.info("wrote technicals for %d/%d tickers", len(tech), len(tickers))
    print(f"technicals: {len(tech)}/{len(tickers)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
