import { test } from "node:test";
import assert from "node:assert/strict";
import { createGenesisBlock, createBlock } from "./block.js";
import { detectDivergence } from "./consensus.js";

function buildHonestChain() {
  const genesis = createGenesisBlock();
  const block1 = createBlock({ previousBlock: genesis, data: { n: 1 }, nodeId: "node-a" });
  const block2 = createBlock({ previousBlock: block1, data: { n: 2 }, nodeId: "node-a" });
  return [genesis, block1, block2];
}

test("three identical honest chains: no divergence", () => {
  const chain = buildHonestChain();
  const result = detectDivergence({
    "node-a": chain,
    "node-b": chain,
    "node-c": chain
  });
  assert.deepEqual(result.divergentNodeIds, []);
  assert.equal(result.agreedLength, 3);
});

test("a naive tamper (stale hash) is caught as internally invalid", () => {
  const honest = buildHonestChain();
  const naive = [honest[0], { ...honest[1], data: { n: 999 } }, honest[2]];

  const result = detectDivergence({
    "node-a": honest,
    "node-b": honest,
    "node-c": naive
  });
  assert.deepEqual(result.divergentNodeIds, ["node-c"]);
});

test("a sophisticated tamper (fully recomputed hashes) is only caught by "
  + "comparing against peers, not by the tampered node's own chain", () => {
  const honest = buildHonestChain();
  const [genesis, block1] = honest;

  // node-c tampers block1's data and correctly rebuilds block2 on top —
  // its own chain is internally consistent.
  const tamperedBlock1 = createBlock({ previousBlock: genesis, data: { n: 999 }, nodeId: "node-a" });
  const tamperedBlock2 = createBlock({ previousBlock: tamperedBlock1, data: { n: 2 }, nodeId: "node-a" });
  const sophisticated = [genesis, tamperedBlock1, tamperedBlock2];

  const result = detectDivergence({
    "node-a": honest,
    "node-b": honest,
    "node-c": sophisticated
  });

  assert.deepEqual(result.divergentNodeIds, ["node-c"]);
  // the majority hash at index 1 must be the honest one, not node-c's
  assert.equal(result.byIndex[1].hash, block1.hash);
  assert.equal(result.byIndex[1].agreeingNodes.length, 2);
});
