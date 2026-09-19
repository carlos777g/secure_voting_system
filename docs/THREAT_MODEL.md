# Threat Model

This document exists so that no one has to trust marketing language like
"secure" or "anonymous" at face value. It states what this system protects
against, what it does not, and why each simplification was accepted for an
educational scope.

## What this system protects against

- **A ledger-node operator reading vote content.** Ledger nodes only ever
  hold the encrypted, opaque vote package. The AES key is itself encrypted
  to the election's public key, and only `tally-authority` holds the
  matching private key.
- **A ledger-node operator impersonating a voter.** Voter keypairs are
  generated inside `voter-client`, on the voter's own machine/process, and
  never transmitted. No server-side process ever holds a voter's private
  key. (The previous prototype violated this: it derived and stored voter
  keys server-side, which made the "anonymity" claim false. This rewrite
  exists specifically to fix that.)
- **A single ledger node silently rewriting history.** A node with local
  write access can tamper with its own copy and correctly recompute every
  hash after the edit — internal chain validity alone cannot catch this.
  What catches it is `detectDivergence` in `packages/shared`: comparing a
  node's chain against its peers' chains and flagging disagreement. See
  `packages/shared/src/consensus.test.js` for the exact scenario this is
  built to catch.
- **Double voting via a duplicated ballot token.** Ledger nodes reject a
  vote whose `ballot_token_hash` already appears in the chain.
- **Double voting via a duplicated eligibility token.** `eligibility-authority`
  will not issue a second token to a voter who already has one, checked
  inside an explicit transaction to close the race condition present in the
  previous prototype.

## What this system does NOT protect against, and why

- **`eligibility-authority` correlating identity with vote, via timing.**
  `eligibility-authority` necessarily knows which `voter_id` received which
  token at issuance time. If it logged that mapping with a timestamp and
  later correlated it against when that token's vote appeared in the
  chain, it could infer, with some confidence, who voted for what — even
  though it never sees the vote's content directly. The cryptographically
  complete fix for this is a blind-signature scheme (the authority signs
  a token without seeing its final, usable form). This is **explicitly out
  of scope** for this educational project: it is a substantial increase in
  complexity relative to the project's teaching goals (consensus and
  tamper-evidence), and is called out here rather than hidden. Anyone
  extending this project toward real-world use must address this first.
- **A majority of ledger nodes colluding.** `detectDivergence` implements
  "majority hash agreement," not Byzantine fault tolerance with
  cryptographic proof of misbehavior. A coordinated majority can outvote
  a minority of honest nodes and no one will be flagged.
- **Network-level attacks.** Ledger nodes communicate over plain HTTP on
  localhost for this demo, with no TLS or mutual authentication between
  peers. This is acceptable for a local educational simulation; it would
  not be for any real deployment.
- **Compromise of `tally-authority`.** There is a single, non-threshold
  election decryption key. Anyone who compromises `tally-authority` before
  the count can decrypt every vote. Threshold decryption (splitting the key
  across multiple trustees) would address this and is a reasonable
  extension, not implemented here.
- **Voter coercion or vote-selling.** No technical control in this system
  prevents a voter from proving their vote to a third party (e.g., by
  keeping their ephemeral private key and receipt). Receipt-freeness is a
  separate, harder property that real e-voting systems address explicitly
  and this one does not attempt to.

## Design decisions this system deliberately keeps simple

- Consensus is majority-hash agreement, not PoW/PBFT/Raft.
- Ledger nodes run as local processes on different ports, not containers
  (see the README's deployment note for a Docker migration path).
- One election key, not threshold/distributed key generation.
