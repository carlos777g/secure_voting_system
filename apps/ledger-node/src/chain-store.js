import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createGenesisBlock } from "@secure-voting/shared";

export function loadChain(dataPath) {
  if (!existsSync(dataPath)) {
    const chain = [createGenesisBlock()];
    persistChain(dataPath, chain);
    return chain;
  }
  return JSON.parse(readFileSync(dataPath, "utf8"));
}

export function persistChain(dataPath, chain) {
  mkdirSync(path.dirname(dataPath), { recursive: true });
  writeFileSync(dataPath, JSON.stringify(chain, null, 2));
}

// O(1) duplicate-token rejection instead of scanning the whole chain on
// every vote submission. Rebuilt from the chain on load/replace, kept in
// sync incrementally on append.
export function tokenHashSetFromChain(chain) {
  const set = new Set();
  for (const block of chain) {
    if (block.data && typeof block.data.ballot_token_hash === "string") {
      set.add(block.data.ballot_token_hash);
    }
  }
  return set;
}
