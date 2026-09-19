import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { generateKeyPairSync } from "node:crypto";
import { issueOrReuseBallot, VoterNotEligibleError } from "./issuance.js";

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE voters (
      voter_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      has_voted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE ballots (
      token TEXT PRIMARY KEY,
      voter_id TEXT NOT NULL REFERENCES voters(voter_id),
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
  db.prepare("INSERT INTO voters (voter_id, name) VALUES (?, ?)").run("VOTANTE001", "Demo Voter 1");
  return db;
}

test("an eligible voter receives a credential and becomes has_voted", () => {
  const db = setupDb();
  const { privateKey } = generateKeyPairSync("ed25519");
  const credential = issueOrReuseBallot({ db, privateKey, ttlMs: 60_000, voterId: "VOTANTE001" });

  assert.equal(typeof credential.token, "string");
  const voter = db.prepare("SELECT has_voted FROM voters WHERE voter_id = ?").get("VOTANTE001");
  assert.equal(voter.has_voted, 1);
});

test("an unknown voter id is rejected", () => {
  const db = setupDb();
  const { privateKey } = generateKeyPairSync("ed25519");
  assert.throws(
    () => issueOrReuseBallot({ db, privateKey, ttlMs: 60_000, voterId: "NOT_A_VOTER" }),
    VoterNotEligibleError
  );
});

test("requesting again before expiry returns the SAME token, not a second one", () => {
  const db = setupDb();
  const { privateKey } = generateKeyPairSync("ed25519");
  const now = 1_000_000;

  const first = issueOrReuseBallot({ db, privateKey, ttlMs: 60_000, voterId: "VOTANTE001", now });
  const second = issueOrReuseBallot({ db, privateKey, ttlMs: 60_000, voterId: "VOTANTE001", now: now + 1000 });

  assert.equal(second.token, first.token);
  assert.equal(second.signature, first.signature);

  const ballotCount = db.prepare("SELECT COUNT(*) AS count FROM ballots WHERE voter_id = ?").get("VOTANTE001");
  assert.equal(ballotCount.count, 1);
});

test("requesting again after the credential expired is rejected, not reissued "
  + "(the documented has_voted-at-issuance tradeoff)", () => {
  const db = setupDb();
  const { privateKey } = generateKeyPairSync("ed25519");
  const now = 1_000_000;

  issueOrReuseBallot({ db, privateKey, ttlMs: 1000, voterId: "VOTANTE001", now });

  assert.throws(
    () => issueOrReuseBallot({ db, privateKey, ttlMs: 1000, voterId: "VOTANTE001", now: now + 5000 }),
    VoterNotEligibleError
  );
});
