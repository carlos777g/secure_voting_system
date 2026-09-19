import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createGenesisBlock,
  createBlock,
  isBlockHashValid,
  isChainInternallyValid
} from "./block.js";

test("genesis block is identical across independent calls", () => {
  const a = createGenesisBlock();
  const b = createGenesisBlock();
  assert.deepEqual(a, b);
});

test("a freshly created block has a valid hash", () => {
  const genesis = createGenesisBlock();
  const block = createBlock({ previousBlock: genesis, data: { type: "test" }, nodeId: "node-a" });
  assert.equal(isBlockHashValid(block), true);
});

test("a two-block chain is internally valid", () => {
  const genesis = createGenesisBlock();
  const block1 = createBlock({ previousBlock: genesis, data: { n: 1 }, nodeId: "node-a" });
  assert.equal(isChainInternallyValid([genesis, block1]), true);
});

test("editing data without recomputing the hash breaks internal validity", () => {
  const genesis = createGenesisBlock();
  const block1 = createBlock({ previousBlock: genesis, data: { n: 1 }, nodeId: "node-a" });
  const tampered = { ...block1, data: { n: 999 } }; // hash left stale on purpose
  assert.equal(isChainInternallyValid([genesis, tampered]), false);
});

test("the sophisticated tamper case: recomputing every hash after an edit "
  + "restores internal validity", () => {
  const genesis = createGenesisBlock();
  const block1 = createBlock({ previousBlock: genesis, data: { n: 1 }, nodeId: "node-a" });
  const block2 = createBlock({ previousBlock: block1, data: { n: 2 }, nodeId: "node-a" });

  // Simulate an attacker with local write access: change block1's data,
  // then correctly rebuild block2 on top of it, exactly as an honest node
  // would when appending. isChainInternallyValid cannot tell this apart
  // from a legitimate chain — that is the whole point of consensus.js.
  const rebuiltBlock1 = createBlock({ previousBlock: genesis, data: { n: 999 }, nodeId: "node-a" });
  const rebuiltBlock2 = createBlock({ previousBlock: rebuiltBlock1, data: { n: 2 }, nodeId: "node-a" });

  assert.equal(isChainInternallyValid([genesis, rebuiltBlock1, rebuiltBlock2]), true);
  assert.notEqual(rebuiltBlock1.hash, block1.hash);
});
