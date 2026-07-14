"""Stage 5 — Management Conviction (four-layer tone read), per Shortlist name.

For each surviving name we ask an LLM **with web search** to READ the most recent
management commentary — the ticker's own earnings-call transcript / 10-Q-K / press
release, or, if the company has no useful recent call of its own (pre-revenue, no
transcript, freshly-IPO'd), an UPSTREAM ANCHOR's call read through to it — and to
score how much the tone actually backs the thesis. Four layers, graded by the LLM
from the source text, each with a short evidence quote and a confidence:

    L1  Tone baseline        0-2 : guidance vs last quarter — downgrade 0 / flat 1 / clear upgrade 2
    L2  Evasion              0-3 : answers to hard questions — dodges 0 / vague 1 / occasional 2 / straight numbers 3
    L3  Hard vs soft          0-3 : commitments — all soft 0 / mostly soft 1 / mixed 2 / hard/dated 3
    L4  Walk the talk         0-2 : insider actions vs words — talks up but sells 0 / no signal 1 / bullish & buying 2

The total (0-10) is summed **deterministically in Python** from those four layer
scores — the LLM only grades the layers and cites the text, it never returns the
total. Every record carries the source (own vs upstream-anchor), the anchor used,
the call reference/date, and a source_url; a record with no citable source is kept
only with low confidence so the UI can gray it out.

Provider: OpenAI (the user's gateway). Reads ``OPENAI_API_KEY`` (and, if the
gateway needs it, ``OPENAI_BASE_URL``) from the environment — never from code or
the repo. The gateway requires streaming, so we stream and collect the output
text. No key / SDK → this step logs a warning and is skipped.

Like ``catalyst.py`` this is a **cached, incremental** fetch: only Shortlist names
missing from ``data/newsagg/conviction.json`` are looked up (unless --refresh),
and each ticker is checkpointed as it completes so a long run is never lost.

Writes ``data/newsagg/conviction.json`` =
    {ticker: {layers:{L1..L4:{score,max,evidence,confidence}}, total, confidence,
              source, anchor_ticker, anchor_name, call_ref, call_date, source_url,
              summary, model, ok, generated_at}}

    OPENAI_API_KEY=... python -m newsagg.conviction --limit 25
"""

from __future__ import annotations

import argparse
import json
import logging
import os
from datetime import date
from pathlib import Path

from newsagg.catalyst import (
    BYPASS_CAP,
    _complete,
    _eco_neighbors,
    _extract_json,
    _load,
    focus_ranked,
)
from newsagg.config import load_settings

logger = logging.getLogger("newsagg.conviction")

CONVICTION_FILE = "conviction.json"
MODEL = os.environ.get("OPENAI_MODEL", "gpt-5.5")

# Per-layer caps (the rubric's ranges). Total = L1+L2+L3+L4 ∈ [0,10].
_LAYER_MAX = {"L1": 2, "L2": 3, "L3": 3, "L4": 2}


def _anchor_for(ticker: str, eco: dict[str, list[dict]], caps: dict, names: dict[str, str]) -> tuple[str, str]:
    """Best upstream ANCHOR for read-through: the most tightly-linked mega-cap
    ecosystem neighbor (importance first, then market cap). Empty if none — most
    names read their OWN call and never need this."""
    best: tuple[int, float, str] | None = None
    for n in eco.get(ticker, []):
        b = n.get("ticker", "")
        cap = caps.get(b)
        if not b or b == ticker or not isinstance(cap, (int, float)) or cap < BYPASS_CAP:
            continue
        imp = int(n.get("importance", 2) or 2)
        key = (imp, float(cap), b)
        if best is None or key > best:
            best = key
    if not best:
        return "", ""
    tk = best[2]
    return tk, names.get(tk, "")


def _prompt(ticker: str, name: str, sector: str, anchor_ticker: str, anchor_name: str) -> str:
    who = f"{ticker} ({name})" if name else ticker
    ctx = f" It is classified in the '{sector}' sector." if sector else ""
    anchor_line = ""
    if anchor_ticker:
        who_anchor = f"{anchor_ticker} ({anchor_name})" if anchor_name else anchor_ticker
        anchor_line = (
            f" If {ticker} has NO useful recent call of its own (pre-revenue, no transcript, "
            f"just IPO'd), you MAY instead read the most recent earnings call of its upstream "
            f"anchor {who_anchor} and read its tone THROUGH to {ticker}; set source='upstream_anchor' "
            f"and fill anchor_ticker/anchor_name. Otherwise ALWAYS prefer {ticker}'s own call."
        )
    today = date.today().isoformat()
    return (
        f"You are a buy-side analyst reading MANAGEMENT TONE. Today is {today}. Using web search, find the "
        f"MOST RECENT management commentary for the US-listed company {who}{ctx} — its latest quarterly "
        "earnings-call transcript (prepared remarks AND Q&A), or, if no transcript, its latest 10-Q/10-K "
        "MD&A, guidance press release, or investor-day remarks. Prefer PRIMARY sources (company IR, the "
        f"transcript, SEC filings)." + anchor_line + "\n\n"
        "Read how much the tone actually BACKS the bull thesis, and grade FOUR layers from the source text. "
        "Grade ONLY from what management actually said/did — quote or tightly paraphrase real language. Be "
        "conservative: when the text doesn't clearly support a higher grade, grade LOWER.\n\n"
        "LAYERS (integers only):\n"
        "- L1 Tone baseline 0-2 — the DIRECTION of guidance/outlook vs the prior quarter: "
        "0 = a cut / downgrade / lowered outlook · 1 = flat / reiterated / unchanged · 2 = a clear raise / upgrade.\n"
        "- L2 Evasion 0-3 — how DIRECTLY management answers the hard analyst questions in Q&A: "
        "0 = repeatedly dodges, changes the subject · 1 = vague, talks around it · 2 = mostly straight with "
        "the occasional dodge · 3 = straight numbers, answers head-on.\n"
        "- L3 Hard vs soft 0-3 — how CONCRETE the forward commitments are: 0 = all soft ('we're optimistic', "
        "'well-positioned') · 1 = mostly soft, a little specificity · 2 = mixed soft and hard · 3 = hard, "
        "dated, QUANTIFIED commitments (specific revenue/margin targets, dated milestones, signed backlog).\n"
        "- L4 Walk the talk 0-2 — insider ACTIONS vs words (check recent Form 4s / buyback activity): "
        "0 = talks it up while insiders are net selling · 1 = no clear signal either way · 2 = bullish talk "
        "AND insiders buying / a real buyback underway.\n\n"
        "Return ONLY a JSON object (no prose, no markdown fences):\n"
        '{"ticker":"' + ticker + '",'
        '"source":"own or upstream_anchor",'
        '"anchor_ticker":"' + anchor_ticker + ' or empty",'
        '"anchor_name":"",'
        '"call_ref":"e.g. Q2 FY2026 earnings call",'
        '"call_date":"YYYY-MM-DD or null",'
        '"source_url":"https://... (the actual transcript/filing/Form 4)",'
        '"summary":"3-4 sentences: the overall read on management tone and whether it backs the thesis",'
        '"L1":{"score":0,"evidence":"short quote/paraphrase from the source","confidence":0.0},'
        '"L2":{"score":0,"evidence":"...","confidence":0.0},'
        '"L3":{"score":0,"evidence":"...","confidence":0.0},'
        '"L4":{"score":0,"evidence":"...","confidence":0.0}}\n\n'
        "Rules:\n"
        "- source_url MUST be a real, specific page (the transcript / filing / Form 4). NEVER invent URLs or quotes.\n"
        "- confidence 0.0-1.0 per layer = how well the source text pins that grade (low if you had to infer).\n"
        "- If you cannot find ANY citable recent call/filing for the company OR its anchor, set every score to 0, "
        "every confidence to 0, source_url to '' and say so in summary. Do NOT fabricate a call."
    )


def _lvl(x, hi: int) -> int:
    try:
        return max(0, min(hi, int(round(float(x)))))
    except (TypeError, ValueError):
        return 0


def _conf(x) -> float:
    try:
        return round(max(0.0, min(1.0, float(x))), 2)
    except (TypeError, ValueError):
        return 0.0


def _clean(parsed: dict, ticker: str, anchor_ticker: str, anchor_name: str, model: str, today: date) -> dict:
    """Grade the four layers deterministically; sum the total; keep provenance."""
    layers: dict[str, dict] = {}
    confs: list[float] = []
    for k, hi in _LAYER_MAX.items():
        raw = parsed.get(k) if isinstance(parsed.get(k), dict) else {}
        score = _lvl(raw.get("score"), hi)
        conf = _conf(raw.get("confidence"))
        confs.append(conf)
        layers[k] = {
            "score": score,
            "max": hi,
            "evidence": (raw.get("evidence") or "").strip()[:400],
            "confidence": conf,
        }
    total = sum(layers[k]["score"] for k in _LAYER_MAX)  # 0-10
    src = (parsed.get("source") or "own").strip().lower()
    src = "upstream_anchor" if src.startswith("upstream") else "own"
    a_tk = (parsed.get("anchor_ticker") or "").strip().upper()
    if a_tk and not a_tk.replace(".", "").replace("-", "").isalpha():
        a_tk = ""
    if src == "upstream_anchor" and not a_tk:
        a_tk = anchor_ticker
    a_name = (parsed.get("anchor_name") or "").strip() or (anchor_name if a_tk == anchor_ticker else "")
    url = (parsed.get("source_url") or "").strip()
    if not url.startswith("http"):
        url = ""
    return {
        "layers": layers,
        "total": total,
        "confidence": round(sum(confs) / len(confs), 2) if confs else 0.0,
        "source": src if src == "own" else "upstream_anchor",
        "anchor_ticker": a_tk if src == "upstream_anchor" else "",
        "anchor_name": a_name if src == "upstream_anchor" else "",
        "call_ref": (parsed.get("call_ref") or "").strip()[:120],
        "call_date": (str(parsed.get("call_date"))[:10] if parsed.get("call_date") else None),
        "source_url": url,
        "summary": (parsed.get("summary") or "").strip()[:700],
        "model": model,
        "ok": bool(url),  # a real citation → trustworthy; else low-confidence placeholder
        "generated_at": today.isoformat(),
    }


def _fetch_one(client, ticker: str, name: str, today: date, model: str, sector: str, anchor: tuple[str, str]) -> dict | None:
    a_tk, a_name = anchor
    try:
        text = _complete(client, model, _prompt(ticker, name, sector, a_tk, a_name))
    except Exception as exc:  # noqa: BLE001
        logger.warning("  %s: API error (%s)", ticker, exc)
        return None
    parsed = _extract_json(text)
    if parsed is None:
        logger.warning("  %s: could not parse JSON response", ticker)
        return None
    return _clean(parsed, ticker, a_tk, a_name, model, today)


def _is_stale(entry: dict, today: date, max_age_days: float) -> bool:
    """Re-read a name whose record is older than ``max_age_days`` (a new quarterly
    call has likely happened) or that never got a citable source (retry it)."""
    if not entry.get("ok") or not entry.get("source_url"):
        return True
    ga = entry.get("generated_at")
    if not ga:
        return True
    try:
        return (today - date.fromisoformat(ga)).days >= max_age_days
    except ValueError:
        return True


def fetch_missing(
    tickers: dict[str, str],
    have: dict[str, dict],
    today: date,
    workers: int = 3,
    model: str = MODEL,
    sectors: dict[str, dict] | None = None,
    anchors: dict[str, tuple[str, str]] | None = None,
    out_path: Path | None = None,
    refetch: set[str] | None = None,
    base: dict[str, dict] | None = None,
) -> dict[str, dict]:
    try:
        from openai import OpenAI
    except ImportError:
        logger.warning("openai SDK not installed — `pip install openai`; skipping conviction")
        return {}
    if not os.environ.get("OPENAI_API_KEY"):
        logger.warning("OPENAI_API_KEY not set — skipping conviction read")
        return {}

    refetch = refetch or set()
    anchors = anchors or {}
    missing = {t: n for t, n in tickers.items() if t not in have or t in refetch}
    if not missing:
        logger.info("no new tickers — conviction cache already complete (%d)", len(have))
        return {}
    nnew = sum(1 for t in missing if t not in have)
    logger.info(
        "reading management tone for %d tickers via %s (web search) — %d new, %d stale re-fetch…",
        len(missing), model, nnew, len(missing) - nnew,
    )

    from concurrent.futures import ThreadPoolExecutor, as_completed

    sectors = sectors or {}
    client = OpenAI()
    endpoint = str(getattr(client, "base_url", "") or "")
    logger.info("OpenAI endpoint: %s", endpoint)
    if "api.openai.com" in endpoint:
        logger.warning(
            "hitting the DEFAULT api.openai.com — a custom-gateway key will 401 here. "
            "Set OPENAI_BASE_URL (and re-run install_mac.sh so the launchd job has it baked in)."
        )
    out: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futures = {
            ex.submit(
                _fetch_one, client, t, n, today, model,
                (sectors.get(t) or {}).get("sector", ""),
                anchors.get(t, ("", "")),
            ): t
            for t, n in missing.items()
        }
        for i, fut in enumerate(as_completed(futures), 1):
            t = futures[fut]
            res = fut.result()
            if res:
                out[t] = res
                if out_path is not None:
                    out_path.parent.mkdir(parents=True, exist_ok=True)
                    out_path.write_text(json.dumps({**(base if base is not None else have), **out}))
            if i % 5 == 0 or i == len(missing):
                logger.info("  %d/%d… (%d with a citable call so far)", i, len(missing), sum(1 for v in out.values() if v.get("ok")))
    return out


def _ordered_names(output_dir: Path) -> dict[str, str]:
    """Shortlist-priority order: Focus names, strongest first, biasing names whose
    catalyst also fires (so the daily budget reads the Tier-1/Tier-2 survivors —
    exactly where a management-tone read earns its keep — before the tail)."""
    ranked = focus_ranked(output_dir)  # [(ticker, company, focus_score)] focus-sorted
    if not ranked:
        return {}
    cats = _load(output_dir / "catalyst.json")
    scored: list[tuple[float, str, str]] = []
    for t, c, fs in ranked:
        cat = cats.get(t) or {}
        cat_score = float(cat.get("score") or 0.0)
        priority = 0.5 * fs + 0.5 * cat_score  # loose mirror of the shortlist composite
        scored.append((priority, t, c))
    scored.sort(key=lambda x: x[0], reverse=True)
    return {t: c for _, t, c in scored}


def main() -> int:
    ap = argparse.ArgumentParser(description="Stage 5 — read management tone (four layers) per Shortlist name (LLM web search, cached)")
    ap.add_argument("--config", default=None)
    ap.add_argument("--tickers", default=None, help="comma-separated override")
    ap.add_argument("--refresh", action="store_true", help="re-read the requested names, KEEPING every other cached record")
    ap.add_argument("--limit", type=int, default=25, help="cap how many new tickers to read this run (default 25; --limit 0 = all uncached)")
    ap.add_argument("--model", default=MODEL, help=f"OpenAI model id (default {MODEL})")
    ap.add_argument("--min-cap", type=float, default=3e8, help="skip tickers below this market cap (default $300M)")
    ap.add_argument("--max-age", type=float, default=0.0, help="re-read cached tickers older than N days (a new quarterly call has likely happened); 0 = never (default)")
    ap.add_argument("--workers", type=int, default=3)
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s | %(message)s")

    settings = load_settings(args.config)
    out_path = settings.output_dir / CONVICTION_FILE
    existing = _load(out_path)  # everything currently cached — NEVER dropped
    have = dict(existing)

    if args.tickers:
        names = {t.strip().upper(): "" for t in args.tickers.split(",") if t.strip()}
    else:
        names = _ordered_names(settings.output_dir)
    if not names:
        logger.warning("no Focus names yet (run technical + supplychain + catalyst first, or pass --tickers)")
        return 1

    caps = _load(settings.output_dir / "marketcaps.json")
    if args.min_cap and caps:
        before = len(names)
        names = {t: n for t, n in names.items() if not (isinstance(caps.get(t), (int, float)) and caps[t] < args.min_cap)}
        skipped = before - len(names)
        if skipped:
            logger.info("skipping %d tickers below $%.0fM market cap", skipped, args.min_cap / 1e6)

    today = date.today()

    if args.refresh:
        for t in names:
            have.pop(t, None)

    stale: set[str] = set()
    if args.max_age > 0:
        stale = {t for t in names if t in have and _is_stale(have[t], today, args.max_age)}
        if stale:
            logger.info("%d cached tickers stale (>%.0fd or no citable call) — will re-read", len(stale), args.max_age)

    if args.limit:
        pending = [t for t in names if t not in have][: args.limit]
        if len(pending) < args.limit:
            pending += [t for t in names if t in stale and t not in pending][: args.limit - len(pending)]
        names = {t: names[t] for t in pending}

    # Upstream-anchor candidates (mega-cap ecosystem neighbors) for read-through.
    eco = _eco_neighbors(settings.output_dir)
    from newsagg.marketcap import seed_names

    all_names = seed_names(settings.output_dir)
    anchors = {t: _anchor_for(t, eco, caps, all_names) for t in names}
    sectors = _load(settings.output_dir / "sectors.json")

    fetched = fetch_missing(
        names, have, today, workers=args.workers, model=args.model, sectors=sectors,
        anchors=anchors, out_path=out_path, refetch=stale, base=existing,
    )
    merged = {**existing, **fetched}
    if not merged:
        logger.warning("no conviction data resolved (no key / API error); keeping existing file")
        return 1

    settings.output_dir.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(merged))
    withcall = sum(1 for v in merged.values() if v.get("ok"))
    logger.info("wrote %d conviction reads (+%d new, %d with a citable call)", len(merged), len(fetched), withcall)
    print(f"conviction: {len(merged)} (+{len(fetched)} new, {withcall} with a citable call)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
