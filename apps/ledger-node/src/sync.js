import { detectDivergence, isChainAuthenticallySigned } from "@secure-voting/shared";
import { fetchPeerChain } from "./peer-client.js";

export async function runSync({ selfNodeId, chain, peers, primaryPublicKey }) {
  const chainsById = { [selfNodeId]: chain };
  const peerErrors = [];

  for (const peerUrl of peers) {
    try {
      const { nodeId, chain: peerChain } = await fetchPeerChain(peerUrl);
      chainsById[nodeId] = peerChain;
    } catch (err) {
      peerErrors.push({ peerUrl, error: err.message });
    }
  }

  const divergence = detectDivergence(chainsById);

  return {
    ...divergence,
    // Catches a compromised PRIMARY rewriting its own history — see
    // replication.js and tamper.js for why signature checks alone cannot
    // catch that case, only cross-node comparison can.
    selfAuthenticallySigned: isChainAuthenticallySigned(chain, primaryPublicKey),
    peerErrors
  };
}
