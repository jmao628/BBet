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

# How much each catalyst *type* is worth as a re-rating trigger (the T weight).
TYPE_WEIGHT = {
    "approval": 1.0,       # FDA / regulatory decision — binary, big
    "m_and_a": 0.9,        # deal / strategic review
    "order": 0.85,         # major contract / design win
    "index": 0.75,         # index inclusion — forced buying
    "guidance": 0.70,      # guide / analyst-day reset
    "policy": 0.70,        # policy / regulation tailwind
    "revision": 0.65,      # estimate-revision / upgrade cycle
    "earnings": 0.60,      # scheduled print
    "capital_return": 0.60,  # buyback / dividend initiation
    "mgmt": 0.40,          # management change
    "other": 0.50,
}


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
        f"You are an equity-research assistant. Using web search, find UPCOMING, DATED catalysts "
        f"for the US-listed company {who} over roughly the next 6 months that could re-rate the "
        f"stock.{ctx}\n\n"
        "Return ONLY a JSON object (no prose, no markdown fences) of the form:\n"
        '{"ticker":"' + ticker + '","catalysts":[{'
        '"type":"earnings|guidance|approval|order|m_and_a|capital_return|policy|index|mgmt|revision|other",'
        '"title":"short label",'
        '"event_date":"YYYY-MM-DD or null",'
        '"probability":0.0,'
        '"magnitude_pct":0.0,'
        '"priced_in":0.0,'
        '"source_url":"https://...",'
        '"thesis":"one line: why it matters"}]}\n\n'
        "Rules:\n"
        "- ONLY include a catalyst you can back with a real, specific source_url (news, IR page, filing, "
        "earnings calendar). No credible source → omit it. Never invent dates or events.\n"
        "- event_date = the actual scheduled/expected date if known, else null.\n"
        "- probability (0-1) = chance the event happens AND surprises positively.\n"
        "- magnitude_pct = rough % upside to the stock if it fires as hoped.\n"
        "- priced_in (0-1) = 0 if the market hasn't reacted, 1 if fully expected/priced.\n"
        "- Prefer concrete near-term events. If you find nothing credible, return an empty catalysts array."
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


def _nearness(event_date: str | None, today: date) -> float:
    """0-1 by how soon the dated event is (rotation-safe: sooner = higher)."""
    if not event_date:
        return 0.10
    try:
        d = date.fromisoformat(str(event_date)[:10])
    except ValueError:
        return 0.10
    days = (d - today).days
    if days < 0:
        return 0.05            # already happened
    if days <= 14:
        return 1.0
    if days <= 30:
        return 0.85
    if days <= 45:
        return 0.70
    if days <= 60:
        return 0.58
    if days <= 90:
        return 0.45
    if days <= 180:
        return 0.25
    return 0.12


def _clamp01(x, default=0.0) -> float:
    try:
        return max(0.0, min(1.0, float(x)))
    except (TypeError, ValueError):
        return default


def _tpmn(cat: dict, today: date) -> dict:
    """Deterministic TPMN score (0-10) for one catalyst from its sourced facts."""
    ctype = cat.get("type") if cat.get("type") in CATALYST_TYPES else "other"
    n = _nearness(cat.get("event_date"), today)
    try:
        mag = max(0.0, float(cat.get("magnitude_pct") or 0.0))
    except (TypeError, ValueError):
        mag = 0.0
    m = min(mag / 50.0, 1.0)                       # 50%+ upside caps the M dimension
    prob = _clamp01(cat.get("probability"), 0.5)
    priced = _clamp01(cat.get("priced_in"), 0.5)
    p = _clamp01(prob * (0.6 + 0.4 * (1.0 - priced)))  # reward not-yet-priced-in
    t = TYPE_WEIGHT.get(ctype, 0.5)
    score = round((0.35 * n + 0.30 * m + 0.25 * p + 0.10 * t) * 10, 1)
    return {"T": round(t, 2), "P": round(p, 2), "M": round(m, 2), "N": round(n, 2), "score": score, "type": ctype}


def _clean(parsed: dict, today: date) -> list[dict]:
    """Keep only sourced catalysts; attach TPMN; sort strongest first."""
    out: list[dict] = []
    for c in (parsed.get("catalysts") or [])[: MAX_CATALYSTS * 2]:
        if not isinstance(c, dict):
            continue
        url = (c.get("source_url") or "").strip()
        if not url.startswith("http"):
            continue  # no citation → drop (guards against hallucinated events)
        cat = {
            "type": c.get("type") if c.get("type") in CATALYST_TYPES else "other",
            "title": (c.get("title") or "").strip()[:160],
            "event_date": (str(c.get("event_date"))[:10] if c.get("event_date") else None),
            "probability": _clamp01(c.get("probability"), 0.5),
            "magnitude_pct": _safe_float(c.get("magnitude_pct")),
            "priced_in": _clamp01(c.get("priced_in"), 0.5),
            "source_url": url,
            "thesis": (c.get("thesis") or "").strip()[:280],
        }
        cat["tpmn"] = _tpmn(cat, today)
        out.append(cat)
    out.sort(key=lambda x: x["tpmn"]["score"], reverse=True)
    return out[:MAX_CATALYSTS]


def _safe_float(x) -> float:
    try:
        return round(float(x), 1)
    except (TypeError, ValueError):
        return 0.0


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
