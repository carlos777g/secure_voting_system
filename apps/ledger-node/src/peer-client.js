import { publicKeyFromPem } from "@secure-voting/shared";

export async function fetchPeerChain(peerUrl) {
  const response = await fetch(`${peerUrl}/chain`);
  if (!response.ok) {
    throw new Error(`failed to fetch chain from ${peerUrl}: HTTP ${response.status}`);
  }
  return response.json(); // { nodeId, chain }
}

export async function fetchPeerPublicKey(peerUrl) {
  const response = await fetch(`${peerUrl}/public-key`);
  if (!response.ok) {
    throw new Error(`failed to fetch public key from ${peerUrl}: HTTP ${response.status}`);
  }
  const pem = await response.text();
  return publicKeyFromPem(pem);
}

export async function broadcastBlock(peerUrl, block) {
  const response = await fetch(`${peerUrl}/peer/blocks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ block })
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`peer ${peerUrl} rejected broadcast block: ${body.error ?? response.status}`);
  }
  return response.json();
}
