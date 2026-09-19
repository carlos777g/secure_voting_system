import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createGenesisBlock, issueCredential, sha256Hex } from "@secure-voting/shared";
import { buildVoteBlock, VoteRejectedError } from "./votes.js";

function setup() {
  const authorityKeys = generateKeyPairSync("ed25519");
  const primaryKeys = generateKeyPairSync("ed25519");
  const chain = [createGenesisBlock()];
  const tokenHashSet = new Set();
  return { authorityKeys, primaryKeys, chain, tokenHashSet };
}

function validVote(token) {
  return {
    type: "anonymous_vote",
    ballot_token_hash: sha256Hex(token),
    encrypted_vote: "AAAA",
    nonce: "BBBB",
    encrypted_aes_key: "CCCC",
    signature: "DDDD",
    voter_public_key: "EEEE"
  };
}

test("a valid credential and matching vote produce a signed block", () => {
  const { authorityKeys, primaryKeys, chain, tokenHashSet } = setup();
  const credential = issueCredential({ privateKey: authorityKeys.privateKey, ttlMs: 60_000 });
  const vote = validVote(credential.token);

  const block = buildVoteBlock({
    chain,
    tokenHashSet,
    credential,
    vote,
    authorityPublicKey: authorityKeys.publicKey,
    nodeId: "node-a",
    privateKey: primaryKeys.privateKey
  });

  assert.equal(block.index, 1);
  assert.equal(block.data.ballot_token_hash, vote.ballot_token_hash);
  assert.equal(typeof block.signature, "string");
});

test("a credential signed by an unknown authority is rejected", () => {
  const { primaryKeys, chain, tokenHashSet } = setup();
  const { privateKey: rogueAuthorityKey } = generateKeyPairSync("ed25519");
  const { publicKey: realAuthorityPublicKey } = generateKeyPairSync("ed25519");
  const credential = issueCredential({ privateKey: rogueAuthorityKey, ttlMs: 60_000 });
  const vote = validVote(credential.token);

  assert.throws(
    () =>
      buildVoteBlock({
        chain,
        tokenHashSet,
        credential,
        vote,
        authorityPublicKey: realAuthorityPublicKey,
        nodeId: "node-a",
        privateKey: primaryKeys.privateKey
      }),
    VoteRejectedError
  );
});

test("a vote whose ballot_token_hash does not match the credential's token "
  + "is rejected — this is the check that stops a valid credential from "
  + "being attached to an unrelated, fabricated vote", () => {
  const { authorityKeys, primaryKeys, chain, tokenHashSet } = setup();
  const credential = issueCredential({ privateKey: authorityKeys.privateKey, ttlMs: 60_000 });
  const vote = validVote("a-completely-different-token");

  assert.throws(
    () =>
      buildVoteBlock({
        chain,
        tokenHashSet,
        credential,
        vote,
        authorityPublicKey: authorityKeys.publicKey,
        nodeId: "node-a",
        privateKey: primaryKeys.privateKey
      }),
    (err) => err instanceof VoteRejectedError && /does not match/.test(err.reason)
  );
});

test("a second vote with an already-used token hash is rejected", () => {
  const { authorityKeys, primaryKeys, chain, tokenHashSet } = setup();
  const credential = issueCredential({ privateKey: authorityKeys.privateKey, ttlMs: 60_000 });
  const vote = validVote(credential.token);
  tokenHashSet.add(vote.ballot_token_hash); // simulate it was already recorded

  assert.throws(
    () =>
      buildVoteBlock({
        chain,
        tokenHashSet,
        credential,
        vote,
        authorityPublicKey: authorityKeys.publicKey,
        nodeId: "node-a",
        privateKey: primaryKeys.privateKey
      }),
    (err) => err instanceof VoteRejectedError && /already been used/.test(err.reason)
  );
});

test("an expired credential is rejected even with a matching vote", () => {
  const { authorityKeys, primaryKeys, chain, tokenHashSet } = setup();
  const now = 1_000_000;
  const credential = issueCredential({ privateKey: authorityKeys.privateKey, ttlMs: 1000, now });
  const vote = validVote(credential.token);

  assert.throws(
    () =>
      buildVoteBlock({
        chain,
        tokenHashSet,
        credential,
        vote,
        authorityPublicKey: authorityKeys.publicKey,
        nodeId: "node-a",
        privateKey: primaryKeys.privateKey,
        now: now + 5000
      }),
    VoteRejectedError
  );
});
