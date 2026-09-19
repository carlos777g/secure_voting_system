export function loadConfig(env = process.env) {
  const nodeId = env.NODE_ID;
  const role = env.ROLE;

  if (!nodeId) throw new Error("NODE_ID is required");
  if (role !== "primary" && role !== "replica") {
    throw new Error('ROLE must be "primary" or "replica"');
  }

  return {
    nodeId,
    role,
    port: Number(env.PORT ?? 4001),
    dataPath: env.DATA_PATH ?? `data/${nodeId}.json`,
    keysDir: env.KEYS_DIR ?? "keys",
    authorityUrl: env.AUTHORITY_URL ?? "http://localhost:4000",
    // Comma-separated base URLs of every OTHER ledger-node in the cluster.
    peers: (env.PEERS ?? "").split(",").map((url) => url.trim()).filter(Boolean)
  };
}
