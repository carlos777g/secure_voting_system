import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  createGenesisBlock,
  createBlock,
  blockHashBytes,
  isChainAuthenticallySigned,
  signBytes
} from "./index.js";

function signChain(chain, privateKey) {
  return chain.map((block) =>
    block.nodeId === "genesis"
      ? block
      : { ...block, signature: signBytes(privateKey, blockHashBytes(block.hash)).toString("base64url") }
  );
}

test("a chain signed by the real signer verifies", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const genesis = createGenesisBlock();
  const block1 = createBlock({ previousBlock: genesis, data: { n: 1 }, nodeId: "primary" });
  const chain = signChain([genesis, block1], privateKey);

  assert.equal(isChainAuthenticallySigned(chain, publicKey), true);
});

test("a chain tampered and re-signed by a DIFFERENT key fails — this is "
  + "the exact scenario of a compromised replica, which never has the "
  + "primary's private key", () => {
  const { privateKey: primaryKey, publicKey: primaryPublicKey } = generateKeyPairSync("ed25519");
  const { privateKey: attackerKey } = generateKeyPairSync("ed25519");

  const genesis = createGenesisBlock();
  const block1 = createBlock({ previousBlock: genesis, data: { n: 1 }, nodeId: "primary" });
  const honestChain = signChain([genesis, block1], primaryKey);

  // Attacker (holds only their own replica's key) tampers block1 and
  // re-signs with the only key they actually possess.
  const tamperedBlock1 = createBlock({ previousBlock: genesis, data: { n: 999 }, nodeId: "primary" });
  const tamperedChain = signChain([genesis, tamperedBlock1], attackerKey);

  assert.equal(isChainAuthenticallySigned(honestChain, primaryPublicKey), true);
  assert.equal(isChainAuthenticallySigned(tamperedChain, primaryPublicKey), false);
});

test("a chain missing a signature fails", () => {
  const { publicKey } = generateKeyPairSync("ed25519");
  const genesis = createGenesisBlock();
  const block1 = createBlock({ previousBlock: genesis, data: { n: 1 }, nodeId: "primary" });
  assert.equal(isChainAuthenticallySigned([genesis, block1], publicKey), false);
});
