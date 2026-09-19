import { publicKeyFromPem } from "@secure-voting/shared";

export async function fetchAuthorityPublicKey(authorityUrl) {
  const response = await fetch(`${authorityUrl}/public-key`);
  if (!response.ok) {
    throw new Error(`failed to fetch authority public key: HTTP ${response.status}`);
  }
  const pem = await response.text();
  return publicKeyFromPem(pem);
}
