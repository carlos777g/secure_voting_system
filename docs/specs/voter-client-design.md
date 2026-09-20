# voter-client Design

## Purpose

`tools/voter-client` is a Python CLI that lets a voter cast a vote: it takes
a ballot credential (issued by `eligibility-authority`) and a vote payload,
encrypts the vote so only `tally-authority` can ever read it, signs the
encrypted package so `ledger-node` can verify its integrity, and submits it
to the primary ledger node.

It never sends the voter's ephemeral signing key anywhere, and it never
holds any key capable of decrypting a vote.

## Scope

In scope: the CLI tool, its crypto helper module, and one small addition to
the already-built `ledger-node` (`GET /election-key`). Out of scope:
`tally-authority` itself (separate spec, built next) and any web client
(explicitly deferred — the crypto approach here is language-agnostic, so a
future web client can reuse it without backend changes).

## CLI interface

```
python voter_client.py --primary-url URL --credential-file PATH < vote.json
```

- `--primary-url` — base URL of the primary ledger-node (e.g. `http://localhost:4001`)
- `--credential-file` — path to a JSON file containing `{token, issued_at, expires_at, signature}`, as issued by `eligibility-authority`
- Vote JSON is read from **stdin** — an arbitrary JSON object, encrypted as-is, opaque to every component except `tally-authority`

Output: on success, the block JSON returned by the primary, printed to
stdout, exit code 0. On failure, a single human-readable line to stderr in
the form `[ErrorType] (code): message`, exit code 1.

## Flow

1. Read and parse `--credential-file`.
2. Read and parse the vote JSON from stdin.
3. `GET {primary-url}/election-key` → election RSA public key (PEM).
4. Generate an ephemeral Ed25519 keypair in memory (signing only; never persisted, never transmitted).
5. Generate a random AES-256 key and a 96-bit nonce.
6. `encrypted_vote = AES-GCM-encrypt(vote_json_bytes, aes_key, nonce)`.
7. `encrypted_aes_key = RSA-OAEP-encrypt(aes_key, election_public_key)`.
8. `ballot_token_hash = sha256(credential.token)` — must match what `ledger-node`'s `buildVoteBlock` recomputes from the same credential, so the two are provably bound together.
9. Canonicalize `{ballot_token_hash, encrypted_vote, nonce, encrypted_aes_key}` (byte-identical algorithm to `packages/shared/src/canonical.js`'s `canonicalStringify` — sorted keys, no extraneous whitespace) and sign with the ephemeral Ed25519 private key → `signature`.
10. `voter_public_key` = the ephemeral Ed25519 public key (PEM), included so `ledger-node` can verify `signature`. This proves the package wasn't altered in transit; it carries no voter identity, since the key is freshly generated per vote and discarded after.
11. `POST {primary-url}/votes` with body:
    ```json
    {
      "credential": { "token": "...", "issued_at": 0, "expires_at": 0, "signature": "..." },
      "vote": {
        "type": "anonymous_vote",
        "ballot_token_hash": "...",
        "encrypted_vote": "...",
        "nonce": "...",
        "encrypted_aes_key": "...",
        "signature": "...",
        "voter_public_key": "..."
      }
    }
    ```
    This exactly matches `validateVoteData`'s required fields in `packages/shared/src/schema.js`.
12. On HTTP 201: print the response body (the appended block) to stdout, exit 0.
13. On any failure (invalid credential file, malformed vote JSON, network error reaching the primary, non-201 response): print `[ErrorType] (code): message` to stderr, exit 1. `code` is the HTTP status when one exists, otherwise `N/A`.

## `ledger-node` addition: `GET /election-key`

Mirrors the existing `GET /public-key`. Serves a PEM file loaded from a new
`ELECTION_PUBLIC_KEY_PATH` config/env var at startup, read-only. This keeps
the "never holds a decryption-capable key" boundary intact — it only ever
serves the *public* half. Since `tally-authority` doesn't exist yet at this
point in the build, the initial value will be a placeholder key generated
alongside this change; wiring it to `tally-authority`'s real generated key
happens when that service is built next.

## Components

- `tools/voter-client/crypto_utils.py` — AES-GCM encrypt, RSA-OAEP encrypt,
  ephemeral Ed25519 keygen/sign, canonical JSON serialization (must
  byte-match the JS implementation — verified by a shared test fixture).
- `tools/voter-client/voter_client.py` — CLI entrypoint: argument parsing,
  orchestration of the flow above, HTTP calls (via `requests` or stdlib
  `urllib`), error formatting, exit codes.
- `tools/voter-client/requirements.txt` — pins `cryptography`.

## Error handling

Every distinct failure mode is caught and reported with its own error type,
never a bare traceback:

- `CredentialFileError` — file missing, unreadable, or not valid JSON / missing fields
- `VoteInputError` — stdin is not valid JSON
- `ElectionKeyFetchError` — `GET /election-key` failed or returned a non-PEM body
- `NetworkError` — could not reach the primary at all (connection refused, timeout)
- `VoteRejectedError` — primary responded with a non-201 status; message is the primary's own `error` field when present

## Testing

- `pytest` unit tests for `crypto_utils.py`: AES-GCM round-trip, RSA-OAEP
  round-trip, Ed25519 sign/verify round-trip, and canonical-JSON output
  compared byte-for-byte against fixtures generated from
  `packages/shared/src/canonical.js` (checked into the test fixtures so the
  Python test has no Node dependency at test time).
- One integration script (documented in `tools/voter-client/README.md`,
  matching the style of `apps/ledger-node/README.md`'s curl walkthrough)
  that runs the CLI against a live `dev-cluster`, end to end: issue a real
  credential from `eligibility-authority`, cast a real vote through
  `voter_client.py`, confirm the block appears in the primary's `/chain`.

## Out of scope / explicitly deferred

- A web-based voter client — same crypto approach, different frontend;
  left as a documented extension point for the team.
- `tally-authority`'s real election keypair generation — built next; this
  spec only requires that `ledger-node` can serve *some* PEM at
  `/election-key` so `voter-client` has something to integrate against
  today.
