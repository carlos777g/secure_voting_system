import { createHash } from "node:crypto";
import { canonicalStringify } from "./canonical.js";

export function sha256Hex(input) {
  const buffer = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return createHash("sha256").update(buffer).digest("hex");
}

// The hash that identifies a block's content. Deliberately excludes the
// block's own "hash" and "signature" fields — a hash can never be a
// function of itself, and a signature is computed OVER this hash, not
// included in it (that would be circular).
export function computeBlockHash({ index, timestamp, data, previousHash, nodeId }) {
  const payload = canonicalStringify({ index, timestamp, data, previousHash, nodeId });
  return sha256Hex(payload);
}

// Fixed timestamp and a fixed nodeId of "genesis" so every node's genesis
// block hashes identically. This matters: nodes compare chains starting at
// index 0, and if genesis blocks differed per node the whole chain would
// look "divergent" from block zero for no meaningful reason.
export function createGenesisBlock() {
  const index = 0;
  const timestamp = 0;
  const data = { type: "genesis" };
  const previousHash = "0".repeat(64);
  const nodeId = "genesis";
  const hash = computeBlockHash({ index, timestamp, data, previousHash, nodeId });
  return { index, timestamp, data, previousHash, nodeId, hash, signature: null };
}

// nodeId here identifies which ledger node produced the block. Block-level
// authentication (the node signing computeBlockHash with its own identity
// key) is intentionally NOT implemented in this package — it depends on a
// specific node's private key material, which belongs to the ledger-node
// app, not to this shared, key-agnostic library. The "signature" field is
// reserved for that and stays null until ledger-node fills it in.
export function createBlock({ previousBlock, data, nodeId }) {
  const index = previousBlock.index + 1;
  const timestamp = Date.now(); // integer milliseconds — a float here would
                                  // reintroduce the serialization-drift risk
                                  // called out in the previous implementation
  const previousHash = previousBlock.hash;
  const hash = computeBlockHash({ index, timestamp, data, previousHash, nodeId });
  return { index, timestamp, data, previousHash, nodeId, hash, signature: null };
}

export function isBlockHashValid(block) {
  const { hash } = block;
  return hash === computeBlockHash(block);
}

// Internal consistency only: every block's hash matches its own content,
// and every block correctly references its predecessor's hash. This is
// NOT proof that the chain is legitimate — a single actor with local write
// access can tamper with data and correctly recompute every hash after it,
// producing a chain that passes this check while disagreeing with every
// other node's copy. That is exactly the scenario detectDivergence (in
// consensus.js) exists to catch; this function alone cannot catch it.
export function isChainInternallyValid(chain) {
  if (chain.length === 0) return false;
  for (let i = 0; i < chain.length; i += 1) {
    const block = chain[i];
    if (!isBlockHashValid(block)) return false;
    if (i > 0 && block.previousHash !== chain[i - 1].hash) return false;
  }
  return true;
}
