import { computeBlockHash, blockHashBytes, verifyBytes } from "@secure-voting/shared";

export class BlockRejectedError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

// This is the check that gives every replica its own opinion, independent
// of trusting whatever the primary claims. A replica that skipped this and
// just appended whatever arrived would not actually be verifying anything
// — it would just be a passive mirror, and the whole "detect a compromised
// node" story would collapse to "detect a compromised network link" at
// best.
export function acceptBroadcastBlock({ chain, tokenHashSet, incomingBlock, primaryPublicKey }) {
  const tip = chain[chain.length - 1];
  if (incomingBlock.previousHash !== tip.hash) {
    throw new BlockRejectedError(
      `block does not extend our current tip (expected previousHash ${tip.hash}, got ${incomingBlock.previousHash})`
    );
  }

  const { hash, signature, ...rest } = incomingBlock;
  if (hash !== computeBlockHash(rest)) {
    throw new BlockRejectedError("block hash does not match its own content");
  }

  if (typeof signature !== "string") {
    throw new BlockRejectedError("block is missing a signature");
  }
  const signatureOk = verifyBytes(primaryPublicKey, blockHashBytes(hash), Buffer.from(signature, "base64url"));
  if (!signatureOk) {
    throw new BlockRejectedError("block signature does not verify against the primary's public key");
  }

  const tokenHash = incomingBlock.data?.ballot_token_hash;
  if (typeof tokenHash === "string" && tokenHashSet.has(tokenHash)) {
    throw new BlockRejectedError("ballot token already present locally");
  }

  return incomingBlock;
}
