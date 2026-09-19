#!/usr/bin/env python3
"""voter-client: casts a vote against a secure-voting-system ledger-node.

Usage:
    python voter_client.py --primary-url URL --tally-authority-url URL \
        --credential-file PATH < vote.json

Reads the vote payload (arbitrary JSON) from stdin, encrypts it for the
election's decryption key, signs the encrypted package with a fresh
ephemeral keypair, and submits it to the primary. Prints the resulting
block on success; prints a single "[ErrorType] (code): message" line to
stderr and exits non-zero on any failure.
"""

import argparse
import json
import sys

import requests

from crypto_utils import build_encrypted_vote, load_rsa_public_key


class CredentialFileError(Exception):
    pass


class VoteInputError(Exception):
    pass


class ElectionKeyFetchError(Exception):
    pass


class NetworkError(Exception):
    pass


class VoteRejectedError(Exception):
    def __init__(self, status_code, message):
        super().__init__(message)
        self.status_code = status_code


def fail(error_type: str, code, message: str) -> None:
    print(f"[{error_type}] ({code}): {message}", file=sys.stderr)
    sys.exit(1)


def load_credential(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            credential = json.load(f)
    except OSError as err:
        raise CredentialFileError(f"could not read {path}: {err}") from err
    except json.JSONDecodeError as err:
        raise CredentialFileError(f"{path} is not valid JSON: {err}") from err

    if (
        isinstance(credential, dict)
        and set(credential.keys()) == {"credential"}
        and isinstance(credential["credential"], dict)
    ):
        credential = credential["credential"]

    required = {"token", "issued_at", "expires_at", "signature"}
    missing = required - credential.keys()
    if missing:
        raise CredentialFileError(f"{path} is missing field(s): {', '.join(sorted(missing))}")
    return credential


def read_vote_from_stdin() -> dict:
    raw = sys.stdin.read()
    try:
        return json.loads(raw)
    except json.JSONDecodeError as err:
        raise VoteInputError(f"stdin is not valid JSON: {err}") from err


def fetch_election_public_key(tally_authority_url: str):
    try:
        response = requests.get(f"{tally_authority_url}/public-key", timeout=10)
    except requests.RequestException as err:
        raise ElectionKeyFetchError(f"could not reach {tally_authority_url}/public-key: {err}") from err

    if response.status_code != 200:
        raise ElectionKeyFetchError(f"GET /public-key returned {response.status_code}")

    try:
        return load_rsa_public_key(response.content)
    except ValueError as err:
        raise ElectionKeyFetchError(f"response body is not a valid PEM public key: {err}") from err


def submit_vote(primary_url: str, credential: dict, vote: dict) -> dict:
    body = {"credential": credential, "vote": vote}
    try:
        response = requests.post(f"{primary_url}/votes", json=body, timeout=10)
    except requests.RequestException as err:
        raise NetworkError(f"could not reach {primary_url}/votes: {err}") from err

    if response.status_code != 201:
        try:
            message = response.json().get("error", response.text)
        except ValueError:
            message = response.text
        raise VoteRejectedError(response.status_code, message)

    return response.json()


def main() -> None:
    parser = argparse.ArgumentParser(description="Cast a vote against a ledger-node primary.")
    parser.add_argument("--primary-url", required=True, help="Base URL of the primary ledger-node")
    parser.add_argument("--tally-authority-url", required=True, help="Base URL of tally-authority")
    parser.add_argument("--credential-file", required=True, help="Path to a JSON ballot credential")
    args = parser.parse_args()

    primary_url = args.primary_url.rstrip("/")
    tally_authority_url = args.tally_authority_url.rstrip("/")

    try:
        credential = load_credential(args.credential_file)
        vote_content = read_vote_from_stdin()
        election_public_key = fetch_election_public_key(tally_authority_url)
        vote = {
            "type": "anonymous_vote",
            **build_encrypted_vote(vote_content, credential["token"], election_public_key),
        }
        block = submit_vote(primary_url, credential, vote)
    except CredentialFileError as err:
        fail("CredentialFileError", "N/A", str(err))
    except VoteInputError as err:
        fail("VoteInputError", "N/A", str(err))
    except ElectionKeyFetchError as err:
        fail("ElectionKeyFetchError", "N/A", str(err))
    except NetworkError as err:
        fail("NetworkError", "N/A", str(err))
    except VoteRejectedError as err:
        fail("VoteRejectedError", err.status_code, str(err))
    else:
        print(json.dumps(block, indent=2))
        sys.exit(0)


if __name__ == "__main__":
    main()
