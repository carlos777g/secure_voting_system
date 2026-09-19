#!/usr/bin/env python3
"""One-time admin setup: generates the election's RSA-OAEP keypair.

Deliberately NOT run automatically by the server or by tally.py. Every
other key in this system regenerates silently if missing (fine — those
are recoverable service-identity keys). This one is not: any vote already
encrypted against the old public key becomes permanently undecryptable if
this key is ever regenerated. Run this once, by hand, before voting opens.
Refuses to overwrite an existing keypair.
"""

import os
import sys

SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SERVICE_DIR)

from crypto_utils import (  # noqa: E402
    generate_election_keypair,
    private_key_to_pem,
    public_key_fingerprint,
    public_key_to_pem,
)

KEYS_DIR = os.environ.get("KEYS_DIR", os.path.join(SERVICE_DIR, "keys"))
PRIVATE_KEY_PATH = os.path.join(KEYS_DIR, "election_private.pem")
PUBLIC_KEY_PATH = os.path.join(KEYS_DIR, "election_public.pem")


def main() -> None:
    if os.path.exists(PRIVATE_KEY_PATH) or os.path.exists(PUBLIC_KEY_PATH):
        print(
            f"[generate-election-keys] refusing to overwrite: a keypair already exists at "
            f"{PRIVATE_KEY_PATH} / {PUBLIC_KEY_PATH}. Delete both by hand first if you are "
            f"certain no vote has ever been encrypted against the existing public key.",
            file=sys.stderr,
        )
        sys.exit(1)

    os.makedirs(KEYS_DIR, exist_ok=True)
    private_key, public_key = generate_election_keypair()

    with open(PRIVATE_KEY_PATH, "wb") as f:
        f.write(private_key_to_pem(private_key))
    with open(PUBLIC_KEY_PATH, "wb") as f:
        f.write(public_key_to_pem(public_key))

    os.chmod(PRIVATE_KEY_PATH, 0o600)

    fingerprint = public_key_fingerprint(public_key)
    print(f"[generate-election-keys] wrote {PUBLIC_KEY_PATH} and {PRIVATE_KEY_PATH} (fingerprint: {fingerprint})")
    print("[generate-election-keys] back up the private key now — losing it makes every vote unrecoverable")


if __name__ == "__main__":
    main()
