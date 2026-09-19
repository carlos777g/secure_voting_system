import express from "express";
import { persistChain } from "./chain-store.js";
import { buildVoteBlock, VoteRejectedError } from "./votes.js";
import { acceptBroadcastBlock, BlockRejectedError } from "./replication.js";
import { broadcastBlock } from "./peer-client.js";
import { runSync } from "./sync.js";
import { tamperChain, TamperError } from "./tamper.js";

export function createServer({ config, state, publicKeyPem, authorityPublicKey, primaryPublicKey, privateKey }) {
  const app = express();
  app.use(express.json());

  app.get("/health", (req, res) => res.json({ status: "ok", nodeId: config.nodeId, role: config.role }));

  app.get("/public-key", (req, res) => res.type("text/plain").send(publicKeyPem));

  app.get("/status", (req, res) => {
    res.json({
      nodeId: config.nodeId,
      role: config.role,
      chainLength: state.chain.length,
      tokenCount: state.tokenHashSet.size
    });
  });

  app.get("/chain", (req, res) => {
    res.json({ nodeId: config.nodeId, chain: state.chain });
  });

  app.post("/votes", async (req, res) => {
    if (config.role !== "primary") {
      return res.status(409).json({
        error: "this node is a replica; submit votes to the primary",
        primaryUrl: config.peers[0] // convention: primary is always peers[0] on a replica, see .env.example
      });
    }

    const { credential, vote } = req.body ?? {};
    try {
      const block = buildVoteBlock({
        chain: state.chain,
        tokenHashSet: state.tokenHashSet,
        credential,
        vote,
        authorityPublicKey,
        nodeId: config.nodeId,
        privateKey
      });

      state.chain.push(block);
      state.tokenHashSet.add(vote.ballot_token_hash);
      persistChain(config.dataPath, state.chain);

      const broadcastResults = await Promise.allSettled(
        config.peers.map((peerUrl) => broadcastBlock(peerUrl, block))
      );
      const broadcastFailures = broadcastResults
        .map((result, i) => ({ result, peerUrl: config.peers[i] }))
        .filter(({ result }) => result.status === "rejected")
        .map(({ result, peerUrl }) => ({ peerUrl, error: result.reason.message }));

      return res.status(201).json({ block, broadcastFailures });
    } catch (err) {
      if (err instanceof VoteRejectedError) {
        return res.status(400).json({ error: err.reason });
      }
      // eslint-disable-next-line no-console
      console.error("Unexpected error in /votes:", err);
      return res.status(500).json({ error: "internal error" });
    }
  });

  app.post("/peer/blocks", (req, res) => {
    const { block } = req.body ?? {};
    try {
      const accepted = acceptBroadcastBlock({
        chain: state.chain,
        tokenHashSet: state.tokenHashSet,
        incomingBlock: block,
        primaryPublicKey
      });
      state.chain.push(accepted);
      state.tokenHashSet.add(accepted.data?.ballot_token_hash);
      persistChain(config.dataPath, state.chain);
      return res.status(201).json({ accepted: true });
    } catch (err) {
      if (err instanceof BlockRejectedError) {
        return res.status(400).json({ error: err.reason });
      }
      // eslint-disable-next-line no-console
      console.error("Unexpected error in /peer/blocks:", err);
      return res.status(500).json({ error: "internal error" });
    }
  });

  app.post("/sync", async (req, res) => {
    const result = await runSync({
      selfNodeId: config.nodeId,
      chain: state.chain,
      peers: config.peers,
      primaryPublicKey
    });
    res.json(result);
  });

  // DEMO-ONLY. Never expose this outside a local educational environment —
  // see tamper.js for exactly what it simulates and why.
  app.post("/admin/tamper", (req, res) => {
    const { blockIndex, dataPatch } = req.body ?? {};
    try {
      const tampered = tamperChain({ chain: state.chain, blockIndex, dataPatch, privateKey });
      state.chain = tampered;
      // Token index is rebuilt from scratch: a tamper could in principle
      // change which ballot_token_hash a block claims, so an incremental
      // patch to the set would itself be a source of drift.
      state.tokenHashSet = new Set(
        tampered.map((b) => b.data?.ballot_token_hash).filter((h) => typeof h === "string")
      );
      persistChain(config.dataPath, state.chain);
      return res.json({ tampered: true, chain: state.chain });
    } catch (err) {
      if (err instanceof TamperError) {
        return res.status(400).json({ error: err.reason });
      }
      throw err;
    }
  });

  return app;
}
