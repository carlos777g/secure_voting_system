import { getEligibleVoter, getActiveBallot, insertBallotAndMarkVoted } from "./db.js";
import { issueCredential, resignCredential } from "@secure-voting/shared";

export class VoterNotEligibleError extends Error {}

// Design tradeoff, stated explicitly: has_voted is set at ISSUANCE time,
// not at vote-consumption time. The alternative — only marking a voter as
// voted once their token is actually redeemed on the ledger — would require
// eligibility-authority to be told "voter X's token was just consumed",
// which is a direct, explicit identity-to-vote link. That is a strictly
// worse anonymity property than the passive timing-correlation risk already
// documented in docs/THREAT_MODEL.md, so it is deliberately not built.
//
// The cost of marking at issuance: a voter whose credential expires unused
// is locked out and needs a manual/administrative reset of has_voted. For
// this educational project that is an acceptable, explicit tradeoff — pick
// a generous credentialTtlMs relative to how long voting stays open.

// Wraps the whole read-decide-write sequence in a single better-sqlite3
// transaction. better-sqlite3 is synchronous and Node is single-threaded,
// so nothing else can run between the eligibility check and the write —
// this closes the check-then-act race condition that existed in the
// previous prototype, where two concurrent requests for the same voter_id
// could both observe has_voted = 0 before either one committed.
export function issueOrReuseBallot({ db, privateKey, ttlMs, voterId, now = Date.now() }) {
  const run = db.transaction(() => {
    const existingBallot = getActiveBallot(db, voterId, now);
    if (existingBallot) {
      return { reused: true, ballot: existingBallot };
    }

    const voter = getEligibleVoter(db, voterId);
    if (!voter) {
      throw new VoterNotEligibleError(`voter ${voterId} is not eligible or has already voted`);
    }

    const credential = issueCredential({ privateKey, ttlMs, now });
    insertBallotAndMarkVoted(db, {
      token: credential.token,
      voterId,
      issuedAt: credential.issued_at,
      expiresAt: credential.expires_at
    });
    return { reused: false, ballot: credential };
  });

  const result = run();

  if (result.reused) {
    // Recompute the signature rather than storing it — safe because
    // Ed25519 signing is deterministic for the same key and bytes.
    return resignCredential({
      privateKey,
      token: result.ballot.token,
      issued_at: result.ballot.issued_at,
      expires_at: result.ballot.expires_at
    });
  }
  return result.ballot;
}
