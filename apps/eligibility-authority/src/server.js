import express from "express";
import { issueOrReuseBallot, VoterNotEligibleError } from "./issuance.js";

export function createServer({ db, privateKey, publicKeyPem, ttlMs }) {
  const app = express();
  app.use(express.json());

  app.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Ledger nodes fetch this once (or on startup) to verify credentials
  // locally, without calling back to this service per vote.
  app.get("/public-key", (req, res) => {
    res.type("text/plain").send(publicKeyPem);
  });

  app.post("/identify", (req, res) => {
    const voterId = String(req.body?.voter_id ?? "").trim();
    if (!voterId) {
      return res.status(400).json({ error: "voter_id is required" });
    }

    try {
      const credential = issueOrReuseBallot({ db, privateKey, ttlMs, voterId });
      return res.status(200).json({ credential });
    } catch (err) {
      if (err instanceof VoterNotEligibleError) {
        return res.status(403).json({ error: "invalid voter id or voter has already voted" });
      }
      // eslint-disable-next-line no-console
      console.error("Unexpected error in /identify:", err);
      return res.status(500).json({ error: "internal error" });
    }
  });

  return app;
}
