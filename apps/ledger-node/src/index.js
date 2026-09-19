import "dotenv/config";
import { readFileSync } from "node:fs";
import { ensureEd25519KeyPair } from "@secure-voting/shared";
import { loadConfig } from "./config.js";
import { loadChain, tokenHashSetFromChain } from "./chain-store.js";
import { fetchAuthorityPublicKey } from "./authority-client.js";
import { fetchPeerPublicKey } from "./peer-client.js";
import { createServer } from "./server.js";

const config = loadConfig();
const { privateKey, publicKey } = ensureEd25519KeyPair(config.keysDir, config.nodeId);
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

const chain = loadChain(config.dataPath);
const state = { chain, tokenHashSet: tokenHashSetFromChain(chain) };

const authorityPublicKey = await fetchAuthorityPublicKey(config.authorityUrl);

let electionPublicKeyPem;
try {
  electionPublicKeyPem = readFileSync(config.electionPublicKeyPath, "utf8");
} catch {
  throw new Error(
    `could not read ELECTION_PUBLIC_KEY_PATH (${config.electionPublicKeyPath}) — ` +
      "run `node scripts/generate-election-key.js` to create a placeholder keypair for local dev"
  );
}

// Convention: on a replica, config.peers[0] is always the primary's URL —
// used both as the broadcast/redirect target and as where to fetch the
// primary's public key from. See config.js and dev-cluster.js.
const primaryPublicKey =
  config.role === "primary" ? publicKey : await fetchPeerPublicKey(config.peers[0]);

const app = createServer({
  config,
  state,
  publicKeyPem,
  authorityPublicKey,
  primaryPublicKey,
  privateKey,
  electionPublicKeyPem
});

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`ledger-node [${config.nodeId}] (${config.role}) listening on port ${config.port}`);
});
