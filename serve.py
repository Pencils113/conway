"""Tiny dev server for the Conway site.

Run with:  uv run serve.py
"""
from __future__ import annotations

import argparse
import http.server
import socketserver
import sys
from pathlib import Path


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js":  "application/javascript; charset=utf-8",
        ".mjs": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".svg": "image/svg+xml",
        "":     "application/octet-stream",
    }

    def end_headers(self) -> None:
        # No caching during development.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format: str, *args) -> None:
        sys.stderr.write(f"  {self.address_string()} - {format % args}\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent
    import os
    os.chdir(root)

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer((args.host, args.port), Handler) as httpd:
        url = f"http://{args.host}:{args.port}/"
        print(f"\n  conway · serving {root}\n  → {url}\n  (ctrl+c to stop)\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  bye.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
