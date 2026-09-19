import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  sign as nodeSign,
  verify as nodeVerify
} from "node:crypto";
import path from "node:path";

// Ed25519 is deterministic (RFC 8032): signing the same bytes with the same
// key always produces the same signature. Some callers rely on this (e.g.
// eligibility-authority reissuing an unexpired credential without storing
// its signature separately).

// `name` namespaces the key files (e.g. "authority", "node-a") so a single
// keysDir can hold more than one identity's keys without collision.
export function ensureEd25519KeyPair(keysDir, name) {
  const privatePath = path.join(keysDir, `${name}_private.pem`);
  const publicPath = path.join(keysDir, `${name}_public.pem`);

  if (existsSync(privatePath) && existsSync(publicPath)) {
    return loadEd25519KeyPair(keysDir, name);
  }

  mkdirSync(keysDir, { recursive: true });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  writeFileSync(privatePath, privateKey.export({ type: "pkcs8", format: "pem" }));
  writeFileSync(publicPath, publicKey.export({ type: "spki", format: "pem" }));
  return { privateKey, publicKey };
}

export function loadEd25519KeyPair(keysDir, name) {
  const privatePem = readFileSync(path.join(keysDir, `${name}_private.pem`));
  const publicPem = readFileSync(path.join(keysDir, `${name}_public.pem`));
  return {
    privateKey: createPrivateKey({ key: privatePem, format: "pem", type: "pkcs8" }),
    publicKey: createPublicKey({ key: publicPem, format: "pem", type: "spki" })
  };
}

export function publicKeyFromPem(pem) {
  return createPublicKey({ key: pem, format: "pem", type: "spki" });
}

export function signBytes(privateKey, data) {
  // Ed25519 in Node's crypto API is single-shot: no incremental hashing,
  // the algorithm argument to sign/verify must be null.
  return nodeSign(null, data, privateKey);
}

export function verifyBytes(publicKey, data, signature) {
  return nodeVerify(null, data, publicKey, signature);
}
