import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { issueCredential, resignCredential, verifyCredential } from "./credential.js";

function makeKeys() {
  return generateKeyPairSync("ed25519");
}

test("a freshly issued credential verifies against the matching public key", () => {
  const { privateKey, publicKey } = makeKeys();
  const credential = issueCredential({ privateKey, ttlMs: 60_000 });
  const result = verifyCredential({ publicKey, ...credential });
  assert.equal(result.valid, true);
});

test("a credential does not verify against a different authority's public key", () => {
  const { privateKey } = makeKeys();
  const { publicKey: otherPublicKey } = makeKeys();
  const credential = issueCredential({ privateKey, ttlMs: 60_000 });
  const result = verifyCredential({ publicKey: otherPublicKey, ...credential });
  assert.equal(result.valid, false);
});

test("an expired credential is rejected even with a valid signature", () => {
  const { privateKey, publicKey } = makeKeys();
  const now = 1_000_000;
  const credential = issueCredential({ privateKey, ttlMs: 1000, now });
  const result = verifyCredential({ publicKey, ...credential }, now + 5000);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "credential expired");
});

test("resigning the same token/issued_at/expires_at reproduces the exact "
  + "original signature (Ed25519 determinism)", () => {
  const { privateKey } = makeKeys();
  const original = issueCredential({ privateKey, ttlMs: 60_000, now: 500 });
  const resigned = resignCredential({ privateKey, ...original });
  assert.equal(resigned.signature, original.signature);
});

test("tampering with expires_at after signing invalidates the signature", () => {
  const { privateKey, publicKey } = makeKeys();
  const credential = issueCredential({ privateKey, ttlMs: 60_000 });
  const tampered = { ...credential, expires_at: credential.expires_at + 1_000_000 };
  const result = verifyCredential({ publicKey, ...tampered });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "invalid signature");
});
