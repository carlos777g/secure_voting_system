#!/usr/bin/env bash
# Starts every service needed for a local end-to-end run: eligibility-authority,
# the 3-node ledger-node cluster (via `pnpm dev`), and tally-authority's
# public-key server. One command, five processes.
#
# Election keypair generation is bundled here but stays safe: the generator
# script refuses to overwrite an existing keypair, so re-running this after
# the first time is a no-op for key material, never a silent regeneration.
set -e
cd "$(dirname "$0")/.."

PYTHON="${PYTHON:-python3}"

echo "[dev-up] ensuring election keypair exists (no-op if already present)..."
"$PYTHON" services/tally-authority/scripts/generate-election-keys.py || true

echo "[dev-up] starting eligibility-authority + ledger-node cluster..."
pnpm dev &
NODE_PID=$!

echo "[dev-up] starting tally-authority public-key server on :5000..."
"$PYTHON" services/tally-authority/server.py &
PY_PID=$!

trap 'echo "[dev-up] stopping..."; kill "$NODE_PID" "$PY_PID" 2>/dev/null' EXIT INT TERM

wait
