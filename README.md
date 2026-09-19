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

Not yet implemented: `tally-authority`, `voter-client`.

## Setup

JS workspace:

```bash
pnpm install
pnpm test          # runs every workspace package's test script
pnpm dev            # runs every workspace package's dev script, in parallel
                     # (currently only eligibility-authority has one)
```

`eligibility-authority` reads its configuration from environment variables
(see `apps/eligibility-authority/.env.example`); copy it to `.env` in that
directory to override defaults locally.

Python services (once implemented) will each have their own
`requirements.txt` / virtual environment, documented in their own
directories, since they are not part of the pnpm workspace.

## Deployment note for the team

Ledger nodes currently run as plain Node processes on localhost, on
different ports, with no containerization — this was a deliberate
simplification to keep the educational focus on consensus logic rather
than container networking. If you want to move this to Docker (one
container per ledger node, a Docker network in place of localhost ports),
that is a reasonable next step and does not require changes to
`packages/shared` — only to how each `ledger-node` process is started and
how peers are addressed.
