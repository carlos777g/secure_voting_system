# Secure Voting (Educational Project)

An educational voting system that separates ballot secrecy from ledger
integrity across independent processes 
This demonstrates why a single hash-chained log is not, by itself, a
blockchain — multi-node consensus is what makes tampering detectable (anterior version)

## Architecture

```
eligibility-authority (Node.js, single instance)
  - voter roll (SQLite)
  - issues signed, single-use ballot tokens
  - never sees vote content

voter-client (Python CLI)
  - generates an ephemeral keypair locally, never sent to any server
  - encrypts (AES-GCM + RSA-OAEP) and signs (RSA-PSS) the vote
  - submits the encrypted package to any ledger-node

ledger-node x N (Node.js, one process per port; one "primary", the rest "replica")
  - primary: verifies the ballot token's signature and that it hasn't been
    used, appends the vote as a block, broadcasts it to every replica
  - replica: independently validates every broadcast block before
    appending it — never trusts the primary blindly
  - all nodes: /sync compares chains across peers and flags divergence;
    never holds any key capable of decrypting a vote

tally-authority (Python, separate service)
  - the only holder of the election's decryption private key
  - reads the consolidated chain via the ledger-nodes' API
  - decrypts and counts, after voting closes
  - does not participate in ledger consensus
```

## Repository layout

```
apps/
  eligibility-authority/   Express app — voter roll and ballot token issuance
  ledger-node/              Express app — run N times, one port per node
services/
  tally-authority/          Python service — election decryption key + count
tools/
  voter-client/              Python CLI — casts a vote
packages/
  shared/                    JS: canonical hashing, block schema, consensus
docs/
  THREAT_MODEL.md            What this protects, and what it explicitly does not
```

## Status

Currently implemented:

- `packages/shared` — canonical JSON serialization, block hashing, chain
  integrity checks, majority-hash divergence detection. Test suite covers
  the "sophisticated tamper" scenario: a locally consistent chain that
  still disagrees with the network.
- `apps/eligibility-authority` — voter roll (SQLite), Ed25519-signed,
  time-limited ballot credentials, race-free issuance (single
  synchronous transaction), idempotent reissue of an unexpired credential.
  See `apps/eligibility-authority/README.md` for the `has_voted`-at-issuance
  tradeoff, its operational cost, and a suggested (unimplemented) admin
  extension point for the team.

- `apps/ledger-node` — primary/replica replicated ledger. The primary
  accepts votes and proposes blocks; every replica independently validates
  each broadcast block (chain continuity, hash correctness, signature)
  before appending it. Two complementary tamper-detection mechanisms —
  local signature authentication and cross-node majority comparison — are
  documented and demonstrated live in `apps/ledger-node/README.md`,
  including a reproducible `curl` walkthrough of both the
  "compromised replica" and "compromised primary" scenarios.
- `tools/voter-client` — Python CLI. Generates an ephemeral Ed25519
  keypair per vote (in memory only, never persisted or transmitted),
  encrypts the vote with AES-GCM, wraps the AES key with the election's
  RSA-OAEP public key (fetched from `tally-authority`), signs the package,
  and submits it to the primary. See `tools/voter-client/README.md`.
- `services/tally-authority` — the only holder of the election's RSA
  decryption key. Serves its public key over HTTP from the start of
  voting (`GET /public-key`, stdlib `http.server`, no framework); after
  voting closes, a separate CLI script fetches the **raw** chain from
  every configured `ledger-node` independently, computes majority
  agreement itself block by block (never trusting any node's own
  `/sync`), and counts only blocks that reach majority — anything that
  doesn't is excluded from the count and reported explicitly, never
  silently dropped. See `services/tally-authority/README.md`.

Everything described above is implemented and covered by tests.

## Setup

One-time install:

```bash
pnpm install
pip install -r tools/voter-client/requirements.txt
pip install -r services/tally-authority/requirements.txt
```

`eligibility-authority` reads its configuration from environment variables
(see `apps/eligibility-authority/.env.example`); copy it to `.env` in that
directory to override defaults locally. The Python services aren't part of
the pnpm workspace — each has its own `requirements.txt`, documented in
its own README.

```bash
pnpm test           # runs every JS workspace package's test script
pytest tools/voter-client services/tally-authority   # Python test suites
```

## Running the whole system

**Starting every service is one command:**

```bash
pnpm dev:all
```

This starts `eligibility-authority` (:4000), the 3-node `ledger-node`
cluster (:4001–4003, one primary + two replicas), and `tally-authority`'s
public-key server (:5000) — five processes, one command. It's safe to
re-run: election keypair generation is bundled in but idempotent (the
generator refuses to overwrite an existing keypair, so this never
regenerates one silently — see `services/tally-authority/README.md` for
why that specific key is treated differently from every other key in the
system).

**Casting a vote and tallying stay separate, deliberate commands** — this
isn't a limitation, it's the point: a real election has many independent
voters acting over time, and exactly one counting step that only happens
after voting closes. Collapsing those into the startup command would
misrepresent what the system actually demonstrates.

```bash
# 1. get a real ballot credential for a voter (three demo voters exist:
#    VOTANTE001, VOTANTE002, VOTANTE003)
curl -s -X POST http://localhost:4000/identify \
  -H "Content-Type: application/json" \
  -d '{"voter_id":"VOTANTE001"}' \
  | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)['credential']))" \
  > credential.json

# 2. cast the vote (any JSON object) through the primary
echo '{"candidate":"alice"}' | python tools/voter-client/voter_client.py \
  --primary-url http://localhost:4001 \
  --tally-authority-url http://localhost:5000 \
  --credential-file credential.json

# repeat steps 1-2 for VOTANTE002, VOTANTE003, ... as many voters as you like

# 3. after voting closes, tally — queries every ledger-node independently
python services/tally-authority/tally.py \
  --ledger-urls http://localhost:4001,http://localhost:4002,http://localhost:4003
```

The tally's output reports both the vote counts and any block that failed
to reach majority agreement across nodes — see
`services/tally-authority/README.md` for what that looks like when a node
is tampered with, and `apps/ledger-node/README.md` for the `POST
/admin/tamper` demo endpoint used to simulate it (local/educational use
only — no authentication, never expose it otherwise).

## Deployment note for the team

Ledger nodes currently run as plain Node processes on localhost, on
different ports, with no containerization — this was a deliberate
simplification to keep the educational focus on consensus logic rather
than container networking. If you want to move this to Docker (one
container per ledger node, a Docker network in place of localhost ports),
that is a reasonable next step and does not require changes to
`packages/shared` — only to how each `ledger-node` process is started and
how peers are addressed.
