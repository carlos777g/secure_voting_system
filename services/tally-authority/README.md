# tally-authority

The only piece of this system that ever holds a key capable of decrypting
a vote. Two independent parts, run at different times:

- **`server.py`** — a persistent public-key server. Runs from before
  voting opens, serves `GET /public-key` (stdlib `http.server`, no
  framework — it's one static response), and does nothing
  decryption-related. `voter-client` fetches the key here directly.
- **`tally.py`** — a manually-triggered CLI script, run once by an admin
  after voting closes. This is where decryption actually happens.

## Why the election keypair is generated differently from every other key

Every other key in this system (`ensureEd25519KeyPair` in
`packages/shared`) follows a "generate if missing, silently" pattern —
fine for those, because they're service-identity keys: if a ledger node
loses its key and a fresh one gets generated, that's recoverable. The
election key is not like that. If it's ever regenerated, every vote
already encrypted against the old public key becomes permanently
undecryptable — irreversible data loss, not an operational inconvenience.

So: `scripts/generate-election-keys.py` is a separate, explicit,
one-time setup step, and it **refuses to overwrite** an existing keypair
rather than silently regenerating one. Both `server.py` and `tally.py`
fail hard at startup if the key files aren't there — neither will ever
generate one itself.

```bash
python scripts/generate-election-keys.py
# writes keys/election_private.pem and keys/election_public.pem
# (keys/ is gitignored; back up the private key somewhere safe)
```

## Running the public-key server

```bash
python server.py            # GET /public-key on :5000 (PORT env var to change)
```

## Running the tally

```bash
python tally.py --ledger-urls http://localhost:4001,http://localhost:4002,http://localhost:4003
```

What it does, in order:

1. Fetches the **raw** `GET /chain` from every URL given — never a node's
   own `/sync` result, and never just one node's copy.
2. Computes majority agreement itself, block index by block index (with 3
   nodes: at least 2 of 3 must report the same hash at that index). This
   re-derivation happens entirely inside `tally.py`/`majority.py` — no
   node's own claim about consensus is trusted.
3. For every block that reached majority: decrypts it (RSA-OAEP unwraps
   the AES key, AES-GCM decrypts the vote, the ephemeral Ed25519
   signature is verified) and adds it to the count.
4. For every block that did **not** reach majority: excluded from the
   count, and listed explicitly in `excluded_divergent_blocks` with the
   full hash breakdown per node — never silently dropped.
5. Prints a JSON report and exits `0` if everything was clean, or `2` if
   anything was excluded or failed integrity verification (still prints
   the tally either way — `2` means "review before certifying").

### What it looks like when a node has been tampered with

Using `apps/ledger-node`'s demo-only `POST /admin/tamper` (see its
README):

- **One node tampered, the other two agree:** the tampered node is simply
  outvoted; the tally is unaffected, and it doesn't even show up in
  `excluded_divergent_blocks` because a majority *was* reached — just not
  including that node's copy.
- **Two nodes tampered differently (genuine 3-way split, no majority
  anywhere):** the affected block, and every block after it (tampering
  cascades forward through `previousHash`), gets excluded. `tally.py`
  exits `2` and the report shows exactly which node held which hash at
  each divergent index.

## Tests

```bash
pytest
```

Covers `majority.py`'s agreement logic (unanimous, 2-of-3, 3-way split,
short/missing chains) and `crypto_utils.py`'s decrypt+verify path against
the real wire format produced by `tools/voter-client`.
