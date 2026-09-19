import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generateKeyPairSync, sign as nodeSign, verify as nodeVerify } from "node:crypto";
import path from "node:path";

// Ed25519 is deterministic (RFC 8032): signing the same bytes with the same
// key always produces the same signature. That property is used elsewhere
// (server.js) to make reissuing an unexpired credential idempotent without
// storing the signature separately — it is simply recomputed.

export function ensureAuthorityKeys(keysDir) {
  const privatePath = path.join(keysDir, "authority_private.pem");
  const publicPath = path.join(keysDir, "authority_public.pem");

  if (existsSync(privatePath) && existsSync(publicPath)) {
    return loadAuthorityKeys(keysDir);
  }

  mkdirSync(keysDir, { recursive: true });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  writeFileSync(privatePath, privateKey.export({ type: "pkcs8", format: "pem" }));
  writeFileSync(publicPath, publicKey.export({ type: "spki", format: "pem" }));
  return { privateKey, publicKey };
}

export function loadAuthorityKeys(keysDir) {
  const privatePem = readFileSync(path.join(keysDir, "authority_private.pem"));
  const publicPem = readFileSync(path.join(keysDir, "authority_public.pem"));
  return {
    privateKey: { key: privatePem, format: "pem", type: "pkcs8" },
    publicKey: { key: publicPem, format: "pem", type: "spki" }
  };
}

export function signBytes(privateKey, data) {
  // Ed25519 in Node's crypto API is single-shot: no incremental hashing,
  // the algorithm argument to sign/verify must be null.
  return nodeSign(null, data, privateKey);
}

export function verifyBytes(publicKey, data, signature) {
  return nodeVerify(null, data, publicKey, signature);
}
