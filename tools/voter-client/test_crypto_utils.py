import json

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, padding, rsa

from crypto_utils import b64d, build_encrypted_vote, canonical_json, sha256_hex

# Fixtures generated from packages/shared/src/canonical.js's canonicalStringify
# (see the generation command in the voter-client design spec) — the Python
# implementation must byte-match these, with no Node dependency at test time.
CANONICAL_JSON_FIXTURES = [
    ({"b": 2, "a": 1}, '{"a":1,"b":2}'),
    (
        {"z": "hello", "nested": {"b": 2, "a": 1}, "arr": [3, 1, 2]},
        '{"arr":[3,1,2],"nested":{"a":1,"b":2},"z":"hello"}',
    ),
    (
        {"unicode": "café ☕", "empty": {}, "arr": []},
        '{"arr":[],"empty":{},"unicode":"café ☕"}',
    ),
]


@pytest.mark.parametrize("value,expected", CANONICAL_JSON_FIXTURES)
def test_canonical_json_matches_js_output(value, expected):
    assert canonical_json(value) == expected.encode("utf-8")


def test_sha256_hex_matches_known_vector():
    assert sha256_hex(b"") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"


@pytest.fixture
def election_keypair():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private_key, private_key.public_key()


def test_build_encrypted_vote_round_trips(election_keypair):
    election_private, election_public = election_keypair
    vote_content = {"candidate": "alice", "choice_id": 7}
    token = "test-token-abc"

    encrypted = build_encrypted_vote(vote_content, token, election_public)

    assert encrypted["ballot_token_hash"] == sha256_hex(token.encode("utf-8"))
    for field in ("encrypted_vote", "nonce", "encrypted_aes_key", "signature", "voter_public_key"):
        assert isinstance(encrypted[field], str) and encrypted[field]

    # Decrypt exactly as tally-authority will: unwrap the AES key, decrypt
    # the vote, and verify the signature over the pre-decryption fields.
    aes_key = election_private.decrypt(
        b64d(encrypted["encrypted_aes_key"]),
        padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None),
    )
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    plaintext = AESGCM(aes_key).decrypt(
        b64d(encrypted["nonce"]), b64d(encrypted["encrypted_vote"]), None
    )
    assert json.loads(plaintext) == vote_content

    signed_fields = {k: encrypted[k] for k in ("ballot_token_hash", "encrypted_vote", "nonce", "encrypted_aes_key")}
    voter_public_key = serialization.load_pem_public_key(b64d(encrypted["voter_public_key"]))
    assert isinstance(voter_public_key, ed25519.Ed25519PublicKey)
    voter_public_key.verify(b64d(encrypted["signature"]), canonical_json(signed_fields))


def test_build_encrypted_vote_uses_fresh_key_each_call(election_keypair):
    _, election_public = election_keypair
    first = build_encrypted_vote({"a": 1}, "token", election_public)
    second = build_encrypted_vote({"a": 1}, "token", election_public)
    # Same input, but AES key/nonce and the ephemeral signing key are fresh
    # each call, so ciphertext, signature, and public key must all differ.
    assert first["encrypted_vote"] != second["encrypted_vote"]
    assert first["voter_public_key"] != second["voter_public_key"]
