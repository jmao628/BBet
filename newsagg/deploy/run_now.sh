#!/bin/bash
#
# Force a full same-day refresh, in dependency order:
#   scrape  — re-pull the SA homepage (picks up any newly-added tickers)
#   marketcap / technical — re-fetch caps + price-volume for the updated universe
#   heat    — accumulate today's social mentions
#   supplychain / catalyst — LLM maps + catalyst discovery (new + stale re-fetch)
#
# The daily launchd jobs already do this automatically; use this only when you
# want new tickers pulled in *right now* instead of waiting for the next run.
#
# yfinance (marketcap + technical) needs Yahoo reachable. Behind a VPN, pass the
# proxy:  PROXY=http://127.0.0.1:3213 bash newsagg/deploy/run_now.sh
#
# Each step is best-effort: if one fails (e.g. SA blocked, VPN down), the rest
# still run and previously-good data is kept.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PY="$REPO_DIR/.venv/bin/python"
[[ -x "$PY" ]] || PY="python"

PROXY="${PROXY:-}"
if [[ -n "$PROXY" ]]; then
  export HTTPS_PROXY="$PROXY" HTTP_PROXY="$PROXY"
fi

cd "$REPO_DIR"
echo "Repo:   $REPO_DIR"
echo "Python: $PY"
[[ -n "$PROXY" ]] && echo "Proxy:  $PROXY" || echo "Proxy:  (none — set PROXY= if yfinance can't reach Yahoo)"
echo

echo "▶ 1/6 scrape  — refresh SA universe…"
"$PY" -m newsagg.sa_scrape || echo "  (scrape failed; keeping existing universe)"
echo "▶ 2/6 marketcap…"
"$PY" -m newsagg.marketcap || echo "  (marketcap failed; keeping existing caps)"
echo "▶ 3/6 technical…"
"$PY" -m newsagg.technical || echo "  (technical failed; keeping existing technicals)"
echo "▶ 4/6 sectors…"
"$PY" -m newsagg.sectors || echo "  (sectors failed; keeping existing sectors)"
echo "▶ 5/7 heat…"
"$PY" -m newsagg.heat || echo "  (heat failed; keeping existing heat)"
echo "▶ 6/7 supplychain (needs ANTHROPIC_API_KEY; skipped if unset)…"
"$PY" -m newsagg.supplychain || echo "  (supplychain skipped/failed; keeping existing maps)"
echo "▶ 7/7 catalyst (needs OPENAI_API_KEY; new focus names + stale re-fetch)…"
"$PY" -m newsagg.catalyst --limit "${CAT_LIMIT:-60}" --max-age "${CAT_MAX_AGE:-4}" || echo "  (catalyst skipped/failed; keeping existing catalysts)"

echo
echo "✓ done — hard-refresh the dashboard (Cmd+Shift+R) to see the updated universe."
