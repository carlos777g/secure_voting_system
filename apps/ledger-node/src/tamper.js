import { createBlock, signBytes, blockHashBytes } from "@secure-voting/shared";

export class TamperError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

// DEMO-ONLY. Simulates an attacker who has compromised THIS node's process
// and therefore holds THIS node's own private key — nothing else. Mutates
// one block's data, then rebuilds every hash from that point on and
// re-signs each rebuilt block with the CALLING node's key. The block's
// nodeId field is left as-is (still claims to be authored by whoever
// originally produced it), only the signature is the attacker's own —
// exactly what an attacker with local access, but not the primary's key,
// could actually produce.
//
// Call this on a REPLICA: the new signature won't match the primary's
// public key, so isChainAuthenticallySigned rejects the tampered chain
// locally, with no comparison against any peer needed.
// Call this on the PRIMARY: it signs with its own real key, so the result
// looks locally authentic — only comparing against replicas' independent
// copies (via /sync) reveals that the primary now disagrees with what it
// originally broadcast.
export function tamperChain({ chain, blockIndex, dataPatch, privateKey }) {
  if (blockIndex < 1 || blockIndex >= chain.length) {
    throw new TamperError(`blockIndex ${blockIndex} is out of range (chain has ${chain.length} blocks)`);
  }

  const rebuilt = chain.slice(0, blockIndex);
  let previousBlock = rebuilt[rebuilt.length - 1];

  for (let i = blockIndex; i < chain.length; i += 1) {
    const original = chain[i];
    const data = i === blockIndex ? { ...original.data, ...dataPatch } : original.data;
    const unsignedBlock = createBlock({ previousBlock, data, nodeId: original.nodeId });
    const signature = signBytes(privateKey, blockHashBytes(unsignedBlock.hash));
    const signedBlock = { ...unsignedBlock, signature: signature.toString("base64url") };
    rebuilt.push(signedBlock);
    previousBlock = signedBlock;
  }

  return rebuilt;
}
