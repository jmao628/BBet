"""Local static file server (no-cache) with a small live-quote endpoint.

`python -m http.server` lets the browser cache index.html, so a freshly
rebuilt dashboard keeps showing the old bundle until you manually clear the
cache. This server tells the browser never to cache, so a plain refresh always
shows the latest build.

It also serves ONE dynamic route so a ticker's chart + technicals refresh the
moment you open it, instead of only once a day when the launchd job runs:

    GET /api/quote?ticker=NVDA
        → live yfinance fetch for that one ticker, computed through the same
          newsagg.technical math, returned as JSON (same shape as a row in
          technical_latest.json) + a `generated_at` timestamp.

The fetch needs Yahoo reachable — behind a VPN, run the web job with a proxy
(install_mac.sh passes PROXY= into the plist; yfinance honours HTTPS_PROXY).

    python newsagg/deploy/serve.py [PORT] [DIRECTORY]
"""

from __future__ import annotations

import functools
import json
import sys
from datetime import datetime, timezone
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import parse_qs, urlparse


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if urlparse(self.path).path == "/api/quote":
            self._serve_quote()
            return
        super().do_GET()

    def _send_json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_quote(self) -> None:
        params = parse_qs(urlparse(self.path).query)
        ticker = (params.get("ticker", [""])[0] or "").strip().upper()
        if not ticker:
            self._send_json(400, {"error": "missing ticker"})
            return
        try:
            from newsagg import technical as tech

            bars = tech._fetch_bars(ticker)
            out = tech.compute_ticker(bars, tech.TechParams()) if bars else None
        except Exception as exc:  # noqa: BLE001
            self._send_json(502, {"error": f"fetch failed: {exc}"})
            return
        if not out:
            self._send_json(404, {"error": f"no data for {ticker}"})
            return
        out["ticker"] = ticker
        out["generated_at"] = datetime.now(timezone.utc).isoformat()
        self._send_json(200, out)

    # Quieter logging — the default logs every poll request.
    def log_message(self, *args) -> None:  # noqa: D401
        pass


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    directory = sys.argv[2] if len(sys.argv) > 2 else "."
    # Make `newsagg` importable for the live-quote endpoint (directory = repo root).
    if directory not in sys.path:
        sys.path.insert(0, directory)
    handler = functools.partial(NoCacheHandler, directory=directory)
    print(f"serving {directory} on http://localhost:{port} (no-cache, +live quotes)")
    HTTPServer(("", port), handler).serve_forever()


if __name__ == "__main__":
    main()
