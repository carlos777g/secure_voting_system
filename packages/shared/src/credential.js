import { randomBytes } from "node:crypto";
import { canonicalStringify } from "./canonical.js";
import { signBytes, verifyBytes } from "./keys.js";

function credentialBytes({ token, issued_at, expires_at }) {
  return Buffer.from(canonicalStringify({ token, issued_at, expires_at }), "utf8");
}

// The token is the only part of this credential that ever gets hashed into
// a vote (as ballot_token_hash, computed on the Python side).
// issued_at/expires_at are signed alongside it so any relying party (a
// ledger node) can reject an expired credential locally.
export function issueCredential({ privateKey, ttlMs, now = Date.now() }) {
  const token = randomBytes(32).toString("base64url");
  const issued_at = now;
  const expires_at = now + ttlMs;
  const signature = signBytes(privateKey, credentialBytes({ token, issued_at, expires_at }));
  return { token, issued_at, expires_at, signature: signature.toString("base64url") };
}

// Recomputes the signature for an already-issued, still-unexpired
// credential instead of minting a new token. Safe only because Ed25519
// signing is deterministic — the result is byte-for-byte identical to the
// signature produced at original issuance.
export function resignCredential({ privateKey, token, issued_at, expires_at }) {
  const signature = signBytes(privateKey, credentialBytes({ token, issued_at, expires_at }));
  return { token, issued_at, expires_at, signature: signature.toString("base64url") };
}

// The relying-party side: any ledger node holding the authority's public
// key calls this locally, with no network round-trip back to the authority.
export function verifyCredential({ publicKey, token, issued_at, expires_at, signature }, now = Date.now()) {
  if (now >= expires_at) {
    return { valid: false, reason: "credential expired" };
  }
  const signatureBuffer = Buffer.from(signature, "base64url");
  const ok = verifyBytes(publicKey, credentialBytes({ token, issued_at, expires_at }), signatureBuffer);
  return ok ? { valid: true } : { valid: false, reason: "invalid signature" };
}
