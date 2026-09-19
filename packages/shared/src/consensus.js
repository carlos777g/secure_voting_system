import { isChainInternallyValid } from "./block.js";

// Given a map of nodeId -> that node's full chain, determines, block by
// block, which hash the majority of nodes agree on, and returns the set of
// node ids whose chain disagrees with the majority anywhere.
//
// This is deliberately NOT a production consensus algorithm: no leader
// election, no fork resolution beyond "majority wins", no cryptographic
// proof of misbehavior, no Byzantine fault tolerance guarantee (a
// coordinated majority can still overrule a minority of honest nodes). It
// exists to demonstrate one specific point: a chain that is internally
// hash-consistent (isChainInternallyValid returns true) can still be
// illegitimate if it disagrees with what the rest of the network holds —
// internal consistency alone never catches a single actor who tampered
// with their own local copy and correctly recomputed every hash after it.
export function detectDivergence(chainsById) {
  const entries = Object.entries(chainsById);
  const invalidNodeIds = entries
    .filter(([, chain]) => !isChainInternallyValid(chain))
    .map(([nodeId]) => nodeId);
  const validEntries = entries.filter(([, chain]) => isChainInternallyValid(chain));

  if (validEntries.length === 0) {
    return { agreedLength: 0, divergentNodeIds: entries.map(([nodeId]) => nodeId), byIndex: [] };
  }

  const maxLength = Math.max(...validEntries.map(([, chain]) => chain.length));
  const divergentNodeIds = new Set(invalidNodeIds);
  const byIndex = [];

  for (let index = 0; index < maxLength; index += 1) {
    const nodeIdsByHash = new Map();
    for (const [nodeId, chain] of validEntries) {
      const blockHash = chain[index] ? chain[index].hash : null;
      if (!nodeIdsByHash.has(blockHash)) nodeIdsByHash.set(blockHash, []);
      nodeIdsByHash.get(blockHash).push(nodeId);
    }

    const ranked = [...nodeIdsByHash.entries()].sort((a, b) => b[1].length - a[1].length);
    const [majorityHash, majorityNodeIds] = ranked[0];
    byIndex.push({ index, hash: majorityHash, agreeingNodes: majorityNodeIds });

    for (const [hash, nodeIds] of nodeIdsByHash) {
      if (hash !== majorityHash) {
        for (const nodeId of nodeIds) divergentNodeIds.add(nodeId);
      }
    }
  }

  return {
    agreedLength: byIndex.length,
    divergentNodeIds: [...divergentNodeIds],
    byIndex
  };
}
