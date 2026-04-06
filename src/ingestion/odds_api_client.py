"""
The Odds API client — sportsbook moneyline, spread, totals ingestion.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

import httpx
import structlog

from src.config import cfg, settings
from src.etl.odds_transformer import OddsLine, ProbabilityLine, process_odds_line, compute_consensus_novig_prob

log = structlog.get_logger(__name__)

BASE_URL = cfg["platforms"]["odds_api"]["base_url"]
SPORT_KEY = cfg["platforms"]["odds_api"]["sport_key"]
SPORTSBOOKS_PRIORITY: list[str] = cfg["sportsbooks_priority"]


class OddsAPIClient:
    """
    Async client for The Odds API v4.
    Returns structured probability lines ready for DB ingestion.
    """

    def __init__(self) -> None:
        self._api_key = settings.odds_api_key
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "OddsAPIClient":
        self._client = httpx.AsyncClient(
            base_url=BASE_URL,
            timeout=30.0,
        )
        return self

    async def __aexit__(self, *args: Any) -> None:
        if self._client:
            await self._client.aclose()

    async def _get(self, path: str, params: dict) -> Any:
        assert self._client is not None
        params["apiKey"] = self._api_key
        for attempt in range(4):
            try:
                resp = await self._client.get(path, params=params)
                resp.raise_for_status()
                log.debug(
                    "odds_api_request",
                    remaining=resp.headers.get("x-requests-remaining"),
                )
                return resp.json()
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 429:
                    await asyncio.sleep(2 ** attempt)
                else:
                    raise

    # ------------------------------------------------------------------
    # Fetch current NBA odds
    # ------------------------------------------------------------------

    async def get_nba_odds(
        self,
        markets: str = "h2h",
        regions: str = "us",
        odds_format: str = "american",
    ) -> list[dict[str, Any]]:
        """
        Returns raw response from The Odds API.
        Each element = one game with all bookmakers.
        """
        data = await self._get(
            f"/sports/{SPORT_KEY}/odds",
            params={
                "regions": regions,
                "markets": markets,
                "oddsFormat": odds_format,
            },
        )
        return data or []

    async def get_historical_odds(
        self,
        snapshot_date: str,  # ISO 8601, e.g. "2025-01-15T18:00:00Z"
        markets: str = "h2h",
    ) -> list[dict[str, Any]]:
        """Fetch historical odds snapshot (for backtesting)."""
        data = await self._get(
            f"/sports/{SPORT_KEY}/odds-history",
            params={
                "date": snapshot_date,
                "regions": "us",
                "markets": markets,
                "oddsFormat": "american",
            },
        )
        return (data or {}).get("data", [])

    # ------------------------------------------------------------------
    # Transformation layer
    # ------------------------------------------------------------------

    def transform_game_odds(
        self, game_data: dict[str, Any]
    ) -> dict[str, Any]:
        """
        Transform The Odds API game record into structured probability record.
        """
        home_team = game_data["home_team"]
        away_team = game_data["away_team"]
        commence_time = game_data["commence_time"]

        raw_lines: list[OddsLine] = []

        for bookmaker in game_data.get("bookmakers", []):
            book_key = bookmaker["key"]
            for market in bookmaker.get("markets", []):
                if market["key"] != "h2h":
                    continue
                outcomes = {o["name"]: o["price"] for o in market["outcomes"]}
                home_price = outcomes.get(home_team)
                away_price = outcomes.get(away_team)
                if home_price and away_price:
                    raw_lines.append(
                        OddsLine(
                            sportsbook=book_key,
                            home_ml=int(home_price),
                            away_ml=int(away_price),
                        )
                    )

        prob_lines: list[ProbabilityLine] = [process_odds_line(l) for l in raw_lines]

        # Pinnacle line (most trusted)
        pinnacle_line = next(
            (pl for pl in prob_lines if pl.sportsbook == "pinnacle"), None
        )

        # Weighted consensus
        home_consensus, away_consensus = compute_consensus_novig_prob(prob_lines)

        return {
            "game_id": self._build_game_id(home_team, away_team, commence_time),
            "commence_time": commence_time,
            "home_team": home_team,
            "away_team": away_team,
            "pinnacle_home_novig": pinnacle_line.home_novig_prob if pinnacle_line else None,
            "pinnacle_away_novig": pinnacle_line.away_novig_prob if pinnacle_line else None,
            "consensus_home_novig": home_consensus,
            "consensus_away_novig": away_consensus,
            "raw_lines": [
                {
                    "sportsbook": pl.sportsbook,
                    "home_ml": raw_lines[i].home_ml,
                    "away_ml": raw_lines[i].away_ml,
                    "home_novig": pl.home_novig_prob,
                    "away_novig": pl.away_novig_prob,
                    "vig_pct": pl.vig_pct,
                }
                for i, pl in enumerate(prob_lines)
            ],
            "n_books": len(raw_lines),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

    @staticmethod
    def _build_game_id(home: str, away: str, commence_time: str) -> str:
        """
        Build provisional game_id from Odds API data.
        Will be matched to canonical game_id in ETL.
        """
        dt = datetime.fromisoformat(commence_time.replace("Z", "+00:00"))
        date_str = dt.strftime("%Y%m%d")
        # Abbreviate team names (simplified — full mapping in ETL)
        home_abbr = home.split()[-1][:3].upper()
        away_abbr = away.split()[-1][:3].upper()
        return f"NBA_{date_str}_{away_abbr}_{home_abbr}"

    async def fetch_and_transform_nba_odds(self) -> list[dict[str, Any]]:
        """Convenience: fetch + transform all current NBA odds."""
        raw = await self.get_nba_odds()
        return [self.transform_game_odds(g) for g in raw]
