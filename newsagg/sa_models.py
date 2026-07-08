"""Data models for the SeekingAlpha scraper (top analysts + tech widgets).

Separate from ``models.py`` (the RSS/LLM pipeline) because this is a distinct
data shape driving the live tracking page: analyst leaderboard, their Buy /
Strong Buy calls, and the homepage tech-sector ticker widgets.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


# Ratings we care about — the user wants Buy / Strong Buy only.
BULLISH_RATINGS = {"buy", "strong buy"}


@dataclass(slots=True)
class AnalystProfile:
    """A row from the Top Performing Analysts leaderboard."""

    name: str
    profile_url: str
    rank: int | None = None
    # Free-form stats as SA labels them (avg return, success rate, etc.).
    stats: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(slots=True)
class AnalystPick:
    """A Buy / Strong Buy article by a tracked analyst."""

    analyst: str
    profile_url: str
    ticker: str
    rating: str  # "Buy" | "Strong Buy"
    article_title: str = ""
    article_url: str = ""
    published: datetime | None = None
    rank: int | None = None  # analyst's leaderboard rank, denormalized for display

    @property
    def is_bullish(self) -> bool:
        return self.rating.strip().lower() in BULLISH_RATINGS

    def to_dict(self) -> dict:
        d = asdict(self)
        d["published"] = _iso(self.published)
        d["is_bullish"] = self.is_bullish
        return d


@dataclass(slots=True)
class TechTicker:
    """A ticker pulled from a homepage tech-sector widget."""

    ticker: str
    name: str | None = None
    # "quant" (Latest Quant Ratings) or "analyst" (Latest Analyst Coverage).
    widget: str = "quant"
    rating: str | None = None  # e.g. "Strong Buy", "Hold" as shown in the widget

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class SAScrapeResult:
    """Everything one scrape run produces — this is what the web page reads."""

    generated_at: datetime
    top_analysts: list[AnalystProfile] = field(default_factory=list)
    analyst_picks: list[AnalystPick] = field(default_factory=list)
    tech_quant_tickers: list[TechTicker] = field(default_factory=list)
    tech_analyst_tickers: list[TechTicker] = field(default_factory=list)
    # Named homepage stock baskets (SA "key comparisons"): list of
    # {"name": str, "tickers": [{"ticker": str, "company": str}]}.
    homepage_comparisons: list[dict] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "generated_at": _iso(self.generated_at),
            "top_analysts": [a.to_dict() for a in self.top_analysts],
            "analyst_picks": [p.to_dict() for p in self.analyst_picks],
            "tech_quant_tickers": [t.to_dict() for t in self.tech_quant_tickers],
            "tech_analyst_tickers": [t.to_dict() for t in self.tech_analyst_tickers],
            "homepage_comparisons": self.homepage_comparisons,
            "errors": self.errors,
            "counts": {
                "top_analysts": len(self.top_analysts),
                "analyst_picks": len(self.analyst_picks),
                "tech_quant_tickers": len(self.tech_quant_tickers),
                "tech_analyst_tickers": len(self.tech_analyst_tickers),
                "homepage_comparisons": len(self.homepage_comparisons),
            },
        }
