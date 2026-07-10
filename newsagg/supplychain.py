"""LLM-derived supply-chain map (upstream / downstream / peers) per rated seed
ticker, so the dashboard can draw a radial ecosystem graph on a stock's detail
page — who feeds it, who it feeds, and who it competes with.

Why an LLM (not a database): there is no clean, free machine-readable feed of
"who supplies whom" for US equities. Claude knows the major, well-reported
relationships (NVDA→TSMC, AAPL→its assemblers, etc.). We ask it for *major*
relationships only, with a one-line reason per edge, and we label the output
honestly in the UI as AI-derived and non-exhaustive.

Like ``sectors.py`` this is a **cached** fetch: only tickers missing from
``data/newsagg/supplychain.json`` are looked up; existing ones are kept. So the
daily run is usually a no-op and only newly-added SA names cost an API call.

Credentials: the Anthropic SDK reads ``ANTHROPIC_API_KEY`` from the environment
(set it in your shell / launchd, never in code or the repo). No key → this step
logs a warning and is skipped; the rest of the pipeline is unaffected.

Writes ``data/newsagg/supplychain.json`` =
    {ticker: {upstream: [Edge], downstream: [Edge], peers: [Edge], model, ok}}
where Edge = {ticker, name, reason}.

    ANTHROPIC_API_KEY=... python -m newsagg.supplychain
"""

from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path

from newsagg.config import load_settings

logger = logging.getLogger("newsagg.supplychain")

SUPPLYCHAIN_FILE = "supplychain.json"
MODEL = "claude-opus-4-8"

# Keep each relationship list short so the graph stays readable and the model
# stays on the *major* names instead of padding with speculative small fry.
MAX_PER_LIST = 6


def _load(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except ValueError:
        return {}


def rated_seed_tickers(output_dir: Path) -> dict[str, str]:
    """Rated tickers in the SA seed snapshot → company name.

    A ticker is "rated" if it appears in any widget row carrying a rating
    (Buy / Strong Buy / a numeric quant grade). Those are the only names that
    reach the later pipeline stages, so they're the only ones worth mapping.
    """
    path = output_dir / "seekingalpha_latest.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
    except ValueError:
        return {}
    out: dict[str, str] = {}
    for w in data.get("home_widgets", []):
        for g in w.get("groups", []):
            for r in g.get("rows", []):
                t = (r.get("ticker") or "").strip().upper()
                if not t or not (r.get("rating") or "").strip():
                    continue
                # First non-empty company name wins.
                out.setdefault(t, (r.get("company") or "").strip())
    return out


# JSON schema forced on the model — every list is an array of {ticker,name,reason}.
_EDGE = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "ticker": {"type": "string", "description": "US exchange ticker, e.g. NVDA. Empty string if not publicly traded / unknown."},
        "name": {"type": "string", "description": "Company name."},
        "reason": {"type": "string", "description": "One short clause: why this relationship exists."},
    },
    "required": ["ticker", "name", "reason"],
}
_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "upstream": {"type": "array", "items": _EDGE, "description": "Key suppliers / inputs this company depends on."},
        "downstream": {"type": "array", "items": _EDGE, "description": "Key customers / channels that depend on this company."},
        "peers": {"type": "array", "items": _EDGE, "description": "Direct competitors in the same market."},
    },
    "required": ["upstream", "downstream", "peers"],
}


def _prompt(ticker: str, name: str) -> str:
    who = f"{ticker} ({name})" if name else ticker
    return (
        f"Map the supply chain around the US-listed company {who}.\n\n"
        "Return three lists:\n"
        "- upstream: its most important suppliers / input providers (who it buys from or depends on)\n"
        "- downstream: its most important customers / distribution channels (who buys from or depends on it)\n"
        "- peers: its most direct competitors\n\n"
        f"Rules:\n"
        f"- Only MAJOR, well-established relationships. At most {MAX_PER_LIST} per list; fewer is fine.\n"
        "- Prefer publicly-traded companies and give their US ticker in `ticker`. "
        "If a relationship is important but the counterparty isn't publicly traded (or you're unsure of the ticker), "
        "leave `ticker` empty but still list it by name.\n"
        "- `reason` is one short clause (e.g. 'fabs its chips', 'largest cloud customer').\n"
        "- Do NOT invent tickers or relationships you aren't confident about. Omit rather than guess.\n"
        "- If the company itself is obscure and you have little reliable information, return short or empty lists."
    )


def _clean_edges(raw: list) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for e in raw[:MAX_PER_LIST]:
        if not isinstance(e, dict):
            continue
        name = (e.get("name") or "").strip()
        if not name:
            continue
        tk = (e.get("ticker") or "").strip().upper()
        # Guard against the model echoing punctuation / prose into the ticker.
        if tk and not tk.replace(".", "").replace("-", "").isalpha():
            tk = ""
        key = tk or name.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append({"ticker": tk, "name": name, "reason": (e.get("reason") or "").strip()})
    return out


def _fetch_one(client, ticker: str, name: str) -> dict | None:
    """One structured call. Returns the cleaned map, or None on failure."""
    try:
        msg = client.messages.create(
            model=MODEL,
            max_tokens=1500,
            thinking={"type": "adaptive"},
            output_config={"format": {"type": "json_schema", "schema": _SCHEMA}},
            messages=[{"role": "user", "content": _prompt(ticker, name)}],
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("  %s: API error (%s)", ticker, exc)
        return None

    # With json_schema output the assistant text is the JSON object.
    text = "".join(b.text for b in msg.content if getattr(b, "type", None) == "text")
    try:
        parsed = json.loads(text)
    except ValueError:
        logger.warning("  %s: could not parse JSON response", ticker)
        return None

    return {
        "upstream": _clean_edges(parsed.get("upstream") or []),
        "downstream": _clean_edges(parsed.get("downstream") or []),
        "peers": _clean_edges(parsed.get("peers") or []),
        "model": MODEL,
        "ok": True,
    }


def fetch_missing(
    tickers: dict[str, str], have: dict[str, dict], workers: int = 4
) -> dict[str, dict]:
    """Look up the supply chain for tickers not already cached."""
    try:
        import anthropic
    except ImportError:
        logger.warning("anthropic SDK not installed — `pip install anthropic`; skipping supply chain")
        return {}

    if not os.environ.get("ANTHROPIC_API_KEY"):
        logger.warning("ANTHROPIC_API_KEY not set — skipping supply-chain enrichment")
        return {}

    missing = {t: n for t, n in tickers.items() if t not in have}
    if not missing:
        logger.info("no new tickers — supply-chain cache already complete (%d)", len(have))
        return {}
    logger.info("mapping supply chain for %d new tickers via %s…", len(missing), MODEL)

    from concurrent.futures import ThreadPoolExecutor, as_completed

    client = anthropic.Anthropic()
    out: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futures = {ex.submit(_fetch_one, client, t, n): t for t, n in missing.items()}
        for i, fut in enumerate(as_completed(futures), 1):
            t = futures[fut]
            res = fut.result()
            if res:
                out[t] = res
            if i % 10 == 0 or i == len(missing):
                logger.info("  %d/%d…", i, len(missing))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Map upstream/downstream/peers per rated seed ticker (LLM, cached)")
    ap.add_argument("--config", default=None)
    ap.add_argument("--tickers", default=None, help="comma-separated override")
    ap.add_argument("--refresh", action="store_true", help="re-map all, ignore cache")
    ap.add_argument("--limit", type=int, default=None, help="cap how many new tickers to map this run")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s | %(message)s")

    settings = load_settings(args.config)
    out_path = settings.output_dir / SUPPLYCHAIN_FILE
    have = {} if args.refresh else _load(out_path)

    if args.tickers:
        names = {t.strip().upper(): "" for t in args.tickers.split(",") if t.strip()}
    else:
        names = rated_seed_tickers(settings.output_dir)
    if not names:
        logger.warning("no rated tickers (run the SA scrape first, or pass --tickers)")
        return 1

    if args.limit:
        # Only map the first N *uncached* tickers this run (spread cost over days).
        pending = [t for t in names if t not in have][: args.limit]
        names = {t: names[t] for t in pending}

    fetched = fetch_missing(names, have)
    merged = {**have, **fetched}
    if not merged:
        logger.warning("no supply-chain data resolved (no key / API error); keeping existing file")
        return 1

    settings.output_dir.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(merged))
    logger.info("wrote %d supply-chain maps (+%d new)", len(merged), len(fetched))
    print(f"supplychain: {len(merged)} (+{len(fetched)} new)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
