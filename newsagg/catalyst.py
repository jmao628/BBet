"""Stage 3 — Catalyst discovery (TPMN), per Focus-List ticker.

For each ticker we ask an LLM **with web search** to find UPCOMING, DATED,
SOURCED catalysts over the next ~6 months (earnings, product launches / FDA
decisions, contract wins, M&A, capital return, index adds, estimate-revision
cycles, …). The model is used strictly as a *cited extractor* — every catalyst
must carry a real ``source_url`` or it is dropped — so we don't rank on
hallucinated dates. The TPMN score is then computed **deterministically in
Python** from those facts:

    T — Trigger    : a typed, sourced catalyst exists at all (+ a type weight)
    P — Probability: chance it happens AND surprises up (de-rated by priced_in)
    M — Magnitude  : expected re-rating if it fires (est. % upside)
    N — Nearness   : how soon (dated near-term events beat vague far-off ones)

Provider: OpenAI (the user's gateway). It reads ``OPENAI_API_KEY`` (and, if the
gateway needs it, ``OPENAI_BASE_URL``) from the environment — never from code or
the repo. The gateway here requires streaming, so we stream and collect the
output text. No key / SDK → this step logs a warning and is skipped; the rest of
the pipeline is unaffected.

Like ``supplychain.py`` this is a **cached, incremental** fetch: only tickers
missing from ``data/newsagg/catalyst.json`` are looked up (unless --refresh).

Writes ``data/newsagg/catalyst.json`` =
    {ticker: {catalysts: [Catalyst], score, best_type, model, ok, generated_at}}

    OPENAI_API_KEY=... python -m newsagg.catalyst --limit 25
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import re
from datetime import date
from pathlib import Path

from newsagg.config import load_settings
from newsagg.supplychain import rated_seed_tickers

logger = logging.getLogger("newsagg.catalyst")

CATALYST_FILE = "catalyst.json"
MODEL = os.environ.get("OPENAI_MODEL", "gpt-5.5")

# At most this many catalysts kept per name (the strongest few).
MAX_CATALYSTS = 6

CATALYST_TYPES = (
    "earnings", "guidance", "approval", "order", "m_and_a",
    "capital_return", "policy", "index", "mgmt", "revision", "other",
)

# Score scale (per catalyst): total = T + P + M + N.
#   T  timing 0-25  — a peak curve on days-to-event (peaks at ~2 weeks)
#   P  probability 0-3, M  magnitude 0-3, N  narrative 0-2  (graded by the LLM)
# So a near-term, high-conviction, narrative-hot catalyst tops out near 33.


def _load(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except ValueError:
        return {}


def _prompt(ticker: str, name: str, sector: str = "") -> str:
    who = f"{ticker} ({name})" if name else ticker
    ctx = f" It is in the '{sector}' sector." if sector else ""
    return (
        f"You are an equity-research assistant. Using web search, find UPCOMING catalysts for the "
        f"US-listed company {who} over roughly the next 6 months that could re-rate the stock.{ctx}\n\n"
        "Return ONLY a JSON object (no prose, no markdown fences) of the form:\n"
        '{"ticker":"' + ticker + '","catalysts":[{'
        '"type":"earnings|guidance|approval|order|m_and_a|capital_return|policy|index|mgmt|revision|other",'
        '"title":"short label",'
        '"cls":"A or B",'
        '"event_date":"YYYY-MM-DD or null",'
        '"window_days":null,'
        '"P":0,"M":0,"N":0,'
        '"source_url":"https://...",'
        '"thesis":"one line: why it matters",'
        '"evidence":"one line justifying P/M/N"}]}\n\n'
        "TIMING — classify each catalyst A or B:\n"
        "- A (timed): there is an OBJECTIVE calendar date — earnings, an FDA/regulatory decision, an index "
        "rebalance, a lockup expiry, an investor day. Put it in event_date; leave window_days null.\n"
        "- B (untimed): no fixed date. Set window_days = your best estimate of the number of DAYS FROM TODAY "
        "to the MIDPOINT of the likely window. Guidance: a downstream company that typically follows an upstream "
        "anchor's report by ~1-2 quarters → ~45-90 days; if an analyst/author gave an expected timeframe, use it. "
        "Leave event_date null.\n\n"
        "GRADE each catalyst (integers, be conservative):\n"
        "- P probability/evidence 0-3: 0 pure speculation · 1 directional evidence · 2 hard evidence in hand · "
        "3 already announced, awaiting confirmation.\n"
        "- M magnitude/impact 0-3: 0 noise · 1 moves one quarter · 2 moves the full year · 3 changes the narrative.\n"
        "- N narrative fit vs today's hottest market themes 0-2: 0 unrelated · 1 tangential · 2 squarely on the "
        "hottest theme.\n\n"
        "Rules:\n"
        "- ONLY include a catalyst backed by a real, specific source_url (news, IR page, filing, calendar). "
        "No credible source → omit it. NEVER invent dates or events.\n"
        "- If you find nothing credible, return an empty catalysts array."
    )


def _extract_json(text: str) -> dict | None:
    """Pull the JSON object out of the model's text (tolerant of stray prose)."""
    text = text.strip()
    try:
        return json.loads(text)
    except ValueError:
        pass
    # Fall back to the outermost {...} span.
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except ValueError:
        return None


def _timing(days: int | None) -> float:
    """T (0-25): a peak curve on days-to-event. Peaks at ~2 weeks; too-near
    (<0 → 0) and too-far both decay. T = 25·exp(−((days−14)²)/(2·21²))."""
    if days is None or days < 0:
        return 0.0
    return 25.0 * math.exp(-((days - 14) ** 2) / (2 * 21 * 21))


def _days_to(cat: dict, today: date) -> int | None:
    """A-class: calendar date − today. B-class: estimated window midpoint days."""
    ed = cat.get("event_date")
    if ed:
        try:
            return (date.fromisoformat(str(ed)[:10]) - today).days
        except ValueError:
            pass
    wd = cat.get("window_days")
    try:
        return int(wd) if wd is not None else None
    except (TypeError, ValueError):
        return None


def _lvl(x, hi: int) -> int:
    try:
        return max(0, min(hi, int(round(float(x)))))
    except (TypeError, ValueError):
        return 0


def _tpmn(cat: dict, today: date) -> dict:
    """Per-catalyst score: total = T(0-25) + P(0-3) + M(0-3) + N(0-2)."""
    ctype = cat.get("type") if cat.get("type") in CATALYST_TYPES else "other"
    days = _days_to(cat, today)
    T = round(_timing(days), 1)
    P = _lvl(cat.get("P"), 3)
    M = _lvl(cat.get("M"), 3)
    N = _lvl(cat.get("N"), 2)
    score = round(T + P + M + N, 1)
    cls = "A" if cat.get("event_date") else ("B" if cat.get("window_days") is not None else (cat.get("cls") or "B"))
    return {"T": T, "P": P, "M": M, "N": N, "days": days, "cls": cls, "score": score, "type": ctype}


def _clean(parsed: dict, today: date) -> list[dict]:
    """Keep only sourced catalysts; attach TPMN; sort strongest first."""
    out: list[dict] = []
    for c in (parsed.get("catalysts") or [])[: MAX_CATALYSTS * 2]:
        if not isinstance(c, dict):
            continue
        url = (c.get("source_url") or "").strip()
        if not url.startswith("http"):
            continue  # no citation → drop (guards against hallucinated events)
        tpmn = _tpmn(c, today)
        wd = c.get("window_days")
        try:
            wd = int(wd) if wd is not None else None
        except (TypeError, ValueError):
            wd = None
        cat = {
            "type": tpmn["type"],
            "title": (c.get("title") or "").strip()[:160],
            "cls": tpmn["cls"],
            "event_date": (str(c.get("event_date"))[:10] if c.get("event_date") else None),
            "window_days": wd,
            "source_url": url,
            "thesis": (c.get("thesis") or "").strip()[:280],
            "evidence": (c.get("evidence") or "").strip()[:200],
            "tpmn": tpmn,
        }
        out.append(cat)
    out.sort(key=lambda x: x["tpmn"]["score"], reverse=True)
    return out[:MAX_CATALYSTS]


def _complete(client, model: str, prompt: str) -> str:
    """One streamed web-search call; returns the concatenated output text.

    The gateway requires stream=True; we collect output_text deltas.
    """
    parts: list[str] = []
    stream = client.responses.create(
        model=model,
        input=[{"role": "user", "content": prompt}],
        tools=[{"type": "web_search"}],
        stream=True,
    )
    for ev in stream:
        if getattr(ev, "type", "") == "response.output_text.delta":
            parts.append(ev.delta)
    return "".join(parts)


def _fetch_one(client, ticker: str, name: str, today: date, model: str, sector: str = "") -> dict | None:
    try:
        text = _complete(client, model, _prompt(ticker, name, sector))
    except Exception as exc:  # noqa: BLE001
        logger.warning("  %s: API error (%s)", ticker, exc)
        return None
    parsed = _extract_json(text)
    if parsed is None:
        logger.warning("  %s: could not parse JSON response", ticker)
        return None
    cats = _clean(parsed, today)
    return {
        "catalysts": cats,
        "score": cats[0]["tpmn"]["score"] if cats else 0.0,
        "best_type": cats[0]["type"] if cats else None,
        "model": model,
        "ok": True,
        "generated_at": today.isoformat(),
    }


def fetch_missing(
    tickers: dict[str, str],
    have: dict[str, dict],
    today: date,
    workers: int = 3,
    model: str = MODEL,
    sectors: dict[str, dict] | None = None,
) -> dict[str, dict]:
    try:
        from openai import OpenAI
    except ImportError:
        logger.warning("openai SDK not installed — `pip install openai`; skipping catalyst")
        return {}
    if not os.environ.get("OPENAI_API_KEY"):
        logger.warning("OPENAI_API_KEY not set — skipping catalyst discovery")
        return {}

    missing = {t: n for t, n in tickers.items() if t not in have}
    if not missing:
        logger.info("no new tickers — catalyst cache already complete (%d)", len(have))
        return {}
    logger.info("finding catalysts for %d new tickers via %s (web search)…", len(missing), model)

    from concurrent.futures import ThreadPoolExecutor, as_completed

    sectors = sectors or {}
    client = OpenAI()
    out: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futures = {
            ex.submit(_fetch_one, client, t, n, today, model, (sectors.get(t) or {}).get("sector", "")): t
            for t, n in missing.items()
        }
        for i, fut in enumerate(as_completed(futures), 1):
            t = futures[fut]
            res = fut.result()
            if res:
                out[t] = res
            if i % 5 == 0 or i == len(missing):
                logger.info("  %d/%d…", i, len(missing))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Stage 3 — find dated, sourced catalysts per ticker (LLM web search, cached)")
    ap.add_argument("--config", default=None)
    ap.add_argument("--tickers", default=None, help="comma-separated override (e.g. the Focus List)")
    ap.add_argument("--refresh", action="store_true", help="re-fetch all, ignore cache")
    ap.add_argument("--limit", type=int, default=25, help="cap how many new tickers to fetch this run (default 25; web search is slow)")
    ap.add_argument("--model", default=MODEL, help=f"OpenAI model id (default {MODEL})")
    ap.add_argument("--min-cap", type=float, default=3e8, help="skip tickers below this market cap (default $300M)")
    ap.add_argument("--workers", type=int, default=3)
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s | %(message)s")

    settings = load_settings(args.config)
    out_path = settings.output_dir / CATALYST_FILE
    have = {} if args.refresh else _load(out_path)

    if args.tickers:
        names = {t.strip().upper(): "" for t in args.tickers.split(",") if t.strip()}
    else:
        names = rated_seed_tickers(settings.output_dir)
    if not names:
        logger.warning("no tickers (run the SA scrape first, or pass --tickers)")
        return 1

    caps = _load(settings.output_dir / "marketcaps.json")
    if args.min_cap and caps:
        before = len(names)
        names = {t: n for t, n in names.items() if not (isinstance(caps.get(t), (int, float)) and caps[t] < args.min_cap)}
        skipped = before - len(names)
        if skipped:
            logger.info("skipping %d tickers below $%.0fM market cap", skipped, args.min_cap / 1e6)

    if args.limit:
        pending = [t for t in names if t not in have][: args.limit]
        names = {t: names[t] for t in pending}

    sectors = _load(settings.output_dir / "sectors.json")
    today = date.today()

    fetched = fetch_missing(names, have, today, workers=args.workers, model=args.model, sectors=sectors)
    merged = {**have, **fetched}
    if not merged:
        logger.warning("no catalyst data resolved (no key / API error); keeping existing file")
        return 1

    settings.output_dir.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(merged))
    withcat = sum(1 for v in merged.values() if v.get("catalysts"))
    logger.info("wrote %d catalyst maps (+%d new, %d with ≥1 catalyst)", len(merged), len(fetched), withcat)
    print(f"catalyst: {len(merged)} (+{len(fetched)} new, {withcat} with catalysts)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
