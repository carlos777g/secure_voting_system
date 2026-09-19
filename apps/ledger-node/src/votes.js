import { createBlock, sha256Hex, signBytes, blockHashBytes, validateVoteData, verifyCredential } from "@secure-voting/shared";

export class VoteRejectedError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

export function buildVoteBlock({ chain, tokenHashSet, credential, vote, authorityPublicKey, nodeId, privateKey, now = Date.now() }) {
  const credentialCheck = verifyCredential({ publicKey: authorityPublicKey, ...credential }, now);
  if (!credentialCheck.valid) {
    throw new VoteRejectedError(`invalid credential: ${credentialCheck.reason}`);
  }

  const shapeCheck = validateVoteData(vote);
  if (!shapeCheck.valid) {
    throw new VoteRejectedError(`invalid vote payload: ${shapeCheck.reason}`);
  }

  // Binds this specific vote to this specific credential's token. Without
  // this check, any validly signed, unexpired credential could be attached
  // to an arbitrary vote payload with a fabricated ballot_token_hash — the
  // ledger never decrypts vote content, so this hash comparison is the
  // only way it has to confirm the two actually belong together.
  const expectedHash = sha256Hex(credential.token);
  if (vote.ballot_token_hash !== expectedHash) {
    throw new VoteRejectedError("ballot_token_hash does not match the supplied credential's token");
  }

  if (tokenHashSet.has(vote.ballot_token_hash)) {
    throw new VoteRejectedError("this ballot token has already been used");
  }

  const previousBlock = chain[chain.length - 1];
  const unsignedBlock = createBlock({ previousBlock, data: vote, nodeId });
  const signature = signBytes(privateKey, blockHashBytes(unsignedBlock.hash));
  return { ...unsignedBlock, signature: signature.toString("base64url") };
}
