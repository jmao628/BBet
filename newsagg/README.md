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

## SeekingAlpha tracker + live web page

A separate track from the RSS pipeline: scrape the **Top Performing Analysts**
page for their **Buy / Strong Buy** calls, plus the homepage **Tech &
Communication** ticker widgets (Latest Quant Ratings + Latest Analyst
Coverage), and show it all on an auto-refreshing web page.

These SA pages are JS-rendered and personalized behind the paywall, so we drive
a real headless browser (Playwright) with your login cookie.

### One-time setup

```bash
pip install -r newsagg/requirements.txt
python -m playwright install chromium        # downloads the browser (~150MB)
```

### Connect your paid account (once)

Log in once in a real browser window; the session is saved locally and reused:

```bash
python -m newsagg.sa_login
```

A browser opens — log into SeekingAlpha yourself (captcha / 2FA are fine), then
press Enter in the terminal. Your session is saved to
`data/newsagg/sa_auth.json` on your machine only (gitignored, never
transmitted). The scraper picks it up automatically. Re-run this whenever the
session expires. (Alternatively, set a raw `SA_COOKIE` in `.env`, but the login
helper is easier and more reliable.)

### Scrape

```bash
python -m newsagg.sa_scrape             # one scrape -> data/newsagg/seekingalpha_latest.json
python -m newsagg.sa_scrape --watch 15  # keep re-scraping every 15 min (for the live page)
python -m newsagg.sa_scrape --recon     # capture debug artifacts only (first run / fixing selectors)
python -m newsagg.sa_scrape --headed    # watch the browser work (debugging)
```

Every run also writes recon artifacts to `data/newsagg/sa_debug/` — screenshots,
rendered HTML, and every SA `/api/` JSON response. SA changes its markup often;
if a section comes back empty, those artifacts are how we lock in exact
extraction.

### View the live page

Serve the repo root and open the page — it reads
`seekingalpha_latest.json` and auto-refreshes every 60s:

```bash
python -m http.server 8000        # run from the BBet repo root
```

Then open <http://localhost:8000/newsagg/web/>. For a truly live board, run the
scraper in `--watch` mode in one terminal and the web server in another.

### Notes on robustness

- Each collector is isolated: one failing source doesn't sink the run (errors
  are collected and surfaced in the summary).
- No secrets? Collectors degrade gracefully — SA returns RSS summaries only
  without a cookie; YouTube is skipped without an API key.
- HTTP has exponential-backoff retry (2s/4s/8s/16s) on 429/5xx.
- De-dup here is only syntactic (same URL). Semantic de-dup (same ticker +
  catalyst + nearby date) is a step-2 concern, after the LLM extracts fields.
