"""
Kalshi API client — basketball market ingestion.
Docs: https://trading-api.readme.io/reference/getting-started
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import httpx
import structlog

from src.config import cfg, settings

log = structlog.get_logger(__name__)

BASE_URL = cfg["platforms"]["kalshi"]["base_url"]
BASKETBALL_KEYWORDS: list[str] = cfg["basketball_keywords"]
FEE_PCT: float = cfg["platforms"]["kalshi"]["fee_pct"]

HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json",
}


class KalshiClient:
    """
    Async client for Kalshi Trade API v2.
    All methods return raw dicts; ETL layer handles transformation.
    """

    def __init__(self) -> None:
        self._api_key = settings.kalshi_api_key
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "KalshiClient":
        self._client = httpx.AsyncClient(
            base_url=BASE_URL,
            headers={**HEADERS, "Authorization": f"Token {self._api_key}"},
            timeout=30.0,
        )
        return self

    async def __aexit__(self, *args: Any) -> None:
        if self._client:
            await self._client.aclose()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _get(
        self,
        path: str,
        params: dict[str, Any] | None = None,
        retries: int = 3,
    ) -> dict[str, Any]:
        assert self._client is not None, "Must be used as async context manager"
        for attempt in range(retries):
            try:
                resp = await self._client.get(path, params=params)
                resp.raise_for_status()
                return resp.json()
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 429:
                    wait = 2 ** attempt
                    log.warning("rate_limited", path=path, retry_in=wait)
                    await asyncio.sleep(wait)
                elif exc.response.status_code >= 500:
                    wait = 2 ** attempt
                    log.warning("server_error", status=exc.response.status_code, retry_in=wait)
                    await asyncio.sleep(wait)
                else:
                    log.error("http_error", status=exc.response.status_code, path=path)
                    raise
        raise RuntimeError(f"Failed after {retries} retries: {path}")

    # ------------------------------------------------------------------
    # Market discovery
    # ------------------------------------------------------------------

    async def get_all_markets(
        self,
        status: str = "open",
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        """Paginate through all markets with given status."""
        markets: list[dict] = []
        cursor: str | None = None

        while True:
            params: dict[str, Any] = {
                "limit": limit,
                "status": status,
            }
            if cursor:
                params["cursor"] = cursor

            data = await self._get("/markets", params=params)
            batch = data.get("markets", [])
            markets.extend(batch)
            cursor = data.get("cursor")
            if not cursor or len(batch) < limit:
                break

        return markets

    async def get_basketball_markets(
        self, status: str = "open"
    ) -> list[dict[str, Any]]:
        """Filter all markets to basketball-related ones."""
        all_markets = await self.get_all_markets(status=status)
        return [m for m in all_markets if self._is_basketball(m)]

    @staticmethod
    def _is_basketball(market: dict[str, Any]) -> bool:
        title = (market.get("title") or "").upper()
        subtitle = (market.get("subtitle") or "").upper()
        category = (market.get("category") or "").lower()
        series = (market.get("series_ticker") or "").upper()

        if category in ("nba", "basketball", "sports"):
            return True
        combined = f"{title} {subtitle} {series}"
        return any(kw.upper() in combined for kw in BASKETBALL_KEYWORDS)

    # ------------------------------------------------------------------
    # Market data
    # ------------------------------------------------------------------

    async def get_market(self, ticker: str) -> dict[str, Any]:
        return await self._get(f"/markets/{ticker}")

    async def get_market_price(self, ticker: str) -> dict[str, Any]:
        """Returns yes_bid, yes_ask, last_price, volume."""
        data = await self.get_market(ticker)
        market = data.get("market", data)
        return {
            "ticker": ticker,
            "yes_bid": market.get("yes_bid", 0) / 100,
            "yes_ask": market.get("yes_ask", 100) / 100,
            "yes_mid": (market.get("yes_bid", 0) + market.get("yes_ask", 100)) / 200,
            "no_bid": 1 - market.get("yes_ask", 100) / 100,
            "no_ask": 1 - market.get("yes_bid", 0) / 100,
            "spread": (market.get("yes_ask", 100) - market.get("yes_bid", 0)) / 100,
            "last_price": market.get("last_price", 0) / 100 if market.get("last_price") else None,
            "volume": market.get("volume", 0),
            "open_interest": market.get("open_interest", 0),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

    async def get_orderbook(self, ticker: str, depth: int = 10) -> dict[str, Any]:
        """Get order book snapshot."""
        data = await self._get(f"/markets/{ticker}/orderbook", params={"depth": depth})
        ob = data.get("orderbook", {})

        def parse_levels(levels: list[list]) -> list[dict]:
            """Kalshi returns [[price_cents, size], ...]"""
            return [{"price": lvl[0] / 100, "size": lvl[1]} for lvl in (levels or [])]

        yes_bids = parse_levels(ob.get("yes", []))
        yes_asks = parse_levels(ob.get("no", []))  # NO asks = YES asks from other side

        def depth_within(levels: list[dict], ref: float, cents: float) -> float:
            return sum(l["size"] for l in levels if abs(l["price"] - ref) <= cents / 100)

        best_bid = yes_bids[0]["price"] if yes_bids else 0.0
        best_ask = yes_asks[0]["price"] if yes_asks else 1.0
        bid_d3 = depth_within(yes_bids, best_bid, 3)
        ask_d3 = depth_within(yes_asks, best_ask, 3)
        total_d3 = bid_d3 + ask_d3

        return {
            "ticker": ticker,
            "snapshot_time": datetime.now(timezone.utc).isoformat(),
            "yes_bids": yes_bids,
            "yes_asks": yes_asks,
            "best_bid": best_bid,
            "best_ask": best_ask,
            "depth_3c_bid": bid_d3,
            "depth_3c_ask": ask_d3,
            "depth_5c_bid": depth_within(yes_bids, best_bid, 5),
            "depth_5c_ask": depth_within(yes_asks, best_ask, 5),
            "imbalance": (bid_d3 - ask_d3) / total_d3 if total_d3 > 0 else 0.0,
        }

    async def get_price_history(
        self,
        ticker: str,
        period_interval: int = 60,  # minutes
    ) -> list[dict[str, Any]]:
        """Historical price data for a market (for backtesting)."""
        data = await self._get(
            f"/markets/{ticker}/history",
            params={"period_interval": period_interval},
        )
        history = data.get("history", [])
        return [
            {
                "ts": entry.get("ts"),
                "yes_bid": entry.get("yes_bid", 0) / 100,
                "yes_ask": entry.get("yes_ask", 100) / 100,
                "yes_mid": (entry.get("yes_bid", 0) + entry.get("yes_ask", 100)) / 200,
            }
            for entry in history
        ]

    async def get_finalized_markets(
        self, limit: int = 200
    ) -> list[dict[str, Any]]:
        """Get resolved markets for backtesting."""
        return await self.get_basketball_markets(status="finalized")

    # ------------------------------------------------------------------
    # Batch fetch all basketball market prices
    # ------------------------------------------------------------------

    async def fetch_all_basketball_quotes(
        self,
        concurrency: int = 10,
    ) -> list[dict[str, Any]]:
        """Fetch current quotes for all open basketball markets."""
        markets = await self.get_basketball_markets()
        tickers = [m["ticker"] for m in markets]

        sem = asyncio.Semaphore(concurrency)

        async def fetch_one(ticker: str) -> dict | None:
            async with sem:
                try:
                    return await self.get_market_price(ticker)
                except Exception as exc:
                    log.warning("quote_fetch_failed", ticker=ticker, error=str(exc))
                    return None

        results = await asyncio.gather(*[fetch_one(t) for t in tickers])
        return [r for r in results if r is not None]
