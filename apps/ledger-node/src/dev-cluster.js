import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(__dirname, "index.js");

// Convention: peers[0] is always the primary's URL (see config.js,
// index.js, and server.js's replica redirect). Replicas also list each
// other so /sync compares against all three nodes, not just the primary.
const nodes = [
  { NODE_ID: "node-a", ROLE: "primary", PORT: "4001", PEERS: "http://localhost:4002,http://localhost:4003" },
  { NODE_ID: "node-b", ROLE: "replica", PORT: "4002", PEERS: "http://localhost:4001,http://localhost:4003" },
  { NODE_ID: "node-c", ROLE: "replica", PORT: "4003", PEERS: "http://localhost:4001,http://localhost:4002" }
];

function startNode(overrides, delayMs) {
  setTimeout(() => {
    const child = spawn(process.execPath, [entry], {
      env: { ...process.env, DATA_PATH: `data/${overrides.NODE_ID}.json`, ...overrides },
      stdio: "inherit"
    });
    child.on("exit", (code) => {
      // eslint-disable-next-line no-console
      console.log(`[dev-cluster] ${overrides.NODE_ID} exited with code ${code}`);
    });
  }, delayMs);
}

// The primary starts first and with no delay: replicas fetch its public
// key at their own startup and will fail if it isn't already listening.
startNode(nodes[0], 0);
startNode(nodes[1], 1500);
startNode(nodes[2], 1500);

// eslint-disable-next-line no-console
console.log("[dev-cluster] node-a (primary) on :4001, node-b/node-c (replicas) on :4002/:4003");
