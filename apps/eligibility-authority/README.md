# eligibility-authority

Issues Ed25519-signed, time-limited ballot credentials to eligible voters.
See the root `docs/THREAT_MODEL.md` for how this fits into the system's
overall security properties. This document covers one design decision in
detail, because it has a real operational cost and deserves to be visible.

## The `has_voted`-at-issuance tradeoff

A voter's `has_voted` flag is set the moment a credential is **issued**,
not when it is later **redeemed** on the ledger.

**Why not mark it at redemption instead?** That would require `ledger-node`
to tell `eligibility-authority` "voter X's token was just consumed" —
which is a direct, explicit link between an identity and the moment a vote
was cast. That is a *worse* anonymity property than the passive
timing-correlation risk already accepted and documented in
`docs/THREAT_MODEL.md`: there, the authority merely *could* infer a link by
analyzing its own logs after the fact; with a redemption callback, it would
be *told* the link outright, in real time. Marking at issuance avoids
building that callback at all — `eligibility-authority` never learns
anything about what happens to a token after it hands it out.

**The cost:** if a voter is issued a credential and lets it expire without
voting (`CREDENTIAL_TTL_MS`, default 15 minutes), they are locked out.
`has_voted` is already `1`, and nothing in this service will reissue them a
new token. This is a deliberate choice to close a security gap (see
`src/issuance.js` for the full reasoning), accepted at the cost of a
possible support burden.

**Mitigating the lock-out:** the practical fix is operational, not
cryptographic — pick a `CREDENTIAL_TTL_MS` generous enough relative to how
long voting stays open that expiry-before-voting is rare in practice.

**Extension point left for the team:** an admin endpoint
(e.g. `POST /admin/reset-voter { voter_id }`) that clears `has_voted` for a
specific voter would let staff manually recover a legitimately locked-out
voter, without weakening the design above — it is an explicit, audited,
human-triggered override, not an automatic one. This is **not implemented**
here on purpose: it needs its own authentication/authorization story (who
is allowed to call it, and how that's enforced) which is outside this
service's current scope. If you build it, log every use — this endpoint is
the one place in the system that can knowingly let someone vote twice if
misused.
