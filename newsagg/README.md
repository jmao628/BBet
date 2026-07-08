# newsagg — Financial News Aggregation

Turns a watchlist of tickers into a **daily bullish-seed table** by collecting
opinions from SeekingAlpha, Substack, and Schwab's YouTube channel, plus social
heat from Ape Wisdom, then normalizing each piece with an LLM.

```
step 1  collectors   ─► raw_items.json + mentions.json   ← YOU ARE HERE
step 2  normalize    ─► LLM extracts {is_bull, ticker, reasoning, ...}
step 3  web display  ─► daily bullish seed table
```

## Step 1: the collection layer

| Source | How | Output |
|---|---|---|
| **SeekingAlpha** | per-ticker RSS `/api/sa/combined/{TICKER}.xml` for title/author/date; login cookie to scrape paywalled full text | `RawItem` (full body) |
| **Substack** | per-publication RSS `{pub}.substack.com/feed` (full text by default) | `RawItem` (full body) |
| **Schwab** | YouTube Data API for new video titles/descriptions; `yt-dlp` for transcripts | `RawItem` |
| **X (via Ape Wisdom)** | free JSON API for per-ticker daily mention counts | `MentionEntry` (heat only) |

Ape Wisdom output is **heat/popularity raw material** — it never becomes a seed
on its own; it gets joined onto seeds in step 2.

### Setup

```bash
pip install -r newsagg/requirements.txt

cp newsagg/config.example.yaml newsagg/config.yaml   # fill in your lists
cp newsagg/.env.example .env                         # fill in secrets
```

Edit `newsagg/config.yaml`:
- `seekingalpha.tickers` — tickers whose SA feed to subscribe to
- `substack.publications` — publication subdomains
- `schwab_youtube.channel_id` (or `channel_handle`)
- `watchlist` — union universe used to filter Ape Wisdom

Edit `.env`:
- `SA_COOKIE` — SeekingAlpha login cookie (for paywalled full text)
- `YOUTUBE_API_KEY` — YouTube Data API v3 key

### Run

```bash
python -m newsagg.cli            # collect everything, dump JSON to data/newsagg/
python -m newsagg.cli --no-write # summary only
python -m newsagg.cli -v         # debug logging
```

Output lands in `data/newsagg/`:
- `raw_items_YYYY-MM-DD.json` — the documents (feeds the step-2 LLM)
- `mentions_YYYY-MM-DD.json` — per-ticker social mention counts

### Notes on robustness

- Each collector is isolated: one failing source doesn't sink the run (errors
  are collected and surfaced in the summary).
- No secrets? Collectors degrade gracefully — SA returns RSS summaries only
  without a cookie; YouTube is skipped without an API key.
- HTTP has exponential-backoff retry (2s/4s/8s/16s) on 429/5xx.
- De-dup here is only syntactic (same URL). Semantic de-dup (same ticker +
  catalyst + nearby date) is a step-2 concern, after the LLM extracts fields.
