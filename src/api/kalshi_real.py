"""
Real Kalshi API client with RSA-PSS authentication.
Connects to demo or production Kalshi Trade API v2.
"""

from __future__ import annotations

import base64
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

# ── Configuration ────────────────────────────────────────────────────

KALSHI_API_KEY = "5ce679c0-46dd-42c6-8f46-4311f8321034"
KALSHI_KEY_FILE = Path(__file__).parent.parent.parent / "config" / "kalshi-key.pem"
KALSHI_BASE_URL = "https://trading-api.kalshi.com"  # production environment

BASKETBALL_KEYWORDS = [
    "NBA", "basketball", "Lakers", "Warriors", "Celtics", "Bucks",
    "Heat", "Nuggets", "Knicks", "Nets", "Suns", "Clippers",
    "76ers", "Bulls", "Pistons", "Pacers", "Cavaliers", "Hornets",
    "Magic", "Raptors", "Hawks", "Wizards", "Thunder", "Timberwolves",
    "Rockets", "Grizzlies", "Pelicans", "Kings", "Spurs", "Blazers",
    "Jazz", "Mavericks", "Finals", "playoff", "Conference",
]


# ── RSA Signing ──────────────────────────────────────────────────────

def _load_private_key() -> rsa.RSAPrivateKey:
    with open(KALSHI_KEY_FILE, "rb") as f:
        return serialization.load_pem_private_key(
            f.read(), password=None, backend=default_backend()
        )


def _sign(private_key: rsa.RSAPrivateKey, message: str) -> str:
    signature = private_key.sign(
        message.encode("utf-8"),
        padding.PSS(
            mgf=padding.MGF1(hashes.SHA256()),
            salt_length=padding.PSS.DIGEST_LENGTH,
        ),
        hashes.SHA256(),
    )
    return base64.b64encode(signature).decode("utf-8")


def _auth_headers(method: str, path: str) -> dict[str, str]:
    """Generate signed authentication headers for a Kalshi API request."""
    ts_ms = str(int(time.time() * 1000))
    # Strip query params for signing
    path_clean = path.split("?")[0]
    msg = ts_ms + method + path_clean
    private_key = _load_private_key()
    sig = _sign(private_key, msg)
    return {
        "KALSHI-ACCESS-KEY": KALSHI_API_KEY,
        "KALSHI-ACCESS-SIGNATURE": sig,
        "KALSHI-ACCESS-TIMESTAMP": ts_ms,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


# ── API Client ───────────────────────────────────────────────────────

class KalshiRealClient:
    """Async client for Kalshi Trade API v2 with RSA auth."""

    def __init__(self, base_url: str = KALSHI_BASE_URL):
        self.base_url = base_url

    async def _request(
        self, method: str, path: str, params: dict | None = None, json_body: dict | None = None
    ) -> dict[str, Any]:
        headers = _auth_headers(method.upper(), path)
        async with httpx.AsyncClient(base_url=self.base_url, timeout=15.0) as client:
            if method.upper() == "GET":
                resp = await client.get(path, params=params, headers=headers)
            elif method.upper() == "POST":
                resp = await client.post(path, json=json_body, headers=headers)
            else:
                resp = await client.request(method.upper(), path, headers=headers)

            resp.raise_for_status()
            return resp.json()

    # ── Account ──────────────────────────────────────────────────────

    async def get_balance(self) -> dict[str, Any]:
        """Get account balance. Returns {balance: cents, payout: cents}."""
        return await self._request("GET", "/trade-api/v2/portfolio/balance")

    async def get_positions(self) -> list[dict[str, Any]]:
        """Get all open positions."""
        data = await self._request("GET", "/trade-api/v2/portfolio/positions")
        return data.get("market_positions", [])

    async def get_portfolio_history(self) -> dict[str, Any]:
        """Get portfolio value history."""
        return await self._request("GET", "/trade-api/v2/portfolio/settlements")

    async def get_fills(self, limit: int = 100) -> list[dict[str, Any]]:
        """Get recent trade fills."""
        data = await self._request("GET", "/trade-api/v2/portfolio/fills", params={"limit": limit})
        return data.get("fills", [])

    # ── Markets ──────────────────────────────────────────────────────

    async def get_events(self, status: str = "open", category: str = "") -> list[dict[str, Any]]:
        """Get events (groups of markets)."""
        params: dict[str, Any] = {"limit": 200, "status": status}
        if category:
            params["series_ticker"] = category
        data = await self._request("GET", "/trade-api/v2/events", params=params)
        return data.get("events", [])

    async def get_markets(
        self, status: str = "open", limit: int = 200, cursor: str | None = None,
        event_ticker: str | None = None,
    ) -> dict[str, Any]:
        """Get markets with pagination."""
        params: dict[str, Any] = {"limit": limit, "status": status}
        if cursor:
            params["cursor"] = cursor
        if event_ticker:
            params["event_ticker"] = event_ticker
        return await self._request("GET", "/trade-api/v2/markets", params=params)

    async def get_market(self, ticker: str) -> dict[str, Any]:
        """Get a single market by ticker."""
        data = await self._request("GET", f"/trade-api/v2/markets/{ticker}")
        return data.get("market", data)

    async def get_orderbook(self, ticker: str, depth: int = 10) -> dict[str, Any]:
        """Get order book for a market."""
        return await self._request(
            "GET", f"/trade-api/v2/markets/{ticker}/orderbook",
            params={"depth": depth},
        )

    async def get_market_history(
        self, ticker: str, limit: int = 100, min_ts: int | None = None,
    ) -> list[dict[str, Any]]:
        """Get trade/price history for a market."""
        params: dict[str, Any] = {"limit": limit}
        if min_ts:
            params["min_ts"] = min_ts
        data = await self._request(
            "GET", f"/trade-api/v2/markets/{ticker}/history", params=params,
        )
        return data.get("history", [])

    # ── Basketball-specific ──────────────────────────────────────────

    async def get_all_basketball_markets(self) -> list[dict[str, Any]]:
        """Fetch all open basketball-related markets."""
        all_markets: list[dict] = []
        cursor: str | None = None

        for _ in range(10):  # max pages
            data = await self.get_markets(status="open", limit=200, cursor=cursor)
            batch = data.get("markets", [])

            for m in batch:
                if self._is_basketball(m):
                    all_markets.append(m)

            cursor = data.get("cursor")
            if not cursor or len(batch) < 200:
                break

        return all_markets

    @staticmethod
    def _is_basketball(market: dict) -> bool:
        title = (market.get("title") or "").upper()
        subtitle = (market.get("subtitle") or "").upper()
        event_ticker = (market.get("event_ticker") or "").upper()
        category = (market.get("category") or "").upper()
        combined = f"{title} {subtitle} {event_ticker} {category}"

        # Filter out multi-sport parlays
        if title.count(",") > 2:
            return False

        return any(kw.upper() in combined for kw in BASKETBALL_KEYWORDS)

    # ── Convenience ──────────────────────────────────────────────────

    async def get_market_snapshot(self, ticker: str) -> dict[str, Any]:
        """Get current price + orderbook for a market."""
        market = await self.get_market(ticker)
        yes_bid = (market.get("yes_bid") or 0) / 100
        yes_ask = (market.get("yes_ask") or 100) / 100

        return {
            "ticker": ticker,
            "title": market.get("title", ""),
            "subtitle": market.get("subtitle", ""),
            "status": market.get("status", ""),
            "yes_bid": yes_bid,
            "yes_ask": yes_ask,
            "yes_mid": (yes_bid + yes_ask) / 2,
            "spread": yes_ask - yes_bid,
            "last_price": (market.get("last_price") or 0) / 100,
            "volume": market.get("volume", 0),
            "open_interest": market.get("open_interest", 0),
            "close_time": market.get("close_time"),
            "expiration_time": market.get("expiration_time"),
        }
