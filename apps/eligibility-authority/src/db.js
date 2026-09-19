import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

const DEMO_VOTERS = [
  { voter_id: "VOTANTE001", name: "Demo Voter 1" },
  { voter_id: "VOTANTE002", name: "Demo Voter 2" },
  { voter_id: "VOTANTE003", name: "Demo Voter 3" }
];

export function openDatabase(dbPath) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  initSchema(db);
  seedDemoVotersIfEmpty(db);
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS voters (
      voter_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      has_voted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS ballots (
      token TEXT PRIMARY KEY,
      voter_id TEXT NOT NULL REFERENCES voters(voter_id),
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
}

function seedDemoVotersIfEmpty(db) {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM voters").get();
  if (count > 0) return;
  const insert = db.prepare("INSERT INTO voters (voter_id, name) VALUES (@voter_id, @name)");
  const insertMany = db.transaction((voters) => {
    for (const voter of voters) insert.run(voter);
  });
  insertMany(DEMO_VOTERS);
}

export function getEligibleVoter(db, voterId) {
  return db.prepare("SELECT * FROM voters WHERE voter_id = ? AND has_voted = 0").get(voterId);
}

export function getActiveBallot(db, voterId, now) {
  return db
    .prepare("SELECT * FROM ballots WHERE voter_id = ? AND expires_at > ? ORDER BY issued_at DESC LIMIT 1")
    .get(voterId, now);
}

export function insertBallotAndMarkVoted(db, { token, voterId, issuedAt, expiresAt }) {
  const insertBallot = db.prepare(
    "INSERT INTO ballots (token, voter_id, issued_at, expires_at) VALUES (?, ?, ?, ?)"
  );
  const markVoted = db.prepare("UPDATE voters SET has_voted = 1 WHERE voter_id = ?");
  const run = db.transaction(() => {
    insertBallot.run(token, voterId, issuedAt, expiresAt);
    markVoted.run(voterId);
  });
  run();
}
