"""Local static file server that sends no-cache headers.

`python -m http.server` lets the browser cache index.html, so a freshly
rebuilt dashboard keeps showing the old bundle until you manually clear the
cache. This server tells the browser never to cache, so a plain refresh always
shows the latest build.

    python newsagg/deploy/serve.py [PORT] [DIRECTORY]
"""

from __future__ import annotations

import functools
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    directory = sys.argv[2] if len(sys.argv) > 2 else "."
    handler = functools.partial(NoCacheHandler, directory=directory)
    print(f"serving {directory} on http://localhost:{port} (no-cache)")
    HTTPServer(("", port), handler).serve_forever()


if __name__ == "__main__":
    main()
