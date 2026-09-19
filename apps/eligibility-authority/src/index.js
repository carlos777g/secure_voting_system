import "dotenv/config";
import { ensureEd25519KeyPair } from "@secure-voting/shared";
import { config } from "./config.js";
import { openDatabase } from "./db.js";
import { createServer } from "./server.js";

const { privateKey, publicKey } = ensureEd25519KeyPair(config.keysDir, "authority");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const db = openDatabase(config.dbPath);

const app = createServer({ db, privateKey, publicKeyPem, ttlMs: config.credentialTtlMs });

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`eligibility-authority listening on port ${config.port}`);
});
