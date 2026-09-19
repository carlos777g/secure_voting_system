import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createGenesisBlock, createBlock, signBytes, blockHashBytes, isChainAuthenticallySigned } from "@secure-voting/shared";
import { tamperChain, TamperError } from "./tamper.js";

function buildHonestChain(privateKey) {
  const genesis = createGenesisBlock();
  const sign = (previousBlock, data) => {
    const unsigned = createBlock({ previousBlock, data, nodeId: "node-a" });
    const signature = signBytes(privateKey, blockHashBytes(unsigned.hash));
    return { ...unsigned, signature: signature.toString("base64url") };
  };
  const block1 = sign(genesis, { ballot_token_hash: "t1" });
  const block2 = sign(block1, { ballot_token_hash: "t2" });
  return [genesis, block1, block2];
}

test("tampering with the replica's OWN key produces a chain that fails "
  + "local signature authentication against the primary's public key", () => {
  const { privateKey: primaryKey, publicKey: primaryPublicKey } = generateKeyPairSync("ed25519");
  const { privateKey: replicaOwnKey } = generateKeyPairSync("ed25519"); // the replica's own identity key

  const honestChain = buildHonestChain(primaryKey);
  const tampered = tamperChain({
    chain: honestChain,
    blockIndex: 1,
    dataPatch: { ballot_token_hash: "forged" },
    privateKey: replicaOwnKey // simulates: attacker only has THIS node's key
  });

  assert.equal(isChainAuthenticallySigned(tampered, primaryPublicKey), false);
});

test("tampering with the PRIMARY's own key produces a chain that DOES pass "
  + "local signature authentication — only cross-node comparison catches "
  + "this case, which is exactly the point made in sync.js", () => {
  const { privateKey: primaryKey, publicKey: primaryPublicKey } = generateKeyPairSync("ed25519");

  const honestChain = buildHonestChain(primaryKey);
  const tampered = tamperChain({
    chain: honestChain,
    blockIndex: 1,
    dataPatch: { ballot_token_hash: "forged" },
    privateKey: primaryKey // the primary tampering with its own real key
  });

  assert.equal(isChainAuthenticallySigned(tampered, primaryPublicKey), true);
  assert.notEqual(tampered[1].hash, honestChain[1].hash);
});

test("blockIndex 0 (genesis) is rejected", () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const chain = buildHonestChain(privateKey);
  assert.throws(() => tamperChain({ chain, blockIndex: 0, dataPatch: {}, privateKey }), TamperError);
});

test("an out-of-range blockIndex is rejected", () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const chain = buildHonestChain(privateKey);
  assert.throws(() => tamperChain({ chain, blockIndex: 99, dataPatch: {}, privateKey }), TamperError);
});
