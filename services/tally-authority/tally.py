#!/usr/bin/env python3
"""tally.py: the sensitive, manually-triggered half of tally-authority.

Run once, after voting closes, by an admin who holds the election private
key. Fetches the RAW /chain from every configured ledger-node (never a
node's own /sync result), computes majority agreement itself block by
block, decrypts and counts only the blocks that reached majority, and
reports any divergence explicitly rather than silently dropping it.

Usage:
    python tally.py --ledger-urls http://localhost:4001,http://localhost:4002,http://localhost:4003
"""

import argparse
import json
import sys
from pathlib import Path

import requests

from crypto_utils import VoteIntegrityError, decrypt_and_verify_vote, load_private_key, public_key_fingerprint
from majority import compute_majority_chain

SCRIPT_DIR = Path(__file__).resolve().parent
KEYS_DIR_DEFAULT = SCRIPT_DIR / "keys"


def fetch_chain(url: str) -> list:
    response = requests.get(f"{url}/chain", timeout=15)
    response.raise_for_status()
    return response.json()["chain"]


def run_tally(ledger_urls: list, private_key) -> dict:
    chains_by_node_id = {}
    for url in ledger_urls:
        chain = fetch_chain(url)
        # keyed by URL, not the node's self-reported nodeId, so a
        # misconfigured or malicious node can't collide its identity with
        # another node's to dodge being counted as a distinct voice.
        chains_by_node_id[url] = chain

    result = compute_majority_chain(chains_by_node_id)

    tally = {}
    integrity_failures = []
    counted_vote_count = 0

    for entry in result["counted_blocks"]:
        data = entry["block"]["data"]
        if data.get("type") != "anonymous_vote":
            continue  # genesis block, or any future non-vote block type
        try:
            vote = decrypt_and_verify_vote(data, private_key)
        except VoteIntegrityError as err:
            integrity_failures.append({"index": entry["index"], "reason": str(err)})
            continue
        counted_vote_count += 1
        key = json.dumps(vote, sort_keys=True)
        tally[key] = tally.get(key, 0) + 1

    return {
        "tally": [{"vote": json.loads(k), "count": v} for k, v in tally.items()],
        "total_counted_votes": counted_vote_count,
        "excluded_divergent_blocks": result["divergent"],
        "integrity_failures": integrity_failures,
        "nodes_queried": ledger_urls,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Decrypt and count votes from the ledger.")
    parser.add_argument(
        "--ledger-urls",
        required=True,
        help="Comma-separated base URLs of every ledger-node to query (all must respond)",
    )
    parser.add_argument(
        "--private-key-path",
        default=str(KEYS_DIR_DEFAULT / "election_private.pem"),
        help="Path to the election private key (default: keys/election_private.pem)",
    )
    args = parser.parse_args()

    ledger_urls = [url.strip().rstrip("/") for url in args.ledger_urls.split(",") if url.strip()]
    if len(ledger_urls) < 2:
        print("[TallyError] (N/A): need at least 2 ledger-node URLs to compute majority", file=sys.stderr)
        sys.exit(1)

    try:
        with open(args.private_key_path, "rb") as f:
            private_key = load_private_key(f.read())
    except OSError as err:
        print(f"[KeyLoadError] (N/A): could not read {args.private_key_path}: {err}", file=sys.stderr)
        sys.exit(1)

    fingerprint = public_key_fingerprint(private_key.public_key())
    print(f"[tally] loaded private key from {args.private_key_path} (public key fingerprint: {fingerprint})", file=sys.stderr)

    try:
        result = run_tally(ledger_urls, private_key)
    except requests.RequestException as err:
        print(f"[NetworkError] (N/A): a configured ledger-node did not respond: {err}", file=sys.stderr)
        sys.exit(1)

    print(json.dumps(result, indent=2))

    if result["excluded_divergent_blocks"] or result["integrity_failures"]:
        sys.exit(2)  # counted successfully, but flag that the result needs human review


if __name__ == "__main__":
    main()
