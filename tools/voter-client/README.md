# voter-client

A Python CLI that casts a vote: it takes a ballot credential from
`eligibility-authority`, encrypts a vote so only `tally-authority` can ever
read it, signs the encrypted package, and submits it to the primary
`ledger-node`.

The signing keypair is generated fresh in memory for every vote and
discarded immediately after — it never touches disk and is never sent
anywhere. `voter_public_key` in the submitted package exists so whoever
later decrypts the vote can verify it wasn't altered in transit; since the
key is freshly generated per vote, it carries no voter identity.

## Setup

```bash
pip install -r requirements.txt
```

## Usage

```bash
echo '{"candidate":"alice"}' | python voter_client.py \
  --primary-url http://localhost:4001 \
  --tally-authority-url http://localhost:5000 \
  --credential-file credential.json
```

- `--primary-url` — base URL of the primary `ledger-node`
- `--tally-authority-url` — base URL of `tally-authority`, used only to fetch its public key (`GET /public-key`) for encrypting the vote — it never sees the plaintext
- `--credential-file` — path to a JSON file with `{token, issued_at, expires_at, signature}`, as returned by `eligibility-authority`'s `POST /identify`
- The vote itself (any JSON object) is read from **stdin**

On success, prints the appended block (JSON) to stdout and exits `0`. On
failure, prints one line to stderr in the form `[ErrorType] (code):
message` and exits `1`. Error types: `CredentialFileError`,
`VoteInputError`, `ElectionKeyFetchError`, `NetworkError`,
`VoteRejectedError`.

## Reproducing an end-to-end vote by hand

```bash
# from the repo root, with eligibility-authority (:4000), the ledger-node
# dev-cluster (:4001-4003), and tally-authority's key server (:5000)
# already running (see services/tally-authority/README.md for setup)

# 1. get a real credential
curl -s -X POST http://localhost:4000/identify \
  -H "Content-Type: application/json" \
  -d '{"voter_id":"VOTANTE001"}' \
  | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)['credential']))" \
  > credential.json

# 2. cast the vote through the primary
echo '{"candidate":"alice","choice_id":1}' | python voter_client.py \
  --primary-url http://localhost:4001 \
  --tally-authority-url http://localhost:5000 \
  --credential-file credential.json

# 3. confirm it replicated
curl -s http://localhost:4002/chain | python3 -m json.tool
curl -s http://localhost:4003/chain | python3 -m json.tool

# 4. voting again with the same credential is rejected
echo '{"candidate":"bob"}' | python voter_client.py \
  --primary-url http://localhost:4001 \
  --tally-authority-url http://localhost:5000 \
  --credential-file credential.json
# -> [VoteRejectedError] (400): this ballot token has already been used
```

## Tests

```bash
pytest
```

Covers `crypto_utils.py`'s AES-GCM/RSA-OAEP/Ed25519 round trip and verifies
`canonical_json` byte-matches `packages/shared/src/canonical.js`'s
`canonicalStringify` against fixtures generated from the JS implementation
(no Node dependency at test time — see the fixtures' comment in
`test_crypto_utils.py` for how to regenerate them if `canonical.js`
changes).

## Why the election key comes from tally-authority, not ledger-node

`voter-client` fetches the election's RSA-OAEP public key directly from
`tally-authority`'s own `GET /public-key` — the same pattern
`eligibility-authority` and every `ledger-node` already use to publish
their own public keys. `ledger-node` never serves this key: it doesn't
custody it, and having it "vouch" for a key that belongs to a different,
independent service would be exactly the kind of cross-service filesystem
or API coupling this project avoids elsewhere. See
`services/tally-authority/README.md` for how the keypair is generated and
served.
