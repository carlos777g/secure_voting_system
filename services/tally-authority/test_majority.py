from majority import compute_majority_chain


def block(index, hash_value):
    return {"index": index, "hash": hash_value, "data": {"type": "anonymous_vote"}}


def test_unanimous_agreement_is_counted():
    chains = {
        "node-a": [block(0, "h0"), block(1, "h1")],
        "node-b": [block(0, "h0"), block(1, "h1")],
        "node-c": [block(0, "h0"), block(1, "h1")],
    }
    result = compute_majority_chain(chains)
    assert len(result["counted_blocks"]) == 2
    assert result["divergent"] == []


def test_two_of_three_reaches_majority_third_flagged():
    chains = {
        "node-a": [block(0, "h0"), block(1, "h1")],
        "node-b": [block(0, "h0"), block(1, "h1")],
        "node-c": [block(0, "h0"), block(1, "TAMPERED")],
    }
    result = compute_majority_chain(chains)
    assert len(result["counted_blocks"]) == 2
    assert result["counted_blocks"][1]["agreeing_nodes"] == ["node-a", "node-b"]
    assert result["divergent"] == []


def test_three_way_split_reaches_no_majority():
    chains = {
        "node-a": [block(0, "hA")],
        "node-b": [block(0, "hB")],
        "node-c": [block(0, "hC")],
    }
    result = compute_majority_chain(chains)
    assert result["counted_blocks"] == []
    assert len(result["divergent"]) == 1
    assert result["divergent"][0]["index"] == 0


def test_two_node_cluster_requires_both_to_agree():
    chains = {
        "node-a": [block(0, "h0")],
        "node-b": [block(0, "DIFFERENT")],
    }
    result = compute_majority_chain(chains)
    assert result["counted_blocks"] == []
    assert len(result["divergent"]) == 1


def test_shorter_chain_counts_as_missing_not_as_agreeing():
    chains = {
        "node-a": [block(0, "h0"), block(1, "h1")],
        "node-b": [block(0, "h0"), block(1, "h1")],
        "node-c": [block(0, "h0")],  # behind — hasn't received block 1 yet
    }
    result = compute_majority_chain(chains)
    # index 1: node-a and node-b agree, which is already >= majority of 3
    assert len(result["counted_blocks"]) == 2
    assert result["counted_blocks"][1]["agreeing_nodes"] == ["node-a", "node-b"]
