import path from "node:path";

const DEFAULT_CREDENTIAL_TTL_MS = 15 * 60 * 1000; // 15 minutes

export const config = {
  port: Number(process.env.PORT ?? 4000),
  dbPath: process.env.DB_PATH ?? path.join("data", "eligibility.db"),
  keysDir: process.env.KEYS_DIR ?? "keys",
  credentialTtlMs: Number(process.env.CREDENTIAL_TTL_MS ?? DEFAULT_CREDENTIAL_TTL_MS)
};
