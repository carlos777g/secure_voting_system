#!/usr/bin/env python3
"""tally-authority's public-key server: serves the election's RSA-OAEP
public key over GET /public-key, mirroring the pattern eligibility-authority
and ledger-node already use for their own keys. Runs from before voting
opens; does nothing decryption-related. Fails hard at startup if the
election keypair hasn't been generated yet — see scripts/generate-election-keys.py.
"""

import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

KEYS_DIR = os.environ.get("KEYS_DIR", os.path.join(os.path.dirname(__file__), "keys"))
PUBLIC_KEY_PATH = os.path.join(KEYS_DIR, "election_public.pem")
PORT = int(os.environ.get("PORT", "5000"))


def load_public_key_pem() -> bytes:
    try:
        with open(PUBLIC_KEY_PATH, "rb") as f:
            return f.read()
    except OSError as err:
        print(
            f"[tally-authority] could not read election public key at {PUBLIC_KEY_PATH}: {err}\n"
            "[tally-authority] run scripts/generate-election-keys.py once before starting this server.",
            file=sys.stderr,
        )
        sys.exit(1)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quieter default logging
        sys.stderr.write(f"[tally-authority] {self.address_string()} - {fmt % args}\n")

    def do_GET(self):
        if self.path == "/health":
            self._respond(200, b'{"status":"ok"}', "application/json")
        elif self.path == "/public-key":
            self._respond(200, self.server.public_key_pem, "text/plain")
        else:
            self._respond(404, b"not found", "text/plain")

    def _respond(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    public_key_pem = load_public_key_pem()
    httpd = HTTPServer(("0.0.0.0", PORT), Handler)
    httpd.public_key_pem = public_key_pem
    print(f"[tally-authority] serving GET /public-key on :{PORT}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
