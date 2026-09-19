// Generates a placeholder RSA-OAEP keypair for local dev, until
// tally-authority exists and generates the real one. Only the public half
// is ever served (GET /election-key); the private half is written here so
// tally-authority's own dev setup can pick it up later, but ledger-node
// itself never reads it.
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const keysDir = "keys";
const privatePath = `${keysDir}/election_private.pem`;
const publicPath = `${keysDir}/election_public.pem`;

if (existsSync(privatePath) && existsSync(publicPath)) {
  console.log(`[generate-election-key] already exists at ${publicPath}, leaving it alone`);
  process.exit(0);
}

mkdirSync(keysDir, { recursive: true });
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
writeFileSync(privatePath, privateKey.export({ type: "pkcs8", format: "pem" }));
writeFileSync(publicPath, publicKey.export({ type: "spki", format: "pem" }));

console.log(`[generate-election-key] wrote ${publicPath} and ${privatePath}`);
