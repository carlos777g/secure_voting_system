import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createGenesisBlock, createBlock, signBytes, blockHashBytes } from "@secure-voting/shared";
import { acceptBroadcastBlock, BlockRejectedError } from "./replication.js";

function signedBlockFrom(previousBlock, data, privateKey, nodeId = "node-a") {
  const unsigned = createBlock({ previousBlock, data, nodeId });
  const signature = signBytes(privateKey, blockHashBytes(unsigned.hash));
  return { ...unsigned, signature: signature.toString("base64url") };
}

test("a correctly signed block extending the current tip is accepted", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const genesis = createGenesisBlock();
  const block = signedBlockFrom(genesis, { ballot_token_hash: "abc" }, privateKey);

  const accepted = acceptBroadcastBlock({
    chain: [genesis],
    tokenHashSet: new Set(),
    incomingBlock: block,
    primaryPublicKey: publicKey
  });
  assert.equal(accepted.hash, block.hash);
});

test("a block signed by a DIFFERENT key than the primary's is rejected — "
  + "this is exactly what stops a compromised node from broadcasting a "
  + "forged block that other nodes would accept", () => {
  const { publicKey: primaryPublicKey } = generateKeyPairSync("ed25519");
  const { privateKey: attackerKey } = generateKeyPairSync("ed25519");
  const genesis = createGenesisBlock();
  const forged = signedBlockFrom(genesis, { ballot_token_hash: "abc" }, attackerKey);

  assert.throws(
    () =>
      acceptBroadcastBlock({
        chain: [genesis],
        tokenHashSet: new Set(),
        incomingBlock: forged,
        primaryPublicKey
      }),
    (err) => err instanceof BlockRejectedError && /signature/.test(err.reason)
  );
});

test("a block that does not extend the current tip is rejected", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const genesis = createGenesisBlock();
  const orphan = signedBlockFrom({ ...genesis, hash: "not-the-real-tip" }, { n: 1 }, privateKey);

  assert.throws(
    () =>
      acceptBroadcastBlock({
        chain: [genesis],
        tokenHashSet: new Set(),
        incomingBlock: orphan,
        primaryPublicKey: publicKey
      }),
    (err) => err instanceof BlockRejectedError && /extend our current tip/.test(err.reason)
  );
});

test("a block whose ballot_token_hash was already seen locally is rejected "
  + "even if correctly signed (defense in depth alongside the primary's "
  + "own duplicate check)", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const genesis = createGenesisBlock();
  const block = signedBlockFrom(genesis, { ballot_token_hash: "already-used" }, privateKey);

  assert.throws(
    () =>
      acceptBroadcastBlock({
        chain: [genesis],
        tokenHashSet: new Set(["already-used"]),
        incomingBlock: block,
        primaryPublicKey: publicKey
      }),
    (err) => err instanceof BlockRejectedError && /already present/.test(err.reason)
  );
});
