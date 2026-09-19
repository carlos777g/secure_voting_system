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
  --credential-file credential.json
```

- `--primary-url` — base URL of the primary `ledger-node`
- `--credential-file` — path to a JSON file with `{token, issued_at, expires_at, signature}`, as returned by `eligibility-authority`'s `POST /identify`
- The vote itself (any JSON object) is read from **stdin**

On success, prints the appended block (JSON) to stdout and exits `0`. On
failure, prints one line to stderr in the form `[ErrorType] (code):
message` and exits `1`. Error types: `CredentialFileError`,
`VoteInputError`, `ElectionKeyFetchError`, `NetworkError`,
`VoteRejectedError`.

## Reproducing an end-to-end vote by hand

```bash
# from the repo root, with eligibility-authority (:4000) and the
# ledger-node dev-cluster (:4001-4003) already running, and
# apps/ledger-node/keys/election_public.pem present — generate it with:
#   node apps/ledger-node/scripts/generate-election-key.js

# 1. get a real credential
curl -s -X POST http://localhost:4000/identify \
  -H "Content-Type: application/json" \
  -d '{"voter_id":"VOTANTE001"}' \
  | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)['credential']))" \
  > credential.json

# 2. cast the vote through the primary
echo '{"candidate":"alice","choice_id":1}' | python voter_client.py \
  --primary-url http://localhost:4001 \
  --credential-file credential.json

# 3. confirm it replicated
curl -s http://localhost:4002/chain | python3 -m json.tool
curl -s http://localhost:4003/chain | python3 -m json.tool

# 4. voting again with the same credential is rejected
echo '{"candidate":"bob"}' | python voter_client.py \
  --primary-url http://localhost:4001 \
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

## Why `GET /election-key` lives on ledger-node, not here

The voter-client fetches the election's RSA-OAEP public key from the
primary instead of carrying its own copy of the file, so voters don't need
to manage an extra key file. This only ever serves the *public* half —
`ledger-node` still never holds anything capable of decrypting a vote. See
`apps/ledger-node/README.md` and `apps/ledger-node/scripts/generate-election-key.js`
for the placeholder keypair used until `tally-authority` generates the real
one.
