"""Independent majority computation over raw ledger-node chains.

Deliberately does NOT call any node's /sync endpoint or trust any node's
own divergence report — tally-authority fetches raw /chain from every
configured node and computes agreement itself, block index by block
index. A block is counted only if a strict majority of responding nodes
report the same hash at that index; otherwise it is excluded and reported
as divergent.
"""


def compute_majority_chain(chains_by_node_id: dict) -> dict:
    """chains_by_node_id: {node_id: [block, ...]} — the raw /chain response
    from every configured ledger-node, all of which must have responded.

    Returns {"counted_blocks": [...], "divergent": [...]}.
    counted_blocks: blocks (in index order) where a strict majority of
        nodes agreed on that index's hash, each tagged with which node
        ids agreed.
    divergent: indices where no hash reached a strict majority, each
        listing which node ids reported which hash — nothing at a
        divergent index is counted.
    """
    node_ids = list(chains_by_node_id.keys())
    node_count = len(node_ids)
    if node_count == 0:
        return {"counted_blocks": [], "divergent": []}

    majority_threshold = node_count // 2 + 1
    max_length = max(len(chain) for chain in chains_by_node_id.values())

    counted_blocks = []
    divergent = []

    for index in range(max_length):
        nodes_by_hash = {}
        for node_id, chain in chains_by_node_id.items():
            block = chain[index] if index < len(chain) else None
            block_hash = block["hash"] if block is not None else None
            nodes_by_hash.setdefault(block_hash, []).append(node_id)

        ranked = sorted(nodes_by_hash.items(), key=lambda entry: len(entry[1]), reverse=True)
        top_hash, top_node_ids = ranked[0]

        if top_hash is not None and len(top_node_ids) >= majority_threshold:
            source_node_id = top_node_ids[0]
            block = chains_by_node_id[source_node_id][index]
            counted_blocks.append({"index": index, "block": block, "agreeing_nodes": top_node_ids})
        else:
            divergent.append(
                {
                    "index": index,
                    "hash_groups": {
                        (h if h is not None else "<missing>"): nodes for h, nodes in nodes_by_hash.items()
                    },
                }
            )

    return {"counted_blocks": counted_blocks, "divergent": divergent}
