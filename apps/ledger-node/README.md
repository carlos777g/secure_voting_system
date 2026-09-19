# ledger-node

A hash-chained, replicated ledger for encrypted, opaque vote packages. Run
as a small cluster: one `primary`, N `replica`s.

## Why single-writer, not fully decentralized

An earlier version of this design let any node accept a vote independently.
That does not converge: three nodes each appending whatever vote happened
to arrive at them produce three genuinely different chains even with zero
malicious behavior, because nothing orders the writes. "Compare hashes,
majority wins" is meaningless if honest nodes routinely disagree by
default.

The fix: only the `primary` accepts vote submissions (`POST /votes`) and
proposes blocks. It broadcasts each new block to every configured peer
(`POST /peer/blocks`). Every replica **independently validates** an
incoming block before appending it — it does not trust the primary's word,
it checks:

1. the block extends its own current tip (`previousHash` matches),
2. the block's `hash` is correctly derived from its own content,
3. the block's `signature` verifies against the primary's known public key,
4. the block's `ballot_token_hash` hasn't already been seen locally.

If any of these fail, the replica rejects the block and does not append
it. See `src/replication.js`.

## Two tamper-detection mechanisms, and why you need both

**Mechanism 1 — local signature authentication.** Every non-genesis block
must be signed by the primary's private key. An attacker who compromises a
**replica** gets that replica's process and its own Ed25519 key — nothing
else. If they rewrite the replica's local chain, they can recompute hashes
correctly, but they cannot produce a signature the primary's public key
will accept, because they don't hold the primary's private key. This is
caught *locally*, by the tampered node itself or by anyone reading its
`/sync` result — no comparison against other nodes required.
See `packages/shared/src/block.js` → `isChainAuthenticallySigned`.

**Mechanism 2 — cross-node majority comparison.** Mechanism 1 cannot catch
the primary compromising *itself*: the primary holds its own real private
key, so it can rewrite its own history and re-sign it validly. A
self-check against its own signature will still pass. The only thing that
catches this is comparing the primary's chain against independent copies
held by replicas — if two replicas still hold the original block and the
primary now holds something else, majority-hash agreement flags the
primary as the divergent one. See `packages/shared/src/consensus.js` →
`detectDivergence`, invoked from `src/sync.js`.

Verified live, not just in unit tests — see the two scenarios below.

## Running the demo cluster

```bash
# from the repo root, with eligibility-authority already running on :4000
pnpm --filter @secure-voting/ledger-node dev
# starts node-a (primary, :4001), node-b and node-c (replicas, :4002/:4003)
```

## Reproducing both tamper scenarios by hand

```bash
# 1. cast a real vote through the primary (see README root for the full
#    identify -> credential -> vote flow), then:

# Scenario A — compromise a REPLICA directly
curl -X POST http://localhost:4002/admin/tamper \
  -H "Content-Type: application/json" \
  -d '{"blockIndex":1,"dataPatch":{"ballot_token_hash":"FORGED"}}'

curl -X POST http://localhost:4002/sync
# -> selfAuthenticallySigned: false — caught locally, instantly

# Scenario B — compromise the PRIMARY itself
curl -X POST http://localhost:4001/admin/tamper \
  -H "Content-Type: application/json" \
  -d '{"blockIndex":1,"dataPatch":{"ballot_token_hash":"REWRITTEN"}}'

curl -X POST http://localhost:4001/sync
# -> selfAuthenticallySigned: true  (it has its own real key — passes!)
# -> divergentNodeIds includes the primary's own nodeId anyway, because
#    the untouched replicas still hold the original block
```

`POST /admin/tamper` is **demo-only**. It exists to make the tamper
scenarios above reproducible on demand; it must never be exposed outside a
local educational environment, and there is no authentication in front of
it — anyone who can reach a node's HTTP port can rewrite its local history
through it.

## Environment variables

See `.env.example`. The one convention worth calling out: on a **replica**,
`PEERS`'s first entry must be the primary's URL — it doubles as the
redirect target for stray `POST /votes` calls and as where the replica
fetches the primary's public key at startup. On the **primary**, `PEERS`
must list its replicas — that is who it broadcasts new blocks to. Getting
this backwards (the primary configured with no peers) produces no error —
`broadcastFailures` just comes back empty, because there was nothing to
broadcast to — it looks like success. This exact mistake happened while
building this service; `dev-cluster.js` now sets it correctly, but keep it
in mind if you reconfigure peers by hand.

## Not implemented here

- Leader election or primary failover — if the primary goes down, no
  automatic promotion happens. A real deployment would need this; it is
  out of scope for the educational goal (demonstrating tamper detection).
- Automatic recovery of a divergent node (e.g., a flagged node
  resyncing itself from the majority). `/sync` only reports; it does not
  act. Building an automatic-recovery endpoint is a reasonable extension
  left for the team.
