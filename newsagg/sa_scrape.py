"""SeekingAlpha scraper — top analysts, their Buy/Strong Buy calls, and the
homepage tech-sector ticker widgets.

These SA pages are JS-rendered and personalized behind a paywall, so plain HTTP
won't cut it. We drive a real headless browser (Playwright) with your login
cookie, read the rendered DOM, and *also* capture the JSON the page fetches from
SA's internal API (robust to markup churn).

Because SA changes its markup often and this can't be tested without live
access, every run writes recon artifacts to ``data/newsagg/sa_debug/``:
screenshots, rendered HTML, and every ``/api/`` JSON response. If extraction
comes back empty, those artifacts are how we lock in exact selectors.

Usage:
    python -m newsagg.sa_scrape                 # one scrape -> JSON + debug
    python -m newsagg.sa_scrape --recon         # capture artifacts only
    python -m newsagg.sa_scrape --watch 15      # re-scrape every 15 minutes
    python -m newsagg.sa_scrape --headed        # show the browser (debugging)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path

from newsagg.config import Settings, load_settings
from newsagg.sa_models import (
    AnalystPick,
    AnalystProfile,
    SAScrapeResult,
    TechTicker,
)

logger = logging.getLogger("newsagg.sa_scrape")

TOP_ANALYSTS_URL = "https://seekingalpha.com/top-performing-analysts"
HOME_URL = "https://seekingalpha.com/"

# Homepage widget headings we want tickers from (matched case-insensitively).
QUANT_WIDGET_HEADING = "latest quant ratings"
ANALYST_WIDGET_HEADING = "latest analyst coverage"

_TICKER_HREF = re.compile(r"/symbol/([A-Z][A-Z.\-]{0,6})\b")
_AUTHOR_HREF = re.compile(r"/author/([a-z0-9\-]+)")


def parse_key_comparisons(captures: list[tuple[str, dict]]) -> list[dict]:
    """Parse SA's homepage ``key_comparisons`` API response into named baskets.

    The response is JSON:API: ``data`` holds each comparison (name + ticker id
    refs), ``included`` holds the ticker objects. We resolve the refs to real
    symbols + company names. Returns [{"name", "tickers": [{ticker, company}]}].
    """
    for url, body in captures:
        if "key_comparisons?" not in url or not isinstance(body, dict):
            continue
        included = {
            (i.get("type"), i.get("id")): i for i in body.get("included", []) if isinstance(i, dict)
        }
        baskets: list[dict] = []
        for item in body.get("data", []):
            name = (item.get("attributes") or {}).get("name")
            refs = (item.get("relationships") or {}).get("tickers", {}).get("data", [])
            tickers = []
            for ref in refs:
                inc = included.get(("ticker", ref.get("id")))
                if not inc:
                    continue
                attrs = inc.get("attributes") or {}
                sym = attrs.get("name")
                if sym:
                    tickers.append({"ticker": sym, "company": attrs.get("companyName")})
            if name and tickers:
                baskets.append({"name": name, "tickers": tickers})
        return baskets
    return []


# --------------------------------------------------------------------------
# cookie handling
# --------------------------------------------------------------------------
def parse_cookie_header(cookie: str) -> list[dict]:
    """Turn a raw ``Cookie:`` header string into Playwright cookie dicts."""
    cookies: list[dict] = []
    for part in cookie.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        name, _, value = part.partition("=")
        cookies.append(
            {
                "name": name.strip(),
                "value": value.strip(),
                "domain": ".seekingalpha.com",
                "path": "/",
            }
        )
    return cookies


# --------------------------------------------------------------------------
# scraper
# --------------------------------------------------------------------------
class SeekingAlphaScraper:
    def __init__(self, settings: Settings, *, headed: bool = False, recon: bool = False) -> None:
        self.settings = settings
        self.headed = headed
        self.recon = recon
        self.debug_dir = settings.output_dir / "sa_debug"
        self._api_captures: list[tuple[str, dict]] = []

    async def run(self) -> SAScrapeResult:
        from playwright.async_api import async_playwright

        result = SAScrapeResult(generated_at=datetime.now(timezone.utc))
        self.debug_dir.mkdir(parents=True, exist_ok=True)

        from newsagg.sa_browser import (
            COOKIE_FILE,
            import_cookie_file,
            launch_context,
            profile_dir,
        )

        async with async_playwright() as pw:
            from pathlib import Path

            context = await launch_context(pw, self.settings, headless=not self.headed)

            # Auth, most-preferred first:
            # 1) cookie export file (sa_cookies.json) — the reliable path,
            # 2) persistent profile from a prior manual sa_login,
            # 3) a raw SA_COOKIE header.
            imported = await import_cookie_file(context, self.settings)
            profile_ok = Path(profile_dir(self.settings)).joinpath("Default").exists()
            cookie = self.settings.seekingalpha.cookie
            if not imported and not profile_ok and cookie:
                try:
                    await context.add_cookies(parse_cookie_header(cookie))
                except Exception:  # noqa: BLE001
                    pass
            elif not imported and not profile_ok and not cookie:
                logger.warning(
                    "no auth found — drop a Cookie-Editor export at %s "
                    "(see README) for paywalled/personalized data",
                    self.settings.output_dir / COOKIE_FILE,
                )

            page = context.pages[0] if context.pages else await context.new_page()
            page.on("response", self._on_response)

            try:
                await self._scrape_homepage(page, result)
                await self._scrape_top_analysts(page, result)
            except Exception as exc:  # noqa: BLE001 — keep whatever we got
                logger.exception("scrape error")
                result.errors.append(str(exc))
            finally:
                self._dump_api_captures()
                await context.close()

        return result

    # --- network capture ----------------------------------------------------
    def _on_response(self, response) -> None:
        url = response.url
        if "/api/" not in url:
            return

        async def grab() -> None:
            try:
                if "json" not in (response.headers.get("content-type") or ""):
                    return
                data = await response.json()
                self._api_captures.append((url, data))
            except Exception:  # noqa: BLE001
                pass

        # response handlers must not await inline; schedule it.
        asyncio.ensure_future(grab())

    def _dump_api_captures(self) -> None:
        if not self._api_captures:
            return
        out = self.debug_dir / "api_captures.json"
        payload = [{"url": u, "body": b} for u, b in self._api_captures]
        out.write_text(json.dumps(payload, ensure_ascii=False, indent=2)[:5_000_000])
        logger.info("saved %d API captures -> %s", len(self._api_captures), out)

    async def _save_debug(self, page, label: str) -> None:
        try:
            await page.screenshot(path=str(self.debug_dir / f"{label}.png"), full_page=True)
            (self.debug_dir / f"{label}.html").write_text(await page.content())
            logger.info("saved recon artifacts for %s", label)
        except Exception as exc:  # noqa: BLE001
            logger.warning("could not save debug for %s: %s", label, exc)

    # --- homepage tech widgets ---------------------------------------------
    async def _scrape_homepage(self, page, result: SAScrapeResult) -> None:
        await page.goto(HOME_URL, wait_until="domcontentloaded", timeout=60_000)
        await _settle(page)
        # Let any in-flight API responses finish being captured before parsing.
        await page.wait_for_timeout(1500)
        await self._save_debug(page, "homepage")

        # Primary: parse the captured key_comparisons API (robust, structured).
        result.homepage_comparisons = parse_key_comparisons(self._api_captures)

        # Secondary: the two named widgets, via DOM (may be logged-in only).
        result.tech_quant_tickers = await self._extract_widget_tickers(
            page, QUANT_WIDGET_HEADING, "quant"
        )
        result.tech_analyst_tickers = await self._extract_widget_tickers(
            page, ANALYST_WIDGET_HEADING, "analyst"
        )
        logger.info(
            "homepage: %d comparison baskets, %d quant tickers, %d analyst tickers",
            len(result.homepage_comparisons),
            len(result.tech_quant_tickers),
            len(result.tech_analyst_tickers),
        )

    async def _extract_widget_tickers(self, page, heading: str, widget: str) -> list[TechTicker]:
        """Find the widget by its heading text, then pull ticker links near it."""
        # Locate the heading, walk up to its section, collect /symbol/ links.
        js = """
        (headingText) => {
          const norm = s => (s || '').trim().toLowerCase();
          const heads = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,div,span'));
          const head = heads.find(el => norm(el.textContent).includes(headingText));
          if (!head) return [];
          // climb a few levels to the widget container
          let box = head;
          for (let i = 0; i < 5 && box.parentElement; i++) box = box.parentElement;
          const seen = new Set();
          const out = [];
          box.querySelectorAll('a[href*="/symbol/"]').forEach(a => {
            const m = a.getAttribute('href').match(/\\/symbol\\/([A-Z][A-Z.\\-]{0,6})/);
            if (!m) return;
            const t = m[1];
            if (seen.has(t)) return;
            seen.add(t);
            const row = a.closest('tr,li,div');
            out.push({ticker: t, text: row ? row.innerText.replace(/\\n/g,' ').trim() : ''});
          });
          return out;
        }
        """
        try:
            rows = await page.evaluate(js, heading)
        except Exception as exc:  # noqa: BLE001
            logger.warning("widget '%s' extraction failed: %s", heading, exc)
            return []
        out: list[TechTicker] = []
        for r in rows[:40]:
            out.append(
                TechTicker(
                    ticker=r["ticker"],
                    widget=widget,
                    rating=_first_rating(r.get("text", "")),
                )
            )
        return out

    # --- top analysts + their picks ----------------------------------------
    async def _scrape_top_analysts(self, page, result: SAScrapeResult) -> None:
        await page.goto(TOP_ANALYSTS_URL, wait_until="domcontentloaded", timeout=60_000)
        await _settle(page)
        await self._save_debug(page, "top_analysts")

        result.top_analysts = await self._extract_analysts(page)
        logger.info("top analysts: found %d", len(result.top_analysts))

        if self.recon:
            return

        top_n = self.settings.seekingalpha.top_n_analysts
        for analyst in result.top_analysts[:top_n]:
            try:
                picks = await self._extract_analyst_picks(page, analyst)
                result.analyst_picks.extend(picks)
            except Exception as exc:  # noqa: BLE001
                logger.warning("picks for %s failed: %s", analyst.name, exc)
        logger.info("analyst picks (Buy/Strong Buy): %d", len(result.analyst_picks))

    async def _extract_analysts(self, page) -> list[AnalystProfile]:
        js = """
        () => {
          const seen = new Set();
          const out = [];
          document.querySelectorAll('a[href*="/author/"]').forEach(a => {
            const href = a.getAttribute('href');
            const m = href.match(/\\/author\\/([a-z0-9\\-]+)/);
            if (!m) return;
            const name = (a.textContent || '').trim();
            if (!name || seen.has(m[1])) return;
            seen.add(m[1]);
            const row = a.closest('tr,li,div');
            out.push({
              name,
              url: href.startsWith('http') ? href : 'https://seekingalpha.com' + href,
              rowText: row ? row.innerText.replace(/\\n/g,' | ').trim() : ''
            });
          });
          return out;
        }
        """
        try:
            rows = await page.evaluate(js)
        except Exception as exc:  # noqa: BLE001
            logger.warning("analyst extraction failed: %s", exc)
            return []
        out: list[AnalystProfile] = []
        for i, r in enumerate(rows, start=1):
            if len(r["name"]) < 2:
                continue
            out.append(
                AnalystProfile(
                    name=r["name"],
                    profile_url=r["url"],
                    rank=i,
                    stats={"row": r.get("rowText", "")},
                )
            )
        return out

    async def _extract_analyst_picks(self, page, analyst: AnalystProfile) -> list[AnalystPick]:
        """Open an analyst's articles and keep their Buy / Strong Buy calls.

        Best-effort and defensive: SA marks ratings inconsistently across
        layouts. Returns [] rather than raising so one bad profile doesn't sink
        the run — recon artifacts tell us how to tighten this.
        """
        articles_url = analyst.profile_url.rstrip("/") + "/analysis"
        await page.goto(articles_url, wait_until="domcontentloaded", timeout=45_000)
        await _settle(page, quiet_ms=1200)

        js = """
        () => {
          const out = [];
          document.querySelectorAll('article, [data-test-id="post-list-item"], li').forEach(card => {
            const link = card.querySelector('a[href*="/article/"], a[href*="/news/"]');
            if (!link) return;
            const title = (link.textContent || '').trim();
            const href = link.getAttribute('href') || '';
            const text = (card.innerText || '');
            const tick = text.match(/\\b([A-Z]{1,5})\\b/);
            const symLink = card.querySelector('a[href*="/symbol/"]');
            const symMatch = symLink ? (symLink.getAttribute('href').match(/\\/symbol\\/([A-Z.\\-]{1,7})/)) : null;
            const rating = (text.match(/strong buy|buy|hold|sell/i) || [null])[0];
            out.push({
              title, href,
              ticker: symMatch ? symMatch[1] : (tick ? tick[1] : ''),
              rating: rating || ''
            });
          });
          return out.slice(0, 25);
        }
        """
        try:
            rows = await page.evaluate(js)
        except Exception:  # noqa: BLE001
            return []

        picks: list[AnalystPick] = []
        for r in rows:
            rating = (r.get("rating") or "").strip()
            ticker = (r.get("ticker") or "").strip().upper()
            if not ticker or rating.lower() not in ("buy", "strong buy"):
                continue
            href = r.get("href", "")
            picks.append(
                AnalystPick(
                    analyst=analyst.name,
                    profile_url=analyst.profile_url,
                    ticker=ticker,
                    rating="Strong Buy" if rating.lower() == "strong buy" else "Buy",
                    article_title=r.get("title", ""),
                    article_url=href if href.startswith("http") else f"https://seekingalpha.com{href}",
                    rank=analyst.rank,
                )
            )
        return picks


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
async def _settle(page, quiet_ms: int = 800) -> None:
    """Give client-side rendering a moment; ignore networkidle timeouts."""
    try:
        await page.wait_for_load_state("networkidle", timeout=15_000)
    except Exception:  # noqa: BLE001
        pass
    await page.wait_for_timeout(quiet_ms)


def _first_rating(text: str) -> str | None:
    m = re.search(r"strong buy|buy|hold|sell", text, re.IGNORECASE)
    return m.group(0).title() if m else None


def write_result(result: SAScrapeResult, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    # The web page always reads this stable filename.
    latest = output_dir / "seekingalpha_latest.json"
    latest.write_text(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
    # Also keep a dated snapshot.
    day = result.generated_at.date().isoformat()
    (output_dir / f"seekingalpha_{day}.json").write_text(
        json.dumps(result.to_dict(), ensure_ascii=False, indent=2)
    )
    return latest


async def _run_once(settings: Settings, args: argparse.Namespace) -> SAScrapeResult:
    scraper = SeekingAlphaScraper(settings, headed=args.headed, recon=args.recon)
    result = await scraper.run()
    path = write_result(result, settings.output_dir)
    print("\n=== SeekingAlpha scrape ===")
    print(json.dumps(result.to_dict()["counts"], indent=2))
    if result.errors:
        print("errors:", result.errors)
    print(f"wrote: {path}")
    print(f"debug: {settings.output_dir / 'sa_debug'}")
    return result


async def _main(args: argparse.Namespace) -> int:
    settings = load_settings(args.config)
    if args.watch:
        logger.info("watch mode: scraping every %d min (Ctrl-C to stop)", args.watch)
        while True:
            await _run_once(settings, args)
            await asyncio.sleep(args.watch * 60)
    result = await _run_once(settings, args)
    return 0 if not result.errors else 1


def main() -> int:
    p = argparse.ArgumentParser(description="SeekingAlpha scraper")
    p.add_argument("--config", default=None)
    p.add_argument("--recon", action="store_true", help="capture debug artifacts only")
    p.add_argument("--headed", action="store_true", help="show the browser window")
    p.add_argument("--watch", type=int, metavar="MIN", help="re-scrape every MIN minutes")
    p.add_argument("--verbose", "-v", action="store_true")
    args = p.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )
    try:
        return asyncio.run(_main(args))
    except KeyboardInterrupt:
        print("\nstopped")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
