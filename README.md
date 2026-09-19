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

ledger-node x N (Node.js, one process per port)
  - verifies the ballot token's signature and that it hasn't been used
  - appends the encrypted, opaque vote package as a block
  - gossips its chain with peers; flags nodes that diverge from the majority
  - never holds any key capable of decrypting a vote

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

Currently implemented: `packages/shared` (canonical JSON serialization,
block hashing, chain integrity checks, majority-hash divergence detection),
with a test suite covering the "sophisticated tamper" scenario — a locally
consistent chain that still disagrees with the network.

Not yet implemented: `eligibility-authority`, `ledger-node`,
`tally-authority`, `voter-client`.

## Setup

JS workspace:

```bash
pnpm install
pnpm --filter @secure-voting/shared test
```

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
