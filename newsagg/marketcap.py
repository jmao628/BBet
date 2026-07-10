"""Fetch real market caps for the seed universe via yfinance, so cap-size
gating (big caps bypass heat) uses actual market cap instead of SA's
inconsistent cap-group labels.

Writes ``data/newsagg/marketcaps.json`` = {ticker: market_cap_usd}.

    python -m newsagg.marketcap
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

from newsagg.config import load_settings

logger = logging.getLogger("newsagg.marketcap")

MARKETCAP_FILE = "marketcaps.json"


def seed_tickers(output_dir: Path) -> list[str]:
    """All tickers currently in the SA seed snapshot."""
    path = output_dir / "seekingalpha_latest.json"
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text())
    except ValueError:
        return []
    tickers: set[str] = set()
    for w in data.get("home_widgets", []):
        for g in w.get("groups", []):
            for r in g.get("rows", []):
                t = (r.get("ticker") or "").strip().upper()
                if t:
                    tickers.add(t)
    return sorted(tickers)


def _market_cap(tk) -> int | None:
    # fast_info is cheap and version-tolerant; fall back to full info.
    try:
        fi = tk.fast_info
        mc = getattr(fi, "market_cap", None)
        if mc is None:
            try:
                mc = fi["marketCap"]
            except Exception:  # noqa: BLE001
                mc = None
        if mc:
            return int(mc)
    except Exception:  # noqa: BLE001
        pass
    try:
        mc = tk.info.get("marketCap")
        return int(mc) if mc else None
    except Exception:  # noqa: BLE001
        return None


def fetch_caps(tickers: list[str]) -> dict[str, int]:
    import yfinance as yf

    caps: dict[str, int] = {}
    for t in tickers:
        # yfinance uses '-' for share classes (BRK.B -> BRK-B).
        mc = _market_cap(yf.Ticker(t.replace(".", "-")))
        if mc:
            caps[t] = mc
    return caps


def main() -> int:
    p = argparse.ArgumentParser(description="Fetch seed-universe market caps (yfinance)")
    p.add_argument("--config", default=None)
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s | %(message)s")

    settings = load_settings(args.config)
    tickers = seed_tickers(settings.output_dir)
    if not tickers:
        logger.warning("no seed tickers found (run the SA scrape first)")
        return 1
    logger.info("fetching market caps for %d tickers…", len(tickers))
    caps = fetch_caps(tickers)
    settings.output_dir.mkdir(parents=True, exist_ok=True)
    (settings.output_dir / MARKETCAP_FILE).write_text(json.dumps(caps))
    logger.info("wrote %d/%d market caps", len(caps), len(tickers))
    print(f"market caps: {len(caps)}/{len(tickers)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
